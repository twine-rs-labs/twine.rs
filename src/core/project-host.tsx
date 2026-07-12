import * as React from 'react';
import type {CoreAssetInventoryEntry} from './bindings/CoreAssetInventoryEntry';
import type {CoreAssetsPage} from './bindings/CoreAssetsPage';
import type {CoreAssetsQuery} from './bindings/CoreAssetsQuery';
import type {CoreContentsPage} from './bindings/CoreContentsPage';
import type {CoreContentsQuery} from './bindings/CoreContentsQuery';
import type {CoreDiagnosticsPage} from './bindings/CoreDiagnosticsPage';
import type {CoreDiagnosticsQuery} from './bindings/CoreDiagnosticsQuery';
import type {CoreDocumentPage} from './bindings/CoreDocumentPage';
import type {CoreDocumentQuery} from './bindings/CoreDocumentQuery';
import type {CoreExternalDelta} from './bindings/CoreExternalDelta';
import type {CoreExternalIngestResult} from './bindings/CoreExternalIngestResult';
import type {CoreGraphProjection} from './bindings/CoreGraphProjection';
import type {CorePassageFacts} from './bindings/CorePassageFacts';
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
	projectSnapshotFromStories
} from './project-snapshot';
import {
	bootstrapStory,
	metadataStory,
	registerStoryMaterializer,
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
	Passage,
	StoriesActionOrThunk,
	StoriesState,
	Story,
	useStoriesContext
} from '../store/stories';
import {loadProjectMetadata} from '../store/project-metadata';
import type {ProjectFolderSaveHint} from '../store/persistence/project-folder-save-hints';
import type {TwineElectronWindow} from '../electron/shared';
import {
	markPerformance,
	measurePerformance,
	measurePerformanceAfterPaint,
	recordPerformanceHarnessEvent
} from '../util/performance';

export type StoryIndexQuery = string | Partial<CoreStoryIndexOptions>;
const defaultCoreSessionId = 'library';

export type CoreProjectPatchListener = (patches: PatchBatch) => void;
export interface CoreCommandHistoryOptions {
	annotation?: string;
	effectToken?: string;
	history?: 'record' | 'skip';
}
export type CoreCommandOptions = string | CoreCommandHistoryOptions;

export interface CoreProjectHost {
	appendHydratedProjectPassages(
		storyId: string,
		passages: Passage[]
	): Promise<void>;
	beginHydratedProject(storyId: string, stories: Story[]): Promise<void>;
	finishHydratedProject(storyId: string): Promise<void>;
	applyExternalDelta(
		storyId: string,
		delta: CoreExternalDelta
	): Promise<PatchBatch | undefined>;
	applyStoryCommand(
		command: StoryCommand,
		options?: CoreCommandOptions
	): Promise<PatchBatch | undefined>;
	ensureSessionReady(storyId: string): Promise<void>;
	initializeHydratedProject(storyId: string, stories: Story[]): Promise<void>;
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
	queryPassageDocumentAsync(
		storyId: string,
		passageId: string
	): Promise<CorePassageDocument>;
	querySourceDocumentAsync(
		storyId: string,
		kind: 'script' | 'stylesheet'
	): Promise<CoreSourceDocument>;
	recoverFromSnapshot(
		storyId: string,
		stories: Story[],
		assets: CoreAssetInventoryEntry[]
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
	| 'beginProjectBootstrap'
	| 'cachedContentsPage'
	| 'ingestExternalDelta'
	| 'cachedGraphProjection'
	| 'cachedStoryIndex'
	| 'enabled'
	| 'lastGraphProjection'
	| 'mode'
	| 'queryGraphProjection'
	| 'queryStoryIndex'
	| 'queryStorySummary'
	| 'queryContentsPage'
	| 'querySearchPage'
	| 'queryDiagnosticsPage'
	| 'queryDocumentPage'
	| 'queryAssetsPage'
	| 'queryPassageFacts'
	| 'queryPassageDocument'
	| 'querySourceDocument'
	| 'redo'
	| 'finishProjectBootstrap'
	| 'replaceProject'
	| 'undo'
> & {
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
const defaultDocumentQuery: CoreDocumentQuery = {cursor: null, limit: 250};
const defaultAssetsQuery: CoreAssetsQuery = {
	cursor: null,
	limit: 100,
	query: null
};
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
				history: options?.history ?? 'record'
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
					addFull(patch.story_id, 'passage layout changed');
					break;
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

function contentsFacetsFromEntries(entries: CoreContentsPage['entries']) {
	const facets = emptyContentsPage('').facets;

	for (const entry of entries) {
		facets.all += 1;
		switch (entry.kind) {
			case 'asset':
				facets.asset += 1;
				break;
			case 'entryPoint':
				facets.entryPoint += 1;
				break;
			case 'group':
				facets.group += 1;
				break;
			case 'metadata':
				facets.metadata += 1;
				break;
			case 'passage':
				facets.passage += 1;
				break;
			case 'script':
				facets.script += 1;
				break;
			case 'stylesheet':
				facets.stylesheet += 1;
				break;
			case 'tag':
				facets.tag += 1;
				break;
			case 'variable':
				facets.variable += 1;
				break;
			case 'brokenLink':
			case 'diagnostic':
			case 'orphan':
				facets.diagnostics += 1;
		}
		if (entry.severity) {
			facets.problems += 1;
		}
	}

	return facets;
}

export class StoreCoreProjectHost implements CoreProjectHost {
	private assetInventoryByStory = sharedAssetInventoryByStory;
	private dirty = false;
	private dispatch: UndoableDispatch;
	private listeners = new Set<CoreProjectPatchListener>();
	private mutationQueue: Promise<void> = Promise.resolve();
	private ownsWasmClient: boolean;
	private redoEffects: Array<string | undefined> = [];
	private statusListeners = new Set<(status: CoreSessionStatus) => void>();
	private undoEffects: Array<string | undefined> = [];
	private pendingSessionPatchDispatches = 0;
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
		this.ownsWasmClient = !options.wasmClient;
		this.wasmClient = options.wasmClient ?? createWasmCoreWorkerClient();
	}

	async applyStoryCommand(
		command: StoryCommand,
		options?: CoreCommandOptions
	): Promise<PatchBatch | undefined> {
		const normalized = normalizeCommandOptions(options);
		markPerformance('mutation-submit');
		let batch: PatchBatch | undefined;

		if (this.wasmClient.applySync && this.wasmClient.replaceProjectSync) {
			batch = this.applyStoryCommandThroughSyncSession(command, normalized);
		} else {
			batch = await this.enqueueMutation(() =>
				this.applyStoryCommandThroughWasm(command, normalized)
			);
		}

		markPerformance('mutation-patch-applied');
		measurePerformance(
			'mutation-round-trip',
			'mutation-submit',
			'mutation-patch-applied'
		);
		measurePerformanceAfterPaint('mutation-to-paint', 'mutation-submit');
		recordPerformanceHarnessEvent('mutation-applied', {
			command: command.type,
			patches: batch?.patches.length ?? 0,
			revision: this.status.revision
		});
		return batch;
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
			await new Promise<void>(resolve => {
				const unsubscribe = subscribeKnownAssetInventory(() => {
					if (
						stories.every(
							story =>
								!projectStoryHydration(story.id)?.rootPath ||
								knownAssetInventoryScanCompleteForStory(story.id)
						)
					) {
						unsubscribe();
						resolve();
					}
				});
			});
		}

		for (const story of stories) {
			this.sessionOwnedDocumentStories.add(story.id);
		}
		const revision = this.wasmProjectRevision;
		const snapshot = projectSnapshotFromStories(stories);
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

	async appendHydratedProjectPassages(storyId: string, passages: Passage[]) {
		await this.wasmClient.appendProjectBootstrap(
			this.sessionId,
			storyId,
			passages.map(passageToSnapshot)
		);
	}

	async finishHydratedProject(storyId: string) {
		const revision = this.wasmProjectRevision;
		const status = await this.wasmClient.finishProjectBootstrap(
			this.sessionId,
			revision
		);
		if (status) {
			this.publishStatus(status);
		}
		recordPerformanceHarnessEvent('core-session-stream-hydration-ready', {
			revision,
			sessionId: this.sessionId,
			storyId
		});
	}

	async initializeHydratedProject(_storyId: string, stories: Story[]) {
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
			await new Promise<void>(resolve => {
				const unsubscribe = subscribeKnownAssetInventory(() => {
					if (
						stories.every(
							story =>
								!projectStoryHydration(story.id)?.rootPath ||
								knownAssetInventoryScanCompleteForStory(story.id)
						)
					) {
						unsubscribe();
						resolve();
					}
				});
			});
		}

		const revision = this.wasmProjectRevision;
		for (const story of stories) {
			this.sessionOwnedDocumentStories.add(story.id);
		}
		const snapshot = projectSnapshotFromStories(stories);
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
		await this.wasmProjectReplacePromise;
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
		options: ReturnType<typeof normalizeCommandOptions>
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

			this.applySessionPatchBatch(
				result.batch,
				commandAnnotation,
				result.revision,
				result.status
			);
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
		options: ReturnType<typeof normalizeCommandOptions>
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

			this.applySessionPatchBatch(
				result.batch,
				commandAnnotation,
				result.revision,
				result.status
			);
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
		externalDeltaId?: string
	) {
		const patchStarted = performance.now();
		const persistenceHints = projectFolderSaveHintsForPatchBatch(batch);
		const storyActions = projectPatchBatchStoryActions(batch, {
			sessionOwnedDocumentsForStory: storyId =>
				this.sessionOwnedDocumentStories.has(storyId)
		});
		const patchedStoryIds = Array.from(
			new Set(
				batch.patches.flatMap(patch =>
					'story_id' in patch ? [patch.story_id] : []
				)
			)
		);
		const documentUpdates: NonNullable<
			ApplyCorePatchBatchAction['documentUpdates']
		> = [];
		for (const patch of batch.patches) {
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
		}
		const classifiedAt = performance.now();

		this.wasmProjectRevision = nextRevision;
		this.wasmProjectReplaceRevision = nextRevision;
		this.wasmProjectReplacePromise = Promise.resolve();
		this.pendingSessionPatchDispatches += storyActions.length > 0 ? 1 : 0;
		applyProjectPatchBatch(
			batch,
			{
				deleteAsset: (storyId, path) => this.deleteAsset(storyId, path),
				dispatch: action => this.dispatch(action, annotation),
				dispatchBatch: actions =>
					this.dispatch(
						{
							actions,
							documentUpdates,
							persistence: externalDeltaId ? 'skip' : undefined,
							persistenceHints,
							revision: nextRevision,
							sessionId: this.sessionId,
							storyIds: patchedStoryIds,
							type: 'applyCorePatchBatch'
						},
						annotation
					),
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

	private async undoThroughWasm() {
		const effectToken = this.undoEffects[this.undoEffects.length - 1];
		let nativeApplied = false;

		try {
			await this.applyNativeEffect(effectToken, 'undo');
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
			await this.applyNativeEffect(effectToken, 'redo');
			return undefined;
		} catch (error) {
			if (nativeApplied) {
				await this.applyNativeEffect(effectToken, 'redo').catch(
					() => undefined
				);
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
		const effectToken = this.redoEffects[this.redoEffects.length - 1];
		let nativeApplied = false;

		try {
			await this.applyNativeEffect(effectToken, 'redo');
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
			await this.applyNativeEffect(effectToken, 'undo');
			return undefined;
		} catch (error) {
			if (nativeApplied) {
				await this.applyNativeEffect(effectToken, 'undo').catch(
					() => undefined
				);
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
		await bridge.applyProjectAssetEffect(effectToken, direction);
	}

	private recordHistoryEffect(effectToken: string | undefined) {
		const bridge = (window as TwineElectronWindow).twineElectron;

		for (const token of this.redoEffects) {
			if (token) {
				void bridge?.discardProjectAssetEffect?.(token);
			}
		}
		this.redoEffects = [];
		this.undoEffects.push(effectToken);
		if (this.undoEffects.length > 200) {
			const evicted = this.undoEffects.shift();

			if (evicted) {
				void bridge?.discardProjectAssetEffect?.(evicted);
			}
		}
	}

	private async rollbackRejectedEffect(effectToken: string | undefined) {
		if (!effectToken) {
			return;
		}

		await this.applyNativeEffect(effectToken, 'undo');
		await (
			window as TwineElectronWindow
		).twineElectron?.discardProjectAssetEffect?.(effectToken);
	}

	disposeEffects() {
		const bridge = (window as TwineElectronWindow).twineElectron;

		for (const token of [...this.undoEffects, ...this.redoEffects]) {
			if (token) {
				void bridge?.discardProjectAssetEffect?.(token);
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
		stories: Story[],
		assets: CoreAssetInventoryEntry[]
	) {
		await this.enqueueMutation(async () => {
			this.disposeEffects();
			const snapshot = projectSnapshotFromStories(stories);
			const metadataStories = stories.map(metadataStory);

			this.stories = metadataStories;
			for (const story of stories) {
				replaceKnownAssetInventoryForStory(story.id, assets);
			}
			this.wasmProjectRevision++;
			this.wasmProjectReplaceRevision = this.wasmProjectRevision;
			this.dispatch({state: metadataStories, type: 'init'});
			const status = await this.wasmClient.replaceProject(
				this.sessionId,
				snapshot,
				this.wasmProjectRevision,
				assets
			);

			if (status) {
				this.publishStatus(status);
			}
		});
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
					(passageTotal, passage) => passageTotal + passage.text.length,
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
			await new Promise<void>(resolve => {
				const unsubscribe = subscribeProjectStoryHydration(() => {
					if (
						this.stories.every(
							story =>
								projectStoryHydration(story.id)?.passageTextLoaded !== false
						)
					) {
						unsubscribe();
						resolve();
					}
				});
			});
		}
		if (
			this.stories.some(
				story =>
					!!projectStoryHydration(story.id)?.rootPath &&
					!knownAssetInventoryScanCompleteForStory(story.id)
			)
		) {
			await new Promise<void>(resolve => {
				const unsubscribe = subscribeKnownAssetInventory(() => {
					if (
						this.stories.every(
							story =>
								!projectStoryHydration(story.id)?.rootPath ||
								knownAssetInventoryScanCompleteForStory(story.id)
						)
					) {
						unsubscribe();
						resolve();
					}
				});
			});
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
			const snapshot = projectSnapshotFromStories(this.stories);
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
			const replacePromise =
				assets.length > 0
					? this.wasmClient.replaceProject(
							this.sessionId,
							snapshot,
							revision,
							assets
						)
					: this.wasmClient.replaceProject(this.sessionId, snapshot, revision);

			this.wasmProjectReplacePromise = replacePromise
				.then(status => {
					this.releaseRetainedPassageBodies();
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
			const snapshot = projectSnapshotFromStories(this.stories);

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
				story.passages.some(passage => passage.text.length > 0)
			)
		) {
			this.stories = this.stories.map(metadataStory);
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

		if (this.wasmClient.enabled && queryStorySummary) {
			try {
				const revision = await this.ensureWasmProjectSession();
				return await queryStorySummary(this.sessionId, storyId, revision);
			} catch (error) {
				console.warn(`Rust story summary query failed: ${error}`);
			}
		}
		// Older test doubles and a temporarily stale WASM bundle retain the
		// compatibility query. Product workers always take the bounded branch.
		const index = await this.queryStoryIndexAsync(storyId, {
			includeAssets: true,
			includeContents: false,
			includeDiagnostics: true,
			includeFiles: false,
			includeGraph: true,
			includePassageNames: false,
			includePassageText: false,
			includeScript: false,
			includeStylesheet: false,
			includeTags: true,
			includeVariables: false
		});

		return {
			assetCount: index.assetInventory.length,
			characterCount:
				this.stories
					.find(story => story.id === storyId)
					?.passages.reduce(
						(total, passage) => total + passage.text.length,
						0
					) ?? 0,
			diagnosticCount: index.diagnostics.length,
			errorCount: index.diagnostics.filter(
				diagnostic => diagnostic.severity === 'error'
			).length,
			graph: index.graph,
			missingAssetCount: index.assetInventory.filter(asset => asset.missing)
				.length,
			passageCount:
				this.stories.find(story => story.id === storyId)?.passages.length ?? 0,
			revision: this.sessionStatus().revision,
			storyId,
			tagCount: index.tagEntries.length,
			warningCount: index.diagnostics.filter(
				diagnostic => diagnostic.severity === 'warning'
			).length,
			wordCount:
				this.stories
					.find(story => story.id === storyId)
					?.passages.reduce(
						(total, passage) =>
							total + passage.text.trim().split(/\s+/).filter(Boolean).length,
						0
					) ?? 0
		};
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
				console.warn(`Rust contents page query failed: ${error}`);
			}
		}
		// This compatibility branch supports older test doubles and a stale WASM
		// bundle. Current product workers always take the bounded request above.
		const index = await this.queryStoryIndexAsync(storyId, {});

		return {
			assets: index.assetInventory.filter(asset =>
				index.contents.some(
					entry => entry.kind === 'asset' && entry.label === asset.path
				)
			),
			entries: index.contents,
			facets: contentsFacetsFromEntries(index.contents),
			nextCursor: null,
			revision: this.sessionStatus().revision,
			storyId,
			totalCount: index.contents.length
		};
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
				console.warn(`Rust search page query failed: ${error}`);
			}
		}
		const query = {...defaultSearchQuery, ...options};
		const index = await this.queryStoryIndexAsync(storyId, {
			fuzzy: query.fuzzy,
			includeAssets: false,
			includeContents: false,
			includeDiagnostics: false,
			includeFiles: false,
			includeGraph: false,
			includePassageNames: query.includePassageNames,
			includePassageText: query.includePassageText,
			includeScript: query.includeScript,
			includeStylesheet: query.includeStylesheet,
			includeTags: false,
			includeVariables: false,
			matchCase: query.matchCase,
			query: query.query,
			replacement: query.replacement,
			useRegexes: query.useRegexes
		});
		const searchHits = index.searchHits.slice(0, query.limit);

		return {
			nextCursor: null,
			replacePreviews: index.replacePreviews.slice(0, query.limit),
			revision: this.sessionStatus().revision,
			searchHits,
			storyId,
			totalCount: index.searchHits.length
		} satisfies CoreSearchPage;
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
				console.warn(`Rust diagnostics page query failed: ${error}`);
			}
		}
		const index = await this.queryStoryIndexAsync(storyId, {
			includeAssets: true,
			includeContents: false,
			includeDiagnostics: true,
			includeFiles: false,
			includeGraph: true,
			includePassageNames: false,
			includePassageText: false,
			includeScript: false,
			includeStylesheet: false,
			includeTags: false,
			includeVariables: false
		});
		const diagnostics = index.diagnostics.filter(
			diagnostic =>
				!options.severity || diagnostic.severity === options.severity
		);

		return {
			diagnostics: diagnostics.slice(0, options.limit ?? 100),
			nextCursor: null,
			revision: this.sessionStatus().revision,
			storyId,
			totalCount: diagnostics.length
		} satisfies CoreDiagnosticsPage;
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
				return await this.wasmClient.queryAssetsPage(
					this.sessionId,
					storyId,
					{...defaultAssetsQuery, ...options},
					revision
				);
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
				: stories;
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

const projectScopedCoreHosts = new Set<ProjectScopedCoreProjectHost>();

class ProjectScopedCoreProjectHost implements CoreProjectHost {
	private client = createWasmCoreWorkerClient();
	private dispatch: UndoableDispatch;
	private hosts = new Map<string, StoreCoreProjectHost>();
	private patchListeners = new Set<CoreProjectPatchListener>();
	private statusListeners = new Set<(status: CoreSessionStatus) => void>();
	private stories: StoriesState;
	private storySessions = new Map<string, string>();

	constructor(stories: StoriesState, dispatch: UndoableDispatch) {
		this.stories = stories;
		this.dispatch = dispatch;
		projectScopedCoreHosts.add(this);
		this.update(stories, dispatch);
	}

	performanceDiagnostics() {
		return {
			mode: this.client.mode,
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
		const sessionId = storyId ? this.storySessions.get(storyId) : undefined;

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

	async applyStoryCommand(command: StoryCommand, options?: CoreCommandOptions) {
		if (command.type === 'renameStoryTag') {
			const completed: StoreCoreProjectHost[] = [];
			let lastBatch: PatchBatch | undefined;

			try {
				for (const host of this.hosts.values()) {
					lastBatch = await host.applyStoryCommand(command, options);
					completed.push(host);
				}
				return lastBatch;
			} catch (error) {
				for (const host of completed.reverse()) {
					await host.undo();
				}
				throw error;
			}
		}

		return this.requireHostForCommand(command).applyStoryCommand(
			command,
			options
		);
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
		const host = this.hostForStory(storyId);

		if (!host) {
			throw new Error(
				`No core project session is available for story "${storyId}".`
			);
		}

		return host.applyExternalDelta(storyId, delta);
	}

	ingestExternalDelta(
		storyId: string,
		delta: CoreExternalDelta,
		options?: {force?: boolean}
	) {
		const host = this.hostForStory(storyId);

		if (!host) {
			throw new Error(
				`No core project session is available for story "${storyId}".`
			);
		}

		return host.ingestExternalDelta(storyId, delta, options);
	}

	acknowledgeSaved(sessionId: string, revision: number) {
		const host = this.hosts.get(sessionId);

		return host?.acknowledgeSaved(sessionId, revision) ?? Promise.resolve();
	}

	recoverFromSnapshot(
		storyId: string,
		stories: Story[],
		assets: CoreAssetInventoryEntry[]
	) {
		const host = this.hostForStory(storyId);

		if (!host) {
			throw new Error(
				`No core project session is available for story "${storyId}".`
			);
		}
		return host.recoverFromSnapshot(storyId, stories, assets);
	}

	redo(storyId?: string) {
		return this.hostForStory(storyId)?.redo() ?? Promise.resolve(undefined);
	}

	undo(storyId?: string) {
		return this.hostForStory(storyId)?.undo() ?? Promise.resolve(undefined);
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

	initializeHydratedProject(storyId: string, stories: Story[]) {
		const host = this.hostForStory(storyId);
		if (!host) {
			return Promise.reject(new Error(`No core session for story ${storyId}.`));
		}
		return host.initializeHydratedProject(storyId, stories);
	}

	beginHydratedProject(storyId: string, stories: Story[]) {
		const host = this.hostForStory(storyId);
		if (!host) {
			return Promise.reject(new Error(`No core session for story ${storyId}.`));
		}
		return host.beginHydratedProject(storyId, stories);
	}

	appendHydratedProjectPassages(storyId: string, passages: Passage[]) {
		const host = this.hostForStory(storyId);
		if (!host) {
			return Promise.reject(new Error(`No core session for story ${storyId}.`));
		}
		return host.appendHydratedProjectPassages(storyId, passages);
	}

	finishHydratedProject(storyId: string) {
		const host = this.hostForStory(storyId);
		if (!host) {
			return Promise.reject(new Error(`No core session for story ${storyId}.`));
		}
		return host.finishHydratedProject(storyId);
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

	update(stories: StoriesState, dispatch: UndoableDispatch) {
		this.stories = stories;
		this.dispatch = dispatch;
		const grouped = new Map<string, Story[]>();
		const previousStorySessions = this.storySessions;

		this.storySessions = new Map();
		for (const story of stories) {
			const sessionId = coreSessionIdForStory(story);

			this.storySessions.set(story.id, sessionId);
			grouped.set(sessionId, [...(grouped.get(sessionId) ?? []), story]);
		}

		for (const [sessionId, sessionStories] of grouped) {
			let host = this.hosts.get(sessionId);

			if (!host) {
				const initialStories = sessionStories.map(
					story => bootstrapStory(story.id) ?? story
				);

				host = new StoreCoreProjectHost(initialStories, dispatch, {
					sessionId,
					wasmClient: this.client
				});
				host.subscribeToPatches(batch =>
					this.patchListeners.forEach(listener => listener(batch))
				);
				host.subscribeToStatus(status =>
					this.statusListeners.forEach(listener => listener(status))
				);
				this.hosts.set(sessionId, host);
			} else {
				host.update(sessionStories, dispatch);
			}

			for (const story of sessionStories) {
				registerStoryMaterializer(story.id, () =>
					materializeStoryFromSession(host!, story)
				);
			}
		}
		for (const storyId of previousStorySessions.keys()) {
			if (!this.storySessions.has(storyId)) {
				unregisterStoryMaterializer(storyId);
			}
		}

		for (const [sessionId] of this.hosts) {
			if (!grouped.has(sessionId)) {
				this.hosts.get(sessionId)?.disposeEffects();
				this.hosts.delete(sessionId);
				void this.client.removeSession(sessionId);
			}
		}
	}

	dispose() {
		for (const storyId of this.storySessions.keys()) {
			unregisterStoryMaterializer(storyId);
		}
		for (const host of this.hosts.values()) {
			host.disposeEffects();
		}
		this.hosts.clear();
		this.storySessions.clear();
		this.client.dispose();
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
		hosts,
		workerClients: hosts.length
	};
}

export function useCoreProjectHost() {
	const sharedHost = React.useContext(CoreProjectHostContext);
	const {dispatch: storiesDispatch, stories} = useStoriesContext();
	const dispatch: UndoableDispatch = action => storiesDispatch(action);
	const hostRef = React.useRef<StoreCoreProjectHost>();

	if (!sharedHost && !hostRef.current) {
		hostRef.current = new StoreCoreProjectHost(stories, dispatch);
	}

	if (!sharedHost) {
		hostRef.current?.update(stories, dispatch);
	}

	React.useEffect(() => {
		if (!sharedHost) {
			hostRef.current?.publishStoreStatePatches();
		}
	}, [sharedHost, stories]);
	React.useEffect(
		() => () => {
			if (!sharedHost) {
				hostRef.current?.dispose();
			}
		},
		[sharedHost]
	);

	return sharedHost ?? hostRef.current!;
}

export function useCoreProjectSession(storyId: string | undefined) {
	const host = useCoreProjectHost();

	return React.useMemo<CoreProjectHost>(
		() => ({
			...host,
			acknowledgeSaved: (sessionId, revision) =>
				host.acknowledgeSaved(sessionId, revision),
			applyExternalDelta: (deltaStoryId, delta) =>
				host.applyExternalDelta(deltaStoryId, delta),
			ingestExternalDelta: (deltaStoryId, delta, options) =>
				host.ingestExternalDelta(deltaStoryId, delta, options),
			applyStoryCommand: (command, options) =>
				host.applyStoryCommand(command, options),
			ensureSessionReady: readyStoryId => host.ensureSessionReady(readyStoryId),
			beginHydratedProject: (readyStoryId, stories) =>
				host.beginHydratedProject(readyStoryId, stories),
			appendHydratedProjectPassages: (readyStoryId, passages) =>
				host.appendHydratedProjectPassages(readyStoryId, passages),
			finishHydratedProject: readyStoryId =>
				host.finishHydratedProject(readyStoryId),
			initializeHydratedProject: (readyStoryId, stories) =>
				host.initializeHydratedProject(readyStoryId, stories),
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
			queryPassageDocumentAsync: (queryStoryId, passageId) =>
				host.queryPassageDocumentAsync(queryStoryId, passageId),
			querySourceDocumentAsync: (queryStoryId, kind) =>
				host.querySourceDocumentAsync(queryStoryId, kind),
			recoverFromSnapshot: (recoveryStoryId, recoveryStories, assets) =>
				host.recoverFromSnapshot(recoveryStoryId, recoveryStories, assets),
			redo: () => host.redo(storyId),
			runtimeMode: () => host.runtimeMode(),
			sessionStatus: () => host.sessionStatus(storyId),
			subscribeToPatches: listener => host.subscribeToPatches(listener),
			subscribeToStatus: listener =>
				host.subscribeToStatus(() => listener(host.sessionStatus(storyId))),
			undo: () => host.undo(storyId)
		}),
		[host, storyId]
	);
}

export const CoreProjectHostProvider: React.FC = ({children}) => {
	const {dispatch, stories} = useStoriesContext();
	const hostRef = React.useRef<ProjectScopedCoreProjectHost>();

	if (!hostRef.current) {
		hostRef.current = new ProjectScopedCoreProjectHost(stories, action =>
			dispatch(action)
		);
	}

	hostRef.current.update(stories, action => dispatch(action));
	React.useEffect(
		() => () => {
			hostRef.current?.dispose();
		},
		[]
	);

	return (
		<CoreProjectHostContext.Provider value={hostRef.current}>
			{children}
		</CoreProjectHostContext.Provider>
	);
};
