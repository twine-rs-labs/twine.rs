import type {CoreAssetInventoryEntry} from './bindings/CoreAssetInventoryEntry';
import type {PassageSnapshot} from './bindings/PassageSnapshot';
import type {Patch} from './bindings/Patch';
import type {PatchBatch} from './bindings/PatchBatch';
import type {StoryMetadataPatch} from './bindings/StoryMetadataPatch';
import type {StorySnapshot} from './bindings/StorySnapshot';
import type {Passage, StoriesAction, Story} from '../store/stories';
import type {CorePatchStoryAction} from '../store/stories/stories.types';

export interface ProjectPatchApplicationSinks {
	deleteAsset(storyId: string, path: string): void;
	dispatch(action: StoriesAction): void;
	dispatchBatch?(actions: CorePatchStoryAction[]): void;
	renameAsset(storyId: string, oldPath: string, newPath: string): void;
	replaceAssetInventory(
		storyId: string,
		inventory: CoreAssetInventoryEntry[],
		options?: {assetScanComplete?: boolean}
	): void;
	setDirty(dirty: boolean): void;
	upsertAsset(storyId: string, asset: CoreAssetInventoryEntry): void;
}

export function applyProjectPatchBatch(
	batch: PatchBatch,
	sinks: ProjectPatchApplicationSinks,
	storyActions = projectPatchBatchStoryActions(batch)
) {
	for (const patch of batch.patches) {
		switch (patch.type) {
			case 'assetDeleted':
				sinks.deleteAsset(patch.story_id, patch.path);
				break;

			case 'assetImported':
			case 'assetReplaced':
				sinks.upsertAsset(patch.story_id, patch.asset);
				break;

			case 'assetInventoryUpdated':
				sinks.replaceAssetInventory(patch.story_id, patch.inventory);
				break;

			case 'assetRenamed':
				sinks.renameAsset(patch.story_id, patch.old_path, patch.new_path);
				break;

			case 'dirtyStateChanged':
				sinks.setDirty(patch.dirty);
				break;

			case 'assetRevealed':
			case 'assetSnippetCopied':
			case 'assetSnippetInserted':
			case 'graphProjectionUpdated':
			case 'layoutSaved':
			case 'passageCreated':
			case 'passageDeleted':
			case 'passageUpdated':
			case 'projectSnapshotReplaced':
			case 'startPassageChanged':
			case 'storyCreated':
			case 'storyDeleted':
			case 'storyIndexUpdated':
			case 'storyMetadataUpdated':
			case 'storyScriptUpdated':
			case 'storyStylesheetUpdated':
				break;
		}
	}

	if (storyActions.length > 0 && sinks.dispatchBatch) {
		sinks.dispatchBatch(storyActions);
	} else {
		for (const action of storyActions) {
			sinks.dispatch(action);
		}
	}

	return {dispatchedStoryActions: storyActions.length};
}

export function projectPatchBatchStoryActions(batch: PatchBatch) {
	const actions: CorePatchStoryAction[] = [];

	for (const patch of batch.patches) {
		switch (patch.type) {
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

	return actions;
}

export function passageSnapshotToProps(
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

export function storySnapshotToStory(story: StorySnapshot): Story {
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
		...(changes.snapToGrid !== null ? {snapToGrid: changes.snapToGrid} : {}),
		...(changes.storyFormat !== null ? {storyFormat: changes.storyFormat} : {}),
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

function projectSnapshotToStories(
	snapshot: Patch & {type: 'projectSnapshotReplaced'}
) {
	return snapshot.snapshot.stories.map(storySnapshotToStory);
}
