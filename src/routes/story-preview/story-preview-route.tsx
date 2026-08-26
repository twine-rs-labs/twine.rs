import * as React from 'react';
import {v4 as uuid} from '@lukeed/uuid';
import {useLocation, useNavigate, useParams} from 'react-router';
import {useCoreProjectHost} from '../../core';
import type {CoreStorySummary} from '../../core';
import type {NativeStoryPreviewTarget} from '../../electron/shared';
import {
	type ProofingFormatSelection,
	usePublishing
} from '../../store/use-publishing';
import {useStoriesContext} from '../../store/stories';
import {StoryPreviewFrame} from '../story-preview-frame';
import {
	storyPreviewDebugMetrics,
	storyPreviewPassages
} from '../story-preview-debug';
import {storyPreviewRoutePath} from './story-preview-route-path';
import type {PreviewFormatAdmission} from '../story-preview-format';
import {
	browserPreviewOwnerAcceptanceTimeoutMs,
	browserPreviewOwnerProtocol,
	isBrowserPreviewRevealResult,
	type BrowserPreviewRevealRequest
} from '../browser-preview-owner-registry';

const browserRevealAcceptanceTimeoutMs = browserPreviewOwnerAcceptanceTimeoutMs;
const browserRevealFinalTimeoutMs = 15_000;

function previewTarget(search: URLSearchParams): NativeStoryPreviewTarget {
	const target = search.get('target');

	return target === 'proof' || target === 'test' ? target : 'play';
}

function proofingFormat(
	search: URLSearchParams
): ProofingFormatSelection | undefined {
	const name = search.get('proofingFormatName');
	const version = search.get('proofingFormatVersion');

	return name && version ? {name, version} : undefined;
}

const targetPresentation = {
	play: {label: 'Play', title: 'Story preview'},
	proof: {label: 'Proof', title: 'Story proofing preview'},
	test: {label: 'Test', title: 'Story test preview'}
} as const;

export function browserRuntimeLogCopy():
	((text: string) => Promise<void>) | undefined {
	const clipboard = navigator.clipboard;

	return typeof clipboard?.writeText === 'function'
		? (text: string) => clipboard.writeText(text)
		: undefined;
}

/**
 * The single browser/workbench Preview route. Desktop launchers use the
 * managed preview window, while browser launchers open this route with an
 * explicit target and optional start passage.
 */
export const StoryPreviewRoute: React.FC = () => {
	const [publishError, setPublishError] = React.useState<Error>();
	const [html, setHtml] = React.useState<string>();
	const [admission, setAdmission] = React.useState<PreviewFormatAdmission>();
	const [summary, setSummary] = React.useState<CoreStorySummary>();
	const {storyId = ''} = useParams<'storyId'>();
	const location = useLocation();
	const navigate = useNavigate();
	const coreProjectHost = useCoreProjectHost();
	const {buildStoryPreviewPackage} = usePublishing();
	const buildStoryPreviewPackageRef = React.useRef(buildStoryPreviewPackage);
	const {stories} = useStoriesContext();
	const story = stories.find(candidate => candidate.id === storyId);
	const storyExists = !!story;
	const search = React.useMemo(
		() => new URLSearchParams(location.search),
		[location.search]
	);
	const target = previewTarget(search);
	const requestedPassageId = search.get('passage') ?? undefined;
	const ownerToken = search.get('ownerToken') ?? undefined;
	const selectedProofingFormat = React.useMemo(
		() => proofingFormat(search),
		[search]
	);
	const startPassageId =
		target === 'test' && requestedPassageId
			? requestedPassageId
			: story?.startPassage;
	const startPassage = story?.passages.find(
		passage => passage.id === startPassageId
	);
	const presentation = targetPresentation[target];
	const onCopyRuntimeLog = React.useMemo(browserRuntimeLogCopy, []);
	const [ownerRevealBusy, setOwnerRevealBusy] = React.useState(false);
	const ownerRevealBusyRef = React.useRef(false);

	React.useEffect(() => {
		buildStoryPreviewPackageRef.current = buildStoryPreviewPackage;
	}, [buildStoryPreviewPackage]);

	React.useEffect(() => {
		let active = true;

		if (!story) {
			setSummary(undefined);
			return () => {
				active = false;
			};
		}

		setSummary(undefined);
		void coreProjectHost.queryStorySummaryAsync(story.id).then(summary => {
			if (active) {
				setSummary(summary);
			}
		});

		return () => {
			active = false;
		};
	}, [coreProjectHost, story]);

	React.useEffect(() => {
		let active = true;

		async function load() {
			try {
				const published = await buildStoryPreviewPackageRef.current(
					storyId,
					target,
					{
						...(target === 'proof' && selectedProofingFormat
							? {proofingFormat: selectedProofingFormat}
							: {}),
						...(target === 'test'
							? {
									formatOptions: 'debug',
									...(requestedPassageId
										? {
												startId: requestedPassageId,
												startMode: 'afterStartup' as const
											}
										: {startId: undefined})
								}
							: {})
					}
				);

				if (active) {
					setAdmission(published.admission);
					setHtml(published.build.html);
					setSummary(published.summary);
				}
			} catch (error) {
				if (active) {
					setPublishError(error as Error);
				}
			}
		}

		setHtml(undefined);
		setAdmission(undefined);
		setPublishError(undefined);
		if (storyExists) {
			void load();
		}

		return () => {
			active = false;
		};
	}, [
		requestedPassageId,
		selectedProofingFormat,
		storyExists,
		storyId,
		target
	]);

	const reveal = React.useCallback(
		(mode: 'graph' | 'text', passageId?: string) => {
			if (!passageId || ownerRevealBusyRef.current) {
				return;
			}
			ownerRevealBusyRef.current = true;
			setOwnerRevealBusy(true);
			const finish = () => {
				ownerRevealBusyRef.current = false;
				setOwnerRevealBusy(false);
			};
			let fallbackAvailable = true;
			const fallback = () => {
				if (!fallbackAvailable) {
					return;
				}
				fallbackAvailable = false;
				finish();
				navigate(
					`/stories/${encodeURIComponent(
						storyId
					)}?mode=${mode}&passage=${encodeURIComponent(passageId)}`
				);
			};
			const opener = window.opener;

			if (
				!ownerToken ||
				!opener ||
				opener.closed ||
				typeof MessageChannel === 'undefined'
			) {
				fallback();
				return;
			}

			try {
				const channel = new MessageChannel();
				const requestId = `browser-reveal-${uuid()}`;
				const acceptanceDeadline =
					Date.now() + browserRevealAcceptanceTimeoutMs;
				let accepted = false;
				let finalTimeout: ReturnType<typeof setTimeout> | undefined;
				const acceptanceTimeout = setTimeout(() => {
					channel.port1.postMessage({
						requestId,
						source: browserPreviewOwnerProtocol.source,
						type: 'cancel',
						version: browserPreviewOwnerProtocol.version
					});
					channel.port1.close();
					fallback();
				}, browserRevealAcceptanceTimeoutMs);

				channel.port1.onmessage = event => {
					if (
						!isBrowserPreviewRevealResult(event.data) ||
						event.data.requestId !== requestId
					) {
						return;
					}
					if (event.data.status === 'accepted') {
						if (accepted || Date.now() >= acceptanceDeadline) {
							channel.port1.postMessage({
								requestId,
								source: browserPreviewOwnerProtocol.source,
								type: 'cancel',
								version: browserPreviewOwnerProtocol.version
							});
							channel.port1.close();
							fallback();
							return;
						}
						accepted = true;
						fallbackAvailable = false;
						clearTimeout(acceptanceTimeout);
						channel.port1.postMessage({
							requestId,
							source: browserPreviewOwnerProtocol.source,
							type: 'commit',
							version: browserPreviewOwnerProtocol.version
						});
						finalTimeout = setTimeout(() => {
							channel.port1.postMessage({
								requestId,
								source: browserPreviewOwnerProtocol.source,
								type: 'cancel',
								version: browserPreviewOwnerProtocol.version
							});
							channel.port1.close();
							finish();
						}, browserRevealFinalTimeoutMs);
						return;
					}
					clearTimeout(acceptanceTimeout);
					if (finalTimeout) {
						clearTimeout(finalTimeout);
					}
					// Both success and a valid rejection are authoritative. Only an
					// unavailable owner transport falls back to self-navigation.
					fallbackAvailable = false;
					channel.port1.close();
					finish();
				};
				const request: BrowserPreviewRevealRequest = {
					acceptanceDeadline,
					mode,
					passageId,
					requestId,
					source: browserPreviewOwnerProtocol.source,
					storyId,
					token: ownerToken,
					type: 'reveal',
					version: browserPreviewOwnerProtocol.version
				};

				opener.postMessage(request, window.location.origin, [channel.port2]);
			} catch {
				fallback();
			}
		},
		[navigate, ownerToken, storyId]
	);

	return (
		<StoryPreviewFrame
			admission={admission}
			debugMetrics={storyPreviewDebugMetrics(summary)}
			error={publishError}
			html={html}
			missingStoryMessage={`There is no story with ID "${storyId}".`}
			onCopyRuntimeLog={onCopyRuntimeLog}
			onRevealGraph={runtimePassageId => reveal('graph', runtimePassageId)}
			onRevealSource={runtimePassageId => reveal('text', runtimePassageId)}
			onTestCurrentPassage={runtimePassageId =>
				navigate(
					storyPreviewRoutePath(storyId, 'test', {
						passageId: runtimePassageId
					})
				)
			}
			onTestFromStart={
				story?.startPassage
					? () => navigate(storyPreviewRoutePath(storyId, 'test'))
					: undefined
			}
			passages={storyPreviewPassages(story)}
			previewTarget={target}
			runtimeControlsBusy={ownerRevealBusy}
			startPassageName={startPassage?.name}
			storyExists={storyExists}
			storyName={story?.name}
			targetLabel={presentation.label}
			title={presentation.title}
		/>
	);
};
