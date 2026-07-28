import {StoryFormatsState} from '../../../../story-formats';
import {StoryWithDocuments as Story} from '../../../../stories';
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
		saveStoryHtml = jest.fn(async () => undefined);
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
		const materialize = jest.fn(async () => completeStory);

		registerStoryMaterializer(story.id, materialize);
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
		expect(materialize).toHaveBeenCalledWith(story);
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

	it('rejects when the acknowledged legacy HTML save fails', async () => {
		const error = new Error('disk full');

		saveStoryHtml.mockRejectedValueOnce(error);
		await expect(saveStory(story, formatsState)).rejects.toBe(error);
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

	it('uses a full save when document updates accompany a full-save hint', async () => {
		saveProjectMetadata(story.id, {
			rootPath: '/native/moon-castle.twine.rs',
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		const materialize = jest.fn(async () => story);
		const passage = story.passages[0];

		registerStoryMaterializer(story.id, materialize);
		await saveStory(story, formatsState, {
			documentUpdates: [
				{
					passageId: passage.id,
					storyId: story.id,
					text: passage.text,
					type: 'passageText'
				}
			],
			hints: [{reason: 'passageCreated', storyId: story.id, type: 'full'}]
		});

		expect(materialize).toHaveBeenCalledWith(story);
		expect(saveProjectFolder).toHaveBeenCalledWith(
			'/native/moon-castle.twine.rs',
			story,
			expect.not.objectContaining({incrementalOnly: true})
		);
	});

	it('uses a compact touched-passage payload for layout-only saves', async () => {
		story = fakeStory(3);
		saveProjectMetadata(story.id, {
			rootPath: '/native/moon-castle.twine.rs',
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		const moved = {...story.passages[1], left: 420, top: 240};
		story = {
			...story,
			passages: [story.passages[0], moved, story.passages[2]]
		};
		const materialize = jest.fn(async () => story);

		registerStoryMaterializer(story.id, materialize);
		await saveStory(story, formatsState, {
			hints: [{passageId: moved.id, storyId: story.id, type: 'passageLayout'}],
			revision: 7,
			sessionId: 'project:/native/moon-castle.twine.rs'
		});

		expect(materialize).not.toHaveBeenCalled();
		expect(saveProjectFolder).toHaveBeenCalledWith(
			'/native/moon-castle.twine.rs',
			expect.objectContaining({
				passages: [
					expect.objectContaining({
						id: moved.id,
						left: 420,
						text: '',
						top: 240
					})
				]
			}),
			expect.objectContaining({
				incrementalOnly: true,
				revision: 7,
				sessionId: 'project:/native/moon-castle.twine.rs'
			})
		);
	});

	it('uses current passage metadata without materializing document bodies', async () => {
		saveProjectMetadata(story.id, {
			rootPath: '/native/moon-castle.twine.rs',
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		const renamed = {...story.passages[0], name: 'Renamed'};
		const materialize = jest.fn(async () => story);

		story = {...story, passages: [renamed, ...story.passages.slice(1)]};
		registerStoryMaterializer(story.id, materialize);
		await saveStory(story, formatsState, {
			hints: [
				{passageId: renamed.id, storyId: story.id, type: 'passageMetadata'}
			]
		});

		expect(materialize).not.toHaveBeenCalled();
		expect(saveProjectFolder).toHaveBeenCalledWith(
			'/native/moon-castle.twine.rs',
			expect.objectContaining({
				passages: expect.arrayContaining([
					expect.objectContaining({id: renamed.id, name: 'Renamed'})
				])
			}),
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
