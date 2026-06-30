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

interface QueuedSave {
	reject: (error: unknown) => void;
	resolve: () => void;
	task: () => Promise<void>;
}

const activeSessionSaves = new Set<string>();
const pendingSessionSaves = new Map<string, QueuedSave[]>();

function runSessionSave(sessionId: string, save: QueuedSave) {
	activeSessionSaves.add(sessionId);
	void save
		.task()
		.then(save.resolve, save.reject)
		.finally(() => {
			const pending = pendingSessionSaves.get(sessionId) ?? [];
			const next = pending.pop();

			pendingSessionSaves.delete(sessionId);
			if (next) {
				const superseded = pending;

				runSessionSave(sessionId, {
					reject: error => {
						next.reject(error);
						superseded.forEach(save => save.reject(error));
					},
					resolve: () => {
						next.resolve();
						superseded.forEach(save => save.resolve());
					},
					task: next.task
				});
			} else {
				activeSessionSaves.delete(sessionId);
			}
		});
}

function queueSessionSave(sessionId: string, task: () => Promise<void>) {
	return new Promise<void>((resolve, reject) => {
		const save = {reject, resolve, task};

		if (!activeSessionSaves.has(sessionId)) {
			runSessionSave(sessionId, save);
			return;
		}

		pendingSessionSaves.set(sessionId, [
			...(pendingSessionSaves.get(sessionId) ?? []),
			save
		]);
	});
}

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
	let completion: Promise<void> | undefined;
	let persisted = false;

	if (!twineElectron) {
		throw new Error('Electron bridge is not present on window.');
	}

	switch (action.type) {
		case 'applyCorePatchBatch': {
			const saves: Array<() => Promise<void>> = [];
			const touchedStoryIds = new Set(
				action.actions.flatMap(action =>
					'storyId' in action ? [action.storyId] : []
				)
			);
			const deletedStoryIds = new Set(
				action.actions.flatMap(action =>
					action.type === 'deleteStory' ? [action.storyId] : []
				)
			);

			for (const storyId of deletedStoryIds) {
				const deleted = lastState?.find(story => story.id === storyId);

				if (deleted) {
					saves.push(async () => {
						await twineElectron.deleteStory(deleted);
					});
					persisted = true;
				}
			}

			for (const storyId of touchedStoryIds) {
				if (deletedStoryIds.has(storyId)) {
					continue;
				}

				const story = state.find(story => story.id === storyId);

				if (story) {
					saves.push(() => saveStory(story, formats));
					persisted = true;
				}
			}
			const saveAll = async () => {
				for (const save of saves) {
					await save();
				}
			};

			completion = action.sessionId
				? queueSessionSave(action.sessionId, saveAll)
				: saveAll();
			break;
		}

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
	return completion ? {completion, persisted} : persisted;
}
