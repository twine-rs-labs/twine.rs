import * as React from 'react';
import type {CoreAssetInventoryEntry} from './bindings/CoreAssetInventoryEntry';
import type {CoreExternalDelta} from './bindings/CoreExternalDelta';
import type {CoreGraphProjection} from './bindings/CoreGraphProjection';
import type {CoreSessionStatus} from './bindings/CoreSessionStatus';
import type {CoreStoryIndex} from './bindings/CoreStoryIndex';
import type {CoreStoryIndexOptions} from './bindings/CoreStoryIndexOptions';
import type {Patch} from './bindings/Patch';
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
import {projectSnapshotFromStories} from './project-snapshot';
import {normalizeStoryIndexOptions} from './story-index';
import type {CoreBridgeMode} from './wasm/performance';
import {
	CoreSessionMutationResult,
	WasmCoreWorkerClient,
	createWasmCoreWorkerClient
} from './wasm/twine-wasm-client';
import {
	StoriesActionOrThunk,
	StoriesState,
	Story,
	useStoriesContext
} from '../store/stories';
import {loadProjectMetadata} from '../store/project-metadata';
import type {TwineElectronWindow} from '../electron/shared';

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
	applyExternalDelta(
		storyId: string,
		delta: CoreExternalDelta
	): Promise<PatchBatch | undefined>;
	applyStoryCommand(
		command: StoryCommand,
		options?: CoreCommandOptions
	): Promise<PatchBatch | undefined>;
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
	| 'cachedGraphProjection'
	| 'cachedStoryIndex'
	| 'enabled'
	| 'lastGraphProjection'
	| 'mode'
	| 'queryGraphProjection'
	| 'queryStoryIndex'
	| 'redo'
	| 'replaceProject'
	| 'undo'
> & {
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

function persistableStoryFingerprint(story: Story) {
	return JSON.stringify({
		ifid: story.ifid,
		id: story.id,
		name: story.name,
		passages: story.passages.map(passage => ({
			height: passage.height,
			id: passage.id,
			left: passage.left,
			name: passage.name,
			story: passage.story,
			tags: passage.tags,
			text: passage.text,
			top: passage.top,
			width: passage.width
		})),
		script: story.script,
		snapToGrid: story.snapToGrid,
		startPassage: story.startPassage,
		storyFormat: story.storyFormat,
		storyFormatVersion: story.storyFormatVersion,
		stylesheet: story.stylesheet,
		tagColors: story.tagColors,
		tags: story.tags,
		zoom: story.zoom
	});
}

function storyFingerprintMap(stories: StoriesState) {
	return new Map(
		stories.map(story => [story.id, persistableStoryFingerprint(story)])
	);
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

export class StoreCoreProjectHost implements CoreProjectHost {
	private assetInventoryByStory = sharedAssetInventoryByStory;
	private dirty = false;
	private dispatch: UndoableDispatch;
	private listeners = new Set<CoreProjectPatchListener>();
	private mutationQueue: Promise<void> = Promise.resolve();
	private redoEffects: Array<string | undefined> = [];
	private statusListeners = new Set<(status: CoreSessionStatus) => void>();
	private undoEffects: Array<string | undefined> = [];
	private pendingSessionPatchDispatches = 0;
	private publishedStories = new Map<string, Story>();
	private savedStoryFingerprints: Map<string, string>;
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
		this.savedStoryFingerprints = storyFingerprintMap(stories);
		this.sessionId = options.sessionId ?? defaultCoreSessionId;
		this.wasmClient = options.wasmClient ?? createWasmCoreWorkerClient();
	}

	async applyStoryCommand(
		command: StoryCommand,
		options?: CoreCommandOptions
	): Promise<PatchBatch | undefined> {
		const normalized = normalizeCommandOptions(options);

		if (this.wasmClient.applySync && this.wasmClient.replaceProjectSync) {
			return this.applyStoryCommandThroughSyncSession(command, normalized);
		}

		return this.enqueueMutation(() =>
			this.applyStoryCommandThroughWasm(command, normalized)
		);
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
			const result = await this.wasmClient.applyExternalDelta(
				this.sessionId,
				delta,
				revision
			);

			this.applySessionPatchBatch(
				result.batch,
				'undoChange.externalChanges',
				result.revision,
				result.status
			);
			if (result.revision !== revision) {
				this.recordHistoryEffect(undefined);
			}
			return result.batch;
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
		status?: CoreSessionStatus
	) {
		const storyActions = projectPatchBatchStoryActions(batch);

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
							revision: nextRevision,
							sessionId: this.sessionId,
							storyIds: Array.from(
								new Set(
									actions.flatMap(action =>
										'storyId' in action ? [action.storyId] : []
									)
								)
							),
							type: 'applyCorePatchBatch'
						},
						annotation
					),
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

		this.publishPatchBatch(batch);
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

		return this.enqueueMutation(() => this.undoThroughWasm());
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

		return this.enqueueMutation(() => this.redoThroughWasm());
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
		this.status = status;
		this.dirty = status.dirty;
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
			this.savedStoryFingerprints = storyFingerprintMap(this.stories);
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

	private currentDirtyState() {
		const currentIds = new Set(this.stories.map(story => story.id));

		for (const story of this.stories) {
			if (
				this.savedStoryFingerprints.get(story.id) !==
				persistableStoryFingerprint(story)
			) {
				return true;
			}
		}

		for (const storyId of this.savedStoryFingerprints.keys()) {
			if (!currentIds.has(storyId)) {
				return true;
			}
		}

		return false;
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
		const dirty = this.currentDirtyState();
		const patches: Patch[] = [
			...(dirty !== this.dirty
				? [{dirty, type: 'dirtyStateChanged' as const}]
				: [])
		];

		this.publishedStories = new Map(
			this.stories.map(story => [story.id, story])
		);
		this.dirty = dirty;

		if (patches.length > 0) {
			this.transactionId++;
			this.listeners.forEach(listener =>
				listener({
					label: 'store-index-refresh',
					patches,
					transactionId: this.transactionId
				})
			);
		}
	}

	runtimeMode() {
		return this.wasmClient.mode;
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
			!this.wasmProjectReplacePromise ||
			this.wasmProjectReplaceRevision !== this.wasmProjectRevision
		) {
			const revision = this.wasmProjectRevision;
			const snapshot = projectSnapshotFromStories(this.stories);

			this.wasmProjectReplaceRevision = revision;
			this.wasmProjectReplacePromise = this.wasmClient
				.replaceProject(this.sessionId, snapshot, revision)
				.then(status => {
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
		return this.wasmProjectReplaceRevision;
	}

	private ensureWasmProjectSessionSync() {
		if (!this.wasmClient.enabled || !this.wasmClient.replaceProjectSync) {
			throw new Error('WASM core worker is unavailable.');
		}

		if (
			!this.wasmProjectReplacePromise ||
			this.wasmProjectReplaceRevision !== this.wasmProjectRevision
		) {
			const revision = this.wasmProjectRevision;
			const snapshot = projectSnapshotFromStories(this.stories);

			this.wasmProjectReplaceRevision = revision;
			this.wasmClient.replaceProjectSync(snapshot, revision);
			this.wasmProjectReplacePromise = Promise.resolve();
		}

		return this.wasmProjectReplaceRevision;
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
				const revision = await this.ensureWasmProjectSession();
				return await this.wasmClient.queryGraphProjection(
					this.sessionId,
					storyId,
					normalizedOptions,
					revision
				);
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
				const revision = await this.ensureWasmProjectSession();
				return await this.wasmClient.queryStoryIndex(
					this.sessionId,
					storyId,
					normalizedOptions,
					revision
				);
			} catch (error) {
				console.warn(`Rust story index query failed: ${error}`);
			}
		}

		return emptyStoryIndex(storyId);
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
		this.stories = stories;
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
		this.update(stories, dispatch);
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

	applyExternalDelta(storyId: string, delta: CoreExternalDelta) {
		const host = this.hostForStory(storyId);

		if (!host) {
			throw new Error(
				`No core project session is available for story "${storyId}".`
			);
		}

		return host.applyExternalDelta(storyId, delta);
	}

	acknowledgeSaved(sessionId: string, revision: number) {
		const host = this.hosts.get(sessionId);

		return host?.acknowledgeSaved(sessionId, revision) ?? Promise.resolve();
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

		this.storySessions.clear();
		for (const story of stories) {
			const sessionId = coreSessionIdForStory(story);

			this.storySessions.set(story.id, sessionId);
			grouped.set(sessionId, [...(grouped.get(sessionId) ?? []), story]);
		}

		for (const [sessionId, sessionStories] of grouped) {
			let host = this.hosts.get(sessionId);

			if (!host) {
				host = new StoreCoreProjectHost(sessionStories, dispatch, {
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
		for (const host of this.hosts.values()) {
			host.disposeEffects();
		}
		this.hosts.clear();
		this.storySessions.clear();
		this.client.dispose();
	}
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
			applyStoryCommand: (command, options) =>
				host.applyStoryCommand(command, options),
			isDirty: () => host.isDirty(storyId),
			queryGraphProjection: (queryStoryId, options) =>
				host.queryGraphProjection(queryStoryId, options),
			queryGraphProjectionAsync: (queryStoryId, options) =>
				host.queryGraphProjectionAsync(queryStoryId, options),
			queryStoryIndex: (queryStoryId, options) =>
				host.queryStoryIndex(queryStoryId, options),
			queryStoryIndexAsync: (queryStoryId, options) =>
				host.queryStoryIndexAsync(queryStoryId, options),
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
