import {app, clipboard, ipcMain, shell} from 'electron';
import {initIpc} from '../ipc';
import {loadPrefs} from '../prefs';
import {saveJsonFile} from '../json-file';
import {openWithScratchFile, openWithScratchPackage} from '../scratch-file';
import {
	deleteStory,
	loadStories,
	renameStory,
	saveStoryHtml
} from '../story-file';
import {Story} from '../../../store/stories';
import {fakePendingStoryFormat, fakePrefs, fakeStory} from '../../../test-util';
import {loadStoryFormats} from '../story-formats';
import {
	chooseStoryDirectoryPath,
	getStoryDirectoryPath,
	revealStoryDirectory
} from '../story-directory';
import {
	chooseAssetFile,
	copyAssetToProject,
	createProjectFolder,
	deleteProjectAsset,
	listProjectAssets,
	openProjectFolder,
	projectSessionSnapshot,
	renameProjectAsset,
	replaceProjectAsset,
	resolveProjectSessionConflicts,
	saveProjectFolder,
	startProjectSession,
	stopProjectSession
} from '../project-folder';

jest.mock('../json-file');
jest.mock('../prefs');
jest.mock('../project-folder');
jest.mock('../scratch-file');
jest.mock('../story-directory');
jest.mock('../story-file');
jest.mock('../story-formats');

describe('initIpc()', () => {
	const deleteStoryMock = deleteStory as jest.Mock;
	const loadPrefsMock = loadPrefs as jest.Mock;
	const handleMock = ipcMain.handle as jest.Mock;
	const loadStoriesMock = loadStories as jest.Mock;
	const loadStoryFormatsMock = loadStoryFormats as jest.Mock;
	const chooseAssetFileMock = chooseAssetFile as jest.Mock;
	const copyAssetToProjectMock = copyAssetToProject as jest.Mock;
	const chooseStoryDirectoryPathMock = chooseStoryDirectoryPath as jest.Mock;
	const createProjectFolderMock = createProjectFolder as jest.Mock;
	const deleteProjectAssetMock = deleteProjectAsset as jest.Mock;
	const getStoryDirectoryPathMock = getStoryDirectoryPath as jest.Mock;
	const listProjectAssetsMock = listProjectAssets as jest.Mock;
	const openProjectFolderMock = openProjectFolder as jest.Mock;
	const projectSessionSnapshotMock = projectSessionSnapshot as jest.Mock;
	const renameProjectAssetMock = renameProjectAsset as jest.Mock;
	const replaceProjectAssetMock = replaceProjectAsset as jest.Mock;
	const resolveProjectSessionConflictsMock =
		resolveProjectSessionConflicts as jest.Mock;
	const saveProjectFolderMock = saveProjectFolder as jest.Mock;
	const startProjectSessionMock = startProjectSession as jest.Mock;
	const stopProjectSessionMock = stopProjectSession as jest.Mock;
	const revealStoryDirectoryMock = revealStoryDirectory as jest.Mock;
	const onMock = ipcMain.on as jest.Mock;
	const appOnMock = app.on as jest.Mock;
	const clipboardWriteTextMock = clipboard.writeText as jest.Mock;
	const openWithScratchFileMock = openWithScratchFile as jest.Mock;
	const openWithScratchPackageMock = openWithScratchPackage as jest.Mock;
	const renameStoryMock = renameStory as jest.Mock;
	const saveJsonFileMock = saveJsonFile as jest.Mock;
	const saveStoryHtmlMock = saveStoryHtml as jest.Mock;
	const showItemInFolderMock = shell.showItemInFolder as jest.Mock;

	beforeEach(() => {
		clipboardWriteTextMock.mockClear();
		showItemInFolderMock.mockClear();
		openWithScratchPackageMock.mockClear();
		chooseAssetFileMock.mockResolvedValue('/mock/asset.png');
		copyAssetToProjectMock.mockResolvedValue({
			sourcePath: '/mock/project/assets/asset.png',
			targetPath: 'assets/asset.png'
		});
		deleteProjectAssetMock.mockResolvedValue(undefined);
		listProjectAssetsMock.mockResolvedValue([
			{path: 'assets/asset.png', sizeBytes: 100}
		]);
		projectSessionSnapshotMock.mockResolvedValue({
			assets: [],
			changedPaths: [],
			conflicts: [],
			files: [],
			rootPath: '/mock/project',
			scannedAt: '2026-06-21T16:00:00.000Z',
			stories: [],
			storyIds: []
		});
		renameProjectAssetMock.mockResolvedValue({
			sourcePath: '/mock/project/assets/renamed.png',
			targetPath: 'assets/renamed.png'
		});
		resolveProjectSessionConflictsMock.mockResolvedValue({
			assets: [],
			changedPaths: [],
			conflicts: [],
			files: [],
			rootPath: '/mock/project',
			scannedAt: '2026-06-21T16:00:00.000Z',
			stories: [],
			storyIds: []
		});
		replaceProjectAssetMock.mockResolvedValue({
			sourcePath: '/mock/project/assets/asset.png',
			targetPath: 'assets/asset.png'
		});
		chooseStoryDirectoryPathMock.mockResolvedValue('/mock/library');
		createProjectFolderMock.mockResolvedValue({
			rootPath: '/mock/project',
			stories: [],
			storyIds: []
		});
		getStoryDirectoryPathMock.mockReturnValue('/mock/library');
		openProjectFolderMock.mockResolvedValue(undefined);
		saveProjectFolderMock.mockResolvedValue({
			rootPath: '/mock/project',
			stories: [],
			storyIds: []
		});
		startProjectSessionMock.mockResolvedValue({
			assets: [],
			changedPaths: [],
			conflicts: [],
			files: [],
			rootPath: '/mock/project',
			scannedAt: '2026-06-21T16:00:00.000Z',
			stories: [],
			storyIds: []
		});
		stopProjectSessionMock.mockReturnValue(undefined);
		revealStoryDirectoryMock.mockResolvedValue(undefined);
		saveStoryHtmlMock.mockResolvedValue(undefined);
		initIpc();
	});

	it('adds a listener for copy-text events that writes to the clipboard', () => {
		const listener = onMock.mock.calls.find(call => call[0] === 'copy-text');

		expect(listener).not.toBeUndefined();
		listener[1]({}, 'test text');
		expect(clipboardWriteTextMock).toHaveBeenCalledWith('test text');
	});

	it('adds native project and asset handlers', async () => {
		const story = fakeStory();
		const chooseAsset = handleMock.mock.calls.find(
			call => call[0] === 'choose-asset-file'
		);
		const chooseLibrary = handleMock.mock.calls.find(
			call => call[0] === 'choose-story-library-folder'
		);
		const copyAsset = handleMock.mock.calls.find(
			call => call[0] === 'copy-asset-to-project'
		);
		const deleteAsset = handleMock.mock.calls.find(
			call => call[0] === 'delete-project-asset'
		);
		const listAssets = handleMock.mock.calls.find(
			call => call[0] === 'list-project-assets'
		);
		const sessionSnapshot = handleMock.mock.calls.find(
			call => call[0] === 'project-session-snapshot'
		);
		const startSession = handleMock.mock.calls.find(
			call => call[0] === 'start-project-session'
		);
		const stopSession = handleMock.mock.calls.find(
			call => call[0] === 'stop-project-session'
		);
		const resolveSession = handleMock.mock.calls.find(
			call => call[0] === 'resolve-project-session-conflicts'
		);
		const renameAsset = handleMock.mock.calls.find(
			call => call[0] === 'rename-project-asset'
		);
		const replaceAsset = handleMock.mock.calls.find(
			call => call[0] === 'replace-project-asset'
		);
		const createProject = handleMock.mock.calls.find(
			call => call[0] === 'create-project-folder'
		);
		const getLibrary = handleMock.mock.calls.find(
			call => call[0] === 'get-story-library-folder'
		);
		const openProject = handleMock.mock.calls.find(
			call => call[0] === 'open-project-folder'
		);
		const revealLibrary = handleMock.mock.calls.find(
			call => call[0] === 'reveal-story-library-folder'
		);
		const saveProject = handleMock.mock.calls.find(
			call => call[0] === 'save-project-folder'
		);

		expect(await chooseAsset[1]({}, '/mock/assets')).toBe('/mock/asset.png');
		expect(chooseAssetFileMock).toHaveBeenCalledWith('/mock/assets');
		expect(await copyAsset[1]({}, '/mock/project', '/mock/asset.png')).toEqual({
			sourcePath: '/mock/project/assets/asset.png',
			targetPath: 'assets/asset.png'
		});
		expect(copyAssetToProjectMock).toHaveBeenCalledWith(
			'/mock/project',
			'/mock/asset.png'
		);
		expect(await listAssets[1]({}, '/mock/project')).toEqual([
			{path: 'assets/asset.png', sizeBytes: 100}
		]);
		expect(listProjectAssetsMock).toHaveBeenCalledWith('/mock/project');
		expect(await sessionSnapshot[1]({}, '/mock/project')).toEqual(
			expect.objectContaining({rootPath: '/mock/project'})
		);
		expect(projectSessionSnapshotMock).toHaveBeenCalledWith('/mock/project');
		expect(
			await startSession[1](
				{
					sender: {
						id: 7,
						isDestroyed: () => false,
						once: jest.fn(),
						send: jest.fn()
					}
				},
				'/mock/project'
			)
		).toEqual(expect.objectContaining({rootPath: '/mock/project'}));
		expect(startProjectSessionMock).toHaveBeenCalledWith(
			'/mock/project',
			expect.any(Function)
		);
		await stopSession[1]({sender: {id: 7}}, '/mock/project');
		expect(stopProjectSessionMock).not.toHaveBeenCalled();
		await stopSession[1]({sender: {id: 8}}, '/mock/project');
		expect(stopProjectSessionMock).toHaveBeenCalledWith('/mock/project');
		expect(
			await resolveSession[1](
				{},
				'/mock/project',
				'keepApp',
				[story]
			)
		).toEqual(expect.objectContaining({rootPath: '/mock/project'}));
		expect(resolveProjectSessionConflictsMock).toHaveBeenCalledWith(
			'/mock/project',
			'keepApp',
			[story]
		);
		expect(
			await renameAsset[1](
				{},
				'/mock/project',
				'assets/asset.png',
				'assets/renamed.png'
			)
		).toEqual({
			sourcePath: '/mock/project/assets/renamed.png',
			targetPath: 'assets/renamed.png'
		});
		expect(renameProjectAssetMock).toHaveBeenCalledWith(
			'/mock/project',
			'assets/asset.png',
			'assets/renamed.png'
		);
		expect(
			await replaceAsset[1](
				{},
				'/mock/project',
				'assets/asset.png',
				'/tmp/replacement.png'
			)
		).toEqual({
			sourcePath: '/mock/project/assets/asset.png',
			targetPath: 'assets/asset.png'
		});
		expect(replaceProjectAssetMock).toHaveBeenCalledWith(
			'/mock/project',
			'assets/asset.png',
			'/tmp/replacement.png'
		);
		await deleteAsset[1]({}, '/mock/project', 'assets/asset.png');
		expect(deleteProjectAssetMock).toHaveBeenCalledWith(
			'/mock/project',
			'assets/asset.png'
		);
		expect(await chooseLibrary[1]()).toBe('/mock/library');
		expect(await createProject[1]({}, story, '/mock/root')).toEqual({
			rootPath: '/mock/project',
			stories: [],
			storyIds: []
		});
		expect(createProjectFolderMock).toHaveBeenCalledWith(story, '/mock/root');
		expect(await getLibrary[1]()).toBe('/mock/library');
		await expect(openProject[1]()).resolves.toBeUndefined();
		expect(await saveProject[1]({}, '/mock/project', story)).toEqual({
			rootPath: '/mock/project',
			stories: [],
			storyIds: []
		});
		expect(saveProjectFolderMock).toHaveBeenCalledWith('/mock/project', story);
		await revealLibrary[1]();
		expect(revealStoryDirectoryMock).toHaveBeenCalled();
	});

	describe('the listener it adds for delete-story events', () => {
		let listener: any[];
		let story: Story;

		beforeEach(() => {
			listener = onMock.mock.calls.find(call => call[0] === 'delete-story');
			story = fakeStory();
		});

		it('calls deleteStory()', async () => {
			expect(listener).not.toBeUndefined();
			listener[1]({sender: {send: jest.fn()}}, story);
			expect(deleteStoryMock).toHaveBeenCalledWith(story);
		});

		it('sends back a story-deleted event', async () => {
			const send = jest.fn();

			expect(listener).not.toBeUndefined();
			await listener[1]({sender: {send}}, story, 'test-story-html');
			expect(send.mock.calls).toEqual([['story-deleted', story]]);
		});
	});

	it('adds a listener for open-with-scratch-package events that calls openWithScratchPackage()', async () => {
		const listener = onMock.mock.calls.find(
			call => call[0] === 'open-with-scratch-package'
		);
		const assets = [
			{outputPath: 'assets/cover.png', sourcePath: '/tmp/cover.png'}
		];

		expect(listener).not.toBeUndefined();
		listener[1]({}, 'test-file-contents', 'test-filename', assets);
		expect(openWithScratchPackageMock).toHaveBeenCalledWith(
			'test-file-contents',
			'test-filename',
			assets
		);
	});

	describe('the handler it adds for load-prefs events', () => {
		it('returns the value of loadPrefs() if it does not throw', async () => {
			const prefs = fakePrefs();
			loadPrefsMock.mockReturnValue(prefs);

			const listener = handleMock.mock.calls.find(
				call => call[0] === 'load-prefs'
			);

			expect(listener).not.toBeUndefined();
			expect(await listener[1]()).toEqual(prefs);
			expect(loadPrefsMock).toHaveBeenCalledTimes(1);
		});

		it('returns an empty object if loadPrefs() throws an error', async () => {
			jest.spyOn(console, 'warn').mockReturnValue();
			loadPrefsMock.mockImplementation(() => {
				throw new Error();
			});

			const listener = handleMock.mock.calls.find(
				call => call[0] === 'load-prefs'
			);

			expect(listener).not.toBeUndefined();
			expect(await listener[1]()).toEqual({});
		});
	});

	it('adds a handler for load-stories that calls loadStories()', async () => {
		const stories = [fakeStory(), fakeStory()];

		loadStoriesMock.mockReturnValue(stories);

		const listener = handleMock.mock.calls.find(
			call => call[0] === 'load-stories'
		);

		expect(await listener[1]()).toEqual(stories);
		expect(loadStoriesMock).toHaveBeenCalledTimes(1);
	});

	describe('the handler it adds for load-story-formats events', () => {
		it('returns the value of loadStoryFormats() if it does not throw', async () => {
			const formats = [fakePendingStoryFormat(), fakePendingStoryFormat()];

			loadStoryFormatsMock.mockReturnValue(formats);

			const listener = handleMock.mock.calls.find(
				call => call[0] === 'load-story-formats'
			);

			expect(listener).not.toBeUndefined();
			expect(await listener[1]()).toEqual(formats);
			expect(loadStoryFormatsMock).toHaveBeenCalledTimes(1);
		});

		it('returns an empty array if loadStoryFormats() throws an error', async () => {
			jest.spyOn(console, 'warn').mockReturnValue();
			loadStoryFormatsMock.mockImplementation(() => {
				throw new Error();
			});

			const listener = handleMock.mock.calls.find(
				call => call[0] === 'load-story-formats'
			);

			expect(listener).not.toBeUndefined();
			expect(await listener[1]()).toEqual([]);
		});
	});

	it('adds a listener for open-with-scratch-file events that calls openWithScratchFile()', async () => {
		const listener = onMock.mock.calls.find(
			call => call[0] === 'open-with-scratch-file'
		);

		expect(listener).not.toBeUndefined();
		listener[1]({}, 'test-file-contents', 'test-filename');
		expect(openWithScratchFileMock).toHaveBeenCalledWith(
			'test-file-contents',
			'test-filename'
		);
	});

	describe('the listener it adds for rename-story events', () => {
		let listener: any[];
		let newStory: Story;
		let oldStory: Story;

		beforeEach(() => {
			listener = onMock.mock.calls.find(call => call[0] === 'rename-story');
			oldStory = fakeStory();
			newStory = {...oldStory, name: 'new-name'};
		});

		it('adds a listener for reveal-path events that reveals a file path', () => {
			const listener = onMock.mock.calls.find(
				call => call[0] === 'reveal-path'
			);

			expect(listener).not.toBeUndefined();
			listener[1]({}, '/tmp/asset.png');
			expect(showItemInFolderMock).toHaveBeenCalledWith('/tmp/asset.png');
		});

		it('calls renameStory()', async () => {
			expect(listener).not.toBeUndefined();
			listener[1]({sender: {send: jest.fn()}}, oldStory, newStory);
			expect(renameStoryMock.mock.calls).toEqual([[oldStory, newStory]]);
		});

		it('sends back a story-renamed event', async () => {
			const send = jest.fn();

			expect(listener).not.toBeUndefined();
			await listener[1]({sender: {send}}, oldStory, newStory);
			expect(send.mock.calls).toEqual([['story-renamed', oldStory, newStory]]);
		});
	});

	it('adds a listener for save-json events that calls openWithTempFile()', async () => {
		const listener = onMock.mock.calls.find(call => call[0] === 'save-json');
		const testData = {};

		expect(listener).not.toBeUndefined();
		listener[1]({}, 'test-filename', testData);
		expect(saveJsonFileMock).toHaveBeenCalledWith('test-filename', testData);
	});

	describe('the listener it adds for save-story-html events', () => {
		let listener: any[];
		let story: Story;

		beforeEach(() => {
			jest.useFakeTimers();
			jest.spyOn(console, 'log').mockReturnValue();
			listener = onMock.mock.calls.find(call => call[0] === 'save-story-html');
			story = fakeStory();
		});

		afterEach(() => {
			jest.clearAllTimers();
			jest.useRealTimers();
		});

		it('calls saveStoryHtml()', async () => {
			expect(listener).not.toBeUndefined();
			await listener[1]({sender: {send: jest.fn()}}, story, 'test-story-html');
			jest.advanceTimersByTime(1000);
			expect(saveStoryHtmlMock).toHaveBeenCalledWith(story, 'test-story-html');
		});

		it('debounces calls to saveStoryHtml() for the same story ID with both leading and trailing calls', async () => {
			saveStoryHtmlMock.mockImplementation(() => new Promise(() => {}));
			listener[1]({sender: {send: jest.fn()}}, story, 'test-story-html-1');
			listener[1]({sender: {send: jest.fn()}}, story, 'test-story-html-2');
			listener[1]({sender: {send: jest.fn()}}, story, 'test-story-html-3');
			jest.advanceTimersByTime(1000);
			expect(saveStoryHtmlMock.mock.calls).toEqual([
				[story, 'test-story-html-1'],
				[story, 'test-story-html-3']
			]);
		});

		it("doesn't debounce calls to saveStoryHtml() for different story IDs", async () => {
			const story1 = fakeStory();
			const story2 = fakeStory();

			story1.id = 'mock-id-1';
			story2.id = 'mock-id-2';

			saveStoryHtmlMock.mockImplementation(() => new Promise(() => {}));
			listener[1]({sender: {send: jest.fn()}}, story1, 'test-story-html-1');
			listener[1]({sender: {send: jest.fn()}}, story2, 'test-story-html-2');
			jest.advanceTimersByTime(1000);
			expect(saveStoryHtmlMock.mock.calls).toEqual([
				[story1, 'test-story-html-1'],
				[story2, 'test-story-html-2']
			]);
		});

		it('correctly debounces calls to saveStoryHtml() when multiple stories are saved at once', async () => {
			const story1 = fakeStory();
			const story2 = fakeStory();

			story1.id = 'mock-id-1';
			story2.id = 'mock-id-2';

			saveStoryHtmlMock.mockImplementation(() => new Promise(() => {}));
			listener[1]({sender: {send: jest.fn()}}, story1, 'test-story-html-1');
			listener[1]({sender: {send: jest.fn()}}, story1, 'test-story-html-2');
			listener[1]({sender: {send: jest.fn()}}, story2, 'test-story-html-3');
			listener[1]({sender: {send: jest.fn()}}, story1, 'test-story-html-4');
			listener[1]({sender: {send: jest.fn()}}, story2, 'test-story-html-5');
			jest.advanceTimersByTime(1000);
			expect(saveStoryHtmlMock.mock.calls).toEqual([
				[story1, 'test-story-html-1'],
				[story2, 'test-story-html-3'],
				[story1, 'test-story-html-4'],
				[story2, 'test-story-html-5']
			]);
		});

		it('sends back a story-html-saved event', async () => {
			const send = jest.fn();

			saveStoryHtmlMock.mockReturnValue(undefined);
			expect(listener).not.toBeUndefined();
			listener[1]({sender: {send}}, story, 'test-story-html');
			jest.advanceTimersByTime(1000);
			await Promise.resolve();
			expect(send.mock.calls).toEqual([['story-html-saved', story]]);
		});

		it('rejects if asked to save an empty string', async () => {
			expect(listener).not.toBeUndefined();
			await expect(
				listener[1]({sender: {send: jest.fn()}}, story, '')
			).rejects.toBeInstanceOf(Error);
			expect(saveStoryHtmlMock).not.toHaveBeenCalled();
		});

		it('rejects if asked to save a non-string', async () => {
			expect(listener).not.toBeUndefined();
			await expect(
				listener[1]({sender: {send: jest.fn()}}, story, null)
			).rejects.toBeInstanceOf(Error);
			expect(saveStoryHtmlMock).not.toHaveBeenCalled();
			await expect(
				listener[1]({sender: {send: jest.fn()}}, story, undefined)
			).rejects.toBeInstanceOf(Error);
			expect(saveStoryHtmlMock).not.toHaveBeenCalled();
			await expect(
				listener[1]({sender: {send: jest.fn()}}, story, false)
			).rejects.toBeInstanceOf(Error);
			expect(saveStoryHtmlMock).not.toHaveBeenCalled();
			await expect(
				listener[1](
					{sender: {send: jest.fn()}},
					story,
					Promise.resolve('some html')
				)
			).rejects.toBeInstanceOf(Error);
			expect(saveStoryHtmlMock).not.toHaveBeenCalled();
		});
	});

	describe('the handler it adds to the app will-quit event', () => {
		let saveListeners: any[];
		let quitListeners: any[];
		let story: Story;
		let story2: Story;

		beforeEach(() => {
			jest.useFakeTimers();
			jest.spyOn(console, 'log').mockReturnValue();
			quitListeners = appOnMock.mock.calls.find(
				call => call[0] === 'will-quit'
			);
			saveListeners = onMock.mock.calls.find(
				call => call[0] === 'save-story-html'
			);
			story = fakeStory();
			story2 = fakeStory();
		});

		afterEach(() => {
			jest.clearAllTimers();
			jest.useRealTimers();
		});

		it('flushes all pending debounced story saves', async () => {
			saveListeners[1]({sender: {send: jest.fn()}}, story, 'test-story-html-1');
			saveListeners[1]({sender: {send: jest.fn()}}, story, 'test-story-html-2');
			saveListeners[1](
				{sender: {send: jest.fn()}},
				story2,
				'test-story-html-3'
			);

			// Leading calls.

			expect(saveStoryHtmlMock.mock.calls).toEqual([
				[story, 'test-story-html-1'],
				[story2, 'test-story-html-3']
			]);
			saveStoryHtmlMock.mockClear();
			await quitListeners[1]();

			// Trailing calls.

			expect(saveStoryHtmlMock.mock.calls).toEqual([
				[story, 'test-story-html-2']
			]);
		});

		it('does nothing if there are no debounced story saves pending', async () => {
			saveListeners[1]({sender: {send: jest.fn()}}, story, 'test-story-html-1');
			saveListeners[1]({sender: {send: jest.fn()}}, story, 'test-story-html-2');
			saveListeners[1](
				{sender: {send: jest.fn()}},
				story2,
				'test-story-html-3'
			);
			jest.advanceTimersByTime(1000);
			expect(saveStoryHtmlMock.mock.calls).toEqual([
				[story, 'test-story-html-1'],
				[story2, 'test-story-html-3'],
				[story, 'test-story-html-2']
			]);
			saveStoryHtmlMock.mockClear();
			await quitListeners[1]();
			expect(saveStoryHtmlMock).not.toHaveBeenCalled();
		});
	});
});
