import {TwineElectronWindow} from '../../../../electron/shared';
import {
	StoriesAction,
	StoriesState,
	storyWithId,
	storyWithName
} from '../../../stories';
import {StoryFormatsState} from '../../../story-formats';
import {
	isPersistablePassageChange,
	isPersistableStoryChange
} from '../../persistable-changes';
import {loadProjectMetadata} from '../../../project-metadata';
import {saveStory} from './save-story';

// When a story is deleted, we need to be able to look up information about it
// from the last state.

let lastState: StoriesState;

function isNativeProjectStory(storyId: string) {
	const metadata = loadProjectMetadata(storyId);

	return (
		metadata?.storageKind === 'electron-project-folder' &&
		metadata.status === 'file-backed' &&
		!!metadata.rootPath
	);
}

/**
 * A middleware function to save changes to disk. This should be called *after*
 * the main reducer runs.
 *
 * This has an extra argument: functions to archive and publish a story. This is
 * because the Electron app saves stories in published format.
 */
export function saveMiddleware(
	state: StoriesState,
	action: StoriesAction,
	formats: StoryFormatsState
) {
	const {twineElectron} = window as TwineElectronWindow;
	let persisted = false;

	if (!twineElectron) {
		throw new Error('Electron bridge is not present on window.');
	}

	switch (action.type) {
		case 'init':
		case 'repair':
			// We take no action here on a repair action. This is to prevent messing up a
			// story's last modified date. If the user then edits the story, we'll save
			// their change and the repair then.
			break;

		case 'createStory':
			if (!action.props.name) {
				throw new Error('Passage was created but with no name specified');
			}

			saveStory(storyWithName(state, action.props.name), formats);
			persisted = true;
			break;

		case 'deleteStory': {
			// We have to look up the story in our saved last state to know what file
			// to delete.

			twineElectron.deleteStory(storyWithId(lastState, action.storyId));
			persisted = true;
			break;
		}

		case 'updateStory':
			if (isPersistableStoryChange(action.props)) {
				if (action.props.name) {
					// The story has been renamed, and we need to process it
					// specially. We rename the story file, then save it to catch
					// any other changes.

					const newStory = storyWithId(state, action.storyId);

					if (isNativeProjectStory(action.storyId)) {
						saveStory(newStory, formats);
						persisted = true;
						break;
					}

					const oldStory = storyWithId(lastState, action.storyId);

					// It's crucial that we only respond to this event once. Otherwise,
					// multiple renames in one session will cause mayhem.

					twineElectron.onceStoryRenamed(() => saveStory(newStory, formats));
					twineElectron.renameStory(oldStory, newStory);
				} else {
					// An ordinary update.

					saveStory(storyWithId(state, action.storyId), formats);
				}
				persisted = true;
			}
			break;

		case 'createPassage':
		case 'createPassages':
		case 'deletePassage':
		case 'deletePassages':
			saveStory(storyWithId(state, action.storyId), formats);
			persisted = true;
			break;

		case 'updatePassage':
			// Skip updates that wouldn't be saved.
			if (isPersistablePassageChange(action.props)) {
				saveStory(storyWithId(state, action.storyId), formats);
				persisted = true;
			}
			break;

		case 'updatePassages':
			// Skip updates that wouldn't be saved.
			if (
				Object.keys(action.passageUpdates).some(passageId =>
					isPersistablePassageChange(action.passageUpdates[passageId])
				)
			) {
				saveStory(storyWithId(state, action.storyId), formats);
				persisted = true;
			}
			break;

		default:
			console.warn(
				`Story action ${
					(action as any).type
				} has no Electron persistence handler`
			);
	}

	lastState = [...state];
	return persisted;
}
