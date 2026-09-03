import {
	passageWithId,
	passageWithName,
	StoriesAction,
	StoriesState,
	storyWithId,
	storyWithName
} from '../../../stories';
import {
	isPersistablePassageChange,
	isPersistableStoryChange
} from '../../persistable-changes';
import {bootstrapStory} from '../../../../core/bootstrap-stories';
import {
	deletePassageById,
	deleteStory,
	doUpdateTransaction,
	savePassage,
	saveStory
} from './save';
import {createStoredPassageTextReader, readStoredPassageTexts} from './storage';

let lastState: StoriesState;

function passageForCorePersistence(
	passage: ReturnType<typeof passageWithId>,
	documentText: string | undefined,
	readStoredText: (storyId: string, passageId: string) => string | undefined,
	storedTexts?: ReadonlyMap<string, string>
) {
	if (documentText !== undefined) {
		return {...passage, text: documentText};
	}
	const storedText = storedTexts
		? storedTexts.get(passage.id)
		: readStoredText(passage.story, passage.id);

	if (typeof storedText === 'string') {
		return {...passage, text: storedText};
	}
	return passage;
}

function passagesForPersistence(
	story: ReturnType<typeof storyWithId>,
	readStoredText: (storyId: string, passageId: string) => string | undefined
) {
	const registeredStory = bootstrapStory(story.id);
	const registeredText = new Map(
		registeredStory?.passages.map(passage => [passage.id, passage.text]) ?? []
	);
	const registeredStoryIsComplete = story.passages.every(passage =>
		registeredText.has(passage.id)
	);
	const storedTexts =
		registeredStory && registeredStoryIsComplete
			? new Map<string, string>()
			: readStoredPassageTexts(story.id);

	return story.passages.map(passage =>
		passageForCorePersistence(
			passage,
			registeredText.get(passage.id),
			readStoredText,
			storedTexts
		)
	);
}

/**
 * A middleware function to save changes to local storage. This should be called
 * *after* the main reducer runs.
 */
export function saveMiddleware(state: StoriesState, action: StoriesAction) {
	let atomicBatch = false;
	let persisted = false;
	let storedTextReader: ReturnType<
		typeof createStoredPassageTextReader
	> | null = null;
	const readStoredText = (storyId: string, passageId: string) => {
		storedTextReader ??= createStoredPassageTextReader();
		return storedTextReader(storyId, passageId);
	};

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
				...(action.documentUpdates ?? []).map(update => update.storyId),
				...(action.persistenceHints ?? []).map(hint => hint.storyId)
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
					const ids =
						touchedPassagesByStory.get(coreAction.storyId) ?? new Set();
					ids.add(coreAction.passageId);
					touchedPassagesByStory.set(coreAction.storyId, ids);
				} else if (coreAction.type === 'createPassage' && coreAction.props.id) {
					const ids =
						touchedPassagesByStory.get(coreAction.storyId) ?? new Set();
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
			for (const hint of action.persistenceHints ?? []) {
				if (
					hint.type !== 'passageText' &&
					hint.type !== 'passageMetadata' &&
					hint.type !== 'passageLayout'
				) {
					continue;
				}
				const ids = touchedPassagesByStory.get(hint.storyId) ?? new Set();
				ids.add(hint.passageId);
				touchedPassagesByStory.set(hint.storyId, ids);
			}

			doUpdateTransaction(transaction => {
				for (const storyId of deletedStoryIds) {
					const previous = lastState?.find(story => story.id === storyId);

					if (!previous) {
						continue;
					}

					for (const passage of previous.passages) {
						deletePassageById(transaction, previous.id, passage.id);
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
								update?.type === 'passageText' ? update.text : undefined,
								readStoredText
							)
						);
					}
					for (const passage of previous?.passages ?? []) {
						if (!story.passages.some(current => current.id === passage.id)) {
							deletePassageById(transaction, storyId, passage.id);
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

				for (const passage of passagesForPersistence(story, readStoredText)) {
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
				deletePassageById(transaction, story.id, action.passageId);
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
					deletePassageById(transaction, story.id, passageId);
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
					deletePassageById(transaction, story.id, passage.id);
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
					savePassage(
						transaction,
						passageForCorePersistence(passage, undefined, readStoredText)
					);
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
						passageForCorePersistence(
							passageWithId(state, action.storyId, passageId),
							undefined,
							readStoredText
						)
					);
				}
			});
			persisted = true;
			break;
		}

		case 'updateStory': {
			if (!isPersistableStoryChange(action.props)) {
				break;
			}
			const story = storyWithId(state, action.storyId);

			doUpdateTransaction(transaction => {
				saveStory(transaction, story);

				// Special case: if the passages property is being set, we need to
				// delete any passages there were in the story, but aren't anymore.

				if (action.props.passages) {
					const lastStory = storyWithId(lastState, action.storyId);

					for (const passage of lastStory.passages) {
						if (!action.props.passages.some(({id}) => id === passage.id)) {
							deletePassageById(transaction, story.id, passage.id);
						}
					}
				}

				passagesForPersistence(story, readStoredText).forEach(passage =>
					savePassage(transaction, passage)
				);
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
