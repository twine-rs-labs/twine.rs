import * as React from 'react';
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

/**
 * The single browser/workbench Preview route. Desktop launchers use the
 * managed preview window, while browser launchers open this route with an
 * explicit target and optional start passage.
 */
export const StoryPreviewRoute: React.FC = () => {
	const [publishError, setPublishError] = React.useState<Error>();
	const [html, setHtml] = React.useState<string>();
	const [summary, setSummary] = React.useState<CoreStorySummary>();
	const {storyId = ''} = useParams<'storyId'>();
	const location = useLocation();
	const navigate = useNavigate();
	const coreProjectHost = useCoreProjectHost();
	const {proofStory, publishStory} = usePublishing();
	const publishStoryRef = React.useRef(publishStory);
	const proofStoryRef = React.useRef(proofStory);
	const {stories} = useStoriesContext();
	const story = stories.find(candidate => candidate.id === storyId);
	const storyExists = !!story;
	const search = React.useMemo(
		() => new URLSearchParams(location.search),
		[location.search]
	);
	const target = previewTarget(search);
	const requestedPassageId = search.get('passage') ?? undefined;
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

	React.useEffect(() => {
		publishStoryRef.current = publishStory;
		proofStoryRef.current = proofStory;
	}, [proofStory, publishStory]);

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
				const published =
					target === 'proof'
						? selectedProofingFormat
							? await proofStoryRef.current(storyId, selectedProofingFormat)
							: await proofStoryRef.current(storyId)
						: await publishStoryRef.current(
								storyId,
								target === 'test'
									? {
											buildTarget: 'test',
											formatOptions: 'debug',
											...(requestedPassageId
												? {
														startId: requestedPassageId,
														startMode: 'afterStartup' as const
													}
												: {startId: undefined})
										}
									: {buildTarget: 'play'}
							);

				if (active) {
					setHtml(published);
				}
			} catch (error) {
				if (active) {
					setPublishError(error as Error);
				}
			}
		}

		setHtml(undefined);
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

	const passageQuery = React.useCallback(
		(passageId?: string) => {
			const targetId = passageId ?? startPassage?.id;

			return targetId ? `&passage=${encodeURIComponent(targetId)}` : '';
		},
		[startPassage?.id]
	);

	return (
		<StoryPreviewFrame
			debugMetrics={storyPreviewDebugMetrics(summary)}
			error={publishError}
			html={html}
			missingStoryMessage={`There is no story with ID "${storyId}".`}
			onRevealGraph={runtimePassageId =>
				navigate(
					`/stories/${encodeURIComponent(storyId)}?mode=graph${passageQuery(
						runtimePassageId
					)}`
				)
			}
			onRevealSource={runtimePassageId =>
				navigate(
					`/stories/${encodeURIComponent(storyId)}?mode=text${passageQuery(
						runtimePassageId
					)}`
				)
			}
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
			startPassageName={startPassage?.name}
			storyExists={storyExists}
			storyName={story?.name}
			targetLabel={presentation.label}
			title={presentation.title}
		/>
	);
};
