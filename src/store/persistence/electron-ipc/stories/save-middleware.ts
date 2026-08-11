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
import {recordPerformanceHarnessEvent} from '../../../../util/performance';
import {trackPersistence} from '../persistence-quit-coordinator';

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
const storyPersistenceBarriers = new Map<string, Promise<void>>();

function queueStoryPersistence(
	storyId: string,
	task: () => Promise<void>
): Promise<void> {
	const previous = storyPersistenceBarriers.get(storyId);
	const operation = previous
		? previous.catch(() => undefined).then(task)
		: task();

	storyPersistenceBarriers.set(storyId, operation);
	void operation.then(
		() => {
			if (storyPersistenceBarriers.get(storyId) === operation) {
				storyPersistenceBarriers.delete(storyId);
			}
		},
		() => {
			if (storyPersistenceBarriers.get(storyId) === operation) {
				storyPersistenceBarriers.delete(storyId);
			}
		}
	);
	return trackPersistence(operation);
}

function runSessionSave(sessionId: string, save: QueuedSave) {
	activeSessionSaves.add(sessionId);
	void save
		.task()
		.then(
			() => save.resolve(),
			error => save.reject(error)
		)
		.finally(() => {
			const pending = pendingSessionSaves.get(sessionId) ?? [];
			const next = pending.shift();

			if (pending.length > 0) {
				pendingSessionSaves.set(sessionId, pending);
			} else {
				pendingSessionSaves.delete(sessionId);
			}
			if (next) {
				runSessionSave(sessionId, next);
			} else {
				activeSessionSaves.delete(sessionId);
			}
		});
}

function queueSessionSave(sessionId: string, task: () => Promise<void>) {
	const completion = new Promise<void>((resolve, reject) => {
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

	return trackPersistence(completion);
}

function isNativeProjectStory(
	storyId: string,
	storageKind?: 'electron-project-folder' | 'web-local'
) {
	if (storageKind) {
		return storageKind === 'electron-project-folder';
	}

	const metadata = loadProjectMetadata(storyId);

	return (
		metadata?.storageKind === 'electron-project-folder' &&
		metadata.status === 'file-backed' &&
		!!metadata.rootPath
	);
}

export function isPersistenceAffectingAction(action: StoriesAction) {
	switch (action.type) {
		case 'applyCorePatchBatch':
			return action.persistence !== 'skip';
		case 'createStory':
		case 'deleteStory':
		case 'createPassage':
		case 'createPassages':
		case 'deletePassage':
		case 'deletePassages':
			return true;
		case 'updateStory':
			return isPersistableStoryChange(action.props);
		case 'updatePassage':
			return isPersistablePassageChange(action.props);
		case 'updatePassages':
			return Object.values(action.passageUpdates).some(
				isPersistablePassageChange
			);
		default:
			return false;
	}
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
			if (action.persistence === 'skip') {
				break;
			}
			const saves: Array<{storyId: string; task: () => Promise<void>}> = [];
			const touchedStoryIds = new Set([
				...(action.storyIds ?? []),
				...action.actions.flatMap(action =>
					'storyId' in action ? [action.storyId] : []
				)
			]);
			const deletedStories = new Map(
				action.actions.flatMap(action =>
					action.type === 'deleteStory'
						? [[action.storyId, action.storageKind] as const]
						: []
				)
			);
			const deletedStoryIds = new Set(deletedStories.keys());
			const hintsByStory = new Map(
				(action.persistenceHints ?? []).map(hint => [
					hint.storyId,
					(action.persistenceHints ?? []).filter(
						candidate => candidate.storyId === hint.storyId
					)
				])
			);

			for (const [storyId, storageKind] of deletedStories) {
				const deleted = lastState?.find(story => story.id === storyId);

				if (deleted && !isNativeProjectStory(storyId, storageKind)) {
					saves.push({
						storyId,
						task: async () => {
							await twineElectron.deleteStory(deleted);
						}
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
					const documentUpdates = (action.documentUpdates ?? []).filter(
						update => update.storyId === storyId
					);
					saves.push({
						storyId,
						task: () =>
							saveStory(story, formats, {
								documentUpdates,
								hints: hintsByStory.get(storyId),
								revision: action.revision,
								sessionId: action.sessionId
							})
					});
					persisted = true;
				}
			}
			const saveAll = async () => {
				recordPerformanceHarnessEvent('persistence-save-started', {
					revision: action.revision,
					sessionId: action.sessionId
				});
				try {
					for (const save of saves) {
						await queueStoryPersistence(save.storyId, save.task);
					}
					recordPerformanceHarnessEvent('persistence-save-completed', {
						revision: action.revision,
						sessionId: action.sessionId
					});
				} catch (error) {
					recordPerformanceHarnessEvent('persistence-save-failed', {
						error: (error as Error).message,
						revision: action.revision,
						sessionId: action.sessionId
					});
					throw error;
				}
			};

			recordPerformanceHarnessEvent('persistence-save-queued', {
				revision: action.revision,
				sessionId: action.sessionId
			});
			completion = action.sessionId
				? queueSessionSave(action.sessionId, saveAll)
				: saveAll();
			if (!action.sessionId) {
				completion = trackPersistence(completion);
			}
			break;
		}

		case 'init':
		case 'repair':
			// We take no action here on a repair action. This is to prevent messing up a
			// story's last modified date. If the user then edits the story, we'll save
			// their change and the repair then.
			break;

		case 'createStory': {
			if (!action.props.name) {
				throw new Error('Passage was created but with no name specified');
			}

			const createdStory = storyWithName(state, action.props.name);

			completion = queueStoryPersistence(createdStory.id, () =>
				saveStory(createdStory, formats)
			);
			persisted = true;
			break;
		}

		case 'deleteStory': {
			// We have to look up the story in our saved last state to know what file
			// to delete.
			if (isNativeProjectStory(action.storyId, action.storageKind)) {
				break;
			}

			const deletedStory = storyWithId(lastState, action.storyId);

			completion = queueStoryPersistence(action.storyId, () =>
				twineElectron.deleteStory(deletedStory)
			);
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
						completion = queueStoryPersistence(action.storyId, () =>
							saveStory(newStory, formats)
						);
						persisted = true;
						break;
					}

					const oldStory = storyWithId(lastState, action.storyId);

					completion = queueStoryPersistence(action.storyId, async () => {
						await twineElectron.renameStory(oldStory, newStory);
						await saveStory(newStory, formats);
					});
				} else {
					// An ordinary update.

					const updatedStory = storyWithId(state, action.storyId);

					completion = queueStoryPersistence(action.storyId, () =>
						saveStory(updatedStory, formats)
					);
				}
				persisted = true;
			}
			break;

		case 'createPassage':
		case 'createPassages':
		case 'deletePassage':
		case 'deletePassages': {
			const changedStory = storyWithId(state, action.storyId);

			completion = queueStoryPersistence(action.storyId, () =>
				saveStory(changedStory, formats)
			);
			persisted = true;
			break;
		}

		case 'updatePassage':
			// Skip updates that wouldn't be saved.
			if (isPersistablePassageChange(action.props)) {
				const changedStory = storyWithId(state, action.storyId);

				completion = queueStoryPersistence(action.storyId, () =>
					saveStory(changedStory, formats)
				);
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
				const changedStory = storyWithId(state, action.storyId);

				completion = queueStoryPersistence(action.storyId, () =>
					saveStory(changedStory, formats)
				);
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
