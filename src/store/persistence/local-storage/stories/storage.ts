import {Passage} from '../../../stories/stories.types';

export const storageManifestKey = 'twine-story-storage-manifest';

export interface StoryRecordReference {
	id: string;
	key: string;
}

export interface PassageRecordReference {
	id: string;
	key: string;
	storyId: string;
}

export interface StorageManifest {
	passages: PassageRecordReference[];
	revision: string;
	stories: StoryRecordReference[];
	version: 2;
}

function commaList(key: string) {
	return (window.localStorage.getItem(key) ?? '').split(',').filter(Boolean);
}

function isRecordReference(value: unknown): value is StoryRecordReference {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as StoryRecordReference).id === 'string' &&
		typeof (value as StoryRecordReference).key === 'string'
	);
}

function isPassageRecordReference(
	value: unknown
): value is PassageRecordReference {
	return (
		isRecordReference(value) &&
		typeof (value as PassageRecordReference).storyId === 'string'
	);
}

function isStorageManifest(value: unknown): value is StorageManifest {
	if (typeof value !== 'object' || value === null) {
		return false;
	}

	const candidate = value as StorageManifest;

	return (
		candidate.version === 2 &&
		typeof candidate.revision === 'string' &&
		Array.isArray(candidate.stories) &&
		candidate.stories.every(isRecordReference) &&
		Array.isArray(candidate.passages) &&
		candidate.passages.every(isPassageRecordReference)
	);
}

function legacyStorageManifest(): StorageManifest {
	const stories = commaList('twine-stories').map(id => ({
		id,
		key: `twine-stories-${id}`
	}));
	const passages = commaList('twine-passages').map(id => {
		const key = `twine-passages-${id}`;
		const serialized = window.localStorage.getItem(key);
		let storyId = '';

		if (serialized) {
			try {
				const passage = JSON.parse(serialized) as Partial<Passage>;

				if (typeof passage.story === 'string') {
					storyId = passage.story;
				}
			} catch {
				// The loader reports malformed records with their full context.
			}
		}

		return {id, key, storyId};
	});

	return {passages, revision: 'legacy', stories, version: 2};
}

export function readStorageManifest(): StorageManifest {
	const serialized = window.localStorage.getItem(storageManifestKey);

	if (!serialized) {
		return legacyStorageManifest();
	}

	try {
		const manifest: unknown = JSON.parse(serialized);

		if (isStorageManifest(manifest)) {
			return manifest;
		}
	} catch {
		// Fall through to the legacy snapshot after reporting the bad manifest.
	}

	console.warn('Could not parse the story storage manifest, using legacy data');
	return legacyStorageManifest();
}

export function createStoredPassageTextReader() {
	const references = new Map<string, Map<string, PassageRecordReference>>();

	for (const reference of readStorageManifest().passages) {
		const storyReferences = references.get(reference.storyId) ?? new Map();

		storyReferences.set(reference.id, reference);
		references.set(reference.storyId, storyReferences);
	}

	return (storyId: string, passageId: string) => {
		const reference = references.get(storyId)?.get(passageId);

		if (!reference) {
			return undefined;
		}

		const serialized = window.localStorage.getItem(reference.key);

		if (!serialized) {
			return undefined;
		}

		try {
			const passage = JSON.parse(serialized) as {text?: unknown};

			return typeof passage.text === 'string' ? passage.text : undefined;
		} catch {
			return undefined;
		}
	};
}

export function readStoredPassageTexts(storyId: string) {
	const result = new Map<string, string>();

	for (const reference of readStorageManifest().passages) {
		if (reference.storyId !== storyId) {
			continue;
		}

		const serialized = window.localStorage.getItem(reference.key);

		if (!serialized) {
			continue;
		}

		try {
			const passage = JSON.parse(serialized) as {text?: unknown};

			if (typeof passage.text === 'string') {
				result.set(reference.id, passage.text);
			}
		} catch {
			// The loader reports malformed records with their full context.
		}
	}

	return result;
}
