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
import {createAssetEffectCapabilityRegistry} from './asset-effect-capabilities';
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
import {loadPrefs} from './prefs';
import {
	beginScratchPreviewShutdown,
	cleanScratchDirectory,
	maxScratchPreviewAssetBytes,
	maxScratchPreviewAssetCount,
	maxScratchPreviewBytes,
	resumeScratchPreviewsAfterFailedShutdown
} from './scratch-file';
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
	projectSessionScratchAssets,
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
	readNativeProjectAssetPayloads,
	readNativeProjectPreviewAssetPayloads
} from './native';
import type {
	NativeCommandLineOpenResult,
	NativeProjectAssetWriteResult,
	NativeProjectAssetPayloadLimits,
	NativePlatformSettingsUpdate,
	NativeStoryPreviewLaunchRequest,
	ProjectSourceLayout
} from '../shared';
import {
	mainPerformanceHarnessSnapshot,
	recordMemoryCheckpoint,
	performanceHarnessEnabled,
	resetMainPerformanceHarness
} from './performance-harness';
import {storyPreviewWindowManager} from './story-preview-window-manager';

const ipcMain = trustedIpcRegistrar(electronIpcMain);
let quitAfterStoryWriteFlush = false;
const maxScratchAssetPathBytes = 4096;

function validateScratchAssetRequests(value: unknown) {
	if (!Array.isArray(value) || value.length > maxScratchPreviewAssetCount) {
		throw new Error('Scratch preview asset request exceeds the safe limit.');
	}

	const assets: Array<{outputPath: string; path: string}> = [];

	for (const asset of value) {
		if (
			!asset ||
			typeof asset !== 'object' ||
			typeof (asset as {outputPath?: unknown}).outputPath !== 'string' ||
			typeof (asset as {path?: unknown}).path !== 'string'
		) {
			throw new Error('Scratch preview asset request is invalid.');
		}
		const {outputPath, path} = asset as {outputPath: string; path: string};

		if (
			[outputPath, path].some(
				value => Buffer.byteLength(value, 'utf8') > maxScratchAssetPathBytes
			)
		) {
			throw new Error('Scratch preview asset path exceeds the safe limit.');
		}
		assets.push({outputPath, path});
	}

	return assets;
}

async function managedStoryPreviewBuild(
	event: Parameters<typeof resolveProjectCapability>[0],
	request: NativeStoryPreviewLaunchRequest,
	capability: string | undefined
) {
	if (
		!request ||
		typeof request !== 'object' ||
		typeof request.instrumentedHtml !== 'string' ||
		Buffer.byteLength(request.instrumentedHtml, 'utf8') >
			maxScratchPreviewBytes ||
		!request.descriptor ||
		typeof request.descriptor !== 'object'
	) {
		throw new Error('Story preview launch request is invalid or too large.');
	}

	const assets = validateScratchAssetRequests(request.assets ?? []);

	if (assets.length === 0) {
		return {
			descriptor: request.descriptor,
			html: request.instrumentedHtml
		};
	}
	if (!capability) {
		throw new Error(
			'Project access is required to copy assets into a story preview.'
		);
	}

	const rootPath = resolveProjectCapability(event, capability);
	const trustedAssets = projectSessionScratchAssets(rootPath, assets);
	const uniquePaths = [...new Set(trustedAssets.map(asset => asset.path))];
	const payloadBatch = await readNativeProjectPreviewAssetPayloads(
		rootPath,
		projectSessionAssetReadBaselines(rootPath, uniquePaths),
		{
			maxFileBytes: maxScratchPreviewAssetBytes,
			maxFileCount: maxScratchPreviewAssetCount,
			maxTotalEncodedBytes: maxScratchPreviewAssetBytes
		}
	);

	if (payloadBatch.failures.length > 0) {
		throw new Error(
			`Story preview assets could not be read safely: ${payloadBatch.failures
				.map(failure => `${failure.path}: ${failure.message}`)
				.join('; ')}`
		);
	}

	const payloads = new Map(
		payloadBatch.payloads.map(payload => [payload.path, payload] as const)
	);

	return {
		assets: trustedAssets.map(asset => {
			const payload = payloads.get(asset.path);

			if (!payload) {
				throw new Error(
					`Story preview asset "${asset.path}" was not returned by the safe reader.`
				);
			}

			return {
				bytes: payload.bytes,
				mediaType: payload.mediaType,
				outputPath: asset.outputPath
			};
		}),
		descriptor: request.descriptor,
		html: request.instrumentedHtml
	};
}

export function storyWritesReadyForQuit() {
	return quitAfterStoryWriteFlush;
}

function nativePlatformSettings() {
	return {
		...nativeAppPlatformSettings(),
		backupFolderPath: getBackupDirectoryPath(),
		storyLibraryFolderPath: getStoryDirectoryPath()
	};
}

export function initIpc() {
	quitAfterStoryWriteFlush = false;
	const assetEffectCapabilities = createAssetEffectCapabilityRegistry({
		cleanup: (journalToken, rootPath) =>
			discardProjectAssetEffect(journalToken, rootPath)
	});
	const grantAssetEffect = async (
		session: ReturnType<typeof assetEffectCapabilities.capture>,
		rootPath: string,
		result: NativeProjectAssetWriteResult | undefined
	): Promise<NativeProjectAssetWriteResult | undefined> => {
		if (!result?.effectToken) {
			return result;
		}
		if (assetEffectCapabilities.isClosed(session)) {
			await applyProjectAssetEffect(result.effectToken, 'undo', rootPath);
			await discardProjectAssetEffect(result.effectToken, rootPath);
			throw new Error(
				'Asset mutation was reverted because its renderer session ended.'
			);
		}

		return {
			...result,
			effectToken: assetEffectCapabilities.grant(
				session,
				result.effectToken,
				rootPath
			)
		};
	};

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
		{
			flush: () => Promise<void>;
			runAfterPendingSaves: (operation: () => Promise<void>) => Promise<void>;
			save: (story: Story, storyHtml: string) => Promise<void>;
		}
	> = {};
	const pendingStoryWriteRequests = new Set<Promise<void>>();
	const storyWriteReservations = new Map<
		string,
		{reject: (error: Error) => void; resolve: () => void; senderId?: number}
	>();
	const reservationSenderCleanupRegistered = new Set<number>();
	let storyWriteFlushBarrier: Promise<void> | undefined;
	const projectSessionSubscriptions = new Map<string, () => void>();

	function trackStoryWriteRequest(request: Promise<void>) {
		const tracked = Promise.resolve(request);

		pendingStoryWriteRequests.add(tracked);
		void tracked.then(
			() => pendingStoryWriteRequests.delete(tracked),
			() => pendingStoryWriteRequests.delete(tracked)
		);
		return tracked;
	}

	function storyWriteReservationKey(token: string, senderId?: number) {
		return `${senderId ?? 'unknown'}:${token}`;
	}

	function finishStoryWriteReservation(
		token: string,
		senderId?: number,
		errorMessage?: string
	) {
		const reservationKey = storyWriteReservationKey(token, senderId);
		const reservation = storyWriteReservations.get(reservationKey);

		if (
			!reservation ||
			(reservation.senderId !== undefined &&
				senderId !== undefined &&
				reservation.senderId !== senderId)
		) {
			return;
		}

		storyWriteReservations.delete(reservationKey);
		if (errorMessage !== undefined) {
			reservation.reject(new Error(errorMessage));
		} else {
			reservation.resolve();
		}
	}

	function failStoryWriteReservationsForSender(
		senderId: number,
		errorMessage: string
	) {
		for (const [pendingKey, pending] of storyWriteReservations) {
			if (pending.senderId === senderId) {
				storyWriteReservations.delete(pendingKey);
				pending.reject(new Error(errorMessage));
			}
		}
	}

	function createStorySaver() {
		interface PendingSave {
			reject: (error: unknown) => void;
			resolve: () => void;
			story: Story;
			storyHtml: string;
		}

		let pendingSaves: PendingSave[] = [];
		let writeBarrier: Promise<void> | undefined;
		const enqueueOperation = (operation: () => Promise<void>) => {
			const result = writeBarrier
				? writeBarrier.catch(() => undefined).then(operation)
				: Promise.resolve(operation());

			writeBarrier = result;
			return result;
		};
		const savePending = async () => {
			const saves = pendingSaves;

			pendingSaves = [];
			if (saves.length === 0) {
				return;
			}

			const latest = saves[saves.length - 1];
			const operation = enqueueOperation(() =>
				saveStoryHtml(latest.story, latest.storyHtml)
			);
			try {
				await operation;
				saves.forEach(save => save.resolve());
			} catch (error) {
				saves.forEach(save => save.reject(error));
			}
		};
		const debouncedSave: DebouncedFunc<() => Promise<void>> = debounce(
			savePending,
			1000,
			{leading: true, trailing: true}
		);

		return {
			async flush() {
				await debouncedSave.flush();
			},
			runAfterPendingSaves(operation: () => Promise<void>) {
				const flushed = Promise.resolve(debouncedSave.flush());

				return enqueueOperation(async () => {
					await flushed;
					await operation();
				});
			},
			save(story: Story, storyHtml: string) {
				return new Promise<void>((resolve, reject) => {
					pendingSaves.push({reject, resolve, story, storyHtml});
					void debouncedSave();
				});
			}
		};
	}

	async function flushPendingStoryWrites() {
		while (pendingStoryWriteRequests.size > 0) {
			const requests = [...pendingStoryWriteRequests];

			await Promise.all(
				Object.values(storySavers).map(storySaver => storySaver.flush())
			);
			await Promise.all(requests);
		}
	}

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

	ipcMain.on('begin-legacy-story-write', (event, token, storyId) => {
		const senderId =
			typeof event.sender?.id === 'number' ? event.sender.id : undefined;
		const reservationKey =
			typeof token === 'string'
				? storyWriteReservationKey(token, senderId)
				: '';

		if (
			typeof token !== 'string' ||
			token === '' ||
			typeof storyId !== 'string' ||
			storyId === '' ||
			storyWriteReservations.has(reservationKey)
		) {
			event.returnValue = false;
			return;
		}

		let rejectReservation: (error: Error) => void = () => {};
		let resolveReservation: () => void = () => {};
		const reservation = new Promise<void>((resolve, reject) => {
			rejectReservation = reject;
			resolveReservation = resolve;
		});

		storyWriteReservations.set(reservationKey, {
			reject: rejectReservation,
			resolve: resolveReservation,
			senderId
		});
		trackStoryWriteRequest(reservation);
		if (
			senderId !== undefined &&
			!reservationSenderCleanupRegistered.has(senderId)
		) {
			reservationSenderCleanupRegistered.add(senderId);
			event.sender?.once?.('destroyed', () => {
				failStoryWriteReservationsForSender(
					senderId,
					'Pending story writes were interrupted because the renderer was destroyed.'
				);
				reservationSenderCleanupRegistered.delete(senderId);
			});
			event.sender?.on?.('render-process-gone', () => {
				failStoryWriteReservationsForSender(
					senderId,
					'Pending story writes were interrupted because the renderer process stopped.'
				);
			});
			event.sender?.on?.(
				'did-start-navigation',
				(navigation: {isMainFrame: boolean; isSameDocument: boolean}) => {
					if (navigation.isMainFrame && !navigation.isSameDocument) {
						failStoryWriteReservationsForSender(
							senderId,
							'Pending story writes were interrupted because the renderer page was replaced.'
						);
					}
				}
			);
		}
		event.returnValue = true;
	});

	ipcMain.on('finish-legacy-story-write', (event, token, errorMessage) => {
		if (typeof token === 'string') {
			finishStoryWriteReservation(
				token,
				event.sender?.id,
				typeof errorMessage === 'string' ? errorMessage : undefined
			);
		}
	});

	ipcMain.handle('choose-asset-file', async (_event, defaultPath?: string) =>
		chooseAssetFile(defaultPath)
	);

	ipcMain.handle(
		'copy-asset-to-project',
		async (event, capability: string, sourcePath: string) => {
			const effectSession = assetEffectCapabilities.capture(event);
			const rootPath = resolveProjectCapability(event, capability);
			const result = await copyAssetToProject(rootPath, sourcePath);

			return await grantAssetEffect(effectSession, rootPath, result);
		}
	);

	ipcMain.handle(
		'copy-project-import-assets',
		async (event, importId: string, capability: string) => {
			const effectSession = assetEffectCapabilities.capture(event);
			const rootPath = resolveProjectCapability(event, capability);
			const results = await copyProjectImportAssets(importId, rootPath);

			return await Promise.all(
				results.map(result => grantAssetEffect(effectSession, rootPath, result))
			);
		}
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
		async (event, capability: string, oldPath: string, newPath: string) => {
			const effectSession = assetEffectCapabilities.capture(event);
			const rootPath = resolveProjectCapability(event, capability);
			const result = await renameProjectAsset(rootPath, oldPath, newPath);

			return await grantAssetEffect(effectSession, rootPath, result);
		}
	);

	ipcMain.handle(
		'replace-project-asset',
		async (event, capability: string, path: string, sourcePath: string) => {
			const effectSession = assetEffectCapabilities.capture(event);
			const rootPath = resolveProjectCapability(event, capability);
			const result = await replaceProjectAsset(rootPath, path, sourcePath);

			return await grantAssetEffect(effectSession, rootPath, result);
		}
	);

	ipcMain.handle(
		'delete-project-asset',
		async (event, capability: string, path: string) => {
			const effectSession = assetEffectCapabilities.capture(event);
			const rootPath = resolveProjectCapability(event, capability);
			const result = await deleteProjectAsset(rootPath, path);

			return await grantAssetEffect(effectSession, rootPath, result);
		}
	);

	ipcMain.handle(
		'apply-project-asset-effect',
		async (event, effectToken: string, direction: 'redo' | 'undo') =>
			assetEffectCapabilities.apply(
				event,
				effectToken,
				direction,
				(journalToken, rootPath, effectDirection) =>
					applyProjectAssetEffect(journalToken, effectDirection, rootPath)
			)
	);

	ipcMain.handle(
		'discard-project-asset-effect',
		async (event, effectToken: string) =>
			assetEffectCapabilities.discard(
				event,
				effectToken,
				(journalToken, rootPath) =>
					discardProjectAssetEffect(journalToken, rootPath)
			)
	);

	ipcMain.handle(
		'renew-project-asset-effects',
		async (event, effectTokens: string[]) =>
			assetEffectCapabilities.renew(event, effectTokens)
	);

	ipcMain.handle('delete-project-folder', async (event, capability: string) => {
		const rootPath = resolveProjectCapability(event, capability);
		const result = await deleteProjectFolder(rootPath);

		assetEffectCapabilities.revokeRoot(event, rootPath);
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

	ipcMain.handle('delete-story', async (_event, story) => {
		const storySaver = storySavers[story.id];
		const deletion = storySaver
			? storySaver.runAfterPendingSaves(() => deleteStory(story))
			: deleteStory(story);

		return trackStoryWriteRequest(deletion);
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

	ipcMain.handle(
		'story-preview:open',
		async (event, request: NativeStoryPreviewLaunchRequest, capability) =>
			(
				await storyPreviewWindowManager.open(
					event.sender,
					await managedStoryPreviewBuild(event, request, capability)
				)
			).descriptor
	);
	ipcMain.handle(
		'story-preview:replace',
		async (
			event,
			sessionId: string,
			expectedGeneration: number,
			request: NativeStoryPreviewLaunchRequest,
			capability
		) =>
			(
				await storyPreviewWindowManager.replace(
					event.sender,
					sessionId,
					expectedGeneration,
					await managedStoryPreviewBuild(event, request, capability)
				)
			).descriptor
	);
	ipcMain.handle(
		'story-preview:owner-command-result',
		async (event, sessionId: string, result) =>
			storyPreviewWindowManager.completeCommand(event.sender, sessionId, result)
	);
	ipcMain.handle('story-preview:update-appearance', async (event, appearance) =>
		storyPreviewWindowManager.updateAppearance(event.sender, appearance)
	);

	ipcMain.handle('add-local-story-format', async () => addLocalStoryFormat());

	ipcMain.on('reveal-path', (_event, path: string) => {
		if (typeof path === 'string' && path.trim() !== '') {
			shell.showItemInFolder(path);
		}
	});

	ipcMain.handle('rename-story', async (_event, oldStory, newStory) => {
		const storySaver = storySavers[oldStory.id];
		const rename = storySaver
			? storySaver.runAfterPendingSaves(() => renameStory(oldStory, newStory))
			: renameStory(oldStory, newStory);

		return trackStoryWriteRequest(rename);
	});

	ipcMain.handle('save-json', async (_event, filename: string, data: any) =>
		saveJsonFile(filename, data)
	);

	ipcMain.handle('save-story-html', async (_event, story, storyHtml) => {
		if (typeof storyHtml !== 'string') {
			throw new Error('Asked to save non-string as story HTML');
		}

		if (storyHtml.trim() === '') {
			throw new Error('Asked to save empty string as story HTML');
		}

		storySavers[story.id] ??= createStorySaver();
		return trackStoryWriteRequest(storySavers[story.id].save(story, storyHtml));
	});

	app.on('before-quit', event => {
		if (quitAfterStoryWriteFlush) {
			return;
		}

		event.preventDefault();
		if (storyWriteFlushBarrier) {
			return;
		}

		beginScratchPreviewShutdown();
		storyWriteFlushBarrier = flushPendingStoryWrites().then(async () => {
			try {
				await cleanScratchDirectory();
			} catch (error) {
				console.warn('Could not clean scratch previews before quit.', error);
			}
		});
		void storyWriteFlushBarrier.then(
			() => {
				quitAfterStoryWriteFlush = true;
				app.quit();
			},
			error => {
				storyWriteFlushBarrier = undefined;
				resumeScratchPreviewsAfterFailedShutdown();
				console.error(
					'Could not flush pending story saves before quit.',
					error
				);
				dialog.showErrorBox(
					i18n.t('electron.errors.storySave'),
					(error as Error).message
				);
			}
		);
	});
}
