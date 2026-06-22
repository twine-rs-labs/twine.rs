import {Story} from '../../store/stories/stories.types';
import type {CoreAssetInventoryEntry} from '../../core';
import type {StoryBuildAsset} from '../../util/build-package';

export interface NativeProjectFileEntry {
	fingerprint: string;
	kind:
		| 'manifest'
		| 'metadata'
		| 'graph'
		| 'passage'
		| 'script'
		| 'stylesheet'
		| 'asset';
	modifiedAt: string;
	mtimeMs: number;
	path: string;
	sizeBytes: number;
}

export interface NativeProjectSessionConflict {
	change: 'added' | 'modified' | 'removed';
	current?: NativeProjectFileEntry;
	id: string;
	kind: NativeProjectFileEntry['kind'];
	message: string;
	path: string;
	previous?: NativeProjectFileEntry;
}

export interface NativeProjectSessionSnapshot {
	assets: CoreAssetInventoryEntry[];
	changedPaths: string[];
	conflicts: NativeProjectSessionConflict[];
	files: NativeProjectFileEntry[];
	rootPath: string;
	scannedAt: string;
	stories: Story[];
	storyIds: string[];
}

export type NativeProjectSessionResolution =
	| 'acceptDisk'
	| 'dismiss'
	| 'keepApp';

export interface NativeProjectFolderResult {
	rootPath: string;
	stories: Story[];
	storyIds: string[];
}

export interface TwineElectronWindow extends Window {
	twineElectron?: {
		chooseAssetFile(defaultPath?: string): Promise<string | undefined>;
		chooseStoryLibraryFolder(): Promise<string | undefined>;
		copyText(text: string): void;
		copyAssetToProject(
			rootPath: string,
			sourcePath: string
		): Promise<{sourcePath: string; targetPath: string}>;
		createProjectFolder(
			story: Story,
			preferredParent?: string
		): Promise<NativeProjectFolderResult>;
		deleteProjectAsset(rootPath: string, path: string): Promise<void>;
		deleteStory(story: Story): void;
		getStoryLibraryFolder(): Promise<string>;
		loadPrefs(): Promise<any>;
		loadStories(): Promise<any>;
		loadStoryFormats(): Promise<any>;
		listProjectAssets(rootPath: string): Promise<CoreAssetInventoryEntry[]>;
		jsonp(
			url: string,
			options: {name?: string; timeout?: number},
			callback: (error: Error | null, data?: any) => void
		): () => void;
		onceStoryRenamed(callback: () => void): void;
		openWithScratchFile(data: string, filename: string): void;
		openWithScratchPackage(
			data: string,
			filename: string,
			assets: Pick<StoryBuildAsset, 'outputPath' | 'sourcePath'>[]
		): void;
		onProjectSessionChanged(
			callback: (snapshot: NativeProjectSessionSnapshot) => void
		): () => void;
		openProjectFolder(): Promise<NativeProjectFolderResult | undefined>;
		projectSessionSnapshot(
			rootPath: string
		): Promise<NativeProjectSessionSnapshot>;
		revealStoryLibraryFolder(): Promise<void>;
		revealPath(path: string): void;
		renameProjectAsset(
			rootPath: string,
			oldPath: string,
			newPath: string
		): Promise<{sourcePath: string; targetPath: string}>;
		renameStory(oldStory: Story, newStory: Story): void;
		replaceProjectAsset(
			rootPath: string,
			path: string,
			sourcePath: string
		): Promise<{sourcePath: string; targetPath: string}>;
		resolveProjectSessionConflicts(
			rootPath: string,
			resolution: NativeProjectSessionResolution,
			stories?: Story[]
		): Promise<NativeProjectSessionSnapshot>;
		saveProjectFolder(
			rootPath: string,
			story: Story
		): Promise<NativeProjectFolderResult>;
		saveStoryHtml(story: Story, data: string): void;
		saveJson(filename: string, data: any): void;
		startProjectSession(
			rootPath: string
		): Promise<NativeProjectSessionSnapshot>;
		stopProjectSession(rootPath: string): Promise<void>;
	};
}
