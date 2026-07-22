// Exposes a limited set of Electron modules to the bundled renderer. Story
// format source is fetched and parsed in the main process and is never loaded
// as a page script in this privileged renderer.

import {contextBridge, ipcRenderer, webUtils} from 'electron';
import {Story} from '../../store/stories/stories.types';
import type {ProjectSourceLayout, TwineElectronWindow} from '../shared';

const projectCapabilityField = '__twineProjectCapability';
const projectCapabilities = new Map<string, string>();
let legacyStoryWriteToken = 0;

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

const bridge = {
	addLocalStoryFormat() {
		return ipcRenderer.invoke('add-local-story-format');
	},
	beginLegacyStoryWrite(storyId: string) {
		const token = `legacy-story-write-${++legacyStoryWriteToken}`;

		if (
			ipcRenderer.sendSync('begin-legacy-story-write', token, storyId) !== true
		) {
			throw new Error('Could not reserve a pending story write.');
		}
		return token;
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
	copyText(text: string) {
		ipcRenderer.send('copy-text', text);
	},
	copyAssetToProject(rootPath: string, sourcePath: string) {
		return ipcRenderer.invoke(
			'copy-asset-to-project',
			projectCapability(rootPath),
			sourcePath
		);
	},
	applyProjectAssetEffect(effectToken: string, direction: 'redo' | 'undo') {
		return ipcRenderer.invoke(
			'apply-project-asset-effect',
			effectToken,
			direction
		);
	},
	copyProjectImportAssets(importId: string, rootPath: string) {
		return ipcRenderer.invoke(
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
	deleteProjectAsset(rootPath: string, path: string) {
		return ipcRenderer.invoke(
			'delete-project-asset',
			projectCapability(rootPath),
			path
		);
	},
	discardProjectAssetEffect(effectToken: string) {
		return ipcRenderer.invoke('discard-project-asset-effect', effectToken);
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
		return ipcRenderer
			.invoke('load-stories')
			.then(stories => stories.map(rememberProjectCapability));
	},
	loadStoryFormats() {
		return ipcRenderer.invoke('load-story-formats');
	},
	loadStoryFormatProperties(url: string, timeout?: number) {
		return ipcRenderer.invoke('load-story-format-properties', url, timeout);
	},
	registerStoryPreview(html: string) {
		return ipcRenderer.invoke('register-story-preview', html);
	},
	releaseStoryPreview(url: string) {
		return ipcRenderer.invoke('release-story-preview', url);
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
	finishLegacyStoryWrite(token: string, errorMessage?: string) {
		ipcRenderer.send('finish-legacy-story-write', token, errorMessage);
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
	openWithScratchFile(data: string) {
		return ipcRenderer.invoke('open-with-scratch-file', data);
	},
	openWithScratchPackage(
		data: string,
		rootPath: string | undefined,
		assets: unknown[]
	) {
		return ipcRenderer.invoke(
			'open-with-scratch-package',
			data,
			rootPath ? projectCapability(rootPath) : undefined,
			assets
		);
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
		return ipcRenderer.invoke(
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
		return ipcRenderer.invoke(
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
		return ipcRenderer.invoke(
			'stop-project-session',
			projectCapability(rootPath)
		);
	},
	updatePlatformSettings(settings: unknown) {
		return ipcRenderer.invoke('update-platform-settings', settings);
	},
	onProjectSessionChanged(callback: (snapshot: unknown) => void) {
		const listener = (_event: unknown, snapshot: unknown) => callback(snapshot);

		ipcRenderer.on('project-session-changed', listener);

		return () =>
			ipcRenderer.removeListener('project-session-changed', listener);
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
