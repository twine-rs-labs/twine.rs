import * as React from 'react';
import type {CoreAssetInventoryEntry} from './bindings/CoreAssetInventoryEntry';
import type {CoreGraphProjection} from './bindings/CoreGraphProjection';
import type {CoreStoryIndex} from './bindings/CoreStoryIndex';
import type {CoreStoryIndexOptions} from './bindings/CoreStoryIndexOptions';
import type {Patch} from './bindings/Patch';
import type {PatchBatch} from './bindings/PatchBatch';
import type {PassageSnapshot} from './bindings/PassageSnapshot';
import type {StoryMetadataPatch} from './bindings/StoryMetadataPatch';
import type {StoryCommand} from './bindings/StoryCommand';
import type {StorySnapshot} from './bindings/StorySnapshot';
import type {GraphProjectionQuery} from './graph-projection';
import {
	assetKindForPath,
	assetSnippet,
	fileUrlForPath,
	normalizedAssetPath,
	projectAssetPath,
	replaceAssetReferencesInSource
} from './asset-paths';
import {
	normalizeGraphProjectionOptions,
	saveGeneratedGraphLayout,
	storyToCoreGraphProjection
} from './graph-projection';
import {projectSnapshotFromStories} from './project-snapshot';
import {normalizeStoryIndexOptions, storyToCoreIndex} from './story-index';
import type {CoreBridgeMode} from './wasm/performance';
import {
	WasmCoreWorkerClient,
	createWasmCoreWorkerClient
} from './wasm/twine-wasm-client';
import {
	StoriesAction,
	StoriesState,
	Passage,
	Story,
	deletePassages,
	storyWithId,
	updatePassage,
	updateStory,
	useStoriesContext
} from '../store/stories';
import type {StoriesActionOrThunk} from '../store/undoable-stories';
import {useUndoableStoriesContext} from '../store/undoable-stories';

export type StoryIndexQuery = string | Partial<CoreStoryIndexOptions>;

export type CoreProjectPatchListener = (patches: PatchBatch) => void;

interface StoryIndexCacheEntry {
	index: CoreStoryIndex;
	knownAssets: CoreAssetInventoryEntry[];
}

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
const emptyAssetInventory: CoreAssetInventoryEntry[] = [];
const assetInventoryListeners = new Set<() => void>();
let assetInventoryVersion = 0;

export function knownAssetInventoryForStory(storyId: string) {
	return sharedAssetInventoryByStory.get(storyId) ?? emptyAssetInventory;
}

export function replaceKnownAssetInventoryForStory(
	storyId: string,
	assets: CoreAssetInventoryEntry[]
) {
	sharedAssetInventoryByStory.set(storyId, assets);
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

function storyForId(stories: Story[], storyId: string) {
	return storyWithId(stories, storyId);
}

function storyIndexCacheKey(options: StoryIndexQuery) {
	const cacheableOptions = normalizeStoryIndexOptions(options);

	return JSON.stringify({...cacheableOptions, knownAssets: []});
}

function passageForId(story: Story, passageId: string) {
	const passage = story.passages.find(passage => passage.id === passageId);

	if (!passage) {
		throw new Error(
			`No passage with ID "${passageId}" exists in story "${story.id}".`
		);
	}

	return passage;
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

function insertAtPosition(source: string, position: number, text: string) {
	const safePosition = Math.max(0, Math.min(source.length, position));

	return `${source.slice(0, safePosition)}${text}${source.slice(safePosition)}`;
}

function createPassageProps(
	command: Extract<StoryCommand, {type: 'createPassage'}>
) {
	return {
		...(command.id ? {id: command.id} : {}),
		...(command.layout ?? {}),
		...(command.name ? {name: command.name} : {}),
		tags: command.tags,
		text: command.text
	};
}

function restoredPassageProps(
	command: Extract<StoryCommand, {type: 'restorePassages'}>
) {
	return command.passages.map(passage => ({
		id: passage.id,
		...(passage.layout ?? {}),
		name: passage.name,
		tags: passage.tags,
		text: passage.text
	}));
}

function passageSnapshotToProps(
	passage: PassageSnapshot
): Partial<Passage> & Pick<Passage, 'id' | 'story'> {
	return {
		id: passage.id,
		...(passage.layout ?? {}),
		name: passage.name,
		story: passage.storyId,
		tags: passage.tags,
		text: passage.text
	};
}

function storySnapshotToStory(story: StorySnapshot): Story {
	return {
		id: story.id,
		ifid: story.ifid,
		lastUpdate: new Date(),
		name: story.name,
		passages: story.passages.map(passage => ({
			...passageSnapshotToProps(passage),
			highlighted: false,
			selected: false
		})) as Passage[],
		script: story.script,
		selected: false,
		snapToGrid: story.snapToGrid,
		startPassage: story.startPassageId,
		storyFormat: story.storyFormat,
		storyFormatVersion: story.storyFormatVersion,
		stylesheet: story.stylesheet,
		tagColors: normalizedTagColors(story.tagColors),
		tags: story.tags,
		zoom: story.zoom
	};
}

function normalizedTagColors(
	tagColors: StorySnapshot['tagColors'] | StoryMetadataPatch['tagColors']
): Story['tagColors'] {
	return Object.fromEntries(
		Object.entries(tagColors ?? {}).filter(
			(entry): entry is [string, string] => entry[1] !== undefined
		)
	);
}

function storyMetadataPatchToProps(
	changes: StoryMetadataPatch
): Partial<Story> {
	return {
		...(changes.name !== null ? {name: changes.name} : {}),
		...(changes.snapToGrid !== null
			? {snapToGrid: changes.snapToGrid}
			: {}),
		...(changes.storyFormat !== null
			? {storyFormat: changes.storyFormat}
			: {}),
		...(changes.storyFormatVersion !== null
			? {storyFormatVersion: changes.storyFormatVersion}
			: {}),
		...(changes.tagColors !== null
			? {tagColors: normalizedTagColors(changes.tagColors)}
			: {}),
		...(changes.tags !== null ? {tags: changes.tags} : {}),
		...(changes.zoom !== null ? {zoom: changes.zoom} : {})
	};
}

function passagePatchToProps(
	changes: Patch & {type: 'passageUpdated'}
): Partial<Passage> {
	const patch = changes.changes;

	return {
		...(patch.layout !== null ? patch.layout : {}),
		...(patch.name !== null ? {name: patch.name} : {}),
		...(patch.tags !== null ? {tags: patch.tags} : {}),
		...(patch.text !== null ? {text: patch.text} : {})
	};
}

function projectSnapshotToStories(snapshot: Patch & {type: 'projectSnapshotReplaced'}) {
	return snapshot.snapshot.stories.map(storySnapshotToStory);
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

export class StoreCoreProjectHost implements CoreProjectHost {
	private assetInventoryByStory = sharedAssetInventoryByStory;
	private dirty = false;
	private dispatch: UndoableDispatch;
	private listeners = new Set<CoreProjectPatchListener>();
	private pendingSessionPatchDispatches = 0;
	private publishedStories = new Map<string, Story>();
	private savedStoryFingerprints: Map<string, string>;
	private storyIndexCache = new WeakMap<
		Story,
		Map<string, StoryIndexCacheEntry>
	>();
	private stories: StoriesState;
	private transactionId = BigInt(0);
	private wasmClient: WasmCoreWorkerClient;
	private wasmProjectRevision = 1;
	private wasmProjectReplaceRevision = -1;
	private wasmProjectReplacePromise?: Promise<void>;

	constructor(stories: StoriesState, dispatch: UndoableDispatch) {
		this.dispatch = dispatch;
		this.stories = stories;
		this.savedStoryFingerprints = storyFingerprintMap(stories);
		this.wasmClient = createWasmCoreWorkerClient();
	}

	applyStoryCommand(command: StoryCommand, annotation?: string) {
		if (this.wasmClient.enabled) {
			void this.applyStoryCommandThroughWasm(command, annotation);
			return;
		}

		const commandAnnotation = annotation ?? storyCommandAnnotation(command);
		const dispatch = (action: StoriesAction | StoriesActionOrThunk) =>
			this.dispatch(action, commandAnnotation);

		switch (command.type) {
			case 'batch':
				for (const childCommand of command.commands) {
					this.applyStoryCommand(childCommand, commandAnnotation);
				}
				return;

			case 'createPassage':
				dispatch({
					props: createPassageProps(command),
					storyId: command.story_id,
					type: 'createPassage'
				});
				return;

			case 'createStory':
				dispatch({
					props: storySnapshotToStory(command.story),
					type: 'createStory'
				});
				return;

			case 'deletePassages': {
				const story = storyForId(this.stories, command.story_id);
				const passages = command.passage_ids.map(id => passageForId(story, id));

				dispatch(deletePassages(story, passages));
				return;
			}

			case 'deleteStory':
				dispatch({storyId: command.story_id, type: 'deleteStory'});
				return;

			case 'movePassages':
				dispatch({
					passageUpdates: Object.fromEntries(
						command.moves.map(move => [move.passageId, move.bounds])
					),
					storyId: command.story_id,
					type: 'updatePassages'
				});
				return;

			case 'renamePassage': {
				const story = storyForId(this.stories, command.story_id);
				const passage = passageForId(story, command.passage_id);

				dispatch(
					updatePassage(
						story,
						passage,
						{name: command.name},
						{dontUpdateOthers: !command.update_references}
					)
				);
				return;
			}

			case 'renamePassageTag': {
				const story = storyForId(this.stories, command.story_id);
				const passageUpdates = Object.fromEntries(
					story.passages
						.filter(passage => passage.tags.includes(command.old_name))
						.map(passage => [
							passage.id,
							{
								tags: passage.tags.map(tag =>
									tag === command.old_name ? command.new_name : tag
								)
							}
						])
				);

				if (Object.keys(passageUpdates).length > 0) {
					dispatch({
						passageUpdates,
						storyId: command.story_id,
						type: 'updatePassages'
					});
				}
				return;
			}

			case 'renameStory': {
				const story = storyForId(this.stories, command.story_id);

				dispatch(updateStory(this.stories, story, {name: command.name}));
				return;
			}

			case 'renameStoryTag':
				for (const story of this.stories) {
					if (story.tags.includes(command.old_name)) {
						dispatch(
							updateStory(this.stories, story, {
								tags: story.tags.map(tag =>
									tag === command.old_name ? command.new_name : tag
								)
							})
						);
					}
				}
				return;

			case 'replaceStory': {
				const props: Partial<Story> & {id?: string} = {
					...storySnapshotToStory(command.story)
				};

				delete props.id;

				dispatch({
					props,
					storyId: command.story_id,
					type: 'updateStory'
				});
				return;
			}

			case 'restorePassages':
				dispatch({
					props: restoredPassageProps(command),
					storyId: command.story_id,
					type: 'createPassages'
				});
				return;

			case 'setPassageTags': {
				const story = storyForId(this.stories, command.story_id);
				const passage = passageForId(story, command.passage_id);

				dispatch(updatePassage(story, passage, {tags: command.tags}));
				return;
			}

			case 'setStartPassage': {
				const story = storyForId(this.stories, command.story_id);

				dispatch(
					updateStory(this.stories, story, {
						startPassage: command.passage_id
					})
				);
				return;
			}

			case 'setStoryTagColor': {
				const story = storyForId(this.stories, command.story_id);
				const tagColors = {...story.tagColors};

				if (command.color === null) {
					delete tagColors[command.name];
				} else {
					tagColors[command.name] = command.color;
				}

				dispatch(updateStory(this.stories, story, {tagColors}));
				return;
			}

			case 'setStoryTags': {
				const story = storyForId(this.stories, command.story_id);

				dispatch(updateStory(this.stories, story, {tags: command.tags}));
				return;
			}

			case 'setStoryFormat': {
				const story = storyForId(this.stories, command.story_id);

				dispatch(
					updateStory(this.stories, story, {
						storyFormat: command.story_format,
						storyFormatVersion: command.story_format_version
					})
				);
				return;
			}

			case 'setStorySnapToGrid': {
				const story = storyForId(this.stories, command.story_id);

				dispatch(
					updateStory(this.stories, story, {
						snapToGrid: command.enabled
					})
				);
				return;
			}

			case 'setStoryZoom': {
				const story = storyForId(this.stories, command.story_id);

				dispatch(updateStory(this.stories, story, {zoom: command.zoom}));
				return;
			}

			case 'updatePassageText': {
				const story = storyForId(this.stories, command.story_id);
				const passage = passageForId(story, command.passage_id);

				dispatch(updatePassage(story, passage, {text: command.text}));
				return;
			}

			case 'updatePassage': {
				const story = storyForId(this.stories, command.story_id);
				const passage = passageForId(story, command.passage_id);

				dispatch(
					updatePassage(story, passage, {
						...(command.changes.layout ?? {}),
						...(command.changes.name !== null
							? {name: command.changes.name}
							: {}),
						...(command.changes.tags !== null
							? {tags: command.changes.tags}
							: {}),
						...(command.changes.text !== null
							? {text: command.changes.text}
							: {})
					})
				);
				return;
			}

			case 'updateStoryScript': {
				const story = storyForId(this.stories, command.story_id);

				dispatch(updateStory(this.stories, story, {script: command.script}));
				return;
			}

			case 'updateStoryStylesheet': {
				const story = storyForId(this.stories, command.story_id);

				dispatch(
					updateStory(this.stories, story, {
						stylesheet: command.stylesheet
					})
				);
				return;
			}

			case 'copyAssetSnippet': {
				const snippet =
					command.snippet ??
					this.assetForPath(command.story_id, command.path)?.snippet.text ??
					assetSnippet(command.path).text;

				this.publishPatches('Copy Asset Snippet', [
					{
						path: command.path,
						snippet,
						story_id: command.story_id,
						type: 'assetSnippetCopied'
					}
				]);
				return;
			}

			case 'deleteAsset':
				this.deleteAsset(command.story_id, command.path);

				if (command.remove_references) {
					this.replaceAssetReferencesInStory(
						command.story_id,
						command.path,
						'',
						dispatch
					);
				}

				this.publishAssetInventory(command.story_id, 'Delete Asset', {
					path: projectAssetPath(command.path),
					story_id: command.story_id,
					type: 'assetDeleted'
				});
				return;

			case 'importAsset': {
				const path = projectAssetPath(
					command.target_path ??
						command.source_path.split(/[\\/]/).pop() ??
						'asset'
				);
				const existing = this.assetForPath(command.story_id, path);

				if (existing && !command.overwrite) {
					return;
				}

				const asset = assetInventoryEntry(path, {
					previewUrl: fileUrlForPath(command.source_path)
				});

				this.upsertAsset(command.story_id, asset);
				this.publishAssetInventory(command.story_id, 'Import Asset', {
					asset,
					story_id: command.story_id,
					type: 'assetImported'
				});
				return;
			}

			case 'insertAssetSnippet': {
				const snippet =
					command.snippet ??
					this.assetForPath(command.story_id, command.path)?.snippet.text ??
					assetSnippet(command.path).text;

				this.insertAssetSnippet(
					command.story_id,
					command.source_id,
					command.passage_id,
					command.position,
					snippet,
					dispatch
				);
				this.publishPatches('Insert Asset Snippet', [
					{
						path: command.path,
						snippet,
						source_id: command.source_id,
						story_id: command.story_id,
						type: 'assetSnippetInserted'
					}
				]);
				return;
			}

			case 'renameAsset': {
				const renamed = this.renameAsset(
					command.story_id,
					command.path,
					command.new_path
				);

				if (command.update_references) {
					this.replaceAssetReferencesInStory(
						command.story_id,
						command.path,
						projectAssetPath(command.new_path),
						dispatch
					);
				}

				this.publishAssetInventory(command.story_id, 'Rename Asset', {
					new_path: renamed.path,
					old_path: projectAssetPath(command.path),
					story_id: command.story_id,
					type: 'assetRenamed'
				});
				return;
			}

			case 'replaceAsset': {
				const asset = {
					...(this.assetForPath(command.story_id, command.path) ??
						assetInventoryEntry(projectAssetPath(command.path))),
					modifiedAt: new Date().toISOString(),
					previewUrl: fileUrlForPath(command.source_path),
					thumbnailUrl:
						assetKindForPath(command.path) === 'image'
							? fileUrlForPath(command.source_path)
							: null
				};

				this.upsertAsset(command.story_id, asset);
				this.publishAssetInventory(command.story_id, 'Replace Asset', {
					asset,
					story_id: command.story_id,
					type: 'assetReplaced'
				});
				return;
			}

			case 'revealAsset': {
				this.publishPatches('Reveal Asset', [
					{
						path: projectAssetPath(command.path),
						reveal_path: projectAssetPath(command.path),
						story_id: command.story_id,
						type: 'assetRevealed'
					}
				]);
				return;
			}

			case 'validateAssetReferences':
				this.publishAssetInventory(
					command.story_id,
					'Validate Asset References'
				);
				return;

			case 'markSaved':
				this.markSaved();
				return;

			case 'queryGraphProjection': {
				this.publishPatches('Query Graph Projection', [
					{
						projection: this.queryGraphProjection(
							command.story_id,
							command.options
						),
						story_id: command.story_id,
						type: 'graphProjectionUpdated'
					}
				]);
				return;
			}

			case 'queryStoryIndex':
				this.publishPatches('Query Story Index', [
					{
						index: this.queryStoryIndex(command.story_id, command.options),
						story_id: command.story_id,
						type: 'storyIndexUpdated'
					}
				]);
				return;

			case 'saveGeneratedLayout': {
				const story = storyForId(this.stories, command.story_id);
				const {moves, projection} = saveGeneratedGraphLayout(story);

				if (moves.length > 0) {
					dispatch({
						passageUpdates: Object.fromEntries(
							moves.map(move => [move.passageId, move.bounds])
						),
						storyId: command.story_id,
						type: 'updatePassages'
					});
				}

				this.publishPatches('Save Generated Layout', [
					{
						projection,
						story_id: command.story_id,
						type: 'layoutSaved'
					}
				]);
				return;
			}
		}
	}

	private async applyStoryCommandThroughWasm(
		command: StoryCommand,
		annotation?: string
	) {
		const commandAnnotation = annotation ?? storyCommandAnnotation(command);

		try {
			const revision = await this.ensureWasmProjectSession();
			const batch = await this.wasmClient.apply(command, revision);

			this.applySessionPatchBatch(batch, commandAnnotation, revision + 1);
		} catch (error) {
			console.error(`Rust project session command failed: ${error}`);
		}
	}

	private applySessionPatchBatch(
		batch: PatchBatch,
		annotation: string | undefined,
		nextRevision: number
	) {
		const actions: StoriesAction[] = [];

		for (const patch of batch.patches) {
			switch (patch.type) {
				case 'assetDeleted':
					this.deleteAsset(patch.story_id, patch.path);
					break;

				case 'assetImported':
				case 'assetReplaced':
					this.upsertAsset(patch.story_id, patch.asset);
					break;

				case 'assetInventoryUpdated':
					replaceKnownAssetInventoryForStory(patch.story_id, patch.inventory);
					break;

				case 'assetRenamed':
					this.renameAsset(patch.story_id, patch.old_path, patch.new_path);
					break;

				case 'dirtyStateChanged':
					this.dirty = patch.dirty;
					break;

				case 'passageCreated':
					actions.push({
						props: passageSnapshotToProps(patch.passage),
						storyId: patch.story_id,
						type: 'createPassage'
					});
					break;

				case 'passageDeleted':
					actions.push({
						passageId: patch.passage_id,
						storyId: patch.story_id,
						type: 'deletePassage'
					});
					break;

				case 'passageUpdated':
					actions.push({
						passageId: patch.passage_id,
						props: passagePatchToProps(patch),
						storyId: patch.story_id,
						type: 'updatePassage'
					});
					break;

				case 'projectSnapshotReplaced':
					actions.push({
						state: projectSnapshotToStories(patch),
						type: 'init'
					});
					break;

				case 'startPassageChanged':
					actions.push({
						props: {startPassage: patch.passage_id},
						storyId: patch.story_id,
						type: 'updateStory'
					});
					break;

				case 'storyCreated':
					actions.push({
						props: storySnapshotToStory(patch.story),
						type: 'createStory'
					});
					break;

				case 'storyDeleted':
					actions.push({
						storyId: patch.story_id,
						type: 'deleteStory'
					});
					break;

				case 'storyMetadataUpdated':
					actions.push({
						props: storyMetadataPatchToProps(patch.changes),
						storyId: patch.story_id,
						type: 'updateStory'
					});
					break;

				case 'storyScriptUpdated':
					actions.push({
						props: {script: patch.script},
						storyId: patch.story_id,
						type: 'updateStory'
					});
					break;

				case 'storyStylesheetUpdated':
					actions.push({
						props: {stylesheet: patch.stylesheet},
						storyId: patch.story_id,
						type: 'updateStory'
					});
					break;
			}
		}

		this.wasmProjectRevision = nextRevision;
		this.wasmProjectReplaceRevision = nextRevision;
		this.wasmProjectReplacePromise = Promise.resolve();
		this.pendingSessionPatchDispatches += actions.length;

		for (const action of actions) {
			this.dispatch(action, annotation);
		}

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
			const batch = await this.wasmClient.undo(revision);

			if (batch) {
				this.applySessionPatchBatch(batch, undefined, revision + 1);
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
			const batch = await this.wasmClient.redo(revision);

			if (batch) {
				this.applySessionPatchBatch(batch, undefined, revision + 1);
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

	private insertAssetSnippet(
		storyId: string,
		sourceId: string,
		passageId: string | null,
		position: number,
		snippet: string,
		dispatch: (action: StoriesAction | StoriesActionOrThunk) => void
	) {
		const story = storyForId(this.stories, storyId);
		const passage = passageId
			? passageForId(story, passageId)
			: story.passages.find(passage => passage.id === sourceId);

		if (passage) {
			dispatch(
				updatePassage(story, passage, {
					text: insertAtPosition(passage.text, position, snippet)
				})
			);
			return;
		}

		if (sourceId.endsWith(':script')) {
			dispatch(
				updateStory(this.stories, story, {
					script: insertAtPosition(story.script, position, snippet)
				})
			);
			return;
		}

		if (sourceId.endsWith(':stylesheet')) {
			dispatch(
				updateStory(this.stories, story, {
					stylesheet: insertAtPosition(story.stylesheet, position, snippet)
				})
			);
		}
	}

	private publishAssetInventory(storyId: string, label: string, patch?: Patch) {
		const index = this.queryStoryIndex(storyId);
		const patches: Patch[] = [
			...(patch ? [patch] : []),
			{
				inventory: index.assetInventory,
				story_id: storyId,
				type: 'assetInventoryUpdated'
			},
			{
				index,
				story_id: storyId,
				type: 'storyIndexUpdated'
			}
		];

		this.publishPatches(label, patches);
	}

	private publishPatches(label: string, patches: Patch[]) {
		this.transactionId++;
		this.listeners.forEach(listener =>
			listener({
				label,
				patches,
				transactionId: this.transactionId
			})
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

	private markSaved() {
		this.savedStoryFingerprints = storyFingerprintMap(this.stories);

		if (this.dirty) {
			this.dirty = false;
			this.publishPatches('mark-saved', [
				{dirty: false, type: 'dirtyStateChanged'}
			]);
		}
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

	private replaceAssetReferencesInStory(
		storyId: string,
		oldPath: string,
		newPath: string,
		dispatch: (action: StoriesAction | StoriesActionOrThunk) => void
	) {
		const story = storyForId(this.stories, storyId);

		for (const passage of story.passages) {
			const text = replaceAssetReferencesInSource(
				passage.text,
				oldPath,
				newPath
			);

			if (text !== passage.text) {
				dispatch(updatePassage(story, passage, {text}));
			}
		}

		const script = replaceAssetReferencesInSource(
			story.script,
			oldPath,
			newPath
		);

		if (script !== story.script) {
			dispatch(updateStory(this.stories, story, {script}));
		}

		const stylesheet = replaceAssetReferencesInSource(
			story.stylesheet,
			oldPath,
			newPath
		);

		if (stylesheet !== story.stylesheet) {
			dispatch(updateStory(this.stories, story, {stylesheet}));
		}
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
		const explicitKnownAssets =
			typeof options === 'string' ? [] : (options.knownAssets ?? []);

		return typeof options === 'string'
			? normalizeStoryIndexOptions({
					knownAssets,
					query: options
				})
			: normalizeStoryIndexOptions({
					...options,
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

		return storyToCoreGraphProjection(
			storyForId(this.stories, storyId),
			normalizedOptions
		);
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
				console.warn(`Falling back to JS graph projection: ${error}`);
			}
		}

		return storyToCoreGraphProjection(
			storyForId(this.stories, storyId),
			normalizedOptions
		);
	}

	queryStoryIndex(storyId: string, options: StoryIndexQuery = {}) {
		const story = storyForId(this.stories, storyId);
		const knownAssets =
			this.assetInventoryByStory.get(storyId) ?? emptyAssetInventory;
		const explicitKnownAssets =
			typeof options === 'string' ? [] : (options.knownAssets ?? []);
		const canCache = explicitKnownAssets.length === 0;
		const cacheKey = storyIndexCacheKey(options);
		const storyCache = this.storyIndexCache.get(story);
		const cached = canCache ? storyCache?.get(cacheKey) : undefined;
		const normalizedOptions = this.normalizedStoryIndexOptions(
			storyId,
			options
		);
		const wasmCached = this.wasmClient.cachedStoryIndex(
			storyId,
			normalizedOptions,
			this.wasmProjectRevision
		);

		if (wasmCached && canCache) {
			return wasmCached;
		}

		if (cached?.knownAssets === knownAssets) {
			return cached.index;
		}

		const index = storyToCoreIndex(story, normalizedOptions);

		if (canCache) {
			const nextStoryCache =
				storyCache ?? new Map<string, StoryIndexCacheEntry>();

			nextStoryCache.set(cacheKey, {index, knownAssets});
			this.storyIndexCache.set(story, nextStoryCache);
		}

		return index;
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
				console.warn(`Falling back to JS story index: ${error}`);
			}
		}

		return storyToCoreIndex(
			storyForId(this.stories, storyId),
			normalizedOptions
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
			} else {
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
