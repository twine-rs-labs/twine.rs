import * as React from 'react';
import type {CoreStoryIndex} from './bindings/CoreStoryIndex';
import type {CoreStoryIndexOptions} from './bindings/CoreStoryIndexOptions';
import type {PatchBatch} from './bindings/PatchBatch';
import type {StoryCommand} from './bindings/StoryCommand';
import {storyToCoreIndex} from './story-index';
import {
	StoriesAction,
	StoriesState,
	Story,
	deletePassages,
	storyWithId,
	updatePassage,
	updateStory
} from '../store/stories';
import type {StoriesActionOrThunk} from '../store/undoable-stories';
import {useUndoableStoriesContext} from '../store/undoable-stories';

export type StoryIndexQuery = string | Partial<CoreStoryIndexOptions>;

export type CoreProjectPatchListener = (patches: PatchBatch) => void;

export interface CoreProjectHost {
	applyStoryCommand(command: StoryCommand, annotation?: string): void;
	queryStoryIndex(storyId: string, options?: StoryIndexQuery): CoreStoryIndex;
	subscribeToPatches(listener: CoreProjectPatchListener): () => void;
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
		case 'setPassageTags':
			return 'undoChange.changeTags';
		case 'setStartPassage':
			return 'undoChange.startPassage';
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

function passageForId(story: Story, passageId: string) {
	const passage = story.passages.find(passage => passage.id === passageId);

	if (!passage) {
		throw new Error(
			`No passage with ID "${passageId}" exists in story "${story.id}".`
		);
	}

	return passage;
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

export class StoreCoreProjectHost implements CoreProjectHost {
	private dispatch: UndoableDispatch;
	private listeners = new Set<CoreProjectPatchListener>();
	private publishedStories = new Map<string, Story>();
	private stories: StoriesState;
	private transactionId = BigInt(0);

	constructor(stories: StoriesState, dispatch: UndoableDispatch) {
		this.dispatch = dispatch;
		this.stories = stories;
	}

	applyStoryCommand(command: StoryCommand, annotation?: string) {
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

			case 'deletePassages': {
				const story = storyForId(this.stories, command.story_id);
				const passages = command.passage_ids.map(id => passageForId(story, id));

				dispatch(deletePassages(story, passages));
				return;
			}

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

			case 'updatePassageText': {
				const story = storyForId(this.stories, command.story_id);
				const passage = passageForId(story, command.passage_id);

				dispatch(updatePassage(story, passage, {text: command.text}));
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

			case 'markSaved':
			case 'copyAssetSnippet':
			case 'deleteAsset':
			case 'importAsset':
			case 'insertAssetSnippet':
			case 'queryGraphProjection':
			case 'queryStoryIndex':
			case 'renameAsset':
			case 'replaceAsset':
			case 'revealAsset':
			case 'saveGeneratedLayout':
			case 'validateAssetReferences':
				return;
		}
	}

	publishStoryIndexPatches() {
		const patches = this.stories
			.filter(story => this.publishedStories.get(story.id) !== story)
			.map(story => ({
				index: this.queryStoryIndex(story.id),
				story_id: story.id,
				type: 'storyIndexUpdated' as const
			}));

		this.publishedStories = new Map(
			this.stories.map(story => [story.id, story])
		);

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

	queryStoryIndex(storyId: string, options: StoryIndexQuery = {}) {
		return storyToCoreIndex(storyForId(this.stories, storyId), options);
	}

	subscribeToPatches(listener: CoreProjectPatchListener) {
		this.listeners.add(listener);

		return () => this.listeners.delete(listener);
	}

	update(stories: StoriesState, dispatch: UndoableDispatch) {
		this.dispatch = dispatch;
		this.stories = stories;
	}
}

export function useCoreProjectHost() {
	const {dispatch, stories} = useUndoableStoriesContext();
	const hostRef = React.useRef<StoreCoreProjectHost>();

	if (!hostRef.current) {
		hostRef.current = new StoreCoreProjectHost(stories, dispatch);
	}

	hostRef.current.update(stories, dispatch);

	React.useEffect(() => {
		hostRef.current?.publishStoryIndexPatches();
	}, [stories]);

	return hostRef.current;
}
