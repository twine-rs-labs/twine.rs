import type {CoreGraphProjectionOptions} from './bindings/CoreGraphProjectionOptions';
import type {CoreRect} from './bindings/CoreRect';
import type {CoreStoryIndex} from './bindings/CoreStoryIndex';
import type {CoreStoryIndexOptions} from './bindings/CoreStoryIndexOptions';
import type {PassageMove} from './bindings/PassageMove';
import type {Patch} from './bindings/Patch';
import type {PatchBatch} from './bindings/PatchBatch';
import type {ProjectSnapshot} from './bindings/ProjectSnapshot';
import type {StoryCommand} from './bindings/StoryCommand';

export * from './story-index';
export * from './project-host';
export * from './view-models';

export type {
	CoreGraphProjectionOptions,
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
