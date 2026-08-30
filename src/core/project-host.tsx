import * as React from 'react';
import type {CoreAssetInventoryEntry} from './bindings/CoreAssetInventoryEntry';
import type {CoreAssetsPage} from './bindings/CoreAssetsPage';
import type {CoreAssetsQuery} from './bindings/CoreAssetsQuery';
import {mergeKnownAssetInventory} from './asset-inventory';
import type {CoreBacklinksPage} from './bindings/CoreBacklinksPage';
import type {CoreBacklinksQuery} from './bindings/CoreBacklinksQuery';
import type {CoreContentsPage} from './bindings/CoreContentsPage';
import type {CoreContentsQuery} from './bindings/CoreContentsQuery';
import type {CoreDiagnosticsPage} from './bindings/CoreDiagnosticsPage';
import type {CoreDiagnosticsQuery} from './bindings/CoreDiagnosticsQuery';
import type {CoreDiagnosticsSummary} from './bindings/CoreDiagnosticsSummary';
import type {CoreDiagnosticsSummaryQuery} from './bindings/CoreDiagnosticsSummaryQuery';
import type {CoreDocumentPage} from './bindings/CoreDocumentPage';
import type {CoreDocumentQuery} from './bindings/CoreDocumentQuery';
import type {CoreExternalDelta} from './bindings/CoreExternalDelta';
import type {CoreExternalIngestResult} from './bindings/CoreExternalIngestResult';
import type {CoreGraphProjection} from './bindings/CoreGraphProjection';
import type {CorePassageFacts} from './bindings/CorePassageFacts';
import type {CorePassageLocalFacts} from './bindings/CorePassageLocalFacts';
import type {CorePassageDocument} from './bindings/CorePassageDocument';
import type {CoreSourceDocument} from './bindings/CoreSourceDocument';
import type {CoreSearchPage} from './bindings/CoreSearchPage';
import type {CoreSearchQuery} from './bindings/CoreSearchQuery';
import type {CoreSessionStatus} from './bindings/CoreSessionStatus';
import type {CoreStoryIndex} from './bindings/CoreStoryIndex';
import type {CoreStoryIndexOptions} from './bindings/CoreStoryIndexOptions';
import type {CoreStorySummary} from './bindings/CoreStorySummary';
import type {CoreWorkbenchDockModel} from './bindings/CoreWorkbenchDockModel';
import type {PatchBatch} from './bindings/PatchBatch';
import type {StoryCommand} from './bindings/StoryCommand';
import type {RefactorPlanApplyRequest} from './bindings/RefactorPlanApplyRequest';
import type {RefactorPlanApplyResult} from './bindings/RefactorPlanApplyResult';
import type {RefactorPlanCursor} from './bindings/RefactorPlanCursor';
import type {RefactorPlanDetailResult} from './bindings/RefactorPlanDetailResult';
import type {PlanPassageRenameRequest} from './bindings/PlanPassageRenameRequest';
import type {PlanPassageRenameResult} from './bindings/PlanPassageRenameResult';
import type {GraphProjectionQuery} from './graph-projection';
import {
	assetKindForPath,
	assetSnippet,
	normalizedAssetPath,
	projectAssetPath
} from './asset-paths';
import {normalizeGraphProjectionOptions} from './graph-projection';
import {
	applyProjectPatchBatch,
	projectPatchBatchStoryActions
} from './patch-applier';
import {
	passageToSnapshot,
	projectSnapshotFromStories,
	storyToSnapshot
} from './project-snapshot';
import {
	bootstrapStory,
	bootstrapStoryPerformanceDiagnostics,
	materializeRegisteredStory,
	metadataStory,
	registerStoryDocuments,
	registerStoryMaterializer,
	releaseBootstrapStory,
	unregisterStoryMaterializer
} from './bootstrap-stories';
import {materializeStoryFromSession} from './materialize-story';
import {
	projectStoryHydration,
	subscribeProjectStoryHydration
} from '../store/project-hydration';
import {normalizeStoryIndexOptions} from './story-index';
import type {CoreBridgeMode} from './wasm/performance';
import {
	CoreSessionMutationResult,
	WasmCoreWorkerClient,
	createWasmCoreWorkerClient
} from './wasm/twine-wasm-client';
import {
	ApplyCorePatchBatchAction,
	PassageWithText,
	StoriesActionOrThunk,
	StoriesState,
	Story,
	StoryWithDocuments,
	useStoriesContext
} from '../store/stories';
import {reducer as storiesReducer} from '../store/stories/reducer';
import {loadProjectMetadata} from '../store/project-metadata';
import type {ProjectFolderSaveHint} from '../store/persistence/project-folder-save-hints';
import type {TwineElectronWindow} from '../electron/shared';
import {
	markPerformance,
	measurePerformance,
	measurePerformanceAfterPaint,
	recordPerformanceHarnessEvent
} from '../util/performance';
import {rendererQuitQuiescence} from '../util/renderer-quit-quiescence';
import {
	workbenchBufferCoordinator,
	WorkbenchReceiptDeliveryError,
	type WorkbenchStoryMutationBarrier
} from '../util/workbench-buffer-coordinator';
import {
	RefactorRuntimeCoordinator,
	type RefactorSemanticProviderDescriptor
} from './refactor-runtime';
import {
	RefactorReviewModel,
	type RefactorReviewModelSnapshot
} from './refactor-review-model';
import {isPassageRenameRequestTooLarge} from './refactor-limits';
import {RefactorRuntimeWriterContext} from './refactor-runtime-writer';
import {
	createPersistenceCompletion,
	rejectPersistenceCompletion
} from '../store/persistence/completion';

function storiesWithDocuments(stories: Story[]): StoryWithDocuments[] {
	if (
		stories.some(story =>
			story.passages.some(
				passage =>
					!('text' in passage) ||
					typeof (passage as {text?: unknown}).text !== 'string'
			)
		)
	) {
		throw new Error(
			'A complete project snapshot requires materialized documents.'
		);
	}
	return stories as StoryWithDocuments[];
}

function waitForSubscribedCondition(
	subscribe: (listener: () => void) => () => void,
	condition: () => boolean
) {
	if (condition()) {
		return Promise.resolve();
	}

	return new Promise<void>(resolve => {
		let settled = false;
		const finishIfReady = () => {
			if (!settled && condition()) {
				settled = true;
				unsubscribe();
				resolve();
			}
		};
		const unsubscribe = subscribe(finishIfReady);

		// Close the gap between the initial check and listener registration.
		finishIfReady();
	});
}

function yieldRefactorPlannerTask() {
	const scheduler = (
		globalThis as typeof globalThis & {
			scheduler?: {yield?: () => Promise<void>};
		}
	).scheduler;

	return (
		scheduler?.yield?.() ??
		new Promise<void>(resolve => window.setTimeout(resolve, 0))
	);
}

function combineAbortSignals(...signals: Array<AbortSignal | undefined>) {
	const controller = new AbortController();
	const listeners: Array<{listener: () => void; signal: AbortSignal}> = [];
	for (const signal of signals) {
		if (!signal) continue;
		if (signal.aborted) controller.abort();
		else {
			const listener = () => controller.abort();
			signal.addEventListener('abort', listener, {once: true});
			listeners.push({listener, signal});
		}
	}
	return {
		dispose() {
			for (const {listener, signal} of listeners) {
				signal.removeEventListener('abort', listener);
			}
		},
		signal: controller.signal
	};
}

export type StoryIndexQuery = string | Partial<CoreStoryIndexOptions>;
const defaultCoreSessionId = 'library';
let nextMutationPerformanceToken = 0;

function mutationPerformanceToken() {
	nextMutationPerformanceToken += 1;
	return `mutation-${nextMutationPerformanceToken}`;
}

export type CoreProjectPatchListener = (patches: PatchBatch) => void;
export interface CoreCommandHistoryOptions {
	annotation?: string;
	effectToken?: string;
	history?: 'record' | 'skip';
	persistence?: 'save' | 'skip';
	persistenceBarrier?: boolean;
}
export type CoreCommandOptions = string | CoreCommandHistoryOptions;

export type CorePersistenceTarget =
	| {passageId: string; storyId: string; type: 'passageText'}
	| {
			passageId: string;
			storyId: string;
			type: 'passageMetadata' | 'passageLayout';
	  }
	| {storyId: string; type: 'script' | 'stylesheet'}
	| {reason: string; storyId: string; type: 'full'};

function persistenceTargetKey(target: CorePersistenceTarget) {
	if ('passageId' in target)
		return `${target.storyId}:passage:${target.passageId}:${target.type}`;
	return target.type === 'full'
		? `${target.storyId}:full`
		: `${target.storyId}:source:${target.type}`;
}

function persistenceTargetsForAction(action: ApplyCorePatchBatchAction) {
	const targets = new Map<string, CorePersistenceTarget>();
	const add = (target: CorePersistenceTarget) =>
		targets.set(persistenceTargetKey(target), target);

	for (const update of action.documentUpdates ?? []) {
		add(update);
	}
	for (const hint of action.persistenceHints ?? []) {
		add(hint);
	}
	return [...targets.values()];
}

function persistenceRetryActionForTarget(
	action: ApplyCorePatchBatchAction,
	target: CorePersistenceTarget
): ApplyCorePatchBatchAction {
	const targetKey = persistenceTargetKey(target);
	const documentUpdates = (action.documentUpdates ?? []).filter(
		update => persistenceTargetKey(update) === targetKey
	);
	const persistenceHints = (action.persistenceHints ?? []).filter(
		hint => persistenceTargetKey(hint) === targetKey
	);

	return {
		actions: [],
		documentUpdates,
		persistenceHints: persistenceHints.length > 0 ? persistenceHints : [target],
		revision: action.revision,
		sessionId: action.sessionId,
		storyIds: [target.storyId],
		type: 'applyCorePatchBatch'
	};
}

function persistenceTargetIsCoveredBy(
	covering: CorePersistenceTarget,
	target: CorePersistenceTarget
) {
	return (
		covering.storyId === target.storyId &&
		(covering.type === 'full' ||
			persistenceTargetKey(covering) === persistenceTargetKey(target))
	);
}

export type CoreHydrationLease = symbol;
export type CoreProjectReplacementLease = symbol;

export interface CoreProjectHost {
	appendHydratedProjectPassages(
		storyId: string,
		passages: PassageWithText[],
		lease?: CoreHydrationLease
	): Promise<void>;
	beginHydratedProject(
		storyId: string,
		stories: Story[],
		replacementLease?: CoreProjectReplacementLease
	): Promise<CoreHydrationLease | void>;
	acquireProjectReplacement(
		storyId: string
	): Promise<CoreProjectReplacementLease>;
	abortProjectReplacement(
		storyId: string,
		lease: CoreProjectReplacementLease
	): Promise<void>;
	finishHydratedProject(
		storyId: string,
		lease?: CoreHydrationLease
	): Promise<void>;
	abortHydratedProject(
		storyId: string,
		lease?: CoreHydrationLease
	): Promise<void>;
	applyExternalDelta(
		storyId: string,
		delta: CoreExternalDelta
	): Promise<PatchBatch | undefined>;
	applyStoryCommand(
		command: StoryCommand,
		options?: CoreCommandOptions
	): Promise<PatchBatch | undefined>;
	applyStoryCommandPersisted(
		command: StoryCommand,
		options?: CoreCommandOptions
	): Promise<PatchBatch | undefined>;
	applyRefactorPlan(
		storyId: string,
		request: RefactorPlanApplyRequest
	): Promise<RefactorPlanApplyResult>;
	/** Release the bounded review DTOs for this story after the M1 review closes. */
	closeRefactorReview(storyId: string): void;
	planPassageRename(
		storyId: string,
		request: PlanPassageRenameRequest,
		options?: {
			onProgress?: (result: PlanPassageRenameResult) => void | Promise<void>;
			signal?: AbortSignal;
		}
	): Promise<PlanPassageRenameResult>;
	retryStoryPersistence(target: CorePersistenceTarget): Promise<boolean>;
	admitProjectStories(
		stories: StoryWithDocuments[],
		options?: CoreCommandOptions
	): Promise<PatchBatch | undefined>;
	deleteProjectStories(
		storyIds: string[],
		options?: CoreCommandOptions
	): Promise<PatchBatch | undefined>;
	drainMutations(): Promise<void>;
	retireProjectStories(storyIds: string[]): Promise<void>;
	ensureSessionReady(storyId: string): Promise<void>;
	initializeHydratedProject(
		storyId: string,
		stories: Story[],
		replacementLease?: CoreProjectReplacementLease
	): Promise<void>;
	ingestExternalDelta(
		storyId: string,
		delta: CoreExternalDelta,
		options?: {force?: boolean}
	): Promise<CoreExternalIngestResult>;
	acknowledgeSaved(sessionId: string, revision: number): Promise<void>;
	redo(storyId?: string): Promise<PatchBatch | undefined>;
	isDirty(storyId?: string): boolean;
	queryGraphProjection(
		storyId: string,
		options?: GraphProjectionQuery
	): CoreGraphProjection;
	queryGraphProjectionAsync(
		storyId: string,
		options?: GraphProjectionQuery
	): Promise<CoreGraphProjection>;
	queryStoryIndex(storyId: string, options?: StoryIndexQuery): CoreStoryIndex;
	queryStoryIndexAsync(
		storyId: string,
		options?: StoryIndexQuery
	): Promise<CoreStoryIndex>;
	queryStorySummaryAsync(storyId: string): Promise<CoreStorySummary>;
	queryDiagnosticsSummaryAsync(
		storyId: string,
		options?: Partial<CoreDiagnosticsSummaryQuery>
	): Promise<CoreDiagnosticsSummary>;
	queryStoryWordCountAsync(storyId: string): Promise<number>;
	queryWorkbenchDockModelAsync(
		storyId: string
	): Promise<CoreWorkbenchDockModel>;
	queryContentsPageAsync(
		storyId: string,
		options?: Partial<CoreContentsQuery>
	): Promise<CoreContentsPage>;
	querySearchPageAsync(
		storyId: string,
		options: Partial<CoreSearchQuery>
	): Promise<CoreSearchPage>;
	queryDiagnosticsPageAsync(
		storyId: string,
		options?: Partial<CoreDiagnosticsQuery>
	): Promise<CoreDiagnosticsPage>;
	queryDocumentPageAsync(
		storyId: string,
		options?: Partial<CoreDocumentQuery>
	): Promise<CoreDocumentPage>;
	queryAssetsPageAsync(
		storyId: string,
		options?: Partial<CoreAssetsQuery>
	): Promise<CoreAssetsPage>;
	queryPassageFactsAsync(
		storyId: string,
		passageId: string
	): Promise<CorePassageFacts>;
	queryPassageLocalFactsAsync(
		storyId: string,
		passageId: string
	): Promise<CorePassageLocalFacts>;
	queryBacklinksPageAsync(
		storyId: string,
		passageId: string,
		options?: Partial<CoreBacklinksQuery>
	): Promise<CoreBacklinksPage>;
	queryPassageDocumentAsync(
		storyId: string,
		passageId: string
	): Promise<CorePassageDocument>;
	querySourceDocumentAsync(
		storyId: string,
		kind: 'script' | 'stylesheet'
	): Promise<CoreSourceDocument>;
	queryRefactorPlanDetailAsync(
		storyId: string,
		cursor: RefactorPlanCursor
	): Promise<RefactorPlanDetailResult>;
	recoverFromSnapshot(
		storyId: string,
		stories: StoryWithDocuments[],
		assets: CoreAssetInventoryEntry[],
		replacementLease?: CoreProjectReplacementLease
	): Promise<void>;
	runtimeMode(): CoreBridgeMode;
	sessionStatus(storyId?: string): CoreSessionStatus;
	subscribeToPatches(listener: CoreProjectPatchListener): () => void;
	subscribeToStatus(listener: (status: CoreSessionStatus) => void): () => void;
	undo(storyId?: string): Promise<PatchBatch | undefined>;
}

export const CoreProjectHostContext = React.createContext<
	CoreProjectHost | undefined
>(undefined);

const sharedAssetInventoryByStory = new Map<
	string,
	CoreAssetInventoryEntry[]
>();
const sharedAssetInventoryScanCompleteByStory = new Set<string>();
const emptyAssetInventory: CoreAssetInventoryEntry[] = [];
const assetInventoryListeners = new Set<() => void>();
let assetInventoryVersion = 0;

export function knownAssetInventoryForStory(storyId: string) {
	return sharedAssetInventoryByStory.get(storyId) ?? emptyAssetInventory;
}

export function knownAssetInventoryScanCompleteForStory(storyId: string) {
	return sharedAssetInventoryScanCompleteByStory.has(storyId);
}

export function replaceKnownAssetInventoryForStory(
	storyId: string,
	assets: CoreAssetInventoryEntry[],
	options: {assetScanComplete?: boolean} = {}
) {
	sharedAssetInventoryByStory.set(storyId, assets);

	if (options.assetScanComplete ?? true) {
		sharedAssetInventoryScanCompleteByStory.add(storyId);
	} else {
		sharedAssetInventoryScanCompleteByStory.delete(storyId);
	}

	assetInventoryVersion++;

	for (const listener of assetInventoryListeners) {
		listener();
	}
}

export function subscribeKnownAssetInventory(listener: () => void) {
	assetInventoryListeners.add(listener);

	return () => {
		assetInventoryListeners.delete(listener);
	};
}

export function useKnownAssetInventoryVersion() {
	const [version, setVersion] = React.useState(assetInventoryVersion);

	React.useEffect(
		() => subscribeKnownAssetInventory(() => setVersion(assetInventoryVersion)),
		[]
	);

	return version;
}

export function useKnownAssetInventoryForStory(storyId: string | undefined) {
	const version = useKnownAssetInventoryVersion();

	return React.useMemo(
		() =>
			storyId ? knownAssetInventoryForStory(storyId) : emptyAssetInventory,
		[storyId, version]
	);
}

type UndoableDispatch = (
	action: StoriesActionOrThunk,
	annotation?: string
) => void;

type CoreProjectSessionClient = Pick<
	WasmCoreWorkerClient,
	| 'acknowledgeSaved'
	| 'apply'
	| 'applyExternalDelta'
	| 'appendProjectBootstrap'
	| 'abortProjectBootstrap'
	| 'beginProjectBootstrap'
	| 'cachedContentsPage'
	| 'ingestExternalDelta'
	| 'cachedGraphProjection'
	| 'cachedStoryIndex'
	| 'enabled'
	| 'lastGraphProjection'
	| 'mode'
	| 'queryGraphProjection'
	| 'queryDiagnosticsSummary'
	| 'queryStoryIndex'
	| 'queryStorySummary'
	| 'queryStoryWordCount'
	| 'queryContentsPage'
	| 'querySearchPage'
	| 'queryDiagnosticsPage'
	| 'queryDocumentPage'
	| 'queryAssetsPage'
	| 'queryBacklinksPage'
	| 'queryPassageFacts'
	| 'queryPassageLocalFacts'
	| 'queryPassageDocument'
	| 'querySourceDocument'
	| 'redo'
	| 'finishProjectBootstrap'
	| 'replaceProject'
	| 'undo'
> & {
	applyRefactorPlan?: WasmCoreWorkerClient['applyRefactorPlan'];
	syncRefactorRuntime?: WasmCoreWorkerClient['syncRefactorRuntime'];
	beginPassageRenamePlan?: WasmCoreWorkerClient['beginPassageRenamePlan'];
	continuePassageRenamePlan?: WasmCoreWorkerClient['continuePassageRenamePlan'];
	cancelPassageRenamePlan?: WasmCoreWorkerClient['cancelPassageRenamePlan'];
	queryRefactorPlanDetail?: WasmCoreWorkerClient['queryRefactorPlanDetail'];
	abortProjectBootstrap?: WasmCoreWorkerClient['abortProjectBootstrap'];
	dispose?(): void;
	removeSession?(sessionId: string): Promise<unknown>;
	applySync?(
		command: StoryCommand,
		revision: number,
		history?: 'record' | 'skip'
	): CoreSessionMutationResult;
	replaceProjectSync?(
		snapshot: ReturnType<typeof projectSnapshotFromStories>,
		revision: number
	): void;
};

export interface StoreCoreProjectHostOptions {
	onRefactorCommitted?(storyId: string): void;
	sessionId?: string;
	wasmClient?: CoreProjectSessionClient;
}

const defaultContentsQuery: CoreContentsQuery = {
	cursor: null,
	filter: 'all',
	limit: 100,
	query: null,
	sort: 'group'
};
const defaultDiagnosticsQuery: CoreDiagnosticsQuery = {
	cursor: null,
	limit: 100,
	severity: null
};
const defaultDiagnosticsSummaryQuery: CoreDiagnosticsSummaryQuery = {
	dismissedIds: []
};
const defaultDocumentQuery: CoreDocumentQuery = {cursor: null, limit: 250};
const defaultAssetsQuery: CoreAssetsQuery = {
	cursor: null,
	limit: 100,
	query: null
};
const defaultBacklinksQuery: CoreBacklinksQuery = {cursor: null, limit: 8};
const defaultSearchQuery: CoreSearchQuery = {
	cursor: null,
	fuzzy: false,
	includePassageNames: true,
	includePassageText: true,
	includeScript: true,
	includeStylesheet: true,
	limit: 100,
	matchCase: false,
	query: '',
	replacement: null,
	useRegexes: false
};

function storyCommandAnnotation(command: StoryCommand) {
	switch (command.type) {
		case 'createPassage':
		case 'restorePassages':
			return 'undoChange.newPassage';
		case 'deletePassages':
			return 'undoChange.deletePassage';
		case 'movePassages':
		case 'saveGeneratedLayout':
			return 'undoChange.movePassage';
		case 'renamePassage':
			return 'undoChange.renamePassage';
		case 'renameStory':
			return 'undoChange.renameStory';
		case 'setPassageTags':
			return 'undoChange.changeTags';
		case 'setStartPassage':
			return 'undoChange.startPassage';
		case 'setStoryFormat':
		case 'setStorySnapToGrid':
		case 'setStoryZoom':
			return 'undoChange.changeStoryDetails';
		case 'updatePassageText':
		case 'updateStoryScript':
		case 'updateStoryStylesheet':
			return 'undoChange.editPassage';
		case 'deleteAsset':
		case 'importAsset':
		case 'insertAssetSnippet':
		case 'renameAsset':
		case 'replaceAsset':
			return 'undoChange.editPassage';
		default:
			return undefined;
	}
}

function normalizeCommandOptions(
	options: CoreCommandOptions | undefined
): Required<Pick<CoreCommandHistoryOptions, 'history'>> &
	CoreCommandHistoryOptions {
	return typeof options === 'string'
		? {annotation: options, history: 'record'}
		: {
				annotation: options?.annotation,
				effectToken: options?.effectToken,
				history: options?.history ?? 'record',
				persistence: options?.persistence,
				persistenceBarrier: options?.persistenceBarrier
			};
}

function projectFolderSaveHintsForPatchBatch(batch: PatchBatch) {
	const hints = new Map<string, ProjectFolderSaveHint>();

	function addFull(storyId: string | undefined, reason: string) {
		if (!storyId) {
			return;
		}
		hints.set(storyId, {reason, storyId, type: 'full'});
	}

	for (const patch of batch.patches) {
		switch (patch.type) {
			case 'passageUpdated':
				if (patch.changes.layout !== null) {
					const existing = hints.get(patch.story_id);

					if (existing?.type !== 'full') {
						hints.set(`${patch.story_id}:${patch.passage_id}:layout`, {
							passageId: patch.passage_id,
							storyId: patch.story_id,
							type: 'passageLayout'
						});
					}
				}
				if (patch.changes.text !== null) {
					const existing = hints.get(patch.story_id);

					if (existing?.type !== 'full') {
						hints.set(`${patch.story_id}:${patch.passage_id}`, {
							passageId: patch.passage_id,
							storyId: patch.story_id,
							type: 'passageText'
						});
					}
				}
				if (patch.changes.name !== null || patch.changes.tags !== null) {
					hints.set(`${patch.story_id}:${patch.passage_id}:metadata`, {
						passageId: patch.passage_id,
						storyId: patch.story_id,
						type: 'passageMetadata'
					});
				}
				break;

			case 'passageCreated':
			case 'passageDeleted':
			case 'startPassageChanged':
			case 'storyCreated':
			case 'storyDeleted':
			case 'storyMetadataUpdated':
			case 'projectMetadataUpdated':
			case 'projectSnapshotReplaced':
				addFull('story_id' in patch ? patch.story_id : undefined, patch.type);
				break;
			case 'storyScriptUpdated':
				if (hints.get(patch.story_id)?.type !== 'full') {
					hints.set(`${patch.story_id}:script`, {
						storyId: patch.story_id,
						type: 'script'
					});
				}
				break;
			case 'storyStylesheetUpdated':
				if (hints.get(patch.story_id)?.type !== 'full') {
					hints.set(`${patch.story_id}:stylesheet`, {
						storyId: patch.story_id,
						type: 'stylesheet'
					});
				}
				break;
		}
	}

	const fullStoryIds = new Set(
		[...hints.values()].flatMap(hint =>
			hint.type === 'full' ? [hint.storyId] : []
		)
	);

	return [...hints.values()].filter(
		hint => hint.type === 'full' || !fullStoryIds.has(hint.storyId)
	);
}

function assetInventoryEntry(
	path: string,
	options: {previewUrl?: string | null} = {}
): CoreAssetInventoryEntry {
	const normalizedPath = normalizedAssetPath(path);
	const kind = assetKindForPath(path);
	const previewUrl = options.previewUrl ?? null;

	return {
		durationMs: null,
		exists: true,
		height: null,
		kind,
		missing: false,
		modifiedAt: new Date().toISOString(),
		normalizedPath,
		path,
		previewUrl,
		publish: {
			copy: true,
			outputPath: path,
			reason: 'Copy asset into published output'
		},
		referenceCount: 0,
		references: [],
		sizeBytes: null,
		snippet: assetSnippet(path, kind),
		thumbnailUrl: kind === 'image' ? previewUrl : null,
		unused: true,
		width: null
	};
}

function emptyGraphStats() {
	return {
		brokenLinks: 0,
		emptyPassages: 0,
		links: 0,
		orphanPassages: 0,
		passages: 0,
		resolvedLinks: 0,
		selfLinks: 0,
		taggedPassages: 0,
		unreachablePassages: 0
	};
}

export function emptyGraphProjection(): CoreGraphProjection {
	return {
		bounds: null,
		edges: [],
		layoutState: 'missing',
		nodes: [],
		stats: emptyGraphStats()
	};
}

export function emptyStoryIndex(storyId: string): CoreStoryIndex {
	return {
		assetInventory: [],
		assets: [],
		contents: [],
		diagnostics: [],
		files: [],
		graph: emptyGraphStats(),
		replacePreviews: [],
		searchHits: [],
		storyId,
		symbols: [],
		tagEntries: [],
		tags: []
	};
}

function emptyStorySummary(storyId: string): CoreStorySummary {
	return {
		assetCount: 0,
		characterCount: 0,
		diagnosticCount: 0,
		errorCount: 0,
		graph: emptyGraphStats(),
		missingAssetCount: 0,
		passageCount: 0,
		revision: 0,
		storyId,
		tagCount: 0,
		warningCount: 0,
		wordCount: 0
	};
}

function emptyDiagnosticsSummary(storyId: string): CoreDiagnosticsSummary {
	return {
		diagnosticCount: 0,
		dismissedCount: 0,
		errorCount: 0,
		infoCount: 0,
		revision: 0,
		storyId,
		warningCount: 0
	};
}

function emptyContentsPage(storyId: string): CoreContentsPage {
	return {
		assets: [],
		entries: [],
		facets: {
			all: 0,
			asset: 0,
			diagnostics: 0,
			entryPoint: 0,
			group: 0,
			intelligenceComplete: false,
			metadata: 0,
			passage: 0,
			problems: 0,
			script: 0,
			stylesheet: 0,
			tag: 0,
			variable: 0
		},
		nextCursor: null,
		revision: 0,
		storyId,
		totalCount: 0
	};
}

export class StoreCoreProjectHost implements CoreProjectHost {
	private assetInventoryByStory = sharedAssetInventoryByStory;
	private dirty = false;
	private dispatch: UndoableDispatch;
	private listeners = new Set<CoreProjectPatchListener>();
	private mutationQueue: Promise<void> = Promise.resolve();
	private ownsWasmClient: boolean;
	private redoEffects: Array<string | undefined> = [];
	private readonly refactorRuntime = new RefactorRuntimeCoordinator();
	private readonly onRefactorCommitted: ((storyId: string) => void) | undefined;
	private statusListeners = new Set<(status: CoreSessionStatus) => void>();
	private transactionTokens = new WeakMap<PatchBatch, number>();
	private undoEffects: Array<string | undefined> = [];
	private pendingSessionPatchDispatches = 0;
	private pendingAdmissionStories = new Map<string, Story>();
	private replacementReservations = new Set<CoreProjectReplacementLease>();
	private persistenceCompletions = new WeakMap<PatchBatch, Promise<void>>();
	private persistenceActions = new WeakMap<
		PatchBatch,
		{
			action: ApplyCorePatchBatchAction;
			annotation: string | undefined;
		}
	>();
	private failedPersistenceByTarget = new Map<
		string,
		{
			action: ApplyCorePatchBatchAction;
			annotation: string | undefined;
			inFlight?: Promise<void>;
			targets: CorePersistenceTarget[];
		}
	>();
	private stories: StoriesState;
	private status: CoreSessionStatus = {
		canRedo: false,
		canUndo: false,
		dirty: false,
		redoKind: null,
		revision: 1,
		undoKind: null
	};
	private transactionId = BigInt(0);
	private sessionId: string;
	private sessionOwnedDocumentStories = new Set<string>();
	private wasmClient: CoreProjectSessionClient;
	private wasmProjectRevision = 1;
	private wasmProjectReplaceRevision = -1;
	private wasmProjectReplacePromise?: Promise<unknown>;

	constructor(
		stories: StoriesState,
		dispatch: UndoableDispatch,
		options: StoreCoreProjectHostOptions = {}
	) {
		this.dispatch = dispatch;
		this.stories = stories;
		for (const story of stories) {
			this.sessionOwnedDocumentStories.add(story.id);
		}
		this.sessionId = options.sessionId ?? defaultCoreSessionId;
		this.onRefactorCommitted = options.onRefactorCommitted;
		this.ownsWasmClient = !options.wasmClient;
		this.wasmClient = options.wasmClient ?? createWasmCoreWorkerClient();
	}

	async applyStoryCommand(
		command: StoryCommand,
		options?: CoreCommandOptions
	): Promise<PatchBatch | undefined> {
		if (this.wasmClient.applySync && this.wasmClient.replaceProjectSync) {
			const normalized = normalizeCommandOptions(options);
			const revision = this.status.revision;
			const performanceToken = mutationPerformanceToken();

			markPerformance('mutation-submit');
			markPerformance(`mutation-submit-${performanceToken}`);
			const batch = this.applyStoryCommandThroughSyncSession(
				command,
				normalized,
				performanceToken
			);
			if (
				normalized.history === 'record' &&
				this.status.revision !== revision
			) {
				this.transactionTokens.set(batch, Number(batch.transactionId));
			}

			markPerformance('mutation-patch-applied');
			measurePerformance(
				'mutation-round-trip',
				'mutation-submit',
				'mutation-patch-applied'
			);
			measurePerformanceAfterPaint('mutation-to-paint', 'mutation-submit');
			measurePerformanceAfterPaint(
				`mutation-to-paint-${performanceToken}`,
				`mutation-submit-${performanceToken}`
			);
			recordPerformanceHarnessEvent('mutation-applied', {
				command: command.type,
				patches: batch?.patches.length ?? 0,
				performanceToken,
				revision: this.status.revision
			});
			return batch;
		}

		return (await this.applyStoryCommandTracked(command, options)).batch;
	}

	async applyStoryCommandPersisted(
		command: StoryCommand,
		options?: CoreCommandOptions
	) {
		const normalized = normalizeCommandOptions(options);
		const batch = await this.applyStoryCommand(command, {
			...normalized,
			persistence: 'save',
			persistenceBarrier: true
		});

		if (!batch) {
			throw new Error('The Core mutation did not produce a persistence batch.');
		}
		try {
			await this.awaitPersistenceCompletion(batch);
			this.clearFailedPersistenceThrough(batch);
		} catch (error) {
			this.registerFailedPersistence(batch);
			throw error;
		}
		return batch;
	}

	private registerFailedPersistence(batch: PatchBatch, grouped = false) {
		const retryable = this.persistenceActions.get(batch);

		if (!retryable) {
			return;
		}
		const targets = persistenceTargetsForAction(retryable.action);
		const groupedReceipt = grouped
			? {
					action: {...retryable.action, actions: []},
					annotation: retryable.annotation,
					targets
				}
			: undefined;
		for (const target of targets) {
			const receipt = groupedReceipt ?? {
				action: persistenceRetryActionForTarget(retryable.action, target),
				annotation: retryable.annotation,
				targets: grouped ? targets : [target]
			};
			const targetKey = persistenceTargetKey(target);
			const existing = this.failedPersistenceByTarget.get(targetKey);

			if (
				!existing ||
				(existing.action.revision ?? 0) <= (receipt.action.revision ?? 0)
			) {
				this.failedPersistenceByTarget.set(targetKey, receipt);
			}
		}
	}

	async retryStoryPersistence(target: CorePersistenceTarget) {
		const targetKey = persistenceTargetKey(target);
		const retryable = this.failedPersistenceByTarget.get(targetKey);

		if (!retryable) {
			return false;
		}
		if (!retryable.inFlight) {
			retryable.inFlight = this.retryPersistenceAction(retryable).finally(
				() => {
					retryable.inFlight = undefined;
				}
			);
		}
		await retryable.inFlight;
		return true;
	}

	private async retryPersistenceAction(retryable: {
		action: ApplyCorePatchBatchAction;
		annotation: string | undefined;
		targets: CorePersistenceTarget[];
	}) {
		const currentTargets = retryable.targets.filter(
			target =>
				this.failedPersistenceByTarget.get(persistenceTargetKey(target)) ===
				retryable
		);
		if (currentTargets.length === 0) return;
		const action = {
			...retryable.action,
			documentUpdates: (retryable.action.documentUpdates ?? []).filter(update =>
				currentTargets.some(target =>
					persistenceTargetIsCoveredBy(target, update)
				)
			),
			persistenceHints: (retryable.action.persistenceHints ?? []).filter(hint =>
				currentTargets.some(target =>
					persistenceTargetIsCoveredBy(target, hint)
				)
			)
		};
		const persistence = createPersistenceCompletion();
		const retryAction = {
			...action,
			persistenceToken: persistence.token
		};

		try {
			this.dispatch(retryAction, retryable.annotation);
		} catch (error) {
			try {
				rejectPersistenceCompletion(persistence.token, error);
			} catch {
				// The reducer may have consumed the token before throwing. Preserve the
				// original dispatch failure either way.
			}
			throw error;
		}
		await persistence.completion;
		for (const target of currentTargets) {
			const targetKey = persistenceTargetKey(target);
			if (this.failedPersistenceByTarget.get(targetKey) === retryable) {
				this.failedPersistenceByTarget.delete(targetKey);
			}
		}
	}

	private clearFailedPersistenceThrough(batch: PatchBatch) {
		const persisted = this.persistenceActions.get(batch);

		if (!persisted) {
			return;
		}
		this.clearFailedPersistenceTargets(
			persistenceTargetsForAction(persisted.action),
			persisted.action.revision ?? 0
		);
	}

	private clearFailedPersistenceTargets(
		targets: CorePersistenceTarget[],
		persistedRevision: number
	) {
		for (const [targetKey, failed] of this.failedPersistenceByTarget) {
			if ((failed.action.revision ?? 0) > persistedRevision) continue;
			const failedTarget = failed.targets.find(
				target => persistenceTargetKey(target) === targetKey
			);
			if (
				failedTarget &&
				targets.some(target =>
					persistenceTargetIsCoveredBy(target, failedTarget)
				)
			) {
				this.failedPersistenceByTarget.delete(targetKey);
			}
		}
	}

	private async awaitPersistenceCompletion(batch: PatchBatch | undefined) {
		if (!batch) {
			throw new Error('The Core mutation did not produce a persistence batch.');
		}
		const completion = this.persistenceCompletions.get(batch);

		if (!completion) {
			throw new Error(
				'The Core mutation did not schedule project persistence.'
			);
		}
		await completion;
	}

	async admitProjectStories(
		stories: StoryWithDocuments[],
		options?: CoreCommandOptions,
		retainOwnershipOnFailure = false
	) {
		if (stories.length === 0) {
			return undefined;
		}
		const storyIds = new Set<string>();

		for (const story of stories) {
			if (
				storyIds.has(story.id) ||
				this.sessionOwnedDocumentStories.has(story.id)
			) {
				throw new Error(
					`Story "${story.id}" already belongs to this core project session.`
				);
			}
			storyIds.add(story.id);
		}

		const normalized = normalizeCommandOptions(options);
		let appliedBatch: PatchBatch | undefined;

		try {
			for (const story of stories) {
				registerStoryDocuments(story);
				this.sessionOwnedDocumentStories.add(story.id);
				this.pendingAdmissionStories.set(story.id, story);
			}
			appliedBatch = await this.applyStoryCommand(
				{
					commands: stories.map(story => ({
						story: storyToSnapshot(story),
						type: 'createStory' as const
					})),
					type: 'batch'
				},
				options
			);
			if (normalized.persistenceBarrier) {
				await this.awaitPersistenceCompletion(appliedBatch);
			}
			this.stories = [
				...this.stories.filter(
					story => !stories.some(candidate => candidate.id === story.id)
				),
				...stories
			];
			for (const story of stories) {
				releaseBootstrapStory(story.id);
				this.pendingAdmissionStories.delete(story.id);
			}
			return appliedBatch;
		} catch (error) {
			let rollbackError: unknown;

			if (appliedBatch) {
				try {
					await this.applyStoryCommand(
						{
							commands: stories.map(story => ({
								story_id: story.id,
								type: 'deleteStory' as const
							})),
							type: 'batch'
						},
						{history: 'skip', persistence: 'skip'}
					);
				} catch (rollbackFailure) {
					rollbackError = rollbackFailure;
				}
			}
			if (rollbackError) {
				this.stories = [
					...this.stories.filter(
						story => !stories.some(candidate => candidate.id === story.id)
					),
					...stories
				];
				if (retainOwnershipOnFailure) {
					throw Object.assign(
						new AggregateError(
							[error, rollbackError],
							'Deleted project recovery failed and its Core ownership remains reserved.',
							{cause: error}
						),
						{code: 'CORE_DELETION_RECOVERY_INCOMPLETE'}
					);
				}
				throw Object.assign(
					new AggregateError(
						[error, rollbackError],
						'Project admission persistence failed and the Core admission could not be rolled back.',
						{cause: error}
					),
					{code: 'CORE_ADMISSION_ROLLBACK_INCOMPLETE'}
				);
			}
			if (retainOwnershipOnFailure) {
				this.stories = [
					...this.stories.filter(
						story => !stories.some(candidate => candidate.id === story.id)
					),
					...stories
				];
				throw Object.assign(
					error instanceof Error ? error : new Error(String(error)),
					{
						code: 'CORE_DELETION_RECOVERY_INCOMPLETE'
					}
				);
			}
			for (const story of stories) {
				this.sessionOwnedDocumentStories.delete(story.id);
				this.pendingAdmissionStories.delete(story.id);
				releaseBootstrapStory(story.id);
			}
			throw error;
		}
	}

	async deleteProjectStories(storyIds: string[], options?: CoreCommandOptions) {
		if (storyIds.length === 0) {
			return undefined;
		}
		const normalized = normalizeCommandOptions(options);
		const originalStories = normalized.persistenceBarrier
			? await Promise.all(
					storyIds.map(async storyId => {
						const story = this.stories.find(
							candidate => candidate.id === storyId
						);

						if (!story) {
							throw new Error(
								`No story snapshot is available for project deletion "${storyId}".`
							);
						}
						return materializeRegisteredStory(story);
					})
				)
			: [];
		let appliedBatch: PatchBatch | undefined;

		try {
			appliedBatch = await this.applyStoryCommand(
				{
					commands: storyIds.map(storyId => ({
						story_id: storyId,
						type: 'deleteStory' as const
					})),
					type: 'batch'
				},
				options
			);
			if (normalized.persistenceBarrier) {
				await this.awaitPersistenceCompletion(appliedBatch);
			}
			this.stories = this.stories.filter(story => !storyIds.includes(story.id));
			for (const storyId of storyIds) {
				this.sessionOwnedDocumentStories.delete(storyId);
				releaseBootstrapStory(storyId);
			}
			return appliedBatch;
		} catch (error) {
			if (!appliedBatch) {
				throw error;
			}

			for (const story of originalStories) {
				registerStoryDocuments(story);
				this.pendingAdmissionStories.set(story.id, story);
			}
			this.stories = [
				...this.stories.filter(
					story => !originalStories.some(candidate => candidate.id === story.id)
				),
				...originalStories
			];
			try {
				await this.applyStoryCommand(
					{
						commands: originalStories.map(story => ({
							story: storyToSnapshot(story),
							type: 'createStory' as const
						})),
						type: 'batch'
					},
					{history: 'skip', persistence: 'skip'}
				);
			} catch (rollbackError) {
				throw Object.assign(
					new AggregateError(
						[error, rollbackError],
						'Project deletion persistence failed and the Core deletion could not be rolled back.',
						{cause: error}
					),
					{code: 'CORE_DELETION_ROLLBACK_INCOMPLETE'}
				);
			}
			for (const story of originalStories) {
				this.pendingAdmissionStories.delete(story.id);
				releaseBootstrapStory(story.id);
			}
			throw error;
		}
	}

	async retireProjectStories(storyIds: string[]) {
		for (const storyId of storyIds) {
			this.sessionOwnedDocumentStories.delete(storyId);
			releaseBootstrapStory(storyId);
		}
		this.dispatch({storyIds, type: 'retireProjectStories'});
	}

	async applyStoryCommandTracked(
		command: StoryCommand,
		options?: CoreCommandOptions
	): Promise<{batch: PatchBatch | undefined; transactionId?: number}> {
		const normalized = normalizeCommandOptions(options);
		const performanceToken = mutationPerformanceToken();
		markPerformance('mutation-submit');
		markPerformance(`mutation-submit-${performanceToken}`);
		const applyTracked = async () => {
			const revision = this.status.revision;
			const batch =
				this.wasmClient.applySync && this.wasmClient.replaceProjectSync
					? this.applyStoryCommandThroughSyncSession(
							command,
							normalized,
							performanceToken
						)
					: await this.applyStoryCommandThroughWasm(
							command,
							normalized,
							performanceToken
						);

			return {
				batch,
				transactionId:
					normalized.history === 'record' &&
					this.status.revision !== revision &&
					batch
						? Number(batch.transactionId)
						: undefined
			};
		};
		const tracked =
			this.wasmClient.applySync && this.wasmClient.replaceProjectSync
				? await applyTracked()
				: await this.enqueueMutation(applyTracked);

		markPerformance('mutation-patch-applied');
		measurePerformance(
			'mutation-round-trip',
			'mutation-submit',
			'mutation-patch-applied'
		);
		measurePerformanceAfterPaint('mutation-to-paint', 'mutation-submit');
		measurePerformanceAfterPaint(
			`mutation-to-paint-${performanceToken}`,
			`mutation-submit-${performanceToken}`
		);
		recordPerformanceHarnessEvent('mutation-applied', {
			command: command.type,
			patches: tracked.batch?.patches.length ?? 0,
			performanceToken,
			revision: this.status.revision
		});
		if (tracked.batch && tracked.transactionId !== undefined) {
			this.transactionTokens.set(tracked.batch, tracked.transactionId);
		}
		return tracked;
	}

	transactionTokenFor(batch: PatchBatch | undefined) {
		return batch ? this.transactionTokens.get(batch) : undefined;
	}

	// Review DTO ownership belongs to the project-scoped router. A direct store
	// host has no product review surface to release.
	closeRefactorReview() {}

	recordRefactorExternalSession(
		storyIds: readonly string[],
		state: import('./bindings/RefactorExternalPrecondition').RefactorExternalPrecondition
	) {
		return this.refactorRuntime.recordExternalSession(storyIds, state);
	}

	clearRefactorExternalSession(
		storyIds: readonly string[],
		sessionInstanceId: string
	) {
		return this.refactorRuntime.clearExternalSession(
			storyIds,
			sessionInstanceId
		);
	}

	registerRefactorSemanticProvider(
		storyId: string,
		descriptor: RefactorSemanticProviderDescriptor
	) {
		return this.refactorRuntime.registerSemanticProvider(storyId, descriptor);
	}

	async queryRefactorPlanDetailAsync(
		_storyId: string,
		cursor: RefactorPlanCursor
	): Promise<RefactorPlanDetailResult> {
		if (!this.wasmClient.queryRefactorPlanDetail) {
			throw new Error('The Rust refactor-plan detail boundary is unavailable.');
		}
		const revision = await this.ensureWasmProjectSession();
		return this.wasmClient.queryRefactorPlanDetail(
			this.sessionId,
			cursor,
			revision
		);
	}

	async applyRefactorPlan(
		storyId: string,
		request: RefactorPlanApplyRequest
	): Promise<RefactorPlanApplyResult> {
		if (
			!this.wasmClient.applyRefactorPlan ||
			!this.wasmClient.syncRefactorRuntime
		) {
			throw new Error('The Rust refactor-plan apply boundary is unavailable.');
		}
		let barrier: WorkbenchStoryMutationBarrier;
		try {
			barrier = await workbenchBufferCoordinator.acquireStoriesMutationBarrier([
				...this.sessionOwnedDocumentStories
			]);
		} catch {
			return {
				failure: {
					code: 'buffer-changed',
					message: 'Workbench buffers could not be flushed for refactoring.'
				},
				type: 'failure'
			};
		}
		const runtimeLease = await this.refactorRuntime.acquireLease();
		let persistence: Promise<void> | undefined;
		let appliedBatch: PatchBatch | undefined;
		let result: RefactorPlanApplyResult;
		try {
			result = await this.enqueueMutation(async () => {
				const synchronized = await this.syncStableRefactorRuntime(
					storyId,
					barrier
				);
				if ('failure' in synchronized)
					return {failure: synchronized.failure, type: 'failure'};
				const {epoch, revision} = synchronized;
				const result = await this.wasmClient.applyRefactorPlan!(
					this.sessionId,
					request,
					epoch,
					revision
				);

				if (result.type === 'applied') {
					const receiptEdits = result.receipt?.textEdits ?? [];
					const editsBySource = new Map<string, typeof receiptEdits>();
					for (const edit of receiptEdits) {
						const sourceKey = `${edit.source.storyId}:${edit.source.sourceKind}:${edit.source.sourceId}`;
						const edits = editsBySource.get(sourceKey) ?? [];
						edits.push(edit);
						editsBySource.set(sourceKey, edits);
					}
					for (const edits of editsBySource.values()) {
						const first = edits[0];
						if (first.source.span.encoding !== 'utf16-code-units') {
							throw new Error('Unsupported refactor receipt offset encoding.');
						}
						const delivered = barrier.deliverTextEdits(
							{
								storyId: first.source.storyId,
								sourceId: first.source.sourceId,
								sourceKind: first.source.sourceKind
							},
							edits.map(edit => ({
								end: edit.source.span.end,
								expectedText: edit.expectedText,
								replacementText: edit.replacementText,
								start: edit.source.span.start
							}))
						);
						if (delivered === 'rejected') {
							// Core is authoritative and has committed. Patch the renderer immediately
							// before surfacing a typed failure so no caller sees a false success.
							this.applySessionPatchBatch(
								result.batch,
								'undoChange.changeStoryDetails',
								result.revision,
								result.status,
								undefined,
								'save',
								true
							);
							throw new WorkbenchReceiptDeliveryError({
								storyId: first.source.storyId,
								sourceId: first.source.sourceId,
								sourceKind: first.source.sourceKind
							});
						}
					}
					this.applySessionPatchBatch(
						result.batch,
						'undoChange.changeStoryDetails',
						result.revision,
						result.status,
						undefined,
						'save',
						true
					);
					this.recordHistoryEffect(undefined);
					persistence = this.awaitPersistenceCompletion(result.batch);
					appliedBatch = result.batch;
					this.onRefactorCommitted?.(storyId);
					return {
						batch: result.batch,
						receipt: result.receipt ?? {textEdits: []},
						type: 'applied'
					};
				}
				return {failure: result.failure, type: 'failure'};
			});
		} finally {
			barrier.release();
			runtimeLease.release();
		}
		// The commit is visible and editor/runtime barriers are open before waiting.
		if (persistence) {
			try {
				await persistence;
				this.clearFailedPersistenceThrough(appliedBatch!);
			} catch (error) {
				// A refactor is one durable document transaction: retry every still-current
				// target from this receipt without invoking Rust again.
				this.registerFailedPersistence(appliedBatch!, true);
				throw error;
			}
		}
		return result!;
	}

	async planPassageRename(
		storyId: string,
		request: PlanPassageRenameRequest,
		options: {
			onProgress?: (result: PlanPassageRenameResult) => void | Promise<void>;
			signal?: AbortSignal;
		} = {}
	): Promise<PlanPassageRenameResult> {
		if (isPassageRenameRequestTooLarge(request)) {
			return {
				failure: {
					code: 'plan-too-large',
					message:
						'The passage rename request exceeds the 64 KiB request limit.'
				},
				type: 'failure'
			};
		}
		if (
			!this.wasmClient.syncRefactorRuntime ||
			!this.wasmClient.beginPassageRenamePlan ||
			!this.wasmClient.continuePassageRenamePlan ||
			!this.wasmClient.cancelPassageRenamePlan
		) {
			throw new Error(
				'The Rust passage-rename planning boundary is unavailable.'
			);
		}
		let barrier: WorkbenchStoryMutationBarrier;
		try {
			barrier = await workbenchBufferCoordinator.acquireStoriesMutationBarrier([
				...this.sessionOwnedDocumentStories
			]);
		} catch {
			return {
				failure: {
					code: 'buffer-changed',
					message: 'Workbench buffers could not be flushed for refactoring.'
				},
				type: 'failure'
			};
		}
		const runtimeLease = await this.refactorRuntime.acquireLease();
		let task: {taskId: string} | undefined;
		let epoch: number;
		let revision: number;
		try {
			const begun = await this.enqueueMutation(async () => {
				const synchronized = await this.syncStableRefactorRuntime(
					storyId,
					barrier
				);
				if ('failure' in synchronized)
					return {failure: synchronized.failure, type: 'failure'} as const;
				({epoch, revision} = synchronized);
				return this.wasmClient.beginPassageRenamePlan!(
					this.sessionId,
					request,
					epoch,
					revision
				);
			});
			if (begun.type !== 'begun')
				return {failure: begun.failure, type: 'failure'};
			task = begun.task;
		} finally {
			barrier.release();
			runtimeLease.release();
		}
		let completed = false;
		let cancellationAttempted = false;
		const cancel = async () => {
			cancellationAttempted = true;
			await this.wasmClient.cancelPassageRenamePlan!(this.sessionId, task!);
			return {type: 'cancelled'} as const;
		};
		try {
			for (;;) {
				if (options.signal?.aborted) {
					return cancel();
				}
				const result = await this.wasmClient.continuePassageRenamePlan(
					this.sessionId,
					task!
				);
				// A complete Rust response has already released its native task. Mark it
				// before invoking observers so an observer failure cannot attempt to
				// cancel a completed plan (while pending observer failures still do).
				if (result.type !== 'pending') completed = true;
				await options.onProgress?.(result);
				if (result.type !== 'pending') {
					return result;
				}
				await yieldRefactorPlannerTask();
				if (options.signal?.aborted) return cancel();
			}
		} finally {
			if (task && !completed && !cancellationAttempted) {
				try {
					await cancel();
				} catch {
					// Preserve the original planning/callback/yield failure.
				}
			}
		}
	}

	private async syncStableRefactorRuntime(
		storyId: string,
		barrier: WorkbenchStoryMutationBarrier
	): Promise<
		| {epoch: number; revision: number}
		| {
				failure: {
					code: 'buffer-changed' | 'persistence-conflict' | 'provider-changed';
					message: string;
				};
		  }
	> {
		const maxAttempts = 3;
		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			if (!barrier.isCurrent()) {
				return {
					failure: {
						code: 'buffer-changed',
						message:
							'Workbench buffers changed while preparing refactor runtime.'
					}
				};
			}
			const revision = await this.ensureWasmProjectSession();
			const runtime = this.refactorRuntime.runtimeState(
				storyId,
				revision,
				barrier.preconditions
			);
			const epoch = await this.wasmClient.syncRefactorRuntime!(
				this.sessionId,
				runtime,
				revision
			);
			const currentRuntime = this.refactorRuntime.runtimeState(
				storyId,
				revision,
				barrier.preconditions
			);
			if (
				barrier.isCurrent() &&
				JSON.stringify(runtime) === JSON.stringify(currentRuntime)
			) {
				return {epoch, revision};
			}
			if (
				JSON.stringify(runtime.provider) !==
				JSON.stringify(currentRuntime.provider)
			) {
				return {
					failure: {
						code: 'provider-changed',
						message: 'Refactor provider changed while synchronizing runtime.'
					}
				};
			}
			if (
				JSON.stringify(runtime.external) !==
				JSON.stringify(currentRuntime.external)
			) {
				return {
					failure: {
						code: 'persistence-conflict',
						message:
							'External project state changed while synchronizing runtime.'
					}
				};
			}
		}
		return {
			failure: {
				code: 'buffer-changed',
				message: 'Refactor runtime did not remain stable while synchronizing.'
			}
		};
	}

	async ensureSessionReady() {
		await this.ensureWasmProjectSession();
	}

	async beginHydratedProject(_storyId: string, stories: Story[]) {
		if (!this.wasmClient.enabled) {
			throw new Error('WASM core worker is unavailable.');
		}
		if (
			stories.some(
				story =>
					!!projectStoryHydration(story.id)?.rootPath &&
					!knownAssetInventoryScanCompleteForStory(story.id)
			)
		) {
			await waitForSubscribedCondition(subscribeKnownAssetInventory, () =>
				stories.every(
					story =>
						!projectStoryHydration(story.id)?.rootPath ||
						knownAssetInventoryScanCompleteForStory(story.id)
				)
			);
		}

		for (const story of stories) {
			this.sessionOwnedDocumentStories.add(story.id);
		}
		const revision = this.wasmProjectRevision;
		const snapshot = projectSnapshotFromStories(storiesWithDocuments(stories));
		const assets = stories.flatMap(
			story => this.assetInventoryByStory.get(story.id) ?? []
		);
		this.wasmProjectReplaceRevision = revision;
		await this.wasmClient.beginProjectBootstrap(
			this.sessionId,
			snapshot,
			revision,
			assets
		);
	}

	async appendHydratedProjectPassages(
		storyId: string,
		passages: PassageWithText[],
		_lease?: CoreHydrationLease
	) {
		void _lease;
		await this.wasmClient.appendProjectBootstrap(
			this.sessionId,
			storyId,
			passages.map(passageToSnapshot)
		);
	}

	async finishHydratedProject(storyId: string, _lease?: CoreHydrationLease) {
		void _lease;
		const revision = this.wasmProjectRevision;
		let status: CoreSessionStatus | undefined;
		try {
			status = await this.wasmClient.finishProjectBootstrap(
				this.sessionId,
				revision
			);
		} catch (error) {
			this.clearHydrationReadiness();
			throw error;
		}
		if (status) {
			this.publishStatus(status);
		}
		// Streaming bootstrap initializes the same worker session as
		// replaceProject(). Record it as ready so later readiness checks do not try
		// to reconstruct a full snapshot from the body-free retained model.
		this.wasmProjectReplaceRevision = revision;
		this.wasmProjectReplacePromise = Promise.resolve();
		this.releaseRetainedPassageBodies();
		for (const story of this.stories) {
			releaseBootstrapStory(story.id);
		}
		recordPerformanceHarnessEvent('core-session-stream-hydration-ready', {
			revision,
			sessionId: this.sessionId,
			storyId
		});
	}

	async abortHydratedProject(storyId: string, _lease?: CoreHydrationLease) {
		void storyId;
		void _lease;
		try {
			await this.wasmClient.abortProjectBootstrap?.(this.sessionId);
		} finally {
			this.clearHydrationReadiness();
		}
	}

	private clearHydrationReadiness() {
		this.wasmProjectReplacePromise = undefined;
		this.wasmProjectReplaceRevision = -1;
	}

	async acquireProjectReplacement(_storyId: string) {
		void _storyId;
		const lease = Symbol('store-project-replacement-lease');
		this.replacementReservations.add(lease);
		return lease;
	}

	async abortProjectReplacement(
		_storyId: string,
		lease: CoreProjectReplacementLease
	) {
		this.replacementReservations.delete(lease);
	}

	async initializeHydratedProject(
		_storyId: string,
		stories: Story[],
		_replacementLease?: CoreProjectReplacementLease
	) {
		void _storyId;
		void _replacementLease;
		if (!this.wasmClient.enabled) {
			throw new Error('WASM core worker is unavailable.');
		}
		if (
			stories.some(
				story =>
					!!projectStoryHydration(story.id)?.rootPath &&
					!knownAssetInventoryScanCompleteForStory(story.id)
			)
		) {
			await waitForSubscribedCondition(subscribeKnownAssetInventory, () =>
				stories.every(
					story =>
						!projectStoryHydration(story.id)?.rootPath ||
						knownAssetInventoryScanCompleteForStory(story.id)
				)
			);
		}

		const revision = this.wasmProjectRevision;
		for (const story of stories) {
			this.sessionOwnedDocumentStories.add(story.id);
		}
		const snapshot = projectSnapshotFromStories(storiesWithDocuments(stories));
		const assets = stories.flatMap(
			story => this.assetInventoryByStory.get(story.id) ?? []
		);
		this.wasmProjectReplaceRevision = revision;
		this.wasmProjectReplacePromise = this.wasmClient
			.replaceProject(this.sessionId, snapshot, revision, assets)
			.then(status => {
				if (status) {
					this.publishStatus(status);
				}
			});
		try {
			await this.wasmProjectReplacePromise;
		} catch (error) {
			this.clearHydrationReadiness();
			throw error;
		}
		for (const story of stories) {
			releaseBootstrapStory(story.id);
		}
		recordPerformanceHarnessEvent('core-session-direct-hydration-ready', {
			passageCount: snapshot.stories.reduce(
				(total, story) => total + story.passages.length,
				0
			),
			revision,
			sessionId: this.sessionId
		});
	}

	async applyExternalDelta(
		_storyId: string,
		delta: CoreExternalDelta
	): Promise<PatchBatch | undefined> {
		if (!this.wasmClient.enabled) {
			throw new Error('WASM core worker is unavailable.');
		}

		return this.enqueueMutation(async () => {
			const revision = await this.ensureWasmProjectSession();
			recordPerformanceHarnessEvent('external-delta-worker-submit', {
				deltaId: delta.id,
				force: true,
				revision
			});
			const result = await this.wasmClient.applyExternalDelta(
				this.sessionId,
				delta,
				revision
			);

			recordPerformanceHarnessEvent('external-delta-rust-ingested', {
				deltaId: delta.id,
				outcome: 'applied',
				revision: result.revision
			});
			this.applySessionPatchBatch(
				result.batch,
				'undoChange.externalChanges',
				result.revision,
				result.status,
				delta.id
			);
			if (result.revision !== revision) {
				this.recordHistoryEffect(undefined);
			}
			return result.batch;
		});
	}

	async ingestExternalDelta(
		_storyId: string,
		delta: CoreExternalDelta,
		options: {force?: boolean} = {}
	): Promise<CoreExternalIngestResult> {
		if (!this.wasmClient.enabled) {
			throw new Error('WASM core worker is unavailable.');
		}

		return this.enqueueMutation(async () => {
			const revision = await this.ensureWasmProjectSession();
			recordPerformanceHarnessEvent('external-delta-worker-submit', {
				deltaId: delta.id,
				force: !!options.force,
				revision
			});
			const result = await this.wasmClient.ingestExternalDelta(
				this.sessionId,
				delta,
				revision,
				options.force
			);

			recordPerformanceHarnessEvent('external-delta-rust-ingested', {
				deltaId: delta.id,
				outcome: result.outcome,
				revision: result.revision
			});
			this.wasmProjectRevision = result.revision;
			if (result.batch) {
				this.applySessionPatchBatch(
					result.batch,
					'undoChange.externalChanges',
					result.revision,
					result.status,
					delta.id
				);
				if (result.historyRecorded) {
					this.recordHistoryEffect(undefined);
				}
			} else {
				this.publishStatus(result.status);
			}
			return result;
		});
	}

	private applyStoryCommandThroughSyncSession(
		command: StoryCommand,
		options: ReturnType<typeof normalizeCommandOptions>,
		performanceToken?: string
	) {
		const commandAnnotation =
			options.annotation ?? storyCommandAnnotation(command);

		try {
			const revision = this.ensureWasmProjectSessionSync();
			const result = this.wasmClient.applySync!(
				command,
				revision,
				options.history
			);
			if (performanceToken) {
				markPerformance(`mutation-worker-response-${performanceToken}`);
			}

			this.applySessionPatchBatch(
				result.batch,
				commandAnnotation,
				result.revision,
				result.status,
				undefined,
				options.persistence,
				options.persistenceBarrier
			);
			if (performanceToken) {
				markPerformance(`mutation-patch-dispatch-${performanceToken}`);
			}
			if (result.revision !== revision && options.history === 'record') {
				this.recordHistoryEffect(options.effectToken);
			}
			return result.batch;
		} catch (error) {
			console.error(`Rust project session command failed: ${error}`);
			throw error;
		}
	}

	private async applyStoryCommandThroughWasm(
		command: StoryCommand,
		options: ReturnType<typeof normalizeCommandOptions>,
		performanceToken?: string
	) {
		const commandAnnotation =
			options.annotation ?? storyCommandAnnotation(command);

		try {
			const revision = await this.ensureWasmProjectSession();
			const result = await this.wasmClient.apply(
				this.sessionId,
				command,
				revision,
				options.history
			);
			if (performanceToken) {
				markPerformance(`mutation-worker-response-${performanceToken}`);
			}

			this.applySessionPatchBatch(
				result.batch,
				commandAnnotation,
				result.revision,
				result.status,
				undefined,
				options.persistence,
				options.persistenceBarrier
			);
			if (performanceToken) {
				markPerformance(`mutation-patch-dispatch-${performanceToken}`);
			}
			if (result.revision !== revision && options.history === 'record') {
				this.recordHistoryEffect(options.effectToken);
			}
			return result.batch;
		} catch (error) {
			await this.rollbackRejectedEffect(options.effectToken);
			console.error(`Rust project session command failed: ${error}`);
			throw error;
		}
	}

	private applySessionPatchBatch(
		batch: PatchBatch,
		annotation: string | undefined,
		nextRevision: number,
		status?: CoreSessionStatus,
		externalDeltaId?: string,
		persistence?: 'save' | 'skip',
		persistenceBarrier?: boolean
	) {
		const patchStarted = performance.now();
		const persistenceHints = projectFolderSaveHintsForPatchBatch(batch);
		const storyActions = projectPatchBatchStoryActions(batch, {
			sessionOwnedDocumentsForStory: storyId =>
				this.sessionOwnedDocumentStories.has(storyId),
			transientStoryForStory: storyId =>
				this.pendingAdmissionStories.get(storyId)
		});
		for (const action of storyActions) {
			if (action.type === 'deleteStory') {
				action.storageKind = loadProjectMetadata(action.storyId)?.storageKind;
			}
		}
		const patchedStoryIds = Array.from(
			new Set(
				batch.patches.flatMap(patch => {
					if ('story_id' in patch) {
						return [patch.story_id];
					}
					if (patch.type === 'storyCreated') {
						return [patch.story.id];
					}
					return [];
				})
			)
		);
		const documentUpdates: NonNullable<
			ApplyCorePatchBatchAction['documentUpdates']
		> = [];
		for (const patch of batch.patches) {
			if (
				patch.type === 'storyCreated' &&
				this.sessionOwnedDocumentStories.has(patch.story.id)
			) {
				documentUpdates.push(
					...patch.story.passages.map(passage => ({
						passageId: passage.id,
						storyId: patch.story.id,
						text: passage.text,
						type: 'passageText' as const
					}))
				);
				continue;
			}
			if (
				patch.type === 'passageCreated' &&
				this.sessionOwnedDocumentStories.has(patch.story_id)
			) {
				documentUpdates.push({
					passageId: patch.passage.id,
					storyId: patch.story_id,
					text: patch.passage.text,
					type: 'passageText' as const
				});
				continue;
			}
			if (
				patch.type === 'passageUpdated' &&
				patch.changes.text !== null &&
				this.sessionOwnedDocumentStories.has(patch.story_id)
			) {
				documentUpdates.push({
					passageId: patch.passage_id,
					storyId: patch.story_id,
					text: patch.changes.text,
					type: 'passageText' as const
				});
				continue;
			}
			if (patch.type === 'storyScriptUpdated') {
				documentUpdates.push({
					storyId: patch.story_id,
					text: patch.script,
					type: 'script'
				});
				continue;
			}
			if (patch.type === 'storyStylesheetUpdated') {
				documentUpdates.push({
					storyId: patch.story_id,
					text: patch.stylesheet,
					type: 'stylesheet'
				});
			}
		}
		const classifiedAt = performance.now();
		const persistenceCompletion =
			persistenceBarrier &&
			persistence !== 'skip' &&
			!externalDeltaId &&
			(storyActions.length > 0 || persistenceHints.length > 0)
				? createPersistenceCompletion()
				: undefined;

		if (persistenceBarrier) {
			const completion =
				persistenceCompletion?.completion ??
				Promise.reject(
					new Error('The Core mutation did not schedule project persistence.')
				);

			void completion.catch(() => undefined);
			this.persistenceCompletions.set(batch, completion);
		}

		this.wasmProjectRevision = nextRevision;
		this.wasmProjectReplaceRevision = nextRevision;
		this.wasmProjectReplacePromise = Promise.resolve();
		this.pendingSessionPatchDispatches += storyActions.length > 0 ? 1 : 0;
		let dispatchedPersistenceAction: ApplyCorePatchBatchAction | undefined;

		applyProjectPatchBatch(
			batch,
			{
				deleteAsset: (storyId, path) => this.deleteAsset(storyId, path),
				dispatch: action => this.dispatch(action, annotation),
				dispatchBatch: actions => {
					const action: ApplyCorePatchBatchAction = {
						actions,
						documentUpdates,
						persistence:
							persistence === 'skip' || externalDeltaId ? 'skip' : undefined,
						persistenceHints,
						persistenceToken: persistenceCompletion?.token,
						revision: nextRevision,
						sessionId: this.sessionId,
						storyIds: patchedStoryIds,
						type: 'applyCorePatchBatch'
					};

					if (persistenceCompletion) {
						this.persistenceActions.set(batch, {
							action: {...action, persistenceToken: undefined},
							annotation
						});
					}
					dispatchedPersistenceAction = action;
					this.dispatch(action, annotation);
				},
				dispatchEmptyBatch: persistenceHints.length > 0,
				renameAsset: (storyId, oldPath, newPath) =>
					this.renameAsset(storyId, oldPath, newPath),
				replaceAssetInventory: (storyId, inventory, options) =>
					replaceKnownAssetInventoryForStory(storyId, inventory, {
						assetScanComplete:
							options?.assetScanComplete ??
							knownAssetInventoryScanCompleteForStory(storyId)
					}),
				setDirty: dirty => {
					this.dirty = dirty;
				},
				upsertAsset: (storyId, asset) => this.upsertAsset(storyId, asset)
			},
			storyActions
		);
		if (externalDeltaId || persistence === 'skip') {
			this.clearFailedPersistenceTargets(
				dispatchedPersistenceAction
					? persistenceTargetsForAction(dispatchedPersistenceAction)
					: [],
				nextRevision
			);
		}
		const dispatchedAt = performance.now();

		if (externalDeltaId) {
			recordPerformanceHarnessEvent('external-delta-patch-applied', {
				deltaId: externalDeltaId,
				patches: batch.patches.length,
				revision: nextRevision,
				storyActions: storyActions.length
			});
		}
		this.publishPatchBatch(batch);
		const publishedAt = performance.now();
		recordPerformanceHarnessEvent('renderer-patch-stages', {
			classificationMs: classifiedAt - patchStarted,
			dispatchMs: dispatchedAt - classifiedAt,
			documentUpdates: documentUpdates.length,
			patchCount: batch.patches.length,
			publishMs: publishedAt - dispatchedAt,
			revision: nextRevision,
			storyActions: storyActions.length,
			totalMs: publishedAt - patchStarted
		});
		if (status) {
			this.publishStatus(status);
		}
	}

	private publishPatchBatch(batch: PatchBatch) {
		this.listeners.forEach(listener => listener(batch));
	}

	async undo() {
		if (!this.wasmClient.enabled) {
			return undefined;
		}

		markPerformance('undo-submit');
		const batch = await this.enqueueMutation(() => this.undoThroughWasm());

		markPerformance('undo-applied');
		measurePerformance('undo-round-trip', 'undo-submit', 'undo-applied');
		recordPerformanceHarnessEvent('undo-applied', {
			revision: this.status.revision
		});
		return batch;
	}

	rollbackTransaction(transactionId: number) {
		return this.enqueueMutation(async () => {
			const revision = await this.ensureWasmProjectSession();

			if (revision !== transactionId + 1 || this.status.revision !== revision) {
				return false;
			}

			return !!(await this.undoThroughWasm());
		});
	}

	private async undoThroughWasm() {
		let effectToken = this.undoEffects[this.undoEffects.length - 1];
		let nativeApplied = false;

		try {
			const rotatedToken = await this.applyNativeEffect(effectToken, 'undo');

			if (effectToken && rotatedToken) {
				this.replaceHistoryEffectToken(effectToken, rotatedToken);
				effectToken = rotatedToken;
			}
			nativeApplied = !!effectToken;
			const revision = await this.ensureWasmProjectSession();
			const result = await this.wasmClient.undo(this.sessionId, revision);

			if (result) {
				this.undoEffects.pop();
				this.redoEffects.push(effectToken);
				this.applySessionPatchBatch(
					result.batch,
					undefined,
					result.revision,
					result.status
				);
				return result.batch;
			}
			const restoredToken = await this.applyNativeEffect(effectToken, 'redo');

			if (effectToken && restoredToken) {
				this.replaceHistoryEffectToken(effectToken, restoredToken);
				effectToken = restoredToken;
			}
			return undefined;
		} catch (error) {
			if (nativeApplied) {
				const restoredToken = await this.applyNativeEffect(
					effectToken,
					'redo'
				).catch(() => undefined);

				if (restoredToken && effectToken) {
					this.replaceHistoryEffectToken(effectToken, restoredToken);
				}
			}
			console.error(`Rust project session undo failed: ${error}`);
			throw error;
		}
	}

	async redo() {
		if (!this.wasmClient.enabled) {
			return undefined;
		}

		markPerformance('redo-submit');
		const batch = await this.enqueueMutation(() => this.redoThroughWasm());

		markPerformance('redo-applied');
		measurePerformance('redo-round-trip', 'redo-submit', 'redo-applied');
		recordPerformanceHarnessEvent('redo-applied', {
			revision: this.status.revision
		});
		return batch;
	}

	private async redoThroughWasm() {
		let effectToken = this.redoEffects[this.redoEffects.length - 1];
		let nativeApplied = false;

		try {
			const rotatedToken = await this.applyNativeEffect(effectToken, 'redo');

			if (effectToken && rotatedToken) {
				this.replaceHistoryEffectToken(effectToken, rotatedToken);
				effectToken = rotatedToken;
			}
			nativeApplied = !!effectToken;
			const revision = await this.ensureWasmProjectSession();
			const result = await this.wasmClient.redo(this.sessionId, revision);

			if (result) {
				this.redoEffects.pop();
				this.undoEffects.push(effectToken);
				this.applySessionPatchBatch(
					result.batch,
					undefined,
					result.revision,
					result.status
				);
				return result.batch;
			}
			const restoredToken = await this.applyNativeEffect(effectToken, 'undo');

			if (effectToken && restoredToken) {
				this.replaceHistoryEffectToken(effectToken, restoredToken);
				effectToken = restoredToken;
			}
			return undefined;
		} catch (error) {
			if (nativeApplied) {
				const restoredToken = await this.applyNativeEffect(
					effectToken,
					'undo'
				).catch(() => undefined);

				if (restoredToken && effectToken) {
					this.replaceHistoryEffectToken(effectToken, restoredToken);
				}
			}
			console.error(`Rust project session redo failed: ${error}`);
			throw error;
		}
	}

	isDirty() {
		return this.status.dirty;
	}

	sessionStatus() {
		return this.status;
	}

	subscribeToStatus(listener: (status: CoreSessionStatus) => void) {
		this.statusListeners.add(listener);
		return () => {
			this.statusListeners.delete(listener);
		};
	}

	private publishStatus(status: CoreSessionStatus) {
		const previousRevision = this.status.revision;

		this.status = status;
		this.dirty = status.dirty;
		if (status.revision !== previousRevision) {
			recordPerformanceHarnessEvent('session-revision', {
				revision: status.revision,
				sessionId: this.sessionId
			});
		}
		this.statusListeners.forEach(listener => listener(status));
	}

	private async applyNativeEffect(
		effectToken: string | undefined,
		direction: 'redo' | 'undo'
	) {
		if (!effectToken) {
			return;
		}

		const bridge = (window as TwineElectronWindow).twineElectron;

		if (!bridge?.applyProjectAssetEffect) {
			throw new Error('Native asset effect service is unavailable.');
		}
		return (
			(await bridge.applyProjectAssetEffect(effectToken, direction)) ??
			effectToken
		);
	}

	private replaceHistoryEffectToken(current: string, replacement: string) {
		for (const effects of [this.undoEffects, this.redoEffects]) {
			const index = effects.lastIndexOf(current);

			if (index !== -1) {
				effects[index] = replacement;
				return;
			}
		}
	}

	private discardNativeEffect(effectToken: string) {
		const request = (
			window as TwineElectronWindow
		).twineElectron?.discardProjectAssetEffect?.(effectToken);

		if (request) {
			void request.catch(error =>
				console.warn(`Could not discard native asset effect: ${error}`)
			);
		}
	}

	private recordHistoryEffect(effectToken: string | undefined) {
		for (const token of this.redoEffects) {
			if (token) {
				this.discardNativeEffect(token);
			}
		}
		this.redoEffects = [];
		this.undoEffects.push(effectToken);
		if (this.undoEffects.length > 200) {
			const evicted = this.undoEffects.shift();

			if (evicted) {
				this.discardNativeEffect(evicted);
			}
		}
	}

	private async rollbackRejectedEffect(effectToken: string | undefined) {
		if (!effectToken) {
			return;
		}

		const discardToken = await this.applyNativeEffect(effectToken, 'undo');
		await (
			window as TwineElectronWindow
		).twineElectron?.discardProjectAssetEffect?.(discardToken ?? effectToken);
	}

	disposeEffects() {
		for (const token of [...this.undoEffects, ...this.redoEffects]) {
			if (token) {
				this.discardNativeEffect(token);
			}
		}
		this.undoEffects = [];
		this.redoEffects = [];
	}

	dispose() {
		this.disposeEffects();
		if (this.ownsWasmClient) {
			void this.wasmClient.removeSession?.(this.sessionId);
			this.wasmClient.dispose?.();
		}
	}

	async acknowledgeSaved(sessionId: string, revision: number) {
		if (!this.wasmClient.enabled) {
			return;
		}
		if (sessionId !== this.sessionId) {
			throw new Error(`Save acknowledgement belongs to "${sessionId}".`);
		}

		await this.enqueueMutation(async () => {
			await this.ensureWasmProjectSession();
			const result = await this.wasmClient.acknowledgeSaved(
				this.sessionId,
				revision
			);

			this.applySessionPatchBatch(
				result.batch,
				undefined,
				result.revision,
				result.status
			);
		});
	}

	async recoverFromSnapshot(
		_storiesId: string,
		stories: StoryWithDocuments[],
		assets: CoreAssetInventoryEntry[]
	) {
		await this.enqueueMutation(async () => {
			this.disposeEffects();
			const snapshot = projectSnapshotFromStories(
				storiesWithDocuments(stories)
			);
			const metadataStories = stories.map(metadataStory);

			this.stories = metadataStories;
			for (const story of stories) {
				replaceKnownAssetInventoryForStory(story.id, assets);
			}
			this.wasmProjectRevision++;
			this.wasmProjectReplaceRevision = this.wasmProjectRevision;
			this.dispatch({state: metadataStories, type: 'init'});
			let status: CoreSessionStatus | undefined;
			try {
				status = await this.wasmClient.replaceProject(
					this.sessionId,
					snapshot,
					this.wasmProjectRevision,
					assets
				);
			} catch (error) {
				this.clearHydrationReadiness();
				throw error;
			}

			if (status) {
				this.publishStatus(status);
			}
		});
	}

	async drainMutations() {
		await this.mutationQueue;
	}

	private enqueueMutation<T>(mutation: () => Promise<T>) {
		const result = this.mutationQueue.then(mutation, mutation);

		this.mutationQueue = result.then(
			() => undefined,
			() => undefined
		);
		return result;
	}

	private assetForPath(storyId: string, path: string) {
		const normalized = normalizedAssetPath(projectAssetPath(path));

		return this.assetInventoryByStory
			.get(storyId)
			?.find(asset => asset.normalizedPath === normalized);
	}

	private deleteAsset(storyId: string, path: string) {
		const normalized = normalizedAssetPath(projectAssetPath(path));
		const assets = this.assetInventoryByStory.get(storyId) ?? [];

		this.assetInventoryByStory.set(
			storyId,
			assets.filter(asset => asset.normalizedPath !== normalized)
		);
	}

	private renameAsset(storyId: string, path: string, newPath: string) {
		const oldAsset = this.assetForPath(storyId, path);
		const renamed = {
			...(oldAsset ?? assetInventoryEntry(projectAssetPath(path))),
			...assetInventoryEntry(projectAssetPath(newPath), {
				previewUrl: oldAsset?.previewUrl ?? null
			}),
			references: oldAsset?.references ?? [],
			referenceCount: oldAsset?.referenceCount ?? 0
		};

		this.deleteAsset(storyId, path);
		this.upsertAsset(storyId, renamed);
		return renamed;
	}

	private upsertAsset(storyId: string, asset: CoreAssetInventoryEntry) {
		const assets = this.assetInventoryByStory.get(storyId) ?? [];
		const withoutAsset = assets.filter(
			existing => existing.normalizedPath !== asset.normalizedPath
		);

		this.assetInventoryByStory.set(storyId, [...withoutAsset, asset]);
	}

	publishStoreStatePatches() {
		// Persisted dirty state is owned by the Rust session. Store updates here are
		// hydration or view-state changes and must not trigger a second full-project
		// comparison in the renderer.
	}

	runtimeMode() {
		return this.wasmClient.mode;
	}

	performanceDiagnostics() {
		const passageTextCharacterCount = this.stories.reduce(
			(total, story) =>
				total +
				story.passages.reduce(
					(passageTotal, passage) =>
						passageTotal +
						('text' in passage && typeof passage.text === 'string'
							? passage.text.length
							: 0),
					0
				),
			0
		);

		return {
			passageTextCharacterCount,
			passageCount: this.stories.reduce(
				(total, story) => total + story.passages.length,
				0
			),
			storyCount: this.stories.length,
			textCharacterCount:
				passageTextCharacterCount +
				this.stories.reduce(
					(total, story) =>
						total + story.script.length + story.stylesheet.length,
					0
				)
		};
	}

	private normalizedStoryIndexOptions(
		storyId: string,
		options: StoryIndexQuery = {}
	) {
		const knownAssets =
			this.assetInventoryByStory.get(storyId) ?? emptyAssetInventory;
		const assetScanComplete = knownAssetInventoryScanCompleteForStory(storyId);
		const explicitKnownAssets =
			typeof options === 'string' ? [] : (options.knownAssets ?? []);

		return typeof options === 'string'
			? normalizeStoryIndexOptions({
					assetScanComplete,
					knownAssets,
					query: options
				})
			: normalizeStoryIndexOptions({
					...options,
					assetScanComplete: options.assetScanComplete ?? assetScanComplete,
					knownAssets: [...explicitKnownAssets, ...knownAssets]
				});
	}

	private async ensureWasmProjectSession() {
		if (!this.wasmClient.enabled) {
			throw new Error('WASM core worker is unavailable.');
		}
		if (
			this.stories.some(
				story => projectStoryHydration(story.id)?.passageTextLoaded === false
			)
		) {
			await waitForSubscribedCondition(subscribeProjectStoryHydration, () =>
				this.stories.every(
					story => projectStoryHydration(story.id)?.passageTextLoaded !== false
				)
			);
		}
		if (
			this.stories.some(
				story =>
					!!projectStoryHydration(story.id)?.rootPath &&
					!knownAssetInventoryScanCompleteForStory(story.id)
			)
		) {
			await waitForSubscribedCondition(subscribeKnownAssetInventory, () =>
				this.stories.every(
					story =>
						!projectStoryHydration(story.id)?.rootPath ||
						knownAssetInventoryScanCompleteForStory(story.id)
				)
			);
		}
		const startedAt =
			typeof performance !== 'undefined' ? performance.now() : Date.now();
		const reusedReadySession =
			!!this.wasmProjectReplacePromise &&
			this.wasmProjectReplaceRevision === this.wasmProjectRevision;

		if (
			!this.wasmProjectReplacePromise ||
			this.wasmProjectReplaceRevision !== this.wasmProjectRevision
		) {
			const revision = this.wasmProjectRevision;
			const snapshotStarted = performance.now();
			const snapshot = projectSnapshotFromStories(
				storiesWithDocuments(this.stories)
			);
			recordPerformanceHarnessEvent('core-session-snapshot-built', {
				durationMs: performance.now() - snapshotStarted,
				passageCount: snapshot.stories.reduce(
					(total, story) => total + story.passages.length,
					0
				),
				revision,
				sessionId: this.sessionId
			});
			const assets = this.stories.flatMap(
				story => this.assetInventoryByStory.get(story.id) ?? []
			);

			this.wasmProjectReplaceRevision = revision;
			const replaceResult =
				assets.length > 0
					? this.wasmClient.replaceProject(
							this.sessionId,
							snapshot,
							revision,
							assets
						)
					: this.wasmClient.replaceProject(this.sessionId, snapshot, revision);

			this.wasmProjectReplacePromise = Promise.resolve(replaceResult)
				.then(status => {
					this.releaseRetainedPassageBodies();
					for (const story of this.stories) {
						releaseBootstrapStory(story.id);
					}
					if (status) {
						this.publishStatus(status);
					}
				})
				.catch(error => {
					this.wasmProjectReplacePromise = undefined;
					throw error;
				});
		}

		await this.wasmProjectReplacePromise;
		recordPerformanceHarnessEvent('core-session-ready', {
			durationMs:
				(typeof performance !== 'undefined' ? performance.now() : Date.now()) -
				startedAt,
			mode: reusedReadySession ? 'reused' : 'replace',
			revision: this.wasmProjectReplaceRevision,
			sessionId: this.sessionId
		});
		return this.wasmProjectReplaceRevision;
	}

	private ensureWasmProjectSessionSync() {
		if (!this.wasmClient.enabled || !this.wasmClient.replaceProjectSync) {
			throw new Error('WASM core worker is unavailable.');
		}
		if (
			this.stories.some(
				story => projectStoryHydration(story.id)?.passageTextLoaded === false
			)
		) {
			throw new Error('Core session initialization is waiting for hydration.');
		}

		if (
			!this.wasmProjectReplacePromise ||
			this.wasmProjectReplaceRevision !== this.wasmProjectRevision
		) {
			const revision = this.wasmProjectRevision;
			const snapshot = projectSnapshotFromStories(
				storiesWithDocuments(this.stories)
			);

			this.wasmProjectReplaceRevision = revision;
			this.wasmClient.replaceProjectSync(snapshot, revision);
			this.releaseRetainedPassageBodies();
			this.wasmProjectReplacePromise = Promise.resolve();
		}

		return this.wasmProjectReplaceRevision;
	}

	private releaseRetainedPassageBodies() {
		if (
			this.stories.some(story =>
				story.passages.some(
					passage =>
						'text' in passage &&
						typeof passage.text === 'string' &&
						passage.text.length > 0
				)
			)
		) {
			const metadataStories = storiesWithDocuments(this.stories).map(
				metadataStory
			);

			this.stories = metadataStories;
		}
	}

	queryGraphProjection(storyId: string, options: GraphProjectionQuery = {}) {
		const normalizedOptions = normalizeGraphProjectionOptions(options);
		const cached = this.wasmClient.cachedGraphProjection(
			this.sessionId,
			storyId,
			normalizedOptions,
			this.wasmProjectRevision
		);

		if (cached) {
			return cached;
		}

		if (this.wasmClient.enabled) {
			const lastProjection = this.wasmClient.lastGraphProjection(
				this.sessionId,
				storyId,
				this.wasmProjectRevision
			);

			if (lastProjection) {
				return lastProjection;
			}
		}

		return emptyGraphProjection();
	}

	async queryGraphProjectionAsync(
		storyId: string,
		options: GraphProjectionQuery = {}
	) {
		const normalizedOptions = normalizeGraphProjectionOptions(options);

		if (this.wasmClient.enabled) {
			try {
				markPerformance('graph-query-submit');
				const revision = await this.ensureWasmProjectSession();
				const result = await this.wasmClient.queryGraphProjection(
					this.sessionId,
					storyId,
					normalizedOptions,
					revision
				);

				markPerformance('graph-query-result');
				measurePerformance(
					'graph-query-round-trip',
					'graph-query-submit',
					'graph-query-result'
				);
				return result;
			} catch (error) {
				console.warn(`Rust graph projection query failed: ${error}`);
			}
		}

		return emptyGraphProjection();
	}

	queryStoryIndex(storyId: string, options: StoryIndexQuery = {}) {
		const normalizedOptions = this.normalizedStoryIndexOptions(
			storyId,
			options
		);
		const wasmCached = this.wasmClient.cachedStoryIndex(
			this.sessionId,
			storyId,
			normalizedOptions,
			this.wasmProjectRevision
		);

		if (wasmCached) {
			return wasmCached;
		}

		return emptyStoryIndex(storyId);
	}

	async queryStoryIndexAsync(storyId: string, options: StoryIndexQuery = {}) {
		const normalizedOptions = this.normalizedStoryIndexOptions(
			storyId,
			options
		);

		if (this.wasmClient.enabled) {
			try {
				markPerformance('story-index-query-submit');
				const revision = await this.ensureWasmProjectSession();
				const result = await this.wasmClient.queryStoryIndex(
					this.sessionId,
					storyId,
					normalizedOptions,
					revision
				);

				markPerformance('story-index-query-result');
				measurePerformance(
					'story-index-query-round-trip',
					'story-index-query-submit',
					'story-index-query-result'
				);
				return result;
			} catch (error) {
				console.warn(`Rust story index query failed: ${error}`);
			}
		}

		return emptyStoryIndex(storyId);
	}

	async queryStorySummaryAsync(storyId: string) {
		const queryStorySummary = (
			this.wasmClient as Partial<CoreProjectSessionClient>
		).queryStorySummary?.bind(this.wasmClient);

		if (!this.wasmClient.enabled || !queryStorySummary) {
			throw new Error('Bounded Rust story summary queries are unavailable.');
		}
		const revision = await this.ensureWasmProjectSession();
		return queryStorySummary(this.sessionId, storyId, revision);
	}

	async queryDiagnosticsSummaryAsync(
		storyId: string,
		options: Partial<CoreDiagnosticsSummaryQuery> = {}
	) {
		const queryDiagnosticsSummary = (
			this.wasmClient as Partial<CoreProjectSessionClient>
		).queryDiagnosticsSummary?.bind(this.wasmClient);

		if (!this.wasmClient.enabled || !queryDiagnosticsSummary) {
			throw new Error(
				'Bounded Rust diagnostics summary queries are unavailable.'
			);
		}
		const revision = await this.ensureWasmProjectSession();
		return queryDiagnosticsSummary(
			this.sessionId,
			storyId,
			{...defaultDiagnosticsSummaryQuery, ...options},
			revision
		);
	}

	async queryStoryWordCountAsync(storyId: string) {
		const queryStoryWordCount = (
			this.wasmClient as Partial<CoreProjectSessionClient>
		).queryStoryWordCount?.bind(this.wasmClient);

		if (!this.wasmClient.enabled) {
			throw new Error('Rust story word-count query is unavailable.');
		}
		if (!queryStoryWordCount) {
			return (await this.queryStorySummaryAsync(storyId)).wordCount;
		}
		const revision = await this.ensureWasmProjectSession();
		return queryStoryWordCount(this.sessionId, storyId, revision);
	}

	async queryWorkbenchDockModelAsync(
		storyId: string
	): Promise<CoreWorkbenchDockModel> {
		// These requests are individually serialized behind mutations. Retry the
		// bounded group if a mutation lands between them so docks never combine
		// records from different revisions.
		for (let attempt = 0; attempt < 3; attempt += 1) {
			const [summary, contents, diagnostics, assets] = await Promise.all([
				this.queryStorySummaryAsync(storyId),
				this.queryContentsPageAsync(storyId, {limit: 120}),
				this.queryDiagnosticsPageAsync(storyId, {limit: 120}),
				this.queryAssetsPageAsync(storyId, {limit: 120})
			]);
			const revisions = new Set([
				summary.revision,
				contents.revision,
				diagnostics.revision,
				assets.revision
			]);

			if (revisions.size === 1) {
				return {
					assets,
					contents,
					diagnostics,
					revision: Math.max(...revisions),
					storyId,
					summary
				};
			}
		}

		throw new Error('Could not obtain a revision-consistent workbench model');
	}

	async queryContentsPageAsync(
		storyId: string,
		options: Partial<CoreContentsQuery> = {}
	) {
		const normalizedQuery = {...defaultContentsQuery, ...options};
		const queryContentsPage = (
			this.wasmClient as Partial<CoreProjectSessionClient>
		).queryContentsPage?.bind(this.wasmClient);

		if (this.wasmClient.enabled && queryContentsPage) {
			try {
				const cached = this.wasmClient.cachedContentsPage(
					this.sessionId,
					storyId,
					normalizedQuery,
					this.wasmProjectRevision
				);

				if (cached) {
					recordPerformanceHarnessEvent('core-read-model-host-cache-hit', {
						kind: 'queryContentsPage',
						revision: this.wasmProjectRevision
					});
					return cached;
				}
				const revision = await this.ensureWasmProjectSession();
				return await queryContentsPage(
					this.sessionId,
					storyId,
					normalizedQuery,
					revision
				);
			} catch (error) {
				throw new Error(`Rust contents page query failed: ${error}`);
			}
		}
		throw new Error('Bounded Rust contents queries are unavailable.');
	}

	async querySearchPageAsync(
		storyId: string,
		options: Partial<CoreSearchQuery>
	) {
		const querySearchPage = (
			this.wasmClient as Partial<CoreProjectSessionClient>
		).querySearchPage?.bind(this.wasmClient);

		if (this.wasmClient.enabled && querySearchPage) {
			try {
				const revision = await this.ensureWasmProjectSession();
				return await querySearchPage(
					this.sessionId,
					storyId,
					{...defaultSearchQuery, ...options},
					revision
				);
			} catch (error) {
				throw new Error(`Rust search page query failed: ${error}`);
			}
		}
		throw new Error('Bounded Rust search queries are unavailable.');
	}

	async queryDiagnosticsPageAsync(
		storyId: string,
		options: Partial<CoreDiagnosticsQuery> = {}
	) {
		const queryDiagnosticsPage = (
			this.wasmClient as Partial<CoreProjectSessionClient>
		).queryDiagnosticsPage?.bind(this.wasmClient);

		if (this.wasmClient.enabled && queryDiagnosticsPage) {
			try {
				const revision = await this.ensureWasmProjectSession();
				return await queryDiagnosticsPage(
					this.sessionId,
					storyId,
					{...defaultDiagnosticsQuery, ...options},
					revision
				);
			} catch (error) {
				throw new Error(`Rust diagnostics page query failed: ${error}`);
			}
		}
		throw new Error('Bounded Rust diagnostics queries are unavailable.');
	}

	async queryDocumentPageAsync(
		storyId: string,
		options: Partial<CoreDocumentQuery> = {}
	) {
		const revision = await this.ensureWasmProjectSession();
		return this.wasmClient.queryDocumentPage(
			this.sessionId,
			storyId,
			{...defaultDocumentQuery, ...options},
			revision
		);
	}

	async queryAssetsPageAsync(
		storyId: string,
		options: Partial<CoreAssetsQuery> = {}
	) {
		if (this.wasmClient.enabled) {
			try {
				const revision = await this.ensureWasmProjectSession();
				const page = await this.wasmClient.queryAssetsPage(
					this.sessionId,
					storyId,
					{...defaultAssetsQuery, ...options},
					revision
				);

				return {
					...page,
					assets: mergeKnownAssetInventory(
						page.assets,
						knownAssetInventoryForStory(storyId)
					)
				};
			} catch (error) {
				console.warn(`Rust assets page query failed: ${error}`);
			}
		}

		return {
			assets: [],
			nextCursor: null,
			revision: 0,
			storyId,
			totalCount: 0
		} satisfies CoreAssetsPage;
	}

	async queryPassageFactsAsync(storyId: string, passageId: string) {
		if (this.wasmClient.enabled) {
			try {
				const revision = await this.ensureWasmProjectSession();
				return await this.wasmClient.queryPassageFacts(
					this.sessionId,
					storyId,
					passageId,
					revision
				);
			} catch (error) {
				console.warn(`Rust passage facts query failed: ${error}`);
			}
		}

		return {
			assetReferences: [],
			backlinks: [],
			characterCount: 0,
			diagnostics: [],
			excerpt: '',
			isEmpty: true,
			lineCount: 1,
			links: [],
			passageId,
			revision: 0,
			storyId,
			symbols: [],
			wordCount: 0
		} satisfies CorePassageFacts;
	}

	async queryPassageLocalFactsAsync(storyId: string, passageId: string) {
		if (this.wasmClient.enabled) {
			try {
				const revision = await this.ensureWasmProjectSession();
				return await this.wasmClient.queryPassageLocalFacts(
					this.sessionId,
					storyId,
					passageId,
					revision
				);
			} catch (error) {
				console.warn(`Rust local passage facts query failed: ${error}`);
			}
		}

		return {
			assetReferences: [],
			characterCount: 0,
			diagnostics: [],
			excerpt: '',
			isEmpty: true,
			lineCount: 1,
			links: [],
			passageId,
			revision: 0,
			storyId,
			symbols: [],
			wordCount: 0
		} satisfies CorePassageLocalFacts;
	}

	async queryBacklinksPageAsync(
		storyId: string,
		passageId: string,
		options: Partial<CoreBacklinksQuery> = {}
	) {
		if (this.wasmClient.enabled) {
			try {
				const revision = await this.ensureWasmProjectSession();
				return await this.wasmClient.queryBacklinksPage(
					this.sessionId,
					storyId,
					passageId,
					{...defaultBacklinksQuery, ...options},
					revision
				);
			} catch (error) {
				console.warn(`Rust backlinks page query failed: ${error}`);
			}
		}

		return {
			backlinks: [],
			nextCursor: null,
			passageId,
			revision: 0,
			storyId,
			totalCount: 0
		} satisfies CoreBacklinksPage;
	}

	async queryPassageDocumentAsync(storyId: string, passageId: string) {
		const revision = await this.ensureWasmProjectSession();
		return this.wasmClient.queryPassageDocument(
			this.sessionId,
			storyId,
			passageId,
			revision
		);
	}

	async querySourceDocumentAsync(
		storyId: string,
		kind: 'script' | 'stylesheet'
	) {
		const revision = await this.ensureWasmProjectSession();
		return this.wasmClient.querySourceDocument(
			this.sessionId,
			storyId,
			kind,
			revision
		);
	}

	subscribeToPatches(listener: CoreProjectPatchListener) {
		this.listeners.add(listener);

		return () => {
			this.listeners.delete(listener);
		};
	}

	update(stories: StoriesState, dispatch: UndoableDispatch) {
		if (this.stories !== stories) {
			if (this.pendingSessionPatchDispatches > 0) {
				this.pendingSessionPatchDispatches--;
			}
		}

		this.dispatch = dispatch;
		this.stories =
			this.wasmProjectReplaceRevision < 0
				? stories.map(story => bootstrapStory(story.id) ?? story)
				: stories.map(story =>
						story.passages.some(passage => 'text' in passage)
							? metadataStory(story)
							: story
					);
		for (const story of stories) {
			this.sessionOwnedDocumentStories.add(story.id);
		}
	}
}

function normalizedProjectRoot(rootPath: string) {
	const normalized = rootPath.replace(/\\/g, '/').replace(/\/+$/, '');

	return /^[A-Z]:\//.test(normalized)
		? `${normalized[0].toLowerCase()}${normalized.slice(1)}`
		: normalized;
}

export function coreSessionIdForStory(story: Story) {
	const metadata = loadProjectMetadata(story.id);

	return metadata?.storageKind === 'electron-project-folder' &&
		metadata.status === 'file-backed' &&
		metadata.rootPath
		? `project:${normalizedProjectRoot(metadata.rootPath)}`
		: `story:${story.id}`;
}

function commandStoryId(command: StoryCommand): string | undefined {
	if ('story_id' in command) {
		return command.story_id;
	}

	if (command.type === 'createStory') {
		return command.story.id;
	}

	if (command.type === 'batch') {
		const storyIds = new Set(
			command.commands.map(commandStoryId).filter(Boolean)
		);

		return storyIds.size === 1 ? [...storyIds][0] : undefined;
	}

	return undefined;
}

function commandStoryIds(command: StoryCommand): readonly string[] {
	if ('story_id' in command) {
		return [command.story_id];
	}

	if (command.type === 'createStory') {
		return [command.story.id];
	}

	if (command.type === 'batch') {
		return command.commands.flatMap(commandStoryIds);
	}

	return [];
}

class CoreProjectReplacementInProgressError extends Error {
	readonly code = 'CORE_PROJECT_REPLACEMENT_IN_PROGRESS';

	constructor(command: StoryCommand) {
		super(
			`Core command "${command.type}" was rejected because its project is being replaced.`
		);
		this.name = 'CoreProjectReplacementInProgressError';
	}
}

const projectScopedCoreHosts = new Set<ProjectScopedCoreProjectHost>();

type StoryTagRenameCommand = Extract<StoryCommand, {type: 'renameStoryTag'}>;

export async function applyStoryTagRenameAcrossHosts(
	hosts: Iterable<StoreCoreProjectHost>,
	command: StoryTagRenameCommand,
	options?: CoreCommandOptions
) {
	const completed: Array<{
		host: StoreCoreProjectHost;
		transactionId: number;
	}> = [];
	let lastBatch: PatchBatch | undefined;

	try {
		for (const host of hosts) {
			lastBatch =
				options === undefined
					? await host.applyStoryCommand(command)
					: await host.applyStoryCommand(command, options);
			const transactionId = host.transactionTokenFor(lastBatch);

			if (transactionId !== undefined) {
				completed.push({host, transactionId});
			}
		}
		return lastBatch;
	} catch (error) {
		const rollbackErrors: unknown[] = [];

		for (const {host, transactionId} of completed.reverse()) {
			try {
				if (!(await host.rollbackTransaction(transactionId))) {
					rollbackErrors.push(
						new Error(
							`Transaction ${transactionId} is no longer eligible for rollback.`
						)
					);
				}
			} catch (rollbackError) {
				rollbackErrors.push(rollbackError);
			}
		}
		if (rollbackErrors.length > 0) {
			throw new AggregateError(
				[error, ...rollbackErrors],
				`Global story tag rename failed and ${rollbackErrors.length} project${
					rollbackErrors.length === 1 ? '' : 's'
				} could not be rolled back safely.`,
				{cause: error}
			);
		}
		throw error;
	}
}

export class ProjectScopedCoreProjectHost implements CoreProjectHost {
	private admittedMutations = new Set<Promise<unknown>>();
	private admittedRefactorApplies = new Set<{
		host: StoreCoreProjectHost;
		promise: Promise<unknown>;
		sessionId: string;
		storyId: string;
	}>();
	private admittedSessionMutations = new Set<{
		host: StoreCoreProjectHost;
		promise: Promise<unknown>;
		sessionId: string;
	}>();
	// Replacement admission is intentionally keyed by the Store host object, not a
	// session id or revision. Both can be reused while a root rebind is in flight.
	// Each overlapping replacement owns one opaque token so an older terminal path
	// cannot reopen admission for a newer one.
	private replacementGateOwners = new Map<StoreCoreProjectHost, Set<symbol>>();
	private replacementGateOwnersByStory = new Map<string, Set<symbol>>();
	private replacementReservations = new Map<
		CoreProjectReplacementLease,
		{
			gateOwner: symbol;
			host: StoreCoreProjectHost;
			sessionId: string;
			storyIds: Set<string>;
		}
	>();
	private refactorLifecycleOperations = new Set<{
		controller: AbortController;
		host: StoreCoreProjectHost;
		promise: Promise<unknown>;
		reviewGeneration: number;
		sessionId: string;
		storyId: string;
	}>();
	private refactorReviewGenerations = new Map<string, number>();
	private client = createWasmCoreWorkerClient();
	private dispatch: UndoableDispatch;
	private disposed = false;
	private hosts = new Map<string, StoreCoreProjectHost>();
	private hydratedProjectLeases = new Map<
		string,
		{
			gateOwner: symbol;
			host: StoreCoreProjectHost;
			sessionId: string;
			storyIds: Set<string>;
			token: CoreHydrationLease;
		}
	>();
	private mutationAdmissionOpen = true;
	private patchListeners = new Set<CoreProjectPatchListener>();
	private pendingStoryRebinds = new Map<
		string,
		{
			host: StoreCoreProjectHost;
			owner: symbol;
			publishImmediately: boolean;
			sessionId: string;
			storyIds: Set<string>;
		}
	>();
	private recoveryOwnedStories = new Map<string, StoryWithDocuments>();
	private refactorReviewModels = new Map<string, RefactorReviewModel>();
	private statusListeners = new Set<(status: CoreSessionStatus) => void>();
	private stories: StoriesState;
	private storySessions = new Map<string, string>();
	private unregisterQuitWorkflow: () => void;
	private readonly dispatchFromCore: UndoableDispatch = (action, annotation) =>
		rendererQuitQuiescence.runAdmittedDispatch(() => {
			if (
				typeof action !== 'function' &&
				action.type === 'applyCorePatchBatch'
			) {
				this.stories = storiesReducer(this.stories, action);
			}
			return this.dispatch(action, annotation);
		});

	constructor(stories: StoriesState, dispatch: UndoableDispatch) {
		this.stories = stories;
		this.dispatch = dispatch;
		this.unregisterQuitWorkflow = rendererQuitQuiescence.registerWorkflow({
			drain: async () => {
				await this.abortAndDrainRefactorLifecycle(() => true);
				return this.drainAdmittedMutations();
			},
			freezeAdmission: () => {
				this.mutationAdmissionOpen = false;
				for (const operation of this.refactorLifecycleOperations) {
					operation.controller.abort();
				}
			},
			reopenAdmission: () => {
				this.mutationAdmissionOpen = true;
			}
		});
		projectScopedCoreHosts.add(this);
		this.update(stories, dispatch);
	}

	private admitMutation<T>(
		operation: () => Promise<T>,
		sessions: Iterable<{host: StoreCoreProjectHost; sessionId: string}> = []
	): Promise<T> {
		if (
			this.disposed ||
			(!this.mutationAdmissionOpen &&
				!rendererQuitQuiescence.flushAdmissionActive)
		) {
			return Promise.reject(
				new Error('Core mutations are frozen while the application exits.')
			);
		}

		let result: Promise<T>;

		try {
			result = operation();
		} catch (error) {
			return Promise.reject(error);
		}
		const tracked = Promise.resolve(result);

		this.admittedMutations.add(tracked);
		const sessionMutations = [...sessions].map(session => ({
			...session,
			promise: tracked
		}));
		for (const sessionMutation of sessionMutations) {
			this.admittedSessionMutations.add(sessionMutation);
		}
		void tracked.then(
			() => {
				this.admittedMutations.delete(tracked);
				for (const sessionMutation of sessionMutations) {
					this.admittedSessionMutations.delete(sessionMutation);
				}
			},
			() => {
				this.admittedMutations.delete(tracked);
				for (const sessionMutation of sessionMutations) {
					this.admittedSessionMutations.delete(sessionMutation);
				}
			}
		);
		return result;
	}

	private async drainAdmittedMutations() {
		let failure: unknown;

		while (this.admittedMutations.size > 0) {
			const results = await Promise.allSettled([...this.admittedMutations]);

			failure ??= results.find(result => result.status === 'rejected')?.reason;
		}
		if (failure !== undefined) {
			throw failure;
		}
	}

	private reviewGeneration(storyId: string) {
		return this.refactorReviewGenerations.get(storyId) ?? 0;
	}

	private replacementGateHeld(host: StoreCoreProjectHost) {
		return (this.replacementGateOwners.get(host)?.size ?? 0) > 0;
	}

	private replacementGateHeldForStory(storyId: string) {
		return (this.replacementGateOwnersByStory.get(storyId)?.size ?? 0) > 0;
	}

	private replacementGateErrorForCommand(command: StoryCommand) {
		const touchesGatedStory = commandStoryIds(command).some(storyId =>
			this.replacementGateHeldForStory(storyId)
		);
		const touchesEverySession = command.type === 'renameStoryTag';

		return touchesGatedStory ||
			(touchesEverySession && this.replacementGateOwners.size > 0)
			? new CoreProjectReplacementInProgressError(command)
			: undefined;
	}

	private acquireSessionReplacement(
		host: StoreCoreProjectHost,
		sessionId: string,
		storyIds: Set<string>
	) {
		const owner = Symbol(`replacement:${sessionId}`);
		const owners = this.replacementGateOwners.get(host) ?? new Set<symbol>();

		owners.add(owner);
		this.replacementGateOwners.set(host, owners);
		for (const storyId of storyIds) {
			const storyOwners =
				this.replacementGateOwnersByStory.get(storyId) ?? new Set<symbol>();
			storyOwners.add(owner);
			this.replacementGateOwnersByStory.set(storyId, storyOwners);
		}

		// Close every DTO owned by this Store session before the first await. This
		// also aborts any in-flight planner/detail operation synchronously.
		for (const candidateStoryId of storyIds)
			this.closeRefactorReview(candidateStoryId);
		return owner;
	}

	private releaseSessionReplacement(
		host: StoreCoreProjectHost,
		storyIds: Set<string>,
		owner: symbol
	) {
		const owners = this.replacementGateOwners.get(host);

		if (!owners || !owners.delete(owner)) return;
		if (owners.size === 0) this.replacementGateOwners.delete(host);
		for (const storyId of storyIds) {
			const storyOwners = this.replacementGateOwnersByStory.get(storyId);
			if (!storyOwners || !storyOwners.delete(owner)) continue;
			if (storyOwners.size === 0) {
				this.replacementGateOwnersByStory.delete(storyId);
			}
		}
	}

	private invalidateRefactorReview(storyId: string) {
		this.refactorReviewGenerations.set(
			storyId,
			this.reviewGeneration(storyId) + 1
		);
		for (const operation of this.refactorLifecycleOperations) {
			if (operation.storyId === storyId) operation.controller.abort();
		}
	}

	private refactorOperationIsCurrent(operation: {
		host: StoreCoreProjectHost;
		reviewGeneration: number;
		sessionId: string;
		storyId: string;
	}) {
		return (
			!this.disposed &&
			this.mutationAdmissionOpen &&
			!this.replacementGateHeldForStory(operation.storyId) &&
			this.hosts.get(operation.sessionId) === operation.host &&
			!this.replacementGateHeld(operation.host) &&
			this.storySessions.get(operation.storyId) === operation.sessionId &&
			this.reviewGeneration(operation.storyId) === operation.reviewGeneration
		);
	}

	private trackRefactorLifecycleOperation<T>(
		storyId: string,
		host: StoreCoreProjectHost,
		execute: (signal: AbortSignal) => Promise<T>,
		cancelled: () => T,
		publish?: (result: T) => void
	): Promise<T> {
		const sessionId = this.storySessions.get(storyId);
		if (
			!sessionId ||
			!this.mutationAdmissionOpen ||
			this.disposed ||
			this.replacementGateHeldForStory(storyId) ||
			this.replacementGateHeld(host) ||
			this.hosts.get(sessionId) !== host
		) {
			return Promise.resolve(cancelled());
		}
		const controller = new AbortController();
		const operation = {
			controller,
			host,
			promise: undefined as unknown as Promise<unknown>,
			reviewGeneration: this.reviewGeneration(storyId),
			sessionId,
			storyId
		};
		const promise = (async () => {
			if (
				!this.refactorOperationIsCurrent(operation) ||
				controller.signal.aborted
			)
				return cancelled();
			const result = await execute(controller.signal);
			if (
				!this.refactorOperationIsCurrent(operation) ||
				controller.signal.aborted
			)
				return cancelled();
			publish?.(result);
			return result;
		})();
		operation.promise = promise;
		this.refactorLifecycleOperations.add(operation);
		void promise.then(
			() => this.refactorLifecycleOperations.delete(operation),
			() => this.refactorLifecycleOperations.delete(operation)
		);
		return promise;
	}

	private async abortAndDrainRefactorLifecycle(
		predicate: (operation: {
			host: StoreCoreProjectHost;
			sessionId: string;
			storyId: string;
		}) => boolean
	) {
		const operations = [...this.refactorLifecycleOperations].filter(predicate);
		for (const operation of operations) operation.controller.abort();
		await Promise.allSettled(operations.map(operation => operation.promise));
	}

	private async drainAdmittedRefactorApplies(
		predicate: (operation: {
			host: StoreCoreProjectHost;
			sessionId: string;
			storyId: string;
		}) => boolean
	) {
		let failure: unknown;
		while (true) {
			const operations = [...this.admittedRefactorApplies].filter(predicate);
			if (operations.length === 0) break;
			const results = await Promise.allSettled(
				operations.map(operation => operation.promise)
			);
			failure ??= results.find(result => result.status === 'rejected')?.reason;
		}
		if (failure !== undefined) throw failure;
	}

	private async drainAdmittedSessionMutations(
		predicate: (operation: {
			host: StoreCoreProjectHost;
			sessionId: string;
		}) => boolean
	) {
		let failure: unknown;
		while (true) {
			const operations = [...this.admittedSessionMutations].filter(predicate);
			if (operations.length === 0) break;
			const results = await Promise.allSettled(
				operations.map(operation => operation.promise)
			);
			failure ??= results.find(result => result.status === 'rejected')?.reason;
		}
		if (failure !== undefined) throw failure;
	}

	private async acquireAndPrepareSessionReplacement(
		storyId: string,
		host: StoreCoreProjectHost
	) {
		const sessionId = this.storySessions.get(storyId);
		if (!sessionId || this.hosts.get(sessionId) !== host) {
			throw new Error('Project replacement was superseded before preparation.');
		}
		const storyIds = new Set(
			[...this.storySessions].flatMap(
				([candidateStoryId, candidateSessionId]) =>
					candidateSessionId === sessionId ? [candidateStoryId] : []
			)
		);
		const gateOwner = this.acquireSessionReplacement(host, sessionId, storyIds);

		try {
			for (const lease of new Set(this.hydratedProjectLeases.values())) {
				if (lease.host === host && lease.sessionId === sessionId) {
					await this.abortHydratedProjectLease(lease);
				}
			}
			await this.abortAndDrainRefactorLifecycle(
				operation =>
					operation.host === host && operation.sessionId === sessionId
			);
			await this.drainAdmittedRefactorApplies(
				operation =>
					operation.host === host && operation.sessionId === sessionId
			);
			await this.drainAdmittedSessionMutations(
				operation =>
					operation.host === host && operation.sessionId === sessionId
			);
			return {gateOwner, host, sessionId, storyIds};
		} catch (error) {
			await this.finalizeSessionReplacement(
				host,
				sessionId,
				storyIds,
				gateOwner
			);
			throw error;
		}
	}

	private async finalizeSessionReplacement(
		host: StoreCoreProjectHost,
		sessionId: string,
		storyIds: Set<string>,
		owner: symbol
	) {
		// Terminal paths repeat invalidation/draining: work may have been queued
		// after the first drain but before it observed the gate.
		for (const storyId of storyIds) this.closeRefactorReview(storyId);
		try {
			await this.abortAndDrainRefactorLifecycle(
				operation =>
					operation.host === host && operation.sessionId === sessionId
			);
		} finally {
			this.releaseSessionReplacement(host, storyIds, owner);
		}
	}

	private hydratedProjectLeaseForStory(
		storyId: string,
		token?: CoreHydrationLease
	) {
		const direct = this.hydratedProjectLeases.get(storyId);
		const lease =
			direct ??
			[...this.hydratedProjectLeases.values()].find(lease =>
				lease.storyIds.has(storyId)
			);
		return !token || lease?.token === token ? lease : undefined;
	}

	private async abortHydratedProjectLease(lease: {
		gateOwner: symbol;
		host: StoreCoreProjectHost;
		sessionId: string;
		storyIds: Set<string>;
		token: CoreHydrationLease;
	}) {
		for (const storyId of lease.storyIds) {
			if (this.hydratedProjectLeases.get(storyId) === lease) {
				this.hydratedProjectLeases.delete(storyId);
			}
		}
		try {
			await lease.host.abortHydratedProject([...lease.storyIds][0] ?? '');
		} finally {
			await this.finalizeSessionReplacement(
				lease.host,
				lease.sessionId,
				lease.storyIds,
				lease.gateOwner
			);
		}
	}

	drainMutations() {
		return this.abortAndDrainRefactorLifecycle(() => true).then(() =>
			this.drainAdmittedMutations()
		);
	}

	performanceDiagnostics() {
		const refactorReview = [...this.refactorReviewModels.values()].reduce(
			(total, model) => {
				const snapshot = model.snapshot();

				return {
					encodedBytes: total.encodedBytes + snapshot.encodedBytes,
					ownerCount: total.ownerCount + 1,
					pageCount: total.pageCount + snapshot.pageCount,
					summaryCount: total.summaryCount + snapshot.summaryCount
				};
			},
			{encodedBytes: 0, ownerCount: 0, pageCount: 0, summaryCount: 0}
		);
		return {
			client: this.client.performanceDiagnostics(),
			mode: this.client.mode,
			refactorReview,
			sessions: Array.from(this.hosts, ([sessionId, host]) => ({
				...host.performanceDiagnostics(),
				revision: host.sessionStatus().revision,
				sessionId,
				storyIds: Array.from(this.storySessions)
					.filter(([, candidate]) => candidate === sessionId)
					.map(([storyId]) => storyId)
			}))
		};
	}

	performanceProbeWorkerJs(action: 'release' | 'retain', bytes?: number) {
		return this.client.performanceProbeWorkerJs(action, bytes);
	}

	private refactorReviewForStory(storyId: string) {
		let model = this.refactorReviewModels.get(storyId);
		if (!model) {
			model = new RefactorReviewModel();
			this.refactorReviewModels.set(storyId, model);
		}
		return model;
	}

	refactorReviewSnapshot(storyId: string): RefactorReviewModelSnapshot {
		return (
			this.refactorReviewModels.get(storyId)?.snapshot() ?? {
				encodedBytes: 0,
				pageCount: 0,
				summaryCount: 0
			}
		);
	}

	closeRefactorReview(storyId: string) {
		this.invalidateRefactorReview(storyId);
		this.refactorReviewModels.get(storyId)?.close();
		this.refactorReviewModels.delete(storyId);
	}

	private emptyStatus(): CoreSessionStatus {
		return {
			canRedo: false,
			canUndo: false,
			dirty: false,
			redoKind: null,
			revision: 1,
			undoKind: null
		};
	}

	private hostForStory(storyId: string | undefined) {
		let sessionId = storyId ? this.storySessions.get(storyId) : undefined;
		const story = storyId
			? this.stories.find(candidate => candidate.id === storyId)
			: undefined;

		// Project metadata is stored outside React state and can change while an
		// import is preparing a replacement. Rebind synchronously before routing the
		// next command or query so it cannot mutate one session while persistence
		// materializes documents from another.
		if (
			story &&
			(sessionId !== coreSessionIdForStory(story) || bootstrapStory(story.id))
		) {
			this.update(this.stories, this.dispatch);
			sessionId = this.storySessions.get(story.id);
		}

		return sessionId ? this.hosts.get(sessionId) : undefined;
	}

	private requireHostForCommand(command: StoryCommand) {
		const storyId = commandStoryId(command);
		const host = this.hostForStory(storyId);

		if (!host) {
			throw new Error(
				`No core project session is available for ${
					storyId ? `story "${storyId}"` : `command "${command.type}"`
				}.`
			);
		}

		return host;
	}

	applyStoryCommand(command: StoryCommand, options?: CoreCommandOptions) {
		const replacementGateError = this.replacementGateErrorForCommand(command);
		if (replacementGateError) return Promise.reject(replacementGateError);
		const storyId = commandStoryId(command);
		const host = storyId ? this.hostForStory(storyId) : undefined;
		const postRoutingReplacementGateError =
			this.replacementGateErrorForCommand(command);
		if (postRoutingReplacementGateError)
			return Promise.reject(postRoutingReplacementGateError);
		const sessionId = storyId ? this.storySessions.get(storyId) : undefined;
		const sessions =
			command.type === 'renameStoryTag'
				? [...this.hosts].map(([sessionId, host]) => ({host, sessionId}))
				: host && sessionId
					? [{host, sessionId}]
					: [];
		return this.admitMutation(async () => {
			if (command.type === 'renameStoryTag') {
				return applyStoryTagRenameAcrossHosts(
					this.hosts.values(),
					command,
					options
				);
			}

			const host = this.requireHostForCommand(command);

			return options === undefined
				? host.applyStoryCommand(command)
				: host.applyStoryCommand(command, options);
		}, sessions);
	}

	applyStoryCommandPersisted(
		command: StoryCommand,
		options?: CoreCommandOptions
	) {
		const replacementGateError = this.replacementGateErrorForCommand(command);
		if (replacementGateError) return Promise.reject(replacementGateError);
		const storyId = commandStoryId(command);
		const host = storyId ? this.hostForStory(storyId) : undefined;
		const postRoutingReplacementGateError =
			this.replacementGateErrorForCommand(command);
		if (postRoutingReplacementGateError)
			return Promise.reject(postRoutingReplacementGateError);
		const sessionId = storyId ? this.storySessions.get(storyId) : undefined;
		const sessions = host && sessionId ? [{host, sessionId}] : [];
		return this.admitMutation(async () => {
			if (command.type === 'renameStoryTag') {
				throw new Error(
					'Persisted completion is only available for one project session.'
				);
			}
			return this.requireHostForCommand(command).applyStoryCommandPersisted(
				command,
				options
			);
		}, sessions);
	}

	applyRefactorPlan(storyId: string, request: RefactorPlanApplyRequest) {
		const evicted = (): RefactorPlanApplyResult => ({
			failure: {
				code: 'plan-evicted',
				message: 'This project is being replaced; retry the refactor review.'
			},
			type: 'failure'
		});
		// This check intentionally precedes hostForStory(): a metadata rebind can
		// otherwise route the apply to a fresh host while the old session is gated.
		if (this.replacementGateHeldForStory(storyId)) {
			return Promise.resolve(evicted());
		}
		if (
			this.disposed ||
			(!this.mutationAdmissionOpen &&
				!rendererQuitQuiescence.flushAdmissionActive)
		) {
			return Promise.reject(
				new Error('Core mutations are frozen while the application exits.')
			);
		}

		let resolve!: (result: RefactorPlanApplyResult) => void;
		let reject!: (reason: unknown) => void;
		const operationPromise = new Promise<RefactorPlanApplyResult>(
			(resolveOperation, rejectOperation) => {
				resolve = resolveOperation;
				reject = rejectOperation;
			}
		);
		this.admitMutation(() => operationPromise);

		const host = this.hostForStory(storyId);
		const sessionId = this.storySessions.get(storyId);
		if (!host || !sessionId) {
			reject(
				new Error(
					`No core project session is available for story "${storyId}".`
				)
			);
			return operationPromise;
		}
		if (this.replacementGateHeldForStory(storyId)) {
			resolve(evicted());
			return operationPromise;
		}
		const operation = {host, promise: operationPromise, sessionId, storyId};
		this.admittedRefactorApplies.add(operation);
		void (async () => {
			try {
				const result = await host.applyRefactorPlan(storyId, request);
				if (result.type === 'applied') this.closeRefactorReview(storyId);
				resolve(result);
			} catch (error) {
				reject(error);
			} finally {
				this.admittedRefactorApplies.delete(operation);
			}
		})();
		return operationPromise;
	}

	acquireProjectReplacement(storyId: string) {
		return this.admitMutation(async () => {
			const host = this.hostForStory(storyId);
			if (!host) throw new Error(`No core session for story ${storyId}.`);
			const transition = await this.acquireAndPrepareSessionReplacement(
				storyId,
				host
			);
			const lease = Symbol('core-project-replacement-lease');
			this.replacementReservations.set(lease, transition);
			return lease;
		});
	}

	abortProjectReplacement(
		_storyId: string,
		lease: CoreProjectReplacementLease
	) {
		return this.admitMutation(async () => {
			const transition = this.replacementReservations.get(lease);
			if (!transition) return;
			this.replacementReservations.delete(lease);
			await this.finalizeSessionReplacement(
				transition.host,
				transition.sessionId,
				transition.storyIds,
				transition.gateOwner
			);
		});
	}

	private takeProjectReplacement(
		storyId: string,
		lease?: CoreProjectReplacementLease
	) {
		if (!lease) return undefined;
		const transition = this.replacementReservations.get(lease);
		if (!transition || !transition.storyIds.has(storyId)) {
			throw new Error('Project replacement reservation is no longer active.');
		}
		this.replacementReservations.delete(lease);
		return transition;
	}

	recordRefactorExternalSession(
		storyIds: readonly string[],
		state: import('./bindings/RefactorExternalPrecondition').RefactorExternalPrecondition
	) {
		const host = this.hostForStory(storyIds[0]);
		return host
			? host.recordRefactorExternalSession(storyIds, state)
			: Promise.resolve();
	}

	clearRefactorExternalSession(
		storyIds: readonly string[],
		sessionInstanceId: string
	) {
		const host = this.hostForStory(storyIds[0]);
		return host
			? host.clearRefactorExternalSession(storyIds, sessionInstanceId)
			: Promise.resolve();
	}

	registerRefactorSemanticProvider(
		storyId: string,
		descriptor: RefactorSemanticProviderDescriptor
	) {
		const host = this.hostForStory(storyId);
		return host
			? host.registerRefactorSemanticProvider(storyId, descriptor)
			: Promise.resolve(async () => {});
	}

	planPassageRename(
		storyId: string,
		request: PlanPassageRenameRequest,
		options?: {
			onProgress?: (result: PlanPassageRenameResult) => void | Promise<void>;
			signal?: AbortSignal;
		}
	) {
		// Reject at the public router before a metadata-triggered rebind, editor
		// barrier, worker call, or lifecycle registration can do any work.
		if (isPassageRenameRequestTooLarge(request)) {
			return Promise.resolve({
				failure: {
					code: 'plan-too-large',
					message:
						'The passage rename request exceeds the 64 KiB request limit.'
				},
				type: 'failure'
			} satisfies PlanPassageRenameResult);
		}
		const host = this.hostForStory(storyId);
		if (!host) return Promise.resolve({type: 'cancelled'} as const);
		if (
			this.replacementGateHeldForStory(storyId) ||
			this.replacementGateHeld(host)
		) {
			return Promise.resolve({type: 'cancelled'} as const);
		}
		// Planning holds its editor barrier only for the synchronized begin, so do
		// not wrap the whole chunked operation in scoped mutation admission.
		return this.trackRefactorLifecycleOperation<PlanPassageRenameResult>(
			storyId,
			host,
			async signal => {
				const combined = combineAbortSignals(signal, options?.signal);
				try {
					return await host.planPassageRename(storyId, request, {
						...options,
						signal: combined.signal
					});
				} finally {
					combined.dispose();
				}
			},
			() => ({type: 'cancelled'}) as PlanPassageRenameResult,
			result => {
				if (result.type === 'complete') {
					this.refactorReviewForStory(storyId).captureSummary(result.summary);
				}
			}
		);
	}

	retryStoryPersistence(target: CorePersistenceTarget) {
		return this.admitMutation(
			() =>
				this.hostForStory(target.storyId)?.retryStoryPersistence(target) ??
				Promise.resolve(false)
		);
	}

	admitProjectStories(
		stories: StoryWithDocuments[],
		options?: CoreCommandOptions
	) {
		return this.admitMutation(async () => {
			const normalized = normalizeCommandOptions(options);
			const grouped = new Map<string, StoryWithDocuments[]>();
			const completed: Array<{
				createdHost: boolean;
				host: StoreCoreProjectHost;
				sessionId: string;
				stories: StoryWithDocuments[];
			}> = [];

			for (const story of stories) {
				if (
					this.storySessions.has(story.id) ||
					this.stories.some(candidate => candidate.id === story.id)
				) {
					throw new Error(
						`Story "${story.id}" is already bound to a core project session.`
					);
				}
				const sessionId = coreSessionIdForStory(story);

				grouped.set(sessionId, [...(grouped.get(sessionId) ?? []), story]);
			}

			let lastBatch: PatchBatch | undefined;

			try {
				for (const [sessionId, sessionStories] of grouped) {
					let host = this.hosts.get(sessionId);
					const createdHost = !host;

					if (!host) {
						host = new StoreCoreProjectHost([], this.dispatchFromCore, {
							sessionId,
							wasmClient: this.client,
							onRefactorCommitted: storyId => this.closeRefactorReview(storyId)
						});
						host.subscribeToPatches(batch =>
							this.patchListeners.forEach(listener => listener(batch))
						);
						host.subscribeToStatus(status =>
							this.statusListeners.forEach(listener => listener(status))
						);
						this.hosts.set(sessionId, host);
					}

					for (const story of sessionStories) {
						this.storySessions.set(story.id, sessionId);
					}

					try {
						lastBatch = await host.admitProjectStories(sessionStories, options);
					} catch (error) {
						const rollbackIncomplete =
							typeof error === 'object' &&
							error !== null &&
							'code' in error &&
							error.code === 'CORE_ADMISSION_ROLLBACK_INCOMPLETE';

						if (rollbackIncomplete) {
							for (const story of sessionStories) {
								this.recoveryOwnedStories.set(story.id, story);
								registerStoryMaterializer(story.id, currentStory =>
									materializeStoryFromSession(host!, currentStory)
								);
							}
							this.stories = [
								...this.stories.filter(
									story =>
										!sessionStories.some(candidate => candidate.id === story.id)
								),
								...sessionStories
							];
							throw error;
						}
						for (const story of sessionStories) {
							if (this.storySessions.get(story.id) === sessionId) {
								this.storySessions.delete(story.id);
							}
							unregisterStoryMaterializer(story.id);
						}
						if (createdHost) {
							host.disposeEffects();
							this.hosts.delete(sessionId);
							await this.client.removeSession?.(sessionId);
						}
						throw error;
					}

					for (const story of sessionStories) {
						registerStoryMaterializer(story.id, currentStory =>
							materializeStoryFromSession(host!, currentStory)
						);
					}
					this.stories = [
						...this.stories.filter(
							story =>
								!sessionStories.some(candidate => candidate.id === story.id)
						),
						...sessionStories
					];
					completed.push({
						createdHost,
						host,
						sessionId,
						stories: sessionStories
					});
				}
			} catch (error) {
				const rollbackErrors: unknown[] = [];

				for (const completedGroup of completed.reverse()) {
					const storyIds = completedGroup.stories.map(story => story.id);

					try {
						await completedGroup.host.deleteProjectStories(storyIds, {
							history: 'skip',
							persistence: normalized.persistenceBarrier ? 'save' : 'skip',
							persistenceBarrier: normalized.persistenceBarrier
						});
						for (const storyId of storyIds) {
							this.storySessions.delete(storyId);
							unregisterStoryMaterializer(storyId);
						}
						this.stories = this.stories.filter(
							story => !storyIds.includes(story.id)
						);
						if (completedGroup.createdHost) {
							completedGroup.host.disposeEffects();
							this.hosts.delete(completedGroup.sessionId);
							await this.client.removeSession?.(completedGroup.sessionId);
						}
					} catch (rollbackError) {
						for (const story of completedGroup.stories) {
							this.recoveryOwnedStories.set(story.id, story);
						}
						rollbackErrors.push(rollbackError);
					}
				}
				if (rollbackErrors.length > 0) {
					throw new AggregateError(
						[error, ...rollbackErrors],
						`Project admission failed and ${rollbackErrors.length} admitted session group${
							rollbackErrors.length === 1 ? '' : 's'
						} could not be rolled back.`,
						{cause: error}
					);
				}
				throw error;
			}

			return lastBatch;
		});
	}

	deleteProjectStories(storyIds: string[], options?: CoreCommandOptions) {
		return this.admitMutation(async () => {
			const normalized = normalizeCommandOptions(options);
			type ProjectDeletionGroup = {
				host: StoreCoreProjectHost;
				sessionId: string;
				stories: StoryWithDocuments[];
			};
			const grouped = new Map<string, ProjectDeletionGroup>();

			for (const storyId of storyIds) {
				const sessionId = this.storySessions.get(storyId);
				const host = sessionId ? this.hosts.get(sessionId) : undefined;
				const story = this.stories.find(candidate => candidate.id === storyId);

				if (!sessionId || !host || !story) {
					throw new Error(
						`No core project session is available for story "${storyId}".`
					);
				}
				const group = grouped.get(sessionId) ?? {
					host,
					sessionId,
					stories: []
				};

				group.stories.push(await materializeRegisteredStory(story));
				grouped.set(sessionId, group);
			}

			let lastBatch: PatchBatch | undefined;
			const completed: ProjectDeletionGroup[] = [];
			let activeGroup: ProjectDeletionGroup | undefined;

			try {
				for (const group of grouped.values()) {
					activeGroup = group;
					lastBatch = await group.host.deleteProjectStories(
						group.stories.map(story => story.id),
						options
					);
					completed.push(group);
					activeGroup = undefined;
				}
			} catch (error) {
				const rollbackErrors: unknown[] = [];
				const originalStories = [...grouped.values()].flatMap(
					group => group.stories
				);

				this.stories = [
					...this.stories.filter(
						story =>
							!originalStories.some(candidate => candidate.id === story.id)
					),
					...originalStories
				];
				if (
					typeof error === 'object' &&
					error !== null &&
					'code' in error &&
					error.code === 'CORE_DELETION_ROLLBACK_INCOMPLETE'
				) {
					for (const story of activeGroup?.stories ?? []) {
						this.recoveryOwnedStories.set(story.id, story);
					}
				}

				for (const group of completed.reverse()) {
					try {
						await group.host.admitProjectStories(
							group.stories,
							{
								history: 'skip',
								persistence: normalized.persistenceBarrier ? 'save' : 'skip',
								persistenceBarrier: normalized.persistenceBarrier
							},
							true
						);
					} catch (rollbackError) {
						for (const story of group.stories) {
							this.recoveryOwnedStories.set(story.id, story);
						}
						rollbackErrors.push(rollbackError);
					}
				}
				if (rollbackErrors.length > 0) {
					throw new AggregateError(
						[error, ...rollbackErrors],
						`Project deletion failed and ${rollbackErrors.length} deleted session group${
							rollbackErrors.length === 1 ? '' : 's'
						} could not be restored.`,
						{cause: error}
					);
				}
				throw error;
			}

			const deletedStoryIds = new Set(
				completed.flatMap(group => group.stories.map(story => story.id))
			);

			this.stories = this.stories.filter(
				story => !deletedStoryIds.has(story.id)
			);
			for (const storyId of deletedStoryIds) {
				this.closeRefactorReview(storyId);
				this.recoveryOwnedStories.delete(storyId);
				this.storySessions.delete(storyId);
				unregisterStoryMaterializer(storyId);
				releaseBootstrapStory(storyId);
			}
			for (const {host, sessionId} of completed) {
				if ([...this.storySessions.values()].includes(sessionId)) {
					continue;
				}
				await this.abortAndDrainRefactorLifecycle(
					operation => operation.sessionId === sessionId
				);
				if (
					this.hosts.get(sessionId) !== host ||
					[...this.storySessions.values()].includes(sessionId)
				) {
					continue;
				}
				for (const lease of new Set(this.hydratedProjectLeases.values())) {
					if (lease.sessionId === sessionId) {
						await this.abortHydratedProjectLease(lease);
					}
				}
				host.disposeEffects();
				this.hosts.delete(sessionId);
				try {
					await this.client.removeSession?.(sessionId);
				} catch (error) {
					console.error(
						`Could not remove deleted Core session "${sessionId}": ${error}`
					);
				}
			}
			return lastBatch;
		});
	}

	retireProjectStories(storyIds: string[]) {
		return this.admitMutation(async () => {
			const retiring = new Set(storyIds);
			const sessionIds = new Set<string>();

			for (const storyId of storyIds) {
				const sessionId = this.storySessions.get(storyId);

				if (sessionId) {
					sessionIds.add(sessionId);
				}
			}
			for (const [storyId, sessionId] of this.storySessions) {
				if (sessionIds.has(sessionId) && !retiring.has(storyId)) {
					throw new Error(
						`Project session "${sessionId}" cannot be partially retired.`
					);
				}
			}
			const transitions = [...sessionIds].flatMap(sessionId => {
				const host = this.hosts.get(sessionId);
				if (!host) return [];
				const sessionStoryIds = new Set(
					[...this.storySessions].flatMap(
						([candidateStoryId, candidateSessionId]) =>
							candidateSessionId === sessionId ? [candidateStoryId] : []
					)
				);
				return [
					{
						host,
						owner: this.acquireSessionReplacement(
							host,
							sessionId,
							sessionStoryIds
						),
						sessionId,
						storyIds: sessionStoryIds
					}
				];
			});
			try {
				for (const transition of transitions) {
					await this.abortAndDrainRefactorLifecycle(
						operation => operation.sessionId === transition.sessionId
					);
					await this.drainAdmittedRefactorApplies(
						operation => operation.sessionId === transition.sessionId
					);
					await this.drainAdmittedSessionMutations(
						operation => operation.sessionId === transition.sessionId
					);
				}
			} catch (error) {
				for (const transition of transitions) {
					await this.finalizeSessionReplacement(
						transition.host,
						transition.sessionId,
						transition.storyIds,
						transition.owner
					);
				}
				throw error;
			}

			this.dispatchFromCore({storyIds, type: 'retireProjectStories'});
			this.stories = this.stories.filter(story => !retiring.has(story.id));
			for (const storyId of storyIds) {
				this.closeRefactorReview(storyId);
				this.recoveryOwnedStories.delete(storyId);
				this.storySessions.delete(storyId);
				unregisterStoryMaterializer(storyId);
				releaseBootstrapStory(storyId);
			}
			for (const sessionId of sessionIds) {
				for (const lease of new Set(this.hydratedProjectLeases.values())) {
					if (lease.sessionId === sessionId) {
						await this.abortHydratedProjectLease(lease);
					}
				}
				await this.abortAndDrainRefactorLifecycle(
					operation => operation.sessionId === sessionId
				);
				this.hosts.get(sessionId)?.disposeEffects();
				this.hosts.delete(sessionId);
				try {
					await this.client.removeSession?.(sessionId);
				} catch (error) {
					// Renderer retirement is already complete. Native worker cleanup is
					// idempotent and may be retried during disposal/startup.
					console.error(
						`Could not remove retired Core session "${sessionId}": ${error}`
					);
				}
			}
			for (const transition of transitions) {
				await this.finalizeSessionReplacement(
					transition.host,
					transition.sessionId,
					transition.storyIds,
					transition.owner
				);
			}
		});
	}

	async ensureSessionReady(storyId: string) {
		const host = this.hostForStory(storyId);

		if (!host) {
			throw new Error(
				`No core project session is available for story "${storyId}".`
			);
		}
		await host.ensureSessionReady();
	}

	applyExternalDelta(storyId: string, delta: CoreExternalDelta) {
		return this.admitMutation(async () => {
			const host = this.hostForStory(storyId);

			if (!host) {
				throw new Error(
					`No core project session is available for story "${storyId}".`
				);
			}

			return host.applyExternalDelta(storyId, delta);
		});
	}

	ingestExternalDelta(
		storyId: string,
		delta: CoreExternalDelta,
		options?: {force?: boolean}
	) {
		return this.admitMutation(async () => {
			const host = this.hostForStory(storyId);

			if (!host) {
				throw new Error(
					`No core project session is available for story "${storyId}".`
				);
			}

			return host.ingestExternalDelta(storyId, delta, options);
		});
	}

	acknowledgeSaved(sessionId: string, revision: number) {
		const host = this.hosts.get(sessionId);

		return host?.acknowledgeSaved(sessionId, revision) ?? Promise.resolve();
	}

	recoverFromSnapshot(
		storyId: string,
		stories: StoryWithDocuments[],
		assets: CoreAssetInventoryEntry[],
		replacementLease?: CoreProjectReplacementLease
	) {
		return this.admitMutation(async () => {
			const host = this.hostForStory(storyId);

			if (!host) {
				throw new Error(
					`No core project session is available for story "${storyId}".`
				);
			}
			const transition =
				this.takeProjectReplacement(storyId, replacementLease) ??
				(await this.acquireAndPrepareSessionReplacement(storyId, host));
			try {
				return await host.recoverFromSnapshot(storyId, stories, assets);
			} finally {
				await this.finalizeSessionReplacement(
					transition.host,
					transition.sessionId,
					transition.storyIds,
					transition.gateOwner
				);
			}
		});
	}

	redo(storyId?: string) {
		return this.admitMutation(
			async () =>
				this.hostForStory(storyId)?.redo() ?? Promise.resolve(undefined)
		);
	}

	undo(storyId?: string) {
		return this.admitMutation(
			async () =>
				this.hostForStory(storyId)?.undo() ?? Promise.resolve(undefined)
		);
	}

	isDirty(storyId?: string) {
		const host = this.hostForStory(storyId);

		return host
			? host.isDirty()
			: [...this.hosts.values()].some(host => host.isDirty());
	}

	sessionStatus(storyId?: string) {
		return this.hostForStory(storyId)?.sessionStatus() ?? this.emptyStatus();
	}

	queryGraphProjection(storyId: string, options?: GraphProjectionQuery) {
		return (
			this.hostForStory(storyId)?.queryGraphProjection(storyId, options) ??
			emptyGraphProjection()
		);
	}

	queryGraphProjectionAsync(storyId: string, options?: GraphProjectionQuery) {
		return (
			this.hostForStory(storyId)?.queryGraphProjectionAsync(storyId, options) ??
			Promise.resolve(emptyGraphProjection())
		);
	}

	queryStoryIndex(storyId: string, options?: StoryIndexQuery) {
		return (
			this.hostForStory(storyId)?.queryStoryIndex(storyId, options) ??
			emptyStoryIndex(storyId)
		);
	}

	queryStoryIndexAsync(storyId: string, options?: StoryIndexQuery) {
		return (
			this.hostForStory(storyId)?.queryStoryIndexAsync(storyId, options) ??
			Promise.resolve(emptyStoryIndex(storyId))
		);
	}

	queryStorySummaryAsync(storyId: string) {
		return (
			this.hostForStory(storyId)?.queryStorySummaryAsync(storyId) ??
			Promise.resolve(emptyStorySummary(storyId))
		);
	}

	queryDiagnosticsSummaryAsync(
		storyId: string,
		options?: Partial<CoreDiagnosticsSummaryQuery>
	) {
		return (
			this.hostForStory(storyId)?.queryDiagnosticsSummaryAsync(
				storyId,
				options
			) ?? Promise.resolve(emptyDiagnosticsSummary(storyId))
		);
	}

	queryStoryWordCountAsync(storyId: string) {
		const host = this.hostForStory(storyId);

		if (!host) {
			return Promise.reject(
				new Error(
					`No core project session is available for story "${storyId}".`
				)
			);
		}
		return host.queryStoryWordCountAsync(storyId);
	}

	queryWorkbenchDockModelAsync(storyId: string) {
		return (
			this.hostForStory(storyId)?.queryWorkbenchDockModelAsync(storyId) ??
			Promise.resolve({
				assets: {
					assets: [],
					nextCursor: null,
					revision: 0,
					storyId,
					totalCount: 0
				},
				contents: emptyContentsPage(storyId),
				diagnostics: {
					diagnostics: [],
					nextCursor: null,
					revision: 0,
					storyId,
					totalCount: 0
				},
				revision: 0,
				storyId,
				summary: emptyStorySummary(storyId)
			} satisfies CoreWorkbenchDockModel)
		);
	}

	queryContentsPageAsync(
		storyId: string,
		options?: Partial<CoreContentsQuery>
	) {
		return (
			this.hostForStory(storyId)?.queryContentsPageAsync(storyId, options) ??
			Promise.resolve(emptyContentsPage(storyId))
		);
	}

	querySearchPageAsync(storyId: string, options: Partial<CoreSearchQuery>) {
		return (
			this.hostForStory(storyId)?.querySearchPageAsync(storyId, options) ??
			Promise.resolve({
				nextCursor: null,
				replacePreviews: [],
				revision: 0,
				searchHits: [],
				storyId,
				totalCount: 0
			} satisfies CoreSearchPage)
		);
	}

	queryDiagnosticsPageAsync(
		storyId: string,
		options?: Partial<CoreDiagnosticsQuery>
	) {
		return (
			this.hostForStory(storyId)?.queryDiagnosticsPageAsync(storyId, options) ??
			Promise.resolve({
				diagnostics: [],
				nextCursor: null,
				revision: 0,
				storyId,
				totalCount: 0
			} satisfies CoreDiagnosticsPage)
		);
	}

	queryDocumentPageAsync(
		storyId: string,
		options?: Partial<CoreDocumentQuery>
	) {
		const host = this.hostForStory(storyId);
		if (!host) {
			return Promise.reject(new Error(`No core session for story ${storyId}.`));
		}
		return host.queryDocumentPageAsync(storyId, options);
	}

	queryAssetsPageAsync(storyId: string, options?: Partial<CoreAssetsQuery>) {
		return (
			this.hostForStory(storyId)?.queryAssetsPageAsync(storyId, options) ??
			Promise.resolve({
				assets: [],
				nextCursor: null,
				revision: 0,
				storyId,
				totalCount: 0
			} satisfies CoreAssetsPage)
		);
	}

	queryPassageFactsAsync(storyId: string, passageId: string) {
		return (
			this.hostForStory(storyId)?.queryPassageFactsAsync(storyId, passageId) ??
			Promise.resolve({
				assetReferences: [],
				backlinks: [],
				characterCount: 0,
				diagnostics: [],
				excerpt: '',
				isEmpty: true,
				lineCount: 1,
				links: [],
				passageId,
				revision: 0,
				storyId,
				symbols: [],
				wordCount: 0
			} satisfies CorePassageFacts)
		);
	}

	queryPassageLocalFactsAsync(storyId: string, passageId: string) {
		return (
			this.hostForStory(storyId)?.queryPassageLocalFactsAsync(
				storyId,
				passageId
			) ??
			Promise.resolve({
				assetReferences: [],
				characterCount: 0,
				diagnostics: [],
				excerpt: '',
				isEmpty: true,
				lineCount: 1,
				links: [],
				passageId,
				revision: 0,
				storyId,
				symbols: [],
				wordCount: 0
			} satisfies CorePassageLocalFacts)
		);
	}

	queryBacklinksPageAsync(
		storyId: string,
		passageId: string,
		options?: Partial<CoreBacklinksQuery>
	) {
		return (
			this.hostForStory(storyId)?.queryBacklinksPageAsync(
				storyId,
				passageId,
				options
			) ??
			Promise.resolve({
				backlinks: [],
				nextCursor: null,
				passageId,
				revision: 0,
				storyId,
				totalCount: 0
			} satisfies CoreBacklinksPage)
		);
	}

	queryPassageDocumentAsync(storyId: string, passageId: string) {
		const host = this.hostForStory(storyId);
		if (!host) {
			return Promise.reject(new Error(`No core session for story ${storyId}.`));
		}
		return host.queryPassageDocumentAsync(storyId, passageId);
	}

	querySourceDocumentAsync(storyId: string, kind: 'script' | 'stylesheet') {
		const host = this.hostForStory(storyId);
		if (!host) {
			return Promise.reject(new Error(`No core session for story ${storyId}.`));
		}
		return host.querySourceDocumentAsync(storyId, kind);
	}

	queryRefactorPlanDetailAsync(storyId: string, cursor: RefactorPlanCursor) {
		const host = this.hostForStory(storyId);
		if (
			!host ||
			this.replacementGateHeldForStory(storyId) ||
			this.replacementGateHeld(host)
		) {
			return Promise.resolve({
				failure: {
					code: 'plan-evicted',
					message: 'The refactor review is no longer available.'
				},
				type: 'failure'
			} satisfies RefactorPlanDetailResult);
		}
		return this.trackRefactorLifecycleOperation<RefactorPlanDetailResult>(
			storyId,
			host,
			async () => {
				const result = await host.queryRefactorPlanDetailAsync(storyId, cursor);
				return result;
			},
			() =>
				({
					failure: {
						code: 'plan-evicted',
						message: 'The refactor review is no longer available.'
					},
					type: 'failure'
				}) satisfies RefactorPlanDetailResult,
			result => {
				if (result.type === 'page') {
					this.refactorReviewForStory(storyId).capturePage(cursor, result.page);
				}
			}
		);
	}

	initializeHydratedProject(
		storyId: string,
		stories: Story[],
		replacementLease?: CoreProjectReplacementLease
	) {
		return this.admitMutation(async () => {
			const host = this.hostForStory(storyId);
			if (!host) {
				throw new Error(`No core session for story ${storyId}.`);
			}
			const transition =
				this.takeProjectReplacement(storyId, replacementLease) ??
				(await this.acquireAndPrepareSessionReplacement(storyId, host));
			try {
				return await host.initializeHydratedProject(storyId, stories);
			} finally {
				await this.finalizeSessionReplacement(
					transition.host,
					transition.sessionId,
					transition.storyIds,
					transition.gateOwner
				);
			}
		});
	}

	beginHydratedProject(
		storyId: string,
		stories: Story[],
		replacementLease?: CoreProjectReplacementLease
	) {
		return this.admitMutation(async () => {
			const host = this.hostForStory(storyId);
			if (!host) {
				throw new Error(`No core session for story ${storyId}.`);
			}
			const transition =
				this.takeProjectReplacement(storyId, replacementLease) ??
				(await this.acquireAndPrepareSessionReplacement(storyId, host));
			try {
				for (const lease of new Set(this.hydratedProjectLeases.values())) {
					if (
						lease.host === transition.host &&
						lease.sessionId === transition.sessionId
					) {
						await this.abortHydratedProjectLease(lease);
					}
				}
				await host.beginHydratedProject(storyId, stories);
			} catch (error) {
				await host.abortHydratedProject(storyId).catch(() => undefined);
				await this.finalizeSessionReplacement(
					transition.host,
					transition.sessionId,
					transition.storyIds,
					transition.gateOwner
				);
				throw error;
			}
			const sessionId = this.storySessions.get(storyId);
			if (!sessionId || this.hosts.get(sessionId) !== host) {
				await host.abortHydratedProject(storyId);
				await this.finalizeSessionReplacement(
					transition.host,
					transition.sessionId,
					transition.storyIds,
					transition.gateOwner
				);
				throw new Error(
					'Project hydration was superseded before streaming began.'
				);
			}
			const lease = {
				gateOwner: transition.gateOwner,
				host,
				sessionId,
				storyIds: new Set(transition.storyIds),
				token: Symbol('core-hydration-lease')
			};
			for (const leaseStoryId of lease.storyIds) {
				this.hydratedProjectLeases.set(leaseStoryId, lease);
			}
			return lease.token;
		});
	}

	appendHydratedProjectPassages(
		storyId: string,
		passages: PassageWithText[],
		token?: CoreHydrationLease
	) {
		return this.admitMutation(async () => {
			const lease = this.hydratedProjectLeaseForStory(storyId, token);
			if (
				!lease ||
				this.hydratedProjectLeases.get(storyId) !== lease ||
				this.hosts.get(lease.sessionId) !== lease.host
			) {
				throw new Error(
					'Project hydration stream is no longer active; retry hydration.'
				);
			}
			return lease.host.appendHydratedProjectPassages(storyId, passages);
		});
	}

	finishHydratedProject(storyId: string, token?: CoreHydrationLease) {
		return this.admitMutation(async () => {
			const lease = this.hydratedProjectLeaseForStory(storyId, token);
			if (
				!lease ||
				this.hydratedProjectLeases.get(storyId) !== lease ||
				this.hosts.get(lease.sessionId) !== lease.host
			) {
				throw new Error(
					'Project hydration stream is no longer active; retry hydration.'
				);
			}
			try {
				await lease.host.finishHydratedProject(storyId);
			} finally {
				for (const leaseStoryId of lease.storyIds) {
					if (this.hydratedProjectLeases.get(leaseStoryId) === lease) {
						this.hydratedProjectLeases.delete(leaseStoryId);
					}
				}
				await this.finalizeSessionReplacement(
					lease.host,
					lease.sessionId,
					lease.storyIds,
					lease.gateOwner
				);
			}
		});
	}

	abortHydratedProject(storyId: string, token?: CoreHydrationLease) {
		return this.admitMutation(async () => {
			const lease = this.hydratedProjectLeaseForStory(storyId, token);
			if (!lease) return;
			await this.abortHydratedProjectLease(lease);
		});
	}

	runtimeMode() {
		return this.client.mode;
	}

	subscribeToPatches(listener: CoreProjectPatchListener) {
		this.patchListeners.add(listener);
		return () => this.patchListeners.delete(listener);
	}

	subscribeToStatus(listener: (status: CoreSessionStatus) => void) {
		this.statusListeners.add(listener);
		return () => this.statusListeners.delete(listener);
	}

	private beginStoryRebind(storyId: string, sessionId: string) {
		if (this.pendingStoryRebinds.has(storyId)) return false;
		const host = this.hosts.get(sessionId);
		if (!host) return false;
		const storyIds = new Set(
			[...this.storySessions].flatMap(
				([candidateStoryId, candidateSessionId]) =>
					candidateSessionId === sessionId ? [candidateStoryId] : []
			)
		);
		const owner = this.acquireSessionReplacement(host, sessionId, storyIds);
		const publishImmediately =
			![...this.refactorLifecycleOperations].some(
				operation =>
					operation.host === host && operation.sessionId === sessionId
			) &&
			![...this.admittedRefactorApplies].some(
				operation =>
					operation.host === host && operation.sessionId === sessionId
			) &&
			![...this.admittedSessionMutations].some(
				operation =>
					operation.host === host && operation.sessionId === sessionId
			);
		const rebind = {host, owner, publishImmediately, sessionId, storyIds};
		this.pendingStoryRebinds.set(storyId, rebind);
		void (async () => {
			try {
				await this.abortAndDrainRefactorLifecycle(
					operation =>
						operation.host === host && operation.sessionId === sessionId
				);
				await this.drainAdmittedRefactorApplies(
					operation =>
						operation.host === host && operation.sessionId === sessionId
				);
				await this.drainAdmittedSessionMutations(
					operation =>
						operation.host === host && operation.sessionId === sessionId
				);
			} catch (error) {
				console.error(
					`Could not drain Core rebind for story "${storyId}": ${error}`
				);
			} finally {
				this.pendingStoryRebinds.delete(storyId);
				await this.finalizeSessionReplacement(host, sessionId, storyIds, owner);
				if (!this.disposed) this.update(this.stories, this.dispatch);
			}
		})();
		return publishImmediately;
	}

	update(stories: StoriesState, dispatch: UndoableDispatch) {
		const retainedStories = [...this.recoveryOwnedStories.values()];
		const effectiveStories = [
			...stories.filter(story => !this.recoveryOwnedStories.has(story.id)),
			...retainedStories
		];

		const immediatelyPublishedRebinds = new Set<string>();
		for (const story of effectiveStories) {
			const previousSessionId = this.storySessions.get(story.id);
			if (
				previousSessionId &&
				previousSessionId !== coreSessionIdForStory(story) &&
				!this.pendingStoryRebinds.has(story.id)
			) {
				if (this.beginStoryRebind(story.id, previousSessionId)) {
					immediatelyPublishedRebinds.add(story.id);
				}
			}
		}
		this.stories = effectiveStories;
		this.dispatch = dispatch;
		const grouped = new Map<string, Story[]>();
		const previousStorySessions = this.storySessions;

		this.storySessions = new Map();
		for (const story of effectiveStories) {
			const pendingRebind = this.pendingStoryRebinds.get(story.id);
			const sessionId =
				pendingRebind &&
				!pendingRebind.publishImmediately &&
				!immediatelyPublishedRebinds.has(story.id)
					? pendingRebind.sessionId
					: coreSessionIdForStory(story);

			this.storySessions.set(story.id, sessionId);
			grouped.set(sessionId, [...(grouped.get(sessionId) ?? []), story]);
		}

		for (const [sessionId, sessionStories] of grouped) {
			let host = this.hosts.get(sessionId);

			if (!host) {
				const initialStories = sessionStories.map(
					story => bootstrapStory(story.id) ?? story
				);

				host = new StoreCoreProjectHost(initialStories, this.dispatchFromCore, {
					sessionId,
					wasmClient: this.client,
					onRefactorCommitted: storyId => this.closeRefactorReview(storyId)
				});
				host.subscribeToPatches(batch =>
					this.patchListeners.forEach(listener => listener(batch))
				);
				host.subscribeToStatus(status =>
					this.statusListeners.forEach(listener => listener(status))
				);
				this.hosts.set(sessionId, host);
			} else if (
				!sessionStories.some(
					story =>
						this.pendingStoryRebinds.has(story.id) &&
						!this.pendingStoryRebinds.get(story.id)?.publishImmediately &&
						!immediatelyPublishedRebinds.has(story.id)
				)
			) {
				host.update(sessionStories, this.dispatchFromCore);
			}

			for (const story of sessionStories) {
				registerStoryMaterializer(story.id, currentStory =>
					materializeStoryFromSession(host!, currentStory)
				);
			}
		}
		for (const [storyId, previousSessionId] of previousStorySessions) {
			if (this.storySessions.get(storyId) !== previousSessionId) {
				this.closeRefactorReview(storyId);
			}
			if (!this.storySessions.has(storyId)) {
				unregisterStoryMaterializer(storyId);
			}
		}

		for (const [sessionId] of this.hosts) {
			if (!grouped.has(sessionId)) {
				const obsolete = this.hosts.get(sessionId);
				const finalizeRetirement = async () => {
					if (
						this.hosts.get(sessionId) !== obsolete ||
						[...this.storySessions.values()].includes(sessionId)
					) {
						return;
					}
					await this.abortAndDrainRefactorLifecycle(
						operation => operation.sessionId === sessionId
					);
					if (
						this.hosts.get(sessionId) !== obsolete ||
						[...this.storySessions.values()].includes(sessionId)
					) {
						return;
					}
					for (const lease of new Set(this.hydratedProjectLeases.values())) {
						if (lease.sessionId === sessionId) {
							await this.abortHydratedProjectLease(lease);
						}
					}
					obsolete?.disposeEffects();
					this.hosts.delete(sessionId);
					void this.client.removeSession?.(sessionId);
				};

				// The mutation caller owns any rejection. Session retirement must still
				// complete after it, but must not remove a session reintroduced while the
				// admitted operation was draining.
				void this.drainAdmittedMutations().then(
					finalizeRetirement,
					finalizeRetirement
				);
			}
		}
	}

	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		this.mutationAdmissionOpen = false;
		for (const operation of this.refactorLifecycleOperations) {
			operation.controller.abort();
		}
		for (const storyId of this.refactorReviewModels.keys()) {
			this.closeRefactorReview(storyId);
		}
		const finalizeDisposal = async () => {
			if (this.refactorLifecycleOperations.size > 0) {
				await this.abortAndDrainRefactorLifecycle(() => true);
			}
			this.unregisterQuitWorkflow();
			for (const storyId of this.storySessions.keys()) {
				unregisterStoryMaterializer(storyId);
			}
			for (const lease of new Set(this.hydratedProjectLeases.values())) {
				await this.abortHydratedProjectLease(lease).catch(() => undefined);
			}
			for (const [lease, transition] of this.replacementReservations) {
				this.replacementReservations.delete(lease);
				await this.finalizeSessionReplacement(
					transition.host,
					transition.sessionId,
					transition.storyIds,
					transition.gateOwner
				).catch(() => undefined);
			}
			for (const host of this.hosts.values()) {
				host.disposeEffects();
			}
			this.hosts.clear();
			this.storySessions.clear();
			this.client.dispose();
		};
		// Disposal is terminal even when an admitted operation rejects. The
		// operation's own promise reports that failure to its caller.
		void this.drainAdmittedMutations().then(finalizeDisposal, finalizeDisposal);
		projectScopedCoreHosts.delete(this);
	}
}

export function coreProjectHostPerformanceSnapshot() {
	const hosts = [...projectScopedCoreHosts].map(host =>
		host.performanceDiagnostics()
	);

	return {
		activeSessions: hosts.reduce(
			(total, host) => total + host.sessions.length,
			0
		),
		bootstrap: bootstrapStoryPerformanceDiagnostics(),
		hosts,
		workerClients: hosts.length
	};
}

// The Electron performance harness is installed only behind the native
// TWINE_PERF bridge. Keep this as a narrow operation gateway: it delegates to
// the currently mounted project-scoped host and never accepts canonical
// changes, patches, or runtime preconditions from benchmark code.
let performanceHarnessHost: ProjectScopedCoreProjectHost | undefined;

export function coreProjectHostPerformanceHarness() {
	if (!performanceHarnessHost) {
		throw new Error(
			'No live project-scoped host is available for performance.'
		);
	}

	return {
		applyRefactorPlan: (storyId: string, request: RefactorPlanApplyRequest) =>
			performanceHarnessHost!.applyRefactorPlan(storyId, request),
		closeRefactorReview: (storyId: string) =>
			performanceHarnessHost!.closeRefactorReview(storyId),
		planPassageRename: (
			storyId: string,
			request: PlanPassageRenameRequest,
			options?: {
				onProgress?: (result: PlanPassageRenameResult) => void | Promise<void>;
				signal?: AbortSignal;
			}
		) => performanceHarnessHost!.planPassageRename(storyId, request, options),
		performanceProbeWorkerJs: (action: 'release' | 'retain', bytes?: number) =>
			performanceHarnessHost!.performanceProbeWorkerJs(action, bytes),
		queryDiagnosticsSummaryAsync: (
			storyId: string,
			options?: Partial<CoreDiagnosticsSummaryQuery>
		) => performanceHarnessHost!.queryDiagnosticsSummaryAsync(storyId, options),
		queryRefactorPlanDetailAsync: (
			storyId: string,
			cursor: RefactorPlanCursor
		) => performanceHarnessHost!.queryRefactorPlanDetailAsync(storyId, cursor),
		refactorReviewSnapshot: (storyId: string) =>
			performanceHarnessHost!.refactorReviewSnapshot(storyId)
	};
}

export function useCoreProjectHost() {
	const host = React.useContext(CoreProjectHostContext);

	if (!host) {
		throw new Error(
			'useCoreProjectHost must be used within a CoreProjectHostProvider.'
		);
	}

	return host;
}

// Keep the React context a capability object, not the mutable implementation.
// The list is deliberately exhaustive so adding an interface member requires an
// explicit public-surface decision instead of accidentally exposing a prototype.
const coreProjectHostFacadeMethods: ReadonlyArray<keyof CoreProjectHost> = [
	'acknowledgeSaved',
	'acquireProjectReplacement',
	'admitProjectStories',
	'appendHydratedProjectPassages',
	'abortHydratedProject',
	'abortProjectReplacement',
	'applyExternalDelta',
	'applyRefactorPlan',
	'applyStoryCommand',
	'applyStoryCommandPersisted',
	'beginHydratedProject',
	'closeRefactorReview',
	'deleteProjectStories',
	'drainMutations',
	'ensureSessionReady',
	'finishHydratedProject',
	'ingestExternalDelta',
	'initializeHydratedProject',
	'isDirty',
	'planPassageRename',
	'queryAssetsPageAsync',
	'queryBacklinksPageAsync',
	'queryContentsPageAsync',
	'queryDiagnosticsPageAsync',
	'queryDiagnosticsSummaryAsync',
	'queryDocumentPageAsync',
	'queryGraphProjection',
	'queryGraphProjectionAsync',
	'queryPassageDocumentAsync',
	'queryPassageFactsAsync',
	'queryPassageLocalFactsAsync',
	'queryRefactorPlanDetailAsync',
	'querySearchPageAsync',
	'querySourceDocumentAsync',
	'queryStoryIndex',
	'queryStoryIndexAsync',
	'queryStorySummaryAsync',
	'queryStoryWordCountAsync',
	'queryWorkbenchDockModelAsync',
	'recoverFromSnapshot',
	'redo',
	'retireProjectStories',
	'retryStoryPersistence',
	'runtimeMode',
	'sessionStatus',
	'subscribeToPatches',
	'subscribeToStatus',
	'undo'
];

function publicCoreProjectHostFacade(host: CoreProjectHost): CoreProjectHost {
	const facade = Object.fromEntries(
		coreProjectHostFacadeMethods.map(name => [
			name,
			(...args: unknown[]) =>
				Reflect.apply(
					host[name] as (...values: unknown[]) => unknown,
					host,
					args
				)
		])
	) as unknown as CoreProjectHost;
	return Object.freeze(facade);
}

/** Review/editor capability: trusted runtime writers are deliberately absent. */
export type CoreProjectSession = CoreProjectHost;

export function useCoreProjectSession(storyId: string | undefined) {
	const host = useCoreProjectHost();

	return React.useMemo<CoreProjectSession>(
		() =>
			Object.freeze({
				...host,
				acknowledgeSaved: (sessionId, revision) =>
					host.acknowledgeSaved(sessionId, revision),
				applyExternalDelta: (deltaStoryId, delta) =>
					host.applyExternalDelta(deltaStoryId, delta),
				ingestExternalDelta: (deltaStoryId, delta, options) =>
					host.ingestExternalDelta(deltaStoryId, delta, options),
				applyStoryCommand: (command, options) =>
					host.applyStoryCommand(command, options),
				applyStoryCommandPersisted: (command, options) =>
					host.applyStoryCommandPersisted(command, options),
				applyRefactorPlan: (refactorStoryId, request) =>
					host.applyRefactorPlan(refactorStoryId, request),
				closeRefactorReview: reviewStoryId =>
					host.closeRefactorReview(reviewStoryId),
				retryStoryPersistence: target => host.retryStoryPersistence(target),
				admitProjectStories: (stories, options) =>
					host.admitProjectStories(stories, options),
				deleteProjectStories: (storyIds, options) =>
					host.deleteProjectStories(storyIds, options),
				drainMutations: () => host.drainMutations(),
				retireProjectStories: storyIds => host.retireProjectStories(storyIds),
				ensureSessionReady: readyStoryId =>
					host.ensureSessionReady(readyStoryId),
				beginHydratedProject: (readyStoryId, stories, replacementLease) =>
					host.beginHydratedProject(readyStoryId, stories, replacementLease),
				acquireProjectReplacement: readyStoryId =>
					host.acquireProjectReplacement(readyStoryId),
				abortProjectReplacement: (readyStoryId, replacementLease) =>
					host.abortProjectReplacement(readyStoryId, replacementLease),
				appendHydratedProjectPassages: (readyStoryId, passages, lease) =>
					host.appendHydratedProjectPassages(readyStoryId, passages, lease),
				finishHydratedProject: (readyStoryId, lease) =>
					host.finishHydratedProject(readyStoryId, lease),
				abortHydratedProject: (readyStoryId, lease) =>
					host.abortHydratedProject(readyStoryId, lease),
				initializeHydratedProject: (readyStoryId, stories, replacementLease) =>
					host.initializeHydratedProject(
						readyStoryId,
						stories,
						replacementLease
					),
				isDirty: () => host.isDirty(storyId),
				queryGraphProjection: (queryStoryId, options) =>
					host.queryGraphProjection(queryStoryId, options),
				queryGraphProjectionAsync: (queryStoryId, options) =>
					host.queryGraphProjectionAsync(queryStoryId, options),
				queryStoryIndex: (queryStoryId, options) =>
					host.queryStoryIndex(queryStoryId, options),
				queryStoryIndexAsync: (queryStoryId, options) =>
					host.queryStoryIndexAsync(queryStoryId, options),
				queryStorySummaryAsync: queryStoryId =>
					host.queryStorySummaryAsync(queryStoryId),
				queryDiagnosticsSummaryAsync: (queryStoryId, options) =>
					host.queryDiagnosticsSummaryAsync(queryStoryId, options),
				queryStoryWordCountAsync: queryStoryId =>
					host.queryStoryWordCountAsync(queryStoryId),
				queryWorkbenchDockModelAsync: queryStoryId =>
					host.queryWorkbenchDockModelAsync(queryStoryId),
				queryContentsPageAsync: (queryStoryId, options) =>
					host.queryContentsPageAsync(queryStoryId, options),
				querySearchPageAsync: (queryStoryId, options) =>
					host.querySearchPageAsync(queryStoryId, options),
				queryDiagnosticsPageAsync: (queryStoryId, options) =>
					host.queryDiagnosticsPageAsync(queryStoryId, options),
				queryDocumentPageAsync: (queryStoryId, options) =>
					host.queryDocumentPageAsync(queryStoryId, options),
				queryAssetsPageAsync: (queryStoryId, options) =>
					host.queryAssetsPageAsync(queryStoryId, options),
				queryPassageFactsAsync: (queryStoryId, passageId) =>
					host.queryPassageFactsAsync(queryStoryId, passageId),
				queryPassageLocalFactsAsync: (queryStoryId, passageId) =>
					host.queryPassageLocalFactsAsync(queryStoryId, passageId),
				queryBacklinksPageAsync: (queryStoryId, passageId, options) =>
					host.queryBacklinksPageAsync(queryStoryId, passageId, options),
				queryPassageDocumentAsync: (queryStoryId, passageId) =>
					host.queryPassageDocumentAsync(queryStoryId, passageId),
				querySourceDocumentAsync: (queryStoryId, kind) =>
					host.querySourceDocumentAsync(queryStoryId, kind),
				queryRefactorPlanDetailAsync: (queryStoryId, cursor) =>
					host.queryRefactorPlanDetailAsync(queryStoryId, cursor),
				recoverFromSnapshot: (
					recoveryStoryId,
					recoveryStories,
					assets,
					replacementLease
				) =>
					host.recoverFromSnapshot(
						recoveryStoryId,
						recoveryStories,
						assets,
						replacementLease
					),
				redo: () => host.redo(storyId),
				runtimeMode: () => host.runtimeMode(),
				sessionStatus: () => host.sessionStatus(storyId),
				subscribeToPatches: listener => host.subscribeToPatches(listener),
				subscribeToStatus: listener =>
					host.subscribeToStatus(() => listener(host.sessionStatus(storyId))),
				undo: () => host.undo(storyId)
			} satisfies CoreProjectSession),
		[host, storyId]
	);
}

export const CoreProjectHostProvider: React.FC<React.PropsWithChildren> = ({
	children
}) => {
	const {dispatch, stories} = useStoriesContext();
	const [host, setHost] = React.useState<ProjectScopedCoreProjectHost>();
	const committedState = React.useRef({dispatch, stories});
	const hostRef = React.useRef<ProjectScopedCoreProjectHost | undefined>(
		undefined
	);

	React.useInsertionEffect(() => {
		committedState.current = {dispatch, stories};
		hostRef.current?.update(stories, action => dispatch(action));
	}, [dispatch, stories]);

	React.useLayoutEffect(() => {
		const committed = committedState.current;
		const nextHost = new ProjectScopedCoreProjectHost(
			committed.stories,
			action => committed.dispatch(action)
		);

		hostRef.current = nextHost;
		performanceHarnessHost = nextHost;
		setHost(nextHost);

		return () => {
			if (hostRef.current === nextHost) {
				hostRef.current = undefined;
			}
			if (performanceHarnessHost === nextHost) {
				performanceHarnessHost = undefined;
			}
			nextHost.dispose();
		};
	}, []);

	const runtimeWriter = React.useMemo(
		() =>
			host
				? {
						clearExternalSession: (
							storyIds: readonly string[],
							sessionInstanceId: string
						) => host.clearRefactorExternalSession(storyIds, sessionInstanceId),
						recordExternalSession: (
							storyIds: readonly string[],
							state: import('./bindings/RefactorExternalPrecondition').RefactorExternalPrecondition
						) => host.recordRefactorExternalSession(storyIds, state),
						registerSemanticProvider: (
							storyId: string,
							descriptor: RefactorSemanticProviderDescriptor
						) => host.registerRefactorSemanticProvider(storyId, descriptor)
					}
				: undefined,
		[host]
	);
	const publicHost = React.useMemo(
		() => (host ? publicCoreProjectHostFacade(host) : undefined),
		[host]
	);

	if (!host) {
		return null;
	}

	return (
		<RefactorRuntimeWriterContext.Provider value={runtimeWriter}>
			<CoreProjectHostContext.Provider value={publicHost}>
				{children}
			</CoreProjectHostContext.Provider>
		</RefactorRuntimeWriterContext.Provider>
	);
};
