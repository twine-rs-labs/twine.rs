import {
	ElectronLoadedStoryEntry,
	ElectronNativeProjectStoryEntry,
	storyFileName,
	TwineElectronWindow
} from '../../../../electron/shared';
import {Story} from '../../../stories/stories.types';
import {importStoriesAsync} from '../../../../util/import';
import {markProjectStoryHydration} from '../../../project-hydration';
import {saveProjectMetadata} from '../../../project-metadata';

function isNativeProjectStoryEntry(
	entry: ElectronLoadedStoryEntry
): entry is ElectronNativeProjectStoryEntry {
	return entry?.kind === 'native-project';
}

function reviveNativeProjectStory(entry: ElectronNativeProjectStoryEntry) {
	const story = entry.story;

	return {
		...story,
		lastUpdate: new Date(story.lastUpdate),
		passages: story.passages.map(passage => ({
			...passage,
			story: passage.story || story.id
		}))
	};
}

export async function load(): Promise<Story[]> {
	const {twineElectron} = window as TwineElectronWindow;

	if (!twineElectron) {
		throw new Error('Electron bridge is not present on window.');
	}

	const stories = await twineElectron.loadStories();

	if (stories && Array.isArray(stories)) {
		const result: Story[] = [];
		const nativeProjectIndexes = new Map<string, number>();

		for (const file of stories) {
			if (isNativeProjectStoryEntry(file)) {
				const story = reviveNativeProjectStory(file);
				const nativeProjectKey = `${file.rootPath}\n${storyFileName(story)}`;

				saveProjectMetadata(story.id, {
					rootPath: file.rootPath,
					status: 'file-backed',
					storageKind: 'electron-project-folder'
				});
				markProjectStoryHydration(story.id, {
					passageTextLoaded: file.passageTextLoaded,
					rootPath: file.rootPath
				});

				if (nativeProjectIndexes.has(nativeProjectKey)) {
					result[nativeProjectIndexes.get(nativeProjectKey)!] = story;
				} else {
					nativeProjectIndexes.set(nativeProjectKey, result.length);
					result.push(story);
				}

				continue;
			}

			if (typeof file?.htmlSource !== 'string') {
				continue;
			}

			const story = await importStoriesAsync(file.htmlSource, file.mtime);

			if (story[0]) {
				result.push(story[0]);
			} else {
				console.warn('Could not hydrate story: ', file.htmlSource);
			}
		}

		return result;
	} else {
		console.warn('No stories to hydrate in Electron bridge');
	}

	return [];
}
