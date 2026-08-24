import {
	PassageWithText,
	Story,
	StoryWithDocuments
} from '../../store/stories/stories.types';
import type {
	ProjectFolderExpectedFile,
	ProjectFolderSaveOptions
} from '../../store/persistence/project-folder-save-hints';
import type {CoreAssetInventoryEntry, CoreStorySummary} from '../../core';
import type {CoreExternalDelta} from '../../core/bindings/CoreExternalDelta';
import type {StoryBuildAsset} from '../../util/build-package';
import type {StoryFormatProperties} from '../../store/story-formats';

export type ProjectSourceLayout = 'passage-files' | 'single-twee';

export interface ProjectStoryReplacement {
	passageIds: Array<{
		duplicatePassageId: string;
		sourcePassageId: string;
	}>;
	sourceStoryId: string;
	story: StoryWithDocuments;
}

export interface NativeProjectFileEntry {
	contentDigest?: string;
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
	files: Array<NativeProjectFileEntry & {passageId?: string; storyId?: string}>;
	rootPath: string;
	scannedAt: string;
	stories: StoryWithDocuments[];
	storyIds: string[];
}

export interface NativeProjectSessionRecovery {
	changedPaths: string[];
	message: string;
	reason:
		| 'invalidManifest'
		| 'projectIdentity'
		| 'schema'
		| 'unsafePath'
		| 'unsupportedMetadata';
}

export interface NativeProjectSessionDelta {
	baseGeneration: number;
	candidateGeneration: number;
	changedPaths: string[];
	delta: CoreExternalDelta;
	fileChanges: NativeProjectSessionConflict[];
	id: string;
	performanceTrace?: NativeProjectSessionPerformanceTrace;
	recovery?: NativeProjectSessionRecovery;
	rootPath: string;
	scannedAt: string;
	sessionInstanceId: string;
}

export interface NativeProjectSessionPerformanceTrace {
	deltaCreatedAtEpochMs: number;
	nativeNotifiedAtEpochMs?: number;
	scanStartedAtEpochMs: number;
	watcherObservedAtEpochMs?: number;
}

export interface NativeProjectSessionStart {
	assets: CoreAssetInventoryEntry[];
	generation: number;
	performanceTimings?: {
		assetCount: number;
		baselineFileCount: number;
		baselineMode?: 'full' | 'receipt';
		baselinePrimeMs: number;
		descriptorPathCount: number;
		receiptAdoptionMs?: number;
		receiptCatchupMs?: number;
		receiptFileCount?: number;
	};
	rootPath: string;
	sessionInstanceId: string;
	storyIds: string[];
}

export interface NativePerformanceProjectSessionReconcile {
	generation: number;
	rootPath: string;
	sessionInstanceId: string;
}

export type NativeProjectSessionResolution =
	'acceptDisk' | 'dismiss' | 'keepApp';

export type NativeLinkHandlingMode = 'block' | 'system';

export type NativeStoryPreviewTarget = 'play' | 'proof' | 'test';

export interface NativeStoryPreviewAppearance {
	highContrast: boolean;
	reducedMotion: boolean;
	theme: 'dark' | 'light';
}

export interface NativeStoryPreviewPassageRef {
	id: string;
	localId: string;
	name: string;
}

export interface NativeStoryPreviewDescriptor {
	appearance: NativeStoryPreviewAppearance;
	bridgeSessionId: string;
	generation: number;
	htmlBytes: number;
	launchPassage?: {id: string; name: string};
	passages: NativeStoryPreviewPassageRef[];
	sessionId: string;
	storyDataCount: number;
	storyId: string;
	storyName: string;
	summary?: CoreStorySummary;
	target: NativeStoryPreviewTarget;
}

export type NativeStoryPreviewDescriptorInput = Omit<
	NativeStoryPreviewDescriptor,
	'generation' | 'sessionId'
>;

export interface NativeStoryPreviewLaunchRequest {
	assets?: Array<Pick<StoryBuildAsset, 'outputPath' | 'path'>>;
	descriptor: NativeStoryPreviewDescriptorInput;
	instrumentedHtml: string;
}

/**
 * Commands emitted by the dedicated preview renderer. Main derives the preview
 * session from the sender; callers cannot select a session ID.
 */
export type NativeStoryPreviewCommand =
	| {
			generation: number;
			passageId?: string;
			type: 'revealGraph' | 'revealSource';
	  }
	| {
			generation: number;
			type: 'testFromStart';
	  }
	| {
			generation: number;
			passageId: string;
			type: 'testCurrent';
	  };

export interface NativeStoryPreviewOwnerCommand {
	command: NativeStoryPreviewCommand;
	/** Main-resolved passage, including the stored launch fallback. */
	passageId?: string;
	sessionId: string;
	storyId: string;
}

export interface NativeStoryPreviewClearStateOperation {
	generation: number;
	operationId: string;
	url: string;
}

export interface NativeStoryPreviewReplacement {
	descriptor: NativeStoryPreviewDescriptor;
	generation: number;
	url: string;
}

export interface NativeStoryPreviewErrorResult {
	generation: number;
	message: string;
	operation: 'command' | 'launch' | 'replacement';
}

export type NativeStoryPreviewCommandResult =
	| {
			command: NativeStoryPreviewCommand['type'];
			generation: number;
			status: 'busy' | 'success';
	  }
	| (NativeStoryPreviewErrorResult & {
			command: NativeStoryPreviewCommand['type'];
			operation: 'command';
			status: 'error';
	  });

export type NativeStoryPreviewReplacementResult =
	| {
			generation: number;
			replacement: NativeStoryPreviewReplacement;
			status: 'success';
	  }
	| (NativeStoryPreviewErrorResult & {
			operation: 'replacement';
			status: 'error';
	  });

export interface NativeStoryPreviewAppearanceUpdate {
	appearance: NativeStoryPreviewAppearance;
	generation: number;
}

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
}

export interface NativeCommandLineOpenResult {
	errors: Array<{message: string; path: string}>;
	openedProjects: NativeProjectFolderResult[];
	unsupportedPaths: string[];
}

export interface NativeProjectFolderResult {
	baselineReceipt?: NativeProjectBaselineReceipt;
	graphLayoutLoaded?: boolean;
	loadPerformanceTimings?: NativeProjectLoadTimings;
	passageTextLoaded?: boolean;
	performanceTimings?: NativeProjectSaveTimings;
	rootPath: string;
	storySourcesLoaded?: boolean;
	stories: StoryWithDocuments[];
	storyIds: string[];
}

export interface NativeProjectReplacementTransaction {
	id: string;
	project: NativeProjectFolderResult;
}

export interface NativeProjectDeletionTransaction {
	id: string;
	rootPath: string;
}

export interface NativeProjectFolderSaveFallback {
	expectedFileBaseline: ProjectFolderExpectedFile[];
	rootPath: string;
	saveFallback: 'full-save-required';
}

export type NativeProjectFolderSaveResult =
	NativeProjectFolderResult | NativeProjectFolderSaveFallback;

export interface NativeProjectHydrationStart extends Omit<
	NativeProjectFolderResult,
	'passageTextLoaded'
> {
	hydrationId: string;
	passageCount: number;
}

export interface NativeProjectHydrationChunk {
	done: boolean;
	nextCursor: number;
	passages: Array<{passage: PassageWithText; storyId: string}>;
}

export interface NativeProjectLoadTimings {
	assetScanUs?: number;
	baselineReceiptUs?: number;
	graphLayoutUs?: number;
	jsJsonParseMs?: number;
	mainNativeCallMs?: number;
	modelBuildUs: number;
	loadProfile?: 'full' | 'shell';
	manifestCacheBytes?: number;
	manifestCacheDecodeUs?: number;
	manifestCacheHit?: boolean;
	manifestCacheMissReason?:
		| 'hashMismatch'
		| 'invalidCache'
		| 'missing'
		| 'schemaMismatch'
		| 'versionMismatch';
	manifestCacheReadUs?: number;
	manifestDigest?: string;
	manifestHashUs?: number;
	manifestParseUs?: number;
	manifestReadUs?: number;
	manifestTomlParseUs?: number;
	nativeStoryConversionUs: number;
	parallel?: boolean;
	passageSourceCount?: number;
	passageSourceUs?: number;
	payloadBytes?: number;
	sourceBytes?: number;
	sourceJobPrepareUs?: number;
	storySourceCount?: number;
	storySourceUs?: number;
	workerCount?: number;
}

export interface NativeProjectBaselineReceipt {
	assets: CoreAssetInventoryEntry[];
	completedAt: string;
	files: NativeProjectFileEntry[];
	id: string;
	layoutDataJson: string;
	rootPath: string;
	schemaVersion: number;
	startedAt: string;
	storyIds: string[];
}

export interface NativeProjectSaveTimings {
	baselineRefreshUs?: number;
	baselinePatchUs?: number;
	changedFilePlanUs: number;
	collectNewFilesUs: number;
	conflictCheckUs?: number;
	collectOldFilesUs: number;
	copyAssetsUs: number;
	dirtyCompareUs: number;
	fallbackReason?: string;
	jsonParseUs: number;
	mode?: 'full' | 'incremental';
	projectBuildUs: number;
	rootSwapUs: number;
	saveProjectPathUs: number;
	sidecarUs: number;
	touchedPathCount?: number;
	totalUs: number;
	writeTouchedFilesUs?: number;
	writeTempProjectUs: number;
}

export interface NativeProjectAssetWriteResult {
	effectToken?: string;
	sourcePath: string;
	targetPath: string;
}

export interface NativeReferencedMediaEmbeddingCapability {
	available: boolean;
	maxFileBytes: number;
	maxFileCount: number;
	maxTotalEncodedBytes: number;
	reason?: string;
}

export interface NativeProjectAssetPayload {
	bytes: ArrayBuffer | Uint8Array;
	encodedSizeBytes: number;
	mediaType: string;
	path: string;
	sha256: string;
	sizeBytes: number;
}

export interface NativeProjectAssetPayloadFailure {
	message: string;
	path: string;
	reason: string;
}

export interface NativeProjectAssetPayloadBatch {
	failures: NativeProjectAssetPayloadFailure[];
	payloads: NativeProjectAssetPayload[];
	totalEncodedBytes: number;
	totalSourceBytes: number;
}

export interface NativeProjectAssetPayloadLimits {
	maxFileBytes: number;
	maxFileCount: number;
	maxTotalEncodedBytes: number;
}

export interface NativeProjectPackageAssetPayloadLimits {
	maxAssetFileBytes: number;
	maxAssetFileCount: number;
	maxAssetTotalBytes: number;
}

export interface NativeProjectPackageAssetInventoryEntry {
	modifiedAtMs: number;
	path: string;
	requiredByStaticReference: boolean;
	sizeBytes: number;
}

export interface NativeProjectPackageAssetInspectionEntry {
	modifiedAtMs: number;
	path: string;
	sizeBytes: number;
}

export interface NativeProjectPackageAssetInspection {
	failures: NativeProjectAssetPayloadFailure[];
	inventory: NativeProjectPackageAssetInspectionEntry[];
	scannedEntryCount: number;
	truncated: boolean;
}

export interface NativeProjectPackageAssetExclusion {
	path: string;
	reason: 'platform-junk';
}

export interface NativeProjectPackageAssetSnapshot {
	contentFingerprint: string;
	generation: number;
	inventoryFingerprint: string;
	sessionInstanceId: string;
}

export interface NativeProjectPackageAssetPayloadBatch extends NativeProjectAssetPayloadBatch {
	appliedLimits: NativeProjectPackageAssetPayloadLimits;
	excluded: NativeProjectPackageAssetExclusion[];
	inventory: NativeProjectPackageAssetInventoryEntry[];
	snapshot: NativeProjectPackageAssetSnapshot;
}

export type NativeProjectPackageAssetPayloadIpcResult =
	| {
			batch: NativeProjectPackageAssetPayloadBatch;
			status: 'success';
	  }
	| {
			code: 'PACKAGE_ASSET_SNAPSHOT_STALE';
			message: string;
			status: 'error';
	  };

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
	ElectronLegacyStoryFile | ElectronNativeProjectStoryEntry;

export type ElectronStoryLoadResult =
	| {status: 'loaded'; stories: ElectronLoadedStoryEntry[]}
	| {message: string; status: 'recovery-required'};

export interface NativeAddLocalStoryFormatResult {
	name: string;
	url: string;
	version: string;
}

export interface TwineElectronWindow extends Window {
	twinePerformanceNative?: {
		checkpoint(name: string, renderer: Record<string, number>): Promise<void>;
		collectGarbage(): Promise<void>;
		reconcileProjectSession(
			rootPath: string
		): Promise<NativePerformanceProjectSessionReconcile>;
		reset(): Promise<void>;
		snapshot(): Promise<unknown>;
	};
	twineElectron?: {
		addLocalStoryFormat(): Promise<NativeAddLocalStoryFormatResult | undefined>;
		chooseAssetFile(defaultPath?: string): Promise<string | undefined>;
		chooseStoryLibraryFolder(): Promise<string | undefined>;
		consumeCommandLineOpenRequests(): Promise<NativeCommandLineOpenResult>;
		onCommandLineOpenRequest(callback: () => void): () => void;
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
			preferredParent?: string,
			sourceLayout?: ProjectSourceLayout
		): Promise<NativeProjectFolderResult>;
		beginProjectReplacement(
			rootPath: string,
			stories: StoryWithDocuments[],
			importId?: string
		): Promise<NativeProjectReplacementTransaction>;
		commitProjectReplacements(transactionIds: string[]): Promise<void>;
		rollbackProjectReplacement(transactionId: string): Promise<void>;
		beginProjectFolderDeletion(
			rootPath: string
		): Promise<NativeProjectDeletionTransaction>;
		commitProjectFolderDeletion(transactionId: string): Promise<void>;
		rollbackProjectFolderDeletion(transactionId: string): Promise<void>;
		duplicateProjectFolder(
			rootPath: string,
			replacements: ProjectStoryReplacement[]
		): Promise<NativeProjectFolderResult>;
		deleteProjectAsset(
			rootPath: string,
			path: string
		): Promise<NativeProjectAssetWriteResult>;
		applyProjectAssetEffect(
			effectToken: string,
			direction: 'redo' | 'undo'
		): Promise<string>;
		discardProjectAssetEffect(effectToken: string): Promise<void>;
		deleteProjectFolder(rootPath: string): Promise<void>;
		discardProjectImport(importId: string): Promise<void>;
		deleteStory(story: Story): Promise<void>;
		filePathForFile(file: File): string;
		getStoryLibraryFolder(): Promise<string>;
		getPlatformSettings(): Promise<NativePlatformSettings>;
		getReferencedMediaEmbeddingCapability(): Promise<NativeReferencedMediaEmbeddingCapability>;
		hydrateProjectFolder(
			rootPath: string,
			storyIds?: string[]
		): Promise<NativeProjectFolderResult>;
		beginProjectFolderHydration(
			rootPath: string,
			storyIds?: string[]
		): Promise<NativeProjectHydrationStart>;
		readProjectFolderHydrationChunk(
			hydrationId: string,
			cursor: number,
			limit?: number
		): Promise<NativeProjectHydrationChunk>;
		finishProjectFolderHydration(hydrationId: string): Promise<void>;
		completePersistenceQuit(nonce: string, errorMessage?: string): void;
		loadPrefs(): Promise<any>;
		loadStories(): Promise<ElectronStoryLoadResult>;
		loadStoryFormats(): Promise<any>;
		loadStoryFormatProperties(
			url: string,
			timeout?: number
		): Promise<StoryFormatProperties>;
		onStoryPreviewCommand(
			callback: (command: NativeStoryPreviewOwnerCommand) => void
		): () => void;
		onPersistenceQuitCancelled(callback: (nonce: string) => void): () => void;
		onPersistenceQuitRequested(callback: (nonce: string) => void): () => void;
		openStoryPreview(
			request: NativeStoryPreviewLaunchRequest,
			projectRoot?: string
		): Promise<NativeStoryPreviewDescriptor>;
		replaceStoryPreview(
			sessionId: string,
			expectedGeneration: number,
			request: NativeStoryPreviewLaunchRequest,
			projectRoot?: string
		): Promise<NativeStoryPreviewDescriptor>;
		reportStoryPreviewCommandResult(
			sessionId: string,
			result: NativeStoryPreviewCommandResult
		): Promise<void>;
		updateStoryPreviewAppearance(
			appearance: NativeStoryPreviewAppearance
		): Promise<void>;
		listProjectAssets(rootPath: string): Promise<CoreAssetInventoryEntry[]>;
		readProjectAssetPayloads(
			rootPath: string,
			paths: string[],
			limits: NativeProjectAssetPayloadLimits
		): Promise<NativeProjectAssetPayloadBatch>;
		readProjectPackageAssetPayloads(
			rootPath: string,
			priorityPaths: string[]
		): Promise<NativeProjectPackageAssetPayloadBatch>;
		rendererPersistenceReady(): void;
		onProjectSessionChanged(
			callback: (delta: NativeProjectSessionDelta) => void
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
		renameStory(oldStory: Story, newStory: Story): Promise<void>;
		replaceProjectAsset(
			rootPath: string,
			path: string,
			sourcePath: string
		): Promise<NativeProjectAssetWriteResult>;
		resolveProjectSessionConflicts(
			rootPath: string,
			resolution: NativeProjectSessionResolution,
			stories?: Story[],
			deltaId?: string
		): Promise<NativeProjectSessionStart>;
		saveProjectFolder(
			rootPath: string,
			story: Story,
			options?: ProjectFolderSaveOptions
		): Promise<NativeProjectFolderSaveResult>;
		saveStoryHtml(story: Story, data: string): Promise<void>;
		saveJson(filename: string, data: any): Promise<void>;
		runStoryLibraryBackup(): Promise<NativeBackupResult>;
		startProjectSession(
			rootPath: string,
			storyIds?: string[]
		): Promise<NativeProjectSessionStart>;
		stopProjectSession(rootPath: string): Promise<void>;
		updatePlatformSettings(
			settings: NativePlatformSettingsUpdate
		): Promise<NativePlatformSettings>;
	};
}
