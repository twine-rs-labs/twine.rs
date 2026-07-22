import {app, clipboard, dialog, ipcMain, shell} from 'electron';
import {initIpc} from '../ipc';
import {consumeCommandLineOpenPaths} from '../command-line';
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
import {loadStoryFormatProperties, loadStoryFormats} from '../story-formats';
import {
	backupStoryDirectory,
	chooseStoryDirectoryPath,
	getBackupDirectoryPath,
	getStoryDirectoryPath,
	revealBackupDirectory,
	revealStoryDirectory,
	resetStoryDirectoryPath
} from '../story-directory';
import {
	nativeAppPlatformSettings,
	updateNativeAppPlatformSettings
} from '../platform-settings';
import {
	chooseAssetFile,
	copyProjectImportAssets,
	copyAssetToProject,
	createProjectFolder,
	deleteProjectAsset,
	discardProjectImport,
	hydrateProjectFolder,
	listProjectAssets,
	openProjectFolder,
	prepareProjectImport,
	projectSessionAssetReadBaselines,
	projectSessionSnapshot,
	renameProjectAsset,
	replaceProjectAsset,
	resolveProjectSessionConflicts,
	saveProjectFolder,
	startProjectSession,
	stopProjectSession
} from '../project-folder';
import {
	nativeProjectAssetEmbeddingAvailable,
	readNativeProjectAssetPayloads
} from '../native';
import {
	grantProjectCapability,
	projectCapabilityField
} from '../project-capabilities';

jest.mock('../json-file');
jest.mock('../native');
jest.mock('../command-line');
jest.mock('../platform-settings');
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
	const loadStoryFormatPropertiesMock = loadStoryFormatProperties as jest.Mock;
	const chooseAssetFileMock = chooseAssetFile as jest.Mock;
	const copyAssetToProjectMock = copyAssetToProject as jest.Mock;
	const copyProjectImportAssetsMock = copyProjectImportAssets as jest.Mock;
	const chooseStoryDirectoryPathMock = chooseStoryDirectoryPath as jest.Mock;
	const backupStoryDirectoryMock = backupStoryDirectory as jest.Mock;
	const consumeCommandLineOpenPathsMock =
		consumeCommandLineOpenPaths as jest.Mock;
	const createProjectFolderMock = createProjectFolder as jest.Mock;
	const deleteProjectAssetMock = deleteProjectAsset as jest.Mock;
	const discardProjectImportMock = discardProjectImport as jest.Mock;
	const getBackupDirectoryPathMock = getBackupDirectoryPath as jest.Mock;
	const getStoryDirectoryPathMock = getStoryDirectoryPath as jest.Mock;
	const hydrateProjectFolderMock = hydrateProjectFolder as jest.Mock;
	const listProjectAssetsMock = listProjectAssets as jest.Mock;
	const openProjectFolderMock = openProjectFolder as jest.Mock;
	const prepareProjectImportMock = prepareProjectImport as jest.Mock;
	const projectSessionSnapshotMock = projectSessionSnapshot as jest.Mock;
	const projectSessionAssetReadBaselinesMock =
		projectSessionAssetReadBaselines as jest.Mock;
	const renameProjectAssetMock = renameProjectAsset as jest.Mock;
	const replaceProjectAssetMock = replaceProjectAsset as jest.Mock;
	const resolveProjectSessionConflictsMock =
		resolveProjectSessionConflicts as jest.Mock;
	const saveProjectFolderMock = saveProjectFolder as jest.Mock;
	const startProjectSessionMock = startProjectSession as jest.Mock;
	const stopProjectSessionMock = stopProjectSession as jest.Mock;
	const nativeAppPlatformSettingsMock = nativeAppPlatformSettings as jest.Mock;
	const updateNativeAppPlatformSettingsMock =
		updateNativeAppPlatformSettings as jest.Mock;
	const revealBackupDirectoryMock = revealBackupDirectory as jest.Mock;
	const revealStoryDirectoryMock = revealStoryDirectory as jest.Mock;
	const resetStoryDirectoryPathMock = resetStoryDirectoryPath as jest.Mock;
	const onMock = ipcMain.on as jest.Mock;
	const appOnMock = app.on as jest.Mock;
	const appQuitMock = app.quit as jest.Mock;
	const clipboardWriteTextMock = clipboard.writeText as jest.Mock;
	const openWithScratchFileMock = openWithScratchFile as jest.Mock;
	const openWithScratchPackageMock = openWithScratchPackage as jest.Mock;
	const renameStoryMock = renameStory as jest.Mock;
	const saveJsonFileMock = saveJsonFile as jest.Mock;
	const saveStoryHtmlMock = saveStoryHtml as jest.Mock;
	const showErrorBoxMock = dialog.showErrorBox as jest.Mock;
	const showItemInFolderMock = shell.showItemInFolder as jest.Mock;
	const nativeProjectAssetEmbeddingAvailableMock =
		nativeProjectAssetEmbeddingAvailable as jest.Mock;
	const readNativeProjectAssetPayloadsMock =
		readNativeProjectAssetPayloads as jest.Mock;

	beforeEach(() => {
		clipboardWriteTextMock.mockClear();
		showItemInFolderMock.mockClear();
		openWithScratchPackageMock.mockClear();
		chooseAssetFileMock.mockResolvedValue('/mock/asset.png');
		copyAssetToProjectMock.mockResolvedValue({
			sourcePath: '/mock/project/assets/asset.png',
			targetPath: 'assets/asset.png'
		});
		copyProjectImportAssetsMock.mockResolvedValue([
			{
				sourcePath: '/mock/project/assets/asset.png',
				targetPath: 'assets/asset.png'
			}
		]);
		backupStoryDirectoryMock.mockResolvedValue({
			backupDirectoryName: '/mock/backups/backup',
			backupPath: '/mock/backups',
			createdAt: '2026-06-21T16:00:00.000Z',
			prunedBackupNames: []
		});
		consumeCommandLineOpenPathsMock.mockReturnValue([]);
		deleteProjectAssetMock.mockResolvedValue(undefined);
		discardProjectImportMock.mockResolvedValue(undefined);
		hydrateProjectFolderMock.mockResolvedValue({
			rootPath: '/mock/project',
			stories: [],
			storyIds: []
		});
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
		projectSessionAssetReadBaselinesMock.mockImplementation(
			(_rootPath: string, paths: string[]) =>
				paths.map(path => ({
					expectedContentDigest: 'a'.repeat(64),
					expectedExists: true,
					expectedModifiedAtMs: 1,
					expectedSizeBytes: 100,
					path
				}))
		);
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
		getBackupDirectoryPathMock.mockReturnValue('/mock/backups');
		getStoryDirectoryPathMock.mockReturnValue('/mock/library');
		nativeAppPlatformSettingsMock.mockReturnValue({
			backupCadenceMinutes: 20,
			backupLastReviewedTime: 0,
			backupReminderDays: 7,
			backupRetentionLimit: 10,
			cacheCleanupDays: 3,
			externalEditorCommand: '',
			fullscreenPersistence: true,
			lastWindowFullscreen: false,
			linkHandlingMode: 'system',
			scratchAssetStrategy: 'link'
		});
		openProjectFolderMock.mockResolvedValue(undefined);
		prepareProjectImportMock.mockResolvedValue({
			assets: [],
			htmlFilePath: '/mock/story.html',
			htmlSource: '<tw-storydata name="Mock" hidden></tw-storydata>',
			id: 'import-1',
			sourceKind: 'html',
			sourcePath: '/mock/story.html'
		});
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
		updateNativeAppPlatformSettingsMock.mockResolvedValue({
			backupCadenceMinutes: 30,
			backupLastReviewedTime: 0,
			backupReminderDays: 7,
			backupRetentionLimit: 10,
			cacheCleanupDays: 3,
			externalEditorCommand: '',
			fullscreenPersistence: true,
			lastWindowFullscreen: false,
			linkHandlingMode: 'system',
			scratchAssetStrategy: 'link'
		});
		revealBackupDirectoryMock.mockResolvedValue(undefined);
		revealStoryDirectoryMock.mockResolvedValue(undefined);
		resetStoryDirectoryPathMock.mockResolvedValue('/mock/default-library');
		saveStoryHtmlMock.mockResolvedValue(undefined);
		nativeProjectAssetEmbeddingAvailableMock.mockReturnValue(true);
		readNativeProjectAssetPayloadsMock.mockResolvedValue({
			failures: [],
			payloads: [],
			totalEncodedBytes: 0,
			totalSourceBytes: 0
		});
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
		const copyImportAssets = handleMock.mock.calls.find(
			call => call[0] === 'copy-project-import-assets'
		);
		const deleteAsset = handleMock.mock.calls.find(
			call => call[0] === 'delete-project-asset'
		);
		const discardImport = handleMock.mock.calls.find(
			call => call[0] === 'discard-project-import'
		);
		const hydrateProject = handleMock.mock.calls.find(
			call => call[0] === 'hydrate-project-folder'
		);
		const listAssets = handleMock.mock.calls.find(
			call => call[0] === 'list-project-assets'
		);
		const embeddingCapability = handleMock.mock.calls.find(
			call => call[0] === 'referenced-media-embedding-capability'
		);
		const readAssetPayloads = handleMock.mock.calls.find(
			call => call[0] === 'read-project-asset-payloads'
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
		const prepareImport = handleMock.mock.calls.find(
			call => call[0] === 'prepare-project-import'
		);
		const revealLibrary = handleMock.mock.calls.find(
			call => call[0] === 'reveal-story-library-folder'
		);
		const resetLibrary = handleMock.mock.calls.find(
			call => call[0] === 'reset-story-library-folder'
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
		expect(await copyImportAssets[1]({}, 'import-1', '/mock/project')).toEqual([
			{
				sourcePath: '/mock/project/assets/asset.png',
				targetPath: 'assets/asset.png'
			}
		]);
		expect(copyProjectImportAssetsMock).toHaveBeenCalledWith(
			'import-1',
			'/mock/project'
		);
		expect(await listAssets[1]({}, '/mock/project')).toEqual([
			{path: 'assets/asset.png', sizeBytes: 100}
		]);
		expect(listProjectAssetsMock).toHaveBeenCalledWith('/mock/project');
		expect(
			await sessionSnapshot[1]({}, '/mock/project', ['mock-story'])
		).toEqual(expect.objectContaining({rootPath: '/mock/project'}));
		expect(projectSessionSnapshotMock).toHaveBeenCalledWith('/mock/project', [
			'mock-story'
		]);
		const sender7 = {
			id: 7,
			isDestroyed: () => false,
			once: jest.fn(),
			send: jest.fn()
		};
		const sender8 = {id: 8};
		const sender99 = {id: 99};
		const capabilityFor = (sender: object) =>
			(
				grantProjectCapability(
					{sender},
					{rootPath: '/mock/project', stories: [], storyIds: []}
				) as Record<string, unknown>
			)[projectCapabilityField] as string;
		const capability7 = capabilityFor(sender7);
		const capability8 = capabilityFor(sender8);
		const capability99 = capabilityFor(sender99);

		expect(
			await startSession[1]({sender: sender7}, capability7, ['mock-story'])
		).toEqual(expect.objectContaining({rootPath: '/mock/project'}));
		expect(startProjectSessionMock).toHaveBeenCalledWith(
			'/mock/project',
			expect.any(Function),
			['mock-story']
		);
		expect(await embeddingCapability[1]()).toEqual(
			expect.objectContaining({available: true, maxFileCount: 25})
		);
		const limits = {
			maxFileBytes: 100,
			maxFileCount: 2,
			maxTotalEncodedBytes: 200
		};
		expect(
			await readAssetPayloads[1](
				{sender: sender7},
				capability7,
				['assets/asset.png'],
				limits
			)
		).toEqual(expect.objectContaining({payloads: []}));
		expect(readNativeProjectAssetPayloadsMock).toHaveBeenCalledWith(
			'/mock/project',
			[
				{
					expectedContentDigest: 'a'.repeat(64),
					expectedExists: true,
					expectedModifiedAtMs: 1,
					expectedSizeBytes: 100,
					path: 'assets/asset.png'
				}
			],
			limits
		);
		const baselineCallCount =
			projectSessionAssetReadBaselinesMock.mock.calls.length;

		await expect(
			readAssetPayloads[1](
				{sender: sender7},
				capability7,
				Array.from({length: 26}, (_, index) => `assets/${index}.png`),
				limits
			)
		).rejects.toThrow('Referenced media request exceeds the safe path limits.');
		expect(projectSessionAssetReadBaselinesMock).toHaveBeenCalledTimes(
			baselineCallCount
		);
		readNativeProjectAssetPayloadsMock.mockRejectedValueOnce(
			new Error('Native asset reader failed.')
		);
		await expect(
			readAssetPayloads[1](
				{sender: sender7},
				capability7,
				['assets/asset.png'],
				limits
			)
		).rejects.toThrow('Native asset reader failed.');
		await expect(
			readAssetPayloads[1](
				{sender: sender99},
				capability99,
				['assets/asset.png'],
				limits
			)
		).rejects.toThrow(/active project session/);
		await stopSession[1]({sender: sender7}, capability7);
		expect(stopProjectSessionMock).not.toHaveBeenCalled();
		await stopSession[1]({sender: sender8}, capability8);
		expect(stopProjectSessionMock).toHaveBeenCalledWith('/mock/project');
		expect(
			await resolveSession[1]({}, '/mock/project', 'keepApp', [story])
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
		await discardImport[1]({}, 'import-1');
		expect(discardProjectImportMock).toHaveBeenCalledWith('import-1');
		expect(await chooseLibrary[1]()).toBe('/mock/library');
		expect(
			await createProject[1]({}, story, '/mock/root', 'single-twee')
		).toEqual({
			rootPath: '/mock/project',
			stories: [],
			storyIds: []
		});
		expect(createProjectFolderMock).toHaveBeenCalledWith(
			story,
			'/mock/root',
			'single-twee'
		);
		expect(await getLibrary[1]()).toBe('/mock/library');
		expect(await resetLibrary[1]()).toBe('/mock/default-library');
		expect(resetStoryDirectoryPathMock).toHaveBeenCalledTimes(1);
		await expect(openProject[1]()).resolves.toBeUndefined();
		await expect(
			hydrateProject[1]({}, '/mock/project', ['mock-story'])
		).resolves.toEqual({
			rootPath: '/mock/project',
			stories: [],
			storyIds: []
		});
		expect(hydrateProjectFolderMock).toHaveBeenCalledWith('/mock/project', [
			'mock-story'
		]);
		await expect(prepareImport[1]({}, '/mock/story.html')).resolves.toEqual(
			expect.objectContaining({id: 'import-1'})
		);
		expect(prepareProjectImportMock).toHaveBeenCalledWith('/mock/story.html');
		expect(await saveProject[1]({}, '/mock/project', story)).toEqual({
			rootPath: '/mock/project',
			stories: [],
			storyIds: []
		});
		expect(saveProjectFolderMock).toHaveBeenCalledWith(
			'/mock/project',
			story,
			undefined
		);
		await revealLibrary[1]();
		expect(revealStoryDirectoryMock).toHaveBeenCalled();
	});

	it('adds platform, backup, and command-line open handlers', async () => {
		const commandLine = handleMock.mock.calls.find(
			call => call[0] === 'consume-command-line-open-requests'
		);
		const getPlatform = handleMock.mock.calls.find(
			call => call[0] === 'get-platform-settings'
		);
		const updatePlatform = handleMock.mock.calls.find(
			call => call[0] === 'update-platform-settings'
		);
		const runBackup = handleMock.mock.calls.find(
			call => call[0] === 'run-story-library-backup'
		);
		const revealBackup = handleMock.mock.calls.find(
			call => call[0] === 'reveal-backup-folder'
		);

		consumeCommandLineOpenPathsMock.mockReturnValue([
			'/native/project.twine.rs',
			'/tmp/story.html'
		]);
		openProjectFolderMock.mockImplementation(async path => {
			if (path === '/native/project.twine.rs') {
				return {
					rootPath: path,
					stories: [],
					storyIds: []
				};
			}

			throw Object.assign(new Error('not a directory'), {code: 'ENOTDIR'});
		});

		expect(await commandLine[1]()).toEqual({
			errors: [],
			openedProjects: [
				{
					rootPath: '/native/project.twine.rs',
					stories: [],
					storyIds: []
				}
			],
			unsupportedPaths: ['/tmp/story.html']
		});
		expect(openProjectFolderMock).toHaveBeenCalledWith(
			'/native/project.twine.rs',
			{loadPassageText: false}
		);
		expect(await getPlatform[1]()).toEqual(
			expect.objectContaining({
				backupFolderPath: '/mock/backups',
				storyLibraryFolderPath: '/mock/library'
			})
		);
		expect(await updatePlatform[1]({}, {backupCadenceMinutes: 30})).toEqual(
			expect.objectContaining({backupCadenceMinutes: 20})
		);
		expect(updateNativeAppPlatformSettingsMock).toHaveBeenCalledWith({
			backupCadenceMinutes: 30
		});
		expect(await runBackup[1]()).toEqual(
			expect.objectContaining({backupPath: '/mock/backups'})
		);
		expect(backupStoryDirectoryMock).toHaveBeenCalledTimes(1);
		expect(updateNativeAppPlatformSettingsMock).toHaveBeenCalledWith({
			backupLastReviewedTime: expect.any(Number)
		});
		await revealBackup[1]();
		expect(revealBackupDirectoryMock).toHaveBeenCalled();
	});

	describe('the handler it adds for delete-story events', () => {
		let handler: any[];
		let story: Story;

		beforeEach(() => {
			handler = handleMock.mock.calls.find(call => call[0] === 'delete-story');
			story = fakeStory();
		});

		it('calls deleteStory()', async () => {
			expect(handler).not.toBeUndefined();
			await handler[1]({}, story);
			expect(deleteStoryMock).toHaveBeenCalledWith(story);
		});

		it('rejects with delete failures so the renderer can report them', async () => {
			const error = new Error('delete failed');

			deleteStoryMock.mockRejectedValueOnce(error);
			await expect(handler[1]({}, story)).rejects.toBe(error);
		});
	});

	it('adds a handler for open-with-scratch-package events that awaits openWithScratchPackage()', async () => {
		const handler = handleMock.mock.calls.find(
			call => call[0] === 'open-with-scratch-package'
		);
		const assets = [
			{outputPath: 'assets/cover.png', sourcePath: '/tmp/cover.png'}
		];

		expect(handler).not.toBeUndefined();
		await handler[1]({}, 'test-file-contents', 'test-filename', assets);
		expect(openWithScratchPackageMock).toHaveBeenCalledWith(
			'test-file-contents',
			'test-filename',
			assets
		);
	});

	it('rejects scratch-package failures through the acknowledged handler', async () => {
		const error = new Error('scratch package failed');
		const handler = handleMock.mock.calls.find(
			call => call[0] === 'open-with-scratch-package'
		);

		openWithScratchPackageMock.mockRejectedValueOnce(error);
		await expect(
			handler[1]({}, 'test-file-contents', 'test-filename', [])
		).rejects.toBe(error);
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

	it('returns an empty story library if loadStories() throws', async () => {
		jest.spyOn(console, 'warn').mockReturnValue();
		loadStoriesMock.mockImplementation(() => {
			throw new Error('mock-story-load-error');
		});

		const listener = handleMock.mock.calls.find(
			call => call[0] === 'load-stories'
		);

		expect(listener).not.toBeUndefined();
		expect(await listener[1]()).toEqual([]);
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

	it('loads story format properties through the main-process parser', async () => {
		const properties = {
			name: 'Safe Format',
			source: '<html></html>',
			version: '1.0.0'
		};

		loadStoryFormatPropertiesMock.mockResolvedValue(properties);
		const listener = handleMock.mock.calls.find(
			call => call[0] === 'load-story-format-properties'
		);

		await expect(
			listener[1]({}, 'https://formats.example/format.js', 3000)
		).resolves.toBe(properties);
		expect(loadStoryFormatPropertiesMock).toHaveBeenCalledWith(
			'https://formats.example/format.js',
			3000
		);
	});

	it('adds a handler for open-with-scratch-file events that awaits openWithScratchFile()', async () => {
		const handler = handleMock.mock.calls.find(
			call => call[0] === 'open-with-scratch-file'
		);

		expect(handler).not.toBeUndefined();
		await handler[1]({}, 'test-file-contents', 'test-filename');
		expect(openWithScratchFileMock).toHaveBeenCalledWith(
			'test-file-contents',
			'test-filename'
		);
	});

	describe('the handler it adds for rename-story events', () => {
		let handler: any[];
		let newStory: Story;
		let oldStory: Story;

		beforeEach(() => {
			handler = handleMock.mock.calls.find(call => call[0] === 'rename-story');
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
			expect(handler).not.toBeUndefined();
			await handler[1]({}, oldStory, newStory);
			expect(renameStoryMock.mock.calls).toEqual([[oldStory, newStory]]);
		});

		it('rejects with rename failures so the renderer can report them', async () => {
			const error = new Error('rename failed');

			renameStoryMock.mockRejectedValueOnce(error);
			await expect(handler[1]({}, oldStory, newStory)).rejects.toBe(error);
		});
	});

	describe('legacy story write ordering', () => {
		let deleteHandler: any[];
		let renameHandler: any[];
		let saveHandler: any[];
		let story: Story;

		beforeEach(() => {
			jest.useFakeTimers();
			deleteHandler = handleMock.mock.calls.find(
				call => call[0] === 'delete-story'
			);
			renameHandler = handleMock.mock.calls.find(
				call => call[0] === 'rename-story'
			);
			saveHandler = handleMock.mock.calls.find(
				call => call[0] === 'save-story-html'
			);
			story = fakeStory();
		});

		afterEach(() => {
			jest.clearAllTimers();
			jest.useRealTimers();
		});

		it('finishes leading and trailing saves before deleting the story', async () => {
			const finishWrites: Array<() => void> = [];

			saveStoryHtmlMock.mockImplementation(
				() =>
					new Promise<void>(resolve => {
						finishWrites.push(resolve);
					})
			);
			const leading = saveHandler[1]({}, story, 'leading');
			const trailing = saveHandler[1]({}, story, 'trailing');
			const deletion = deleteHandler[1]({}, story);

			expect(saveStoryHtmlMock.mock.calls).toEqual([[story, 'leading']]);
			expect(deleteStoryMock).not.toHaveBeenCalled();
			finishWrites.shift()?.();
			await leading;
			for (let index = 0; index < 10; index++) {
				await Promise.resolve();
			}
			expect(saveStoryHtmlMock.mock.calls).toEqual([
				[story, 'leading'],
				[story, 'trailing']
			]);
			expect(deleteStoryMock).not.toHaveBeenCalled();
			finishWrites.shift()?.();
			await Promise.all([trailing, deletion]);
			expect(deleteStoryMock).toHaveBeenCalledWith(story);
		});

		it('finishes a trailing old-name save before renaming the story', async () => {
			const finishWrites: Array<() => void> = [];
			const renamed = {...story, name: 'Renamed'};

			saveStoryHtmlMock.mockImplementation(
				() =>
					new Promise<void>(resolve => {
						finishWrites.push(resolve);
					})
			);
			const leading = saveHandler[1]({}, story, 'leading');
			const trailing = saveHandler[1]({}, story, 'trailing');
			const rename = renameHandler[1]({}, story, renamed);

			expect(renameStoryMock).not.toHaveBeenCalled();
			finishWrites.shift()?.();
			await leading;
			for (let index = 0; index < 10; index++) {
				await Promise.resolve();
			}
			expect(renameStoryMock).not.toHaveBeenCalled();
			finishWrites.shift()?.();
			await Promise.all([trailing, rename]);
			expect(renameStoryMock).toHaveBeenCalledWith(story, renamed);
		});
	});

	it('adds an acknowledged handler for save-json events', async () => {
		const handler = handleMock.mock.calls.find(call => call[0] === 'save-json');
		const testData = {};

		expect(handler).not.toBeUndefined();
		await handler[1]({}, 'test-filename', testData);
		expect(saveJsonFileMock).toHaveBeenCalledWith('test-filename', testData);
	});

	it('rejects JSON save failures through the acknowledged handler', async () => {
		const error = new Error('JSON save failed');
		const handler = handleMock.mock.calls.find(call => call[0] === 'save-json');

		saveJsonFileMock.mockRejectedValueOnce(error);
		await expect(handler[1]({}, 'test-filename', {})).rejects.toBe(error);
	});

	describe('the handler it adds for save-story-html events', () => {
		let handler: any[];
		let story: Story;

		beforeEach(() => {
			jest.useFakeTimers();
			jest.spyOn(console, 'log').mockReturnValue();
			handler = handleMock.mock.calls.find(
				call => call[0] === 'save-story-html'
			);
			story = fakeStory();
		});

		afterEach(() => {
			jest.clearAllTimers();
			jest.useRealTimers();
		});

		it('calls saveStoryHtml()', async () => {
			expect(handler).not.toBeUndefined();
			await handler[1]({}, story, 'test-story-html');
			jest.advanceTimersByTime(1000);
			expect(saveStoryHtmlMock).toHaveBeenCalledWith(story, 'test-story-html');
		});

		it('debounces calls to saveStoryHtml() for the same story ID with both leading and trailing calls', async () => {
			const first = handler[1]({}, story, 'test-story-html-1');
			const second = handler[1]({}, story, 'test-story-html-2');
			const third = handler[1]({}, story, 'test-story-html-3');

			await first;
			jest.advanceTimersByTime(1000);
			await Promise.all([second, third]);
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

			const first = handler[1]({}, story1, 'test-story-html-1');
			const second = handler[1]({}, story2, 'test-story-html-2');

			jest.advanceTimersByTime(1000);
			await Promise.all([first, second]);
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

			const saves = [
				handler[1]({}, story1, 'test-story-html-1'),
				handler[1]({}, story1, 'test-story-html-2'),
				handler[1]({}, story2, 'test-story-html-3'),
				handler[1]({}, story1, 'test-story-html-4'),
				handler[1]({}, story2, 'test-story-html-5')
			];

			await Promise.all([saves[0], saves[2]]);
			jest.advanceTimersByTime(1000);
			await Promise.all(saves);
			expect(saveStoryHtmlMock.mock.calls).toEqual([
				[story1, 'test-story-html-1'],
				[story2, 'test-story-html-3'],
				[story1, 'test-story-html-4'],
				[story2, 'test-story-html-5']
			]);
		});

		it('acknowledges only after the HTML write finishes', async () => {
			let finishSave: () => void = () => {};
			const completed = jest.fn();

			saveStoryHtmlMock.mockReturnValue(
				new Promise<void>(resolve => {
					finishSave = resolve;
				})
			);
			expect(handler).not.toBeUndefined();
			const acknowledgement = handler[1]({}, story, 'test-story-html');

			void acknowledgement.then(completed);
			await Promise.resolve();
			expect(completed).not.toHaveBeenCalled();
			finishSave();
			await acknowledgement;
			expect(completed).toHaveBeenCalledTimes(1);
		});

		it('rejects the acknowledgement when the HTML write fails', async () => {
			const error = new Error('HTML save failed');

			saveStoryHtmlMock.mockRejectedValueOnce(error);
			await expect(handler[1]({}, story, 'test-story-html')).rejects.toBe(
				error
			);
		});

		it('rejects if asked to save an empty string', async () => {
			expect(handler).not.toBeUndefined();
			await expect(handler[1]({}, story, '')).rejects.toBeInstanceOf(Error);
			expect(saveStoryHtmlMock).not.toHaveBeenCalled();
		});

		it('rejects if asked to save a non-string', async () => {
			expect(handler).not.toBeUndefined();
			await expect(handler[1]({}, story, null)).rejects.toBeInstanceOf(Error);
			expect(saveStoryHtmlMock).not.toHaveBeenCalled();
			await expect(handler[1]({}, story, undefined)).rejects.toBeInstanceOf(
				Error
			);
			expect(saveStoryHtmlMock).not.toHaveBeenCalled();
			await expect(handler[1]({}, story, false)).rejects.toBeInstanceOf(Error);
			expect(saveStoryHtmlMock).not.toHaveBeenCalled();
			await expect(
				handler[1]({}, story, Promise.resolve('some html'))
			).rejects.toBeInstanceOf(Error);
			expect(saveStoryHtmlMock).not.toHaveBeenCalled();
		});
	});

	describe('the handler it adds to the app before-quit event', () => {
		let beforeQuitHandler: (...args: any[]) => void;
		let saveHandler: any[];
		let quitListeners: any[];
		let story: Story;
		let story2: Story;

		beforeEach(() => {
			jest.useFakeTimers();
			jest.spyOn(console, 'log').mockReturnValue();
			quitListeners = appOnMock.mock.calls.find(
				call => call[0] === 'before-quit'
			);
			beforeQuitHandler = quitListeners[1];
			saveHandler = handleMock.mock.calls.find(
				call => call[0] === 'save-story-html'
			);
			story = fakeStory();
			story2 = fakeStory();
		});

		afterEach(() => {
			jest.clearAllTimers();
			jest.useRealTimers();
		});

		it('prevents quit, flushes pending saves, and explicitly resumes quit', async () => {
			const preventDefault = jest.fn();
			const first = saveHandler[1]({}, story, 'test-story-html-1');
			const trailing = saveHandler[1]({}, story, 'test-story-html-2');
			const other = saveHandler[1]({}, story2, 'test-story-html-3');

			// Leading calls.

			expect(saveStoryHtmlMock.mock.calls).toEqual([
				[story, 'test-story-html-1'],
				[story2, 'test-story-html-3']
			]);
			saveStoryHtmlMock.mockClear();
			beforeQuitHandler({preventDefault});

			// Event emitters do not await listeners, so cancellation must happen
			// synchronously and the barrier must resume quit itself.

			expect(preventDefault).toHaveBeenCalledTimes(1);
			expect(appQuitMock).not.toHaveBeenCalled();
			await Promise.all([first, trailing, other]);
			for (let index = 0; index < 10; index++) {
				await Promise.resolve();
			}
			expect(saveStoryHtmlMock.mock.calls).toEqual([
				[story, 'test-story-html-2']
			]);
			expect(appQuitMock).toHaveBeenCalledTimes(1);
		});

		it('uses a single flush barrier when quit is requested repeatedly', async () => {
			let finishSave: () => void = () => {};
			const save = new Promise<void>(resolve => {
				finishSave = resolve;
			});
			const firstEvent = {preventDefault: jest.fn()};
			const secondEvent = {preventDefault: jest.fn()};

			saveStoryHtmlMock.mockReturnValue(save);
			const acknowledgement = saveHandler[1]({}, story, 'test-story-html');

			beforeQuitHandler(firstEvent);
			beforeQuitHandler(secondEvent);
			expect(firstEvent.preventDefault).toHaveBeenCalledTimes(1);
			expect(secondEvent.preventDefault).toHaveBeenCalledTimes(1);
			expect(appQuitMock).not.toHaveBeenCalled();
			finishSave();
			await acknowledgement;
			for (let index = 0; index < 10; index++) {
				await Promise.resolve();
			}
			expect(appQuitMock).toHaveBeenCalledTimes(1);
		});

		it.each(['delete-story', 'rename-story'])(
			'waits for an acknowledged %s operation before resuming quit',
			async channel => {
				let finishWrite: () => void = () => {};
				const write = new Promise<void>(resolve => {
					finishWrite = resolve;
				});
				const preventDefault = jest.fn();
				const handler = handleMock.mock.calls.find(call => call[0] === channel);
				const renamed = {...story, name: 'Renamed'};

				if (channel === 'delete-story') {
					deleteStoryMock.mockReturnValueOnce(write);
				} else {
					renameStoryMock.mockReturnValueOnce(write);
				}
				const acknowledgement =
					channel === 'delete-story'
						? handler[1]({}, story)
						: handler[1]({}, story, renamed);

				beforeQuitHandler({preventDefault});
				expect(preventDefault).toHaveBeenCalledTimes(1);
				expect(appQuitMock).not.toHaveBeenCalled();
				finishWrite();
				await acknowledgement;
				for (let index = 0; index < 10; index++) {
					await Promise.resolve();
				}
				expect(appQuitMock).toHaveBeenCalledTimes(1);
			}
		);

		it('waits for renderer-reserved work that reaches main after quit begins', async () => {
			const beginReservation = onMock.mock.calls.find(
				call => call[0] === 'begin-legacy-story-write'
			);
			const finishReservation = onMock.mock.calls.find(
				call => call[0] === 'finish-legacy-story-write'
			);
			const sender = {id: 7, once: jest.fn()};
			const beginEvent = {sender};
			const preventDefault = jest.fn();

			beginReservation[1](beginEvent, 'reservation-1', story.id);
			expect(beginEvent).toEqual(expect.objectContaining({returnValue: true}));
			beforeQuitHandler({preventDefault});
			expect(preventDefault).toHaveBeenCalledTimes(1);
			expect(appQuitMock).not.toHaveBeenCalled();

			await saveHandler[1]({}, story, 'reserved story html');
			finishReservation[1]({sender}, 'reservation-1');
			for (let index = 0; index < 10; index++) {
				await Promise.resolve();
			}
			expect(saveStoryHtmlMock).toHaveBeenCalledWith(
				story,
				'reserved story html'
			);
			expect(appQuitMock).toHaveBeenCalledTimes(1);
		});

		it('keeps the app open when renderer-reserved work fails during quit', async () => {
			const beginReservation = onMock.mock.calls.find(
				call => call[0] === 'begin-legacy-story-write'
			);
			const finishReservation = onMock.mock.calls.find(
				call => call[0] === 'finish-legacy-story-write'
			);
			const sender = {id: 7, once: jest.fn()};
			const preventDefault = jest.fn();

			jest.spyOn(console, 'error').mockReturnValue();
			beginReservation[1]({sender}, 'reservation-1', story.id);
			beforeQuitHandler({preventDefault});
			finishReservation[1]({sender}, 'reservation-1', 'renderer save failed');
			for (let index = 0; index < 10; index++) {
				await Promise.resolve();
			}
			expect(preventDefault).toHaveBeenCalledTimes(1);
			expect(appQuitMock).not.toHaveBeenCalled();
			expect(showErrorBoxMock).toHaveBeenCalledWith(
				'electron.errors.storySave',
				'renderer save failed'
			);
		});

		it('treats an empty renderer error message as a failed reservation', async () => {
			const beginReservation = onMock.mock.calls.find(
				call => call[0] === 'begin-legacy-story-write'
			);
			const finishReservation = onMock.mock.calls.find(
				call => call[0] === 'finish-legacy-story-write'
			);
			const sender = {id: 7, once: jest.fn()};

			jest.spyOn(console, 'error').mockReturnValue();
			beginReservation[1]({sender}, 'reservation-1', story.id);
			beforeQuitHandler({preventDefault: jest.fn()});
			finishReservation[1]({sender}, 'reservation-1', '');
			for (let index = 0; index < 10; index++) {
				await Promise.resolve();
			}
			expect(appQuitMock).not.toHaveBeenCalled();
			expect(showErrorBoxMock).toHaveBeenCalledWith(
				'electron.errors.storySave',
				''
			);
		});

		it.each([
			[
				'render-process-gone',
				(listener: (...args: any[]) => void) => listener(),
				'renderer process stopped'
			],
			[
				'did-start-navigation',
				(listener: (...args: any[]) => void) =>
					listener({isMainFrame: true, isSameDocument: false}),
				'renderer page was replaced'
			]
		])(
			'fails renderer reservations on %s so quit cannot hang',
			async (channel, emit, expectedMessage) => {
				const beginReservation = onMock.mock.calls.find(
					call => call[0] === 'begin-legacy-story-write'
				);
				const sender = {id: 7, on: jest.fn(), once: jest.fn()};

				jest.spyOn(console, 'error').mockReturnValue();
				beginReservation[1]({sender}, 'reservation-1', story.id);
				beforeQuitHandler({preventDefault: jest.fn()});
				const cleanup = sender.on.mock.calls.find(
					call => call[0] === channel
				)?.[1];

				emit(cleanup);
				for (let index = 0; index < 10; index++) {
					await Promise.resolve();
				}
				expect(appQuitMock).not.toHaveBeenCalled();
				expect(showErrorBoxMock).toHaveBeenCalledWith(
					'electron.errors.storySave',
					expect.stringContaining(expectedMessage)
				);
			}
		);

		it('keeps reservations across same-document renderer navigation', async () => {
			const beginReservation = onMock.mock.calls.find(
				call => call[0] === 'begin-legacy-story-write'
			);
			const finishReservation = onMock.mock.calls.find(
				call => call[0] === 'finish-legacy-story-write'
			);
			const sender = {id: 7, on: jest.fn(), once: jest.fn()};

			beginReservation[1]({sender}, 'reservation-1', story.id);
			beforeQuitHandler({preventDefault: jest.fn()});
			const navigation = sender.on.mock.calls.find(
				call => call[0] === 'did-start-navigation'
			)?.[1];

			navigation({isMainFrame: true, isSameDocument: true});
			for (let index = 0; index < 5; index++) {
				await Promise.resolve();
			}
			expect(appQuitMock).not.toHaveBeenCalled();
			finishReservation[1]({sender}, 'reservation-1');
			for (let index = 0; index < 10; index++) {
				await Promise.resolve();
			}
			expect(appQuitMock).toHaveBeenCalledTimes(1);
		});

		it('keeps the app open and reports a flush failure', async () => {
			const error = new Error('disk full');
			const preventDefault = jest.fn();

			jest.spyOn(console, 'error').mockReturnValue();
			saveStoryHtmlMock.mockRejectedValueOnce(error);
			const acknowledgement = saveHandler[1]({}, story, 'test-story-html');

			beforeQuitHandler({preventDefault});
			await expect(acknowledgement).rejects.toBe(error);
			for (let index = 0; index < 10; index++) {
				await Promise.resolve();
			}
			expect(preventDefault).toHaveBeenCalledTimes(1);
			expect(appQuitMock).not.toHaveBeenCalled();
			expect(showErrorBoxMock).toHaveBeenCalledWith(
				'electron.errors.storySave',
				'disk full'
			);
		});
	});
});
