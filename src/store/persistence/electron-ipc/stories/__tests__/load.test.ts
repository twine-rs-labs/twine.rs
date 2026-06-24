import {TwineElectronWindow} from '../../../../../electron/shared';
import {load} from '../load';
import {Story} from '../../../../stories/stories.types';
import {fakeAppInfo, fakeStory} from '../../../../../test-util';
import {publishStory} from '../../../../../util/publish';
import {projectStoryHydration} from '../../../../project-hydration';
import {loadProjectMetadata} from '../../../../project-metadata';

describe('stories Electron IPC load', () => {
	const electronWindow = window as TwineElectronWindow;
	let stories: Story[];
	let storydata: any[];

	function mockLoadStories(data: any) {
		Object.assign(electronWindow, {
			twineElectron: {
				loadStories: async function () {
					return data;
				}
			}
		});
	}

	beforeEach(() => {
		window.localStorage.clear();
		stories = [fakeStory(), fakeStory()];
		storydata = stories.map(story => ({
			htmlSource: publishStory(story, fakeAppInfo()),
			mtime: new Date()
		}));

		mockLoadStories(storydata);
		jest.spyOn(console, 'warn').mockReturnValue();
	});

	it('loads stories by calling loadStories() on the twineElectron global', async () =>
		expect(await load()).toEqual(
			stories.map(story => ({
				...story,
				id: expect.any(String),
				lastUpdate: expect.any(Date),
				passages: [
					{
						...story.passages[0],
						id: expect.any(String),
						// This is not preserved in publishing right now.
						selected: false,
						story: expect.any(String)
					}
				],
				selected: false,
				// This is not preserved in publishing right now.
				snapToGrid: expect.any(Boolean),
				startPassage: expect.any(String)
			}))
		));

	it('links stories and passage IDs', async () => {
		for (const result of await load()) {
			expect(result.startPassage).toBe(result.passages[0].id);
			expect(result.passages[0].story).toBe(result.id);
		}
	});

	it('loads native project story entries without importing HTML', async () => {
		const story = fakeStory(1);

		mockLoadStories([
			{
				kind: 'native-project',
				passageTextLoaded: false,
				rootPath: '/native/moon-castle.twine.rs',
				story,
				storyIds: [story.id]
			}
		]);

		expect(await load()).toEqual([story]);
		expect(loadProjectMetadata(story.id)).toEqual(
			expect.objectContaining({
				rootPath: '/native/moon-castle.twine.rs',
				status: 'file-backed',
				storageKind: 'electron-project-folder',
				storyId: story.id
			})
		);
		expect(projectStoryHydration(story.id)).toEqual(
			expect.objectContaining({
				passageTextLoaded: false,
				rootPath: '/native/moon-castle.twine.rs'
			})
		);
	});

	it('collapses duplicate native project story entries by project path and story file', async () => {
		const oldStory = fakeStory(1);
		const newStory = fakeStory(1);

		oldStory.id = 'old-story-id';
		oldStory.name = 'Moon Castle';
		oldStory.passages = oldStory.passages.map(passage => ({
			...passage,
			story: oldStory.id
		}));
		newStory.id = 'new-story-id';
		newStory.name = 'Moon Castle';
		newStory.passages = newStory.passages.map(passage => ({
			...passage,
			story: newStory.id
		}));

		mockLoadStories([
			{
				kind: 'native-project',
				passageTextLoaded: false,
				rootPath: '/native/moon-castle.twine.rs',
				story: oldStory,
				storyIds: [oldStory.id]
			},
			{
				kind: 'native-project',
				passageTextLoaded: false,
				rootPath: '/native/moon-castle.twine.rs',
				story: newStory,
				storyIds: [newStory.id]
			}
		]);

		expect(await load()).toEqual([newStory]);
	});

	it("preserves stories' modification time", async () => {
		(await load()).forEach((result, index) =>
			expect(result.lastUpdate).toBe(storydata[index].mtime)
		);
	});

	it('skips stories that cannot be parsed', async () => {
		storydata[0].htmlSource = 'bad';
		expect(await load()).toEqual([
			{
				...stories[1],
				id: expect.any(String),
				lastUpdate: expect.any(Date),
				passages: [
					{
						...stories[1].passages[0],
						id: expect.any(String),
						// This is not preserved in publishing right now.
						selected: false,
						story: expect.any(String)
					}
				],
				selected: false,
				// This is not preserved in publishing right now.
				snapToGrid: expect.any(Boolean),
				startPassage: expect.any(String)
			}
		]);
	});

	it("resolves to an empty array if loadStories doesn't return an array", async () => {
		mockLoadStories('bad');
		expect(await load()).toEqual([]);
		mockLoadStories(0);
		expect(await load()).toEqual([]);
		mockLoadStories(undefined);
		expect(await load()).toEqual([]);
		mockLoadStories(null);
		expect(await load()).toEqual([]);
		mockLoadStories({});
		expect(await load()).toEqual([]);
	});
});
