import {
	passageWithId,
	passageWithName,
	StoriesAction,
	StoriesState,
	storyWithId,
	storyWithName
} from '../../../stories';
import {isPersistablePassageChange} from '../../persistable-changes';
import {
	deletePassageById,
	deleteStory,
	doUpdateTransaction,
	savePassage,
	saveStory
} from './save';

let lastState: StoriesState;

function passageForCorePersistence(
	passage: ReturnType<typeof passageWithId>,
	documentText: string | undefined
) {
	if (documentText !== undefined) {
		return {...passage, text: documentText};
	}
	const serialized = window.localStorage.getItem(
		`twine-passages-${passage.id}`
	);
	if (serialized) {
		try {
			const stored = JSON.parse(serialized) as {text?: unknown};

			if (typeof stored.text === 'string') {
				return {...passage, text: stored.text};
			}
		} catch {
			// The existing loader reports corrupt records. Preserve the current
			// in-memory fallback here rather than blocking an otherwise valid save.
		}
	}
	return passage;
}

/**
 * A middleware function to save changes to local storage. This should be called
 * *after* the main reducer runs.
 */
export function saveMiddleware(state: StoriesState, action: StoriesAction) {
	let atomicBatch = false;
	let persisted = false;

	switch (action.type) {
		case 'applyCorePatchBatch': {
			atomicBatch = true;
			if (action.persistence === 'skip') {
				break;
			}
			const touchedStoryIds = new Set([
				...(action.storyIds ?? []),
				...action.actions.flatMap(action =>
					'storyId' in action ? [action.storyId] : []
				),
				...(action.documentUpdates ?? []).map(update => update.storyId)
			]);
			const deletedStoryIds = new Set(
				action.actions.flatMap(action =>
					action.type === 'deleteStory' ? [action.storyId] : []
				)
			);
			const touchedPassagesByStory = new Map<string, Set<string>>();
			for (const coreAction of action.actions) {
				if (
					(coreAction.type === 'updatePassage' ||
						coreAction.type === 'deletePassage') &&
					'passageId' in coreAction
				) {
					const ids = touchedPassagesByStory.get(coreAction.storyId) ?? new Set();
					ids.add(coreAction.passageId);
					touchedPassagesByStory.set(coreAction.storyId, ids);
				} else if (
					coreAction.type === 'createPassage' &&
					coreAction.props.id
				) {
					const ids = touchedPassagesByStory.get(coreAction.storyId) ?? new Set();
					ids.add(coreAction.props.id);
					touchedPassagesByStory.set(coreAction.storyId, ids);
				} else if (
					coreAction.type === 'updateStory' &&
					coreAction.props.passages
				) {
					touchedPassagesByStory.set(
						coreAction.storyId,
						new Set(coreAction.props.passages.map(passage => passage.id))
					);
				}
			}
			for (const update of action.documentUpdates ?? []) {
				if (update.type !== 'passageText') {
					continue;
				}
				const ids = touchedPassagesByStory.get(update.storyId) ?? new Set();
				ids.add(update.passageId);
				touchedPassagesByStory.set(update.storyId, ids);
			}

			doUpdateTransaction(transaction => {
				for (const storyId of deletedStoryIds) {
					const previous = lastState?.find(story => story.id === storyId);

					if (!previous) {
						continue;
					}

					for (const passage of previous.passages) {
						deletePassageById(transaction, passage.id);
					}
					deleteStory(transaction, previous);
					persisted = true;
				}

				for (const storyId of touchedStoryIds) {
					if (deletedStoryIds.has(storyId)) {
						continue;
					}

					const story = state.find(story => story.id === storyId);
					const previous = lastState?.find(story => story.id === storyId);

					if (!story) {
						continue;
					}

					saveStory(transaction, story);
					for (const passageId of touchedPassagesByStory.get(storyId) ?? []) {
						const passage = story.passages.find(
							candidate => candidate.id === passageId
						);
						if (!passage) {
							continue;
						}
						const update = (action.documentUpdates ?? []).find(
							candidate =>
								candidate.type === 'passageText' &&
								candidate.storyId === storyId &&
								candidate.passageId === passageId
						);
						savePassage(
							transaction,
							passageForCorePersistence(
								passage,
								update?.type === 'passageText' ? update.text : undefined
							)
						);
					}
					for (const passage of previous?.passages ?? []) {
						if (!story.passages.some(current => current.id === passage.id)) {
							deletePassageById(transaction, passage.id);
						}
					}
					persisted = true;
				}
			});
			break;
		}

		case 'init':
		case 'repair':
			// We take no action here on a repair action. This is to prevent messing up a
			// story's last modified date. If the user then edits the story, we'll save
			// their change and the repair then.
			break;

		case 'createPassage': {
			if (!action.props.name) {
				throw new Error('Passage was created but with no name specified');
			}

			const story = storyWithId(state, action.storyId);
			const passage = passageWithName(state, story.id, action.props.name);

			doUpdateTransaction(transaction => {
				saveStory(transaction, story);
				savePassage(transaction, passage);
			});
			persisted = true;
			break;
		}

		case 'createPassages': {
			const story = storyWithId(state, action.storyId);

			doUpdateTransaction(transaction => {
				saveStory(transaction, story);
				for (const props of action.props) {
					if (!props.name) {
						throw new Error('Passage was created but with no name specified');
					}

					savePassage(
						transaction,
						passageWithName(state, story.id, props.name)
					);
				}
			});
			persisted = true;
			break;
		}

		case 'createStory': {
			if (!action.props.name) {
				throw new Error('Story was created but with no name specified');
			}

			const story = storyWithName(state, action.props.name);

			doUpdateTransaction(transaction => {
				saveStory(transaction, story);

				for (const passage of story.passages) {
					savePassage(transaction, passage);
				}
			});
			persisted = true;
			break;
		}

		case 'deletePassage': {
			const story = storyWithId(state, action.storyId);

			// We can't dig up the passage in question right now, because
			// previousStories is only a shallow copy, and it's gone there at
			// this point in time.

			doUpdateTransaction(transaction => {
				saveStory(transaction, story);
				deletePassageById(transaction, action.passageId);
			});
			persisted = true;
			break;
		}

		case 'deletePassages': {
			const story = storyWithId(state, action.storyId);

			// See above comment about passages.

			doUpdateTransaction(transaction => {
				saveStory(transaction, story);

				for (const passageId of action.passageIds) {
					deletePassageById(transaction, passageId);
				}
			});
			persisted = true;
			break;
		}

		case 'deleteStory': {
			// The story will be gone from state by the time we're called, so we
			// need a cached copy.

			const story = storyWithId(lastState, action.storyId);

			doUpdateTransaction(transaction => {
				// We have to delete all passages, then the story itself.

				for (const passage of story.passages) {
					deletePassageById(transaction, passage.id);
				}

				deleteStory(transaction, story);
			});
			persisted = true;
			break;
		}

		case 'updatePassage':
			if (isPersistablePassageChange(action.props)) {
				const story = storyWithId(state, action.storyId);
				const passage = passageWithId(state, action.storyId, action.passageId);

				doUpdateTransaction(transaction => {
					saveStory(transaction, story);
					savePassage(transaction, passage);
				});
				persisted = true;
				break;
			}
			break;

		case 'updatePassages': {
			const story = storyWithId(state, action.storyId);
			const passageIds = Object.keys(action.passageUpdates).filter(passageId =>
				isPersistablePassageChange(action.passageUpdates[passageId])
			);

			if (passageIds.length === 0) {
				break;
			}

			doUpdateTransaction(transaction => {
				saveStory(transaction, story);

				for (const passageId of passageIds) {
					savePassage(
						transaction,
						passageWithId(state, action.storyId, passageId)
					);
				}
			});
			persisted = true;
			break;
		}

		case 'updateStory': {
			const story = storyWithId(state, action.storyId);

			doUpdateTransaction(transaction => {
				saveStory(transaction, story);

				// Special case: if the passages property is being set, we need to
				// delete any passages there were in the story, but aren't anymore.

				if (action.props.passages) {
					const lastStory = storyWithId(lastState, action.storyId);

					for (const passage of lastStory.passages) {
						if (!action.props.passages.some(({id}) => id === passage.id)) {
							deletePassageById(transaction, passage.id);
						}
					}
				}

				story.passages.forEach(passage => savePassage(transaction, passage));
			});
			persisted = true;
			break;
		}

		default:
			console.warn(
				`Story action ${
					(action as any).type
				} has no local storage persistence handler`
			);
	}

	lastState = state;
	return atomicBatch ? {completion: Promise.resolve(), persisted} : persisted;
}
