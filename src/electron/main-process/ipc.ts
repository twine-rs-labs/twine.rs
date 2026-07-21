import {
	app,
	clipboard,
	dialog,
	ipcMain as electronIpcMain,
	shell
} from 'electron';
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
import {
	addLocalStoryFormat,
	loadStoryFormatProperties,
	loadStoryFormats
} from './story-formats';
import {trustedIpcRegistrar} from './ipc-security';
import {
	grantProjectCapability,
	resolveProjectCapability,
	revokeProjectCapability
} from './project-capabilities';
import {
	registerStoryPreview,
	releaseStoryPreview
} from './story-preview-protocol';
import {loadPrefs} from './prefs';
import {openWithScratchFile, openWithScratchPackage} from './scratch-file';
import {Story, StoryWithDocuments} from '../../store/stories/stories.types';
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
	beginProjectFolderHydration,
	finishProjectFolderHydration,
	hydrateProjectFolder,
	listProjectAssets,
	openProjectFolder,
	prepareProjectImport,
	projectSessionAssetReadBaselines,
	projectSessionMemoryDiagnostics,
	projectSessionSnapshot,
	readProjectFolderHydrationChunk,
	renameProjectAsset,
	replaceProjectAsset,
	resolveProjectSessionConflicts,
	saveProjectFolder,
	startProjectSession,
	stopProjectSession,
	unsubscribeProjectSession
} from './project-folder';
import {
	nativeHydrationMemoryDiagnostics,
	nativeProjectAssetEmbeddingAvailable,
	readNativeProjectAssetPayloads
} from './native';
import type {
	NativeCommandLineOpenResult,
	NativeProjectAssetPayloadLimits,
	NativePlatformSettingsUpdate,
	ProjectSourceLayout
} from '../shared';
import {
	mainPerformanceHarnessSnapshot,
	recordMemoryCheckpoint,
	performanceHarnessEnabled,
	resetMainPerformanceHarness
} from './performance-harness';

const ipcMain = trustedIpcRegistrar(electronIpcMain);

function nativePlatformSettings() {
	return {
		...nativeAppPlatformSettings(),
		backupFolderPath: getBackupDirectoryPath(),
		storyLibraryFolderPath: getStoryDirectoryPath()
	};
}

export function initIpc() {
	if (performanceHarnessEnabled()) {
		ipcMain.handle('performance-harness-snapshot', async () => {
			const processMemory = await process.getProcessMemoryInfo();

			return {
				...mainPerformanceHarnessSnapshot(processMemory),
				owners: {
					nativeHydration: nativeHydrationMemoryDiagnostics(),
					projectSessions: projectSessionMemoryDiagnostics()
				}
			};
		});
		ipcMain.handle('performance-harness-reset', async () =>
			resetMainPerformanceHarness()
		);
		ipcMain.handle(
			'performance-harness-checkpoint',
			async (_event, name: string, renderer: Record<string, number>) => {
				const processMemory = await process.getProcessMemoryInfo();

				recordMemoryCheckpoint(name, renderer, processMemory);
			}
		);
		ipcMain.handle('performance-harness-collect-garbage', async () => {
			global.gc?.();
		});
	}

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
		async (event, capability: string, sourcePath: string) =>
			copyAssetToProject(
				resolveProjectCapability(event, capability),
				sourcePath
			)
	);

	ipcMain.handle(
		'copy-project-import-assets',
		async (event, importId: string, capability: string) =>
			copyProjectImportAssets(
				importId,
				resolveProjectCapability(event, capability)
			)
	);

	ipcMain.handle('discard-project-import', async (_event, importId: string) =>
		discardProjectImport(importId)
	);

	ipcMain.handle('list-project-assets', async (event, capability: string) =>
		listProjectAssets(resolveProjectCapability(event, capability))
	);

	ipcMain.handle('referenced-media-embedding-capability', async () => {
		const available = nativeProjectAssetEmbeddingAvailable();

		return {
			available,
			maxFileBytes: 25 * 1024 * 1024,
			maxFileCount: 25,
			maxTotalEncodedBytes: 25 * 1024 * 1024,
			...(available
				? {}
				: {reason: 'The native project media reader is unavailable.'})
		};
	});

	ipcMain.handle(
		'read-project-asset-payloads',
		async (
			event,
			capability: string,
			paths: string[],
			limits: NativeProjectAssetPayloadLimits
		) => {
			const rootPath = resolveProjectCapability(event, capability);

			if (
				!projectSessionSubscriptions.has(
					projectSessionSubscriptionKey(event.sender.id, rootPath)
				)
			) {
				throw new Error(
					"Referenced media can be read only from the renderer's active project session."
				);
			}
			if (
				!Array.isArray(paths) ||
				paths.length > 25 ||
				paths.some(
					path =>
						typeof path !== 'string' || Buffer.byteLength(path, 'utf8') > 4096
				)
			) {
				throw new Error(
					'Referenced media request exceeds the safe path limits.'
				);
			}
			if (
				!limits ||
				![
					limits.maxFileBytes,
					limits.maxFileCount,
					limits.maxTotalEncodedBytes
				].every(value => Number.isInteger(value) && value >= 0)
			) {
				throw new Error('Referenced media request has invalid limits.');
			}

			return readNativeProjectAssetPayloads(
				rootPath,
				projectSessionAssetReadBaselines(rootPath, paths),
				limits
			);
		}
	);

	ipcMain.handle('prepare-project-import', async (_event, sourcePath: string) =>
		prepareProjectImport(sourcePath)
	);

	ipcMain.handle(
		'project-session-snapshot',
		async (event, capability: string, storyIds?: string[]) =>
			projectSessionSnapshot(
				resolveProjectCapability(event, capability),
				storyIds
			)
	);

	ipcMain.handle(
		'start-project-session',
		async (event, capability: string, storyIds?: string[]) => {
			const rootPath = resolveProjectCapability(event, capability);

			stopProjectSessionSubscription(event.sender.id, rootPath);

			const listener = (
				delta: Parameters<
					NonNullable<Parameters<typeof startProjectSession>[1]>
				>[0]
			) => {
				if (!event.sender.isDestroyed()) {
					event.sender.send('project-session-changed', delta);
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

			try {
				return await startProjectSession(rootPath, listener, storyIds);
			} catch (error) {
				cleanup();
				throw error;
			}
		}
	);

	ipcMain.handle('stop-project-session', async (event, capability: string) => {
		const rootPath = resolveProjectCapability(event, capability);

		if (!stopProjectSessionSubscription(event.sender.id, rootPath)) {
			stopProjectSession(rootPath);
		}
	});

	ipcMain.handle(
		'resolve-project-session-conflicts',
		async (
			event,
			capability: string,
			resolution: Parameters<typeof resolveProjectSessionConflicts>[1],
			stories?: StoryWithDocuments[],
			deltaId?: string
		) => {
			const rootPath = resolveProjectCapability(event, capability);

			return deltaId
				? resolveProjectSessionConflicts(rootPath, resolution, stories, deltaId)
				: resolveProjectSessionConflicts(rootPath, resolution, stories);
		}
	);

	ipcMain.handle(
		'rename-project-asset',
		async (event, capability: string, oldPath: string, newPath: string) =>
			renameProjectAsset(
				resolveProjectCapability(event, capability),
				oldPath,
				newPath
			)
	);

	ipcMain.handle(
		'replace-project-asset',
		async (event, capability: string, path: string, sourcePath: string) =>
			replaceProjectAsset(
				resolveProjectCapability(event, capability),
				path,
				sourcePath
			)
	);

	ipcMain.handle(
		'delete-project-asset',
		async (event, capability: string, path: string) =>
			deleteProjectAsset(resolveProjectCapability(event, capability), path)
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

	ipcMain.handle('delete-project-folder', async (event, capability: string) => {
		const rootPath = resolveProjectCapability(event, capability);
		const result = await deleteProjectFolder(rootPath);

		revokeProjectCapability(event, capability);
		return result;
	});

	ipcMain.handle('choose-story-library-folder', async () => {
		return (await chooseStoryDirectoryPath()) ?? getStoryDirectoryPath();
	});

	ipcMain.handle('reset-story-library-folder', async () => {
		return resetStoryDirectoryPath();
	});

	ipcMain.handle('consume-command-line-open-requests', async event => {
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
					openedProjects.push(grantProjectCapability(event, result));
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
		async (
			event,
			story: StoryWithDocuments,
			preferredParent?: string,
			sourceLayout?: ProjectSourceLayout
		) =>
			grantProjectCapability(
				event,
				await createProjectFolder(story, preferredParent, sourceLayout)
			)
	);

	ipcMain.handle('get-story-library-folder', async () =>
		getStoryDirectoryPath()
	);

	ipcMain.handle(
		'open-project-folder',
		async (event, options?: Parameters<typeof openProjectFolder>[1]) => {
			const project = await openProjectFolder(undefined, options);

			return project ? grantProjectCapability(event, project) : undefined;
		}
	);

	ipcMain.handle(
		'hydrate-project-folder',
		async (event, capability: string, storyIds?: string[]) =>
			grantProjectCapability(
				event,
				await hydrateProjectFolder(
					resolveProjectCapability(event, capability),
					storyIds
				)
			)
	);
	ipcMain.handle(
		'begin-project-folder-hydration',
		async (event, capability: string, storyIds?: string[]) =>
			grantProjectCapability(
				event,
				await beginProjectFolderHydration(
					resolveProjectCapability(event, capability),
					storyIds
				)
			)
	);
	ipcMain.handle(
		'read-project-folder-hydration-chunk',
		async (_event, hydrationId: string, cursor: number, limit?: number) =>
			readProjectFolderHydrationChunk(hydrationId, cursor, limit)
	);
	ipcMain.handle(
		'finish-project-folder-hydration',
		async (_event, hydrationId: string) =>
			finishProjectFolderHydration(hydrationId)
	);

	ipcMain.handle(
		'save-project-folder',
		async (
			event,
			capability: string,
			story: StoryWithDocuments,
			options?: Parameters<typeof saveProjectFolder>[2]
		) =>
			grantProjectCapability(
				event,
				await saveProjectFolder(
					resolveProjectCapability(event, capability),
					story,
					options
				)
			)
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

	ipcMain.handle('load-stories', async event => {
		try {
			return (await loadStories()).map(story =>
				'rootPath' in story ? grantProjectCapability(event, story) : story
			);
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

	ipcMain.handle(
		'load-story-format-properties',
		async (_event, url: string, timeout?: number) =>
			loadStoryFormatProperties(url, timeout)
	);

	ipcMain.handle('register-story-preview', async (_event, html: string) =>
		registerStoryPreview(html)
	);
	ipcMain.handle('release-story-preview', async (_event, url: string) =>
		releaseStoryPreview(url)
	);

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
