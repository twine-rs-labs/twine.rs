// Exposes a limited set of Electron modules to a renderer process. Because the
// renderer processes load remote content (e.g. story formats), they must be
// isolated.
//
// For now, we cannot use context isolation here because of jsonp. For jsonp
// loading to work, it expects a global property to be set--but because it
// crosses a context boundary, that global is in the wrong place. For now, we
// place a privileged jsonp function into renderer context.

import {contextBridge, ipcRenderer} from 'electron';
import jsonp from 'jsonp';
import {Story} from '../../store/stories/stories.types';

contextBridge.exposeInMainWorld('twineElectron', {
	chooseAssetFile(defaultPath?: string) {
		return ipcRenderer.invoke('choose-asset-file', defaultPath);
	},
	chooseStoryLibraryFolder() {
		return ipcRenderer.invoke('choose-story-library-folder');
	},
	copyText(text: string) {
		ipcRenderer.send('copy-text', text);
	},
	copyAssetToProject(rootPath: string, sourcePath: string) {
		return ipcRenderer.invoke('copy-asset-to-project', rootPath, sourcePath);
	},
	createProjectFolder(story: Story, preferredParent?: string) {
		return ipcRenderer.invoke('create-project-folder', story, preferredParent);
	},
	deleteProjectAsset(rootPath: string, path: string) {
		return ipcRenderer.invoke('delete-project-asset', rootPath, path);
	},
	deleteStory(story: Story) {
		ipcRenderer.send('delete-story', story);
	},
	getStoryLibraryFolder() {
		return ipcRenderer.invoke('get-story-library-folder');
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
	listProjectAssets(rootPath: string) {
		return ipcRenderer.invoke('list-project-assets', rootPath);
	},
	jsonp(url: string, options: {name?: string; timeout?: number}, callback: any) {
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
	openProjectFolder() {
		return ipcRenderer.invoke('open-project-folder');
	},
	projectSessionSnapshot(rootPath: string) {
		return ipcRenderer.invoke('project-session-snapshot', rootPath);
	},
	revealStoryLibraryFolder() {
		return ipcRenderer.invoke('reveal-story-library-folder');
	},
	revealPath(path: string) {
		ipcRenderer.send('reveal-path', path);
	},
	renameProjectAsset(rootPath: string, oldPath: string, newPath: string) {
		return ipcRenderer.invoke('rename-project-asset', rootPath, oldPath, newPath);
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
	saveStoryHtml(story: Story, data: string) {
		ipcRenderer.send('save-story-html', story, data);
	},
	startProjectSession(rootPath: string) {
		return ipcRenderer.invoke('start-project-session', rootPath);
	},
	stopProjectSession(rootPath: string) {
		return ipcRenderer.invoke('stop-project-session', rootPath);
	},
	onProjectSessionChanged(callback: (snapshot: unknown) => void) {
		const listener = (_event: unknown, snapshot: unknown) => callback(snapshot);

		ipcRenderer.on('project-session-changed', listener);

		return () => ipcRenderer.removeListener('project-session-changed', listener);
	}
});
