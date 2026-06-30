// Exposes a limited set of Electron modules to a renderer process. Because the
// renderer processes load remote content (e.g. story formats), they must be
// isolated.
//
// For now, we cannot use context isolation here because of jsonp. For jsonp
// loading to work, it expects a global property to be set--but because it
// crosses a context boundary, that global is in the wrong place. For now, we
// place a privileged jsonp function into renderer context.

import {contextBridge, ipcRenderer, webUtils} from 'electron';
import {Story} from '../../store/stories/stories.types';

function jsonp(
	url: string,
	options: {name?: string; param?: string; timeout?: number},
	callback: (error: Error | null, data?: any) => void
) {
	const callbackName = options.name ?? `__twineJsonp${Date.now()}`;
	const callbackParam = options.param ?? 'callback';
	const target = document.getElementsByTagName('script')[0] || document.head;
	const script = document.createElement('script');
	let timer: number | undefined;
	let settled = false;

	function cleanup() {
		if (script.parentNode) {
			script.parentNode.removeChild(script);
		}

		delete (window as any)[callbackName];

		if (timer) {
			window.clearTimeout(timer);
		}
	}

	// Single settlement path so a load error, the JSONP callback, and the
	// timeout can't double-invoke the caller.
	function settle(error: Error | null, data?: any) {
		if (settled) {
			return;
		}

		settled = true;
		cleanup();
		callback(error, data);
	}

	(window as any)[callbackName] = (data: any) => settle(null, data);

	// Without this, a missing format.js (a common file:// packaging failure) only
	// surfaces after the timeout with a vague "Timeout" — report it immediately.
	script.onerror = () =>
		settle(new Error(`Could not load story format from ${url}`));

	if (options.timeout) {
		timer = window.setTimeout(
			() => settle(new Error('Timeout')),
			options.timeout
		);
	}

	url += `${url.includes('?') ? '&' : '?'}${callbackParam}=${encodeURIComponent(
		callbackName
	)}`;
	url = url.replace('?&', '?');

	script.src = url;
	target.parentNode!.insertBefore(script, target);

	return cleanup;
}

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
		return ipcRenderer.invoke('consume-command-line-open-requests');
	},
	copyText(text: string) {
		ipcRenderer.send('copy-text', text);
	},
	copyAssetToProject(rootPath: string, sourcePath: string) {
		return ipcRenderer.invoke('copy-asset-to-project', rootPath, sourcePath);
	},
	applyProjectAssetEffect(effectToken: string, direction: 'redo' | 'undo') {
		return ipcRenderer.invoke(
			'apply-project-asset-effect',
			effectToken,
			direction
		);
	},
	copyProjectImportAssets(importId: string, rootPath: string) {
		return ipcRenderer.invoke('copy-project-import-assets', importId, rootPath);
	},
	createProjectFolder(story: Story, preferredParent?: string) {
		return ipcRenderer.invoke('create-project-folder', story, preferredParent);
	},
	deleteProjectAsset(rootPath: string, path: string) {
		return ipcRenderer.invoke('delete-project-asset', rootPath, path);
	},
	discardProjectAssetEffect(effectToken: string) {
		return ipcRenderer.invoke('discard-project-asset-effect', effectToken);
	},
	deleteProjectFolder(rootPath: string) {
		return ipcRenderer.invoke('delete-project-folder', rootPath);
	},
	discardProjectImport(importId: string) {
		return ipcRenderer.invoke('discard-project-import', importId);
	},
	deleteStory(story: Story) {
		ipcRenderer.send('delete-story', story);
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
	loadPrefs() {
		return ipcRenderer.invoke('load-prefs');
	},
	loadStories() {
		return ipcRenderer.invoke('load-stories');
	},
	loadStoryFormats() {
		return ipcRenderer.invoke('load-story-formats');
	},
	hydrateProjectFolder(rootPath: string, storyIds?: string[]) {
		return ipcRenderer.invoke('hydrate-project-folder', rootPath, storyIds);
	},
	listProjectAssets(rootPath: string) {
		return ipcRenderer.invoke('list-project-assets', rootPath);
	},
	jsonp(
		url: string,
		options: {name?: string; timeout?: number},
		callback: any
	) {
		return jsonp(url, options, callback);
	},
	onceStoryRenamed(callback: () => void): void {
		ipcRenderer.once('story-renamed', callback);
	},
	openWithScratchFile(data: string, filename: string) {
		ipcRenderer.send('open-with-scratch-file', data, filename);
	},
	openWithScratchPackage(data: string, filename: string, assets: unknown[]) {
		ipcRenderer.send('open-with-scratch-package', data, filename, assets);
	},
	openProjectFolder(options?: {loadPassageText?: boolean}) {
		return ipcRenderer.invoke('open-project-folder', options);
	},
	prepareProjectImport(sourcePath: string) {
		return ipcRenderer.invoke('prepare-project-import', sourcePath);
	},
	projectSessionSnapshot(rootPath: string, storyIds?: string[]) {
		return ipcRenderer.invoke('project-session-snapshot', rootPath, storyIds);
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
			rootPath,
			oldPath,
			newPath
		);
	},
	renameStory(oldStory: Story, newStory: Story) {
		ipcRenderer.send('rename-story', oldStory, newStory);
	},
	replaceProjectAsset(rootPath: string, path: string, sourcePath: string) {
		return ipcRenderer.invoke(
			'replace-project-asset',
			rootPath,
			path,
			sourcePath
		);
	},
	resolveProjectSessionConflicts(
		rootPath: string,
		resolution: string,
		stories?: Story[]
	) {
		return ipcRenderer.invoke(
			'resolve-project-session-conflicts',
			rootPath,
			resolution,
			stories
		);
	},
	saveJson(filename: string, data: any) {
		ipcRenderer.send('save-json', filename, data);
	},
	saveProjectFolder(rootPath: string, story: Story) {
		return ipcRenderer.invoke('save-project-folder', rootPath, story);
	},
	runStoryLibraryBackup() {
		return ipcRenderer.invoke('run-story-library-backup');
	},
	saveStoryHtml(story: Story, data: string) {
		ipcRenderer.send('save-story-html', story, data);
	},
	startProjectSession(rootPath: string, storyIds?: string[]) {
		return ipcRenderer.invoke('start-project-session', rootPath, storyIds);
	},
	stopProjectSession(rootPath: string) {
		return ipcRenderer.invoke('stop-project-session', rootPath);
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

if ((process as any).contextIsolated) {
	contextBridge.exposeInMainWorld('twineElectron', bridge);
} else {
	(window as any).twineElectron = bridge;
}
