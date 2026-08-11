import {
	app,
	clipboard,
	dialog,
	ipcMain as electronIpcMain,
	shell
} from 'electron';
import type {WebContents} from 'electron';
import {createHash, randomUUID} from 'crypto';
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
import {assertTrustedIpcEvent, trustedIpcRegistrar} from './ipc-security';
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
	beginProjectFolderDeletion,
	beginProjectReplacement,
	cleanupStaleProjectAssetEffects,
	commitProjectReplacements,
	commitProjectFolderDeletion,
	copyProjectImportAssets,
	copyAssetToProject,
	createProjectFolder,
	duplicateProjectFolder,
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
	projectSessionPackageAssetReadPlan,
	projectSessionScratchAssets,
	projectSessionMemoryDiagnostics,
	projectSessionSnapshot,
	readProjectFolderHydrationChunk,
	renameProjectAsset,
	replaceProjectAsset,
	resolveProjectSessionConflicts,
	rollbackProjectReplacement,
	rollbackProjectFolderDeletion,
	saveProjectFolder,
	startProjectSession,
	stopProjectSession,
	unsubscribeProjectSession
} from './project-folder';
import {
	nativeHydrationMemoryDiagnostics,
	nativeProjectAssetEmbeddingAvailable,
	nativeProjectPackageAssetReaderAvailable,
	readNativeProjectAssetPayloads,
	readNativeProjectPackageAssetPayloads,
	readNativeProjectPreviewAssetPayloads
} from './native';
import type {
	NativeCommandLineOpenResult,
	NativeProjectAssetWriteResult,
	NativeProjectAssetPayloadLimits,
	NativeProjectPackageAssetPayloadLimits,
	NativeProjectPackageAssetPayloadBatch,
	NativeProjectPackageAssetPayloadIpcResult,
	NativePlatformSettingsUpdate,
	NativeStoryPreviewLaunchRequest,
	ProjectStoryReplacement,
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
const packageAssetPathLimitBytes = 4096;
const packageAssetLimits = {
	maxAssetFileBytes: 50 * 1024 * 1024,
	maxAssetFileCount: 1000,
	maxAssetTotalBytes: 50 * 1024 * 1024
} as const satisfies NativeProjectPackageAssetPayloadLimits;

function validPackageAssetPriorityPath(value: unknown): value is string {
	if (
		typeof value !== 'string' ||
		Buffer.byteLength(value, 'utf8') > packageAssetPathLimitBytes ||
		!value.startsWith('assets/') ||
		value.includes('\\') ||
		value.includes('\0')
	) {
		return false;
	}

	const segments = value.split('/');

	return (
		segments.length > 1 &&
		segments.every(segment => {
			return segment.length > 0 && segment !== '.' && segment !== '..';
		})
	);
}

function bytewisePackageValueCompare(left: string, right: string) {
	return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function packageAssetContentFingerprint(
	inventoryFingerprint: string,
	payloads: NativeProjectPackageAssetPayloadBatch['payloads'],
	failures: NativeProjectPackageAssetPayloadBatch['failures']
) {
	const hash = createHash('sha256');
	const sortedPayloads = [...payloads].sort((left, right) =>
		bytewisePackageValueCompare(left.path, right.path)
	);
	const sortedFailures = [...failures].sort((left, right) =>
		bytewisePackageValueCompare(
			`${left.path}\0${left.reason}\0${left.message}`,
			`${right.path}\0${right.reason}\0${right.message}`
		)
	);

	hash.update('twine-package-asset-content-v1\0');
	hash.update(
		JSON.stringify({
			failures: sortedFailures.map(failure => [
				failure.path,
				failure.reason,
				failure.message
			]),
			inventoryFingerprint,
			payloads: sortedPayloads.map(payload => [payload.path, payload.sha256])
		})
	);

	return hash.digest('hex');
}
const rendererPersistenceDrainTimeoutMs = 10_000;

export interface InitIpcOptions {
	authoringRendererEstablished?: () => boolean;
	authoringRendererWasEstablished?: () => boolean;
	authoringWebContents?: () => WebContents | undefined;
	onAuthoringRendererReady?: () => void;
	rendererDrainTimeoutMs?: number;
}

function cancelRendererPersistenceQuit(
	webContents: WebContents | undefined,
	nonce: string
) {
	try {
		if (webContents && !webContents.isDestroyed()) {
			webContents.send('persistence-quit-cancelled', nonce);
		}
	} catch (error) {
		console.warn(
			'Could not notify the renderer that quit was cancelled.',
			error
		);
	}
}

interface RendererPersistenceLease {
	failure: Promise<never>;
	release(): void;
}

function prepareRendererPersistenceQuit(
	webContents: WebContents,
	nonce: string,
	timeoutMs: number
) {
	return new Promise<RendererPersistenceLease>((resolve, reject) => {
		let prepared = false;
		let released = false;
		let rejectFailure: (error: Error) => void = () => {};
		const failure = new Promise<never>((_resolve, rejectPromise) => {
			rejectFailure = rejectPromise;
		});
		const cleanupReply = () => {
			clearTimeout(timeout);
			electronIpcMain.removeListener('persistence-quit-prepared', reply);
		};
		const cleanupLifecycle = () => {
			webContents.removeListener('destroyed', rendererDestroyed);
			webContents.removeListener('render-process-gone', rendererGone);
			webContents.removeListener('did-navigate', rendererNavigated);
		};
		const release = () => {
			if (released) {
				return;
			}
			released = true;
			cleanupReply();
			cleanupLifecycle();
		};
		const fail = (error: Error) => {
			if (released) {
				return;
			}
			if (prepared) {
				release();
				rejectFailure(error);
			} else {
				release();
				reject(error);
			}
		};
		const reply = (
			event: Electron.IpcMainEvent,
			replyNonce: unknown,
			errorMessage?: unknown
		) => {
			if (event.sender !== webContents || replyNonce !== nonce) {
				return;
			}
			try {
				assertTrustedIpcEvent(event);
			} catch (error) {
				fail(error as Error);
				return;
			}
			if (errorMessage !== undefined && typeof errorMessage !== 'string') {
				fail(new Error('Renderer returned an invalid persistence reply.'));
				return;
			}
			if (typeof errorMessage === 'string') {
				fail(new Error(errorMessage));
				return;
			}
			prepared = true;
			cleanupReply();
			resolve({failure, release});
		};
		const rendererDestroyed = () =>
			fail(new Error('The authoring renderer disappeared during shutdown.'));
		const rendererGone = () =>
			fail(
				new Error('The authoring renderer process stopped during shutdown.')
			);
		const rendererNavigated = () =>
			fail(new Error('The authoring renderer page changed during shutdown.'));
		const timeout = setTimeout(
			() =>
				fail(new Error('Timed out waiting for renderer persistence to drain.')),
			timeoutMs
		);

		electronIpcMain.on('persistence-quit-prepared', reply);
		webContents.once('destroyed', rendererDestroyed);
		webContents.once('render-process-gone', rendererGone);
		webContents.on('did-navigate', rendererNavigated);
		if (webContents.isDestroyed()) {
			fail(new Error('The authoring renderer is unavailable during shutdown.'));
			return;
		}
		try {
			webContents.send('persistence-quit-requested', nonce);
		} catch (error) {
			fail(error as Error);
		}
	});
}

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

export function initIpc(options: InitIpcOptions = {}) {
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
	let storyWriteFlushBarrier: Promise<void> | undefined;
	const projectSessionSubscriptions = new Map<string, () => void>();
	const projectReplacementTransactions = new Map<number, Set<string>>();
	const projectDeletionTransactions = new Map<
		number,
		Map<string, {capability: string; rootPath: string}>
	>();
	const projectSessionSenderCleanups = new Map<
		number,
		{
			destroyed: () => void;
			sender: {
				once(event: 'destroyed', listener: () => void): unknown;
				removeListener?: (event: 'destroyed', listener: () => void) => unknown;
			};
		}
	>();

	function trackStoryWriteRequest(request: Promise<void>) {
		const tracked = Promise.resolve(request);

		pendingStoryWriteRequests.add(tracked);
		void tracked.then(
			() => pendingStoryWriteRequests.delete(tracked),
			() => pendingStoryWriteRequests.delete(tracked)
		);
		return tracked;
	}

	ipcMain.on('persistence-renderer-ready', event => {
		if (event.sender === options.authoringWebContents?.()) {
			options.onAuthoringRendererReady?.();
		}
	});

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

	function senderHasProjectLifecycleResources(senderId: number) {
		const prefix = `${senderId}:`;

		return (
			[...projectSessionSubscriptions.keys()].some(key =>
				key.startsWith(prefix)
			) ||
			(projectReplacementTransactions.get(senderId)?.size ?? 0) > 0 ||
			(projectDeletionTransactions.get(senderId)?.size ?? 0) > 0
		);
	}

	function removeProjectSessionSenderCleanup(senderId: number) {
		const cleanup = projectSessionSenderCleanups.get(senderId);

		cleanup?.sender.removeListener?.('destroyed', cleanup.destroyed);
		projectSessionSenderCleanups.delete(senderId);
	}

	function ensureProjectSessionSenderCleanup(
		senderId: number,
		sender: {
			once(event: 'destroyed', listener: () => void): unknown;
			removeListener?: (event: 'destroyed', listener: () => void) => unknown;
		}
	) {
		if (projectSessionSenderCleanups.has(senderId)) {
			return;
		}

		const destroyed = () => {
			const prefix = `${senderId}:`;

			for (const [key, cleanup] of projectSessionSubscriptions) {
				if (key.startsWith(prefix)) {
					cleanup();
					projectSessionSubscriptions.delete(key);
				}
			}
			for (const transactionId of projectReplacementTransactions.get(
				senderId
			) ?? []) {
				void rollbackProjectReplacement(transactionId).catch(error =>
					console.warn(
						`Could not roll back abandoned project replacement ${transactionId}: ${error}`
					)
				);
			}
			for (const transactionId of (
				projectDeletionTransactions.get(senderId) ?? new Map()
			).keys()) {
				void rollbackProjectFolderDeletion(transactionId).catch(error =>
					console.warn(
						`Could not roll back abandoned project deletion ${transactionId}: ${error}`
					)
				);
			}
			projectReplacementTransactions.delete(senderId);
			projectDeletionTransactions.delete(senderId);
			projectSessionSenderCleanups.delete(senderId);
		};

		projectSessionSenderCleanups.set(senderId, {destroyed, sender});
		sender.once('destroyed', destroyed);
	}

	function stopProjectSessionSubscription(senderId: number, rootPath: string) {
		const key = projectSessionSubscriptionKey(senderId, rootPath);
		const hadSubscription = projectSessionSubscriptions.has(key);

		projectSessionSubscriptions.get(key)?.();
		projectSessionSubscriptions.delete(key);
		if (!senderHasProjectLifecycleResources(senderId)) {
			removeProjectSessionSenderCleanup(senderId);
		}
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

	ipcMain.handle(
		'read-project-package-asset-payloads',
		async (
			event,
			capability: string,
			priorityPaths: string[]
		): Promise<NativeProjectPackageAssetPayloadIpcResult> => {
			try {
				const rootPath = resolveProjectCapability(event, capability);

				if (
					!projectSessionSubscriptions.has(
						projectSessionSubscriptionKey(event.sender.id, rootPath)
					)
				) {
					throw new Error(
						"Package assets can be read only from the renderer's active project session."
					);
				}
				if (
					!Array.isArray(priorityPaths) ||
					priorityPaths.length > packageAssetLimits.maxAssetFileCount ||
					priorityPaths.some(path => !validPackageAssetPriorityPath(path))
				) {
					throw new Error('Package asset priority paths are invalid.');
				}
				if (!nativeProjectPackageAssetReaderAvailable()) {
					throw new Error('The native package asset reader is unavailable.');
				}

				const start = await projectSessionPackageAssetReadPlan(
					rootPath,
					priorityPaths
				);
				const selectedBaselines = start.baselines.slice(
					0,
					packageAssetLimits.maxAssetFileCount
				);
				const deferredFailures = start.baselines
					.slice(packageAssetLimits.maxAssetFileCount)
					.map(baseline => ({
						message: `Asset was not read because the package file-count limit is ${packageAssetLimits.maxAssetFileCount}.`,
						path: baseline.path,
						reason: 'file-count-exceeded'
					}));
				const loaded = await readNativeProjectPackageAssetPayloads(
					rootPath,
					selectedBaselines,
					packageAssetLimits
				);
				const end = await projectSessionPackageAssetReadPlan(
					rootPath,
					priorityPaths
				);

				if (
					start.sessionInstanceId !== end.sessionInstanceId ||
					start.generation !== end.generation ||
					start.inventoryFingerprint !== end.inventoryFingerprint
				) {
					throw Object.assign(
						new Error('Project assets changed while package bytes were read.'),
						{code: 'PACKAGE_ASSET_SNAPSHOT_STALE'}
					);
				}
				const failures = [
					...start.discoveryFailures,
					...loaded.failures,
					...deferredFailures
				].sort((left, right) =>
					bytewisePackageValueCompare(
						`${left.path}\0${left.reason}\0${left.message}`,
						`${right.path}\0${right.reason}\0${right.message}`
					)
				);
				const contentFingerprint = packageAssetContentFingerprint(
					start.inventoryFingerprint,
					loaded.payloads,
					failures
				);

				return {
					batch: {
						...loaded,
						appliedLimits: packageAssetLimits,
						excluded: start.excluded,
						failures,
						inventory: start.inventory,
						snapshot: {
							contentFingerprint,
							generation: start.generation,
							inventoryFingerprint: start.inventoryFingerprint,
							sessionInstanceId: start.sessionInstanceId
						}
					} satisfies NativeProjectPackageAssetPayloadBatch,
					status: 'success'
				};
			} catch (error) {
				if (
					typeof error === 'object' &&
					error !== null &&
					'code' in error &&
					error.code === 'PACKAGE_ASSET_SNAPSHOT_STALE'
				) {
					return {
						code: 'PACKAGE_ASSET_SNAPSHOT_STALE',
						message:
							error instanceof Error
								? error.message
								: 'Project assets changed while package bytes were read.',
						status: 'error'
					};
				}

				throw error;
			}
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
			ensureProjectSessionSenderCleanup(event.sender.id, event.sender);

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

	ipcMain.handle(
		'begin-project-replacement',
		async (
			event,
			capability: string,
			stories: StoryWithDocuments[],
			importId?: string
		) => {
			const transaction = await beginProjectReplacement(
				resolveProjectCapability(event, capability),
				stories,
				importId
			);
			const transactions =
				projectReplacementTransactions.get(event.sender.id) ??
				new Set<string>();

			transactions.add(transaction.id);
			projectReplacementTransactions.set(event.sender.id, transactions);
			ensureProjectSessionSenderCleanup(event.sender.id, event.sender);
			return {
				...transaction,
				project: grantProjectCapability(event, transaction.project)
			};
		}
	);

	ipcMain.handle(
		'commit-project-replacements',
		async (event, transactionIds: string[]) => {
			const transactions = projectReplacementTransactions.get(event.sender.id);

			if (
				transactionIds.length === 0 ||
				transactionIds.some(transactionId => !transactions?.has(transactionId))
			) {
				throw new Error('Unknown or expired project replacement transaction.');
			}
			await commitProjectReplacements(transactionIds);
			for (const transactionId of transactionIds) {
				transactions?.delete(transactionId);
			}
			if (!senderHasProjectLifecycleResources(event.sender.id)) {
				removeProjectSessionSenderCleanup(event.sender.id);
			}
		}
	);

	ipcMain.handle(
		'rollback-project-replacement',
		async (event, transactionId: string) => {
			const transactions = projectReplacementTransactions.get(event.sender.id);

			if (!transactions?.has(transactionId)) {
				throw new Error('Unknown or expired project replacement transaction.');
			}
			await rollbackProjectReplacement(transactionId);
			transactions.delete(transactionId);
			if (!senderHasProjectLifecycleResources(event.sender.id)) {
				removeProjectSessionSenderCleanup(event.sender.id);
			}
		}
	);

	ipcMain.handle(
		'begin-project-folder-deletion',
		async (event, capability: string) => {
			const rootPath = resolveProjectCapability(event, capability);
			const transaction = await beginProjectFolderDeletion(rootPath);
			const transactions =
				projectDeletionTransactions.get(event.sender.id) ?? new Map();

			transactions.set(transaction.id, {capability, rootPath});
			projectDeletionTransactions.set(event.sender.id, transactions);
			ensureProjectSessionSenderCleanup(event.sender.id, event.sender);
			return transaction;
		}
	);

	ipcMain.handle(
		'commit-project-folder-deletion',
		async (event, transactionId: string) => {
			const transactions = projectDeletionTransactions.get(event.sender.id);

			const transaction = transactions?.get(transactionId);

			if (!transaction) {
				throw new Error('Unknown or expired project deletion transaction.');
			}
			await commitProjectFolderDeletion(transactionId);
			assetEffectCapabilities.revokeRoot(event, transaction.rootPath);
			revokeProjectCapability(event, transaction.capability);
			transactions?.delete(transactionId);
			if (!senderHasProjectLifecycleResources(event.sender.id)) {
				removeProjectSessionSenderCleanup(event.sender.id);
			}
		}
	);

	ipcMain.handle(
		'rollback-project-folder-deletion',
		async (event, transactionId: string) => {
			const transactions = projectDeletionTransactions.get(event.sender.id);

			if (!transactions?.has(transactionId)) {
				throw new Error('Unknown or expired project deletion transaction.');
			}
			await rollbackProjectFolderDeletion(transactionId);
			transactions?.delete(transactionId);
			if (!senderHasProjectLifecycleResources(event.sender.id)) {
				removeProjectSessionSenderCleanup(event.sender.id);
			}
		}
	);

	ipcMain.handle(
		'duplicate-project-folder',
		async (
			event,
			capability: string,
			replacements: ProjectStoryReplacement[]
		) =>
			grantProjectCapability(
				event,
				await duplicateProjectFolder(
					resolveProjectCapability(event, capability),
					replacements
				)
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
		) => {
			const rootPath = resolveProjectCapability(event, capability);

			try {
				return grantProjectCapability(
					event,
					await saveProjectFolder(rootPath, story, options)
				);
			} catch (error) {
				const expectedFileBaseline = (
					error as NodeJS.ErrnoException & {
						expectedFileBaseline?: unknown;
					}
				).expectedFileBaseline;

				if (
					options?.incrementalOnly &&
					(error as NodeJS.ErrnoException).code ===
						'PROJECT_FILE_CAS_UNAVAILABLE' &&
					Array.isArray(expectedFileBaseline) &&
					expectedFileBaseline.length > 0
				) {
					return grantProjectCapability(event, {
						expectedFileBaseline,
						rootPath,
						saveFallback: 'full-save-required' as const
					});
				}

				throw error;
			}
		}
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
			return {
				status: 'loaded',
				stories: (await loadStories()).map(story =>
					'rootPath' in story ? grantProjectCapability(event, story) : story
				)
			};
		} catch (error) {
			console.error(`Project library recovery or loading failed: ${error}`);
			return {
				message: error instanceof Error ? error.message : String(error),
				status: 'recovery-required'
			};
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
		const nonce = randomUUID();
		const authoringWebContents = options.authoringWebContents?.();
		const authoringRendererEstablished =
			options.authoringRendererEstablished?.() ?? false;
		const authoringRendererWasEstablished =
			options.authoringRendererWasEstablished?.() ??
			authoringRendererEstablished;
		storyWriteFlushBarrier = (async () => {
			let rendererLease: RendererPersistenceLease | undefined;

			if (authoringRendererEstablished && authoringWebContents) {
				rendererLease = await prepareRendererPersistenceQuit(
					authoringWebContents,
					nonce,
					options.rendererDrainTimeoutMs ?? rendererPersistenceDrainTimeoutMs
				);
			} else if (authoringRendererWasEstablished) {
				throw new Error(
					'The established authoring renderer is unavailable during shutdown.'
				);
			}
			const finishCanonicalWrites = async () => {
				await flushPendingStoryWrites();
				try {
					await cleanScratchDirectory();
				} catch (error) {
					console.warn('Could not clean scratch previews before quit.', error);
				}
			};
			const canonicalWrites = finishCanonicalWrites();

			if (!rendererLease) {
				await canonicalWrites;
				return;
			}
			try {
				await Promise.race([canonicalWrites, rendererLease.failure]);
			} catch (error) {
				await canonicalWrites.catch(() => undefined);
				throw error;
			} finally {
				rendererLease.release();
			}
		})();
		void storyWriteFlushBarrier.then(
			() => {
				quitAfterStoryWriteFlush = true;
				app.quit();
			},
			error => {
				cancelRendererPersistenceQuit(authoringWebContents, nonce);
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
