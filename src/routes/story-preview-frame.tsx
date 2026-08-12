import * as React from 'react';
import {Badge} from '../components/design-system/badge';
import {Button} from '../components/design-system/button';
import {SegmentedControl} from '../components/design-system/segmented-control';
import {ErrorMessage} from '../components/error/error-message';
import {pluralizedNoun} from '../util/pluralized-noun';
import {
	createStoryPreviewPassageLookup,
	initialStoryPreviewRuntimeModel,
	instrumentPreviewHtml,
	normalizeStoryPreviewBridgeMessage,
	reduceStoryPreviewRuntime,
	runtimeLogTone,
	runtimePassageLabel
} from './story-preview-debug';
import type {
	StoryPreviewDebuggerSectionStatus,
	StoryPreviewDebuggerVariable,
	StoryPreviewDebugMetric,
	StoryPreviewPassageLookup,
	StoryPreviewPassageRef,
	StoryPreviewRuntimeModel,
	StoryPreviewRuntimePassage,
	StoryPreviewViewportPreset
} from './story-preview-debug';
import type {StoryPreviewDebuggerCapability} from './story-preview-debugger-protocol';
import './story-preview-frame.css';

export interface StoryPreviewSrcDocContentSource {
	bridgeSessionId?: string;
	html: string;
	type: 'srcDoc';
}

export interface StoryPreviewUrlContentSource {
	bridgeSessionId: string;
	htmlBytes: number;
	storyDataCount: number;
	type: 'url';
	url: string;
}

export type StoryPreviewContentSource =
	StoryPreviewSrcDocContentSource | StoryPreviewUrlContentSource;

const EMPTY_STORY_PREVIEW_PASSAGES: StoryPreviewPassageRef[] = [];

const DEBUGGER_CAPABILITY_LABELS: Record<
	StoryPreviewDebuggerCapability,
	string
> = {
	currentPassage: 'Current passage',
	storyVariables: 'Story variables',
	temporaryVariables: 'Temporary variables',
	visitedPassages: 'Visited passages'
};

function debuggerSectionStatusLabel(
	status: StoryPreviewDebuggerSectionStatus | undefined
) {
	if (!status) {
		return 'Waiting';
	}
	if (status.state === 'complete') {
		return 'Complete';
	}
	if (status.state === 'unavailable') {
		return 'Unavailable';
	}
	return `Truncated: ${status.reasons.join(', ')}`;
}

function runtimeDebuggerPassageLabel(passage: StoryPreviewRuntimePassage) {
	for (const identity of [
		passage.name,
		passage.rawName,
		passage.localId,
		passage.rawId,
		passage.id
	]) {
		const label = identity?.trim();

		if (label) {
			return label;
		}
	}

	return 'Unknown passage';
}

function RuntimeDebuggerPassageActions({
	passage,
	onRevealGraph,
	onRevealSource
}: {
	passage: StoryPreviewRuntimePassage;
	onRevealGraph?: (passageId?: string) => void;
	onRevealSource?: (passageId?: string) => void;
}) {
	if (!passage.id) {
		return null;
	}
	const passageLabel = runtimeDebuggerPassageLabel(passage);

	return (
		<span className="story-preview-route__debugger-passage-actions">
			{onRevealSource && (
				<Button
					aria-label={`Open ${passageLabel} in Source`}
					icon="file-text"
					onClick={() => onRevealSource(passage.id)}
					size="sm"
				>
					Source
				</Button>
			)}
			{onRevealGraph && (
				<Button
					aria-label={`Open ${passageLabel} in Graph`}
					icon="binary-tree"
					onClick={() => onRevealGraph(passage.id)}
					size="sm"
				>
					Graph
				</Button>
			)}
		</span>
	);
}

function RuntimeDebuggerVariables({
	variables
}: {
	variables: StoryPreviewDebuggerVariable[] | undefined;
}) {
	if (!variables?.length) {
		return <p className="story-preview-route__debugger-empty">None.</p>;
	}

	return (
		<ul className="story-preview-route__debugger-variables">
			{variables.map(variable => (
				<li key={variable.name}>
					<code>{variable.name}</code>
					<span>{variable.type}</span>
					<code className="story-preview-route__debugger-variable-preview">
						{variable.preview}
					</code>
				</li>
			))}
		</ul>
	);
}

export interface StoryPreviewContentHostProps {
	bridgeSessionId: string;
	contentSource: StoryPreviewContentSource;
	frameRef: React.RefObject<HTMLIFrameElement | null>;
	onLoad?: () => void;
	reloadKey: number;
	staging?: boolean;
	title: string;
	viewportPreset: StoryPreviewViewportPreset;
}

/**
 * Hosts story code without owning runtime state or discovering a platform
 * bridge. Desktop callers pass an already-authorized opaque URL.
 */
export const StoryPreviewContentHost: React.FC<
	StoryPreviewContentHostProps
> = ({
	bridgeSessionId,
	contentSource,
	frameRef,
	onLoad,
	reloadKey,
	staging = false,
	title,
	viewportPreset
}) => {
	const sourceHtml =
		contentSource.type === 'srcDoc' ? contentSource.html : undefined;
	const srcDoc = React.useMemo(
		() =>
			sourceHtml === undefined
				? undefined
				: instrumentPreviewHtml(sourceHtml, bridgeSessionId, {
						enableHarloweSessionStorageFallback: true
					}),
		[bridgeSessionId, sourceHtml]
	);

	return (
		<div
			aria-hidden={staging || undefined}
			className={`story-preview-route__frame-shell${
				staging ? ' story-preview-route__frame-shell--staging' : ''
			}`}
			data-viewport={viewportPreset}
		>
			<iframe
				className="story-preview-route__frame"
				key={`${bridgeSessionId}:${reloadKey}`}
				ref={frameRef}
				onLoad={onLoad}
				sandbox={
					contentSource.type === 'url'
						? 'allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts'
						: 'allow-downloads allow-forms allow-modals allow-popups allow-scripts'
				}
				{...(contentSource.type === 'url'
					? {src: contentSource.url}
					: {srcDoc})}
				title={title}
			/>
		</div>
	);
};

export interface StoryPreviewFrameProps {
	contentSource?: StoryPreviewContentSource;
	debugMetrics?: StoryPreviewDebugMetric[];
	error?: Error;
	/**
	 * Browser-route compatibility shorthand. New hosts should use the explicit
	 * `contentSource` prop.
	 */
	html?: string;
	missingStoryMessage: string;
	onContentLoad?: () => void;
	onRevealGraph?: (passageId?: string) => void;
	onRevealSource?: (passageId?: string) => void;
	onRuntimeModelChange?: (model: StoryPreviewRuntimeModel) => void;
	onStagedContentLoad?: () => void;
	onTestCurrentPassage?: (passageId: string) => void;
	onTestFromStart?: () => void;
	passages?: StoryPreviewPassageRef[];
	stagedContentSource?: StoryPreviewUrlContentSource;
	stagedPassages?: StoryPreviewPassageRef[];
	stagedTitle?: string;
	startPassageName?: string;
	storyExists: boolean;
	storyName?: string;
	targetLabel?: string;
	testCommandsBusy?: boolean;
	title: string;
}

function byteLength(source: string) {
	return new Blob([source]).size;
}

function storyDataCount(source: string) {
	return source.match(/<tw-storydata\b/g)?.length ?? 0;
}

export const StoryPreviewFrame: React.FC<StoryPreviewFrameProps> = props => {
	const {
		contentSource: explicitContentSource,
		debugMetrics = [],
		error,
		html,
		missingStoryMessage,
		onContentLoad,
		onRevealGraph,
		onRevealSource,
		onRuntimeModelChange,
		onStagedContentLoad,
		onTestCurrentPassage,
		onTestFromStart,
		passages = EMPTY_STORY_PREVIEW_PASSAGES,
		stagedContentSource,
		stagedPassages = EMPTY_STORY_PREVIEW_PASSAGES,
		stagedTitle,
		startPassageName,
		storyExists,
		storyName,
		targetLabel,
		testCommandsBusy = false,
		title
	} = props;
	const contentSource = React.useMemo<StoryPreviewContentSource | undefined>(
		() =>
			explicitContentSource ??
			(html === undefined ? undefined : {html, type: 'srcDoc'}),
		[explicitContentSource, html]
	);
	const sourceBridgeSessionId = contentSource?.bridgeSessionId;
	const sourceIdentity =
		contentSource?.type === 'url'
			? contentSource.url
			: contentSource?.type === 'srcDoc'
				? contentSource.html
				: undefined;
	const bridgeSessionId = React.useMemo(
		() =>
			sourceBridgeSessionId ??
			`preview-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		[sourceBridgeSessionId, sourceIdentity]
	);
	const [reloadKey, setReloadKey] = React.useState(0);
	const [messageListenerReady, setMessageListenerReady] = React.useState(false);
	const [runtimeModel, dispatchRuntime] = React.useReducer(
		reduceStoryPreviewRuntime,
		!!contentSource,
		initialStoryPreviewRuntimeModel
	);
	const [viewportPreset, setViewportPreset] =
		React.useState<StoryPreviewViewportPreset>('fit');
	const [debuggerExpanded, setDebuggerExpanded] = React.useState(false);
	const debuggerPanelId = React.useId();
	const previewFrame = React.useRef<HTMLIFrameElement>(null);
	const stagedPreviewFrame = React.useRef<HTMLIFrameElement>(null);
	const passageLookup = React.useMemo(
		() => createStoryPreviewPassageLookup(passages),
		[passages]
	);
	const stagedPassageLookup = React.useMemo(
		() => createStoryPreviewPassageLookup(stagedPassages),
		[stagedPassages]
	);
	const bridgeSessionIdRef = React.useRef(bridgeSessionId);
	const passageLookupRef = React.useRef(passageLookup);
	const stagedRuntimeRef = React.useRef<
		| {
				bridgeSessionId: string;
				model: StoryPreviewRuntimeModel;
				passages: StoryPreviewPassageLookup;
		  }
		| undefined
	>(undefined);

	bridgeSessionIdRef.current = bridgeSessionId;
	passageLookupRef.current = passageLookup;
	if (stagedContentSource) {
		if (
			stagedRuntimeRef.current?.bridgeSessionId !==
			stagedContentSource.bridgeSessionId
		) {
			stagedRuntimeRef.current = {
				bridgeSessionId: stagedContentSource.bridgeSessionId,
				model: initialStoryPreviewRuntimeModel(true),
				passages: stagedPassageLookup
			};
		} else {
			stagedRuntimeRef.current.passages = stagedPassageLookup;
		}
	}
	const runtimeLogs = runtimeModel.logs;
	const runtimeState = runtimeModel.runtime;
	const currentPassage = runtimeState.currentPassage;
	const currentPassageId = currentPassage?.id;
	const latestLog = runtimeLogs[0];
	const debuggerHello = runtimeModel.debugger.hello;
	const debuggerSnapshot = runtimeModel.debugger.snapshot;
	const runtimeViewport = runtimeState.viewport;
	const publishedMetadata = React.useMemo(() => {
		if (contentSource?.type === 'url') {
			return {
				htmlBytes: contentSource.htmlBytes,
				storyDataCount: contentSource.storyDataCount
			};
		}

		if (contentSource?.type === 'srcDoc') {
			return {
				htmlBytes: byteLength(contentSource.html),
				storyDataCount: storyDataCount(contentSource.html)
			};
		}

		return undefined;
	}, [contentSource]);
	const publishedHtmlBytes = publishedMetadata?.htmlBytes;
	const publishedStoryDataCount = publishedMetadata?.storyDataCount;

	React.useLayoutEffect(() => {
		setDebuggerExpanded(false);
		const stagedRuntime = stagedRuntimeRef.current;

		if (stagedRuntime && stagedRuntime.bridgeSessionId === bridgeSessionId) {
			stagedRuntimeRef.current = undefined;
			dispatchRuntime({model: stagedRuntime.model, type: 'replace'});
			return;
		}

		dispatchRuntime({hasContent: !!contentSource, type: 'reset'});
	}, [bridgeSessionId, reloadKey, sourceIdentity]);

	React.useLayoutEffect(() => {
		const stagedRuntime = stagedRuntimeRef.current;

		if (
			!stagedContentSource &&
			stagedRuntime &&
			stagedRuntime.bridgeSessionId !== bridgeSessionId
		) {
			stagedRuntimeRef.current = undefined;
		}
	}, [bridgeSessionId, stagedContentSource]);

	React.useEffect(() => {
		onRuntimeModelChange?.(runtimeModel);
	}, [onRuntimeModelChange, runtimeModel]);

	React.useEffect(() => {
		function handleMessage(event: MessageEvent) {
			const message = normalizeStoryPreviewBridgeMessage(event.data);

			if (!message) {
				return;
			}

			if (
				event.source === previewFrame.current?.contentWindow &&
				message.sessionId === bridgeSessionIdRef.current
			) {
				dispatchRuntime({
					message,
					now: Date.now(),
					passages: passageLookupRef.current,
					type: 'message'
				});
				return;
			}

			const stagedRuntime = stagedRuntimeRef.current;

			if (
				stagedRuntime &&
				event.source === stagedPreviewFrame.current?.contentWindow &&
				message.sessionId === stagedRuntime.bridgeSessionId
			) {
				stagedRuntime.model = reduceStoryPreviewRuntime(stagedRuntime.model, {
					message,
					now: Date.now(),
					passages: stagedRuntime.passages,
					type: 'message'
				});
			}
		}

		window.addEventListener('message', handleMessage);
		// Do not assign src/srcDoc until the listener exists. Story formats and
		// user scripts can report synchronously while the frame is starting.
		setMessageListenerReady(true);

		return () => window.removeEventListener('message', handleMessage);
	}, []);

	if (error) {
		return <ErrorMessage>{error.message}</ErrorMessage>;
	}

	if (!storyExists) {
		return <ErrorMessage>{missingStoryMessage}</ErrorMessage>;
	}

	return (
		<main className="story-preview-route">
			<div className="story-preview-route__debug">
				<div className="story-preview-route__debug-main">
					<Badge icon="player-play" tone="build">
						{targetLabel ?? 'Preview'}
					</Badge>
					<span className="story-preview-route__story-name">
						{storyName ?? title}
					</span>
					{startPassageName && (
						<Badge icon="rocket" tone="accent">
							Start: {startPassageName}
						</Badge>
					)}
					{publishedHtmlBytes !== undefined &&
						publishedStoryDataCount !== undefined && (
							<Badge
								icon="database"
								mono
								tone={publishedStoryDataCount === 1 ? 'success' : 'warn'}
							>
								{publishedHtmlBytes} bytes · {publishedStoryDataCount}{' '}
								{pluralizedNoun(publishedStoryDataCount, 'story-data element')}
							</Badge>
						)}
					{debugMetrics.map(metric => (
						<Badge
							icon={metric.icon}
							key={`${metric.label}:${metric.value}`}
							mono
							tone={metric.tone ?? 'neutral'}
							title={`${metric.value} ${metric.label}`}
						>
							{metric.value} {metric.label}
						</Badge>
					))}
				</div>
				<div className="story-preview-route__debug-actions">
					<Button
						disabled={
							testCommandsBusy || !currentPassageId || !onTestCurrentPassage
						}
						icon="player-play"
						onClick={() =>
							currentPassageId && onTestCurrentPassage?.(currentPassageId)
						}
						size="sm"
						variant="primary"
					>
						Test Current
					</Button>
					<Button
						disabled={testCommandsBusy || !onTestFromStart}
						icon="tool"
						onClick={onTestFromStart}
						size="sm"
						variant="primary"
					>
						Test From Start
					</Button>
					<Button
						disabled={!onRevealSource}
						icon="file-text"
						onClick={() => onRevealSource?.(currentPassageId)}
						size="sm"
					>
						Source
					</Button>
					<Button
						disabled={!onRevealGraph}
						icon="binary-tree"
						onClick={() => onRevealGraph?.(currentPassageId)}
						size="sm"
					>
						Graph
					</Button>
					<Button
						disabled={!contentSource || !!stagedContentSource}
						icon="refresh"
						onClick={() => {
							setDebuggerExpanded(false);
							setReloadKey(current => current + 1);
						}}
						size="sm"
					>
						Reload
					</Button>
				</div>
			</div>
			{contentSource && (
				<>
					<div className="story-preview-route__runtime">
						<div className="story-preview-route__runtime-main">
							<Badge
								icon={currentPassageId ? 'focus-2' : 'circle-dashed'}
								tone={currentPassageId ? 'accent' : 'generated'}
								title={currentPassage?.source}
							>
								{runtimePassageLabel(currentPassage, runtimeState.status)}
							</Badge>
							<Badge icon="resize" mono tone="neutral">
								{runtimeViewport
									? `${runtimeViewport.width} x ${runtimeViewport.height}`
									: runtimeState.status === 'waiting'
										? 'runtime waiting'
										: 'runtime idle'}
							</Badge>
							<Badge
								icon="terminal-2"
								mono
								tone={runtimeLogTone(runtimeLogs)}
								title={latestLog?.message}
							>
								{runtimeLogs.length} {pluralizedNoun(runtimeLogs.length, 'log')}
							</Badge>
							{latestLog && (
								<span
									className="story-preview-route__latest-log"
									data-level={latestLog.level}
								>
									{latestLog.message}
								</span>
							)}
						</div>
						{debuggerHello && (
							<Button
								aria-controls={debuggerPanelId}
								aria-expanded={debuggerExpanded}
								icon="bug"
								onClick={() => setDebuggerExpanded(expanded => !expanded)}
								size="sm"
							>
								Debugger
							</Button>
						)}
						<SegmentedControl
							className="story-preview-route__viewport-control"
							onChange={value =>
								setViewportPreset(value as StoryPreviewViewportPreset)
							}
							options={[
								{icon: 'arrows-diagonal', label: 'Fit', value: 'fit'},
								{icon: 'layout-grid', label: 'Desktop', value: 'desktop'},
								{icon: 'layout-columns', label: 'Tablet', value: 'tablet'},
								{icon: 'resize', label: 'Phone', value: 'phone'}
							]}
							size="sm"
							value={viewportPreset}
						/>
					</div>
					{debuggerHello && debuggerExpanded && (
						<section
							aria-label="Runtime debugger inspector"
							className="story-preview-route__debugger"
							id={debuggerPanelId}
						>
							<div className="story-preview-route__debugger-metadata">
								<span>
									Format: {debuggerHello.format} {debuggerHello.formatVersion}
								</span>
								<span>Adapter: {debuggerHello.id}</span>
								<span>Reliability: {debuggerHello.reliability}</span>
							</div>
							{!debuggerSnapshot ? (
								<p className="story-preview-route__debugger-waiting">
									Waiting for the first debugger snapshot.
								</p>
							) : (
								<div className="story-preview-route__debugger-sections">
									{debuggerHello.capabilities.map(capability => {
										const status = debuggerSnapshot.sections[capability];

										return (
											<section
												className="story-preview-route__debugger-section"
												key={capability}
											>
												<header>
													<h2>{DEBUGGER_CAPABILITY_LABELS[capability]}</h2>
													<span>{debuggerSectionStatusLabel(status)}</span>
												</header>
												{capability === 'currentPassage' && (
													<div className="story-preview-route__debugger-passage">
														<span>
															{debuggerSnapshot.currentPassage
																? runtimeDebuggerPassageLabel(
																		debuggerSnapshot.currentPassage
																	)
																: status?.state === 'unavailable'
																	? 'Unavailable.'
																	: 'None.'}
														</span>
														{debuggerSnapshot.currentPassage && (
															<RuntimeDebuggerPassageActions
																passage={debuggerSnapshot.currentPassage}
																onRevealGraph={onRevealGraph}
																onRevealSource={onRevealSource}
															/>
														)}
													</div>
												)}
												{capability === 'storyVariables' &&
													(status?.state === 'unavailable' ? (
														<p className="story-preview-route__debugger-empty">
															Unavailable.
														</p>
													) : (
														<RuntimeDebuggerVariables
															variables={debuggerSnapshot.storyVariables}
														/>
													))}
												{capability === 'temporaryVariables' &&
													(status?.state === 'unavailable' ? (
														<p className="story-preview-route__debugger-empty">
															Unavailable.
														</p>
													) : (
														<RuntimeDebuggerVariables
															variables={debuggerSnapshot.temporaryVariables}
														/>
													))}
												{capability === 'visitedPassages' &&
													(status?.state === 'unavailable' ? (
														<p className="story-preview-route__debugger-empty">
															Unavailable.
														</p>
													) : debuggerSnapshot.visitedPassages?.length ? (
														<ol className="story-preview-route__debugger-history">
															{debuggerSnapshot.visitedPassages.map(
																(passage, index) => (
																	<li
																		key={`${passage.id ?? passage.localId ?? passage.name}:${index}`}
																	>
																		<span>
																			{runtimeDebuggerPassageLabel(passage)}
																		</span>
																		<RuntimeDebuggerPassageActions
																			passage={passage}
																			onRevealGraph={onRevealGraph}
																			onRevealSource={onRevealSource}
																		/>
																	</li>
																)
															)}
														</ol>
													) : (
														<p className="story-preview-route__debugger-empty">
															None.
														</p>
													))}
											</section>
										);
									})}
								</div>
							)}
						</section>
					)}
				</>
			)}
			{contentSource && messageListenerReady ? (
				<>
					<StoryPreviewContentHost
						bridgeSessionId={bridgeSessionId}
						contentSource={contentSource}
						frameRef={previewFrame}
						key={bridgeSessionId}
						onLoad={onContentLoad}
						reloadKey={reloadKey}
						title={title}
						viewportPreset={viewportPreset}
					/>
					{stagedContentSource && (
						<StoryPreviewContentHost
							bridgeSessionId={stagedContentSource.bridgeSessionId}
							contentSource={stagedContentSource}
							frameRef={stagedPreviewFrame}
							key={stagedContentSource.bridgeSessionId}
							onLoad={onStagedContentLoad}
							reloadKey={reloadKey}
							staging
							title={stagedTitle ?? `${title} candidate`}
							viewportPreset={viewportPreset}
						/>
					)}
				</>
			) : (
				<div className="story-preview-route__loading" role="status">
					Loading story...
				</div>
			)}
		</main>
	);
};
