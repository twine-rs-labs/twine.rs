import {TwineElectronWindow} from '../../../../electron/shared';
import {Story} from '../../../stories/stories.types';
import {importStoriesAsync} from '../../../../util/import';

export async function load(): Promise<Story[]> {
	const {twineElectron} = window as TwineElectronWindow;

	if (!twineElectron) {
		throw new Error('Electron bridge is not present on window.');
	}

	const stories = await twineElectron.loadStories();

	if (stories && Array.isArray(stories)) {
		const result: Story[] = [];

		for (const file of stories) {
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
