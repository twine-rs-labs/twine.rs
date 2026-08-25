import * as React from 'react';
import {IconEraser} from '@tabler/icons-react';
import {Badge} from '../components/design-system/badge';
import {Button} from '../components/design-system/button';
import {SegmentedControl} from '../components/design-system/segmented-control';
import {ConfirmButton} from '../components/control/confirm-button';
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
	PreviewBridgeContext,
	PreviewFormatAdmission,
	StoryPreviewDebuggerSectionStatus,
	StoryPreviewDebuggerVariable,
	StoryPreviewDebugMetric,
	StoryPreviewPassageLookup,
	StoryPreviewPassageRef,
	StoryPreviewRuntimeModel,
	StoryPreviewRuntimePassage,
	StoryPreviewViewportPreset
} from './story-preview-debug';
import {
	NO_PREVIEW_FORMAT_ADMISSION,
	canonicalPreviewFormatAdmission
} from './story-preview-format';
import type {StoryPreviewDebuggerCapability} from './story-preview-debugger-protocol';
import {
	STORY_PREVIEW_COMMAND_PROTOCOL_VERSION,
	STORY_PREVIEW_DEBUGGER_PROTOCOL_VERSION
} from './story-preview-debugger-protocol';
import type {StoryPreviewRestartResultStatus} from './story-preview-debugger-protocol';
import {
	serializeStoryPreviewRuntimeLog,
	STORY_PREVIEW_BRIDGE_LIMITS,
	STORY_PREVIEW_COMMAND_SOURCE
} from './story-preview-contract';
import './story-preview-frame.css';

export interface StoryPreviewSrcDocContentSource {
	admission?: PreviewFormatAdmission;
	bridgeSessionId?: string;
	generation?: number;
	html: string;
	sugarCubeRestartEligible?: boolean;
	type: 'srcDoc';
}

export interface StoryPreviewUrlContentSource {
	admission?: PreviewFormatAdmission;
	bridgeSessionId: string;
	generation?: number;
	htmlBytes: number;
	storyDataCount: number;
	sugarCubeRestartEligible?: boolean;
	type: 'url';
	url: string;
}

export type StoryPreviewContentSource =
	StoryPreviewSrcDocContentSource | StoryPreviewUrlContentSource;

export interface StoryPreviewClearStateOperation {
	generation: number;
	operationId: string;
	url: string;
}

interface PendingClearStateRun {
	aborted: boolean;
	cancel?: (operation: StoryPreviewClearStateOperation) => Promise<void>;
	cancelPromise?: Promise<void>;
	cancelRequested: boolean;
	id: number;
	operation?: StoryPreviewClearStateOperation;
	terminal: boolean;
}

interface PreviewFrameLoadReadiness {
	bootstrapChannelEstablished: boolean;
	bootstrapChallenge?: string;
	bootstrapChallengeIssued: boolean;
	bootstrapPort?: MessagePort;
	bootstrapReady: boolean;
	completed: boolean;
	frameWindow: Window | null;
	identity: object;
	loaded: boolean;
	requiresBootstrap: boolean;
}

const nativeReflectApply = Reflect.apply;
const secureRandomValues = globalThis.crypto?.getRandomValues.bind(
	globalThis.crypto
);

function createHarloweBootstrapChallenge() {
	if (!secureRandomValues) return undefined;

	try {
		const bytes = new Uint8Array(
			STORY_PREVIEW_BRIDGE_LIMITS.bootstrapChallengeLength / 2
		);

		secureRandomValues(bytes);
		return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join(
			''
		);
	} catch {
		return undefined;
	}
}

function previewFrameLoadReadiness(
	identity: object,
	requiresBootstrap: boolean
): PreviewFrameLoadReadiness {
	return {
		...(requiresBootstrap
			? {bootstrapChallenge: createHarloweBootstrapChallenge()}
			: {}),
		bootstrapChannelEstablished: false,
		bootstrapChallengeIssued: false,
		bootstrapReady: false,
		completed: false,
		frameWindow: null,
		identity,
		loaded: false,
		requiresBootstrap
	};
}

function previewFrameDocumentLoadReadiness(
	previous: PreviewFrameLoadReadiness,
	frameWindow: Window
) {
	const readiness = previewFrameLoadReadiness(
		previous.identity,
		previous.requiresBootstrap
	);

	// The bridge captures this channel before story code runs. Its child endpoint
	// belongs to the current document and is destroyed by native navigation. Keep
	// the channel across the matching load event, but rotate the challenge and
	// readiness proof for the loaded document.
	readiness.bootstrapChannelEstablished = previous.bootstrapChannelEstablished;
	readiness.bootstrapPort = previous.bootstrapPort;
	readiness.frameWindow = frameWindow;
	readiness.loaded = true;
	return readiness;
}

function closeHarloweBootstrapPort(
	readiness: PreviewFrameLoadReadiness | undefined
) {
	try {
		readiness?.bootstrapPort?.close();
	} catch {
		// A detached or already-closed document capability needs no cleanup.
	}
}

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
	showHarloweTemporaryExplanation = false,
	variables
}: {
	showHarloweTemporaryExplanation?: boolean;
	variables: StoryPreviewDebuggerVariable[] | undefined;
}) {
	if (!variables?.length) {
		return (
			<>
				{showHarloweTemporaryExplanation && (
					<p className="story-preview-route__debugger-temporary-explanation">
						Harlowe temporary variables are assignments observed during this
						turn; scope names are supplied by Harlowe.
					</p>
				)}
				<p className="story-preview-route__debugger-empty">None.</p>
			</>
		);
	}

	return (
		<>
			{showHarloweTemporaryExplanation && (
				<p className="story-preview-route__debugger-temporary-explanation">
					Harlowe temporary variables are assignments observed during this turn;
					scope names are supplied by Harlowe.
				</p>
			)}
			<ul className="story-preview-route__debugger-variables">
				{variables.map(variable => (
					<li key={JSON.stringify([variable.scope ?? null, variable.name])}>
						{variable.scope !== undefined && <code>{variable.scope}</code>}
						<code>{variable.name}</code>
						<span>{variable.type}</span>
						<code className="story-preview-route__debugger-variable-preview">
							{variable.preview}
						</code>
					</li>
				))}
			</ul>
		</>
	);
}

export interface StoryPreviewContentHostProps {
	bridgeSessionId: string;
	contentSource: StoryPreviewContentSource;
	frameName?: string;
	frameRef: React.Ref<HTMLIFrameElement>;
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
	frameName,
	frameRef,
	onLoad,
	reloadKey,
	staging = false,
	title,
	viewportPreset
}) => {
	const srcDoc =
		contentSource.type === 'srcDoc' ? contentSource.html : undefined;

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
				name={frameName}
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
	admission?: PreviewFormatAdmission;
	contentSource?: StoryPreviewContentSource;
	debugMetrics?: StoryPreviewDebugMetric[];
	error?: Error;
	/**
	 * Browser-route compatibility shorthand. New hosts should use the explicit
	 * `contentSource` prop.
	 */
	html?: string;
	missingStoryMessage: string;
	onBeginClearState?: () => Promise<StoryPreviewClearStateOperation>;
	onCancelClearState?: (
		operation: StoryPreviewClearStateOperation
	) => Promise<void>;
	onCompleteClearState?: (
		operation: StoryPreviewClearStateOperation
	) => Promise<void>;
	onContentLoad?: () => void;
	onCopyRuntimeLog?: (text: string) => void | Promise<void>;
	onRevealGraph?: (passageId?: string) => void;
	onRevealSource?: (passageId?: string) => void;
	onRuntimeModelChange?: (model: StoryPreviewRuntimeModel) => void;
	onStagedContentLoad?: () => void;
	onTestCurrentPassage?: (passageId: string) => void;
	onTestFromStart?: () => void;
	passages?: StoryPreviewPassageRef[];
	previewTarget?: 'play' | 'proof' | 'test';
	runtimeControlsBusy?: boolean;
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

function useCanonicalPreviewFormatAdmission(
	rawAdmission: PreviewFormatAdmission | undefined
) {
	const canonical = React.useMemo(
		() =>
			canonicalPreviewFormatAdmission(rawAdmission) ??
			NO_PREVIEW_FORMAT_ADMISSION,
		[rawAdmission]
	);
	const stable = React.useRef<PreviewFormatAdmission>(canonical);
	const previous = stable.current;
	const sameAdmission =
		previous.kind === canonical.kind &&
		(previous.kind === 'none' ||
			(canonical.kind === 'builtin-sha256' &&
				previous.adapterId === canonical.adapterId &&
				previous.format === canonical.format &&
				previous.sourceSha256 === canonical.sourceSha256 &&
				previous.version === canonical.version));

	if (!sameAdmission) stable.current = canonical;
	return stable.current;
}

function requiresHarloweBootstrap(admission: PreviewFormatAdmission) {
	return admission.kind === 'builtin-sha256' && admission.format === 'Harlowe';
}

export const StoryPreviewFrame: React.FC<StoryPreviewFrameProps> = props => {
	const {
		admission: shorthandAdmission,
		contentSource: explicitContentSource,
		debugMetrics = [],
		error,
		html,
		missingStoryMessage,
		onBeginClearState,
		onCancelClearState,
		onCompleteClearState,
		onContentLoad,
		onCopyRuntimeLog,
		onRevealGraph,
		onRevealSource,
		onRuntimeModelChange,
		onStagedContentLoad,
		onTestCurrentPassage,
		onTestFromStart,
		passages = EMPTY_STORY_PREVIEW_PASSAGES,
		previewTarget = 'play',
		runtimeControlsBusy = false,
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
	const rawContentSource = React.useMemo<StoryPreviewContentSource | undefined>(
		() =>
			explicitContentSource ??
			(html === undefined
				? undefined
				: {admission: shorthandAdmission, html, type: 'srcDoc'}),
		[explicitContentSource, html, shorthandAdmission]
	);
	const sourceType = rawContentSource?.type;
	const sourceHtml =
		rawContentSource?.type === 'srcDoc' ? rawContentSource.html : undefined;
	const sourceUrl =
		rawContentSource?.type === 'url' ? rawContentSource.url : undefined;
	const sourceBridgeSessionId = rawContentSource?.bridgeSessionId;
	const sourceGeneration = rawContentSource?.generation;
	const sourceRestartEligible =
		rawContentSource?.sugarCubeRestartEligible === true;
	const sourceHtmlBytes =
		rawContentSource?.type === 'url' ? rawContentSource.htmlBytes : undefined;
	const sourceStoryDataCount =
		rawContentSource?.type === 'url'
			? rawContentSource.storyDataCount
			: undefined;
	const sourceAdmission = useCanonicalPreviewFormatAdmission(
		rawContentSource?.admission
	);
	const sourceContextIdentity = React.useMemo(
		() => ({}),
		[
			sourceAdmission,
			sourceBridgeSessionId,
			sourceGeneration,
			sourceHtml,
			sourceRestartEligible,
			sourceType,
			sourceUrl
		]
	);
	const bridgeSessionId = React.useMemo(
		() =>
			sourceBridgeSessionId ??
			`preview-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		[sourceBridgeSessionId, sourceContextIdentity]
	);
	const contentSource = React.useMemo<
		StoryPreviewContentSource | undefined
	>(() => {
		if (!sourceType) {
			return undefined;
		}
		if (sourceType === 'url') {
			return {
				admission: sourceAdmission,
				bridgeSessionId: sourceBridgeSessionId!,
				...(sourceGeneration === undefined
					? {}
					: {generation: sourceGeneration}),
				htmlBytes: sourceHtmlBytes!,
				storyDataCount: sourceStoryDataCount!,
				sugarCubeRestartEligible:
					sourceAdmission.kind === 'builtin-sha256' && sourceRestartEligible,
				type: 'url',
				url: sourceUrl!
			};
		}

		const instrumented = instrumentPreviewHtml(sourceHtml!, bridgeSessionId, {
			admission: sourceAdmission,
			enableHarloweSessionStorageFallback: true
		});

		return {
			admission: instrumented.admission,
			...(sourceBridgeSessionId === undefined
				? {}
				: {bridgeSessionId: sourceBridgeSessionId}),
			...(sourceGeneration === undefined ? {} : {generation: sourceGeneration}),
			html: instrumented.html,
			sugarCubeRestartEligible: instrumented.sugarCubeRestartEligible,
			type: 'srcDoc'
		};
	}, [
		bridgeSessionId,
		sourceAdmission,
		sourceBridgeSessionId,
		sourceGeneration,
		sourceHtml,
		sourceHtmlBytes,
		sourceRestartEligible,
		sourceStoryDataCount,
		sourceType,
		sourceUrl
	]);
	const [reloadKey, setReloadKey] = React.useState(0);
	const nativeWindowPostMessageRef = React.useRef<
		typeof globalThis.window.postMessage | undefined
	>(undefined);
	if (!nativeWindowPostMessageRef.current) {
		nativeWindowPostMessageRef.current = globalThis.window?.postMessage;
	}
	const currentBridgeContext = React.useMemo<PreviewBridgeContext>(
		() => ({
			admission: contentSource?.admission ?? NO_PREVIEW_FORMAT_ADMISSION,
			bridgeSessionId,
			generation: contentSource?.generation ?? 0,
			sugarCubeRestartEligible: contentSource?.sugarCubeRestartEligible === true
		}),
		[bridgeSessionId, contentSource]
	);
	const stagedAdmission = useCanonicalPreviewFormatAdmission(
		stagedContentSource?.admission
	);
	const stagedBridgeContext = React.useMemo(
		() =>
			stagedContentSource
				? ({
						admission: stagedAdmission,
						bridgeSessionId: stagedContentSource.bridgeSessionId,
						generation: stagedContentSource.generation ?? 0,
						sugarCubeRestartEligible:
							stagedAdmission.kind === 'builtin-sha256' &&
							stagedContentSource.sugarCubeRestartEligible === true
					} satisfies PreviewBridgeContext)
				: undefined,
		[
			stagedAdmission,
			stagedContentSource?.bridgeSessionId,
			stagedContentSource?.generation,
			stagedContentSource?.sugarCubeRestartEligible
		]
	);
	const stagedContextIdentity = stagedBridgeContext;
	const [messageListenerReady, setMessageListenerReady] = React.useState(false);
	const [runtimeModel, dispatchRuntime] = React.useReducer(
		reduceStoryPreviewRuntime,
		!!contentSource,
		initialStoryPreviewRuntimeModel
	);
	const [viewportPreset, setViewportPreset] =
		React.useState<StoryPreviewViewportPreset>('fit');
	const [debuggerExpanded, setDebuggerExpanded] = React.useState(false);
	const [copyState, setCopyState] = React.useState<
		'idle' | 'pending' | 'success' | 'error'
	>('idle');
	const [contentMounted, setContentMounted] = React.useState(true);
	const [frameName, setFrameName] = React.useState('');
	const [cleanupOperation, setCleanupOperation] =
		React.useState<StoryPreviewClearStateOperation>();
	const [runtimeControlBusy, setRuntimeControlBusy] = React.useState<
		'clear-state' | 'restart'
	>();
	const [runtimeControlNotice, setRuntimeControlNotice] = React.useState<{
		message: string;
		tone: 'error' | 'success' | 'warn';
	}>();
	const debuggerPanelId = React.useId();
	const previewFrame = React.useRef<HTMLIFrameElement>(null);
	const cleanupFrame = React.useRef<HTMLIFrameElement>(null);
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
	const bridgeContextRef = React.useRef(currentBridgeContext);
	const copyOperationRef = React.useRef(0);
	const copyPendingRef = React.useRef(false);
	const logRevisionRef = React.useRef(0);
	const previousLogsRef = React.useRef(runtimeModel.logs);
	const passageLookupRef = React.useRef(passageLookup);
	const preserveDebuggerOnRemountRef = React.useRef(false);
	const detachFrameResolverRef = React.useRef<(() => void) | undefined>(
		undefined
	);
	const pendingRestartRef = React.useRef<
		| {
				adapterId: string;
				frameName: string;
				requestId: string;
				timeout: ReturnType<typeof setTimeout>;
		  }
		| undefined
	>(undefined);
	const pendingCleanupAckRef = React.useRef<
		| {
				operationId: string;
				reject: (error: Error) => void;
				resolve: () => void;
				runId: number;
				timeout: ReturnType<typeof setTimeout>;
		  }
		| undefined
	>(undefined);
	const clearStateRunIdRef = React.useRef(0);
	const pendingClearStateRunRef = React.useRef<
		PendingClearStateRun | undefined
	>(undefined);
	const stagedRuntimeRef = React.useRef<
		| {
				bridgeSessionId: string;
				context: PreviewBridgeContext;
				contextIdentity: PreviewBridgeContext;
				model: StoryPreviewRuntimeModel;
				passages: StoryPreviewPassageLookup;
		  }
		| undefined
	>(undefined);
	const currentLoadIdentity = React.useMemo(
		() => ({}),
		[sourceContextIdentity, reloadKey]
	);
	const stagedLoadIdentity = React.useMemo(
		() => ({}),
		[reloadKey, stagedContextIdentity]
	);
	const currentLoadReadiness = React.useMemo(
		() =>
			previewFrameLoadReadiness(
				currentLoadIdentity,
				requiresHarloweBootstrap(
					contentSource?.admission ?? NO_PREVIEW_FORMAT_ADMISSION
				)
			),
		[currentLoadIdentity, contentSource?.admission]
	);
	const stagedLoadReadiness = React.useMemo(
		() =>
			previewFrameLoadReadiness(
				stagedLoadIdentity,
				requiresHarloweBootstrap(stagedAdmission)
			),
		[stagedAdmission, stagedLoadIdentity]
	);
	const currentLoadReadinessRef = React.useRef<
		PreviewFrameLoadReadiness | undefined
	>(currentLoadReadiness);
	const stagedLoadReadinessRef = React.useRef<
		PreviewFrameLoadReadiness | undefined
	>(stagedLoadReadiness);
	const runtimeLogs = runtimeModel.logs;
	if (previousLogsRef.current !== runtimeLogs) {
		previousLogsRef.current = runtimeLogs;
		logRevisionRef.current += 1;
	}
	const runtimeState = runtimeModel.runtime;
	const currentPassage = runtimeState.currentPassage;
	const currentPassageId = currentPassage?.id;
	const latestLog = runtimeLogs[0];
	const debuggerHello = runtimeModel.debugger.hello;
	const debuggerSnapshot = runtimeModel.debugger.snapshot;
	const runtimeViewport = runtimeState.viewport;
	const publishedMetadata = React.useMemo(() => {
		if (sourceType === 'url') {
			return {
				htmlBytes: sourceHtmlBytes!,
				storyDataCount: sourceStoryDataCount!
			};
		}

		if (sourceType === 'srcDoc') {
			return {
				htmlBytes: byteLength(sourceHtml!),
				storyDataCount: storyDataCount(sourceHtml!)
			};
		}

		return undefined;
	}, [sourceHtml, sourceHtmlBytes, sourceStoryDataCount, sourceType]);
	const publishedHtmlBytes = publishedMetadata?.htmlBytes;
	const publishedStoryDataCount = publishedMetadata?.storyDataCount;
	const restartAvailable =
		runtimeModel.debugger.commands?.capabilities.includes('restart') === true;
	const controlsDisabled =
		runtimeControlBusy !== undefined ||
		runtimeControlsBusy ||
		testCommandsBusy ||
		!!stagedContentSource;
	const commitStagedRuntime = React.useCallback(() => {
		if (!stagedContentSource) return;
		const stagedRuntime = stagedRuntimeRef.current;

		if (
			!stagedRuntime ||
			stagedRuntime.contextIdentity !== stagedContextIdentity
		) {
			stagedRuntimeRef.current = {
				bridgeSessionId: stagedContentSource.bridgeSessionId,
				context: stagedBridgeContext!,
				contextIdentity: stagedContextIdentity!,
				model: initialStoryPreviewRuntimeModel(true),
				passages: stagedPassageLookup
			};
		} else {
			stagedRuntime.context = stagedBridgeContext!;
			stagedRuntime.passages = stagedPassageLookup;
		}
	}, [
		stagedBridgeContext,
		stagedContentSource,
		stagedContextIdentity,
		stagedPassageLookup
	]);

	const setPreviewFrameRef = React.useCallback(
		(element: HTMLIFrameElement | null) => {
			previewFrame.current = element;
			if (element) {
				const activeReadiness = currentLoadReadinessRef.current;
				const frameWindow = element.contentWindow;

				if (
					activeReadiness?.identity !== currentLoadReadiness.identity ||
					activeReadiness.frameWindow !== frameWindow
				) {
					closeHarloweBootstrapPort(activeReadiness);
					currentLoadReadiness.frameWindow = frameWindow;
					currentLoadReadinessRef.current = currentLoadReadiness;
				}
				bridgeSessionIdRef.current = bridgeSessionId;
				bridgeContextRef.current = currentBridgeContext;
				passageLookupRef.current = passageLookup;
			}
			if (!element) {
				const resolve = detachFrameResolverRef.current;

				detachFrameResolverRef.current = undefined;
				resolve?.();
			}
		},
		[bridgeSessionId, currentBridgeContext, currentLoadReadiness, passageLookup]
	);
	const setStagedPreviewFrameRef = React.useCallback(
		(element: HTMLIFrameElement | null) => {
			stagedPreviewFrame.current = element;
			if (element) {
				const activeReadiness = stagedLoadReadinessRef.current;
				const frameWindow = element.contentWindow;

				if (
					activeReadiness?.identity !== stagedLoadReadiness.identity ||
					activeReadiness.frameWindow !== frameWindow
				) {
					closeHarloweBootstrapPort(activeReadiness);
					stagedLoadReadiness.frameWindow = frameWindow;
					stagedLoadReadinessRef.current = stagedLoadReadiness;
				}
				commitStagedRuntime();
			}
		},
		[commitStagedRuntime, stagedLoadReadiness]
	);
	React.useLayoutEffect(() => {
		bridgeSessionIdRef.current = bridgeSessionId;
		bridgeContextRef.current = currentBridgeContext;
		passageLookupRef.current = passageLookup;
		commitStagedRuntime();
	}, [
		bridgeSessionId,
		commitStagedRuntime,
		currentBridgeContext,
		passageLookup
	]);
	const setCleanupFrameRef = React.useCallback(
		(element: HTMLIFrameElement | null) => {
			cleanupFrame.current = element;
		},
		[]
	);

	const detachPreviewFrame = React.useCallback(() => {
		if (!previewFrame.current) {
			setContentMounted(false);
			return Promise.resolve();
		}

		return new Promise<void>(resolve => {
			detachFrameResolverRef.current = resolve;
			setContentMounted(false);
		});
	}, []);

	const requestClearStateCancellation = React.useCallback(
		(run: PendingClearStateRun) => {
			const cancel = run.cancel;
			const operation = run.operation;

			if (run.terminal || run.cancelRequested || !operation || !cancel) {
				return run.cancelPromise ?? Promise.resolve();
			}

			run.cancelRequested = true;
			run.cancelPromise = Promise.resolve()
				.then(() => cancel(operation))
				.catch(() => undefined);
			return run.cancelPromise;
		},
		[]
	);

	const abortClearStateRun = React.useCallback(
		(run: PendingClearStateRun, reason: Error) => {
			if (!run.aborted) {
				run.aborted = true;
				const pendingAck = pendingCleanupAckRef.current;

				if (pendingAck?.runId === run.id) {
					clearTimeout(pendingAck.timeout);
					pendingCleanupAckRef.current = undefined;
					pendingAck.reject(reason);
				}
				if (pendingClearStateRunRef.current === run) {
					pendingClearStateRunRef.current = undefined;
				}
			}

			void requestClearStateCancellation(run);
		},
		[requestClearStateCancellation]
	);

	const remountPreviewFrame = React.useCallback(
		(options: {frameName?: string; preserveDebugger?: boolean} = {}) => {
			preserveDebuggerOnRemountRef.current = options.preserveDebugger === true;
			setCleanupOperation(undefined);
			setFrameName(options.frameName ?? '');
			setContentMounted(true);
			setReloadKey(current => current + 1);
		},
		[]
	);
	const completeContentLoad = React.useCallback(() => {
		const frame = previewFrame.current;
		const restartPrefix = `twine-rs-restart:${bridgeSessionIdRef.current}:`;

		if (frameName.startsWith(restartPrefix)) {
			setFrameName('');
			if (frame) {
				frame.name = '';
			}
		}
		onContentLoad?.();
	}, [frameName, onContentLoad]);
	const completeStagedContentLoad = React.useCallback(() => {
		onStagedContentLoad?.();
	}, [onStagedContentLoad]);
	const completeContentLoadRef = React.useRef(completeContentLoad);
	const completeStagedContentLoadRef = React.useRef(completeStagedContentLoad);

	React.useLayoutEffect(() => {
		completeContentLoadRef.current = completeContentLoad;
		completeStagedContentLoadRef.current = completeStagedContentLoad;
	}, [completeContentLoad, completeStagedContentLoad]);
	const completeLoadIfReady = React.useCallback(
		(
			readiness: PreviewFrameLoadReadiness | undefined,
			complete: () => void
		) => {
			if (
				!readiness ||
				readiness.completed ||
				!readiness.loaded ||
				(readiness.requiresBootstrap && !readiness.bootstrapReady)
			) {
				return;
			}

			readiness.completed = true;
			complete();
		},
		[]
	);
	const issueHarloweBootstrapChallenge = React.useCallback(
		(
			source: MessageEventSource | null,
			readiness: PreviewFrameLoadReadiness | undefined,
			context: PreviewBridgeContext
		) => {
			if (
				!readiness?.requiresBootstrap ||
				readiness.bootstrapChallengeIssued ||
				!readiness.bootstrapChallenge ||
				readiness.frameWindow !== source ||
				!readiness.bootstrapPort ||
				!source
			) {
				return;
			}

			try {
				readiness.bootstrapPort.postMessage({
					adapterId: 'harlowe-3.3.9',
					bootstrapChallenge: readiness.bootstrapChallenge,
					protocolVersion: STORY_PREVIEW_DEBUGGER_PROTOCOL_VERSION,
					sessionId: context.bridgeSessionId,
					source: STORY_PREVIEW_COMMAND_SOURCE,
					type: 'debugger-bootstrap-challenge'
				});
				readiness.bootstrapChallengeIssued = true;
			} catch {
				// Exact Harlowe readiness remains fail-closed if the private
				// per-document-load challenge cannot be delivered.
			}
		},
		[]
	);
	const establishHarloweBootstrapChannel = React.useCallback(
		(
			kind: 'current' | 'staged',
			source: MessageEventSource | null,
			readiness: PreviewFrameLoadReadiness | undefined,
			context: PreviewBridgeContext
		) => {
			if (
				!readiness?.requiresBootstrap ||
				readiness.bootstrapChannelEstablished ||
				readiness.frameWindow !== source ||
				!nativeWindowPostMessageRef.current ||
				!source ||
				typeof globalThis.MessageChannel !== 'function'
			) {
				return;
			}

			readiness.bootstrapChannelEstablished = true;
			const channel = new globalThis.MessageChannel();

			readiness.bootstrapPort = channel.port1;
			channel.port1.addEventListener('message', event => {
				const activeReadiness =
					kind === 'current'
						? currentLoadReadinessRef.current
						: stagedLoadReadinessRef.current;
				const activeFrame =
					kind === 'current'
						? previewFrame.current
						: stagedPreviewFrame.current;
				const activeContext =
					kind === 'current'
						? bridgeContextRef.current
						: stagedRuntimeRef.current?.context;

				if (
					activeReadiness?.bootstrapPort !== channel.port1 ||
					activeReadiness.frameWindow !== activeFrame?.contentWindow ||
					!activeContext ||
					event.data?.type !== 'debugger-bootstrap-ready'
				) {
					return;
				}
				const message = normalizeStoryPreviewBridgeMessage(event.data, {
					...activeContext,
					harloweBootstrapChallenge: activeReadiness.bootstrapChallenge
				});

				if (
					message?.type !== 'debugger-bootstrap-ready' ||
					!activeReadiness.bootstrapChallengeIssued
				) {
					return;
				}
				activeReadiness.bootstrapReady = true;
				completeLoadIfReady(
					activeReadiness,
					kind === 'current'
						? completeContentLoadRef.current
						: completeStagedContentLoadRef.current
				);
			});
			channel.port1.start();
			try {
				nativeReflectApply(nativeWindowPostMessageRef.current, source, [
					{
						adapterId: 'harlowe-3.3.9',
						protocolVersion: STORY_PREVIEW_DEBUGGER_PROTOCOL_VERSION,
						sessionId: context.bridgeSessionId,
						source: STORY_PREVIEW_COMMAND_SOURCE,
						type: 'debugger-bootstrap-port'
					},
					'*',
					[channel.port2]
				]);
				issueHarloweBootstrapChallenge(source, readiness, context);
			} catch {
				closeHarloweBootstrapPort(readiness);
				readiness.bootstrapPort = undefined;
				try {
					channel.port2.close();
				} catch {
					// The transferred endpoint is already detached.
				}
			}
		},
		[completeLoadIfReady, issueHarloweBootstrapChallenge]
	);
	const handleContentLoad = React.useCallback(() => {
		const previous = currentLoadReadinessRef.current;
		const frameWindow = previewFrame.current?.contentWindow;

		if (previous?.identity !== currentLoadIdentity || !frameWindow) return;
		const readiness = previewFrameDocumentLoadReadiness(previous, frameWindow);

		currentLoadReadinessRef.current = readiness;
		issueHarloweBootstrapChallenge(
			frameWindow,
			readiness,
			bridgeContextRef.current
		);
		completeLoadIfReady(readiness, completeContentLoad);
	}, [
		completeContentLoad,
		completeLoadIfReady,
		currentLoadIdentity,
		issueHarloweBootstrapChallenge
	]);
	const handleStagedContentLoad = React.useCallback(() => {
		const previous = stagedLoadReadinessRef.current;
		const frameWindow = stagedPreviewFrame.current?.contentWindow;
		const stagedRuntime = stagedRuntimeRef.current;

		if (
			previous?.identity !== stagedLoadIdentity ||
			!frameWindow ||
			!stagedRuntime
		) {
			return;
		}
		const readiness = previewFrameDocumentLoadReadiness(previous, frameWindow);

		stagedLoadReadinessRef.current = readiness;
		issueHarloweBootstrapChallenge(
			frameWindow,
			readiness,
			stagedRuntime.context
		);
		completeLoadIfReady(readiness, completeStagedContentLoad);
	}, [
		completeLoadIfReady,
		completeStagedContentLoad,
		issueHarloweBootstrapChallenge,
		stagedLoadIdentity
	]);

	React.useLayoutEffect(() => {
		if (preserveDebuggerOnRemountRef.current) {
			preserveDebuggerOnRemountRef.current = false;
		} else {
			setDebuggerExpanded(false);
		}
		logRevisionRef.current += 1;
		if (!copyPendingRef.current) {
			setCopyState('idle');
		}
		const stagedRuntime = stagedRuntimeRef.current;

		if (stagedRuntime && stagedRuntime.bridgeSessionId === bridgeSessionId) {
			stagedRuntimeRef.current = undefined;
			dispatchRuntime({model: stagedRuntime.model, type: 'replace'});
			return;
		}

		dispatchRuntime({hasContent: !!contentSource, type: 'reset'});
	}, [bridgeSessionId, reloadKey, sourceContextIdentity]);

	React.useLayoutEffect(() => {
		if (!copyPendingRef.current) {
			setCopyState('idle');
		}
	}, [runtimeLogs]);

	const copyRuntimeLog = React.useCallback(() => {
		if (!onCopyRuntimeLog || !runtimeLogs.length || copyPendingRef.current) {
			return;
		}
		const revision = logRevisionRef.current;
		const operation = ++copyOperationRef.current;
		let text: string;
		try {
			text = serializeStoryPreviewRuntimeLog(runtimeLogs);
		} catch {
			setCopyState('error');
			return;
		}
		copyPendingRef.current = true;
		setCopyState('pending');
		Promise.resolve()
			.then(() => onCopyRuntimeLog(text))
			.then(
				() => {
					if (
						operation === copyOperationRef.current &&
						revision === logRevisionRef.current
					) {
						setCopyState('success');
					}
				},
				() => {
					if (
						operation === copyOperationRef.current &&
						revision === logRevisionRef.current
					) {
						setCopyState('error');
					}
				}
			)
			.finally(() => {
				if (operation === copyOperationRef.current) {
					copyPendingRef.current = false;
					if (revision !== logRevisionRef.current) {
						setCopyState('idle');
					}
				}
			});
	}, [onCopyRuntimeLog, runtimeLogs]);

	const restartStory = React.useCallback(() => {
		const commands = runtimeModel.debugger.commands;
		const frame = previewFrame.current;

		if (
			controlsDisabled ||
			!restartAvailable ||
			!commands ||
			!frame?.contentWindow ||
			pendingRestartRef.current
		) {
			return;
		}

		const requestId =
			globalThis.crypto?.randomUUID?.() ??
			`${Date.now()}-${Math.random().toString(36).slice(2)}`;
		const restartFrameName = `twine-rs-restart:${bridgeSessionIdRef.current}:${requestId}`;
		const timeout = setTimeout(() => {
			const pending = pendingRestartRef.current;

			if (!pending || pending.requestId !== requestId) {
				return;
			}

			pendingRestartRef.current = undefined;
			setRuntimeControlBusy(undefined);
			setRuntimeControlNotice({
				message:
					'Restart timed out. The current artifact was remounted as a precaution.',
				tone: 'warn'
			});
			remountPreviewFrame({
				frameName: restartFrameName,
				preserveDebugger: true
			});
		}, 2000);

		pendingRestartRef.current = {
			adapterId: commands.adapterId,
			frameName: restartFrameName,
			requestId,
			timeout
		};
		setRuntimeControlBusy('restart');
		setRuntimeControlNotice(undefined);
		setFrameName(restartFrameName);
		frame.name = restartFrameName;

		try {
			frame.contentWindow.postMessage(
				{
					adapterId: commands.adapterId,
					command: 'restart',
					protocolVersion: STORY_PREVIEW_COMMAND_PROTOCOL_VERSION,
					requestId,
					sessionId: bridgeSessionIdRef.current,
					source: STORY_PREVIEW_COMMAND_SOURCE
				},
				'*'
			);
		} catch {
			clearTimeout(timeout);
			pendingRestartRef.current = undefined;
			setRuntimeControlBusy(undefined);
			setFrameName('');
			frame.name = '';
			setRuntimeControlNotice({
				message: 'Restart failed before changing the runtime.',
				tone: 'error'
			});
		}
	}, [
		controlsDisabled,
		remountPreviewFrame,
		restartAvailable,
		runtimeModel.debugger.commands
	]);

	const clearStoryState = React.useCallback(async () => {
		if (
			controlsDisabled ||
			previewTarget === 'proof' ||
			!contentSource ||
			pendingRestartRef.current
		) {
			return;
		}

		setRuntimeControlBusy('clear-state');
		setRuntimeControlNotice(undefined);
		const run: PendingClearStateRun = {
			aborted: false,
			cancel: onCancelClearState,
			cancelRequested: false,
			id: ++clearStateRunIdRef.current,
			terminal: false
		};
		pendingClearStateRunRef.current = run;
		const isActive = () =>
			!run.aborted && pendingClearStateRunRef.current === run;

		try {
			const begin = onBeginClearState?.();
			const detached = detachPreviewFrame();

			if (begin) {
				const operation = await begin;

				run.operation = operation;
				if (!isActive()) {
					await requestClearStateCancellation(run);
					return;
				}
				await detached;
				if (!isActive()) {
					await requestClearStateCancellation(run);
					return;
				}
				if (!onCompleteClearState || !onCancelClearState) {
					throw new Error('Clear State lifecycle is unavailable.');
				}

				await new Promise<void>((resolve, reject) => {
					const timeout = setTimeout(() => {
						if (
							pendingCleanupAckRef.current?.runId === run.id &&
							pendingCleanupAckRef.current.operationId === operation.operationId
						) {
							pendingCleanupAckRef.current = undefined;
						}
						reject(new Error('State cleanup page did not respond in time.'));
					}, 5000);

					pendingCleanupAckRef.current = {
						operationId: operation.operationId,
						reject,
						resolve,
						runId: run.id,
						timeout
					};
					setCleanupOperation(operation);
				});
				if (!isActive()) {
					return;
				}

				setCleanupOperation(undefined);
				await onCompleteClearState(operation);
				if (!isActive()) {
					return;
				}
				run.terminal = true;
			} else {
				await detached;
				if (!isActive()) {
					return;
				}
			}

			setRuntimeControlNotice({
				message: 'Story state cleared.',
				tone: 'success'
			});
			remountPreviewFrame({preserveDebugger: true});
		} catch {
			if (!isActive()) {
				return;
			}
			const pendingAck = pendingCleanupAckRef.current;

			if (pendingAck?.runId === run.id) {
				clearTimeout(pendingAck.timeout);
				pendingCleanupAckRef.current = undefined;
			}
			setCleanupOperation(undefined);
			await requestClearStateCancellation(run);
			if (!isActive()) {
				return;
			}
			setRuntimeControlNotice({
				message:
					'Clear State could not be fully confirmed. The current artifact was remounted.',
				tone: 'warn'
			});
			remountPreviewFrame({preserveDebugger: true});
		} finally {
			if (pendingClearStateRunRef.current === run) {
				pendingClearStateRunRef.current = undefined;
				if (!run.aborted) {
					setRuntimeControlBusy(undefined);
				}
			}
		}
	}, [
		contentSource,
		controlsDisabled,
		detachPreviewFrame,
		onBeginClearState,
		onCancelClearState,
		onCompleteClearState,
		previewTarget,
		remountPreviewFrame,
		requestClearStateCancellation
	]);

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

	React.useLayoutEffect(() => {
		const pendingRestart = pendingRestartRef.current;
		const pendingClearState = pendingClearStateRunRef.current;

		if (pendingRestart) clearTimeout(pendingRestart.timeout);
		if (pendingClearState) {
			abortClearStateRun(
				pendingClearState,
				new Error('Preview identity changed during Clear State.')
			);
		}
		pendingRestartRef.current = undefined;
		setCleanupOperation(undefined);
		setContentMounted(true);
		setFrameName('');
		setRuntimeControlBusy(undefined);
		setRuntimeControlNotice(undefined);
	}, [abortClearStateRun, bridgeSessionId, sourceContextIdentity]);

	React.useLayoutEffect(
		() => () => {
			closeHarloweBootstrapPort(currentLoadReadinessRef.current);
			closeHarloweBootstrapPort(stagedLoadReadinessRef.current);
			if (pendingRestartRef.current) {
				clearTimeout(pendingRestartRef.current.timeout);
			}
			if (pendingClearStateRunRef.current) {
				abortClearStateRun(
					pendingClearStateRunRef.current,
					new Error('Preview unmounted during Clear State.')
				);
			}
		},
		[abortClearStateRun]
	);

	React.useEffect(() => {
		onRuntimeModelChange?.(runtimeModel);
	}, [onRuntimeModelChange, runtimeModel]);
	const remountPreviewFrameRef = React.useRef(remountPreviewFrame);

	React.useLayoutEffect(() => {
		remountPreviewFrameRef.current = remountPreviewFrame;
	}, [remountPreviewFrame]);

	React.useEffect(() => {
		function handleMessage(event: MessageEvent) {
			const cleanupAck = pendingCleanupAckRef.current;
			const cleanupData = event.data;

			if (
				cleanupAck &&
				pendingClearStateRunRef.current?.id === cleanupAck.runId &&
				!pendingClearStateRunRef.current.aborted &&
				event.source === cleanupFrame.current?.contentWindow &&
				cleanupData?.type === 'twine-preview-state-cleared' &&
				cleanupData.operationId === cleanupAck.operationId
			) {
				clearTimeout(cleanupAck.timeout);
				pendingCleanupAckRef.current = undefined;
				cleanupAck.resolve();
				return;
			}

			if (event.source === previewFrame.current?.contentWindow) {
				const readiness = currentLoadReadinessRef.current;
				const message = normalizeStoryPreviewBridgeMessage(event.data, {
					...bridgeContextRef.current,
					harloweBootstrapChallenge: readiness?.bootstrapChallenge
				});

				if (!message) {
					return;
				}
				if (message.type === 'debugger-bootstrap-arm') {
					establishHarloweBootstrapChannel(
						'current',
						event.source,
						readiness,
						bridgeContextRef.current
					);
					return;
				}
				if (message.type === 'debugger-bootstrap-ready') {
					// Readiness is accepted only over the document-owned MessagePort.
					return;
				}
				if (message.type === 'debugger-command-result') {
					const pending = pendingRestartRef.current;

					if (
						!pending ||
						message.command !== 'restart' ||
						message.requestId !== pending.requestId ||
						message.adapterId !== pending.adapterId ||
						message.protocolVersion !== STORY_PREVIEW_COMMAND_PROTOCOL_VERSION
					) {
						return;
					}

					clearTimeout(pending.timeout);
					pendingRestartRef.current = undefined;
					setRuntimeControlBusy(undefined);
					const status = message.status as StoryPreviewRestartResultStatus;

					if (status === 'applied') {
						setRuntimeControlNotice({
							message: 'Story restarted from its launch passage.',
							tone: 'success'
						});
						remountPreviewFrameRef.current({
							frameName: pending.frameName,
							preserveDebugger: true
						});
						return;
					}

					if (status === 'indeterminate') {
						setRuntimeControlNotice({
							message:
								'Restart could not be confirmed. The current artifact was remounted.',
							tone: 'warn'
						});
						remountPreviewFrameRef.current({
							frameName: pending.frameName,
							preserveDebugger: true
						});
						return;
					}

					setFrameName('');
					if (previewFrame.current) previewFrame.current.name = '';
					setRuntimeControlNotice({
						message:
							status === 'unavailable'
								? 'Restart is no longer available for this runtime.'
								: 'Restart failed before changing the runtime.',
						tone: 'error'
					});
					return;
				}

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
				event.source === stagedPreviewFrame.current?.contentWindow
			) {
				const readiness = stagedLoadReadinessRef.current;
				const message = normalizeStoryPreviewBridgeMessage(event.data, {
					...stagedRuntime.context,
					harloweBootstrapChallenge: readiness?.bootstrapChallenge
				});

				if (!message) {
					return;
				}
				if (message.type === 'debugger-bootstrap-arm') {
					establishHarloweBootstrapChannel(
						'staged',
						event.source,
						readiness,
						stagedRuntime.context
					);
					return;
				}
				if (message.type === 'debugger-bootstrap-ready') {
					// Readiness is accepted only over the document-owned MessagePort.
					return;
				}
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
	}, [completeLoadIfReady, establishHarloweBootstrapChannel]);

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
							controlsDisabled || !currentPassageId || !onTestCurrentPassage
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
						disabled={controlsDisabled || !onTestFromStart}
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
						disabled={
							!contentSource ||
							!!stagedContentSource ||
							runtimeControlBusy !== undefined
						}
						icon="refresh"
						onClick={() => {
							setRuntimeControlNotice(undefined);
							remountPreviewFrame();
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
						<Button
							aria-controls={debuggerPanelId}
							aria-expanded={debuggerExpanded}
							icon="bug"
							onClick={() => setDebuggerExpanded(expanded => !expanded)}
							size="sm"
						>
							Debugger
						</Button>
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
					{debuggerExpanded && (
						<section
							aria-label="Runtime debugger inspector"
							className="story-preview-route__debugger"
							id={debuggerPanelId}
						>
							<section className="story-preview-route__debugger-section story-preview-route__runtime-console">
								<header>
									<h2>Runtime Console</h2>
									<Button
										disabled={
											!onCopyRuntimeLog ||
											!runtimeLogs.length ||
											copyState === 'pending'
										}
										onClick={copyRuntimeLog}
										size="sm"
									>
										Copy Runtime Log
									</Button>
								</header>
								{copyState === 'success' && (
									<p className="story-preview-route__debugger-empty">
										Runtime log copied.
									</p>
								)}
								{copyState === 'error' && (
									<p className="story-preview-route__debugger-empty">
										Could not copy runtime log.
									</p>
								)}
								{runtimeLogs.length ? (
									<ol className="story-preview-route__runtime-console-list">
										{runtimeLogs.map(log => (
											<li key={log.id}>
												<time>
													{new Date(log.time).toLocaleTimeString([], {
														hour: '2-digit',
														minute: '2-digit',
														second: '2-digit'
													})}
												</time>
												<strong>
													{log.level === 'log'
														? 'Log'
														: log.level === 'info'
															? 'Info'
															: log.level === 'warn'
																? 'Warning'
																: 'Error'}
												</strong>
												<span>{log.message}</span>
											</li>
										))}
									</ol>
								) : (
									<p className="story-preview-route__debugger-empty">
										No runtime log entries.
									</p>
								)}
							</section>
							{previewTarget !== 'proof' && (
								<section className="story-preview-route__debugger-section story-preview-route__runtime-controls">
									<header>
										<h2>Runtime Controls</h2>
										<span>
											{runtimeControlBusy === 'restart'
												? 'Restarting'
												: runtimeControlBusy === 'clear-state'
													? 'Clearing state'
													: 'Ready'}
										</span>
									</header>
									<div className="story-preview-route__runtime-control-actions">
										{restartAvailable && (
											<Button
												disabled={controlsDisabled}
												icon="refresh"
												onClick={restartStory}
												size="sm"
											>
												Restart
											</Button>
										)}
										<ConfirmButton
											confirmLabel="Clear State"
											confirmVariant="danger"
											disabled={controlsDisabled}
											icon={<IconEraser />}
											label="Clear State"
											onConfirm={() => void clearStoryState()}
											prompt="Clear all stored runtime data and cookies for this preview? Saved progress and format preferences in this preview will be removed. Other previews are not affected."
										/>
									</div>
									{runtimeControlNotice && (
										<p
											className="story-preview-route__runtime-control-notice"
											data-tone={runtimeControlNotice.tone}
											role={
												runtimeControlNotice.tone === 'success'
													? 'status'
													: 'alert'
											}
										>
											{runtimeControlNotice.message}
										</p>
									)}
								</section>
							)}
							{!debuggerHello ? (
								<p className="story-preview-route__debugger-waiting">
									Waiting for debugger adapter negotiation.
								</p>
							) : (
								<>
									<div className="story-preview-route__debugger-metadata">
										<span>
											Format: {debuggerHello.format}{' '}
											{debuggerHello.formatVersion}
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
																<>
																	{debuggerSnapshot.adapterId ===
																		'harlowe-3.3.9' && (
																		<p className="story-preview-route__debugger-temporary-explanation">
																			Harlowe temporary variables are
																			assignments observed during this turn;
																			scope names are supplied by Harlowe.
																		</p>
																	)}
																	<p className="story-preview-route__debugger-empty">
																		Unavailable.
																	</p>
																</>
															) : (
																<RuntimeDebuggerVariables
																	showHarloweTemporaryExplanation={
																		debuggerSnapshot.adapterId ===
																		'harlowe-3.3.9'
																	}
																	variables={
																		debuggerSnapshot.temporaryVariables
																	}
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
								</>
							)}
						</section>
					)}
				</>
			)}
			{contentSource && messageListenerReady ? (
				contentMounted ? (
					<>
						<StoryPreviewContentHost
							bridgeSessionId={bridgeSessionId}
							contentSource={contentSource}
							frameName={frameName}
							frameRef={setPreviewFrameRef}
							key={
								requiresHarloweBootstrap(
									contentSource.admission ?? NO_PREVIEW_FORMAT_ADMISSION
								) === true
									? `${bridgeSessionId}:${contentSource.generation ?? 0}`
									: bridgeSessionId
							}
							onLoad={handleContentLoad}
							reloadKey={reloadKey}
							title={title}
							viewportPreset={viewportPreset}
						/>
						{stagedContentSource && (
							<StoryPreviewContentHost
								bridgeSessionId={stagedContentSource.bridgeSessionId}
								contentSource={stagedContentSource}
								frameRef={setStagedPreviewFrameRef}
								key={
									requiresHarloweBootstrap(stagedAdmission) === true
										? `${stagedContentSource.bridgeSessionId}:${stagedContentSource.generation ?? 0}`
										: stagedContentSource.bridgeSessionId
								}
								onLoad={handleStagedContentLoad}
								reloadKey={reloadKey}
								staging
								title={stagedTitle ?? `${title} candidate`}
								viewportPreset={viewportPreset}
							/>
						)}
					</>
				) : cleanupOperation ? (
					<div
						className="story-preview-route__frame-shell"
						data-viewport={viewportPreset}
					>
						<iframe
							className="story-preview-route__frame"
							ref={setCleanupFrameRef}
							sandbox="allow-same-origin allow-scripts"
							src={cleanupOperation.url}
							title="Clearing preview state"
						/>
					</div>
				) : (
					<div className="story-preview-route__loading" role="status">
						Preparing to clear story state...
					</div>
				)
			) : (
				<div className="story-preview-route__loading" role="status">
					Loading story...
				</div>
			)}
		</main>
	);
};
