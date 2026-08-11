import {app, clipboard, dialog, ipcMain, shell} from 'electron';
import {initIpc} from '../ipc';
import {consumeCommandLineOpenPaths} from '../command-line';
import {loadPrefs} from '../prefs';
import {saveJsonFile} from '../json-file';
import {
	beginScratchPreviewShutdown,
	cleanScratchDirectory,
	resumeScratchPreviewsAfterFailedShutdown
} from '../scratch-file';
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
	applyProjectAssetEffect,
	beginProjectFolderDeletion,
	beginProjectReplacement,
	chooseAssetFile,
	cleanupStaleProjectAssetEffects,
	commitProjectFolderDeletion,
	commitProjectReplacements,
	copyProjectImportAssets,
	copyAssetToProject,
	createProjectFolder,
	duplicateProjectFolder,
	deleteProjectAsset,
	discardProjectAssetEffect,
	discardProjectImport,
	hydrateProjectFolder,
	listProjectAssets,
	openProjectFolder,
	prepareProjectImport,
	projectSessionAssetReadBaselines,
	projectSessionPackageAssetReadPlan,
	projectSessionScratchAssets,
	projectSessionSnapshot,
	renameProjectAsset,
	replaceProjectAsset,
	resolveProjectSessionConflicts,
	rollbackProjectFolderDeletion,
	rollbackProjectReplacement,
	saveProjectFolder,
	startProjectSession,
	stopProjectSession
} from '../project-folder';
import {
	nativeProjectAssetEmbeddingAvailable,
	nativeProjectPackageAssetReaderAvailable,
	readNativeProjectAssetPayloads,
	readNativeProjectPackageAssetPayloads,
	readNativeProjectPreviewAssetPayloads
} from '../native';
import {
	grantProjectCapability,
	projectCapabilityField
} from '../project-capabilities';
import {storyPreviewWindowManager} from '../story-preview-window-manager';

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
	const applyProjectAssetEffectMock = applyProjectAssetEffect as jest.Mock;
	const beginProjectFolderDeletionMock =
		beginProjectFolderDeletion as jest.Mock;
	const beginProjectReplacementMock = beginProjectReplacement as jest.Mock;
	const cleanupStaleProjectAssetEffectsMock =
		cleanupStaleProjectAssetEffects as jest.Mock;
	const commitProjectFolderDeletionMock =
		commitProjectFolderDeletion as jest.Mock;
	const commitProjectReplacementsMock = commitProjectReplacements as jest.Mock;
	const copyAssetToProjectMock = copyAssetToProject as jest.Mock;
	const copyProjectImportAssetsMock = copyProjectImportAssets as jest.Mock;
	const chooseStoryDirectoryPathMock = chooseStoryDirectoryPath as jest.Mock;
	const backupStoryDirectoryMock = backupStoryDirectory as jest.Mock;
	const consumeCommandLineOpenPathsMock =
		consumeCommandLineOpenPaths as jest.Mock;
	const createProjectFolderMock = createProjectFolder as jest.Mock;
	const duplicateProjectFolderMock = duplicateProjectFolder as jest.Mock;
	const deleteProjectAssetMock = deleteProjectAsset as jest.Mock;
	const discardProjectAssetEffectMock = discardProjectAssetEffect as jest.Mock;
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
	const projectSessionPackageAssetReadPlanMock =
		projectSessionPackageAssetReadPlan as jest.Mock;
	const projectSessionScratchAssetsMock =
		projectSessionScratchAssets as jest.Mock;
	const renameProjectAssetMock = renameProjectAsset as jest.Mock;
	const replaceProjectAssetMock = replaceProjectAsset as jest.Mock;
	const resolveProjectSessionConflictsMock =
		resolveProjectSessionConflicts as jest.Mock;
	const rollbackProjectFolderDeletionMock =
		rollbackProjectFolderDeletion as jest.Mock;
	const rollbackProjectReplacementMock =
		rollbackProjectReplacement as jest.Mock;
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
	const beginScratchPreviewShutdownMock =
		beginScratchPreviewShutdown as jest.Mock;
	const cleanScratchDirectoryMock = cleanScratchDirectory as jest.Mock;
	const resumeScratchPreviewsAfterFailedShutdownMock =
		resumeScratchPreviewsAfterFailedShutdown as jest.Mock;
	const clipboardWriteTextMock = clipboard.writeText as jest.Mock;
	const renameStoryMock = renameStory as jest.Mock;
	const saveJsonFileMock = saveJsonFile as jest.Mock;
	const saveStoryHtmlMock = saveStoryHtml as jest.Mock;
	const showErrorBoxMock = dialog.showErrorBox as jest.Mock;
	const showItemInFolderMock = shell.showItemInFolder as jest.Mock;
	const nativeProjectAssetEmbeddingAvailableMock =
		nativeProjectAssetEmbeddingAvailable as jest.Mock;
	const nativeProjectPackageAssetReaderAvailableMock =
		nativeProjectPackageAssetReaderAvailable as jest.Mock;
	const readNativeProjectAssetPayloadsMock =
		readNativeProjectAssetPayloads as jest.Mock;
	const readNativeProjectPackageAssetPayloadsMock =
		readNativeProjectPackageAssetPayloads as jest.Mock;
	const readNativeProjectPreviewAssetPayloadsMock =
		readNativeProjectPreviewAssetPayloads as jest.Mock;

	beforeEach(() => {
		clipboardWriteTextMock.mockClear();
		showItemInFolderMock.mockClear();
		chooseAssetFileMock.mockResolvedValue('/mock/asset.png');
		applyProjectAssetEffectMock.mockResolvedValue(undefined);
		beginProjectFolderDeletionMock.mockResolvedValue({
			id: 'deletion-transaction',
			rootPath: '/mock/project'
		});
		beginProjectReplacementMock.mockResolvedValue({
			id: 'replacement-transaction',
			project: {rootPath: '/mock/project', stories: [], storyIds: []}
		});
		cleanupStaleProjectAssetEffectsMock.mockResolvedValue(undefined);
		commitProjectFolderDeletionMock.mockResolvedValue(undefined);
		commitProjectReplacementsMock.mockResolvedValue(undefined);
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
		discardProjectAssetEffectMock.mockResolvedValue(undefined);
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
		projectSessionPackageAssetReadPlanMock.mockResolvedValue({
			baselines: [
				{
					expectedContentDigest: 'a'.repeat(64),
					expectedExists: true,
					expectedModifiedAtMs: 1,
					expectedSizeBytes: 100,
					path: 'assets/asset.png'
				}
			],
			discoveryFailures: [],
			excluded: [],
			generation: 1,
			inventory: [
				{
					modifiedAtMs: 1,
					path: 'assets/asset.png',
					requiredByStaticReference: true,
					sizeBytes: 100
				}
			],
			inventoryFingerprint: 'b'.repeat(64),
			sessionInstanceId: 'session-1'
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
		rollbackProjectFolderDeletionMock.mockResolvedValue(undefined);
		rollbackProjectReplacementMock.mockResolvedValue(undefined);
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
		duplicateProjectFolderMock.mockResolvedValue({
			rootPath: '/mock/project-copy',
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
			linkHandlingMode: 'system'
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
			linkHandlingMode: 'system'
		});
		revealBackupDirectoryMock.mockResolvedValue(undefined);
		revealStoryDirectoryMock.mockResolvedValue(undefined);
		resetStoryDirectoryPathMock.mockResolvedValue('/mock/default-library');
		saveStoryHtmlMock.mockResolvedValue(undefined);
		nativeProjectAssetEmbeddingAvailableMock.mockReturnValue(true);
		nativeProjectPackageAssetReaderAvailableMock.mockReturnValue(true);
		readNativeProjectAssetPayloadsMock.mockResolvedValue({
			failures: [],
			payloads: [],
			totalEncodedBytes: 0,
			totalSourceBytes: 0
		});
		readNativeProjectPackageAssetPayloadsMock.mockResolvedValue({
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

	it('accepts renderer readiness only from the authoring webContents', () => {
		const authoringWebContents = {id: 7};
		const ready = jest.fn();

		initIpc({
			authoringWebContents: () => authoringWebContents as any,
			onAuthoringRendererReady: ready
		});
		const listener = onMock.mock.calls
			.filter(call => call[0] === 'persistence-renderer-ready')
			.at(-1)?.[1];

		listener({sender: {id: 8}});
		expect(ready).not.toHaveBeenCalled();
		listener({sender: authoringWebContents});
		expect(ready).toHaveBeenCalledTimes(1);
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
		const duplicateProject = handleMock.mock.calls.find(
			call => call[0] === 'duplicate-project-folder'
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
			removeListener: jest.fn(),
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
		expect(sender7.removeListener).toHaveBeenCalledWith(
			'destroyed',
			sender7.once.mock.calls[0][1]
		);
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
		const replacements = [
			{
				passageIds: story.passages.map(passage => ({
					duplicatePassageId: passage.id,
					sourcePassageId: passage.id
				})),
				sourceStoryId: story.id,
				story
			}
		];

		expect(
			await duplicateProject[1]({}, '/mock/project', replacements)
		).toEqual({
			rootPath: '/mock/project-copy',
			stories: [],
			storyIds: []
		});
		expect(duplicateProjectFolderMock).toHaveBeenCalledWith(
			'/mock/project',
			replacements
		);
		await revealLibrary[1]();
		expect(revealStoryDirectoryMock).toHaveBeenCalled();
	});

	it('reads an exact package inventory with server-owned limits', async () => {
		const startSession = handleMock.mock.calls.find(
			call => call[0] === 'start-project-session'
		);
		const readPackageAssets = handleMock.mock.calls.find(
			call => call[0] === 'read-project-package-asset-payloads'
		);
		const sender = {
			id: 407,
			isDestroyed: () => false,
			once: jest.fn(),
			removeListener: jest.fn(),
			send: jest.fn()
		};
		const capability = (
			grantProjectCapability(
				{sender},
				{rootPath: '/mock/project', stories: [], storyIds: []}
			) as Record<string, unknown>
		)[projectCapabilityField] as string;

		await startSession[1]({sender}, capability, ['mock-story']);
		await expect(
			readPackageAssets[1]({sender}, capability, ['assets/asset.png'])
		).resolves.toEqual({
			batch: {
				appliedLimits: {
					maxAssetFileBytes: 50 * 1024 * 1024,
					maxAssetFileCount: 1000,
					maxAssetTotalBytes: 50 * 1024 * 1024
				},
				excluded: [],
				failures: [],
				inventory: [
					{
						modifiedAtMs: 1,
						path: 'assets/asset.png',
						requiredByStaticReference: true,
						sizeBytes: 100
					}
				],
				payloads: [],
				snapshot: {
					contentFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
					generation: 1,
					inventoryFingerprint: 'b'.repeat(64),
					sessionInstanceId: 'session-1'
				},
				totalEncodedBytes: 0,
				totalSourceBytes: 0
			},
			status: 'success'
		});
		expect(projectSessionPackageAssetReadPlanMock).toHaveBeenCalledTimes(2);
		expect(readNativeProjectPackageAssetPayloadsMock).toHaveBeenCalledWith(
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
			{
				maxAssetFileBytes: 50 * 1024 * 1024,
				maxAssetFileCount: 1000,
				maxAssetTotalBytes: 50 * 1024 * 1024
			}
		);
		await expect(
			readPackageAssets[1]({sender}, capability, ['../outside'])
		).rejects.toThrow('Package asset priority paths are invalid.');
	});

	it('authorizes project replacement and revokes access only after deletion commit', async () => {
		const beginReplacement = handleMock.mock.calls.find(
			call => call[0] === 'begin-project-replacement'
		);
		const commitReplacements = handleMock.mock.calls.find(
			call => call[0] === 'commit-project-replacements'
		);
		const beginDeletion = handleMock.mock.calls.find(
			call => call[0] === 'begin-project-folder-deletion'
		);
		const commitDeletion = handleMock.mock.calls.find(
			call => call[0] === 'commit-project-folder-deletion'
		);
		const rollbackDeletion = handleMock.mock.calls.find(
			call => call[0] === 'rollback-project-folder-deletion'
		);
		const sender = {
			id: 509,
			isDestroyed: () => false,
			once: jest.fn(),
			removeListener: jest.fn(),
			send: jest.fn()
		};
		const event = {sender};
		const capability = (
			grantProjectCapability(event, {
				rootPath: '/mock/project',
				stories: [],
				storyIds: []
			}) as Record<string, unknown>
		)[projectCapabilityField] as string;
		const story = fakeStory(1);
		const replacement = await beginReplacement[1](
			event,
			capability,
			[story],
			'import-1'
		);

		expect(beginProjectReplacementMock).toHaveBeenCalledWith(
			'/mock/project',
			[story],
			'import-1'
		);
		await commitReplacements[1](event, [replacement.id]);
		expect(commitProjectReplacementsMock).toHaveBeenCalledWith([
			'replacement-transaction'
		]);

		const replacementCapability = replacement.project[
			projectCapabilityField
		] as string;
		const staged = await beginDeletion[1](event, replacementCapability);

		await rollbackDeletion[1](event, staged.id);
		expect(rollbackProjectFolderDeletionMock).toHaveBeenCalledWith(
			'deletion-transaction'
		);
		const committed = await beginDeletion[1](event, replacementCapability);

		await commitDeletion[1](event, committed.id);
		expect(commitProjectFolderDeletionMock).toHaveBeenCalledWith(
			'deletion-transaction'
		);
		await expect(
			beginDeletion[1](event, replacementCapability)
		).rejects.toThrow('Unknown or expired project capability');
	});

	it('rejects package bytes if the authoritative inventory changes', async () => {
		const startSession = handleMock.mock.calls.find(
			call => call[0] === 'start-project-session'
		);
		const readPackageAssets = handleMock.mock.calls.find(
			call => call[0] === 'read-project-package-asset-payloads'
		);
		const sender = {
			id: 408,
			isDestroyed: () => false,
			once: jest.fn(),
			removeListener: jest.fn(),
			send: jest.fn()
		};
		const capability = (
			grantProjectCapability(
				{sender},
				{rootPath: '/mock/project', stories: [], storyIds: []}
			) as Record<string, unknown>
		)[projectCapabilityField] as string;
		const originalPlan = await projectSessionPackageAssetReadPlanMock();

		projectSessionPackageAssetReadPlanMock
			.mockResolvedValueOnce(originalPlan)
			.mockResolvedValueOnce({
				...originalPlan,
				inventoryFingerprint: 'c'.repeat(64)
			});
		await startSession[1]({sender}, capability, ['mock-story']);

		await expect(
			readPackageAssets[1]({sender}, capability, ['assets/asset.png'])
		).resolves.toEqual({
			code: 'PACKAGE_ASSET_SNAPSHOT_STALE',
			message: 'Project assets changed while package bytes were read.',
			status: 'error'
		});
	});

	it('binds package payload digests and discovery failures deterministically', async () => {
		const startSession = handleMock.mock.calls.find(
			call => call[0] === 'start-project-session'
		);
		const readPackageAssets = handleMock.mock.calls.find(
			call => call[0] === 'read-project-package-asset-payloads'
		);
		const sender = {
			id: 409,
			isDestroyed: () => false,
			once: jest.fn(),
			removeListener: jest.fn(),
			send: jest.fn()
		};
		const capability = (
			grantProjectCapability(
				{sender},
				{rootPath: '/mock/project', stories: [], storyIds: []}
			) as Record<string, unknown>
		)[projectCapabilityField] as string;
		const plan = await projectSessionPackageAssetReadPlanMock();

		projectSessionPackageAssetReadPlanMock.mockResolvedValue({
			...plan,
			discoveryFailures: [
				{
					message: 'Package asset symbolic link was not followed.',
					path: 'assets/link.bin',
					reason: 'symlink'
				}
			]
		});
		readNativeProjectPackageAssetPayloadsMock.mockResolvedValue({
			failures: [],
			payloads: [
				{
					bytes: Buffer.from('one'),
					encodedSizeBytes: 4,
					mediaType: 'application/octet-stream',
					path: 'assets/asset.png',
					sha256: '1'.repeat(64),
					sizeBytes: 3
				}
			],
			totalEncodedBytes: 4,
			totalSourceBytes: 3
		});
		await startSession[1]({sender}, capability, ['mock-story']);
		const firstResult = await readPackageAssets[1]({sender}, capability, []);
		const secondResult = await readPackageAssets[1]({sender}, capability, []);
		const first = firstResult.batch;
		const second = secondResult.batch;

		expect(first.failures).toEqual([
			{
				message: 'Package asset symbolic link was not followed.',
				path: 'assets/link.bin',
				reason: 'symlink'
			}
		]);
		expect(first.snapshot.contentFingerprint).toMatch(/^[a-f0-9]{64}$/);
		expect(second.snapshot.contentFingerprint).toBe(
			first.snapshot.contentFingerprint
		);

		readNativeProjectPackageAssetPayloadsMock.mockResolvedValueOnce({
			failures: [],
			payloads: [
				{
					bytes: Buffer.from('two'),
					encodedSizeBytes: 4,
					mediaType: 'application/octet-stream',
					path: 'assets/asset.png',
					sha256: '2'.repeat(64),
					sizeBytes: 3
				}
			],
			totalEncodedBytes: 4,
			totalSourceBytes: 3
		});
		const changedResult = await readPackageAssets[1]({sender}, capability, []);
		const changed = changedResult.batch;

		expect(changed.snapshot.contentFingerprint).not.toBe(
			first.snapshot.contentFingerprint
		);
	});

	it('requests a renderer full-save retry when incremental CAS is unavailable', async () => {
		const saveProject = handleMock.mock.calls.find(
			call => call[0] === 'save-project-folder'
		);
		const story = fakeStory();
		const expectedFileBaseline = [
			{
				contentDigest: 'a'.repeat(64),
				fingerprint: '1:12',
				kind: 'passage',
				modifiedAt: '2026-07-29T12:00:00.000Z',
				mtimeMs: 1,
				path: 'passages/story/0001-start.twee',
				sizeBytes: 12
			}
		];
		const error = Object.assign(new Error('hard links unsupported'), {
			code: 'PROJECT_FILE_CAS_UNAVAILABLE',
			expectedFileBaseline
		});

		saveProjectFolderMock.mockRejectedValueOnce(error);

		await expect(
			saveProject[1]({}, '/mock/project', story, {incrementalOnly: true})
		).resolves.toEqual({
			expectedFileBaseline,
			rootPath: '/mock/project',
			saveFallback: 'full-save-required'
		});
	});

	it('binds and rotates asset effect capabilities at the IPC boundary', async () => {
		const copyAsset = handleMock.mock.calls.find(
			call => call[0] === 'copy-asset-to-project'
		);
		const applyEffect = handleMock.mock.calls.find(
			call => call[0] === 'apply-project-asset-effect'
		);
		const discardEffect = handleMock.mock.calls.find(
			call => call[0] === 'discard-project-asset-effect'
		);
		const renewEffects = handleMock.mock.calls.find(
			call => call[0] === 'renew-project-asset-effects'
		);
		const owner = {id: 70, once: jest.fn()};
		const stranger = {id: 71, once: jest.fn()};
		const projectCapability = (
			grantProjectCapability(
				{sender: owner},
				{rootPath: '/mock/project', stories: [], storyIds: []}
			) as Record<string, unknown>
		)[projectCapabilityField] as string;

		copyAssetToProjectMock.mockResolvedValueOnce({
			effectToken: 'private-journal-token',
			sourcePath: '/mock/project/assets/asset.png',
			targetPath: 'assets/asset.png'
		});
		const result = await copyAsset[1](
			{sender: owner},
			projectCapability,
			'/mock/asset.png'
		);

		expect(result.effectToken).toEqual(expect.any(String));
		expect(result.effectToken).not.toBe('private-journal-token');
		await expect(
			applyEffect[1]({sender: stranger}, result.effectToken, 'undo')
		).rejects.toThrow('Unknown or expired');

		const rotatedToken = await applyEffect[1](
			{sender: owner},
			result.effectToken,
			'undo'
		);

		expect(rotatedToken).toEqual(expect.any(String));
		expect(rotatedToken).not.toBe(result.effectToken);
		expect(applyProjectAssetEffectMock).toHaveBeenCalledWith(
			'private-journal-token',
			'undo',
			'/mock/project'
		);
		await expect(
			applyEffect[1]({sender: owner}, result.effectToken, 'undo')
		).rejects.toThrow('Unknown or expired');

		await expect(
			renewEffects[1]({sender: owner}, [rotatedToken])
		).resolves.toEqual([]);
		await discardEffect[1]({sender: owner}, rotatedToken);
		expect(discardProjectAssetEffectMock).toHaveBeenCalledWith(
			'private-journal-token',
			'/mock/project'
		);
	});

	it('reverts an asset mutation completed after its renderer session ends', async () => {
		const copyAsset = handleMock.mock.calls.find(
			call => call[0] === 'copy-asset-to-project'
		);
		const owner = {
			id: 72,
			on: jest.fn(),
			once: jest.fn(),
			removeListener: jest.fn()
		};
		const projectCapability = (
			grantProjectCapability(
				{sender: owner},
				{rootPath: '/mock/project', stories: [], storyIds: []}
			) as Record<string, unknown>
		)[projectCapabilityField] as string;
		let finishCopy!: (result: {
			effectToken: string;
			sourcePath: string;
			targetPath: string;
		}) => void;

		copyAssetToProjectMock.mockReturnValueOnce(
			new Promise(resolveCopy => {
				finishCopy = resolveCopy;
			})
		);
		const copying = copyAsset[1](
			{sender: owner},
			projectCapability,
			'/mock/asset.png'
		);

		await Promise.resolve();
		owner.on.mock.calls.find(call => call[0] === 'did-start-navigation')?.[1]({
			isMainFrame: true,
			isSameDocument: false
		});
		finishCopy({
			effectToken: 'late-private-journal',
			sourcePath: '/mock/project/assets/asset.png',
			targetPath: 'assets/asset.png'
		});

		await expect(copying).rejects.toThrow('mutation was reverted');
		expect(applyProjectAssetEffectMock).toHaveBeenCalledWith(
			'late-private-journal',
			'undo',
			'/mock/project'
		);
		expect(discardProjectAssetEffectMock).toHaveBeenCalledWith(
			'late-private-journal',
			'/mock/project'
		);
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

	it('registers managed preview handlers without legacy preview IPC', () => {
		const channels = handleMock.mock.calls.map(call => call[0]);

		expect(channels).toEqual(
			expect.arrayContaining([
				'story-preview:open',
				'story-preview:replace',
				'story-preview:owner-command-result',
				'story-preview:update-appearance'
			])
		);
		expect(channels).not.toEqual(
			expect.arrayContaining([
				'register-story-preview',
				'release-story-preview',
				'open-with-scratch-file',
				'open-with-scratch-package'
			])
		);
	});

	it('routes validated preview packages through the managed window session', async () => {
		const handler = handleMock.mock.calls.find(
			call => call[0] === 'story-preview:open'
		);
		const assets = [{outputPath: 'assets/cover.png', path: 'assets/cover.png'}];
		const baseline = {
			expectedExists: true,
			expectedModifiedAtMs: 1,
			expectedSizeBytes: 3,
			path: 'assets/cover.png'
		};
		const bytes = new Uint8Array([1, 2, 3]);
		const descriptor = {
			appearance: {
				highContrast: false,
				reducedMotion: false,
				theme: 'light' as const
			},
			bridgeSessionId: 'bridge-session',
			htmlBytes: 17,
			passages: [],
			storyDataCount: 0,
			storyId: 'story',
			storyName: 'Story',
			target: 'play' as const
		};
		const managedDescriptor = {
			...descriptor,
			generation: 1,
			sessionId: 'preview-session'
		};
		const openPreviewMock = jest
			.spyOn(storyPreviewWindowManager, 'open')
			.mockResolvedValueOnce({
				descriptor: managedDescriptor,
				url: 'twine-preview://00000000-0000-4000-8000-000000000000/index.html'
			});

		projectSessionScratchAssetsMock.mockReturnValueOnce(assets);
		projectSessionAssetReadBaselinesMock.mockReturnValueOnce([baseline]);
		readNativeProjectPreviewAssetPayloadsMock.mockResolvedValueOnce({
			failures: [],
			payloads: [
				{
					bytes,
					mediaType: 'image/png',
					path: 'assets/cover.png',
					sizeBytes: 3
				}
			],
			totalEncodedBytes: 4,
			totalSourceBytes: 3
		});

		try {
			await expect(
				handler[1](
					{},
					{
						assets,
						descriptor,
						instrumentedHtml: '<html></html>'
					},
					'/mock/project'
				)
			).resolves.toEqual(managedDescriptor);
			expect(openPreviewMock).toHaveBeenCalledWith(undefined, {
				assets: [
					{
						bytes,
						mediaType: 'image/png',
						outputPath: 'assets/cover.png'
					}
				],
				descriptor,
				html: '<html></html>'
			});
		} finally {
			openPreviewMock.mockRestore();
		}
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

		it('waits for scratch preview cleanup before resuming quit', async () => {
			let finishCleanup: () => void = () => {};
			const cleanup = new Promise<void>(resolve => {
				finishCleanup = resolve;
			});

			cleanScratchDirectoryMock.mockReturnValue(cleanup);
			beforeQuitHandler({preventDefault: jest.fn()});
			for (let index = 0; index < 10; index++) {
				await Promise.resolve();
			}
			expect(beginScratchPreviewShutdownMock).toHaveBeenCalledTimes(1);
			expect(cleanScratchDirectoryMock).toHaveBeenCalledTimes(1);
			expect(appQuitMock).not.toHaveBeenCalled();

			finishCleanup();
			for (let index = 0; index < 10; index++) {
				await Promise.resolve();
			}
			expect(appQuitMock).toHaveBeenCalledTimes(1);
		});

		it('warns and continues quit when scratch cleanup fails', async () => {
			const error = new Error('scratch busy');
			const warn = jest.spyOn(console, 'warn').mockReturnValue();

			cleanScratchDirectoryMock.mockRejectedValueOnce(error);
			beforeQuitHandler({preventDefault: jest.fn()});
			for (let index = 0; index < 10; index++) {
				await Promise.resolve();
			}
			expect(warn).toHaveBeenCalledWith(
				'Could not clean scratch previews before quit.',
				error
			);
			expect(appQuitMock).toHaveBeenCalledTimes(1);
			expect(showErrorBoxMock).not.toHaveBeenCalled();
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

		function rendererQuitHarness() {
			const webContents = {
				isDestroyed: jest.fn(() => false),
				on: jest.fn(),
				once: jest.fn(),
				removeListener: jest.fn(),
				send: jest.fn()
			};

			initIpc({
				authoringRendererEstablished: () => true,
				authoringWebContents: () => webContents as any,
				rendererDrainTimeoutMs: 50
			});
			const handler = appOnMock.mock.calls
				.filter(call => call[0] === 'before-quit')
				.at(-1)?.[1];

			handler({preventDefault: jest.fn()});
			const nonce = webContents.send.mock.calls.find(
				call => call[0] === 'persistence-quit-requested'
			)?.[1];
			const reply = onMock.mock.calls
				.filter(call => call[0] === 'persistence-quit-prepared')
				.at(-1)?.[1];

			return {handler, nonce, reply, webContents};
		}

		it('targets the authoring renderer and ignores stale or foreign replies', async () => {
			const {nonce, reply, webContents} = rendererQuitHarness();

			reply({sender: webContents}, 'stale-nonce');
			reply({sender: {}}, nonce);
			await Promise.resolve();
			expect(appQuitMock).not.toHaveBeenCalled();
			reply({sender: webContents}, nonce);
			reply({sender: webContents}, nonce);
			for (let index = 0; index < 10; index++) {
				await Promise.resolve();
			}
			expect(appQuitMock).toHaveBeenCalledTimes(1);
			expect(onMock).toHaveBeenCalledWith('persistence-quit-prepared', reply);
			expect(webContents.removeListener).toHaveBeenCalledWith(
				'did-navigate',
				expect.any(Function)
			);
		});

		it('flushes work reaching main before the renderer drain reply', async () => {
			let finishSave: () => void = () => {};
			const {nonce, reply, webContents} = rendererQuitHarness();

			saveStoryHtmlMock.mockReturnValueOnce(
				new Promise<void>(resolve => {
					finishSave = resolve;
				})
			);
			const acknowledgement = saveHandler[1]({}, story, 'late story html');
			reply({sender: webContents}, nonce);
			await Promise.resolve();
			expect(appQuitMock).not.toHaveBeenCalled();
			finishSave();
			await acknowledgement;
			for (let index = 0; index < 10; index++) {
				await Promise.resolve();
			}
			expect(cleanScratchDirectoryMock).toHaveBeenCalledTimes(1);
			expect(appQuitMock).toHaveBeenCalledTimes(1);
		});

		it('cancels if the renderer disappears during main flush after preparing', async () => {
			let finishSave: () => void = () => {};
			jest.spyOn(console, 'error').mockReturnValue();
			saveStoryHtmlMock.mockReturnValueOnce(
				new Promise<void>(resolve => {
					finishSave = resolve;
				})
			);
			const acknowledgement = saveHandler[1]({}, story, 'blocked main save');
			const prepared = rendererQuitHarness();
			const rendererGone = prepared.webContents.once.mock.calls.find(
				call => call[0] === 'render-process-gone'
			)?.[1];

			prepared.reply({sender: prepared.webContents}, prepared.nonce);
			await Promise.resolve();
			rendererGone();
			finishSave();
			await acknowledgement;
			for (let index = 0; index < 10; index++) {
				await Promise.resolve();
			}
			expect(appQuitMock).not.toHaveBeenCalled();
			expect(
				resumeScratchPreviewsAfterFailedShutdownMock
			).toHaveBeenCalledTimes(1);
			expect(prepared.webContents.send).toHaveBeenCalledWith(
				'persistence-quit-cancelled',
				prepared.nonce
			);
		});

		it('cancels a failed renderer drain and supports a later quit', async () => {
			jest.spyOn(console, 'error').mockReturnValue();
			const first = rendererQuitHarness();

			first.reply(
				{sender: first.webContents},
				first.nonce,
				'renderer save failed'
			);
			for (let index = 0; index < 10; index++) {
				await Promise.resolve();
			}
			expect(first.webContents.send).toHaveBeenCalledWith(
				'persistence-quit-cancelled',
				first.nonce
			);
			expect(resumeScratchPreviewsAfterFailedShutdownMock).toHaveBeenCalled();
			expect(appQuitMock).not.toHaveBeenCalled();

			first.handler({preventDefault: jest.fn()});
			const laterNonce = first.webContents.send.mock.calls
				.filter(call => call[0] === 'persistence-quit-requested')
				.at(-1)?.[1];
			const laterReply = onMock.mock.calls
				.filter(call => call[0] === 'persistence-quit-prepared')
				.at(-1)?.[1];

			laterReply({sender: first.webContents}, laterNonce);
			for (let index = 0; index < 10; index++) {
				await Promise.resolve();
			}
			expect(appQuitMock).toHaveBeenCalledTimes(1);
		});

		it('resumes failure handling when the cancellation send races destruction', async () => {
			const warn = jest.spyOn(console, 'warn').mockReturnValue();
			jest.spyOn(console, 'error').mockReturnValue();
			const failed = rendererQuitHarness();

			failed.webContents.send.mockImplementation(channel => {
				if (channel === 'persistence-quit-cancelled') {
					throw new Error('webContents destroyed');
				}
			});
			failed.reply({sender: failed.webContents}, failed.nonce, 'save failed');
			for (let index = 0; index < 10; index++) {
				await Promise.resolve();
			}
			expect(warn).toHaveBeenCalledWith(
				'Could not notify the renderer that quit was cancelled.',
				expect.any(Error)
			);
			expect(resumeScratchPreviewsAfterFailedShutdownMock).toHaveBeenCalled();
			expect(showErrorBoxMock).toHaveBeenCalled();
			expect(appQuitMock).not.toHaveBeenCalled();
		});

		it('times out by cancelling rather than forcing quit', async () => {
			jest.spyOn(console, 'error').mockReturnValue();
			const {nonce, webContents} = rendererQuitHarness();

			jest.advanceTimersByTime(50);
			for (let index = 0; index < 10; index++) {
				await Promise.resolve();
			}
			expect(webContents.send).toHaveBeenCalledWith(
				'persistence-quit-cancelled',
				nonce
			);
			expect(appQuitMock).not.toHaveBeenCalled();
		});

		it('keeps non-committed navigation nonfatal but cancels a renderer loss', async () => {
			jest.spyOn(console, 'error').mockReturnValue();
			const {nonce, reply, webContents} = rendererQuitHarness();

			expect(
				webContents.on.mock.calls.some(
					call => call[0] === 'did-start-navigation'
				)
			).toBe(false);
			reply({sender: webContents}, nonce);
			for (let index = 0; index < 10; index++) {
				await Promise.resolve();
			}
			expect(appQuitMock).toHaveBeenCalledTimes(1);

			appQuitMock.mockClear();
			const lost = rendererQuitHarness();
			const rendererGone = lost.webContents.once.mock.calls.find(
				call => call[0] === 'render-process-gone'
			)?.[1];

			rendererGone();
			for (let index = 0; index < 10; index++) {
				await Promise.resolve();
			}
			expect(appQuitMock).not.toHaveBeenCalled();
			expect(resumeScratchPreviewsAfterFailedShutdownMock).toHaveBeenCalled();
		});

		it('cancels a cross-document renderer navigation', async () => {
			jest.spyOn(console, 'error').mockReturnValue();
			const {webContents} = rendererQuitHarness();
			const navigation = webContents.on.mock.calls.find(
				call => call[0] === 'did-navigate'
			)?.[1];

			navigation();
			for (let index = 0; index < 10; index++) {
				await Promise.resolve();
			}
			expect(appQuitMock).not.toHaveBeenCalled();
			expect(resumeScratchPreviewsAfterFailedShutdownMock).toHaveBeenCalled();
			expect(webContents.removeListener).toHaveBeenCalledWith(
				'destroyed',
				expect.any(Function)
			);
		});

		it('distinguishes an established missing renderer from early startup', async () => {
			jest.spyOn(console, 'error').mockReturnValue();
			initIpc({
				authoringRendererEstablished: () => true,
				authoringWebContents: () => undefined
			});
			const establishedHandler = appOnMock.mock.calls
				.filter(call => call[0] === 'before-quit')
				.at(-1)?.[1];

			establishedHandler({preventDefault: jest.fn()});
			for (let index = 0; index < 10; index++) {
				await Promise.resolve();
			}
			expect(appQuitMock).not.toHaveBeenCalled();
			expect(resumeScratchPreviewsAfterFailedShutdownMock).toHaveBeenCalled();
			expect(cleanScratchDirectoryMock).not.toHaveBeenCalled();
		});

		it('keeps the app open after a previously ready renderer disappears', async () => {
			jest.spyOn(console, 'error').mockReturnValue();
			initIpc({
				authoringRendererEstablished: () => false,
				authoringRendererWasEstablished: () => true,
				authoringWebContents: () => undefined
			});
			const disappearedHandler = appOnMock.mock.calls
				.filter(call => call[0] === 'before-quit')
				.at(-1)?.[1];

			disappearedHandler({preventDefault: jest.fn()});
			for (let index = 0; index < 10; index++) {
				await Promise.resolve();
			}
			expect(appQuitMock).not.toHaveBeenCalled();
			expect(resumeScratchPreviewsAfterFailedShutdownMock).toHaveBeenCalled();
			expect(cleanScratchDirectoryMock).not.toHaveBeenCalled();
		});

		it('treats an existing but not-ready renderer as early startup', async () => {
			const webContents = {
				isDestroyed: jest.fn(() => false),
				on: jest.fn(),
				once: jest.fn(),
				removeListener: jest.fn(),
				send: jest.fn()
			};

			initIpc({
				authoringRendererEstablished: () => false,
				authoringWebContents: () => webContents as any
			});
			const earlyHandler = appOnMock.mock.calls
				.filter(call => call[0] === 'before-quit')
				.at(-1)?.[1];

			earlyHandler({preventDefault: jest.fn()});
			for (let index = 0; index < 10; index++) {
				await Promise.resolve();
			}
			expect(webContents.send).not.toHaveBeenCalledWith(
				'persistence-quit-requested',
				expect.anything()
			);
			expect(cleanScratchDirectoryMock).toHaveBeenCalledTimes(1);
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
