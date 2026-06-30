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

export type NativeLinkHandlingMode = 'block' | 'system';
export type NativeScratchAssetStrategy = 'copy' | 'link';

export interface NativeBackupResult {
	backupDirectoryName: string;
	backupPath: string;
	createdAt: string;
	prunedBackupNames: string[];
}

export interface NativePlatformSettings {
	backupCadenceMinutes: number;
	backupFolderPath: string;
	backupLastReviewedTime: number;
	backupReminderDays: number;
	backupRetentionLimit: number;
	cacheCleanupDays: number;
	externalEditorCommand: string;
	fullscreenPersistence: boolean;
	lastWindowFullscreen: boolean;
	linkHandlingMode: NativeLinkHandlingMode;
	scratchAssetStrategy: NativeScratchAssetStrategy;
	storyLibraryFolderPath: string;
}

export interface NativePlatformSettingsUpdate {
	backupCadenceMinutes?: number;
	backupLastReviewedTime?: number;
	backupReminderDays?: number;
	backupRetentionLimit?: number;
	cacheCleanupDays?: number;
	externalEditorCommand?: string;
	fullscreenPersistence?: boolean;
	lastWindowFullscreen?: boolean;
	linkHandlingMode?: NativeLinkHandlingMode;
	scratchAssetStrategy?: NativeScratchAssetStrategy;
}

export interface NativeCommandLineOpenResult {
	errors: Array<{message: string; path: string}>;
	openedProjects: NativeProjectFolderResult[];
	unsupportedPaths: string[];
}

export interface NativeProjectFolderResult {
	passageTextLoaded?: boolean;
	rootPath: string;
	stories: Story[];
	storyIds: string[];
}

export interface NativeProjectAssetWriteResult {
	effectToken?: string;
	sourcePath: string;
	targetPath: string;
}

export interface NativeProjectImportAsset {
	originalPath: string;
	sourcePath: string;
	targetPath: string;
}

export interface NativeProjectImportSource {
	assets: NativeProjectImportAsset[];
	htmlFilePath: string;
	htmlSource: string;
	id: string;
	sourceKind: 'html' | 'zip';
	sourcePath: string;
}

export interface ElectronLegacyStoryFile {
	htmlSource: string;
	kind?: 'legacy-html';
	mtime: Date;
}

export interface ElectronNativeProjectStoryEntry {
	kind: 'native-project';
	passageTextLoaded: boolean;
	rootPath: string;
	story: Story;
	storyIds: string[];
}

export type ElectronLoadedStoryEntry =
	| ElectronLegacyStoryFile
	| ElectronNativeProjectStoryEntry;

export interface NativeAddLocalStoryFormatResult {
	name: string;
	url: string;
	version: string;
}

export interface TwineElectronWindow extends Window {
	twineElectron?: {
		addLocalStoryFormat(): Promise<NativeAddLocalStoryFormatResult | undefined>;
		chooseAssetFile(defaultPath?: string): Promise<string | undefined>;
		chooseStoryLibraryFolder(): Promise<string | undefined>;
		consumeCommandLineOpenRequests(): Promise<NativeCommandLineOpenResult>;
		copyText(text: string): void;
		copyAssetToProject(
			rootPath: string,
			sourcePath: string
		): Promise<NativeProjectAssetWriteResult>;
		copyProjectImportAssets(
			importId: string,
			rootPath: string
		): Promise<NativeProjectAssetWriteResult[]>;
		createProjectFolder(
			story: Story,
			preferredParent?: string
		): Promise<NativeProjectFolderResult>;
		deleteProjectAsset(
			rootPath: string,
			path: string
		): Promise<NativeProjectAssetWriteResult>;
		applyProjectAssetEffect(
			effectToken: string,
			direction: 'redo' | 'undo'
		): Promise<void>;
		discardProjectAssetEffect(effectToken: string): Promise<void>;
		deleteProjectFolder(rootPath: string): Promise<void>;
		discardProjectImport(importId: string): Promise<void>;
		deleteStory(story: Story): void;
		filePathForFile(file: File): string;
		getStoryLibraryFolder(): Promise<string>;
		getPlatformSettings(): Promise<NativePlatformSettings>;
		hydrateProjectFolder(
			rootPath: string,
			storyIds?: string[]
		): Promise<NativeProjectFolderResult>;
		loadPrefs(): Promise<any>;
		loadStories(): Promise<ElectronLoadedStoryEntry[]>;
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
		openProjectFolder(options?: {
			loadPassageText?: boolean;
		}): Promise<NativeProjectFolderResult | undefined>;
		prepareProjectImport(
			sourcePath: string
		): Promise<NativeProjectImportSource>;
		projectSessionSnapshot(
			rootPath: string,
			storyIds?: string[]
		): Promise<NativeProjectSessionSnapshot>;
		revealStoryLibraryFolder(): Promise<void>;
		revealBackupFolder(): Promise<void>;
		resetStoryLibraryFolder(): Promise<string>;
		revealPath(path: string): void;
		renameProjectAsset(
			rootPath: string,
			oldPath: string,
			newPath: string
		): Promise<NativeProjectAssetWriteResult>;
		renameStory(oldStory: Story, newStory: Story): void;
		replaceProjectAsset(
			rootPath: string,
			path: string,
			sourcePath: string
		): Promise<NativeProjectAssetWriteResult>;
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
		runStoryLibraryBackup(): Promise<NativeBackupResult>;
		startProjectSession(
			rootPath: string,
			storyIds?: string[]
		): Promise<NativeProjectSessionSnapshot>;
		stopProjectSession(rootPath: string): Promise<void>;
		updatePlatformSettings(
			settings: NativePlatformSettingsUpdate
		): Promise<NativePlatformSettings>;
	};
}
