import * as React from 'react';
import type {CoreAssetInventoryEntry} from './bindings/CoreAssetInventoryEntry';
import type {CoreGraphProjection} from './bindings/CoreGraphProjection';
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
import {StoriesState, Story, useStoriesContext} from '../store/stories';
import type {StoriesActionOrThunk} from '../store/undoable-stories';
import {useUndoableStoriesContext} from '../store/undoable-stories';

export type StoryIndexQuery = string | Partial<CoreStoryIndexOptions>;

export type CoreProjectPatchListener = (patches: PatchBatch) => void;

export interface CoreProjectHost {
	applyStoryCommand(command: StoryCommand, annotation?: string): void;
	redo(): void;
	isDirty(): boolean;
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
	subscribeToPatches(listener: CoreProjectPatchListener): () => void;
	undo(): void;
}

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
	| 'apply'
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
		revision: number
	): CoreSessionMutationResult;
	replaceProjectSync?(
		snapshot: ReturnType<typeof projectSnapshotFromStories>,
		revision: number
	): void;
};

export interface StoreCoreProjectHostOptions {
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

function storyFingerprintMapsEqual(
	left: Map<string, string>,
	right: Map<string, string>
) {
	if (left.size !== right.size) {
		return false;
	}

	for (const [storyId, fingerprint] of left) {
		if (right.get(storyId) !== fingerprint) {
			return false;
		}
	}

	return true;
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
	private pendingSessionPatchDispatches = 0;
	private publishedStories = new Map<string, Story>();
	private savedStoryFingerprints: Map<string, string>;
	private stories: StoriesState;
	private transactionId = BigInt(0);
	private wasmClient: CoreProjectSessionClient;
	private wasmProjectRevision = 1;
	private wasmProjectReplaceRevision = -1;
	private wasmProjectReplacePromise?: Promise<void>;

	constructor(
		stories: StoriesState,
		dispatch: UndoableDispatch,
		options: StoreCoreProjectHostOptions = {}
	) {
		this.dispatch = dispatch;
		this.stories = stories;
		this.savedStoryFingerprints = storyFingerprintMap(stories);
		this.wasmClient = options.wasmClient ?? createWasmCoreWorkerClient();
	}

	applyStoryCommand(command: StoryCommand, annotation?: string) {
		if (this.wasmClient.applySync && this.wasmClient.replaceProjectSync) {
			this.applyStoryCommandThroughSyncSession(command, annotation);
			return;
		}

		void this.applyStoryCommandThroughWasm(command, annotation);
	}

	private applyStoryCommandThroughSyncSession(
		command: StoryCommand,
		annotation?: string
	) {
		const commandAnnotation = annotation ?? storyCommandAnnotation(command);

		try {
			const revision = this.ensureWasmProjectSessionSync();
			const result = this.wasmClient.applySync!(command, revision);

			this.applySessionPatchBatch(
				result.batch,
				commandAnnotation,
				result.revision
			);
			if (command.type === 'markSaved') {
				this.savedStoryFingerprints = storyFingerprintMap(this.stories);
			}
		} catch (error) {
			console.error(`Rust project session command failed: ${error}`);
		}
	}

	private async applyStoryCommandThroughWasm(
		command: StoryCommand,
		annotation?: string
	) {
		const commandAnnotation = annotation ?? storyCommandAnnotation(command);

		try {
			const revision = await this.ensureWasmProjectSession();
			const result = await this.wasmClient.apply(command, revision);

			this.applySessionPatchBatch(
				result.batch,
				commandAnnotation,
				result.revision
			);
			if (command.type === 'markSaved') {
				this.savedStoryFingerprints = storyFingerprintMap(this.stories);
			}
		} catch (error) {
			console.error(`Rust project session command failed: ${error}`);
		}
	}

	private applySessionPatchBatch(
		batch: PatchBatch,
		annotation: string | undefined,
		nextRevision: number
	) {
		const storyActions = projectPatchBatchStoryActions(batch);

		this.wasmProjectRevision = nextRevision;
		this.wasmProjectReplaceRevision = nextRevision;
		this.wasmProjectReplacePromise = Promise.resolve();
		this.pendingSessionPatchDispatches += storyActions.length;
		applyProjectPatchBatch(
			batch,
			{
				deleteAsset: (storyId, path) => this.deleteAsset(storyId, path),
				dispatch: action => this.dispatch(action, annotation),
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
	}

	private publishPatchBatch(batch: PatchBatch) {
		this.listeners.forEach(listener => listener(batch));
	}

	undo() {
		if (!this.wasmClient.enabled) {
			return;
		}

		void this.undoThroughWasm();
	}

	private async undoThroughWasm() {
		try {
			const revision = await this.ensureWasmProjectSession();
			const result = await this.wasmClient.undo(revision);

			if (result) {
				this.applySessionPatchBatch(result.batch, undefined, result.revision);
			}
		} catch (error) {
			console.error(`Rust project session undo failed: ${error}`);
		}
	}

	redo() {
		if (!this.wasmClient.enabled) {
			return;
		}

		void this.redoThroughWasm();
	}

	private async redoThroughWasm() {
		try {
			const revision = await this.ensureWasmProjectSession();
			const result = await this.wasmClient.redo(revision);

			if (result) {
				this.applySessionPatchBatch(result.batch, undefined, result.revision);
			}
		} catch (error) {
			console.error(`Rust project session redo failed: ${error}`);
		}
	}

	isDirty() {
		return this.dirty;
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
				.replaceProject(snapshot, revision)
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
			storyId,
			normalizedOptions,
			this.wasmProjectRevision
		);

		if (cached) {
			return cached;
		}

		if (this.wasmClient.enabled) {
			const lastProjection = this.wasmClient.lastGraphProjection(
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
			const previousFingerprints = storyFingerprintMap(this.stories);
			const nextFingerprints = storyFingerprintMap(stories);

			if (this.pendingSessionPatchDispatches > 0) {
				this.pendingSessionPatchDispatches--;
			} else if (
				!storyFingerprintMapsEqual(previousFingerprints, nextFingerprints)
			) {
				this.wasmProjectRevision++;
				this.wasmProjectReplacePromise = undefined;
			}
		}

		this.dispatch = dispatch;
		this.stories = stories;
	}
}

export function useCoreProjectHost() {
	const undoableStories = useUndoableStoriesContext();
	const {dispatch: storiesDispatch, stories: plainStories} =
		useStoriesContext();
	const dispatch: UndoableDispatch = undoableStories.isUndoable
		? undoableStories.dispatch
		: action => storiesDispatch(action);
	const stories = undoableStories.isUndoable
		? undoableStories.stories
		: plainStories;
	const hostRef = React.useRef<StoreCoreProjectHost>();

	if (!hostRef.current) {
		hostRef.current = new StoreCoreProjectHost(stories, dispatch);
	}

	hostRef.current.update(stories, dispatch);

	React.useEffect(() => {
		hostRef.current?.publishStoreStatePatches();
	}, [stories]);

	return hostRef.current;
}
