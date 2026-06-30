import type {CoreAssetInventoryEntry} from '../core/bindings/CoreAssetInventoryEntry';
import type {CoreRect} from '../core/bindings/CoreRect';
import type {CoreSessionMutationResult} from '../core/wasm/twine-wasm-client';
import type {PassagePatch} from '../core/bindings/PassagePatch';
import type {PassageSnapshot} from '../core/bindings/PassageSnapshot';
import type {Patch} from '../core/bindings/Patch';
import type {PatchBatch} from '../core/bindings/PatchBatch';
import type {ProjectSnapshot} from '../core/bindings/ProjectSnapshot';
import type {StoryCommand} from '../core/bindings/StoryCommand';
import type {StoryMetadataPatch} from '../core/bindings/StoryMetadataPatch';
import type {StorySnapshot} from '../core/bindings/StorySnapshot';
import {
	assetKindForPath,
	assetSnippet,
	normalizedAssetPath,
	projectAssetPath,
	replaceAssetReferencesInSource
} from '../core/asset-paths';
import {storyToCoreGraphProjection} from '../core/graph-projection';
import {storySnapshotToStory} from '../core/patch-applier';
import {storyToCoreIndex} from '../core/story-index';

function cloneSnapshot(snapshot: ProjectSnapshot): ProjectSnapshot {
	return JSON.parse(JSON.stringify(snapshot));
}

function emptyMetadataPatch(): StoryMetadataPatch {
	return {
		name: null,
		snapToGrid: null,
		storyFormat: null,
		storyFormatVersion: null,
		tagColors: null,
		tags: null,
		zoom: null
	};
}

function emptyPassagePatch(): PassagePatch {
	return {
		layout: null,
		name: null,
		tags: null,
		text: null
	};
}

function fileName(path: string) {
	return path.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? 'asset';
}

function assetEntry(path: string, sourcePath = path): CoreAssetInventoryEntry {
	const normalizedPath = normalizedAssetPath(path);
	const kind = assetKindForPath(path);
	const previewUrl = sourcePath.startsWith('/') ? `file://${sourcePath}` : null;

	return {
		durationMs: null,
		exists: true,
		height: null,
		kind,
		missing: false,
		modifiedAt: null,
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

function passagePatch(
	storyId: string,
	passage: PassageSnapshot,
	changes: PassagePatch
): Patch {
	return {
		changes,
		passage_id: passage.id,
		story_id: storyId,
		type: 'passageUpdated'
	};
}

function metadataPatch(
	storyId: string,
	story: StorySnapshot,
	changes: Partial<StoryMetadataPatch>
): Patch {
	return {
		changes: {...emptyMetadataPatch(), ...changes},
		story_id: storyId,
		type: 'storyMetadataUpdated'
	};
}

function passageSnapshot(
	storyId: string,
	options: {
		id: string;
		layout: CoreRect | null;
		name: string;
		tags: string[];
		text: string;
	}
): PassageSnapshot {
	return {
		id: options.id,
		layout: options.layout,
		name: options.name,
		storyId,
		tags: options.tags,
		text: options.text
	};
}

export class TestCoreSessionClient {
	private assetInventoryByStory = new Map<string, CoreAssetInventoryEntry[]>();
	private nextPassageId = 1;
	private revision = 1;
	private snapshot: ProjectSnapshot = {
		dirty: false,
		name: 'Test Project',
		schemaVersion: 1,
		stories: []
	};

	private currentStatus() {
		return {
			canRedo: false,
			canUndo: false,
			dirty: false,
			redoKind: null,
			revision: this.revision,
			undoKind: null
		};
	}

	enabled = true;
	mode = 'wasm-worker' as const;

	acknowledgeSaved = jest.fn(
		async (
			_sessionId: string,
			revision: number
		): Promise<CoreSessionMutationResult> => ({
			batch: {
				label: 'Mark Saved',
				patches: [{dirty: false, type: 'dirtyStateChanged'}],
				transactionId: BigInt(revision)
			},
			revision,
			status: {...this.currentStatus(), dirty: false}
		})
	);
	apply = jest.fn(
		async (_sessionId: string, command: StoryCommand, revision: number) =>
			this.applySync(command, revision)
	);
	applySync = jest.fn((command: StoryCommand, revision: number) =>
		this.applyCommand(command, revision)
	);
	cachedGraphProjection = jest.fn();
	cachedStoryIndex = jest.fn();
	lastGraphProjection = jest.fn();
	queryGraphProjection = jest.fn(async (_sessionId, storyId, options) =>
		storyToCoreGraphProjection(
			storySnapshotToStory(this.story(storyId)),
			options
		)
	);
	queryStoryIndex = jest.fn(async (_sessionId, storyId, options) =>
		storyToCoreIndex(storySnapshotToStory(this.story(storyId)), options)
	);
	redo = jest.fn(async (sessionId: string, revision: number) => {
		void sessionId;
		void revision;
		return null;
	});
	replaceProject = jest.fn(
		async (_sessionId: string, snapshot: ProjectSnapshot, revision: number) => {
			this.replaceProjectSync(snapshot, revision);
		}
	);
	replaceProjectSync = jest.fn((snapshot: ProjectSnapshot, revision = 1) => {
		this.snapshot = cloneSnapshot(snapshot);
		this.revision = revision;
	});
	undo = jest.fn(async (sessionId: string, revision: number) => {
		void sessionId;
		void revision;
		return null;
	});

	private story(storyId: string) {
		const story = this.snapshot.stories.find(story => story.id === storyId);

		if (!story) {
			throw new Error(`Unknown story: ${storyId}`);
		}

		return story;
	}

	private passage(story: StorySnapshot, passageId: string) {
		const passage = story.passages.find(passage => passage.id === passageId);

		if (!passage) {
			throw new Error(`Unknown passage: ${passageId}`);
		}

		return passage;
	}

	private updatePassageReferences(
		story: StorySnapshot,
		oldPath: string,
		newPath: string
	) {
		const patches: Patch[] = [];

		for (const passage of story.passages) {
			const nextText = replaceAssetReferencesInSource(
				passage.text,
				oldPath,
				newPath
			);

			if (nextText !== passage.text) {
				passage.text = nextText;
				patches.push(
					passagePatch(story.id, passage, {
						...emptyPassagePatch(),
						text: nextText
					})
				);
			}
		}

		const nextScript = replaceAssetReferencesInSource(
			story.script,
			oldPath,
			newPath
		);
		const nextStylesheet = replaceAssetReferencesInSource(
			story.stylesheet,
			oldPath,
			newPath
		);

		if (nextScript !== story.script) {
			story.script = nextScript;
			patches.push({
				script: nextScript,
				story_id: story.id,
				type: 'storyScriptUpdated'
			});
		}

		if (nextStylesheet !== story.stylesheet) {
			story.stylesheet = nextStylesheet;
			patches.push({
				story_id: story.id,
				stylesheet: nextStylesheet,
				type: 'storyStylesheetUpdated'
			});
		}

		return patches;
	}

	private upsertAsset(storyId: string, asset: CoreAssetInventoryEntry) {
		const assets = this.assetInventoryByStory.get(storyId) ?? [];
		const withoutAsset = assets.filter(
			existing => existing.normalizedPath !== asset.normalizedPath
		);
		const inventory = [...withoutAsset, asset];

		this.assetInventoryByStory.set(storyId, inventory);
		return inventory;
	}

	private applyCommand(
		command: StoryCommand,
		revision: number
	): CoreSessionMutationResult {
		const patches = this.commandPatches(command);
		const hasDirtyPatch = patches.some(
			patch => patch.type === 'dirtyStateChanged'
		);
		const nextRevision = revision + 1;

		this.revision = nextRevision;

		const batch: PatchBatch = {
			label: `Test ${command.type}`,
			patches:
				patches.length > 0 && !hasDirtyPatch
					? [...patches, {dirty: true, type: 'dirtyStateChanged'}]
					: patches,
			transactionId: BigInt(revision)
		};

		return {batch, revision: nextRevision, status: this.currentStatus()};
	}

	private commandPatches(command: StoryCommand): Patch[] {
		switch (command.type) {
			case 'batch':
				return command.commands.flatMap(command =>
					this.commandPatches(command)
				);

			case 'copyAssetSnippet':
				return [
					{
						path: command.path,
						snippet: command.snippet ?? assetSnippet(command.path).text,
						story_id: command.story_id,
						type: 'assetSnippetCopied'
					}
				];

			case 'createPassage': {
				const story = this.story(command.story_id);
				const passage = passageSnapshot(story.id, {
					id: command.id ?? `test-passage-${this.nextPassageId++}`,
					layout: command.layout,
					name: command.name ?? 'Untitled Passage',
					tags: command.tags,
					text: command.text
				});
				const wasEmpty = story.passages.length === 0;

				story.passages.push(passage);

				return [
					{
						passage,
						story_id: story.id,
						type: 'passageCreated'
					},
					...(wasEmpty
						? [
								{
									passage_id: passage.id,
									story_id: story.id,
									type: 'startPassageChanged' as const
								}
							]
						: [])
				];
			}

			case 'createStory':
				this.snapshot.stories.push(command.story);
				return [{story: command.story, type: 'storyCreated'}];

			case 'deleteAsset': {
				const story = this.story(command.story_id);
				const normalizedPath = normalizedAssetPath(command.path);
				const assets = this.assetInventoryByStory
					.get(story.id)
					?.filter(asset => asset.normalizedPath !== normalizedPath);

				if (assets) {
					this.assetInventoryByStory.set(story.id, assets);
				}

				return [
					...(command.remove_references
						? this.updatePassageReferences(story, command.path, '')
						: []),
					{
						path: command.path,
						story_id: story.id,
						type: 'assetDeleted' as const
					},
					...(assets
						? [
								{
									inventory: assets,
									story_id: story.id,
									type: 'assetInventoryUpdated' as const
								}
							]
						: [])
				];
			}

			case 'deletePassages': {
				const story = this.story(command.story_id);
				const deleting = new Set(command.passage_ids);

				story.passages = story.passages.filter(
					passage => !deleting.has(passage.id)
				);

				return command.passage_ids.map(passageId => ({
					passage_id: passageId,
					story_id: story.id,
					type: 'passageDeleted'
				}));
			}

			case 'deleteStory':
				this.snapshot.stories = this.snapshot.stories.filter(
					story => story.id !== command.story_id
				);
				return [{story_id: command.story_id, type: 'storyDeleted'}];

			case 'importAsset': {
				const path =
					command.target_path ??
					projectAssetPath(`assets/${fileName(command.source_path)}`);
				const asset = assetEntry(path, command.source_path);
				const inventory = this.upsertAsset(command.story_id, asset);

				return [
					{asset, story_id: command.story_id, type: 'assetImported'},
					{
						inventory,
						story_id: command.story_id,
						type: 'assetInventoryUpdated'
					}
				];
			}

			case 'insertAssetSnippet': {
				const story = this.story(command.story_id);
				const passage = this.passage(
					story,
					command.passage_id ?? command.source_id
				);
				const snippet = command.snippet ?? assetSnippet(command.path).text;
				const position = Math.max(
					0,
					Math.min(command.position, passage.text.length)
				);
				const text = `${passage.text.slice(0, position)}${snippet}${passage.text.slice(position)}`;

				passage.text = text;

				return [
					{
						path: command.path,
						snippet,
						source_id: command.source_id,
						story_id: story.id,
						type: 'assetSnippetInserted'
					},
					passagePatch(story.id, passage, {
						...emptyPassagePatch(),
						text
					})
				];
			}

			case 'movePassages': {
				const story = this.story(command.story_id);

				return command.moves.map(move => {
					const passage = this.passage(story, move.passageId);

					passage.layout = move.bounds;
					return passagePatch(story.id, passage, {
						...emptyPassagePatch(),
						layout: move.bounds
					});
				});
			}

			case 'renameAsset': {
				const story = this.story(command.story_id);
				const normalizedPath = normalizedAssetPath(command.path);
				const assets = this.assetInventoryByStory.get(story.id) ?? [];
				const inventory = assets.map(asset =>
					asset.normalizedPath === normalizedPath
						? assetEntry(command.new_path, asset.previewUrl ?? command.new_path)
						: asset
				);

				this.assetInventoryByStory.set(story.id, inventory);

				return [
					...(command.update_references
						? this.updatePassageReferences(
								story,
								command.path,
								command.new_path
							)
						: []),
					{
						new_path: command.new_path,
						old_path: command.path,
						story_id: story.id,
						type: 'assetRenamed' as const
					},
					{
						inventory,
						story_id: story.id,
						type: 'assetInventoryUpdated' as const
					}
				];
			}

			case 'renamePassage': {
				const story = this.story(command.story_id);
				const passage = this.passage(story, command.passage_id);

				passage.name = command.name;
				return [
					passagePatch(story.id, passage, {
						...emptyPassagePatch(),
						name: command.name
					})
				];
			}

			case 'renamePassageTag': {
				const story = this.story(command.story_id);

				return story.passages.flatMap(passage => {
					if (!passage.tags.includes(command.old_name)) {
						return [];
					}

					passage.tags = passage.tags.map(tag =>
						tag === command.old_name ? command.new_name : tag
					);

					return [
						passagePatch(story.id, passage, {
							...emptyPassagePatch(),
							tags: passage.tags
						})
					];
				});
			}

			case 'renameStory': {
				const story = this.story(command.story_id);

				story.name = command.name;
				return [metadataPatch(story.id, story, {name: command.name})];
			}

			case 'renameStoryTag':
				return this.snapshot.stories.flatMap(story => {
					if (!story.tags.includes(command.old_name)) {
						return [];
					}

					story.tags = story.tags.map(tag =>
						tag === command.old_name ? command.new_name : tag
					);

					return [metadataPatch(story.id, story, {tags: story.tags})];
				});

			case 'replaceAsset': {
				const asset = assetEntry(command.path, command.source_path);
				const inventory = this.upsertAsset(command.story_id, asset);

				return [
					{asset, story_id: command.story_id, type: 'assetReplaced'},
					{
						inventory,
						story_id: command.story_id,
						type: 'assetInventoryUpdated'
					}
				];
			}

			case 'replaceStory': {
				const index = this.snapshot.stories.findIndex(
					story => story.id === command.story_id
				);

				if (index === -1) {
					this.snapshot.stories.push(command.story);
				} else {
					this.snapshot.stories[index] = command.story;
				}

				return [
					{
						snapshot: this.snapshot,
						type: 'projectSnapshotReplaced'
					}
				];
			}

			case 'restorePassages': {
				const story = this.story(command.story_id);

				story.passages.push(...command.passages);
				return command.passages.map(passage => ({
					passage,
					story_id: story.id,
					type: 'passageCreated'
				}));
			}

			case 'setPassageTags': {
				const story = this.story(command.story_id);
				const passage = this.passage(story, command.passage_id);

				passage.tags = command.tags;
				return [
					passagePatch(story.id, passage, {
						...emptyPassagePatch(),
						tags: command.tags
					})
				];
			}

			case 'setStartPassage': {
				const story = this.story(command.story_id);

				story.startPassageId = command.passage_id;
				return [
					{
						passage_id: command.passage_id,
						story_id: story.id,
						type: 'startPassageChanged'
					}
				];
			}

			case 'setStoryFormat': {
				const story = this.story(command.story_id);

				story.storyFormat = command.story_format;
				story.storyFormatVersion = command.story_format_version;
				return [
					metadataPatch(story.id, story, {
						storyFormat: command.story_format,
						storyFormatVersion: command.story_format_version
					})
				];
			}

			case 'setStorySnapToGrid': {
				const story = this.story(command.story_id);

				story.snapToGrid = command.enabled;
				return [metadataPatch(story.id, story, {snapToGrid: command.enabled})];
			}

			case 'setStoryTagColor': {
				const story = this.story(command.story_id);

				if (command.color === null) {
					delete story.tagColors[command.name];
				} else {
					story.tagColors[command.name] = command.color;
				}

				return [metadataPatch(story.id, story, {tagColors: story.tagColors})];
			}

			case 'setStoryTags': {
				const story = this.story(command.story_id);

				story.tags = command.tags;
				return [metadataPatch(story.id, story, {tags: command.tags})];
			}

			case 'setStoryZoom': {
				const story = this.story(command.story_id);

				story.zoom = command.zoom;
				return [metadataPatch(story.id, story, {zoom: command.zoom})];
			}

			case 'updatePassage': {
				const story = this.story(command.story_id);
				const passage = this.passage(story, command.passage_id);

				if (command.changes.layout !== null) {
					passage.layout = command.changes.layout;
				}

				if (command.changes.name !== null) {
					passage.name = command.changes.name;
				}

				if (command.changes.tags !== null) {
					passage.tags = command.changes.tags;
				}

				if (command.changes.text !== null) {
					passage.text = command.changes.text;
				}

				return [passagePatch(story.id, passage, command.changes)];
			}

			case 'updatePassageText': {
				const story = this.story(command.story_id);
				const passage = this.passage(story, command.passage_id);

				passage.text = command.text;
				return [
					passagePatch(story.id, passage, {
						...emptyPassagePatch(),
						text: command.text
					})
				];
			}

			case 'updateStoryScript': {
				const story = this.story(command.story_id);

				story.script = command.script;
				return [
					{
						script: command.script,
						story_id: story.id,
						type: 'storyScriptUpdated'
					}
				];
			}

			case 'updateStoryStylesheet': {
				const story = this.story(command.story_id);

				story.stylesheet = command.stylesheet;
				return [
					{
						story_id: story.id,
						stylesheet: command.stylesheet,
						type: 'storyStylesheetUpdated'
					}
				];
			}

			case 'queryGraphProjection':
			case 'queryStoryIndex':
			case 'revealAsset':
			case 'saveGeneratedLayout':
			case 'validateAssetReferences':
				return [];
		}

		throw new Error(
			`Unsupported test command: ${(command as StoryCommand).type}`
		);
	}
}

export function createTestCoreSessionClient() {
	return new TestCoreSessionClient();
}
