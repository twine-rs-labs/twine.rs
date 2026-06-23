import {v4 as uuid} from '@lukeed/uuid';
import {StoryFormatsState} from '../../../story-formats/story-formats.types';

const storyFormatStoragePrefix = 'twine-storyformats';

function removeStoredFormats() {
	const keys: string[] = [];

	for (let index = 0; index < window.localStorage.length; index++) {
		const key = window.localStorage.key(index);

		if (key?.startsWith(storyFormatStoragePrefix)) {
			keys.push(key);
		}
	}

	keys.forEach(key => window.localStorage.removeItem(key));
}

export function save(state: StoryFormatsState) {
	// Delete all old format keys, including orphaned keys from interrupted or
	// failed saves. Built-in formats are repaired from defaults at startup, so
	// only user-added formats need localStorage.
	removeStoredFormats();

	const ids: string[] = [];

	try {
		for (const format of state.filter(format => format.userAdded)) {
			const id = uuid();

			// We have to remove the `properties` property if it exists, as that is
			// dynamically added when loading.

			ids.push(id);
			window.localStorage.setItem(
				`${storyFormatStoragePrefix}-${id}`,
				JSON.stringify({
					...format,
					loadError: undefined,
					loadState: undefined,
					properties: undefined,
					selected: undefined
				})
			);
		}

		window.localStorage.setItem(storyFormatStoragePrefix, ids.join(','));
	} catch (error) {
		removeStoredFormats();
		throw error;
	}
}
