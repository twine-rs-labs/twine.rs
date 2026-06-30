import {StoryFormatsState} from '../../../../story-formats';
import {Story} from '../../../../stories';
import {
	fakeLoadedStoryFormat,
	fakeStoryFormatProperties,
	fakeStory
} from '../../../../../test-util';
import {TwineElectronWindow} from '../../../../../electron/shared';
import {getAppInfo} from '../../../../../util/app-info';
import {
	publishStory,
	publishStoryWithFormat
} from '../../../../../util/publish';
import {saveProjectMetadata} from '../../../../project-metadata';
import * as fetchStoryFormatProperties from '../../../../../util/story-format/fetch-properties';
import {saveStory} from '../save-story';

describe('saveStory()', () => {
	let formatsState: StoryFormatsState;
	let saveProjectFolder: jest.SpyInstance;
	let saveStoryHtml: jest.SpyInstance;
	let story: Story;

	beforeEach(() => {
		formatsState = [fakeLoadedStoryFormat()];
		saveProjectFolder = jest.fn(async () => undefined);
		saveStoryHtml = jest.fn();
		story = fakeStory();
		story.storyFormat = formatsState[0].name;
		story.storyFormatVersion = formatsState[0].version;
		window.localStorage.clear();
		(window as any).twineElectron = {saveProjectFolder, saveStoryHtml};
		jest.spyOn(console, 'warn').mockReturnValue();
	});

	afterEach(() => {
		window.localStorage.clear();
		delete (window as TwineElectronWindow).twineElectron;
	});

	it('calls saveStoryHtml on the twineElectron global', async () => {
		await saveStory(story, formatsState);
		expect(saveStoryHtml.mock.calls).toEqual([
			[
				story,
				publishStoryWithFormat(
					story,
					(formatsState[0] as any).properties.source,
					getAppInfo(),
					{startOptional: true}
				)
			]
		]);
	});

	it('updates a remembered native project folder without saving legacy HTML', async () => {
		saveProjectMetadata(story.id, {
			rootPath: '/native/moon-castle.twine.rs',
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});

		await saveStory(story, formatsState);

		expect(saveProjectFolder).toHaveBeenCalledWith(
			'/native/moon-castle.twine.rs',
			story
		);
		expect(saveStoryHtml).not.toHaveBeenCalled();
	});

	it('surfaces native project save failures without falling back to legacy HTML', async () => {
		saveProjectFolder.mockRejectedValue(new Error('Permission denied'));
		saveProjectMetadata(story.id, {
			rootPath: '/native/moon-castle.twine.rs',
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});

		await expect(saveStory(story, formatsState)).rejects.toThrow(
			'Could not update native project folder: Permission denied'
		);
		expect(saveStoryHtml).not.toHaveBeenCalled();
	});

	it("loads the story's format if needed", async () => {
		const properties = fakeStoryFormatProperties();
		jest
			.spyOn(fetchStoryFormatProperties, 'fetchStoryFormatProperties')
			.mockResolvedValue(properties);

		await saveStory(story, [
			{...formatsState[0], loadState: 'unloaded', properties: undefined} as any
		]);
		expect(saveStoryHtml.mock.calls).toEqual([
			[
				story,
				publishStoryWithFormat(story, properties.source, getAppInfo(), {
					startOptional: true
				})
			]
		]);
	});

	it('sends story data only if the format cannot be loaded', async () => {
		jest
			.spyOn(fetchStoryFormatProperties, 'fetchStoryFormatProperties')
			.mockRejectedValue(new Error());

		await saveStory(story, [
			{...formatsState[0], loadState: 'unloaded', properties: undefined} as any
		]);
		expect(saveStoryHtml.mock.calls).toEqual([
			[
				story,
				publishStory(story, getAppInfo(), {
					startOptional: true
				})
			]
		]);
	});
});
