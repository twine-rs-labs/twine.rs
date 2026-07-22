import {Passage, Story} from '../../../stories/stories.types';
import {
	PassageRecordReference,
	readStorageManifest,
	storageManifestKey,
	StorageManifest,
	StoryRecordReference
} from './storage';

export interface StorageTransaction {
	passageChanges: Map<string, string | null>;
	storyChanges: Map<string, string | null>;
}

export type StorageUpdater = (transaction: StorageTransaction) => void;

/**
 * A wrapper for a series of save/delete operations. This takes a function as
 * argument that will receive an object keeping track of the transaction. This
 * function should then make save and delete calls as necessary, passing the
 * provided transaction object as their first argument.
 */
function passageIdentity(storyId: string, passageId: string) {
	return `${encodeURIComponent(storyId)}:${encodeURIComponent(passageId)}`;
}

let revisionSequence = 0;

function nextRevision() {
	revisionSequence += 1;
	return `${Date.now().toString(36)}-${revisionSequence.toString(36)}-${Math.random()
		.toString(36)
		.slice(2)}`;
}

function recordKey(revision: string, sequence: number) {
	return `twine-ss-${revision}-${sequence.toString(36)}`;
}

function cleanupKeys(keys: Iterable<string>) {
	for (const key of keys) {
		try {
			window.localStorage.removeItem(key);
		} catch (error) {
			console.warn(
				`Could not clean obsolete story storage record ${key}`,
				error
			);
		}
	}
}

/**
 * Commits changed immutable records, then atomically switches the manifest that
 * describes the complete readable snapshot.
 */
export function doUpdateTransaction(updater: StorageUpdater) {
	const previousManifest = readStorageManifest();
	const transaction: StorageTransaction = {
		passageChanges: new Map(),
		storyChanges: new Map()
	};

	updater(transaction);

	if (
		transaction.storyChanges.size === 0 &&
		transaction.passageChanges.size === 0
	) {
		return;
	}

	const revision = nextRevision();
	const stagedKeys: string[] = [];
	let recordSequence = 0;
	const storyReferences = new Map<string, StoryRecordReference>(
		previousManifest.stories.map(reference => [reference.id, reference])
	);
	const passageReferences = new Map<string, PassageRecordReference>(
		previousManifest.passages.map(reference => [
			passageIdentity(reference.storyId, reference.id),
			reference
		])
	);

	try {
		for (const [storyId, serialized] of transaction.storyChanges) {
			if (serialized === null) {
				storyReferences.delete(storyId);
				continue;
			}

			const key = recordKey(revision, recordSequence++);

			window.localStorage.setItem(key, serialized);
			stagedKeys.push(key);
			storyReferences.set(storyId, {id: storyId, key});
		}

		for (const [identity, change] of transaction.passageChanges) {
			const separator = identity.indexOf(':');
			const storyId = decodeURIComponent(identity.slice(0, separator));
			const passageId = decodeURIComponent(identity.slice(separator + 1));

			if (change === null) {
				passageReferences.delete(identity);
				continue;
			}

			const key = recordKey(revision, recordSequence++);

			window.localStorage.setItem(key, change);
			stagedKeys.push(key);
			passageReferences.set(identity, {
				id: passageId,
				key,
				storyId
			});
		}

		const manifest: StorageManifest = {
			passages: [...passageReferences.values()],
			revision,
			stories: [...storyReferences.values()],
			version: 2
		};

		window.localStorage.setItem(storageManifestKey, JSON.stringify(manifest));
	} catch (error) {
		cleanupKeys(stagedKeys);
		throw error;
	}

	const currentKeys = new Set([
		...[...storyReferences.values()].map(reference => reference.key),
		...[...passageReferences.values()].map(reference => reference.key)
	]);
	const obsoleteKeys = [
		...previousManifest.stories.map(reference => reference.key),
		...previousManifest.passages.map(reference => reference.key)
	].filter(key => !currentKeys.has(key));

	cleanupKeys(obsoleteKeys);
	cleanupKeys(['twine-stories', 'twine-passages']);
}

/**
 * Saves a story to local storage. This does *not* affect any child passages.
 **/
export function saveStory(transaction: StorageTransaction, story: Story) {
	if (!story.id) {
		throw new Error('Story has no ID');
	}

	transaction.storyChanges.set(
		story.id,
		JSON.stringify({...story, passages: undefined})
	);
}

/**
 * Deletes a story from local storage. This does *not* affect any child
 * passages. You *must* delete child passages manually.
 */
export function deleteStory(transaction: StorageTransaction, story: Story) {
	if (!story.id) {
		throw new Error('Story has no ID');
	}

	transaction.storyChanges.set(story.id, null);
}

/**
 * Saves a passage to local storage.
 */
export function savePassage(transaction: StorageTransaction, passage: Passage) {
	if (!passage.id) {
		throw new Error('Passage has no ID');
	}
	if (!passage.story) {
		throw new Error('Passage has no parent story ID');
	}

	transaction.passageChanges.set(
		passageIdentity(passage.story, passage.id),
		JSON.stringify(passage)
	);
}

/**
 * Deletes a passage from local storage.
 */
export function deletePassage(
	transaction: StorageTransaction,
	passage: Passage
) {
	if (!passage.id) {
		throw new Error('Passage has no ID');
	}

	deletePassageById(transaction, passage.story, passage.id);
}

/**
 * Deletes a passage from local storage by ID only.
 */
export function deletePassageById(
	transaction: StorageTransaction,
	storyId: string,
	passageId: string
) {
	transaction.passageChanges.set(passageIdentity(storyId, passageId), null);
}
