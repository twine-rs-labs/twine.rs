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
import {
	registerStoryMaterializer,
	unregisterStoryMaterializer
} from '../../../../../core/bootstrap-stories';

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
		unregisterStoryMaterializer(story.id);
		window.localStorage.clear();
		delete (window as TwineElectronWindow).twineElectron;
	});

	it('materializes passage documents before a full project-folder save', async () => {
		const completeStory = fakeStory(2);
		const metadataStory = {
			...completeStory,
			passages: completeStory.passages.map(passage => ({...passage, text: ''}))
		};

		story = metadataStory;
		story.storyFormat = formatsState[0].name;
		story.storyFormatVersion = formatsState[0].version;
		registerStoryMaterializer(story.id, async () => completeStory);
		saveProjectMetadata(story.id, {
			rootPath: '/native/moon-castle.twine.rs',
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});

		await saveStory(story, formatsState);

		expect(saveProjectFolder).toHaveBeenCalledWith(
			'/native/moon-castle.twine.rs',
			completeStory
		);
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

	it('forwards project-folder save hints to the native bridge', async () => {
		saveProjectMetadata(story.id, {
			rootPath: '/native/moon-castle.twine.rs',
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});

		await saveStory(story, formatsState, {
			hints: [
				{
					passageId: story.passages[0].id,
					storyId: story.id,
					type: 'passageText'
				}
			],
			revision: 3,
			sessionId: 'project:/native/moon-castle.twine.rs'
		});

		expect(saveProjectFolder).toHaveBeenCalledWith(
			'/native/moon-castle.twine.rs',
			story,
			{
				hints: [
					{
						passageId: story.passages[0].id,
						storyId: story.id,
						type: 'passageText'
					}
				],
				revision: 3,
				sessionId: 'project:/native/moon-castle.twine.rs'
			}
		);
		expect(saveStoryHtml).not.toHaveBeenCalled();
	});

	it('sends only touched passages for session-owned incremental saves', async () => {
		saveProjectMetadata(story.id, {
			rootPath: '/native/moon-castle.twine.rs',
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		const passage = story.passages[0];

		await saveStory(story, formatsState, {
			documentUpdates: [
				{
					passageId: passage.id,
					storyId: story.id,
					text: 'session text',
					type: 'passageText'
				}
			],
			hints: [{passageId: passage.id, storyId: story.id, type: 'passageText'}]
		});

		expect(saveProjectFolder).toHaveBeenCalledWith(
			'/native/moon-castle.twine.rs',
			expect.objectContaining({
				passages: [
					expect.objectContaining({id: passage.id, text: 'session text'})
				]
			}),
			expect.objectContaining({incrementalOnly: true})
		);
	});

	it('uses the compact incremental path for session-owned source saves', async () => {
		saveProjectMetadata(story.id, {
			rootPath: '/native/moon-castle.twine.rs',
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});

		await saveStory(story, formatsState, {
			documentUpdates: [
				{storyId: story.id, text: 'const changed = true;', type: 'script'}
			],
			hints: [{storyId: story.id, type: 'script'}]
		});

		expect(saveProjectFolder).toHaveBeenCalledWith(
			'/native/moon-castle.twine.rs',
			expect.objectContaining({passages: []}),
			expect.objectContaining({incrementalOnly: true})
		);
	});

	it('retains passage metadata for incremental manifest saves', async () => {
		saveProjectMetadata(story.id, {
			rootPath: '/native/moon-castle.twine.rs',
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		const renamed = {...story.passages[0], name: 'Renamed'};
		story = {...story, passages: [renamed, ...story.passages.slice(1)]};

		await saveStory(story, formatsState, {
			documentUpdates: [
				{
					passageId: renamed.id,
					storyId: story.id,
					text: 'updated link',
					type: 'passageText'
				}
			],
			hints: [
				{passageId: renamed.id, storyId: story.id, type: 'passageMetadata'},
				{passageId: renamed.id, storyId: story.id, type: 'passageText'}
			]
		});

		expect(saveProjectFolder).toHaveBeenCalledWith(
			'/native/moon-castle.twine.rs',
			expect.objectContaining({
				passages: expect.arrayContaining([
					expect.objectContaining({
						id: renamed.id,
						name: 'Renamed',
						text: 'updated link'
					})
				])
			}),
			expect.objectContaining({incrementalOnly: true})
		);
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
