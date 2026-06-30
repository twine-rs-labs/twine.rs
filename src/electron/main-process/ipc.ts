import {app, clipboard, dialog, ipcMain, shell} from 'electron';
import debounce from 'lodash/debounce';
import type {DebouncedFunc} from 'lodash';
import {consumeCommandLineOpenPaths} from './command-line';
import {i18n} from './locales';
import {saveJsonFile} from './json-file';
import {
	deleteStory,
	loadStories,
	renameStory,
	saveStoryHtml
} from './story-file';
import {addLocalStoryFormat, loadStoryFormats} from './story-formats';
import {loadPrefs} from './prefs';
import {openWithScratchFile, openWithScratchPackage} from './scratch-file';
import {Story} from '../../store/stories/stories.types';
import {
	backupStoryDirectory,
	chooseStoryDirectoryPath,
	getBackupDirectoryPath,
	getStoryDirectoryPath,
	revealBackupDirectory,
	revealStoryDirectory,
	resetStoryDirectoryPath
} from './story-directory';
import {
	nativeAppPlatformSettings,
	updateNativeAppPlatformSettings
} from './platform-settings';
import {
	chooseAssetFile,
	applyProjectAssetEffect,
	cleanupStaleProjectAssetEffects,
	copyProjectImportAssets,
	copyAssetToProject,
	createProjectFolder,
	deleteProjectAsset,
	discardProjectAssetEffect,
	deleteProjectFolder,
	discardProjectImport,
	hydrateProjectFolder,
	listProjectAssets,
	openProjectFolder,
	prepareProjectImport,
	projectSessionSnapshot,
	renameProjectAsset,
	replaceProjectAsset,
	resolveProjectSessionConflicts,
	saveProjectFolder,
	startProjectSession,
	stopProjectSession,
	unsubscribeProjectSession
} from './project-folder';
import type {
	NativeCommandLineOpenResult,
	NativePlatformSettingsUpdate
} from '../shared';

function nativePlatformSettings() {
	return {
		...nativeAppPlatformSettings(),
		backupFolderPath: getBackupDirectoryPath(),
		storyLibraryFolderPath: getStoryDirectoryPath()
	};
}

export function initIpc() {
	void Promise.resolve(cleanupStaleProjectAssetEffects()).catch(error => {
		console.warn(`Could not clean stale asset journals: ${error}`);
	});

	// We want to debounce story saves so we aren't constantly writing to disk.
	// However, we need to have individual debounced functions per story so that
	// saves on multiple stories in one interval aren't lost. So we maintain a set
	// of debounced functions keyed by story ID.
	//
	// These still take an argument because the individual invocations will see a
	// different story object each time.

	const storySavers: Record<
		string,
		DebouncedFunc<
			(event: any, story: Story, storyHtml: string) => Promise<void>
		>
	> = {};
	const projectSessionSubscriptions = new Map<string, () => void>();

	function projectSessionSubscriptionKey(senderId: number, rootPath: string) {
		return `${senderId}:${rootPath}`;
	}

	function stopProjectSessionSubscription(senderId: number, rootPath: string) {
		const key = projectSessionSubscriptionKey(senderId, rootPath);
		const hadSubscription = projectSessionSubscriptions.has(key);

		projectSessionSubscriptions.get(key)?.();
		projectSessionSubscriptions.delete(key);
		return hadSubscription;
	}

	ipcMain.on('copy-text', (_event, text: string) => {
		if (typeof text === 'string') {
			clipboard.writeText(text);
		}
	});

	ipcMain.handle('choose-asset-file', async (_event, defaultPath?: string) =>
		chooseAssetFile(defaultPath)
	);

	ipcMain.handle(
		'copy-asset-to-project',
		async (_event, rootPath: string, sourcePath: string) =>
			copyAssetToProject(rootPath, sourcePath)
	);

	ipcMain.handle(
		'copy-project-import-assets',
		async (_event, importId: string, rootPath: string) =>
			copyProjectImportAssets(importId, rootPath)
	);

	ipcMain.handle('discard-project-import', async (_event, importId: string) =>
		discardProjectImport(importId)
	);

	ipcMain.handle('list-project-assets', async (_event, rootPath: string) =>
		listProjectAssets(rootPath)
	);

	ipcMain.handle('prepare-project-import', async (_event, sourcePath: string) =>
		prepareProjectImport(sourcePath)
	);

	ipcMain.handle(
		'project-session-snapshot',
		async (_event, rootPath: string, storyIds?: string[]) =>
			projectSessionSnapshot(rootPath, storyIds)
	);

	ipcMain.handle(
		'start-project-session',
		async (event, rootPath: string, storyIds?: string[]) => {
			stopProjectSessionSubscription(event.sender.id, rootPath);

			const listener = (
				snapshot: Awaited<ReturnType<typeof projectSessionSnapshot>>
			) => {
				if (!event.sender.isDestroyed()) {
					event.sender.send('project-session-changed', snapshot);
				}
			};
			const subscriptionKey = projectSessionSubscriptionKey(
				event.sender.id,
				rootPath
			);
			const cleanup = () => {
				unsubscribeProjectSession(rootPath, listener);
				projectSessionSubscriptions.delete(subscriptionKey);
			};

			projectSessionSubscriptions.set(subscriptionKey, cleanup);
			event.sender.once('destroyed', cleanup);

			return startProjectSession(rootPath, listener, storyIds);
		}
	);

	ipcMain.handle('stop-project-session', async (event, rootPath: string) => {
		if (!stopProjectSessionSubscription(event.sender.id, rootPath)) {
			stopProjectSession(rootPath);
		}
	});

	ipcMain.handle(
		'resolve-project-session-conflicts',
		async (
			_event,
			rootPath: string,
			resolution: Parameters<typeof resolveProjectSessionConflicts>[1],
			stories?: Story[]
		) => resolveProjectSessionConflicts(rootPath, resolution, stories)
	);

	ipcMain.handle(
		'rename-project-asset',
		async (_event, rootPath: string, oldPath: string, newPath: string) =>
			renameProjectAsset(rootPath, oldPath, newPath)
	);

	ipcMain.handle(
		'replace-project-asset',
		async (_event, rootPath: string, path: string, sourcePath: string) =>
			replaceProjectAsset(rootPath, path, sourcePath)
	);

	ipcMain.handle(
		'delete-project-asset',
		async (_event, rootPath: string, path: string) =>
			deleteProjectAsset(rootPath, path)
	);

	ipcMain.handle(
		'apply-project-asset-effect',
		async (_event, effectToken: string, direction: 'redo' | 'undo') =>
			applyProjectAssetEffect(effectToken, direction)
	);

	ipcMain.handle(
		'discard-project-asset-effect',
		async (_event, effectToken: string) =>
			discardProjectAssetEffect(effectToken)
	);

	ipcMain.handle('delete-project-folder', async (_event, rootPath: string) =>
		deleteProjectFolder(rootPath)
	);

	ipcMain.handle('choose-story-library-folder', async () => {
		return (await chooseStoryDirectoryPath()) ?? getStoryDirectoryPath();
	});

	ipcMain.handle('reset-story-library-folder', async () => {
		return resetStoryDirectoryPath();
	});

	ipcMain.handle('consume-command-line-open-requests', async () => {
		const openedProjects: NativeCommandLineOpenResult['openedProjects'] = [];
		const unsupportedPaths: NativeCommandLineOpenResult['unsupportedPaths'] =
			[];
		const errors: NativeCommandLineOpenResult['errors'] = [];

		for (const path of consumeCommandLineOpenPaths()) {
			try {
				const result = await openProjectFolder(path, {
					loadPassageText: false
				});

				if (result) {
					openedProjects.push(result);
				}
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'ENOTDIR') {
					unsupportedPaths.push(path);
				} else {
					errors.push({path, message: (error as Error).message});
				}
			}
		}

		return {errors, openedProjects, unsupportedPaths};
	});

	ipcMain.handle('get-platform-settings', async () => nativePlatformSettings());

	ipcMain.handle(
		'update-platform-settings',
		async (_event, settings: NativePlatformSettingsUpdate) => {
			await updateNativeAppPlatformSettings(settings);
			return nativePlatformSettings();
		}
	);

	ipcMain.handle('run-story-library-backup', async () => {
		const result = await backupStoryDirectory();

		await updateNativeAppPlatformSettings({
			backupLastReviewedTime: Date.now()
		});

		return result;
	});

	ipcMain.handle(
		'create-project-folder',
		async (_event, story: Story, preferredParent?: string) =>
			createProjectFolder(story, preferredParent)
	);

	ipcMain.handle('get-story-library-folder', async () =>
		getStoryDirectoryPath()
	);

	ipcMain.handle(
		'open-project-folder',
		async (_event, options?: Parameters<typeof openProjectFolder>[1]) =>
			openProjectFolder(undefined, options)
	);

	ipcMain.handle(
		'hydrate-project-folder',
		async (_event, rootPath: string, storyIds?: string[]) =>
			hydrateProjectFolder(rootPath, storyIds)
	);

	ipcMain.handle(
		'save-project-folder',
		async (_event, rootPath: string, story: Story) =>
			saveProjectFolder(rootPath, story)
	);

	ipcMain.handle('reveal-story-library-folder', async () => {
		await revealStoryDirectory();
	});

	ipcMain.handle('reveal-backup-folder', async () => {
		await revealBackupDirectory();
	});

	ipcMain.on('delete-story', async (event, story) => {
		try {
			await deleteStory(story);
			event.sender.send('story-deleted', story);
		} catch (error) {
			dialog.showErrorBox(
				i18n.t('electron.errors.storyDelete'),
				(error as Error).message
			);
			throw error;
		}
	});

	// These use handle() so that they can return data to the renderer process.

	ipcMain.handle('load-prefs', async () => {
		try {
			return await loadPrefs();
		} catch (error) {
			console.warn(`Could not load prefs, returning empty object: ${error}`);
			return {};
		}
	});

	ipcMain.handle('load-stories', async () => {
		try {
			return await loadStories();
		} catch (error) {
			console.warn(`Could not load stories, returning empty array: ${error}`);
			return [];
		}
	});

	ipcMain.handle('load-story-formats', async () => {
		try {
			return await loadStoryFormats();
		} catch (error) {
			console.warn(
				`Could not load story formats, returning empty array: ${error}`
			);
			return [];
		}
	});

	ipcMain.handle('add-local-story-format', async () => addLocalStoryFormat());

	ipcMain.on(
		'open-with-scratch-file',
		(event, data: string, filename: string) => {
			openWithScratchFile(data, filename);
		}
	);

	ipcMain.on(
		'open-with-scratch-package',
		(event, data: string, filename: string, assets = []) => {
			openWithScratchPackage(data, filename, assets);
		}
	);

	ipcMain.on('reveal-path', (_event, path: string) => {
		if (typeof path === 'string' && path.trim() !== '') {
			shell.showItemInFolder(path);
		}
	});

	// This doesn't use handle() because state reducers in the renderer process
	// can't be be asynchronous--we have to send a signal back.

	ipcMain.on('rename-story', async (event, oldStory, newStory) => {
		try {
			await renameStory(oldStory, newStory);
			event.sender.send('story-renamed', oldStory, newStory);
		} catch (error) {
			dialog.showErrorBox(
				i18n.t('electron.errors.storyRename'),
				(error as Error).message
			);
			throw error;
		}
	});

	ipcMain.on('save-json', async (event, filename: string, data: any) => {
		try {
			await saveJsonFile(filename, data);
		} catch (error) {
			dialog.showErrorBox(
				i18n.t('electron.errors.jsonSave'),
				(error as Error).message
			);
			throw error;
		}
	});

	ipcMain.on('save-story-html', async (event, story, storyHtml) => {
		try {
			if (typeof storyHtml !== 'string') {
				throw new Error('Asked to save non-string as story HTML');
			}

			if (storyHtml.trim() === '') {
				throw new Error('Asked to save empty string as story HTML');
			}

			if (!storySavers[story.id]) {
				storySavers[story.id] = debounce(
					async (
						saverEvent: any,
						saverStory: Story,
						saverStoryHtml: string
					) => {
						try {
							await saveStoryHtml(saverStory, saverStoryHtml);
							saverEvent.sender.send('story-html-saved', saverStory);
						} catch (error) {
							dialog.showErrorBox(
								i18n.t('electron.errors.storySave'),
								(error as Error).message
							);
							throw error;
						}
					},
					1000,
					{leading: true, trailing: true}
				);
			}

			storySavers[story.id](event, story, storyHtml);
		} catch (error) {
			dialog.showErrorBox(
				i18n.t('electron.errors.storySave'),
				(error as Error).message
			);
			throw error;
		}
	});

	app.on('will-quit', async () => {
		if (Object.keys(storySavers).length > 0) {
			// Flush all pending story saves.

			for (const storyId of Object.keys(storySavers)) {
				console.log(`Flushing pending story saves for story ID ${storyId}`);
				await storySavers[storyId].flush();
			}

			console.log('All pending story saves flushed successfully');
		} else {
			console.log('No pending story saves to flush');
		}
	});
}
