import {Thunk, ThunkDispatch} from '../../util/use-thunk-reducer';
import {Color} from '../../util/color';
import type {
	ProjectFolderDocumentUpdate,
	ProjectFolderSaveHint
} from '../persistence/project-folder-save-hints';
import {StoryFormat} from '../story-formats/story-formats.types';

/**
 * A single passage in a story.
 */
export interface Passage {
	/**
	 * Height of the passage in pixels.
	 */
	height: number;
	/**
	 * Should the passage be drawn highlighted?
	 */
	highlighted: boolean;
	/**
	 * GUID identifying the passage.
	 */
	id: string;
	/**
	 * Left (e.g. X) position of the top-left corner of the passage in pixels.
	 */
	left: number;
	/**
	 * Name of the passage.
	 */
	name: string;
	/**
	 * Is the passage currently selected by the user?
	 */
	selected: boolean;
	/**
	 * ID of the parent story.
	 */
	story: string;
	/**
	 * Passage tags.
	 */
	tags: string[];
	/**
	 * Top (e.g. Y) position of the top-left corner of the passage in pixels.
	 */
	top: number;
	/**
	 * Width of the passage in pixels.
	 */
	width: number;
}

/** A passage document used only at explicit transport/materialization boundaries. */
export interface PassageWithText extends Passage {
	text: string;
}

export interface Story {
	/**
	 * IFID of the story. An IFID should stay stable when a story is imported or exported.
	 */
	ifid: string;
	/**
	 * GUID identifying the story.
	 */
	id: string;
	/**
	 * When the story was last changed.
	 */
	lastUpdate: Date;
	/**
	 * Name of the story.
	 */
	name: string;
	/**
	 * Passages in the story.
	 */
	passages: Passage[];
	/**
	 * Author-created JavaScript associated with the story.
	 */
	script: string;
	/**
	 * Is the story currently selected by the user?
	 */
	selected: boolean;
	/**
	 * Should passages snap to a grid?
	 */
	snapToGrid: boolean;
	/**
	 * ID of the passage that the story begins at.
	 */
	startPassage: string;
	/**
	 * Name of the story format the story uses.
	 */
	storyFormat: string;
	/**
	 * Version of the story format that this story uses.
	 */
	storyFormatVersion: string;
	/**
	 * Author-created CSS associated with the story.
	 */
	stylesheet: string;
	/**
	 * Tags applied to the story.
	 */
	tags: string[];
	/**
	 * Author-specified colors for passage tags.
	 */
	tagColors: TagColors;
	/**
	 * Zoom level the story is displayed at.
	 */
	zoom: number;
}

/** A complete story snapshot used for import, recovery, build, and persistence. */
export interface StoryWithDocuments extends Omit<Story, 'passages'> {
	passages: PassageWithText[];
}

export type StoriesState = Story[];

// Action types.

export interface InitStoriesAction {
	type: 'init';
	state: Story[];
}

export interface RepairStoriesAction {
	type: 'repair';
	allFormats: StoryFormat[];
	defaultFormat: StoryFormat;
}

export type CreateStoryPassageProps = Partial<PassageWithText> &
	Pick<Passage, 'id'>;

export interface CreateStoryProps extends Omit<Partial<Story>, 'passages'> {
	passages?: CreateStoryPassageProps[];
}

export interface CreateStoryAction {
	type: 'createStory';
	props: CreateStoryProps;
}

export interface UpdateStoryAction {
	type: 'updateStory';
	props: Partial<Omit<Story, 'id'>>;
	storyId: string;
}

export interface DeleteStoryAction {
	storageKind?: 'electron-project-folder' | 'web-local';
	type: 'deleteStory';
	storyId: string;
}

export interface CreatePassageAction {
	type: 'createPassage';
	props: Partial<Passage>;
	storyId: string;
}

export interface CreatePassagesAction {
	type: 'createPassages';
	props: Partial<Passage>[];
	storyId: string;
}

export interface UpdatePassageAction {
	type: 'updatePassage';
	passageId: string;
	props: Partial<Passage>;
	storyId: string;
}

export interface UpdatePassagesAction {
	type: 'updatePassages';
	passageUpdates: Record<string, Partial<Passage>>;
	storyId: string;
}

export interface DeletePassageAction {
	type: 'deletePassage';
	passageId: string;
	storyId: string;
}

export interface DeletePassagesAction {
	type: 'deletePassages';
	passageIds: string[];
	storyId: string;
}

export type CorePatchStoryAction =
	| InitStoriesAction
	| RepairStoriesAction
	| CreateStoryAction
	| UpdateStoryAction
	| DeleteStoryAction
	| CreatePassageAction
	| CreatePassagesAction
	| UpdatePassageAction
	| UpdatePassagesAction
	| DeletePassageAction
	| DeletePassagesAction;

export interface ApplyCorePatchBatchAction {
	actions: CorePatchStoryAction[];
	documentUpdates?: ProjectFolderDocumentUpdate[];
	persistence?: 'skip';
	persistenceHints?: ProjectFolderSaveHint[];
	persistenceToken?: string;
	revision?: number;
	sessionId?: string;
	storyIds?: string[];
	type: 'applyCorePatchBatch';
}

/**
 * Removes renderer shells after the project/library service has destroyed the
 * corresponding whole-project resource. This is lifecycle teardown, not a
 * project-content mutation or an undoable core patch.
 */
export interface RetireProjectStoriesAction {
	storyIds: string[];
	type: 'retireProjectStories';
}

export type StoriesAction =
	CorePatchStoryAction | ApplyCorePatchBatchAction | RetireProjectStoriesAction;

export type StoriesActionOrThunk =
	StoriesAction | Thunk<StoriesState, StoriesAction>;

export type StoriesDispatch = ThunkDispatch<StoriesState, StoriesAction>;

export interface StorySearchFlags {
	includePassageNames?: boolean;
	matchCase?: boolean;
	useRegexes?: boolean;
}

export type TagColors = Record<string, Exclude<Color, 'none'>>;

export interface StoriesContextProps {
	dispatch: StoriesDispatch;
	stories: Story[];
}
