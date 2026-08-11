// Exposes a limited set of Electron modules to the bundled renderer. Story
// format source is fetched and parsed in the main process and is never loaded
// as a page script in this privileged renderer.

import {contextBridge, ipcRenderer, webUtils} from 'electron';
import {Story, StoryWithDocuments} from '../../store/stories/stories.types';
import type {
	NativeStoryPreviewAppearance,
	NativeStoryPreviewCommandResult,
	NativeStoryPreviewLaunchRequest,
	NativeStoryPreviewOwnerCommand,
	NativeProjectPackageAssetPayloadIpcResult,
	ProjectStoryReplacement,
	ProjectSourceLayout,
	TwineElectronWindow
} from '../shared';

const projectCapabilityField = '__twineProjectCapability';
const projectCapabilities = new Map<string, string>();
const activeAssetEffectCapabilities = new Set<string>();
const activeProjectReplacementTransactions = new Set<string>();
const activeProjectDeletionTransactions = new Map<string, string>();
const assetEffectRenewalIntervalMs = 60 * 60 * 1000;

function rememberProjectCapability<T>(project: T): T {
	if (!project || typeof project !== 'object') {
		return project;
	}

	const value = project as T & {
		rootPath?: unknown;
		[projectCapabilityField]?: unknown;
	};

	if (
		typeof value.rootPath === 'string' &&
		typeof value[projectCapabilityField] === 'string'
	) {
		projectCapabilities.set(value.rootPath, value[projectCapabilityField]);
		delete value[projectCapabilityField];
	}

	return project;
}

function projectCapability(rootPath: string) {
	const capability = projectCapabilities.get(rootPath);

	if (!capability) {
		throw new Error('This project folder was not granted by the main process.');
	}

	return capability;
}

async function invokeProjectResult(channel: string, ...args: unknown[]) {
	return rememberProjectCapability(await ipcRenderer.invoke(channel, ...args));
}

function rememberAssetEffectCapabilities<T>(result: T): T {
	const results = Array.isArray(result) ? result : [result];

	for (const item of results) {
		if (
			item &&
			typeof item === 'object' &&
			typeof (item as {effectToken?: unknown}).effectToken === 'string'
		) {
			activeAssetEffectCapabilities.add(
				(item as {effectToken: string}).effectToken
			);
		}
	}

	return result;
}

async function invokeAssetEffectResult(channel: string, ...args: unknown[]) {
	return rememberAssetEffectCapabilities(
		await ipcRenderer.invoke(channel, ...args)
	);
}

setInterval(() => {
	if (activeAssetEffectCapabilities.size > 0) {
		void ipcRenderer
			.invoke('renew-project-asset-effects', [...activeAssetEffectCapabilities])
			.then((rejectedCapabilities: unknown) => {
				if (Array.isArray(rejectedCapabilities)) {
					for (const capability of rejectedCapabilities) {
						if (typeof capability === 'string') {
							activeAssetEffectCapabilities.delete(capability);
						}
					}
				}
			})
			.catch(() => undefined);
	}
}, assetEffectRenewalIntervalMs);

const bridge = {
	addLocalStoryFormat() {
		return ipcRenderer.invoke('add-local-story-format');
	},
	chooseAssetFile(defaultPath?: string) {
		return ipcRenderer.invoke('choose-asset-file', defaultPath);
	},
	chooseStoryLibraryFolder() {
		return ipcRenderer.invoke('choose-story-library-folder');
	},
	consumeCommandLineOpenRequests() {
		return ipcRenderer
			.invoke('consume-command-line-open-requests')
			.then(result => {
				result.openedProjects = result.openedProjects.map(
					rememberProjectCapability
				);
				return result;
			});
	},
	onCommandLineOpenRequest(callback: () => void) {
		const listener = () => callback();

		ipcRenderer.on('command-line-open-request', listener);

		return () =>
			ipcRenderer.removeListener('command-line-open-request', listener);
	},
	copyText(text: string) {
		ipcRenderer.send('copy-text', text);
	},
	copyAssetToProject(rootPath: string, sourcePath: string) {
		return invokeAssetEffectResult(
			'copy-asset-to-project',
			projectCapability(rootPath),
			sourcePath
		);
	},
	async applyProjectAssetEffect(
		effectToken: string,
		direction: 'redo' | 'undo'
	) {
		const rotatedToken = await ipcRenderer.invoke(
			'apply-project-asset-effect',
			effectToken,
			direction
		);

		activeAssetEffectCapabilities.delete(effectToken);
		activeAssetEffectCapabilities.add(rotatedToken);
		return rotatedToken;
	},
	copyProjectImportAssets(importId: string, rootPath: string) {
		return invokeAssetEffectResult(
			'copy-project-import-assets',
			importId,
			projectCapability(rootPath)
		);
	},
	createProjectFolder(
		story: Story,
		preferredParent?: string,
		sourceLayout?: ProjectSourceLayout
	) {
		return invokeProjectResult(
			'create-project-folder',
			story,
			preferredParent,
			sourceLayout
		);
	},
	async beginProjectReplacement(
		rootPath: string,
		stories: StoryWithDocuments[],
		importId?: string
	) {
		const result = await ipcRenderer.invoke(
			'begin-project-replacement',
			projectCapability(rootPath),
			stories,
			importId
		);

		rememberProjectCapability(result.project);
		activeProjectReplacementTransactions.add(result.id);
		return result;
	},
	async commitProjectReplacements(transactionIds: string[]) {
		if (
			transactionIds.length === 0 ||
			transactionIds.some(
				transactionId =>
					!activeProjectReplacementTransactions.has(transactionId)
			)
		) {
			throw new Error('This project replacement transaction is unavailable.');
		}
		await ipcRenderer.invoke('commit-project-replacements', transactionIds);
		for (const transactionId of transactionIds) {
			activeProjectReplacementTransactions.delete(transactionId);
		}
	},
	async rollbackProjectReplacement(transactionId: string) {
		if (!activeProjectReplacementTransactions.has(transactionId)) {
			throw new Error('This project replacement transaction is unavailable.');
		}
		await ipcRenderer.invoke('rollback-project-replacement', transactionId);
		activeProjectReplacementTransactions.delete(transactionId);
	},
	async beginProjectFolderDeletion(rootPath: string) {
		const result = await ipcRenderer.invoke(
			'begin-project-folder-deletion',
			projectCapability(rootPath)
		);

		activeProjectDeletionTransactions.set(result.id, result.rootPath);
		return result;
	},
	async commitProjectFolderDeletion(transactionId: string) {
		const rootPath = activeProjectDeletionTransactions.get(transactionId);

		if (!rootPath) {
			throw new Error('This project deletion transaction is unavailable.');
		}
		await ipcRenderer.invoke('commit-project-folder-deletion', transactionId);
		activeProjectDeletionTransactions.delete(transactionId);
		projectCapabilities.delete(rootPath);
	},
	async rollbackProjectFolderDeletion(transactionId: string) {
		if (!activeProjectDeletionTransactions.has(transactionId)) {
			throw new Error('This project deletion transaction is unavailable.');
		}
		await ipcRenderer.invoke('rollback-project-folder-deletion', transactionId);
		activeProjectDeletionTransactions.delete(transactionId);
	},
	duplicateProjectFolder(
		rootPath: string,
		replacements: ProjectStoryReplacement[]
	) {
		return invokeProjectResult(
			'duplicate-project-folder',
			projectCapability(rootPath),
			replacements
		);
	},
	deleteProjectAsset(rootPath: string, path: string) {
		return invokeAssetEffectResult(
			'delete-project-asset',
			projectCapability(rootPath),
			path
		);
	},
	async discardProjectAssetEffect(effectToken: string) {
		await ipcRenderer.invoke('discard-project-asset-effect', effectToken);
		activeAssetEffectCapabilities.delete(effectToken);
	},
	deleteProjectFolder(rootPath: string) {
		return ipcRenderer
			.invoke('delete-project-folder', projectCapability(rootPath))
			.then(result => {
				projectCapabilities.delete(rootPath);
				return result;
			});
	},
	discardProjectImport(importId: string) {
		return ipcRenderer.invoke('discard-project-import', importId);
	},
	deleteStory(story: Story) {
		return ipcRenderer.invoke('delete-story', story);
	},
	filePathForFile(file: File) {
		return webUtils.getPathForFile(file);
	},
	getStoryLibraryFolder() {
		return ipcRenderer.invoke('get-story-library-folder');
	},
	getPlatformSettings() {
		return ipcRenderer.invoke('get-platform-settings');
	},
	getReferencedMediaEmbeddingCapability() {
		return ipcRenderer.invoke('referenced-media-embedding-capability');
	},
	loadPrefs() {
		return ipcRenderer.invoke('load-prefs');
	},
	loadStories() {
		return ipcRenderer.invoke('load-stories').then(result =>
			result.status === 'loaded'
				? {
						...result,
						stories: result.stories.map(rememberProjectCapability)
					}
				: result
		);
	},
	loadStoryFormats() {
		return ipcRenderer.invoke('load-story-formats');
	},
	loadStoryFormatProperties(url: string, timeout?: number) {
		return ipcRenderer.invoke('load-story-format-properties', url, timeout);
	},
	onStoryPreviewCommand(
		callback: (command: NativeStoryPreviewOwnerCommand) => void
	) {
		const listener = (
			_event: Electron.IpcRendererEvent,
			command: NativeStoryPreviewOwnerCommand
		) => callback(command);

		ipcRenderer.on('story-preview:owner-command', listener);
		return () =>
			ipcRenderer.removeListener('story-preview:owner-command', listener);
	},
	openStoryPreview(
		request: NativeStoryPreviewLaunchRequest,
		projectRoot?: string
	) {
		return ipcRenderer.invoke(
			'story-preview:open',
			request,
			projectRoot ? projectCapability(projectRoot) : undefined
		);
	},
	replaceStoryPreview(
		sessionId: string,
		expectedGeneration: number,
		request: NativeStoryPreviewLaunchRequest,
		projectRoot?: string
	) {
		return ipcRenderer.invoke(
			'story-preview:replace',
			sessionId,
			expectedGeneration,
			request,
			projectRoot ? projectCapability(projectRoot) : undefined
		);
	},
	reportStoryPreviewCommandResult(
		sessionId: string,
		result: NativeStoryPreviewCommandResult
	) {
		return ipcRenderer.invoke(
			'story-preview:owner-command-result',
			sessionId,
			result
		);
	},
	updateStoryPreviewAppearance(appearance: NativeStoryPreviewAppearance) {
		return ipcRenderer.invoke('story-preview:update-appearance', appearance);
	},
	hydrateProjectFolder(rootPath: string, storyIds?: string[]) {
		return invokeProjectResult(
			'hydrate-project-folder',
			projectCapability(rootPath),
			storyIds
		);
	},
	beginProjectFolderHydration(rootPath: string, storyIds?: string[]) {
		return invokeProjectResult(
			'begin-project-folder-hydration',
			projectCapability(rootPath),
			storyIds
		);
	},
	readProjectFolderHydrationChunk(
		hydrationId: string,
		cursor: number,
		limit?: number
	) {
		return ipcRenderer.invoke(
			'read-project-folder-hydration-chunk',
			hydrationId,
			cursor,
			limit
		);
	},
	finishProjectFolderHydration(hydrationId: string) {
		return ipcRenderer.invoke('finish-project-folder-hydration', hydrationId);
	},
	completePersistenceQuit(nonce: string, errorMessage?: string) {
		ipcRenderer.send('persistence-quit-prepared', nonce, errorMessage);
	},
	listProjectAssets(rootPath: string) {
		return ipcRenderer.invoke(
			'list-project-assets',
			projectCapability(rootPath)
		);
	},
	readProjectAssetPayloads(
		rootPath: string,
		paths: string[],
		limits: {
			maxFileBytes: number;
			maxFileCount: number;
			maxTotalEncodedBytes: number;
		}
	) {
		return ipcRenderer.invoke(
			'read-project-asset-payloads',
			projectCapability(rootPath),
			paths,
			limits
		);
	},
	async readProjectPackageAssetPayloads(
		rootPath: string,
		priorityPaths: string[]
	) {
		const result = (await ipcRenderer.invoke(
			'read-project-package-asset-payloads',
			projectCapability(rootPath),
			priorityPaths
		)) as NativeProjectPackageAssetPayloadIpcResult;

		if (result.status === 'error') {
			throw Object.assign(new Error(result.message), {code: result.code});
		}

		return result.batch;
	},
	rendererPersistenceReady() {
		ipcRenderer.send('persistence-renderer-ready');
	},
	openProjectFolder(options?: {loadPassageText?: boolean}) {
		return invokeProjectResult('open-project-folder', options);
	},
	prepareProjectImport(sourcePath: string) {
		return ipcRenderer.invoke('prepare-project-import', sourcePath);
	},
	projectSessionSnapshot(rootPath: string, storyIds?: string[]) {
		return ipcRenderer.invoke(
			'project-session-snapshot',
			projectCapability(rootPath),
			storyIds
		);
	},
	revealStoryLibraryFolder() {
		return ipcRenderer.invoke('reveal-story-library-folder');
	},
	revealBackupFolder() {
		return ipcRenderer.invoke('reveal-backup-folder');
	},
	resetStoryLibraryFolder() {
		return ipcRenderer.invoke('reset-story-library-folder');
	},
	revealPath(path: string) {
		ipcRenderer.send('reveal-path', path);
	},
	renameProjectAsset(rootPath: string, oldPath: string, newPath: string) {
		return invokeAssetEffectResult(
			'rename-project-asset',
			projectCapability(rootPath),
			oldPath,
			newPath
		);
	},
	renameStory(oldStory: Story, newStory: Story) {
		return ipcRenderer.invoke('rename-story', oldStory, newStory);
	},
	replaceProjectAsset(rootPath: string, path: string, sourcePath: string) {
		return invokeAssetEffectResult(
			'replace-project-asset',
			projectCapability(rootPath),
			path,
			sourcePath
		);
	},
	resolveProjectSessionConflicts(
		rootPath: string,
		resolution: string,
		stories?: Story[],
		deltaId?: string
	) {
		return ipcRenderer.invoke(
			'resolve-project-session-conflicts',
			projectCapability(rootPath),
			resolution,
			stories,
			deltaId
		);
	},
	saveJson(filename: string, data: any) {
		return ipcRenderer.invoke('save-json', filename, data);
	},
	saveProjectFolder(
		rootPath: string,
		story: Story,
		options?: Parameters<
			NonNullable<TwineElectronWindow['twineElectron']>['saveProjectFolder']
		>[2]
	) {
		return invokeProjectResult(
			'save-project-folder',
			projectCapability(rootPath),
			story,
			options
		);
	},
	runStoryLibraryBackup() {
		return ipcRenderer.invoke('run-story-library-backup');
	},
	saveStoryHtml(story: Story, data: string) {
		return ipcRenderer.invoke('save-story-html', story, data);
	},
	startProjectSession(rootPath: string, storyIds?: string[]) {
		return ipcRenderer.invoke(
			'start-project-session',
			projectCapability(rootPath),
			storyIds
		);
	},
	stopProjectSession(rootPath: string) {
		const capability = projectCapabilities.get(rootPath);

		// Project deletion stops the native session and revokes its capability
		// before React unmount cleanup runs. Treat that later stop as idempotent.
		return capability
			? ipcRenderer.invoke('stop-project-session', capability)
			: Promise.resolve();
	},
	updatePlatformSettings(settings: unknown) {
		return ipcRenderer.invoke('update-platform-settings', settings);
	},
	onProjectSessionChanged(callback: (snapshot: unknown) => void) {
		const listener = (_event: unknown, snapshot: unknown) => callback(snapshot);

		ipcRenderer.on('project-session-changed', listener);

		return () =>
			ipcRenderer.removeListener('project-session-changed', listener);
	},
	onPersistenceQuitCancelled(callback: (nonce: string) => void) {
		const listener = (_event: unknown, nonce: string) => callback(nonce);

		ipcRenderer.on('persistence-quit-cancelled', listener);
		return () =>
			ipcRenderer.removeListener('persistence-quit-cancelled', listener);
	},
	onPersistenceQuitRequested(callback: (nonce: string) => void) {
		const listener = (_event: unknown, nonce: string) => callback(nonce);

		ipcRenderer.on('persistence-quit-requested', listener);
		return () =>
			ipcRenderer.removeListener('persistence-quit-requested', listener);
	}
};

async function rendererNativeMemorySnapshot() {
	const processMemory = await process.getProcessMemoryInfo();
	const blinkMemory = process.getBlinkMemoryInfo();

	return {
		blinkMemory,
		pid: process.pid,
		processMemory
	};
}

// Electron defines isMainFrame in preload contexts. Keep the test/legacy
// undefined case compatible, but never expose app capabilities to preview or
// other child frames even if Electron loads this preload there.
const exposeAppBridge = process.isMainFrame !== false;

if (exposeAppBridge) {
	contextBridge.exposeInMainWorld('twineElectron', bridge);
}

if (exposeAppBridge && process.env.TWINE_PERF === '1') {
	contextBridge.exposeInMainWorld('twinePerformanceNative', {
		async checkpoint(name: string, renderer: Record<string, number>) {
			const nativeMemory = await rendererNativeMemorySnapshot();

			return ipcRenderer.invoke('performance-harness-checkpoint', name, {
				...renderer,
				rendererBlinkAllocatedKiB: nativeMemory.blinkMemory.allocated,
				rendererBlinkTotalKiB: nativeMemory.blinkMemory.total,
				rendererPid: nativeMemory.pid,
				rendererPrivateKiB: nativeMemory.processMemory.private,
				rendererResidentSetKiB: nativeMemory.processMemory.residentSet
			});
		},
		collectGarbage() {
			return ipcRenderer.invoke('performance-harness-collect-garbage');
		},
		reconcileProjectSession(rootPath: string) {
			return ipcRenderer.invoke(
				'performance-harness-reconcile-project-session',
				projectCapability(rootPath)
			);
		},
		reset() {
			return ipcRenderer.invoke('performance-harness-reset');
		},
		async snapshot() {
			const [main, rendererNativeMemory] = await Promise.all([
				ipcRenderer.invoke('performance-harness-snapshot'),
				rendererNativeMemorySnapshot()
			]);

			return {...main, rendererNativeMemory};
		}
	});
}
