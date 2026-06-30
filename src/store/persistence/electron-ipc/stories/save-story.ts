import {TwineElectronWindow} from '../../../../electron/shared';
import {Story} from '../../../stories';
import {publishStory, publishStoryWithFormat} from '../../../../util/publish';
import {
	formatWithNameAndVersion,
	StoryFormatsState
} from '../../../story-formats';
import {getAppInfo} from '../../../../util/app-info';
import {fetchStoryFormatProperties} from '../../../../util/story-format/fetch-properties';
import {loadProjectMetadata} from '../../../project-metadata';

async function saveNativeProjectFolder(
	twineElectron: NonNullable<TwineElectronWindow['twineElectron']>,
	story: Story
) {
	const projectMetadata = loadProjectMetadata(story.id);

	if (
		projectMetadata?.storageKind !== 'electron-project-folder' ||
		projectMetadata.status !== 'file-backed' ||
		!projectMetadata.rootPath
	) {
		return false;
	}

	if (!twineElectron.saveProjectFolder) {
		console.warn('Could not update native project folder; bridge is missing.');
		return true;
	}

	try {
		await twineElectron.saveProjectFolder(projectMetadata.rootPath, story);
	} catch (error) {
		throw new Error(
			`Could not update native project folder: ${(error as Error).message}`,
			{cause: error}
		);
	}

	return true;
}

/**
 * Sends an IPC message to save a story to disk, ideally in published form.
 */
export async function saveStory(story: Story, formats: StoryFormatsState) {
	const {twineElectron} = window as TwineElectronWindow;

	if (!twineElectron) {
		throw new Error('Electron bridge is not present on window.');
	}

	if (await saveNativeProjectFolder(twineElectron, story)) {
		return;
	}

	let storyHtml: string;

	try {
		const format = formatWithNameAndVersion(
			formats,
			story.storyFormat,
			story.storyFormatVersion
		);

		if (format.loadState === 'loaded') {
			storyHtml = publishStoryWithFormat(
				story,
				format.properties.source,
				getAppInfo(),
				{startOptional: true}
			);
		} else {
			const {source} = await fetchStoryFormatProperties(format.url);

			storyHtml = publishStoryWithFormat(story, source, getAppInfo(), {
				startOptional: true
			});
		}
	} catch (error) {
		console.warn(
			`Could not save full story (${
				(error as Error).message
			}). Trying to save story data only.`
		);
		storyHtml = publishStory(story, getAppInfo(), {startOptional: true});
	}

	twineElectron.saveStoryHtml(story, storyHtml);
}
