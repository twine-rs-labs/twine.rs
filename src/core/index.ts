import type {CoreGraphProjectionOptions} from './bindings/CoreGraphProjectionOptions';
import type {CoreAssetInventoryEntry} from './bindings/CoreAssetInventoryEntry';
import type {CoreRect} from './bindings/CoreRect';
import type {CoreStoryIndex} from './bindings/CoreStoryIndex';
import type {CoreStoryIndexOptions} from './bindings/CoreStoryIndexOptions';
import type {PassageMove} from './bindings/PassageMove';
import type {Patch} from './bindings/Patch';
import type {PatchBatch} from './bindings/PatchBatch';
import type {ProjectSnapshot} from './bindings/ProjectSnapshot';
import type {StoryCommand} from './bindings/StoryCommand';

export * from './story-index';
export * from './graph-projection';
export * from './project-host';
export * from './view-models';

export type {
	CoreGraphProjectionOptions,
	CoreAssetInventoryEntry,
	CoreRect,
	CoreStoryIndex,
	CoreStoryIndexOptions,
	PassageMove,
	Patch,
	PatchBatch,
	ProjectSnapshot,
	StoryCommand
};

export function createPassageCommand(
	storyId: string,
	options: {
		id?: string;
		layout?: CoreRect;
		name?: string;
		tags?: string[];
		text?: string;
	} = {}
): StoryCommand {
	return {
		type: 'createPassage',
		id: options.id ?? null,
		layout: options.layout ?? null,
		name: options.name ?? null,
		story_id: storyId,
		tags: options.tags ?? [],
		text: options.text ?? ''
	};
}

export function deletePassagesCommand(
	storyId: string,
	passageIds: string[]
): StoryCommand {
	return {
		type: 'deletePassages',
		passage_ids: passageIds,
		story_id: storyId
	};
}

export function updatePassageTextCommand(
	storyId: string,
	passageId: string,
	text: string
): StoryCommand {
	return {
		type: 'updatePassageText',
		passage_id: passageId,
		story_id: storyId,
		text
	};
}

export function updateStoryScriptCommand(
	storyId: string,
	script: string
): StoryCommand {
	return {
		type: 'updateStoryScript',
		script,
		story_id: storyId
	};
}

export function updateStoryStylesheetCommand(
	storyId: string,
	stylesheet: string
): StoryCommand {
	return {
		type: 'updateStoryStylesheet',
		story_id: storyId,
		stylesheet
	};
}

export function markSavedCommand(): StoryCommand {
	return {
		type: 'markSaved'
	};
}

export function renamePassageCommand(
	storyId: string,
	passageId: string,
	name: string,
	updateReferences = true
): StoryCommand {
	return {
		type: 'renamePassage',
		name,
		passage_id: passageId,
		story_id: storyId,
		update_references: updateReferences
	};
}

export function setPassageTagsCommand(
	storyId: string,
	passageId: string,
	tags: string[]
): StoryCommand {
	return {
		type: 'setPassageTags',
		passage_id: passageId,
		story_id: storyId,
		tags
	};
}

export function setStartPassageCommand(
	storyId: string,
	passageId: string
): StoryCommand {
	return {
		type: 'setStartPassage',
		passage_id: passageId,
		story_id: storyId
	};
}

export function queryGraphProjectionCommand(
	storyId: string,
	options: CoreGraphProjectionOptions
): StoryCommand {
	return {
		type: 'queryGraphProjection',
		options,
		story_id: storyId
	};
}

export function queryStoryIndexCommand(
	storyId: string,
	options: CoreStoryIndexOptions = {
		fuzzy: false,
		includeAssets: true,
		includePassageNames: true,
		includePassageText: true,
		includeScript: true,
		includeStylesheet: true,
		includeTags: true,
		includeVariables: true,
		knownAssets: [],
		matchCase: false,
		query: null,
		replacement: null,
		useRegexes: false
	}
): StoryCommand {
	return {
		type: 'queryStoryIndex',
		options,
		story_id: storyId
	};
}

export function movePassagesCommand(
	storyId: string,
	moves: PassageMove[]
): StoryCommand {
	return {
		type: 'movePassages',
		moves,
		story_id: storyId
	};
}

export function saveGeneratedLayoutCommand(storyId: string): StoryCommand {
	return {
		type: 'saveGeneratedLayout',
		story_id: storyId
	};
}

export function importAssetCommand(
	storyId: string,
	sourcePath: string,
	options: {overwrite?: boolean; targetPath?: string} = {}
): StoryCommand {
	return {
		type: 'importAsset',
		overwrite: options.overwrite ?? false,
		source_path: sourcePath,
		story_id: storyId,
		target_path: options.targetPath ?? null
	};
}

export function renameAssetCommand(
	storyId: string,
	path: string,
	newPath: string,
	updateReferences = true
): StoryCommand {
	return {
		type: 'renameAsset',
		new_path: newPath,
		path,
		story_id: storyId,
		update_references: updateReferences
	};
}

export function deleteAssetCommand(
	storyId: string,
	path: string,
	removeReferences = false
): StoryCommand {
	return {
		type: 'deleteAsset',
		path,
		remove_references: removeReferences,
		story_id: storyId
	};
}

export function replaceAssetCommand(
	storyId: string,
	path: string,
	sourcePath: string
): StoryCommand {
	return {
		type: 'replaceAsset',
		path,
		source_path: sourcePath,
		story_id: storyId
	};
}

export function revealAssetCommand(storyId: string, path: string): StoryCommand {
	return {
		type: 'revealAsset',
		path,
		story_id: storyId
	};
}

export function copyAssetSnippetCommand(
	storyId: string,
	path: string,
	snippet?: string
): StoryCommand {
	return {
		type: 'copyAssetSnippet',
		path,
		snippet: snippet ?? null,
		story_id: storyId
	};
}

export function insertAssetSnippetCommand(
	storyId: string,
	path: string,
	sourceId: string,
	position: number,
	options: {passageId?: string; snippet?: string} = {}
): StoryCommand {
	return {
		type: 'insertAssetSnippet',
		passage_id: options.passageId ?? null,
		path,
		position,
		snippet: options.snippet ?? null,
		source_id: sourceId,
		story_id: storyId
	};
}

export function validateAssetReferencesCommand(storyId: string): StoryCommand {
	return {
		type: 'validateAssetReferences',
		story_id: storyId
	};
}
