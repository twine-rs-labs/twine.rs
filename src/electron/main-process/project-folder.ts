import {FSWatcher, watch} from 'fs';
import {createHash} from 'crypto';
import {tmpdir} from 'os';
import {setImmediate} from 'timers';
import {dialog, shell} from 'electron';
import {v4 as uuid} from '@lukeed/uuid';
import extractZip from 'extract-zip';
import {
	copy,
	mkdtemp,
	mkdir,
	mkdirp,
	move,
	readFile,
	readJson,
	readdir,
	remove,
	stat,
	writeFile
} from 'fs-extra';
import {
	basename,
	dirname,
	extname,
	isAbsolute,
	join,
	relative,
	resolve
} from 'path';
import {performance} from 'perf_hooks';
import type {CoreAssetInventoryEntry} from '../../core';
import type {CoreExternalChange} from '../../core/bindings/CoreExternalChange';
import type {CoreExternalDelta} from '../../core/bindings/CoreExternalDelta';
import type {PassagePatch} from '../../core/bindings/PassagePatch';
import type {StoryMetadataPatch} from '../../core/bindings/StoryMetadataPatch';
import {
	assetKindForPath,
	assetSnippet,
	boundedReferencedMediaPathsInSource,
	compareAssetPaths,
	fileUrlForPath,
	localAssetReferencePath,
	normalizedAssetPath
} from '../../core/asset-paths';
import {
	PassageWithText as Passage,
	StoryWithDocuments as Story
} from '../../store/stories';
import {
	escapeForTweeHeader,
	escapeForTweeText,
	passageFromTwee,
	storyFromTwee,
	storyToTwee
} from '../../util/twee';
import type {
	ProjectFolderSaveHint,
	ProjectFolderSaveOptions
} from '../../store/persistence/project-folder-save-hints';
import type {ProjectSourceLayout} from '../shared';
import {
	diffNativeProjectFileManifest,
	beginNativeProjectFolderHydration,
	createNativeProjectFolder,
	captureNativeProjectAssetDigests,
	finishNativeProjectFolderHydration,
	findNativeTwineHtmlFiles,
	listNativeProjectAssets,
	loadNativeProjectFolder,
	nativeAssetReadBusy,
	nativeProjectAssetDigestCaptureAvailable,
	nativeProjectFileManifest,
	nativeProjectDiagnostic,
	prepareNativeHtmlImport,
	prepareNativeProjectImport,
	readNativeProjectFolderHydrationChunk,
	saveNativeProjectFolder
} from './native';
import {
	forgetProjectFolder,
	rememberProjectFolder
} from './project-library-index';
import {getStoryDirectoryPath} from './story-directory';
import {
	performanceEpochNow,
	performanceHarnessEnabled,
	recordWatcherPerformanceMetric,
	recordWatcherTraceEvent
} from './performance-harness';

export interface NativeProjectFolderResult {
	baselineReceipt?: NativeProjectBaselineReceipt;
	graphLayoutLoaded?: boolean;
	loadPerformanceTimings?: NativeProjectLoadTimings;
	passageTextLoaded?: boolean;
	performanceTimings?: NativeProjectSaveTimings;
	rootPath: string;
	storySourcesLoaded?: boolean;
	stories: Story[];
	storyIds: string[];
}

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
	passages: Array<{passage: Passage; storyId: string}>;
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
	files: Array<NativeProjectFileEntry & {passageId?: string; storyId?: string}>;
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

interface NativeAssetEffectJournal {
	afterFingerprint?: string;
	beforeFingerprint?: string;
	kind: 'delete' | 'import' | 'rename' | 'replace';
	newPath?: string;
	oldPath?: string;
	rootPath: string;
	targetPath: string;
	token: string;
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

export type NativeProjectFileKind =
	| 'manifest'
	| 'metadata'
	| 'graph'
	| 'passage'
	| 'script'
	| 'stylesheet'
	| 'asset';

export type NativeProjectSessionResolution =
	'acceptDisk' | 'dismiss' | 'keepApp';

export interface NativeProjectFileEntry {
	fingerprint: string;
	kind: NativeProjectFileKind;
	modifiedAt: string;
	mtimeMs: number;
	path: string;
	sizeBytes: number;
}

export interface NativeProjectAssetReadBaseline {
	expectedContentDigest?: string;
	expectedExists: boolean;
	expectedModifiedAtMs?: number;
	expectedSizeBytes?: number;
	path: string;
}

export interface NativeProjectSessionConflict {
	change: 'added' | 'modified' | 'removed';
	current?: NativeProjectFileEntry;
	id: string;
	kind: NativeProjectFileKind;
	message: string;
	path: string;
	previous?: NativeProjectFileEntry;
}

export interface NativeProjectSessionSnapshot extends NativeProjectFolderResult {
	assets: CoreAssetInventoryEntry[];
	changedPaths: string[];
	conflicts: NativeProjectSessionConflict[];
	files: NativeProjectFileEntry[];
	scannedAt: string;
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
	storyIds: string[];
}

interface NativeProjectDescriptor {
	layout: Record<
		string,
		{height: number; left: number; top: number; width: number}
	>;
	layoutDataJson: string;
	name: string;
	paths: Map<
		string,
		{
			kind: 'passage' | 'script' | 'stylesheet';
			passageIds?: string[];
			storyId: string;
		}
	>;
	schemaVersion: number;
	stories: ParsedProjectStory[];
}

interface ProjectSessionCandidate {
	baseline: NativeProjectSessionSnapshot;
	deliveryState: 'awaitingResolution' | 'deferred';
	delta: NativeProjectSessionDelta;
	descriptor: NativeProjectDescriptor;
	passageMappingsToPersist?: Array<{
		passage: ParsedProjectPassage;
		storyId: string;
	}>;
}

interface ProjectSessionResolutionRecord {
	resolution: NativeProjectSessionResolution;
	start: NativeProjectSessionStart;
}

type ProjectSessionListener = (delta: NativeProjectSessionDelta) => void;

interface ProjectSessionState {
	aggregateExactNamePassageIds?: Set<string>;
	awaitingBaselineReceipt?: boolean;
	baselineReceiptWaiters?: Array<() => void>;
	baseline?: NativeProjectSessionSnapshot;
	baselineFileIndex?: Map<string, number>;
	assetContentDigests?: Map<
		string,
		{contentDigest: string; mtimeMs: number; sizeBytes: number}
	>;
	assetDigestStories?: Map<
		string,
		{paths: string[]; status: 'ready'} | {reason: string; status: 'unknown'}
	>;
	assetDigestRefreshEpoch?: number;
	assetDigestRefreshSettledEpoch?: number;
	assetDigestRefreshWaiters?: Set<() => void>;
	debounceTimer?: ReturnType<typeof setTimeout>;
	descriptor?: NativeProjectDescriptor;
	generation: number;
	hydrationPromise?: Promise<
		NativeProjectFolderResult & {hydrationId?: string}
	>;
	interval?: ReturnType<typeof setInterval>;
	listeners: Set<ProjectSessionListener>;
	pathHints: Set<string>;
	pending?: ProjectSessionCandidate;
	pollAfterResolution?: boolean;
	pendingWatcherTrace?: {
		deltaId: string;
		observedAtEpochMs: number;
	};
	reconcileAfterResolution?: boolean;
	rescanReconcileRequested?: boolean;
	rescanRequested?: boolean;
	resolvedCandidates: Map<string, ProjectSessionResolutionRecord>;
	receiptPerformance?: {
		adoptionMs: number;
		catchupMs: number;
		fileCount: number;
	};
	rootPath: string;
	scanning?: boolean;
	watcher?: FSWatcher;
	watcherAvailable?: boolean;
}

interface ProjectSessionSnapshotHints {
	assets?: CoreAssetInventoryEntry[];
	stories?: Story[];
	storyIds?: string[];
}

interface ProjectStoryReadOptions {
	loadPassageText?: boolean;
}

export interface NativeProjectOpenOptions extends ProjectStoryReadOptions {}

interface ParsedProjectPassage {
	file?: string;
	id?: string;
	name?: string;
	tags?: string[];
}

interface ParsedProjectStory {
	ifid?: string;
	id?: string;
	last_update?: string;
	manifest_name?: string;
	manifest_start_passage?: string;
	name?: string;
	passages: ParsedProjectPassage[];
	script?: string;
	snap_to_grid?: boolean;
	source?: string;
	source_layout?: ProjectSourceLayout;
	start_passage?: string;
	story_format?: string;
	story_format_version?: string;
	stylesheet?: string;
	tag_colors?: Record<string, string>;
	tags?: string[];
	zoom?: number;
}

type RendererProjectMetadataPassage = Partial<
	Pick<
		Passage,
		| 'height'
		| 'highlighted'
		| 'id'
		| 'left'
		| 'name'
		| 'selected'
		| 'story'
		| 'tags'
		| 'text'
		| 'top'
		| 'width'
	>
> & {id?: string};

type RendererProjectMetadataStory = Partial<
	Omit<Story, 'lastUpdate' | 'passages'>
> & {
	lastUpdate?: Date | string;
	passages?: RendererProjectMetadataPassage[];
};

const projectSessions = new Map<string, ProjectSessionState>();
const projectSessionStartCanceledCode = 'PROJECT_SESSION_START_CANCELED';
const projectHydrations = new Map<
	string,
	{createdAt: number; passages: Array<{passage: Passage; storyId: string}>}
>();
const nativeProjectHydrations = new Set<string>();
const preparedProjectImports = new Map<
	string,
	{assets: NativeProjectImportAsset[]; cleanupPath?: string}
>();
const projectSessionFallbackPollMs = 1250;
const projectSessionReconcileMs = 30_000;
const projectSessionWatchDebounceMs = 150;
const maxProjectMetadataSidecarBytes = 2 * 1024 * 1024;
const importAssetExtensions = new Set([
	'.apng',
	'.avif',
	'.css',
	'.gif',
	'.jpeg',
	'.jpg',
	'.js',
	'.m4a',
	'.mp3',
	'.mp4',
	'.oga',
	'.ogg',
	'.otf',
	'.png',
	'.svg',
	'.ttf',
	'.wav',
	'.webm',
	'.webp',
	'.woff',
	'.woff2'
]);
const importAssetReferenceRegex =
	/([A-Za-z0-9_./~%:@?&=+-]+\.(?:apng|avif|css|gif|jpe?g|js|m4a|mp3|mp4|oga|ogg|otf|png|svg|ttf|wav|webm|webp|woff2?))/gi;
const sugarCubeMacroSignalRegex =
	/<<(?:set|if|elseif|else|switch|case|default|for|capture|widget|button|link(?:append|prepend|replace)?|goto|include|display|print|run|script|style|audio|nobr|notify|timed|repeat|silently|remember|forget|done)\b|<<\/(?:if|for|widget|button|link(?:append|prepend|replace)?|nobr|silently|script|style|notify|timed|repeat)>>/i;
const sugarCubeSignalTags = new Set([
	'init',
	'nobr',
	'script',
	'stylesheet',
	'widget'
]);
const obviousImportAssetDirectoryNames = new Set([
	'asset',
	'assets',
	'audio',
	'font',
	'fonts',
	'image',
	'images',
	'img',
	'media',
	'music',
	'picture',
	'pictures',
	'sound',
	'sounds',
	'video',
	'videos'
]);

function legacyProjectFallbackEnabled() {
	const setting = process.env.TWINE_LEGACY_PROJECT_FALLBACK?.toLowerCase();

	if (setting) {
		return ['1', 'true', 'on', 'yes'].includes(setting);
	}

	return process.env.NODE_ENV === 'test';
}

function requireNativeProjectBackend(operation: string): never {
	const diagnostic = nativeProjectDiagnostic();

	throw new Error(
		`${operation} requires a native Rust project backend result${
			diagnostic ? `: ${diagnostic}` : '.'
		} Set TWINE_LEGACY_PROJECT_FALLBACK=1 only for legacy compatibility.`
	);
}

const warnedCompatibilityFallbacks = new Set<string>();

function allowCompatibilityProjectFallback(operation: string) {
	if (legacyProjectFallbackEnabled()) {
		return;
	}

	if (process.env.NODE_ENV === 'test') {
		return;
	}

	const diagnostic = nativeProjectDiagnostic();
	const warning = `${operation} is using the TypeScript project compatibility path because the native Rust backend did not return a result${
		diagnostic ? `: ${diagnostic}` : '.'
	}`;

	if (!warnedCompatibilityFallbacks.has(warning)) {
		warnedCompatibilityFallbacks.add(warning);
		console.warn(warning);
	}
}

function warnBestEffortProjectMaintenance(operation: string, error: unknown) {
	if (process.env.NODE_ENV !== 'test') {
		console.warn(`${operation} failed: ${(error as Error).message}`);
	}
}

function pathSlug(value: string) {
	let slug = '';

	for (const character of value) {
		if (/[A-Za-z0-9]/.test(character)) {
			slug += character.toLowerCase();
		} else if (!slug.endsWith('-')) {
			slug += '-';
		}
		if (slug.length >= 64) {
			break;
		}
	}

	return slug.replace(/^-+|-+$/g, '') || 'item';
}

function storyPathSlug(story: Pick<Story, 'id' | 'name'>) {
	const slug = pathSlug(story.name);

	return slug === 'untitled' || slug === 'item' ? pathSlug(story.id) : slug;
}

function projectSessionKey(rootPath: string) {
	return resolve(rootPath);
}

function coerceStringArray(value: unknown) {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === 'string')
		: [];
}

function stripTomlComment(line: string) {
	let inString = false;
	let escaped = false;

	for (let index = 0; index < line.length; index++) {
		const character = line[index];

		if (escaped) {
			escaped = false;
			continue;
		}

		if (character === '\\') {
			escaped = true;
			continue;
		}

		if (character === '"') {
			inString = !inString;
			continue;
		}

		if (character === '#' && !inString) {
			return line.slice(0, index);
		}
	}

	return line;
}

function parseTomlValue(value: string): unknown {
	const trimmed = value.trim();

	if (trimmed === 'true') {
		return true;
	}

	if (trimmed === 'false') {
		return false;
	}

	if (trimmed.startsWith('"') || trimmed.startsWith('[')) {
		try {
			return JSON.parse(trimmed);
		} catch {
			return undefined;
		}
	}

	const numeric = Number(trimmed);

	return Number.isFinite(numeric) ? numeric : trimmed;
}

function parseProjectToml(source: string): ParsedProjectStory[] {
	const stories: ParsedProjectStory[] = [];
	let currentStory: ParsedProjectStory | undefined;
	let currentPassage: ParsedProjectPassage | undefined;

	for (const rawLine of source.split(/\r?\n/)) {
		const line = stripTomlComment(rawLine).trim();

		if (!line) {
			continue;
		}

		if (line === '[[stories]]') {
			currentStory = {passages: []};
			currentPassage = undefined;
			stories.push(currentStory);
			continue;
		}

		if (line === '[[stories.passages]]') {
			if (!currentStory) {
				continue;
			}

			currentPassage = {};
			currentStory.passages.push(currentPassage);
			continue;
		}

		if (line.startsWith('[')) {
			currentPassage = undefined;
			continue;
		}

		const delimiter = line.indexOf('=');

		if (delimiter === -1 || !currentStory) {
			continue;
		}

		const key = line.slice(0, delimiter).trim();
		const parsedValue = parseTomlValue(line.slice(delimiter + 1));
		const target = currentPassage ?? currentStory;

		(target as Record<string, unknown>)[key] = parsedValue;
	}

	for (const story of stories) {
		story.tags = coerceStringArray(story.tags);
		story.source_layout =
			story.source_layout === 'single-twee' ? 'single-twee' : 'passage-files';
		story.passages = story.passages.map(passage => ({
			...passage,
			tags: coerceStringArray(passage.tags)
		}));
	}

	return stories.filter(story => story.id || story.name);
}

function sourceLayoutForStory(story: ParsedProjectStory): ProjectSourceLayout {
	return story.source_layout === 'single-twee'
		? 'single-twee'
		: 'passage-files';
}

function storyPassagesToTwee(
	story: Story,
	textUpdates: Map<string, string> = new Map()
) {
	return `${storyToTwee({
		...story,
		passages: story.passages.map(passage => ({
			...passage,
			text: textUpdates.get(passage.id) ?? passage.text
		})),
		script: '',
		stylesheet: ''
	})}\n`;
}

type AggregateSourcePassage = ReturnType<
	typeof storyFromTwee
>['passages'][number];

interface AggregateStoryMetadata {
	ifid: string;
	name: string;
	startPassageName?: string;
	storyFormat: string;
	storyFormatVersion: string;
	tagColors: Record<string, string>;
	zoom: number;
}

interface RawTweeSection {
	end: number;
	passage?: Omit<Passage, 'story'>;
	raw: string;
	start: number;
}

function rawTweeSections(source: string): RawTweeSection[] {
	const starts = [...source.matchAll(/^::/gm)].map(match => match.index ?? 0);

	return starts.map((start, index) => {
		const end = starts[index + 1] ?? source.length;
		const raw = source.slice(start, end);
		let passage: Omit<Passage, 'story'> | undefined;

		try {
			passage = passageFromTwee(raw);
		} catch {
			// Keep malformed or tool-owned sections byte-for-byte.
		}

		return {end, passage, raw, start};
	});
}

function storyDataObject(section: RawTweeSection | undefined) {
	if (!section?.passage) {
		return undefined;
	}

	try {
		const parsed = JSON.parse(section.passage.text);

		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

function rustStableIfid(source: string) {
	const first = rustStableHash(source);
	const second = rustStableHash(`ifid:${source}`);
	const hexadecimal = (value: bigint, width: number) =>
		value.toString(16).toUpperCase().padStart(width, '0');

	return [
		hexadecimal(first >> BigInt(32), 8),
		hexadecimal((first >> BigInt(16)) & BigInt('0xffff'), 4),
		`4${hexadecimal(first & BigInt('0x0fff'), 3)}`,
		`8${hexadecimal((second >> BigInt(48)) & BigInt('0x0fff'), 3)}`,
		hexadecimal(second & BigInt('0x0000ffffffffffff'), 12)
	].join('-');
}

function aggregateStoryDocument(
	source: string,
	fallbackName = 'Untitled Story'
) {
	const sections = rawTweeSections(source);
	const parsedStory = storyFromTwee(
		sections[0] ? source.slice(sections[0].start) : ':: StoryData\n{}'
	);
	const title = sections.find(
		section => section.passage?.name === 'StoryTitle'
	);
	const data = storyDataObject(
		sections.find(section => section.passage?.name === 'StoryData')
	);
	const titleText = title?.passage?.text.trim();
	const metadata: AggregateStoryMetadata = {
		ifid:
			typeof data?.ifid === 'string'
				? parsedStory.ifid
				: rustStableIfid(source),
		name: titleText ? parsedStory.name : fallbackName,
		storyFormat:
			typeof data?.format === 'string' ? parsedStory.storyFormat : '',
		storyFormatVersion:
			typeof data?.['format-version'] === 'string'
				? parsedStory.storyFormatVersion
				: '',
		tagColors: {},
		zoom: 1
	};

	if (typeof data?.start === 'string') {
		metadata.startPassageName = data.start;
	}
	if (
		data?.['tag-colors'] &&
		typeof data['tag-colors'] === 'object' &&
		!Array.isArray(data['tag-colors'])
	) {
		metadata.tagColors = parsedStory.tagColors;
	}
	if (typeof data?.zoom === 'number') {
		metadata.zoom = parsedStory.zoom;
	}

	return {metadata, parsedStory, sections};
}

function renderedPassageSection(passage: Passage, existingRaw?: string) {
	const headerLine = existingRaw?.split(/\r?\n/, 1)[0] ?? '';
	const rawMetadata = /^::\s*(.*?(?:\\\s)?)\s*(\[.*?\])?\s*(\{.*\})?\s*$/.exec(
		headerLine
	)?.[3];
	let metadata: Record<string, unknown> = {};

	if (rawMetadata) {
		try {
			const parsed = JSON.parse(rawMetadata);

			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				metadata = parsed;
			}
		} catch {
			// A malformed header is rewritten with canonical modeled metadata.
		}
	}
	metadata.position = `${passage.left},${passage.top}`;
	metadata.size = `${passage.width},${passage.height}`;
	const name = escapeForTweeHeader(passage.name)
		.replace(/^\s+/g, match => '\\ '.repeat(match.length))
		.replace(/\s+$/g, match => '\\ '.repeat(match.length));
	const tags =
		passage.tags.length > 0
			? ` [${passage.tags.map(escapeForTweeHeader).join(' ')}]`
			: '';

	return `:: ${name}${tags} ${JSON.stringify(metadata)}\n${escapeForTweeText(
		passage.text
	)}\n`;
}

function rewriteTweeSection(raw: string, rewritten: string) {
	const trailing = raw.match(/\s*$/)?.[0] ?? '';

	return `${rewritten.trimEnd()}${trailing || '\n'}`;
}

function appendTweeSection(source: string, section: string) {
	const prefix = source.trimEnd();

	return `${prefix}${prefix ? '\n\n' : ''}${section.trimEnd()}\n`;
}

function renderedStoryDataSection(
	story: Story,
	existing: RawTweeSection | undefined
) {
	const data = {...(storyDataObject(existing) ?? {})};
	const start = story.passages.find(
		passage => passage.id === story.startPassage
	)?.name;

	data.ifid = story.ifid;
	data.format = story.storyFormat;
	data['format-version'] = story.storyFormatVersion;
	data.start = start;
	data.zoom = story.zoom;
	if (Object.keys(story.tagColors).length > 0) {
		data['tag-colors'] = story.tagColors;
	} else {
		delete data['tag-colors'];
	}

	return `:: StoryData\n${JSON.stringify(data, null, 2)}\n`;
}

function aggregatePassageContentsEqual(
	existing: Omit<Passage, 'story'>,
	passage: Passage
) {
	return (
		existing.name === passage.name &&
		JSON.stringify(existing.tags) === JSON.stringify(passage.tags) &&
		existing.text === passage.text &&
		existing.left === passage.left &&
		existing.top === passage.top &&
		existing.width === passage.width &&
		existing.height === passage.height
	);
}

function mergeStoryTweeSource(
	existingSource: string,
	story: Story,
	previousPassageNames: string[]
) {
	const document = aggregateStoryDocument(existingSource);

	if (document.sections.length === 0) {
		return storyPassagesToTwee(story);
	}

	const usedPassages = new Set<number>();
	const usedPrevious = new Set<number>();
	let sawTitle = false;
	let sawData = false;
	let output = existingSource.slice(0, document.sections[0].start);

	for (const section of document.sections) {
		const existing = section.passage;

		if (!existing) {
			output += section.raw;
			continue;
		}
		if (existing.name === 'StoryTitle' && !sawTitle) {
			sawTitle = true;
			output +=
				existing.text.trim() === story.name
					? section.raw
					: rewriteTweeSection(
							section.raw,
							`:: StoryTitle\n${escapeForTweeText(story.name)}\n`
						);
			continue;
		}
		if (existing.name === 'StoryData' && !sawData) {
			sawData = true;
			const rewritten = renderedStoryDataSection(story, section);
			const currentData = storyDataObject(section);
			const nextData = storyDataObject({
				...section,
				passage: passageFromTwee(rewritten),
				raw: rewritten
			});

			output +=
				JSON.stringify(currentData) === JSON.stringify(nextData)
					? section.raw
					: rewriteTweeSection(section.raw, rewritten);
			continue;
		}
		if (
			existing.tags.includes('script') ||
			existing.tags.includes('stylesheet')
		) {
			output += section.raw;
			continue;
		}

		const previousIndex = previousPassageNames.findIndex(
			(name, index) => !usedPrevious.has(index) && name === existing.name
		);
		let passageIndex = story.passages.findIndex(
			(passage, index) =>
				!usedPassages.has(index) && passage.name === existing.name
		);

		if (previousIndex !== -1) {
			usedPrevious.add(previousIndex);
			if (passageIndex === -1 && story.passages[previousIndex]) {
				passageIndex = previousIndex;
			}
			if (passageIndex === -1 || usedPassages.has(passageIndex)) {
				continue;
			}
		} else if (passageIndex === -1) {
			output += section.raw;
			continue;
		}

		usedPassages.add(passageIndex);
		const passage = story.passages[passageIndex];

		output += aggregatePassageContentsEqual(existing, passage)
			? section.raw
			: rewriteTweeSection(
					section.raw,
					renderedPassageSection(passage, section.raw)
				);
	}

	if (!sawTitle) {
		output = appendTweeSection(
			output,
			`:: StoryTitle\n${escapeForTweeText(story.name)}\n`
		);
	}
	if (!sawData) {
		output = appendTweeSection(
			output,
			renderedStoryDataSection(story, undefined)
		);
	}
	for (const [index, passage] of story.passages.entries()) {
		if (!usedPassages.has(index)) {
			output = appendTweeSection(output, renderedPassageSection(passage));
		}
	}

	return output;
}

function rustStableHash(value: string) {
	let hash = BigInt('14695981039346656037');

	for (const byte of Buffer.from(value)) {
		hash ^= BigInt(byte);
		hash = BigInt.asUintN(64, hash * BigInt('1099511628211'));
	}

	return hash;
}

function rustStableSlug(value: string) {
	let slug = '';

	for (const character of value) {
		if (/^[a-z0-9]$/i.test(character)) {
			slug += character.toLowerCase();
		} else if (!slug.endsWith('-')) {
			slug += '-';
		}
		if (slug.length >= 40) {
			break;
		}
	}

	return slug.replace(/^-+|-+$/g, '') || 'item';
}

function rustStableId(prefix: string, seed: string, index: number) {
	const hash = rustStableHash(`${prefix}:${seed}:${index}`)
		.toString(16)
		.padStart(8, '0');

	return `${prefix}-${rustStableSlug(seed)}-${hash}`;
}

function deterministicAggregatePassageId(
	storyName: string,
	name: string,
	sourceIndex: number
) {
	const parsedStoryId = rustStableId('story', storyName, 0);

	return rustStableId('passage', `${parsedStoryId}:${name}`, sourceIndex);
}

function reconcileSingleTweePassages(
	story: ParsedProjectStory,
	sourcePassages: AggregateSourcePassage[],
	exactNameOnlyIds: ReadonlySet<string> = new Set()
) {
	const unmatchedMappings = new Set(story.passages);
	const unmatchedSources = new Set(sourcePassages);
	const byId = new Map<string, AggregateSourcePassage>();
	const mappedBySource = new Map<
		AggregateSourcePassage,
		AggregateSourcePassage
	>();

	for (const sourcePassage of sourcePassages) {
		const mapping = story.passages.find(
			passage =>
				unmatchedMappings.has(passage) && passage.name === sourcePassage.name
		);

		if (!mapping) {
			continue;
		}
		unmatchedMappings.delete(mapping);
		unmatchedSources.delete(sourcePassage);
		const mapped = {
			...sourcePassage,
			id: mapping.id as string,
			story: story.id as string
		};

		byId.set(mapping.id as string, mapped);
		mappedBySource.set(sourcePassage, mapped);
	}

	const remainingMappings = [...unmatchedMappings].filter(
		mapping => !exactNameOnlyIds.has(mapping.id as string)
	);
	const remainingSources = [...unmatchedSources];
	const fallbackCount = Math.min(
		remainingMappings.length,
		remainingSources.length
	);

	for (let index = 0; index < fallbackCount; index++) {
		const mapping = remainingMappings[index];
		const sourcePassage = remainingSources[index];

		unmatchedMappings.delete(mapping);
		unmatchedSources.delete(sourcePassage);
		const mapped = {
			...sourcePassage,
			id: mapping.id as string,
			story: story.id as string
		};

		byId.set(mapping.id as string, mapped);
		mappedBySource.set(sourcePassage, mapped);
	}

	const added = [...unmatchedSources].map(sourcePassage => {
		const mapped = {
			...sourcePassage,
			id: deterministicAggregatePassageId(
				story.name ?? 'Untitled Story',
				sourcePassage.name,
				sourcePassages.indexOf(sourcePassage)
			),
			story: story.id as string
		};

		mappedBySource.set(sourcePassage, mapped);
		return mapped;
	});

	return {
		added,
		byId,
		missingIds: [...unmatchedMappings].map(passage => passage.id as string),
		passages: sourcePassages.map(
			sourcePassage => mappedBySource.get(sourcePassage) ?? sourcePassage
		)
	};
}

async function readSingleTweeState(
	rootPath: string,
	story: ParsedProjectStory,
	exactNameOnlyIds: ReadonlySet<string> = new Set()
) {
	const path = safeProjectFilePath(rootPath, story.source);
	const source = path ? ((await readTextIfPresent(path)) ?? '') : '';
	const document = aggregateStoryDocument(
		source,
		story.manifest_name ?? story.name ?? 'Untitled Story'
	);

	return {
		...reconcileSingleTweePassages(
			story,
			document.parsedStory.passages,
			exactNameOnlyIds
		),
		metadata: document.metadata,
		source
	};
}

async function readSingleTweePassages(
	rootPath: string,
	story: ParsedProjectStory
) {
	const state = await readSingleTweeState(rootPath, story);

	if (state.missingIds.length > 0) {
		throw Object.assign(
			new Error(
				`Aggregate Twee source for "${story.name ?? story.id}" contains ${
					state.passages.length
				} passages and is missing ${state.missingIds.length} manifest mapping(s).`
			),
			{recoveryReason: 'projectIdentity'}
		);
	}

	return story.passages.map(passage => state.byId.get(passage.id as string));
}

function storyWithSingleTweeState(
	story: ParsedProjectStory,
	state: Awaited<ReturnType<typeof readSingleTweeState>>,
	includeAddedPassages = true
): ParsedProjectStory {
	const existingById = descriptorPassageMap(story);
	const metadata = state.metadata;
	const passages = state.passages
		.filter(
			sourcePassage =>
				includeAddedPassages || existingById.has(sourcePassage.id)
		)
		.map(sourcePassage => ({
			...existingById.get(sourcePassage.id),
			id: sourcePassage.id,
			name: sourcePassage.name,
			tags: sourcePassage.tags
		}));
	const startPassage = metadata.startPassageName
		? state.passages.find(passage => passage.name === metadata.startPassageName)
				?.id
		: (story.manifest_start_passage ?? story.start_passage);

	return {
		...story,
		ifid: metadata.ifid,
		manifest_name: story.manifest_name ?? story.name,
		manifest_start_passage: story.manifest_start_passage ?? story.start_passage,
		name: metadata.name,
		story_format: metadata.storyFormat,
		story_format_version: metadata.storyFormatVersion,
		tag_colors: metadata.tagColors,
		zoom: metadata.zoom,
		...(startPassage !== undefined ? {start_passage: startPassage} : {}),
		passages
	};
}

function singleTweeMetadataExternalChanges(
	before: ParsedProjectStory,
	after: ParsedProjectStory
): CoreExternalChange[] {
	const storyId = before.id as string;
	const metadata = emptyStoryMetadataPatch();

	if (before.ifid !== after.ifid) {
		metadata.ifid = after.ifid ?? '';
	}
	if (before.name !== after.name) {
		metadata.name = after.name ?? 'Untitled Story';
	}
	if (before.story_format !== after.story_format) {
		metadata.storyFormat = after.story_format ?? '';
	}
	if (before.story_format_version !== after.story_format_version) {
		metadata.storyFormatVersion = after.story_format_version ?? '';
	}
	if (
		JSON.stringify(before.tag_colors ?? {}) !==
		JSON.stringify(after.tag_colors ?? {})
	) {
		metadata.tagColors = after.tag_colors ?? {};
	}
	if (before.zoom !== after.zoom) {
		metadata.zoom = after.zoom ?? 1;
	}

	const changes: CoreExternalChange[] = [];

	if (Object.values(metadata).some(value => value !== null)) {
		changes.push({
			changes: metadata,
			story_id: storyId,
			type: 'updateStoryMetadata'
		});
	}
	const previousStart =
		before.start_passage ?? (before.passages[0]?.id as string) ?? '';
	const nextStart =
		after.start_passage ?? (after.passages[0]?.id as string) ?? '';

	if (previousStart !== nextStart) {
		changes.push({
			passage_id: nextStart,
			story_id: storyId,
			type: 'updateStoryStartPassage'
		});
	}

	return changes;
}

async function completeSingleTweeStory(
	rootPath: string,
	story: Story,
	descriptorStory: ParsedProjectStory,
	textUpdates: Map<string, string>
): Promise<Story> {
	const sourcePassages = await readSingleTweePassages(
		rootPath,
		descriptorStory
	);
	const incomingPassages = new Map(
		story.passages.map(passage => [passage.id, passage] as const)
	);
	const passages = descriptorStory.passages.map((mapping, index) => {
		const passageId = mapping.id as string;
		const sourcePassage = sourcePassages[index];
		const incoming = incomingPassages.get(passageId);

		if (!sourcePassage) {
			throw new Error(
				`Aggregate Twee source is missing passage "${mapping.name ?? passageId}".`
			);
		}

		return {
			...sourcePassage,
			height: incoming?.height ?? sourcePassage.height,
			id: passageId,
			left: incoming?.left ?? sourcePassage.left,
			name: incoming?.name ?? sourcePassage.name,
			story: story.id,
			tags: incoming?.tags ?? sourcePassage.tags,
			text: textUpdates.get(passageId) ?? sourcePassage.text,
			top: incoming?.top ?? sourcePassage.top,
			width: incoming?.width ?? sourcePassage.width
		};
	});

	return {...story, passages};
}

async function readTextIfPresent(path: string) {
	try {
		const contents = await readFile(path, 'utf8');

		return typeof contents === 'string' ? contents : undefined;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return undefined;
		}

		throw error;
	}
}

async function readJsonIfPresent<T>(
	path: string,
	options: {ignoreInvalidJson?: boolean} = {}
): Promise<T | undefined> {
	try {
		return (await readJson(path)) as T;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return undefined;
		}

		if (
			options.ignoreInvalidJson &&
			(error instanceof SyntaxError || (error as Error).name === 'SyntaxError')
		) {
			console.warn(`Ignoring invalid project sidecar JSON at ${path}:`, error);
			return undefined;
		}

		throw error;
	}
}

function projectHeaderValue(source: string, key: string) {
	for (const rawLine of source.split(/\r?\n/)) {
		const line = stripTomlComment(rawLine).trim();

		if (line === '[[stories]]') {
			break;
		}
		const delimiter = line.indexOf('=');

		if (delimiter !== -1 && line.slice(0, delimiter).trim() === key) {
			return parseTomlValue(line.slice(delimiter + 1));
		}
	}

	return undefined;
}

async function readProjectLayout(rootPath: string) {
	const graph = await readJsonIfPresent<
		Record<string, unknown> & {
			passages?: Record<
				string,
				Partial<Record<'height' | 'left' | 'top' | 'width', number>>
			>;
		}
	>(join(rootPath, '.twine', 'graph.json'));
	const layout: NativeProjectDescriptor['layout'] = {};

	for (const [passageId, entry] of Object.entries(graph?.passages ?? {})) {
		layout[passageId] = {
			height: numberOrFallback(entry.height, 100),
			left: numberOrFallback(entry.left, 0),
			top: numberOrFallback(entry.top, 0),
			width: numberOrFallback(entry.width, 100)
		};
	}

	const layoutData = {...(graph ?? {})};

	delete layoutData.passages;
	return {
		layout,
		layoutDataJson: canonicalJsonString(layoutData)
	};
}

function canonicalJsonValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(canonicalJsonValue);
	}
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, nested]) => [key, canonicalJsonValue(nested)])
		);
	}
	return value;
}

function canonicalJsonString(value: unknown) {
	return JSON.stringify(canonicalJsonValue(value));
}

async function readProjectDescriptor(
	rootPath: string
): Promise<NativeProjectDescriptor> {
	const source = await readTextIfPresent(join(rootPath, 'twine.toml'));

	if (!source) {
		throw new Error('Project manifest not found.');
	}
	const schemaVersion = Number(
		projectHeaderValue(source, 'schema_version') ?? 1
	);
	const name = String(projectHeaderValue(source, 'name') ?? '');
	const parsedStories = parseProjectToml(source);
	const stories: ParsedProjectStory[] = [];

	for (const story of parsedStories) {
		stories.push(
			sourceLayoutForStory(story) === 'single-twee'
				? storyWithSingleTweeState(
						story,
						await readSingleTweeState(rootPath, story),
						false
					)
				: story
		);
	}

	if (schemaVersion !== 1) {
		throw Object.assign(
			new Error(`Project schema ${schemaVersion} requires a full reload.`),
			{recoveryReason: 'schema'}
		);
	}
	if (
		stories.some(
			story =>
				!story.id ||
				(sourceLayoutForStory(story) === 'single-twee'
					? !story.source || story.passages.some(passage => !passage.id)
					: story.passages.some(passage => !passage.id || !passage.file))
		)
	) {
		throw Object.assign(
			new Error('Project identities or source mappings are incomplete.'),
			{recoveryReason: 'projectIdentity'}
		);
	}

	const {layout, layoutDataJson} = await readProjectLayout(rootPath);
	const descriptor: NativeProjectDescriptor = {
		layout,
		layoutDataJson,
		name,
		paths: new Map(),
		schemaVersion,
		stories
	};

	descriptor.paths = descriptorPathMap(descriptor);
	return descriptor;
}

function descriptorStoryMap(descriptor: NativeProjectDescriptor) {
	return new Map(
		descriptor.stories.map(story => [story.id as string, story] as const)
	);
}

function descriptorPassageMap(story: ParsedProjectStory) {
	return new Map(
		story.passages.map(passage => [passage.id as string, passage] as const)
	);
}

async function readDescriptorPassage(
	rootPath: string,
	storyId: string,
	passage: ParsedProjectPassage,
	layout?: NativeProjectDescriptor['layout'][string],
	sourcePassage?: AggregateSourcePassage
) {
	const path = sourcePassage
		? undefined
		: safeProjectFilePath(rootPath, passage.file);
	const text = sourcePassage
		? sourcePassage.text
		: path
			? ((await readTextIfPresent(path)) ?? '')
			: '';

	return {
		id: passage.id as string,
		layout: layout ?? null,
		name: sourcePassage?.name ?? passage.name ?? 'Untitled Passage',
		storyId,
		tags: sourcePassage?.tags ?? passage.tags ?? [],
		text
	};
}

async function readDescriptorStory(
	rootPath: string,
	story: ParsedProjectStory,
	descriptor: NativeProjectDescriptor
) {
	const storyId = story.id as string;
	const scriptPath = safeProjectFilePath(rootPath, story.script);
	const stylesheetPath = safeProjectFilePath(rootPath, story.stylesheet);
	const aggregatePassages =
		sourceLayoutForStory(story) === 'single-twee'
			? await readSingleTweePassages(rootPath, story)
			: undefined;

	return {
		id: storyId,
		ifid: story.ifid ?? storyId.toUpperCase(),
		name: story.name ?? 'Untitled Story',
		passages: await Promise.all(
			story.passages.map((passage, index) =>
				readDescriptorPassage(
					rootPath,
					storyId,
					passage,
					descriptor.layout[passage.id as string],
					aggregatePassages?.[index]
				)
			)
		),
		script: scriptPath ? ((await readTextIfPresent(scriptPath)) ?? '') : '',
		snapToGrid: story.snap_to_grid ?? true,
		startPassageId:
			story.start_passage ?? (story.passages[0]?.id as string) ?? '',
		storyFormat: story.story_format ?? '',
		storyFormatVersion: story.story_format_version ?? '',
		stylesheet: stylesheetPath
			? ((await readTextIfPresent(stylesheetPath)) ?? '')
			: '',
		tagColors: story.tag_colors ?? {},
		tags: story.tags ?? [],
		zoom: story.zoom ?? 1
	};
}

function descriptorPathMap(descriptor: NativeProjectDescriptor) {
	const paths = new Map<
		string,
		{
			kind: 'passage' | 'script' | 'stylesheet';
			passageIds?: string[];
			storyId: string;
		}
	>();

	for (const story of descriptor.stories) {
		const storyId = story.id as string;

		if (story.script) {
			paths.set(story.script.replace(/\\/g, '/'), {kind: 'script', storyId});
		}
		if (story.stylesheet) {
			paths.set(story.stylesheet.replace(/\\/g, '/'), {
				kind: 'stylesheet',
				storyId
			});
		}
		if (sourceLayoutForStory(story) === 'single-twee' && story.source) {
			paths.set(story.source.replace(/\\/g, '/'), {
				kind: 'passage',
				passageIds: story.passages.map(passage => passage.id as string),
				storyId
			});
		} else {
			for (const passage of story.passages) {
				if (!passage.file) {
					continue;
				}
				const projectPath = passage.file.replace(/\\/g, '/');
				const existing = paths.get(projectPath);

				if (existing?.kind === 'passage') {
					existing.passageIds = [
						...(existing.passageIds ?? []),
						passage.id as string
					];
				} else {
					paths.set(projectPath, {
						kind: 'passage',
						passageIds: [passage.id as string],
						storyId
					});
				}
			}
		}
	}

	return paths;
}

function descriptorFromStories(stories: Story[]): NativeProjectDescriptor {
	const descriptor: NativeProjectDescriptor = {
		layout: Object.fromEntries(
			stories.flatMap(story =>
				story.passages.map(passage => [
					passage.id,
					{
						height: passage.height,
						left: passage.left,
						top: passage.top,
						width: passage.width
					}
				])
			)
		),
		layoutDataJson: '{}',
		name: stories[0]?.name ?? '',
		paths: new Map(),
		schemaVersion: 1,
		stories: stories.map(story => ({
			ifid: story.ifid,
			id: story.id,
			name: story.name,
			passages: story.passages.map(passage => ({
				file: '',
				id: passage.id,
				name: passage.name,
				tags: passage.tags
			})),
			source_layout: 'passage-files',
			snap_to_grid: story.snapToGrid,
			start_passage: story.startPassage,
			story_format: story.storyFormat,
			story_format_version: story.storyFormatVersion,
			tag_colors: story.tagColors,
			tags: story.tags,
			zoom: story.zoom
		}))
	};

	descriptor.paths = descriptorPathMap(descriptor);
	return descriptor;
}

function descriptorFromBaselineReceipt(
	stories: Story[],
	receipt: NativeProjectBaselineReceipt
) {
	const descriptor = descriptorFromStories(stories);
	const sourcesByStory = new Map<string, typeof receipt.files>();

	for (const source of receipt.files) {
		if (!source.storyId) {
			continue;
		}
		const sources = sourcesByStory.get(source.storyId) ?? [];

		sources.push(source);
		sourcesByStory.set(source.storyId, sources);
	}
	for (const story of descriptor.stories) {
		const sources = sourcesByStory.get(story.id as string) ?? [];
		const passageSources = sources.filter(source => source.kind === 'passage');
		const passagePaths = new Map(
			passageSources
				.filter(source => source.passageId)
				.map(source => [source.passageId as string, source.path] as const)
		);
		const aggregatePath =
			new Set(passageSources.map(source => source.path)).size === 1
				? passageSources[0]?.path
				: undefined;
		const aggregateSource = passageSources.some(
			source => source.passageId === undefined
		);

		story.script = sources.find(source => source.kind === 'script')?.path ?? '';
		story.stylesheet =
			sources.find(source => source.kind === 'stylesheet')?.path ?? '';
		if (
			aggregatePath &&
			(aggregateSource ||
				story.passages.length > 1 ||
				aggregatePath === 'story.twee')
		) {
			story.source = aggregatePath;
			story.source_layout = 'single-twee';
			for (const passage of story.passages) {
				delete passage.file;
			}
		} else {
			for (const passage of story.passages) {
				passage.file = passagePaths.get(passage.id as string) ?? '';
			}
		}
	}
	descriptor.layoutDataJson = canonicalJsonString(
		JSON.parse(receipt.layoutDataJson) as unknown
	);
	descriptor.paths = descriptorPathMap(descriptor);
	return descriptor;
}

async function writeJsonAtomic(path: string, data: unknown) {
	const tempPath = `${path}.${uuid()}.tmp`;

	try {
		await writeFile(tempPath, `${JSON.stringify(data)}\n`, 'utf8');
		await move(tempPath, path, {overwrite: true});
	} catch (error) {
		await remove(tempPath).catch(() => undefined);
		throw error;
	}
}

function escapeRegExp(value: string) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pathLooksLikeUrl(path: string) {
	return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path) || path.startsWith('//');
}

function isPathInside(rootPath: string, candidatePath: string) {
	const relativePath = relative(rootPath, candidatePath);

	return relativePath === '' || !relativePath.startsWith('..');
}

function normalizedRelativePath(rootPath: string, candidatePath: string) {
	return relative(rootPath, candidatePath).replace(/\\/g, '/');
}

function isImportAssetFile(path: string) {
	return importAssetExtensions.has(extname(path).toLowerCase());
}

function isObviousImportAssetDirectory(name: string, htmlBaseName: string) {
	const lower = name.toLowerCase();
	const compact = lower.replace(/[\s._-]+/g, '-');
	const htmlCompact = htmlBaseName.toLowerCase().replace(/[\s._-]+/g, '-');

	if (lower.startsWith('.') || lower === '__macosx') {
		return false;
	}

	return (
		obviousImportAssetDirectoryNames.has(lower) ||
		compact.endsWith('-assets') ||
		compact.endsWith('-media') ||
		compact === `${htmlCompact}-files`
	);
}

function importAssetTargetPath(relativeSourcePath: string) {
	const normalized = relativeSourcePath
		.replace(/\\/g, '/')
		.replace(/^(\.\/)+/, '')
		.split('/')
		.filter(segment => segment.length > 0)
		.join('/');

	if (normalized.toLowerCase().startsWith('assets/')) {
		return normalized;
	}

	return `assets/${normalized}`;
}

async function addImportAsset(
	assets: Map<string, NativeProjectImportAsset>,
	sourceRoot: string,
	sourcePath: string
) {
	const relativeSourcePath = normalizedRelativePath(sourceRoot, sourcePath);

	if (
		relativeSourcePath === '' ||
		relativeSourcePath.startsWith('..') ||
		!isImportAssetFile(relativeSourcePath)
	) {
		return;
	}

	const targetPath = importAssetTargetPath(relativeSourcePath);

	assets.set(targetPath.toLowerCase(), {
		originalPath: relativeSourcePath,
		sourcePath,
		targetPath
	});
}

async function scanImportAssetDirectory(
	assets: Map<string, NativeProjectImportAsset>,
	sourceRoot: string,
	directory: string
) {
	let names: string[];

	try {
		names = await readdir(directory);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return;
		}

		throw error;
	}

	for (const name of names) {
		const absolutePath = join(directory, name);
		const fileStats = await stat(absolutePath);

		if (fileStats.isDirectory()) {
			await scanImportAssetDirectory(assets, sourceRoot, absolutePath);
			continue;
		}

		if (fileStats.isFile()) {
			await addImportAsset(assets, sourceRoot, absolutePath);
		}
	}
}

function importAssetReferencePath(reference: string) {
	const normalized = reference.replace(/\\/g, '/').replace(/^(\.\/)+/, '');

	if (
		normalized.startsWith('/') ||
		pathLooksLikeUrl(normalized) ||
		normalized.split('/').some(segment => segment === '..')
	) {
		return undefined;
	}

	try {
		return decodeURIComponent(normalized);
	} catch {
		return normalized;
	}
}

async function addReferencedImportAssets(
	assets: Map<string, NativeProjectImportAsset>,
	sourceRoot: string,
	htmlSource: string
) {
	for (
		let match = importAssetReferenceRegex.exec(htmlSource);
		match;
		match = importAssetReferenceRegex.exec(htmlSource)
	) {
		const referencePath = importAssetReferencePath(match[1]);

		if (!referencePath) {
			continue;
		}

		const absolutePath = resolve(sourceRoot, referencePath);

		if (!isPathInside(sourceRoot, absolutePath)) {
			continue;
		}

		try {
			const fileStats = await stat(absolutePath);

			if (fileStats.isFile()) {
				await addImportAsset(assets, sourceRoot, absolutePath);
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error;
			}
		}
	}
}

async function discoverProjectImportAssets(
	sourceRoot: string,
	htmlFilePath: string,
	htmlSource: string
) {
	const assets = new Map<string, NativeProjectImportAsset>();
	const htmlBaseName = basename(htmlFilePath, extname(htmlFilePath));
	let names: string[];

	try {
		names = await readdir(sourceRoot);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return [];
		}

		throw error;
	}

	for (const name of names) {
		const absolutePath = join(sourceRoot, name);
		const fileStats = await stat(absolutePath);

		if (
			fileStats.isDirectory() &&
			isObviousImportAssetDirectory(name, htmlBaseName)
		) {
			await scanImportAssetDirectory(assets, sourceRoot, absolutePath);
		}
	}

	await addReferencedImportAssets(assets, sourceRoot, htmlSource);

	return [...assets.values()].sort((left, right) =>
		left.targetPath.localeCompare(right.targetPath)
	);
}

function importAssetRewriteRoots(assets: NativeProjectImportAsset[]) {
	const roots = new Map<string, {originalRoot: string; targetRoot: string}>();

	for (const asset of assets) {
		const originalRoot = asset.originalPath.split('/')[0];
		const targetSegments = asset.targetPath.split('/');

		if (
			!originalRoot ||
			originalRoot.toLowerCase() === 'assets' ||
			targetSegments.length < 2
		) {
			continue;
		}

		roots.set(originalRoot.toLowerCase(), {
			originalRoot,
			targetRoot: `${targetSegments[0]}/${targetSegments[1]}`
		});
	}

	return [...roots.values()].sort(
		(left, right) => right.originalRoot.length - left.originalRoot.length
	);
}

function rewriteProjectImportAssetReferences(
	htmlSource: string,
	assets: NativeProjectImportAsset[]
) {
	return importAssetRewriteRoots(assets).reduce(
		(source, {originalRoot, targetRoot}) =>
			source.replace(
				new RegExp(
					`(^|[^A-Za-z0-9_./~%:-])(\\./)?${escapeRegExp(originalRoot)}/`,
					'gi'
				),
				(_match, prefix: string) => `${prefix}${targetRoot}/`
			),
		htmlSource
	);
}

async function findTwineHtmlFiles(rootPath: string) {
	const results: string[] = [];

	async function scan(directory: string) {
		let names: string[];

		try {
			names = await readdir(directory);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				return;
			}

			throw error;
		}

		for (const name of names) {
			if (name.toLowerCase() === '__macosx') {
				continue;
			}

			const absolutePath = join(directory, name);
			const fileStats = await stat(absolutePath);

			if (fileStats.isDirectory()) {
				await scan(absolutePath);
				continue;
			}

			if (!fileStats.isFile() || !/\.html?$/i.test(name)) {
				continue;
			}

			const source = await readFile(absolutePath, 'utf8');

			if (/<tw-storydata[\s>]/i.test(source)) {
				results.push(absolutePath);
			}
		}
	}

	await scan(rootPath);

	return results;
}

function bestTwineHtmlFile(
	rootPath: string,
	sourcePath: string,
	htmlFiles: string[]
) {
	const sourceBaseName = basename(sourcePath, extname(sourcePath))
		.toLowerCase()
		.replace(/\.zip$/, '');

	return [...htmlFiles].sort((left, right) => {
		const leftBase = basename(left, extname(left)).toLowerCase();
		const rightBase = basename(right, extname(right)).toLowerCase();
		const leftRelative = normalizedRelativePath(rootPath, left);
		const rightRelative = normalizedRelativePath(rootPath, right);
		const leftScore = [
			leftBase === sourceBaseName ? 0 : 1,
			leftBase.includes(sourceBaseName) ? 0 : 1,
			leftRelative.split('/').length,
			leftRelative.length
		];
		const rightScore = [
			rightBase === sourceBaseName ? 0 : 1,
			rightBase.includes(sourceBaseName) ? 0 : 1,
			rightRelative.split('/').length,
			rightRelative.length
		];

		for (let index = 0; index < leftScore.length; index++) {
			if (leftScore[index] !== rightScore[index]) {
				return leftScore[index] - rightScore[index];
			}
		}

		return leftRelative.localeCompare(rightRelative);
	})[0];
}

function safeProjectFilePath(rootPath: string, projectPath?: string) {
	if (!projectPath) {
		return undefined;
	}

	const absolutePath = resolve(rootPath, projectPath);
	const relativePath = relative(rootPath, absolutePath);

	if (relativePath === '' || relativePath.startsWith('..')) {
		throw new Error(`Unsafe project file path "${projectPath}".`);
	}

	return absolutePath;
}

function numberOrFallback(value: unknown, fallback: number) {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function booleanOrFallback(value: unknown, fallback: boolean) {
	return typeof value === 'boolean' ? value : fallback;
}

function stringOrFallback(value: unknown, fallback: string) {
	return typeof value === 'string' ? value : fallback;
}

function storyFormatCanBeSugarCubeRepaired(format: string) {
	const normalized = format.trim().toLowerCase();

	return normalized === '' || normalized === 'harlowe';
}

function sourceLooksLikeSugarCube(source?: string) {
	return typeof source === 'string' && sugarCubeMacroSignalRegex.test(source);
}

function storyTextLooksLikeSugarCube(story: Story) {
	return (
		sourceLooksLikeSugarCube(story.script) ||
		sourceLooksLikeSugarCube(story.stylesheet) ||
		story.passages.some(passage => sourceLooksLikeSugarCube(passage.text))
	);
}

function passageTagsLookLikeSugarCube(tags?: string[]) {
	return tags?.some(tag => sugarCubeSignalTags.has(tag.toLowerCase())) ?? false;
}

function storyTagsLookLikeSugarCube(story: Story) {
	return story.passages.some(passage =>
		passageTagsLookLikeSugarCube(passage.tags)
	);
}

function parsedStoryTagsLookLikeSugarCube(story?: ParsedProjectStory) {
	return (
		story?.passages.some(passage =>
			passageTagsLookLikeSugarCube(passage.tags)
		) ?? false
	);
}

function parsedStoriesByIdentity(stories: ParsedProjectStory[]) {
	return new Map(
		stories.flatMap((story, index) => {
			const entries: Array<[string, ParsedProjectStory]> = [
				[`index:${index}`, story]
			];

			if (story.id) {
				entries.push([`id:${story.id}`, story]);
			}

			return entries;
		})
	);
}

function repairStoryFormatFromProjectSignals(
	story: Story,
	parsedStory?: ParsedProjectStory
) {
	if (!storyFormatCanBeSugarCubeRepaired(story.storyFormat)) {
		return story;
	}

	if (
		!storyTextLooksLikeSugarCube(story) &&
		!storyTagsLookLikeSugarCube(story) &&
		!parsedStoryTagsLookLikeSugarCube(parsedStory)
	) {
		return story;
	}

	return {
		...story,
		storyFormat: 'SugarCube',
		storyFormatVersion: ''
	};
}

function repairProjectStoryFormats(
	stories: Story[],
	parsedStories: ParsedProjectStory[] = []
) {
	if (
		!stories.some(story => storyFormatCanBeSugarCubeRepaired(story.storyFormat))
	) {
		return stories;
	}

	const parsedByIdentity = parsedStoriesByIdentity(parsedStories);
	let repaired = false;
	const result = stories.map((story, index) => {
		const parsedStory =
			parsedByIdentity.get(`id:${story.id}`) ??
			parsedByIdentity.get(`index:${index}`);
		const repairedStory = repairStoryFormatFromProjectSignals(
			story,
			parsedStory
		);

		if (repairedStory !== story) {
			repaired = true;
		}

		return repairedStory;
	});

	return repaired ? result : stories;
}

function tomlString(value: string) {
	return JSON.stringify(value ?? '');
}

function tomlStringArray(values: string[]) {
	return `[${values.map(tomlString).join(', ')}]`;
}

function projectRootForStory(story: Story, preferredParent?: string) {
	const parent = preferredParent?.trim()
		? preferredParent.trim()
		: join(getStoryDirectoryPath(), 'Projects');
	const folderName = `${storyPathSlug(story)}.twine.rs`;

	return basename(parent) === folderName ? parent : join(parent, folderName);
}

function passageFileName(index: number, passageName: string) {
	return `${String(index + 1).padStart(4, '0')}-${pathSlug(passageName)}.twee`;
}

function projectToml(
	story: Story,
	passageFiles: string[],
	sourceLayout: ProjectSourceLayout = 'passage-files',
	aggregateSource = 'story.twee'
) {
	const storySlug = storyPathSlug(story);
	const lastUpdate =
		story.lastUpdate instanceof Date
			? story.lastUpdate
			: new Date(story.lastUpdate);
	const lines = [
		'schema_version = 1',
		'app_version = "twine.rs-desktop"',
		`name = ${tomlString(story.name)}`,
		'',
		'[storage]',
		'kind = "project-folder"',
		'message = "Native twine.rs desktop project folder"',
		'',
		'[library]',
		`sort_order = ${tomlStringArray([story.id])}`,
		'',
		'[[stories]]',
		`id = ${tomlString(story.id)}`,
		`ifid = ${tomlString(story.ifid)}`,
		`last_update = ${tomlString(lastUpdate.toISOString())}`,
		`name = ${tomlString(story.name)}`,
		`script = ${tomlString(`scripts/${storySlug}.js`)}`,
		`snap_to_grid = ${story.snapToGrid ? 'true' : 'false'}`,
		...(sourceLayout === 'single-twee'
			? [
					'source_layout = "single-twee"',
					`source = ${tomlString(aggregateSource)}`
				]
			: []),
		`start_passage = ${tomlString(story.startPassage)}`,
		`story_format = ${tomlString(story.storyFormat)}`,
		`story_format_version = ${tomlString(story.storyFormatVersion)}`,
		`stylesheet = ${tomlString(`styles/${storySlug}.css`)}`,
		`tags = ${tomlStringArray(story.tags)}`,
		`zoom = ${story.zoom}`,
		''
	];

	for (const [index, passage] of story.passages.entries()) {
		lines.push(
			'[[stories.passages]]',
			`id = ${tomlString(passage.id)}`,
			`name = ${tomlString(passage.name)}`,
			...(sourceLayout === 'passage-files'
				? [`file = ${tomlString(passageFiles[index])}`]
				: []),
			`tags = ${tomlStringArray(passage.tags)}`,
			''
		);
	}

	return `${lines.join('\n')}\n`;
}

interface TomlTableHeader {
	array: boolean;
	name: string;
	start: number;
}

interface TomlLexicalState {
	curlyDepth: number;
	squareDepth: number;
	string:
		'basic' | 'literal' | 'multiline-basic' | 'multiline-literal' | undefined;
}

function cleanTomlLexicalState(): TomlLexicalState {
	return {curlyDepth: 0, squareDepth: 0, string: undefined};
}

function tomlStateIsTopLevel(state: TomlLexicalState) {
	return (
		state.string === undefined &&
		state.curlyDepth === 0 &&
		state.squareDepth === 0
	);
}

function scanTomlText(source: string, state: TomlLexicalState) {
	for (let index = 0; index < source.length; index++) {
		const character = source[index];

		if (state.string === 'multiline-basic') {
			if (source.startsWith('"""', index)) {
				state.string = undefined;
				index += 2;
			} else if (character === '\\') {
				index++;
			}
			continue;
		}
		if (state.string === 'multiline-literal') {
			if (source.startsWith("'''", index)) {
				state.string = undefined;
				index += 2;
			}
			continue;
		}
		if (state.string === 'basic') {
			if (character === '\\') {
				index++;
			} else if (character === '"') {
				state.string = undefined;
			}
			continue;
		}
		if (state.string === 'literal') {
			if (character === "'") {
				state.string = undefined;
			}
			continue;
		}
		if (character === '#') {
			return;
		}
		if (source.startsWith('"""', index)) {
			state.string = 'multiline-basic';
			index += 2;
		} else if (source.startsWith("'''", index)) {
			state.string = 'multiline-literal';
			index += 2;
		} else if (character === '"') {
			state.string = 'basic';
		} else if (character === "'") {
			state.string = 'literal';
		} else if (character === '[') {
			state.squareDepth++;
		} else if (character === ']') {
			state.squareDepth = Math.max(0, state.squareDepth - 1);
		} else if (character === '{') {
			state.curlyDepth++;
		} else if (character === '}') {
			state.curlyDepth = Math.max(0, state.curlyDepth - 1);
		}
	}
}

function tomlTableHeaders(source: string): TomlTableHeader[] {
	const headers: TomlTableHeader[] = [];
	const state = cleanTomlLexicalState();
	let offset = 0;

	for (const line of source.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) ?? []) {
		if (!line) {
			continue;
		}
		const content = line.replace(/\r?\n$|\r$/, '');
		const match = tomlStateIsTopLevel(state)
			? /^[ \t]*(\[\[?)([^\]\r\n]+)(\]\]?)[ \t]*(?:#.*)?$/.exec(content)
			: undefined;

		if (match && match[1].length === match[3].length) {
			headers.push({
				array: match[1] === '[[',
				name: match[2].trim(),
				start: offset
			});
		} else {
			scanTomlText(content, state);
		}
		offset += line.length;
	}

	return headers;
}

function tomlValueSpan(source: string, start: number) {
	const state = cleanTomlLexicalState();
	let topLevelComment = -1;

	for (let index = start; index < source.length; index++) {
		const character = source[index];

		if (
			(character === '\n' || character === '\r') &&
			tomlStateIsTopLevel(state)
		) {
			return {comment: topLevelComment, end: index};
		}
		if (state.string === 'multiline-basic') {
			if (source.startsWith('"""', index)) {
				state.string = undefined;
				index += 2;
			} else if (character === '\\') {
				index++;
			}
			continue;
		}
		if (state.string === 'multiline-literal') {
			if (source.startsWith("'''", index)) {
				state.string = undefined;
				index += 2;
			}
			continue;
		}
		if (state.string === 'basic') {
			if (character === '\\') {
				index++;
			} else if (character === '"') {
				state.string = undefined;
			}
			continue;
		}
		if (state.string === 'literal') {
			if (character === "'") {
				state.string = undefined;
			}
			continue;
		}
		if (character === '#') {
			if (tomlStateIsTopLevel(state) && topLevelComment === -1) {
				topLevelComment = index;
			}
			const newline = source.slice(index).search(/\r|\n/);

			if (newline === -1) {
				return {comment: topLevelComment, end: source.length};
			}
			index += newline - 1;
			continue;
		}
		if (source.startsWith('"""', index)) {
			state.string = 'multiline-basic';
			index += 2;
		} else if (source.startsWith("'''", index)) {
			state.string = 'multiline-literal';
			index += 2;
		} else if (character === '"') {
			state.string = 'basic';
		} else if (character === "'") {
			state.string = 'literal';
		} else if (character === '[') {
			state.squareDepth++;
		} else if (character === ']') {
			state.squareDepth = Math.max(0, state.squareDepth - 1);
		} else if (character === '{') {
			state.curlyDepth++;
		} else if (character === '}') {
			state.curlyDepth = Math.max(0, state.curlyDepth - 1);
		}
	}

	return {comment: topLevelComment, end: source.length};
}

function tomlDirectAssignment(table: string, key: string) {
	const state = cleanTomlLexicalState();
	const pattern = new RegExp(`^[ \\t]*${escapeRegExp(key)}[ \\t]*=[ \\t]*`);
	let offset = 0;

	for (const line of table.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) ?? []) {
		if (!line) {
			continue;
		}
		const content = line.replace(/\r?\n$|\r$/, '');
		const match = tomlStateIsTopLevel(state)
			? pattern.exec(content)
			: undefined;

		if (match) {
			const start = offset + match[0].length;

			return {start, ...tomlValueSpan(table, start)};
		}
		scanTomlText(content, state);
		offset += line.length;
	}

	return undefined;
}

function tomlDirectValue(table: string, key: string) {
	const assignment = tomlDirectAssignment(table, key);

	if (!assignment) {
		return undefined;
	}

	return parseTomlValue(
		stripTomlComment(table.slice(assignment.start, assignment.end))
	);
}

function rewriteTomlDirectValue(table: string, key: string, value: string) {
	const assignment = tomlDirectAssignment(table, key);

	if (assignment) {
		const raw = table.slice(assignment.start, assignment.end);
		const relativeComment =
			assignment.comment === -1 ? -1 : assignment.comment - assignment.start;
		let suffix = '';

		if (relativeComment >= 0) {
			const beforeComment = raw.slice(0, relativeComment);

			suffix = `${beforeComment.match(/[ \t]*$/)?.[0] ?? ''}${raw.slice(
				relativeComment
			)}`;
		}

		return `${table.slice(0, assignment.start)}${value}${suffix}${table.slice(
			assignment.end
		)}`;
	}

	const newline = table.includes('\r\n') ? '\r\n' : '\n';
	const trailing = table.match(/(?:\r?\n[ \t]*)+$/)?.[0] ?? '';
	const body = trailing ? table.slice(0, -trailing.length) : table;

	return `${body}${newline}${key} = ${value}${trailing || newline}`;
}

function mergePassageMetadataIntoManifest(
	source: string,
	storyId: string,
	passages: Passage[]
) {
	const headers = tomlTableHeaders(source);
	const storyHeaders = headers.filter(
		header => header.array && header.name === 'stories'
	);
	const storyIndex = storyHeaders.findIndex((header, index) => {
		const nextStoryStart = storyHeaders[index + 1]?.start ?? source.length;
		const nextTableStart =
			headers.find(
				candidate =>
					candidate.start > header.start && candidate.start < nextStoryStart
			)?.start ?? nextStoryStart;

		return (
			tomlDirectValue(source.slice(header.start, nextTableStart), 'id') ===
			storyId
		);
	});

	if (storyIndex === -1) {
		return undefined;
	}

	const storyStart = storyHeaders[storyIndex].start;
	const storyEnd = storyHeaders[storyIndex + 1]?.start ?? source.length;
	const storyTables = headers.filter(
		header => header.start >= storyStart && header.start < storyEnd
	);
	const passageTables = storyTables.filter(
		header => header.array && header.name === 'stories.passages'
	);
	const replacements: Array<{end: number; start: number; text: string}> = [];

	for (const passage of passages) {
		const tableIndex = passageTables.findIndex(header => {
			const end =
				storyTables.find(candidate => candidate.start > header.start)?.start ??
				storyEnd;

			return (
				tomlDirectValue(source.slice(header.start, end), 'id') === passage.id
			);
		});

		if (tableIndex === -1) {
			return undefined;
		}
		const start = passageTables[tableIndex].start;
		const end =
			storyTables.find(candidate => candidate.start > start)?.start ?? storyEnd;
		let table = source.slice(start, end);

		table = rewriteTomlDirectValue(table, 'name', tomlString(passage.name));
		table = rewriteTomlDirectValue(
			table,
			'tags',
			tomlStringArray(passage.tags)
		);
		replacements.push({end, start, text: table});
	}

	return replacements
		.sort((left, right) => right.start - left.start)
		.reduce(
			(result, replacement) =>
				`${result.slice(0, replacement.start)}${replacement.text}${result.slice(
					replacement.end
				)}`,
			source
		);
}

function appendPassageMappingToManifest(
	source: string,
	storyId: string,
	passage: ParsedProjectPassage
) {
	if (!passage.id) {
		return source;
	}
	const headers = tomlTableHeaders(source);
	const storyHeaders = headers.filter(
		header => header.array && header.name === 'stories'
	);
	const storyHeaderIndex = storyHeaders.findIndex((header, index) => {
		const end = storyHeaders[index + 1]?.start ?? source.length;
		const firstNestedTable =
			headers.find(
				candidate => candidate.start > header.start && candidate.start < end
			)?.start ?? end;

		return (
			tomlDirectValue(source.slice(header.start, firstNestedTable), 'id') ===
			storyId
		);
	});

	if (storyHeaderIndex === -1) {
		throw new Error(`Story "${storyId}" is missing from twine.toml.`);
	}

	const storyStart = storyHeaders[storyHeaderIndex].start;
	const insertion = storyHeaders[storyHeaderIndex + 1]?.start ?? source.length;
	const storyTables = headers.filter(
		header => header.start >= storyStart && header.start < insertion
	);
	const alreadyMapped = storyTables
		.filter(header => header.array && header.name === 'stories.passages')
		.some(header => {
			const end =
				storyTables.find(candidate => candidate.start > header.start)?.start ??
				insertion;

			return (
				tomlDirectValue(source.slice(header.start, end), 'id') === passage.id
			);
		});

	if (alreadyMapped) {
		return source;
	}

	const before = source.slice(0, insertion).trimEnd();
	const after = source.slice(insertion).replace(/^\s*/, '');
	const block = [
		'[[stories.passages]]',
		`id = ${tomlString(passage.id)}`,
		`name = ${tomlString(passage.name ?? 'Untitled Passage')}`,
		`tags = ${tomlStringArray(passage.tags ?? [])}`
	].join('\n');

	return `${before}\n\n${block}\n${after ? `\n${after}` : ''}`;
}

async function persistAggregatePassageMappings(
	rootPath: string,
	mappings: NonNullable<ProjectSessionCandidate['passageMappingsToPersist']>
) {
	const path = join(rootPath, 'twine.toml');
	const existing = await readTextIfPresent(path);

	if (!existing) {
		throw new Error('Project manifest not found while persisting passage IDs.');
	}
	const updated = mappings.reduce(
		(source, mapping) =>
			appendPassageMappingToManifest(source, mapping.storyId, mapping.passage),
		existing
	);

	if (updated !== existing) {
		await atomicWriteText(path, updated);
	}

	return {existing, updated};
}

function aggregatePassageMappingSourcePaths(
	candidate: ProjectSessionCandidate
) {
	const mappings = candidate.passageMappingsToPersist ?? [];
	const stories = descriptorStoryMap(candidate.descriptor);
	const sourcePaths = new Set(
		mappings.flatMap(mapping => {
			const story = stories.get(mapping.storyId);
			const source =
				story && sourceLayoutForStory(story) === 'single-twee'
					? story.source?.replace(/\\/g, '/')
					: undefined;

			return source ? [source] : [];
		})
	);

	if (
		sourcePaths.size === 0 ||
		mappings.some(mapping => !stories.get(mapping.storyId)?.source)
	) {
		return undefined;
	}

	return sourcePaths;
}

function aggregatePassageMappingsMatchFiles(
	candidate: ProjectSessionCandidate,
	currentFiles: NativeProjectFileEntry[]
) {
	const sourcePaths = aggregatePassageMappingSourcePaths(candidate);

	if (!sourcePaths) {
		return false;
	}
	const expectedByPath = new Map(
		candidate.baseline.files.map(file => [file.path, file] as const)
	);
	const currentByPath = new Map(
		currentFiles.map(file => [file.path, file] as const)
	);

	return [...sourcePaths].every(
		path =>
			expectedByPath.get(path)?.fingerprint ===
			currentByPath.get(path)?.fingerprint
	);
}

async function aggregatePassageMappingsAreCurrent(
	rootPath: string,
	candidate: ProjectSessionCandidate
) {
	return aggregatePassageMappingsMatchFiles(
		candidate,
		await projectFileManifest(rootPath, candidate.baseline.assets)
	);
}

function graphLayout(story: Story) {
	return {
		passages: Object.fromEntries(
			story.passages.map(passage => [
				passage.id,
				{
					height: passage.height,
					left: passage.left,
					top: passage.top,
					width: passage.width
				}
			])
		)
	};
}

function rendererProjectMetadata(story: Story): RendererProjectMetadataStory {
	return {
		ifid: story.ifid,
		id: story.id,
		lastUpdate: story.lastUpdate,
		name: story.name,
		passages: story.passages.map(passage => ({
			height: passage.height,
			highlighted: passage.highlighted,
			id: passage.id,
			left: passage.left,
			name: passage.name,
			selected: passage.selected,
			story: passage.story,
			tags: passage.tags,
			top: passage.top,
			width: passage.width
		})),
		script: story.script,
		selected: story.selected,
		snapToGrid: story.snapToGrid,
		startPassage: story.startPassage,
		storyFormat: story.storyFormat,
		storyFormatVersion: story.storyFormatVersion,
		stylesheet: story.stylesheet,
		tagColors: story.tagColors,
		tags: story.tags,
		zoom: story.zoom
	};
}

function reviveMetadataStory(
	story: RendererProjectMetadataStory
): RendererProjectMetadataStory {
	return {
		...story,
		lastUpdate: story.lastUpdate ? new Date(story.lastUpdate) : undefined
	};
}

function dateOrFallback(value: Date | string | undefined, fallback: Date) {
	const date =
		value instanceof Date ? value : value ? new Date(value) : fallback;

	return Number.isNaN(date.getTime()) ? fallback : date;
}

function stringArrayOrFallback(value: unknown, fallback: string[]) {
	if (!Array.isArray(value)) {
		return fallback;
	}

	return value.filter((item): item is string => typeof item === 'string');
}

function passageFromMetadata(
	passage: RendererProjectMetadataPassage,
	storyId: string,
	passageIndex: number
): Passage {
	const passageId = passage.id ?? `${storyId}-passage-${passageIndex + 1}`;

	return {
		height: numberOrFallback(passage.height, 100),
		highlighted: booleanOrFallback(passage.highlighted, false),
		id: passageId,
		left: numberOrFallback(passage.left, 0),
		name: stringOrFallback(passage.name, `Passage ${passageIndex + 1}`),
		selected: booleanOrFallback(passage.selected, false),
		story: storyId,
		tags: stringArrayOrFallback(passage.tags, []),
		text: stringOrFallback(passage.text, ''),
		top: numberOrFallback(passage.top, 0),
		width: numberOrFallback(passage.width, 100)
	};
}

function storyFromMetadata(
	story: RendererProjectMetadataStory,
	storyIndex: number
): Story {
	const storyId = stringOrFallback(
		story.id,
		`story-${storyIndex + 1}-${pathSlug(story.name ?? '')}`
	);
	const passages = (story.passages ?? []).map((passage, passageIndex) =>
		passageFromMetadata(passage, storyId, passageIndex)
	);

	return {
		ifid: stringOrFallback(story.ifid, storyId.toUpperCase()),
		id: storyId,
		lastUpdate: dateOrFallback(story.lastUpdate, new Date()),
		name: stringOrFallback(story.name, `Untitled Story ${storyIndex + 1}`),
		passages,
		script: stringOrFallback(story.script, ''),
		selected: booleanOrFallback(story.selected, false),
		snapToGrid: booleanOrFallback(story.snapToGrid, true),
		startPassage: stringOrFallback(story.startPassage, passages[0]?.id ?? ''),
		storyFormat: stringOrFallback(story.storyFormat, ''),
		storyFormatVersion: stringOrFallback(story.storyFormatVersion, ''),
		stylesheet: stringOrFallback(story.stylesheet, ''),
		tagColors: story.tagColors ?? {},
		tags: stringArrayOrFallback(story.tags, []),
		zoom: numberOrFallback(story.zoom, 1)
	};
}

async function metadataSidecarStories(
	path: string,
	options: {maxBytes?: number} = {}
) {
	if (options.maxBytes !== undefined) {
		try {
			const fileStats = await stat(path);

			if (fileStats.size > options.maxBytes) {
				return [];
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				return [];
			}

			throw error;
		}
	}

	const data = await readJsonIfPresent<{
		stories?: RendererProjectMetadataStory[];
	}>(path, {ignoreInvalidJson: true});

	return (data?.stories ?? []).map(reviveMetadataStory);
}

function safeProjectAssetPath(rootPath: string, assetPath: string) {
	const projectPath = localAssetReferencePath(assetPath);

	if (!projectPath) {
		throw new Error(`Unsafe project asset path "${assetPath}".`);
	}

	const assetRoot = resolve(rootPath, 'assets');
	const absolutePath = resolve(rootPath, projectPath);
	const relativePath = relative(assetRoot, absolutePath);

	if (relativePath === '' || relativePath.startsWith('..')) {
		throw new Error(`Unsafe project asset path "${assetPath}".`);
	}

	return {absolutePath, projectPath};
}

function projectAssetInventoryEntry(
	projectPath: string,
	absolutePath: string,
	fileStats: Awaited<ReturnType<typeof stat>>
): CoreAssetInventoryEntry {
	const kind = assetKindForPath(projectPath);
	const previewUrl = fileUrlForPath(absolutePath);

	return {
		durationMs: null,
		exists: true,
		height: null,
		kind,
		missing: false,
		modifiedAt: fileStats.mtime.toISOString(),
		normalizedPath: normalizedAssetPath(projectPath),
		path: projectPath,
		previewUrl,
		publish: {
			copy: true,
			outputPath: projectPath,
			reason: 'Copy asset into published output'
		},
		referenceCount: 0,
		references: [],
		sizeBytes: fileStats.size,
		snippet: assetSnippet(projectPath, kind),
		thumbnailUrl: kind === 'image' ? previewUrl : null,
		unused: true,
		width: null
	};
}

async function scanAssetDirectory(
	rootPath: string,
	directory: string,
	assets: CoreAssetInventoryEntry[]
) {
	let names: string[];

	try {
		names = await readdir(directory);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return;
		}

		throw error;
	}

	for (const name of names) {
		const absolutePath = join(directory, name);
		const fileStats = await stat(absolutePath);

		if (fileStats.isDirectory()) {
			await scanAssetDirectory(rootPath, absolutePath, assets);
			continue;
		}

		if (!fileStats.isFile()) {
			continue;
		}

		const assetPath = `assets/${relative(
			join(rootPath, 'assets'),
			absolutePath
		).replace(/\\/g, '/')}`;

		assets.push(projectAssetInventoryEntry(assetPath, absolutePath, fileStats));
	}
}

async function scanProjectFiles(
	rootPath: string,
	projectPath: string,
	kind: NativeProjectFileKind,
	files: NativeProjectFileEntry[]
) {
	const absolutePath = safeProjectFilePath(rootPath, projectPath);
	let fileStats: Awaited<ReturnType<typeof stat>>;

	if (!absolutePath) {
		throw Object.assign(new Error(`Unsafe project path: ${projectPath}`), {
			recoveryReason: 'unsafePath'
		});
	}

	try {
		fileStats = await stat(absolutePath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return;
		}

		throw error;
	}

	if (fileStats.isDirectory()) {
		let names: string[];

		try {
			names = await readdir(absolutePath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				return;
			}

			throw error;
		}

		for (const name of names) {
			await scanProjectFiles(
				rootPath,
				`${projectPath}/${name}`.replace(/\\/g, '/'),
				kind,
				files
			);
		}
		return;
	}

	if (!fileStats.isFile()) {
		return;
	}

	files.push({
		fingerprint: `${Math.trunc(fileStats.mtimeMs)}:${fileStats.size}`,
		kind,
		modifiedAt: fileStats.mtime.toISOString(),
		mtimeMs: fileStats.mtimeMs,
		path: projectPath.replace(/\\/g, '/'),
		sizeBytes: fileStats.size
	});
}

function assetProjectFileEntry(
	asset: CoreAssetInventoryEntry
): NativeProjectFileEntry | undefined {
	if (asset.sizeBytes === null || !asset.modifiedAt) {
		return undefined;
	}

	const parsedMtimeMs = Date.parse(asset.modifiedAt);
	const mtimeMs = Number.isFinite(parsedMtimeMs) ? parsedMtimeMs : 0;

	return {
		fingerprint: `${Math.trunc(mtimeMs)}:${asset.sizeBytes}`,
		kind: 'asset',
		modifiedAt: asset.modifiedAt,
		mtimeMs,
		path: asset.path,
		sizeBytes: asset.sizeBytes
	};
}

async function projectFileManifest(
	rootPath: string,
	assets?: CoreAssetInventoryEntry[]
) {
	const nativeManifest = nativeProjectFileManifest(rootPath, assets);

	if (nativeManifest) {
		return nativeManifest;
	}

	if (!legacyProjectFallbackEnabled()) {
		requireNativeProjectBackend('Project file manifest scanning');
	}

	const files: NativeProjectFileEntry[] = [];
	const manifestSource = await readTextIfPresent(join(rootPath, 'twine.toml'));
	const aggregateSources = manifestSource
		? parseProjectToml(manifestSource).flatMap(story =>
				sourceLayoutForStory(story) === 'single-twee' && story.source
					? [story.source.replace(/\\/g, '/')]
					: []
			)
		: [];
	const scans = [
		scanProjectFiles(rootPath, 'twine.toml', 'manifest', files),
		scanProjectFiles(rootPath, '.twine/project.json', 'metadata', files),
		scanProjectFiles(rootPath, '.twine/graph.json', 'graph', files),
		scanProjectFiles(rootPath, 'passages', 'passage', files),
		scanProjectFiles(rootPath, 'scripts', 'script', files),
		scanProjectFiles(rootPath, 'styles', 'stylesheet', files),
		...aggregateSources.map(source =>
			scanProjectFiles(rootPath, source, 'passage', files)
		)
	];

	if (assets) {
		files.push(
			...assets.flatMap(asset => {
				const entry = assetProjectFileEntry(asset);

				return entry ? [entry] : [];
			})
		);
	} else {
		scans.push(scanProjectFiles(rootPath, 'assets', 'asset', files));
	}

	await Promise.all(scans);

	return files.sort((left, right) => left.path.localeCompare(right.path));
}

function projectFileKindForPath(
	path: string
): NativeProjectFileKind | undefined {
	if (path === 'twine.toml') {
		return 'manifest';
	}
	if (path === '.twine/project.json') {
		return 'metadata';
	}
	if (path === '.twine/graph.json') {
		return 'graph';
	}
	if (path === '.twine/cache' || path.startsWith('.twine/cache/')) {
		return undefined;
	}
	if (path === 'passages' || path.startsWith('passages/')) {
		return 'passage';
	}
	if (path === 'story.twee') {
		return 'passage';
	}
	if (path === 'scripts' || path.startsWith('scripts/')) {
		return 'script';
	}
	if (path === 'styles' || path.startsWith('styles/')) {
		return 'stylesheet';
	}
	if (path === 'assets' || path.startsWith('assets/')) {
		return 'asset';
	}

	return undefined;
}

async function projectFileManifestForHints(
	rootPath: string,
	baseline: NativeProjectFileEntry[],
	hints: string[]
) {
	const files = new Map(baseline.map(file => [file.path, file] as const));
	let descriptor: NativeProjectDescriptor | undefined;

	for (const hint of hints) {
		const normalized = hint.replace(/^\.\/+/, '').replace(/\\/g, '/');
		let kind =
			projectFileKindForPath(normalized) ?? files.get(normalized)?.kind;

		if (!kind) {
			descriptor ??= await readProjectDescriptor(rootPath).catch(
				() => undefined
			);
			const mapping = descriptor?.paths.get(normalized);

			if (mapping) {
				kind = mapping.kind;
			}
		}

		if (!kind) {
			continue;
		}
		for (const path of [...files.keys()]) {
			if (path === normalized || path.startsWith(`${normalized}/`)) {
				files.delete(path);
			}
		}
		const changed: NativeProjectFileEntry[] = [];

		await scanProjectFiles(rootPath, normalized, kind, changed);
		for (const entry of changed) {
			files.set(entry.path, entry);
		}
	}

	return [...files.values()].sort((left, right) =>
		left.path.localeCompare(right.path)
	);
}

function projectSessionConflicts(
	previousFiles: NativeProjectFileEntry[],
	currentFiles: NativeProjectFileEntry[]
) {
	const nativeConflicts = diffNativeProjectFileManifest(
		previousFiles,
		currentFiles
	);

	if (nativeConflicts) {
		return nativeConflicts;
	}

	if (!legacyProjectFallbackEnabled()) {
		requireNativeProjectBackend('Project session conflict detection');
	}

	const previous = new Map(previousFiles.map(file => [file.path, file]));
	const current = new Map(currentFiles.map(file => [file.path, file]));
	const conflicts: NativeProjectSessionConflict[] = [];

	for (const [path, currentFile] of current) {
		const previousFile = previous.get(path);

		if (!previousFile) {
			conflicts.push({
				change: 'added',
				current: currentFile,
				id: `added:${path}`,
				kind: currentFile.kind,
				message: `${path} was added outside twine.rs.`,
				path
			});
			continue;
		}

		if (previousFile.fingerprint !== currentFile.fingerprint) {
			conflicts.push({
				change: 'modified',
				current: currentFile,
				id: `modified:${path}`,
				kind: currentFile.kind,
				message: `${path} changed outside twine.rs.`,
				path,
				previous: previousFile
			});
		}
	}

	for (const [path, previousFile] of previous) {
		if (!current.has(path)) {
			conflicts.push({
				change: 'removed',
				id: `removed:${path}`,
				kind: previousFile.kind,
				message: `${path} was removed outside twine.rs.`,
				path,
				previous: previousFile
			});
		}
	}

	return conflicts.sort((left, right) => left.path.localeCompare(right.path));
}

function graphLayoutForPassage(
	graph:
		{passages?: Record<string, Partial<Record<string, number>>>} | undefined,
	passageId: string
) {
	return graph?.passages?.[passageId] ?? {};
}

async function storiesFromProjectManifest(
	rootPath: string,
	metadataStories: RendererProjectMetadataStory[],
	source?: string,
	options: ProjectStoryReadOptions = {}
): Promise<Story[]> {
	const manifestSource =
		source ?? (await readTextIfPresent(join(rootPath, 'twine.toml')));

	if (!manifestSource) {
		return metadataStories.map(storyFromMetadata);
	}

	const parsedStories = parseProjectToml(manifestSource);

	if (parsedStories.length === 0) {
		return metadataStories.map(storyFromMetadata);
	}

	const graph =
		options.loadPassageText === false
			? undefined
			: await readJsonIfPresent<{
					passages?: Record<string, Partial<Record<string, number>>>;
				}>(join(rootPath, '.twine', 'graph.json'), {ignoreInvalidJson: true});
	const metadataById = new Map(
		metadataStories.flatMap(story =>
			story.id ? [[story.id, story] as const] : []
		)
	);
	const stories: Story[] = [];

	for (const [storyIndex, parsedManifest] of parsedStories.entries()) {
		const parsed =
			options.loadPassageText !== false &&
			sourceLayoutForStory(parsedManifest) === 'single-twee'
				? storyWithSingleTweeState(
						parsedManifest,
						await readSingleTweeState(rootPath, parsedManifest)
					)
				: parsedManifest;
		const metadataStory =
			(parsed.id ? metadataById.get(parsed.id) : undefined) ??
			metadataStories[storyIndex];
		const storyId =
			parsed.id ?? metadataStory?.id ?? `story-${pathSlug(parsed.name ?? '')}`;
		const storyName =
			parsed.name ?? metadataStory?.name ?? `Untitled Story ${storyIndex + 1}`;
		const scriptPath = safeProjectFilePath(rootPath, parsed.script);
		const stylesheetPath = safeProjectFilePath(rootPath, parsed.stylesheet);
		const script =
			options.loadPassageText === false
				? ''
				: ((scriptPath ? await readTextIfPresent(scriptPath) : undefined) ??
					metadataStory?.script ??
					'');
		const stylesheet =
			options.loadPassageText === false
				? ''
				: ((stylesheetPath
						? await readTextIfPresent(stylesheetPath)
						: undefined) ??
					metadataStory?.stylesheet ??
					'');
		const metadataPassages = new Map(
			(metadataStory?.passages ?? [])
				.filter(
					(passage): passage is RendererProjectMetadataPassage & {id: string} =>
						typeof passage.id === 'string'
				)
				.map(passage => [passage.id, passage])
		);
		const aggregatePassages =
			options.loadPassageText !== false &&
			sourceLayoutForStory(parsed) === 'single-twee'
				? await readSingleTweePassages(rootPath, parsed)
				: undefined;
		const passages = await Promise.all(
			parsed.passages.map(async (passage, passageIndex) => {
				const passageId =
					passage.id ?? `${storyId}-passage-${String(passageIndex + 1)}`;
				const metadataPassage = metadataPassages.get(passageId);
				const sourcePassage = aggregatePassages?.[passageIndex];
				const passagePath = sourcePassage
					? undefined
					: safeProjectFilePath(rootPath, passage.file);
				const layout = graphLayoutForPassage(graph, passageId);
				const text =
					options.loadPassageText === false
						? ''
						: (sourcePassage?.text ??
							(passagePath
								? await readTextIfPresent(passagePath)
								: undefined) ??
							metadataPassage?.text ??
							'');

				return {
					height: numberOrFallback(
						layout.height,
						metadataPassage?.height ?? 100
					),
					highlighted: metadataPassage?.highlighted ?? false,
					id: passageId,
					left: numberOrFallback(layout.left, metadataPassage?.left ?? 0),
					name:
						sourcePassage?.name ??
						passage.name ??
						metadataPassage?.name ??
						`Passage ${passageIndex + 1}`,
					selected: metadataPassage?.selected ?? false,
					story: storyId,
					tags:
						sourcePassage?.tags ?? passage.tags ?? metadataPassage?.tags ?? [],
					text,
					top: numberOrFallback(layout.top, metadataPassage?.top ?? 0),
					width: numberOrFallback(layout.width, metadataPassage?.width ?? 100)
				};
			})
		);

		stories.push({
			ifid: parsed.ifid ?? metadataStory?.ifid ?? storyId.toUpperCase(),
			id: storyId,
			lastUpdate: new Date(
				parsed.last_update ?? metadataStory?.lastUpdate ?? Date.now()
			),
			name: storyName,
			passages,
			script,
			selected: metadataStory?.selected ?? false,
			snapToGrid: booleanOrFallback(
				parsed.snap_to_grid,
				metadataStory?.snapToGrid ?? true
			),
			startPassage:
				parsed.start_passage ??
				metadataStory?.startPassage ??
				passages[0]?.id ??
				'',
			storyFormat: stringOrFallback(
				parsed.story_format,
				metadataStory?.storyFormat ?? ''
			),
			storyFormatVersion: stringOrFallback(
				parsed.story_format_version,
				metadataStory?.storyFormatVersion ?? ''
			),
			stylesheet,
			tagColors: parsed.tag_colors ?? metadataStory?.tagColors ?? {},
			tags: parsed.tags ?? metadataStory?.tags ?? [],
			zoom: numberOrFallback(parsed.zoom, metadataStory?.zoom ?? 1)
		});
	}

	return repairProjectStoryFormats(stories, parsedStories);
}

async function readProjectStories(
	rootPath: string,
	options: ProjectStoryReadOptions = {}
) {
	return (await readProjectFolder(rootPath, options)).stories;
}

async function readProjectFolder(
	rootPath: string,
	options: ProjectStoryReadOptions = {}
): Promise<NativeProjectFolderResult> {
	const nativeResult = loadNativeProjectFolder(rootPath, options);

	if (nativeResult) {
		return mergeNativeProjectMetadata(rootPath, nativeResult);
	}

	if (!legacyProjectFallbackEnabled()) {
		requireNativeProjectBackend('Project folder loading');
	}

	const manifestSource = await readTextIfPresent(join(rootPath, 'twine.toml'));
	const metadataStories = await metadataSidecarStories(
		join(rootPath, '.twine', 'project.json'),
		manifestSource ? {maxBytes: maxProjectMetadataSidecarBytes} : {}
	);
	const stories = await storiesFromProjectManifest(
		rootPath,
		metadataStories,
		manifestSource,
		options
	);

	return {
		graphLayoutLoaded: options.loadPassageText !== false,
		passageTextLoaded: options.loadPassageText !== false,
		rootPath,
		storySourcesLoaded: options.loadPassageText !== false,
		stories,
		storyIds: stories.map(story => story.id)
	};
}

async function mergeNativeProjectMetadata(
	rootPath: string,
	projectFolder: NativeProjectFolderResult
): Promise<NativeProjectFolderResult> {
	const metadataStories = await metadataSidecarStories(
		join(rootPath, '.twine', 'project.json'),
		{maxBytes: maxProjectMetadataSidecarBytes}
	);

	if (metadataStories.length === 0) {
		const stories = repairProjectStoryFormats(projectFolder.stories);

		return stories === projectFolder.stories
			? projectFolder
			: {...projectFolder, stories};
	}

	const metadataById = new Map(
		metadataStories.flatMap(story =>
			story.id ? [[story.id, story] as const] : []
		)
	);
	const stories = projectFolder.stories.map((story, storyIndex) => {
		const metadataStory =
			metadataById.get(story.id) ?? metadataStories[storyIndex];

		if (!metadataStory) {
			return story;
		}

		const metadataPassages = new Map(
			(metadataStory.passages ?? [])
				.filter(
					(passage): passage is RendererProjectMetadataPassage & {id: string} =>
						typeof passage.id === 'string'
				)
				.map(passage => [passage.id, passage])
		);

		return {
			...story,
			passages: story.passages.map(passage => {
				const metadataPassage = metadataPassages.get(passage.id);
				const useMetadataLayout =
					metadataPassage &&
					passage.left === 0 &&
					passage.top === 0 &&
					passage.width === 100 &&
					passage.height === 100;

				return {
					...passage,
					height: useMetadataLayout
						? numberOrFallback(metadataPassage.height, passage.height)
						: passage.height,
					highlighted: metadataPassage?.highlighted ?? passage.highlighted,
					left: useMetadataLayout
						? numberOrFallback(metadataPassage.left, passage.left)
						: passage.left,
					selected: metadataPassage?.selected ?? passage.selected,
					top: useMetadataLayout
						? numberOrFallback(metadataPassage.top, passage.top)
						: passage.top,
					width: useMetadataLayout
						? numberOrFallback(metadataPassage.width, passage.width)
						: passage.width
				};
			}),
			selected: metadataStory.selected ?? story.selected,
			tagColors:
				Object.keys(story.tagColors).length > 0
					? story.tagColors
					: (metadataStory.tagColors ?? story.tagColors),
			zoom: numberOrFallback(story.zoom, metadataStory.zoom ?? 1)
		};
	});

	const repairedStories = repairProjectStoryFormats(stories);

	return {
		...projectFolder,
		stories: repairedStories
	};
}

async function readProjectSessionSnapshot(
	rootPath: string,
	baseline?: NativeProjectSessionSnapshot,
	hints: ProjectSessionSnapshotHints = {}
): Promise<NativeProjectSessionSnapshot> {
	const hintedStoryIds =
		hints.storyIds ??
		hints.stories?.map(story => story.id) ??
		baseline?.storyIds;
	const [stories, assets] = await Promise.all([
		hints.stories
			? Promise.resolve(hints.stories)
			: hintedStoryIds
				? Promise.resolve([])
				: readProjectStories(rootPath),
		hints.assets ? Promise.resolve(hints.assets) : listProjectAssets(rootPath)
	]);
	const files = await projectFileManifest(rootPath, assets);
	const conflicts = baseline
		? projectSessionConflicts(baseline.files, files)
		: [];

	return {
		assets,
		changedPaths: conflicts.map(conflict => conflict.path),
		conflicts,
		files,
		rootPath,
		scannedAt: new Date().toISOString(),
		stories,
		storyIds: hintedStoryIds ?? stories.map(story => story.id)
	};
}

function emptyStoryMetadataPatch(): StoryMetadataPatch {
	return {
		ifid: null,
		name: null,
		snapToGrid: null,
		storyFormat: null,
		storyFormatVersion: null,
		tagColors: null,
		tags: null,
		zoom: null
	};
}

function emptyPassagePatch(): PassagePatch {
	return {layout: null, name: null, tags: null, text: null};
}

async function manifestExternalChanges(
	rootPath: string,
	before: NativeProjectDescriptor,
	after: NativeProjectDescriptor
): Promise<CoreExternalChange[]> {
	if (before.name !== after.name) {
		throw Object.assign(
			new Error('Project identity changed and requires a full reload.'),
			{recoveryReason: 'projectIdentity'}
		);
	}

	const changes: CoreExternalChange[] = [];
	const beforeStories = descriptorStoryMap(before);
	const afterStories = descriptorStoryMap(after);

	for (const storyId of beforeStories.keys()) {
		if (!afterStories.has(storyId)) {
			changes.push({story_id: storyId, type: 'deleteStory'});
		}
	}

	for (const [storyId, story] of afterStories) {
		const previous = beforeStories.get(storyId);

		if (!previous) {
			changes.push({
				story: await readDescriptorStory(rootPath, story, after),
				type: 'upsertStory'
			});
			continue;
		}
		const metadata = emptyStoryMetadataPatch();

		if (previous.ifid !== story.ifid) {
			metadata.ifid = story.ifid ?? '';
		}
		if (previous.name !== story.name) {
			metadata.name = story.name ?? 'Untitled Story';
		}
		if (previous.snap_to_grid !== story.snap_to_grid) {
			metadata.snapToGrid = story.snap_to_grid ?? true;
		}
		if (previous.story_format !== story.story_format) {
			metadata.storyFormat = story.story_format ?? '';
		}
		if (previous.story_format_version !== story.story_format_version) {
			metadata.storyFormatVersion = story.story_format_version ?? '';
		}
		if (
			JSON.stringify(previous.tags ?? []) !== JSON.stringify(story.tags ?? [])
		) {
			metadata.tags = story.tags ?? [];
		}
		if (
			JSON.stringify(previous.tag_colors ?? {}) !==
			JSON.stringify(story.tag_colors ?? {})
		) {
			metadata.tagColors = story.tag_colors ?? {};
		}
		if (previous.zoom !== story.zoom) {
			metadata.zoom = story.zoom ?? 1;
		}
		if (Object.values(metadata).some(value => value !== null)) {
			changes.push({
				changes: metadata,
				story_id: storyId,
				type: 'updateStoryMetadata'
			});
		}
		const previousStart =
			previous.start_passage ?? (previous.passages[0]?.id as string) ?? '';
		const nextStart =
			story.start_passage ?? (story.passages[0]?.id as string) ?? '';

		if (previousStart !== nextStart) {
			changes.push({
				passage_id: nextStart,
				story_id: storyId,
				type: 'updateStoryStartPassage'
			});
		}

		const previousPassages = descriptorPassageMap(previous);
		const passages = descriptorPassageMap(story);
		const aggregatePassages =
			sourceLayoutForStory(story) === 'single-twee'
				? await readSingleTweePassages(rootPath, story)
				: undefined;

		for (const passageId of previousPassages.keys()) {
			if (!passages.has(passageId)) {
				changes.push({
					passage_id: passageId,
					story_id: storyId,
					type: 'deletePassage'
				});
			}
		}
		for (const [passageIndex, passage] of story.passages.entries()) {
			const passageId = passage.id as string;
			const previousPassage = previousPassages.get(passageId);
			const sourcePassage = aggregatePassages?.[passageIndex];

			if (!previousPassage) {
				changes.push({
					passage: await readDescriptorPassage(
						rootPath,
						storyId,
						passage,
						after.layout[passageId],
						sourcePassage
					),
					story_id: storyId,
					type: 'upsertPassage'
				});
				continue;
			}
			const passageChanges = emptyPassagePatch();

			if (
				previousPassage.name !== passage.name ||
				(sourcePassage && sourcePassage.name !== previousPassage.name)
			) {
				passageChanges.name =
					sourcePassage?.name ?? passage.name ?? 'Untitled Passage';
			}
			if (
				JSON.stringify(previousPassage.tags ?? []) !==
					JSON.stringify(passage.tags ?? []) ||
				(sourcePassage &&
					JSON.stringify(sourcePassage.tags) !==
						JSON.stringify(previousPassage.tags ?? []))
			) {
				passageChanges.tags = sourcePassage?.tags ?? passage.tags ?? [];
			}
			if (
				previousPassage.file !== passage.file ||
				previous.source !== story.source ||
				sourceLayoutForStory(previous) !== sourceLayoutForStory(story)
			) {
				const path = safeProjectFilePath(rootPath, passage.file);

				passageChanges.text =
					sourcePassage?.text ??
					(path ? ((await readTextIfPresent(path)) ?? '') : '');
			}
			if (Object.values(passageChanges).some(value => value !== null)) {
				changes.push({
					changes: passageChanges,
					passage_id: passageId,
					story_id: storyId,
					type: 'updatePassage'
				});
			}
		}

		if (previous.script !== story.script) {
			const path = safeProjectFilePath(rootPath, story.script);

			changes.push({
				script: path ? ((await readTextIfPresent(path)) ?? '') : '',
				story_id: storyId,
				type: 'updateStoryScript'
			});
		}
		if (previous.stylesheet !== story.stylesheet) {
			const path = safeProjectFilePath(rootPath, story.stylesheet);

			changes.push({
				story_id: storyId,
				stylesheet: path ? ((await readTextIfPresent(path)) ?? '') : '',
				type: 'updateStoryStylesheet'
			});
		}
	}

	return changes;
}

function layoutExternalChanges(
	before: NativeProjectDescriptor,
	after: NativeProjectDescriptor
): CoreExternalChange[] {
	const passageStories = new Map<string, string>();

	for (const story of after.stories) {
		for (const passage of story.passages) {
			passageStories.set(passage.id as string, story.id as string);
		}
	}

	return Array.from(
		new Set([...Object.keys(before.layout), ...Object.keys(after.layout)])
	).flatMap(passageId => {
		const previous = before.layout[passageId];
		const next = after.layout[passageId];
		const storyId = passageStories.get(passageId);

		if (!storyId || JSON.stringify(previous) === JSON.stringify(next)) {
			return [];
		}
		return [
			{
				layout: next ?? null,
				passage_id: passageId,
				story_id: storyId,
				type: 'updatePassageLayout' as const
			}
		];
	});
}

async function targetedAssetEntry(rootPath: string, projectPath: string) {
	const asset = safeProjectAssetPath(rootPath, projectPath);

	try {
		const fileStats = await stat(asset.absolutePath);

		return fileStats.isFile()
			? projectAssetInventoryEntry(
					asset.projectPath,
					asset.absolutePath,
					fileStats
				)
			: undefined;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return undefined;
		}
		throw error;
	}
}

function recoveryDelta(
	session: ProjectSessionState,
	fileChanges: NativeProjectSessionConflict[],
	error: Error & {recoveryReason?: NativeProjectSessionRecovery['reason']},
	deltaId: string,
	scanStartedAtEpochMs: number,
	watcherObservedAtEpochMs?: number
): ProjectSessionCandidate {
	const changedPaths = fileChanges.map(change => change.path);
	const candidateGeneration = session.generation + 1;
	const deltaCreatedAtEpochMs = performanceEpochNow();
	const delta: NativeProjectSessionDelta = {
		baseGeneration: session.generation,
		candidateGeneration,
		changedPaths,
		delta: {changes: [], id: deltaId},
		fileChanges,
		id: deltaId,
		performanceTrace: performanceHarnessEnabled()
			? {
					deltaCreatedAtEpochMs,
					scanStartedAtEpochMs,
					watcherObservedAtEpochMs
				}
			: undefined,
		recovery: {
			changedPaths,
			message: error.message,
			reason: error.recoveryReason ?? 'invalidManifest'
		},
		rootPath: session.rootPath,
		scannedAt: new Date().toISOString()
	};

	recordWatcherTraceEvent({
		deltaId,
		rootPath: session.rootPath,
		stage: 'delta-created',
		timeEpochMs: deltaCreatedAtEpochMs
	});

	return {
		baseline: session.baseline!,
		deliveryState: 'awaitingResolution',
		delta,
		descriptor: session.descriptor!
	};
}

async function readProjectSessionDelta(
	session: ProjectSessionState,
	reconcile = false
): Promise<ProjectSessionCandidate | undefined> {
	const startedAt = performance.now();
	const scanStartedAtEpochMs = performanceEpochNow();
	const watcherTrace = session.pendingWatcherTrace;
	const deltaId = watcherTrace?.deltaId ?? uuid();
	const baseline = session.baseline!;
	const hints = [...session.pathHints];

	session.pendingWatcherTrace = undefined;
	session.pathHints.clear();
	recordWatcherTraceEvent({
		deltaId,
		rootPath: session.rootPath,
		stage: 'scan-started',
		timeEpochMs: scanStartedAtEpochMs
	});
	const files =
		!reconcile && hints.length > 0
			? await projectFileManifestForHints(
					session.rootPath,
					baseline.files,
					hints
				)
			: await projectFileManifest(session.rootPath);
	const fileChanges = projectSessionConflicts(baseline.files, files);

	if (fileChanges.length === 0) {
		return undefined;
	}

	let descriptor = session.descriptor!;
	const changes: CoreExternalChange[] = [];
	const passageMappingsToPersist: NonNullable<
		ProjectSessionCandidate['passageMappingsToPersist']
	> = [];
	const changedPaths = fileChanges.map(change => change.path);
	let contentFilesRead = 0;

	try {
		if (fileChanges.some(change => change.kind === 'metadata')) {
			throw Object.assign(
				new Error(
					'Compatibility project metadata changed and requires a full reload.'
				),
				{recoveryReason: 'unsupportedMetadata'}
			);
		}

		if (fileChanges.some(change => change.kind === 'manifest')) {
			const nextDescriptor = await readProjectDescriptor(session.rootPath);

			contentFilesRead++;
			changes.push(
				...(await manifestExternalChanges(
					session.rootPath,
					descriptor,
					nextDescriptor
				))
			);
			descriptor = nextDescriptor;
		}

		const pathMap = descriptor.paths;
		for (const fileChange of fileChanges) {
			const mapping = pathMap.get(fileChange.path);

			if (mapping?.kind === 'passage' && mapping.passageIds?.length) {
				const path = safeProjectFilePath(session.rootPath, fileChange.path);

				contentFilesRead++;
				const mappedStory = descriptorStoryMap(descriptor).get(mapping.storyId);
				const aggregateState =
					mappedStory && sourceLayoutForStory(mappedStory) === 'single-twee'
						? await readSingleTweeState(
								session.rootPath,
								mappedStory,
								session.aggregateExactNamePassageIds
							)
						: undefined;
				const text =
					aggregateState === undefined
						? path
							? ((await readTextIfPresent(path)) ?? '')
							: ''
						: undefined;

				for (const passageId of mapping.passageIds) {
					const sourcePassage = aggregateState?.byId.get(passageId);

					if (aggregateState && !sourcePassage) {
						changes.push({
							passage_id: passageId,
							story_id: mapping.storyId,
							type: 'deletePassage'
						});
						continue;
					}
					changes.push({
						changes: {
							...emptyPassagePatch(),
							name: sourcePassage?.name ?? null,
							tags: sourcePassage?.tags ?? null,
							text: sourcePassage?.text ?? text ?? ''
						},
						passage_id: passageId,
						story_id: mapping.storyId,
						type: 'updatePassage'
					});
				}
				for (const sourcePassage of aggregateState?.added ?? []) {
					changes.push({
						passage: {
							id: sourcePassage.id,
							layout: {
								height: sourcePassage.height,
								left: sourcePassage.left,
								top: sourcePassage.top,
								width: sourcePassage.width
							},
							name: sourcePassage.name,
							storyId: mapping.storyId,
							tags: sourcePassage.tags,
							text: sourcePassage.text
						},
						story_id: mapping.storyId,
						type: 'upsertPassage'
					});
					passageMappingsToPersist.push({
						passage: {
							id: sourcePassage.id,
							name: sourcePassage.name,
							tags: sourcePassage.tags
						},
						storyId: mapping.storyId
					});
				}
				for (const passageId of session.aggregateExactNamePassageIds ?? []) {
					const sourcePassage = aggregateState?.byId.get(passageId);

					if (
						!sourcePassage ||
						passageMappingsToPersist.some(
							persisted =>
								persisted.storyId === mapping.storyId &&
								persisted.passage.id === passageId
						)
					) {
						continue;
					}
					passageMappingsToPersist.push({
						passage: {
							id: passageId,
							name: sourcePassage.name,
							tags: sourcePassage.tags
						},
						storyId: mapping.storyId
					});
				}
				if (mappedStory && aggregateState) {
					const nextStory = storyWithSingleTweeState(
						mappedStory,
						aggregateState
					);

					changes.push(
						...singleTweeMetadataExternalChanges(mappedStory, nextStory)
					);
					const nextDescriptor = {
						...descriptor,
						stories: descriptor.stories.map(story =>
							story.id === mappedStory.id ? nextStory : story
						)
					};

					nextDescriptor.paths = descriptorPathMap(nextDescriptor);
					descriptor = nextDescriptor;
				}
			} else if (mapping?.kind === 'script') {
				const path = safeProjectFilePath(session.rootPath, fileChange.path);

				contentFilesRead++;
				changes.push({
					script: path ? ((await readTextIfPresent(path)) ?? '') : '',
					story_id: mapping.storyId,
					type: 'updateStoryScript'
				});
			} else if (mapping?.kind === 'stylesheet') {
				const path = safeProjectFilePath(session.rootPath, fileChange.path);

				contentFilesRead++;
				changes.push({
					story_id: mapping.storyId,
					stylesheet: path ? ((await readTextIfPresent(path)) ?? '') : '',
					type: 'updateStoryStylesheet'
				});
			}
		}

		if (fileChanges.some(change => change.kind === 'graph')) {
			const nextLayout = await readProjectLayout(session.rootPath);
			contentFilesRead++;
			const nextDescriptor = {
				...descriptor,
				...nextLayout
			};

			changes.push(...layoutExternalChanges(descriptor, nextDescriptor));
			if (descriptor.layoutDataJson !== nextDescriptor.layoutDataJson) {
				changes.push({
					layout_json: nextDescriptor.layoutDataJson,
					type: 'updateProjectLayout'
				});
			}
			descriptor = nextDescriptor;
		}

		const assets = new Map(
			baseline.assets.map(asset => [asset.normalizedPath, asset] as const)
		);
		for (const fileChange of fileChanges.filter(
			change => change.kind === 'asset'
		)) {
			const existing = assets.get(normalizedAssetPath(fileChange.path));
			const asset = await targetedAssetEntry(session.rootPath, fileChange.path);

			if (asset) {
				assets.set(asset.normalizedPath, asset);
				changes.push({asset, type: 'upsertAsset'});
			} else {
				assets.delete(normalizedAssetPath(fileChange.path));
				changes.push({
					path: existing?.path ?? fileChange.path,
					type: 'deleteAsset'
				});
			}
		}

		const candidateGeneration = session.generation + 1;
		const deltaCreatedAtEpochMs = performanceEpochNow();
		const coreDelta: CoreExternalDelta = {changes, id: deltaId};
		const delta: NativeProjectSessionDelta = {
			baseGeneration: session.generation,
			candidateGeneration,
			changedPaths,
			delta: coreDelta,
			fileChanges,
			id: coreDelta.id,
			performanceTrace: performanceHarnessEnabled()
				? {
						deltaCreatedAtEpochMs,
						scanStartedAtEpochMs,
						watcherObservedAtEpochMs: watcherTrace?.observedAtEpochMs
					}
				: undefined,
			rootPath: session.rootPath,
			scannedAt: new Date().toISOString()
		};

		const candidate = {
			baseline: {
				...baseline,
				assets: [...assets.values()].sort((left, right) =>
					left.path.localeCompare(right.path)
				),
				changedPaths,
				conflicts: fileChanges,
				files,
				scannedAt: delta.scannedAt,
				stories: []
			},
			deliveryState: 'awaitingResolution' as const,
			delta,
			descriptor,
			...(passageMappingsToPersist.length > 0 ? {passageMappingsToPersist} : {})
		};

		recordWatcherTraceEvent({
			deltaId,
			rootPath: session.rootPath,
			stage: 'delta-created',
			timeEpochMs: deltaCreatedAtEpochMs
		});
		recordWatcherPerformanceMetric({
			assetChanges: changes.filter(
				change => change.type === 'upsertAsset' || change.type === 'deleteAsset'
			).length,
			changedPaths,
			contentFilesRead,
			deltaId,
			durationMs: performance.now() - startedAt,
			entityChanges: changes.length,
			recovery: false,
			rootPath: session.rootPath
		});
		return candidate;
	} catch (error) {
		const candidate = recoveryDelta(
			session,
			fileChanges,
			error as Error & {
				recoveryReason?: NativeProjectSessionRecovery['reason'];
			},
			deltaId,
			scanStartedAtEpochMs,
			watcherTrace?.observedAtEpochMs
		);

		recordWatcherPerformanceMetric({
			assetChanges: fileChanges.filter(change => change.kind === 'asset')
				.length,
			changedPaths,
			contentFilesRead,
			deltaId,
			durationMs: performance.now() - startedAt,
			entityChanges: 0,
			recovery: true,
			rootPath: session.rootPath
		});
		return candidate;
	}
}

function notifyProjectSession(session: ProjectSessionState) {
	const pending = session.pending;

	if (!pending || pending.deliveryState !== 'awaitingResolution') {
		return;
	}

	const wasNotified =
		pending.delta.performanceTrace?.nativeNotifiedAtEpochMs !== undefined;

	if (pending.delta.performanceTrace) {
		pending.delta.performanceTrace.nativeNotifiedAtEpochMs ??=
			performanceEpochNow();
	}
	if (!wasNotified) {
		recordWatcherTraceEvent({
			deltaId: pending.delta.id,
			rootPath: session.rootPath,
			stage: 'native-notified',
			timeEpochMs: pending.delta.performanceTrace?.nativeNotifiedAtEpochMs
		});
	}
	for (const listener of session.listeners) {
		listener(pending.delta);
	}
}

function projectSessionCandidateSignature(
	candidate: ProjectSessionCandidate | undefined
) {
	return candidate
		? JSON.stringify({
				changes: candidate.delta.delta.changes,
				paths: candidate.delta.changedPaths,
				recovery: candidate.delta.recovery
			})
		: '';
}

async function pollProjectSession(
	session: ProjectSessionState,
	reconcile = false
) {
	if (session.pending?.deliveryState === 'awaitingResolution') {
		session.pollAfterResolution = true;
		session.reconcileAfterResolution =
			session.reconcileAfterResolution || reconcile;
		return;
	}

	if (session.scanning) {
		session.rescanRequested = true;
		session.rescanReconcileRequested =
			session.rescanReconcileRequested || reconcile;
		return;
	}

	session.scanning = true;

	try {
		const candidate = await readProjectSessionDelta(session, reconcile);
		const previousSignature = projectSessionCandidateSignature(session.pending);
		const nextSignature = projectSessionCandidateSignature(candidate);

		if (candidate && session.pending && nextSignature === previousSignature) {
			// Preserve the deferred candidate ID while disk state is unchanged.
		} else {
			session.pending = candidate;
		}
		if (candidate && nextSignature !== previousSignature) {
			notifyProjectSession(session);
		}
	} finally {
		session.scanning = false;

		if (session.rescanRequested) {
			const nextReconcile = session.rescanReconcileRequested ?? false;

			session.rescanRequested = false;
			session.rescanReconcileRequested = false;
			void pollProjectSession(session, nextReconcile);
		}
	}
}

function scheduleProjectSessionPoll(session: ProjectSessionState) {
	if (!session.baseline) {
		return;
	}
	if (session.debounceTimer) {
		clearTimeout(session.debounceTimer);
	}

	session.debounceTimer = setTimeout(() => {
		session.debounceTimer = undefined;
		void pollProjectSession(session);
	}, projectSessionWatchDebounceMs);
}

function installProjectSessionWatcher(session: ProjectSessionState) {
	session.watcher?.close();
	session.watcher = undefined;

	try {
		session.watcher = watch(
			session.rootPath,
			{recursive: true},
			(_eventType, filename) => {
				if (!session.pendingWatcherTrace) {
					session.pendingWatcherTrace = {
						deltaId: uuid(),
						observedAtEpochMs: performanceEpochNow()
					};
					recordWatcherTraceEvent({
						deltaId: session.pendingWatcherTrace.deltaId,
						rootPath: session.rootPath,
						stage: 'watcher-observed',
						timeEpochMs: session.pendingWatcherTrace.observedAtEpochMs
					});
				}
				if (filename) {
					const normalized = String(filename).replace(/\\/g, '/');

					if (
						normalized &&
						!normalized.startsWith('../') &&
						!normalized.includes('/../')
					) {
						session.pathHints.add(normalized);
					}
				}
				scheduleProjectSessionPoll(session);
			}
		);
		session.watcherAvailable = true;
	} catch {
		session.watcherAvailable = false;
	}
}

function ensureProjectSession(rootPath: string) {
	const key = projectSessionKey(rootPath);
	let session = projectSessions.get(key);

	if (!session) {
		session = {
			generation: 1,
			listeners: new Set<ProjectSessionListener>(),
			pathHints: new Set<string>(),
			resolvedCandidates: new Map(),
			rootPath
		};
		projectSessions.set(key, session);
	}

	return session;
}

function assertCurrentProjectSession(
	rootPath: string,
	session: ProjectSessionState
) {
	if (projectSessions.get(projectSessionKey(rootPath)) !== session) {
		throw Object.assign(
			new Error(`Project session start was canceled for ${rootPath}.`),
			{code: projectSessionStartCanceledCode}
		);
	}
}

const projectAssetDigestCandidateLimit = 25;
const projectAssetDigestSessionPathLimit = 100;
const projectAssetDigestStoryLimit = 100;
const projectAssetDigestScanSliceMs = 8;
type ProjectAssetDigestStoryState =
	{paths: string[]; status: 'ready'} | {reason: string; status: 'unknown'};
type ProjectAssetDigestScanBudget = {sliceStartedAt: number};

function addBoundedAssetDigestPath(
	paths: string[],
	path: string,
	limit: number
) {
	let lower = 0;
	let upper = paths.length;

	while (lower < upper) {
		const middle = Math.floor((lower + upper) / 2);
		const comparison = compareAssetPaths(paths[middle], path);

		if (comparison < 0) {
			lower = middle + 1;
		} else {
			upper = middle;
		}
	}
	if (paths[lower] === path || lower >= limit) {
		return;
	}
	paths.splice(lower, 0, path);
	if (paths.length > limit) {
		paths.pop();
	}
}

function beginProjectAssetDigestRefresh(session: ProjectSessionState) {
	assertCurrentProjectSession(session.rootPath, session);
	const refreshEpoch = (session.assetDigestRefreshEpoch ?? 0) + 1;

	session.assetDigestRefreshEpoch = refreshEpoch;
	return refreshEpoch;
}

function settleProjectAssetDigestRefresh(
	session: ProjectSessionState,
	refreshEpoch: number
) {
	session.assetDigestRefreshSettledEpoch = Math.max(
		session.assetDigestRefreshSettledEpoch ?? 0,
		refreshEpoch
	);
	for (const resolveWaiter of session.assetDigestRefreshWaiters ?? []) {
		resolveWaiter();
	}
	session.assetDigestRefreshWaiters?.clear();
}

async function waitForProjectAssetDigestRefresh(
	session: ProjectSessionState,
	refreshEpoch: number
) {
	while (
		!session.baseline &&
		(session.assetDigestRefreshSettledEpoch ?? 0) < refreshEpoch
	) {
		await new Promise<void>(resolveWaiter => {
			session.assetDigestRefreshWaiters ??= new Set();
			session.assetDigestRefreshWaiters.add(resolveWaiter);
		});
		assertCurrentProjectSession(session.rootPath, session);
	}
}

async function yieldProjectAssetDigestScanIfNeeded(
	session: ProjectSessionState,
	budget: ProjectAssetDigestScanBudget,
	refreshEpoch: number
) {
	assertCurrentProjectSession(session.rootPath, session);
	if (session.assetDigestRefreshEpoch !== refreshEpoch) {
		return false;
	}
	if (
		performance.now() - budget.sliceStartedAt <
		projectAssetDigestScanSliceMs
	) {
		return true;
	}
	await new Promise<void>(resolveYield => setImmediate(resolveYield));
	assertCurrentProjectSession(session.rootPath, session);
	if (session.assetDigestRefreshEpoch !== refreshEpoch) {
		return false;
	}
	budget.sliceStartedAt = performance.now();
	return true;
}

async function trustedStoryAssetDigestState(
	session: ProjectSessionState,
	story: Story,
	budget: ProjectAssetDigestScanBudget,
	refreshEpoch: number
): Promise<ProjectAssetDigestStoryState | undefined> {
	const paths: string[] = [];
	const addSource = async (source: string) => {
		assertCurrentProjectSession(session.rootPath, session);
		if (session.assetDigestRefreshEpoch !== refreshEpoch) {
			return undefined;
		}
		const scanned = boundedReferencedMediaPathsInSource(source);
		if (
			!(await yieldProjectAssetDigestScanIfNeeded(
				session,
				budget,
				refreshEpoch
			))
		) {
			return undefined;
		}

		if (!scanned.complete) {
			return false;
		}
		for (const path of scanned.paths) {
			addBoundedAssetDigestPath(paths, path, projectAssetDigestCandidateLimit);
		}
		return true;
	};

	for (const passage of story.passages) {
		const added = await addSource(passage.text);

		if (added === undefined) {
			return undefined;
		}
		if (!added) {
			return {reason: 'source-scan-incomplete', status: 'unknown'};
		}
	}
	const scriptAdded = await addSource(story.script);
	if (scriptAdded === undefined) {
		return undefined;
	}
	const stylesheetAdded = await addSource(story.stylesheet);
	if (stylesheetAdded === undefined) {
		return undefined;
	}
	if (!scriptAdded || !stylesheetAdded) {
		return {reason: 'source-scan-incomplete', status: 'unknown'};
	}
	return {
		paths,
		status: 'ready'
	};
}

function updatedStoryAssetDigestState(
	previous: ProjectAssetDigestStoryState | undefined,
	edits: Array<{nextSource: string; previousSource?: string}>
): ProjectAssetDigestStoryState {
	if (!previous || previous.status !== 'ready') {
		return {reason: 'prior-authority-unknown', status: 'unknown'};
	}
	const paths = new Set(previous.paths);

	for (const edit of edits) {
		if (edit.previousSource === undefined) {
			return {reason: 'previous-source-unavailable', status: 'unknown'};
		}
		const before = boundedReferencedMediaPathsInSource(edit.previousSource);
		const after = boundedReferencedMediaPathsInSource(edit.nextSource);

		if (!before.complete || !after.complete) {
			return {reason: 'source-scan-incomplete', status: 'unknown'};
		}
		const afterPaths = new Set(after.paths);
		if (
			previous.paths.some(
				path => before.paths.includes(path) && !afterPaths.has(path)
			)
		) {
			return {reason: 'selected-path-removed', status: 'unknown'};
		}
		for (const path of after.paths) {
			paths.add(path);
		}
	}
	return {
		paths: [...paths]
			.sort(compareAssetPaths)
			.slice(0, projectAssetDigestCandidateLimit),
		status: 'ready'
	};
}

async function refreshProjectSessionAssetDigests(
	session: ProjectSessionState,
	baseline: NativeProjectSessionSnapshot,
	stories: Story[],
	options: {
		forceRecapture?: boolean;
		refreshEpoch?: number;
		replaceAllStories?: boolean;
		storyUpdates?: Map<string, ProjectAssetDigestStoryState>;
	} = {}
) {
	assertCurrentProjectSession(session.rootPath, session);
	const refreshEpoch =
		options.refreshEpoch ?? beginProjectAssetDigestRefresh(session);
	if (session.assetDigestRefreshEpoch !== refreshEpoch) {
		return false;
	}
	const indexedAssets = new Map(
		baseline.files
			.filter(file => file.kind === 'asset')
			.map(file => [normalizedAssetPath(file.path), file] as const)
	);
	const previous =
		session.assetContentDigests ??
		new Map<
			string,
			{contentDigest: string; mtimeMs: number; sizeBytes: number}
		>();
	const storyStates = options.replaceAllStories
		? new Map<string, ProjectAssetDigestStoryState>()
		: new Map(session.assetDigestStories ?? []);
	const scanBudget = {sliceStartedAt: performance.now()};
	for (const story of stories) {
		if (
			storyStates.has(story.id) ||
			storyStates.size < projectAssetDigestStoryLimit
		) {
			const state = await trustedStoryAssetDigestState(
				session,
				story,
				scanBudget,
				refreshEpoch
			);

			if (!state) {
				return false;
			}
			storyStates.set(story.id, state);
		}
	}
	for (const [storyId, state] of options.storyUpdates ?? []) {
		if (
			storyStates.has(storyId) ||
			storyStates.size < projectAssetDigestStoryLimit
		) {
			storyStates.set(storyId, state);
		}
	}
	const boundedAuthorizedPaths: string[] = [];
	for (const [storyId, state] of storyStates) {
		if (state.status === 'ready') {
			const newPaths = state.paths.filter(
				path => !boundedAuthorizedPaths.includes(path)
			);

			if (
				boundedAuthorizedPaths.length + newPaths.length >
				projectAssetDigestSessionPathLimit
			) {
				storyStates.set(storyId, {
					reason: 'session-path-limit',
					status: 'unknown'
				});
				continue;
			}
			for (const path of newPaths) {
				addBoundedAssetDigestPath(
					boundedAuthorizedPaths,
					path,
					projectAssetDigestSessionPathLimit
				);
			}
		}
	}
	const next = new Map<
		string,
		{contentDigest: string; mtimeMs: number; sizeBytes: number}
	>();

	for (const path of boundedAuthorizedPaths) {
		const indexed = indexedAssets.get(path);
		if (!indexed) {
			continue;
		}
		const retained = previous.get(path);

		if (
			!options.forceRecapture &&
			retained?.mtimeMs === indexed.mtimeMs &&
			retained.sizeBytes === indexed.sizeBytes
		) {
			next.set(path, retained);
		}
	}

	const requests = boundedAuthorizedPaths.flatMap(path => {
		const indexed = indexedAssets.get(path);

		return indexed && !next.has(path)
			? [
					{
						expectedModifiedAtMs: indexed.mtimeMs,
						expectedSizeBytes: indexed.sizeBytes,
						path
					}
				]
			: [];
	});
	if (requests.length > 0 && nativeProjectAssetDigestCaptureAvailable()) {
		assertCurrentProjectSession(session.rootPath, session);
		if (session.assetDigestRefreshEpoch !== refreshEpoch) {
			return false;
		}
		let result:
			Awaited<ReturnType<typeof captureNativeProjectAssetDigests>> | undefined;

		try {
			result = await captureNativeProjectAssetDigests(
				baseline.rootPath,
				requests
			);
		} catch (error) {
			if (!nativeAssetReadBusy(error)) {
				throw error;
			}
		}
		assertCurrentProjectSession(session.rootPath, session);
		if (session.assetDigestRefreshEpoch !== refreshEpoch) {
			return false;
		}
		const captured = new Map(
			(result?.digests ?? []).map(
				digest => [digest.path, digest.contentDigest] as const
			)
		);

		for (const request of requests) {
			const contentDigest = captured.get(request.path);

			if (contentDigest) {
				next.set(request.path, {
					contentDigest,
					mtimeMs: request.expectedModifiedAtMs,
					sizeBytes: request.expectedSizeBytes
				});
			}
		}
	}

	assertCurrentProjectSession(session.rootPath, session);
	if (session.assetDigestRefreshEpoch !== refreshEpoch) {
		return false;
	}
	session.assetDigestStories = storyStates;
	session.assetContentDigests = next;
	return true;
}

async function installAcceptedProjectBaseline(
	session: ProjectSessionState,
	baseline: NativeProjectSessionSnapshot,
	descriptor: NativeProjectDescriptor,
	trustedStories: Story[] = baseline.stories,
	options: {
		forceAssetDigestRecapture?: boolean;
		refreshEpoch?: number;
		replaceAllAssetDigestStories?: boolean;
	} = {}
) {
	const refreshEpoch =
		options.refreshEpoch ?? beginProjectAssetDigestRefresh(session);
	try {
		if (session.assetDigestRefreshEpoch !== refreshEpoch) {
			return false;
		}
		const digestStories =
			trustedStories.length > 0 || !nativeProjectAssetDigestCaptureAvailable()
				? trustedStories
				: await readProjectStories(session.rootPath, {loadPassageText: true});

		const refreshed = await refreshProjectSessionAssetDigests(
			session,
			baseline,
			digestStories,
			{
				forceRecapture: options.forceAssetDigestRecapture,
				refreshEpoch,
				replaceAllStories: options.replaceAllAssetDigestStories ?? true
			}
		);
		if (!refreshed) {
			return false;
		}
		assertCurrentProjectSession(session.rootPath, session);
		if (session.assetDigestRefreshEpoch !== refreshEpoch) {
			return false;
		}
		session.baseline = {...baseline, stories: []};
		session.baselineFileIndex = new Map(
			baseline.files.map((file, index) => [file.path, index] as const)
		);
		session.descriptor = descriptor;
		return true;
	} finally {
		settleProjectAssetDigestRefresh(session, refreshEpoch);
	}
}

function beginProjectSessionBaselineCapture(rootPath: string) {
	const session = ensureProjectSession(rootPath);

	session.awaitingBaselineReceipt = true;
	if (!session.watcher) {
		installProjectSessionWatcher(session);
	}
	return session;
}

function finishProjectSessionBaselineCapture(session: ProjectSessionState) {
	session.awaitingBaselineReceipt = false;
	for (const resolveWaiter of session.baselineReceiptWaiters ?? []) {
		resolveWaiter();
	}
	session.baselineReceiptWaiters = [];
}

async function waitForProjectSessionBaselineCapture(
	session: ProjectSessionState
) {
	if (!session.awaitingBaselineReceipt) {
		return;
	}

	await new Promise<void>(resolveWaiter => {
		session.baselineReceiptWaiters ??= [];
		session.baselineReceiptWaiters.push(resolveWaiter);
	});
}

async function adoptProjectSessionBaselineReceipt(
	projectFolder: NativeProjectFolderResult
) {
	const adoptionStarted = performance.now();
	const receipt = projectFolder.baselineReceipt;

	if (!receipt) {
		return false;
	}
	const rootPath = resolve(projectFolder.rootPath);
	const session = projectSessions.get(projectSessionKey(rootPath));

	if (!session) {
		return false;
	}

	try {
		if (resolve(receipt.rootPath) !== rootPath || receipt.schemaVersion !== 1) {
			return false;
		}

		const baseline: NativeProjectSessionSnapshot = {
			assets: receipt.assets,
			changedPaths: [],
			conflicts: [],
			files: receipt.files,
			passageTextLoaded: true,
			rootPath,
			scannedAt: receipt.completedAt,
			stories: [],
			storyIds: receipt.storyIds
		};
		const descriptor = descriptorFromBaselineReceipt(
			projectFolder.stories,
			receipt
		);
		const installed = await installAcceptedProjectBaseline(
			session,
			baseline,
			descriptor,
			projectFolder.stories
		);
		if (!installed) {
			return true;
		}
		session.pending = undefined;
		const catchupStarted = performance.now();
		if (session.pathHints.size > 0 || session.watcherAvailable === false) {
			await pollProjectSession(session, session.watcherAvailable === false);
		}
		session.receiptPerformance = {
			adoptionMs: performance.now() - adoptionStarted,
			catchupMs: performance.now() - catchupStarted,
			fileCount: receipt.files.length
		};
		return true;
	} finally {
		finishProjectSessionBaselineCapture(session);
	}
}

function ensureProjectSessionHydration(rootPath: string) {
	const session = beginProjectSessionBaselineCapture(rootPath);

	session.hydrationPromise ??= (async () => {
		const nativeStart = beginNativeProjectFolderHydration(rootPath);
		if (nativeStart) {
			nativeProjectHydrations.add(nativeStart.hydrationId);
			return mergeNativeProjectMetadata(rootPath, nativeStart);
		}
		return readProjectFolder(rootPath, {loadPassageText: true});
	})()
		.then(async projectFolder => {
			if (!(await adoptProjectSessionBaselineReceipt(projectFolder))) {
				finishProjectSessionBaselineCapture(session);
			}
			return projectFolder;
		})
		.catch(error => {
			finishProjectSessionBaselineCapture(session);
			throw error;
		});
	return session.hydrationPromise;
}

async function refreshProjectSessionBaseline(
	rootPath: string,
	storyIds?: string[],
	hints: Omit<ProjectSessionSnapshotHints, 'storyIds'> = {}
) {
	const session = projectSessions.get(projectSessionKey(rootPath));

	if (!session) {
		return;
	}
	const refreshEpoch = beginProjectAssetDigestRefresh(session);

	try {
		const baseline = await readProjectSessionSnapshot(rootPath, undefined, {
			...hints,
			storyIds: storyIds ?? session.baseline?.storyIds
		});
		const descriptor = await readProjectDescriptor(rootPath).catch(() =>
			descriptorFromStories(hints.stories ?? baseline.stories)
		);
		const trustedDigestStories = hints.stories ?? baseline.stories;
		const installed = await installAcceptedProjectBaseline(
			session,
			baseline,
			descriptor,
			trustedDigestStories,
			{refreshEpoch, replaceAllAssetDigestStories: false}
		);
		if (!installed) {
			return;
		}
		session.generation++;
		session.pending = undefined;
		if (session.watcher || session.watcherAvailable !== undefined) {
			installProjectSessionWatcher(session);
		}
	} finally {
		settleProjectAssetDigestRefresh(session, refreshEpoch);
	}
}

export async function createProjectFolder(
	story: Story,
	preferredParent?: string,
	sourceLayout: ProjectSourceLayout = 'passage-files'
): Promise<NativeProjectFolderResult> {
	const rootPath = projectRootForStory(story, preferredParent);

	const writtenProject = await writeProjectFolder(
		rootPath,
		story,
		sourceLayout,
		true
	);
	await refreshProjectSessionBaseline(rootPath, [story.id]);

	const result = writtenProject ?? {
		passageTextLoaded: true,
		rootPath,
		stories: [story],
		storyIds: [story.id]
	};

	rememberProjectFolder(result);
	return result;
}

export async function saveProjectFolder(
	rootPath: string,
	story: Story,
	options: ProjectFolderSaveOptions = {}
): Promise<NativeProjectFolderResult> {
	if (typeof rootPath !== 'string' || !isAbsolute(rootPath)) {
		throw new Error('Project saves require an absolute project folder path.');
	}

	const [rootStats, manifestStats] = await Promise.all([
		stat(rootPath),
		stat(join(rootPath, 'twine.toml'))
	]);

	if (!rootStats.isDirectory() || !manifestStats.isFile()) {
		throw new Error(
			'Project saves require an existing project folder with twine.toml.'
		);
	}

	const incrementalProject = await writeProjectFolderIncremental(
		rootPath,
		story,
		options
	);
	if (!incrementalProject && options.incrementalOnly) {
		throw new Error(
			'Incremental document save could not be represented safely.'
		);
	}
	const writtenProject =
		incrementalProject ?? (await writeProjectFolder(rootPath, story));

	if (
		!incrementalProject &&
		options.hints?.length &&
		writtenProject?.performanceTimings
	) {
		writtenProject.performanceTimings.fallbackReason = 'unsupported save hints';
	}
	const baselineStarted = performance.now();

	if (!incrementalProject) {
		await refreshProjectSessionBaseline(
			rootPath,
			writtenProject?.storyIds ?? [story.id],
			{
				stories: writtenProject?.stories ?? [story]
			}
		);
	}
	const baselineRefreshUs = Math.max(
		0,
		Math.round((performance.now() - baselineStarted) * 1000)
	);

	if (performanceHarnessEnabled() && writtenProject?.performanceTimings) {
		writtenProject.performanceTimings = {
			...writtenProject.performanceTimings,
			mode: writtenProject.performanceTimings.mode ?? 'full',
			baselineRefreshUs
		};
	}

	const result = writtenProject ?? {
		passageTextLoaded: true,
		rootPath,
		stories: [story],
		storyIds: [story.id]
	};

	if (!options.incrementalOnly) {
		rememberProjectFolder(result);
	}
	return result;
}

function emptySaveTimings(
	mode: NativeProjectSaveTimings['mode'],
	extras: Partial<NativeProjectSaveTimings> = {}
): NativeProjectSaveTimings {
	return {
		changedFilePlanUs: 0,
		collectNewFilesUs: 0,
		collectOldFilesUs: 0,
		copyAssetsUs: 0,
		dirtyCompareUs: 0,
		jsonParseUs: 0,
		mode,
		projectBuildUs: 0,
		rootSwapUs: 0,
		saveProjectPathUs: 0,
		sidecarUs: 0,
		totalUs: 0,
		writeTempProjectUs: 0,
		...extras
	};
}

function incrementalSaveHints(
	hints: ProjectFolderSaveHint[] | undefined,
	storyId: string
) {
	if (!hints?.length) {
		return undefined;
	}
	if (hints.some(hint => hint.storyId !== storyId || hint.type === 'full')) {
		return undefined;
	}

	return hints as Array<Exclude<ProjectFolderSaveHint, {type: 'full'}>>;
}

async function atomicWriteText(path: string, text: string) {
	const tempPath = `${path}.${uuid()}.tmp`;

	try {
		await mkdirp(dirname(path));
		await writeFile(tempPath, text, 'utf8');
		await move(tempPath, path, {overwrite: true});
	} catch (error) {
		await remove(tempPath).catch(() => undefined);
		throw error;
	}
}

async function projectFileEntryForPath(
	rootPath: string,
	projectPath: string,
	kind: NativeProjectFileKind
) {
	const entries: NativeProjectFileEntry[] = [];

	await scanProjectFiles(rootPath, projectPath, kind, entries);
	return entries.find(entry => entry.path === projectPath);
}

async function writeProjectFolderIncremental(
	rootPath: string,
	story: Story,
	options: ProjectFolderSaveOptions
): Promise<NativeProjectFolderResult | undefined> {
	const totalStarted = performance.now();
	const timings = emptySaveTimings('incremental');
	const hints = incrementalSaveHints(options.hints, story.id);

	if (!hints?.length) {
		return undefined;
	}

	const session = projectSessions.get(projectSessionKey(rootPath));

	if (!session?.baseline) {
		return undefined;
	}

	const descriptor =
		session.descriptor ??
		(await readProjectDescriptor(rootPath).catch(() => undefined));
	const descriptorStory = descriptorStoryMap(
		descriptor ?? descriptorFromStories([])
	).get(story.id);

	if (!descriptor || !descriptorStory) {
		return undefined;
	}

	const descriptorPassages = descriptorPassageMap(descriptorStory);
	const storyPassages = new Map(
		story.passages.map(passage => [passage.id, passage] as const)
	);
	const passageTextUpdates = new Map(
		(options.documentUpdates ?? []).flatMap(update =>
			update.type === 'passageText' && update.storyId === story.id
				? [[update.passageId, update.text] as const]
				: []
		)
	);
	const sourceTextUpdates = new Map(
		(options.documentUpdates ?? []).flatMap(update =>
			update.type !== 'passageText' && update.storyId === story.id
				? [[update.type, update.text] as const]
				: []
		)
	);
	const sourceLayout = sourceLayoutForStory(descriptorStory);
	let singleTweeDirty = false;
	let updatedLayout: NativeProjectDescriptor['layout'] | undefined;
	const touched: Array<
		| {
				absolutePath: string | undefined;
				kind: NativeProjectFileKind;
				projectPath: string;
				text: string;
		  }
		| undefined
	> = [];
	for (const hint of hints) {
		if (hint.type === 'passageMetadata' || hint.type === 'passageLayout') {
			continue;
		}
		if (hint.type !== 'passageText') {
			const projectPath = descriptorStory[hint.type]?.replace(/\\/g, '/');
			const text = sourceTextUpdates.get(hint.type);

			if (!projectPath || text === undefined) {
				touched.push(undefined);
				continue;
			}
			touched.push({
				absolutePath: safeProjectFilePath(rootPath, projectPath),
				kind: hint.type,
				projectPath,
				text
			});
			continue;
		}
		const descriptorPassage = descriptorPassages.get(hint.passageId);
		const storyPassage = storyPassages.get(hint.passageId);

		if (!descriptorPassage || !storyPassage) {
			touched.push(undefined);
			continue;
		}
		if (sourceLayout === 'single-twee') {
			if (!descriptorStory.source) {
				touched.push(undefined);
			} else {
				singleTweeDirty = true;
			}
			continue;
		}
		if (!descriptorPassage.file) {
			touched.push(undefined);
			continue;
		}

		touched.push({
			absolutePath: safeProjectFilePath(rootPath, descriptorPassage.file),
			kind: 'passage' as const,
			projectPath: descriptorPassage.file.replace(/\\/g, '/'),
			text: passageTextUpdates.get(hint.passageId) ?? storyPassage.text
		});
	}
	const passageLayoutHints = hints.filter(
		(hint): hint is Extract<ProjectFolderSaveHint, {type: 'passageLayout'}> =>
			hint.type === 'passageLayout'
	);

	if (passageLayoutHints.length > 0) {
		const nextLayout = {...descriptor.layout};

		for (const hint of passageLayoutHints) {
			const descriptorPassage = descriptorPassages.get(hint.passageId);
			const storyPassage = storyPassages.get(hint.passageId);

			if (!descriptorPassage || !storyPassage) {
				return undefined;
			}
			const bounds = {
				height: storyPassage.height,
				left: storyPassage.left,
				top: storyPassage.top,
				width: storyPassage.width
			};

			if (Object.values(bounds).some(value => !Number.isFinite(value))) {
				return undefined;
			}
			nextLayout[hint.passageId] = bounds;
		}

		let layoutData: unknown;

		try {
			layoutData = JSON.parse(descriptor.layoutDataJson);
		} catch {
			return undefined;
		}
		if (
			!layoutData ||
			typeof layoutData !== 'object' ||
			Array.isArray(layoutData)
		) {
			return undefined;
		}

		updatedLayout = nextLayout;
		singleTweeDirty ||= sourceLayout === 'single-twee';
		touched.push({
			absolutePath: join(rootPath, '.twine', 'graph.json'),
			kind: 'graph',
			projectPath: '.twine/graph.json',
			text: JSON.stringify({...layoutData, passages: nextLayout}, null, 2)
		});
	}
	const passageMetadataHints = hints.filter(
		(hint): hint is Extract<ProjectFolderSaveHint, {type: 'passageMetadata'}> =>
			hint.type === 'passageMetadata'
	);

	if (passageMetadataHints.length > 0) {
		const manifestPath = join(rootPath, 'twine.toml');
		const manifestSource = await readTextIfPresent(manifestPath);
		const passageIds = new Set(
			passageMetadataHints.map(hint => hint.passageId)
		);
		const changedPassages = [...passageIds].flatMap(passageId => {
			const passage = storyPassages.get(passageId);

			return passage ? [passage] : [];
		});
		const updatedManifest =
			manifestSource && changedPassages.length === passageIds.size
				? mergePassageMetadataIntoManifest(
						manifestSource,
						story.id,
						changedPassages
					)
				: undefined;

		if (!updatedManifest) {
			return undefined;
		}
		singleTweeDirty ||= sourceLayout === 'single-twee';
		touched.push({
			absolutePath: manifestPath,
			kind: 'manifest',
			projectPath: 'twine.toml',
			text: updatedManifest
		});
	}
	if (singleTweeDirty) {
		const projectPath = descriptorStory.source?.replace(/\\/g, '/');

		if (!projectPath) {
			return undefined;
		}
		const absolutePath = safeProjectFilePath(rootPath, projectPath);

		if (!absolutePath) {
			return undefined;
		}
		const completeStory = await completeSingleTweeStory(
			rootPath,
			story,
			descriptorStory,
			passageTextUpdates
		);
		const existingSource = (await readTextIfPresent(absolutePath)) ?? '';

		touched.push({
			absolutePath,
			kind: 'passage',
			projectPath,
			text: mergeStoryTweeSource(
				existingSource,
				completeStory,
				descriptorStory.passages.map(
					passage => passage.name ?? 'Untitled Passage'
				)
			)
		});
	}

	if (
		touched.some(entry => !entry || !entry.absolutePath || !entry.projectPath)
	) {
		return undefined;
	}

	const concreteTouched = [
		...new Map(
			(
				touched as Array<{
					absolutePath: string;
					kind: NativeProjectFileKind;
					projectPath: string;
					text: string;
				}>
			).map(entry => [entry.projectPath, entry] as const)
		).values()
	] as Array<{
		absolutePath: string;
		kind: NativeProjectFileKind;
		projectPath: string;
		text: string;
	}>;
	const baselineFileIndex =
		session.baselineFileIndex ??
		new Map(
			session.baseline.files.map((file, index) => [file.path, index] as const)
		);
	session.baselineFileIndex = baselineFileIndex;
	const conflictStarted = performance.now();
	const previousAssetSources = new Map<string, string>();

	for (const entry of concreteTouched) {
		const baselineIndex = baselineFileIndex.get(entry.projectPath);
		const baselineFile =
			baselineIndex === undefined
				? undefined
				: session.baseline.files[baselineIndex];
		const currentFile = await projectFileEntryForPath(
			rootPath,
			entry.projectPath,
			entry.kind
		);

		if (!baselineFile || !currentFile) {
			return undefined;
		}
		if (baselineFile.fingerprint !== currentFile.fingerprint) {
			throw new Error(
				`${entry.projectPath} changed outside twine.rs; refusing to overwrite it.`
			);
		}
		if (
			['passage', 'script', 'stylesheet'].includes(entry.kind) &&
			currentFile.sizeBytes <= 1024 * 1024
		) {
			const previousSource = await readTextIfPresent(entry.absolutePath);

			if (previousSource !== undefined) {
				previousAssetSources.set(entry.projectPath, previousSource);
			}
		}
	}
	timings.conflictCheckUs = Math.round(
		(performance.now() - conflictStarted) * 1000
	);

	const writeStarted = performance.now();

	for (const entry of concreteTouched) {
		await atomicWriteText(entry.absolutePath, entry.text);
	}
	timings.writeTouchedFilesUs = Math.round(
		(performance.now() - writeStarted) * 1000
	);

	const baselinePatchStarted = performance.now();
	const updatedEntries = (
		await Promise.all(
			concreteTouched.map(entry =>
				projectFileEntryForPath(rootPath, entry.projectPath, entry.kind)
			)
		)
	).filter((entry): entry is NativeProjectFileEntry => !!entry);

	if (updatedEntries.length !== concreteTouched.length) {
		return undefined;
	}

	for (const entry of updatedEntries) {
		const index = baselineFileIndex.get(entry.path);

		if (index === undefined) {
			return undefined;
		}
		session.baseline.files[index] = entry;
	}
	session.baseline.changedPaths = concreteTouched.map(
		entry => entry.projectPath
	);
	session.baseline.scannedAt = new Date().toISOString();
	if (
		concreteTouched.some(entry => ['manifest', 'metadata'].includes(entry.kind))
	) {
		session.descriptor = await readProjectDescriptor(rootPath);
	} else if (updatedLayout) {
		session.descriptor = {...descriptor, layout: updatedLayout};
	}
	const storyUpdates = new Map<string, ProjectAssetDigestStoryState>();
	if (hints.some(hint => hint.type === 'passageMetadata')) {
		storyUpdates.set(story.id, {
			reason: 'structural-change-requires-full-authority',
			status: 'unknown'
		});
	} else {
		const sourceEdits = concreteTouched.flatMap(entry =>
			['passage', 'script', 'stylesheet'].includes(entry.kind)
				? [
						{
							nextSource: entry.text,
							previousSource: previousAssetSources.get(entry.projectPath)
						}
					]
				: []
		);

		if (sourceEdits.length > 0) {
			storyUpdates.set(
				story.id,
				updatedStoryAssetDigestState(
					session.assetDigestStories?.get(story.id),
					sourceEdits
				)
			);
		}
	}
	if (storyUpdates.size > 0) {
		await refreshProjectSessionAssetDigests(session, session.baseline, [], {
			storyUpdates
		});
	}
	session.generation++;
	session.pending = undefined;
	timings.baselinePatchUs = Math.round(
		(performance.now() - baselinePatchStarted) * 1000
	);
	timings.touchedPathCount = concreteTouched.length;
	timings.totalUs = Math.round((performance.now() - totalStarted) * 1000);

	return {
		passageTextLoaded: true,
		performanceTimings: performanceHarnessEnabled() ? timings : undefined,
		rootPath,
		stories: [story],
		storyIds: [story.id]
	};
}

export async function prepareProjectImport(
	sourcePath: string
): Promise<NativeProjectImportSource> {
	const absoluteSourcePath = resolve(sourcePath);
	const sourceKind = /\.zip$/i.test(absoluteSourcePath) ? 'zip' : 'html';
	let cleanupPath: string | undefined;
	let htmlFilePath = absoluteSourcePath;

	if (
		!/\.zip$/i.test(absoluteSourcePath) &&
		!/\.html?$/i.test(absoluteSourcePath)
	) {
		throw new Error(
			'Project import must be a Twine HTML file or a zip archive.'
		);
	}

	try {
		const nativePreparedSource = prepareNativeProjectImport(absoluteSourcePath);

		if (nativePreparedSource) {
			const {cleanupPath: nativeCleanupPath, ...source} = nativePreparedSource;
			const preparedImport: NativeProjectImportSource = {
				...source,
				id: uuid()
			};

			preparedProjectImports.set(preparedImport.id, {
				assets: preparedImport.assets,
				cleanupPath: nativeCleanupPath
			});

			return preparedImport;
		}

		allowCompatibilityProjectFallback('Project import preparation');

		if (sourceKind === 'zip') {
			cleanupPath = await mkdtemp(join(tmpdir(), 'twine-import-'));
			await extractZip(absoluteSourcePath, {dir: cleanupPath});

			const htmlFiles =
				findNativeTwineHtmlFiles(cleanupPath) ??
				(await findTwineHtmlFiles(cleanupPath));

			if (htmlFiles.length === 0) {
				throw new Error('No Twine HTML story was found in the zip archive.');
			}

			htmlFilePath = bestTwineHtmlFile(
				cleanupPath,
				absoluteSourcePath,
				htmlFiles
			);
		}

		const nativePreparedImport = prepareNativeHtmlImport(
			absoluteSourcePath,
			htmlFilePath,
			sourceKind
		);

		if (nativePreparedImport) {
			const preparedImport: NativeProjectImportSource = {
				...nativePreparedImport,
				id: uuid()
			};

			preparedProjectImports.set(preparedImport.id, {
				assets: preparedImport.assets,
				cleanupPath
			});

			return preparedImport;
		}

		const rawHtmlSource = await readFile(htmlFilePath, 'utf8');
		const sourceRoot = dirname(htmlFilePath);
		const assets = await discoverProjectImportAssets(
			sourceRoot,
			htmlFilePath,
			rawHtmlSource
		);
		const htmlSource = rewriteProjectImportAssetReferences(
			rawHtmlSource,
			assets
		);
		const preparedImport: NativeProjectImportSource = {
			assets,
			htmlFilePath,
			htmlSource,
			id: uuid(),
			sourceKind,
			sourcePath: absoluteSourcePath
		};

		preparedProjectImports.set(preparedImport.id, {
			assets,
			cleanupPath
		});

		return preparedImport;
	} catch (error) {
		if (cleanupPath) {
			await remove(cleanupPath).catch(() => undefined);
		}

		throw error;
	}
}

async function sourceLayoutFromProjectManifest(
	rootPath: string,
	storyId: string
): Promise<{
	passageNames: string[];
	sourceLayout: ProjectSourceLayout;
	sourcePath?: string;
}> {
	const source = await readTextIfPresent(join(rootPath, 'twine.toml'));
	const story = source
		? parseProjectToml(source).find(candidate => candidate.id === storyId)
		: undefined;

	return {
		passageNames: story?.passages.map(passage => passage.name ?? '') ?? [],
		sourceLayout: story ? sourceLayoutForStory(story) : 'passage-files',
		sourcePath: story?.source
	};
}

async function writeProjectFolder(
	rootPath: string,
	story: Story,
	sourceLayout?: ProjectSourceLayout,
	create = false
) {
	const existingSource = await sourceLayoutFromProjectManifest(
		rootPath,
		story.id
	);
	const effectiveSourceLayout = sourceLayout ?? existingSource.sourceLayout;
	const aggregateSource =
		sourceLayout === undefined &&
		effectiveSourceLayout === 'single-twee' &&
		existingSource.sourcePath
			? existingSource.sourcePath.replace(/\\/g, '/')
			: 'story.twee';
	const nativeResult = create
		? createNativeProjectFolder(rootPath, story, effectiveSourceLayout)
		: saveNativeProjectFolder(rootPath, story, effectiveSourceLayout);

	if (nativeResult) {
		return nativeResult;
	}

	if (!legacyProjectFallbackEnabled()) {
		requireNativeProjectBackend('Project folder saving');
	}

	if (!create) {
		// The native addon being unavailable is the only condition where the
		// compatibility writer may run. Validate the complete manifest before any
		// fallback write so a lookalike directory cannot be treated as a project.
		const descriptor = await readProjectDescriptor(rootPath);

		if (descriptor.stories.length > 1) {
			throw new Error(
				'Legacy project compatibility saving cannot safely update a multi-story project.'
			);
		}
	} else {
		// Reserve the final path atomically. A preflight existence check would
		// leave a window where another process could create the target before the
		// compatibility writer begins mutating it.
		await mkdirp(dirname(rootPath));
		try {
			await mkdir(rootPath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
				throw new Error(
					'A new project cannot replace an existing filesystem entry.'
				);
			}

			throw error;
		}
	}

	const storySlug = storyPathSlug(story);
	const passageRoot = join(rootPath, 'passages', storySlug);
	const passageFiles =
		effectiveSourceLayout === 'single-twee'
			? story.passages.map(() => aggregateSource)
			: story.passages.map(
					(passage, index) =>
						`passages/${storySlug}/${passageFileName(index, passage.name)}`
				);

	if (effectiveSourceLayout === 'passage-files') {
		await mkdirp(passageRoot);
	}
	await mkdirp(join(rootPath, 'scripts'));
	await mkdirp(join(rootPath, 'styles'));
	await mkdirp(join(rootPath, 'assets'));
	await mkdirp(join(rootPath, '.twine'));

	if (effectiveSourceLayout === 'single-twee') {
		const aggregatePath = safeProjectFilePath(rootPath, aggregateSource);

		if (!aggregatePath) {
			throw new Error(`Unsafe aggregate Twee source path: ${aggregateSource}`);
		}
		await mkdirp(dirname(aggregatePath));
		const existingAggregate = (await readTextIfPresent(aggregatePath)) ?? '';

		await writeFile(
			aggregatePath,
			existingAggregate
				? mergeStoryTweeSource(
						existingAggregate,
						story,
						existingSource.passageNames
					)
				: storyPassagesToTwee(story),
			'utf8'
		);
	} else {
		await Promise.all(
			story.passages.map((passage, index) =>
				writeFile(join(rootPath, passageFiles[index]), passage.text, 'utf8')
			)
		);
	}
	await writeFile(
		join(rootPath, 'scripts', `${storySlug}.js`),
		story.script,
		'utf8'
	);
	await writeFile(
		join(rootPath, 'styles', `${storySlug}.css`),
		story.stylesheet,
		'utf8'
	);
	await writeFile(
		join(rootPath, '.twine', 'graph.json'),
		JSON.stringify(graphLayout(story), null, 2),
		'utf8'
	);
	await writeJsonAtomic(join(rootPath, '.twine', 'project.json'), {
		schema: 'twine.rs/renderer-project',
		version: 1,
		stories: [rendererProjectMetadata(story)]
	});
	await writeFile(
		join(rootPath, 'twine.toml'),
		projectToml(story, passageFiles, effectiveSourceLayout, aggregateSource),
		'utf8'
	);

	return undefined;
}

export async function openProjectFolder(
	rootPath?: string,
	options: NativeProjectOpenOptions = {}
): Promise<NativeProjectFolderResult | undefined> {
	if (!rootPath) {
		const {canceled, filePaths} = await dialog.showOpenDialog({
			properties: ['openDirectory'],
			title: 'Open Project Folder'
		});

		if (canceled || !filePaths[0]) {
			return undefined;
		}

		rootPath = filePaths[0];
	}

	const rootStats = await stat(rootPath);

	if (!rootStats.isDirectory()) {
		throw Object.assign(
			new Error(`${rootPath} is not a project folder directory.`),
			{code: 'ENOTDIR'}
		);
	}
	const openedRootPath = rootPath;
	const session = beginProjectSessionBaselineCapture(openedRootPath);

	let projectFolder: NativeProjectFolderResult;
	try {
		projectFolder = await readProjectFolder(openedRootPath, options);
		if (projectFolder.baselineReceipt) {
			await adoptProjectSessionBaselineReceipt(projectFolder);
		} else if (options.loadPassageText !== false) {
			finishProjectSessionBaselineCapture(session);
		}
	} catch (error) {
		finishProjectSessionBaselineCapture(session);
		throw error;
	}
	if (projectFolder.passageTextLoaded === false) {
		setTimeout(() => {
			if (projectSessions.get(projectSessionKey(openedRootPath)) === session) {
				void ensureProjectSessionHydration(openedRootPath).catch(
					() => undefined
				);
			}
		}, 0);
	}
	const publicProjectFolder = {...projectFolder};

	delete publicProjectFolder.baselineReceipt;
	rememberProjectFolder(publicProjectFolder);

	return publicProjectFolder;
}

export async function hydrateProjectFolder(
	rootPath: string,
	storyIds?: string[]
): Promise<NativeProjectFolderResult> {
	const projectFolder = await ensureProjectSessionHydration(rootPath);
	ensureProjectSession(rootPath).hydrationPromise = undefined;
	if (projectFolder.hydrationId) {
		const byStory = new Map(
			projectFolder.stories.map(story => [story.id, story] as const)
		);
		let cursor = 0;
		let done = false;
		try {
			while (!done) {
				const chunk = readProjectFolderHydrationChunk(
					projectFolder.hydrationId,
					cursor,
					1000
				);
				for (const {passage, storyId} of chunk.passages) {
					const story = byStory.get(storyId);
					const existing = story?.passages.find(
						candidate => candidate.id === passage.id
					);
					if (existing) {
						existing.text = passage.text;
					}
				}
				cursor = chunk.nextCursor;
				done = chunk.done;
			}
		} finally {
			finishProjectFolderHydration(projectFolder.hydrationId);
		}
	}
	const {stories} = projectFolder;
	const filteredStories = storyIds?.length
		? stories.filter(story => storyIds.includes(story.id))
		: stories;

	const result = {
		graphLayoutLoaded: true,
		loadPerformanceTimings: projectFolder.loadPerformanceTimings,
		passageTextLoaded: true,
		rootPath: projectFolder.rootPath,
		storySourcesLoaded: true,
		stories: filteredStories,
		storyIds: filteredStories.map(story => story.id)
	};

	rememberProjectFolder(result);
	return result;
}

export async function beginProjectFolderHydration(
	rootPath: string,
	storyIds?: string[]
): Promise<NativeProjectHydrationStart> {
	const projectFolder = await ensureProjectSessionHydration(rootPath);
	ensureProjectSession(rootPath).hydrationPromise = undefined;
	if (projectFolder.hydrationId) {
		const publicProjectFolder = {...projectFolder};
		delete publicProjectFolder.baselineReceipt;
		return {
			...publicProjectFolder,
			hydrationId: projectFolder.hydrationId,
			passageCount: projectFolder.stories.reduce(
				(total, story) => total + story.passages.length,
				0
			),
			stories: projectFolder.stories.map(story => ({...story, passages: []}))
		};
	}
	const hydratedProjectFolder = await hydrateProjectFolder(rootPath, storyIds);
	const hydrationId = uuid();
	const passages = hydratedProjectFolder.stories.flatMap(story =>
		story.passages.map(passage => ({passage, storyId: story.id}))
	);

	// Leases are intentionally short lived and renderer-owned. Clear abandoned
	// leases opportunistically without introducing another process timer.
	const oldestAllowed = Date.now() - 5 * 60 * 1000;
	for (const [id, lease] of projectHydrations) {
		if (lease.createdAt < oldestAllowed) {
			projectHydrations.delete(id);
		}
	}
	projectHydrations.set(hydrationId, {createdAt: Date.now(), passages});

	return {
		graphLayoutLoaded: hydratedProjectFolder.graphLayoutLoaded,
		hydrationId,
		loadPerformanceTimings: hydratedProjectFolder.loadPerformanceTimings,
		passageCount: passages.length,
		rootPath: hydratedProjectFolder.rootPath,
		stories: hydratedProjectFolder.stories.map(story => ({
			...story,
			passages: []
		})),
		storyIds: hydratedProjectFolder.storyIds,
		storySourcesLoaded: hydratedProjectFolder.storySourcesLoaded
	};
}

export function readProjectFolderHydrationChunk(
	hydrationId: string,
	cursor: number,
	limit = 256
): NativeProjectHydrationChunk {
	if (nativeProjectHydrations.has(hydrationId)) {
		const chunk = readNativeProjectFolderHydrationChunk(
			hydrationId,
			cursor,
			limit
		);
		if (!chunk) {
			throw new Error(
				`Native project hydration "${hydrationId}" is unavailable.`
			);
		}
		return chunk;
	}
	const lease = projectHydrations.get(hydrationId);
	if (!lease) {
		throw new Error(`Unknown or expired project hydration "${hydrationId}".`);
	}
	const boundedCursor = Math.max(0, Math.floor(cursor));
	const boundedLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
	const nextCursor = Math.min(
		lease.passages.length,
		boundedCursor + boundedLimit
	);

	return {
		done: nextCursor >= lease.passages.length,
		nextCursor,
		passages: lease.passages.slice(boundedCursor, nextCursor)
	};
}

export function finishProjectFolderHydration(hydrationId: string): void {
	if (nativeProjectHydrations.delete(hydrationId)) {
		finishNativeProjectFolderHydration(hydrationId);
	}
	projectHydrations.delete(hydrationId);
}

export async function copyProjectImportAssets(
	importId: string,
	rootPath: string
): Promise<NativeProjectAssetWriteResult[]> {
	const preparedImport = preparedProjectImports.get(importId);

	if (!preparedImport) {
		throw new Error(`No prepared project import exists with ID "${importId}".`);
	}

	const results: NativeProjectAssetWriteResult[] = [];

	for (const asset of preparedImport.assets) {
		const target = safeProjectAssetPath(rootPath, asset.targetPath);

		await mkdirp(dirname(target.absolutePath));
		await copy(asset.sourcePath, target.absolutePath, {overwrite: true});
		results.push({
			sourcePath: target.absolutePath,
			targetPath: target.projectPath
		});
	}

	const assets = await listProjectAssets(rootPath);

	await refreshProjectSessionBaseline(rootPath, undefined, {assets}).catch(
		error =>
			warnBestEffortProjectMaintenance(
				'Project import session baseline refresh',
				error
			)
	);

	return results;
}

export async function discardProjectImport(importId: string) {
	const preparedImport = preparedProjectImports.get(importId);

	if (!preparedImport) {
		return;
	}

	preparedProjectImports.delete(importId);

	if (preparedImport.cleanupPath) {
		await remove(preparedImport.cleanupPath).catch(() => undefined);
	}
}

export async function chooseAssetFile(defaultPath?: string) {
	const {canceled, filePaths} = await dialog.showOpenDialog({
		defaultPath: defaultPath?.trim() || undefined,
		properties: ['openFile'],
		title: 'Choose Asset'
	});

	return canceled ? undefined : filePaths[0];
}

export async function listProjectAssets(rootPath: string) {
	const nativeAssets = listNativeProjectAssets(rootPath);

	if (nativeAssets) {
		return nativeAssets.sort((left, right) =>
			left.path.localeCompare(right.path)
		);
	}

	allowCompatibilityProjectFallback('Project asset scanning');

	const assets: CoreAssetInventoryEntry[] = [];

	await scanAssetDirectory(rootPath, join(rootPath, 'assets'), assets);

	return assets.sort((left, right) => left.path.localeCompare(right.path));
}

function assetEffectJournalRoot() {
	try {
		return join(getStoryDirectoryPath(), '.twine-rs-asset-journal');
	} catch {
		return join(tmpdir(), 'twine-rs-asset-journal');
	}
}

function assetEffectDirectory(token: string) {
	if (!/^[a-zA-Z0-9-]+$/.test(token)) {
		throw new Error('Invalid asset effect token.');
	}

	return join(assetEffectJournalRoot(), token);
}

async function fileFingerprint(path: string) {
	try {
		const data = await readFile(path);

		return createHash('sha256').update(data).digest('hex');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return undefined;
		}
		throw error;
	}
}

async function writeAssetEffectJournal(journal: NativeAssetEffectJournal) {
	const directory = assetEffectDirectory(journal.token);

	await mkdirp(directory);
	await writeFile(
		join(directory, 'effect.json'),
		JSON.stringify(journal, null, 2),
		'utf8'
	);
}

async function readAssetEffectJournal(token: string) {
	return readJson(
		join(assetEffectDirectory(token), 'effect.json')
	) as Promise<NativeAssetEffectJournal>;
}

async function requireFingerprint(
	path: string,
	expected: string | undefined,
	description: string
) {
	const current = await fileFingerprint(path);

	if (current !== expected) {
		throw new Error(
			`${description} changed outside Twine; refusing to overwrite it.`
		);
	}
}

async function prepareAssetEffect(
	journal: Omit<NativeAssetEffectJournal, 'token'>,
	options: {backupPath?: string; forwardPath?: string} = {}
) {
	const token = uuid();
	const directory = assetEffectDirectory(token);
	const prepared = {...journal, token};

	await mkdirp(directory);
	if (options.backupPath && (await fileFingerprint(options.backupPath))) {
		await copy(options.backupPath, join(directory, 'before.bin'));
	}
	if (options.forwardPath) {
		await copy(options.forwardPath, join(directory, 'after.bin'));
	}
	await writeAssetEffectJournal(prepared);
	return prepared;
}

export async function applyProjectAssetEffect(
	effectToken: string,
	direction: 'redo' | 'undo'
) {
	const journal = await readAssetEffectJournal(effectToken);
	const directory = assetEffectDirectory(effectToken);
	const target = safeProjectAssetPath(journal.rootPath, journal.targetPath);
	const oldAsset = journal.oldPath
		? safeProjectAssetPath(journal.rootPath, journal.oldPath)
		: undefined;
	const newAsset = journal.newPath
		? safeProjectAssetPath(journal.rootPath, journal.newPath)
		: undefined;

	if (direction === 'undo') {
		if (journal.kind === 'delete') {
			await requireFingerprint(
				target.absolutePath,
				undefined,
				journal.targetPath
			);
			await mkdirp(dirname(target.absolutePath));
			await copy(join(directory, 'before.bin'), target.absolutePath);
		} else if (journal.kind === 'rename' && oldAsset && newAsset) {
			await requireFingerprint(
				newAsset.absolutePath,
				journal.afterFingerprint,
				journal.newPath!
			);
			await requireFingerprint(
				oldAsset.absolutePath,
				undefined,
				journal.oldPath!
			);
			await mkdirp(dirname(oldAsset.absolutePath));
			await move(newAsset.absolutePath, oldAsset.absolutePath);
		} else {
			await requireFingerprint(
				target.absolutePath,
				journal.afterFingerprint,
				journal.targetPath
			);
			const backup = join(directory, 'before.bin');

			if (journal.beforeFingerprint) {
				await copy(backup, target.absolutePath, {overwrite: true});
			} else {
				await remove(target.absolutePath);
			}
		}
	} else if (journal.kind === 'delete') {
		await requireFingerprint(
			target.absolutePath,
			journal.beforeFingerprint,
			journal.targetPath
		);
		await remove(target.absolutePath);
	} else if (journal.kind === 'rename' && oldAsset && newAsset) {
		await requireFingerprint(
			oldAsset.absolutePath,
			journal.afterFingerprint,
			journal.oldPath!
		);
		await requireFingerprint(
			newAsset.absolutePath,
			undefined,
			journal.newPath!
		);
		await mkdirp(dirname(newAsset.absolutePath));
		await move(oldAsset.absolutePath, newAsset.absolutePath);
	} else {
		await requireFingerprint(
			target.absolutePath,
			journal.beforeFingerprint,
			journal.targetPath
		);
		await mkdirp(dirname(target.absolutePath));
		await copy(join(directory, 'after.bin'), target.absolutePath, {
			overwrite: true
		});
	}

	await refreshProjectSessionBaseline(journal.rootPath);
}

export async function discardProjectAssetEffect(effectToken: string) {
	await remove(assetEffectDirectory(effectToken));
}

export async function cleanupStaleProjectAssetEffects() {
	// Undo history is intentionally session-only. Any journal present during a
	// new main-process startup cannot have a live Rust history entry.
	await remove(assetEffectJournalRoot());
}

export async function copyAssetToProject(
	rootPath: string,
	sourcePath: string
): Promise<NativeProjectAssetWriteResult> {
	const filename = basename(sourcePath);
	const targetPath = `assets/${filename}`;
	const destinationPath = join(rootPath, targetPath);
	const beforeFingerprint = await fileFingerprint(destinationPath);

	if (beforeFingerprint) {
		throw new Error(`${targetPath} already exists.`);
	}
	const journal = await prepareAssetEffect(
		{
			beforeFingerprint,
			kind: 'import',
			rootPath,
			targetPath
		},
		{forwardPath: sourcePath}
	);

	try {
		await mkdirp(join(rootPath, 'assets'));
		await copy(sourcePath, destinationPath, {overwrite: true});
		journal.afterFingerprint = await fileFingerprint(destinationPath);
		await writeAssetEffectJournal(journal);
	} catch (error) {
		await remove(destinationPath).catch(() => undefined);
		await discardProjectAssetEffect(journal.token);
		throw error;
	}
	await refreshProjectSessionBaseline(rootPath);

	return {
		effectToken: journal.token,
		sourcePath: destinationPath,
		targetPath
	};
}

export async function renameProjectAsset(
	rootPath: string,
	oldPath: string,
	newPath: string
): Promise<NativeProjectAssetWriteResult> {
	const oldAsset = safeProjectAssetPath(rootPath, oldPath);
	const newAsset = safeProjectAssetPath(rootPath, newPath);
	const beforeFingerprint = await fileFingerprint(oldAsset.absolutePath);

	if (!beforeFingerprint) {
		throw new Error(`${oldAsset.projectPath} does not exist.`);
	}
	if (await fileFingerprint(newAsset.absolutePath)) {
		throw new Error(`${newAsset.projectPath} already exists.`);
	}
	const journal = await prepareAssetEffect({
		afterFingerprint: beforeFingerprint,
		beforeFingerprint,
		kind: 'rename',
		newPath: newAsset.projectPath,
		oldPath: oldAsset.projectPath,
		rootPath,
		targetPath: newAsset.projectPath
	});

	try {
		await mkdirp(dirname(newAsset.absolutePath));
		await move(oldAsset.absolutePath, newAsset.absolutePath);
		await writeAssetEffectJournal(journal);
	} catch (error) {
		if (await fileFingerprint(newAsset.absolutePath).catch(() => undefined)) {
			await move(newAsset.absolutePath, oldAsset.absolutePath, {
				overwrite: true
			}).catch(() => undefined);
		}
		await discardProjectAssetEffect(journal.token);
		throw error;
	}
	await refreshProjectSessionBaseline(rootPath);

	return {
		effectToken: journal.token,
		sourcePath: newAsset.absolutePath,
		targetPath: newAsset.projectPath
	};
}

export async function replaceProjectAsset(
	rootPath: string,
	path: string,
	sourcePath: string
): Promise<NativeProjectAssetWriteResult> {
	const asset = safeProjectAssetPath(rootPath, path);
	const beforeFingerprint = await fileFingerprint(asset.absolutePath);

	if (!beforeFingerprint) {
		throw new Error(`${asset.projectPath} does not exist.`);
	}
	const journal = await prepareAssetEffect(
		{
			beforeFingerprint,
			kind: 'replace',
			rootPath,
			targetPath: asset.projectPath
		},
		{backupPath: asset.absolutePath, forwardPath: sourcePath}
	);

	try {
		await mkdirp(dirname(asset.absolutePath));
		await copy(sourcePath, asset.absolutePath, {overwrite: true});
		journal.afterFingerprint = await fileFingerprint(asset.absolutePath);
		await writeAssetEffectJournal(journal);
	} catch (error) {
		await copy(
			join(assetEffectDirectory(journal.token), 'before.bin'),
			asset.absolutePath,
			{overwrite: true}
		).catch(() => undefined);
		await discardProjectAssetEffect(journal.token);
		throw error;
	}
	await refreshProjectSessionBaseline(rootPath);

	return {
		effectToken: journal.token,
		sourcePath: asset.absolutePath,
		targetPath: asset.projectPath
	};
}

export async function deleteProjectAsset(
	rootPath: string,
	path: string
): Promise<NativeProjectAssetWriteResult> {
	const asset = safeProjectAssetPath(rootPath, path);
	const beforeFingerprint = await fileFingerprint(asset.absolutePath);

	if (!beforeFingerprint) {
		throw new Error(`${asset.projectPath} does not exist.`);
	}
	const journal = await prepareAssetEffect(
		{
			beforeFingerprint,
			kind: 'delete',
			rootPath,
			targetPath: asset.projectPath
		},
		{backupPath: asset.absolutePath}
	);
	try {
		await remove(asset.absolutePath);
		await writeAssetEffectJournal(journal);
	} catch (error) {
		await copy(
			join(assetEffectDirectory(journal.token), 'before.bin'),
			asset.absolutePath,
			{overwrite: true}
		).catch(() => undefined);
		await discardProjectAssetEffect(journal.token);
		throw error;
	}
	await refreshProjectSessionBaseline(rootPath);
	return {
		effectToken: journal.token,
		sourcePath: asset.absolutePath,
		targetPath: asset.projectPath
	};
}

export async function deleteProjectFolder(rootPath: string) {
	const absoluteRootPath = resolve(rootPath);
	const rootStats = await stat(absoluteRootPath);

	if (!rootStats.isDirectory()) {
		throw Object.assign(
			new Error(`${absoluteRootPath} is not a project folder directory.`),
			{code: 'ENOTDIR'}
		);
	}

	if (!basename(absoluteRootPath).endsWith('.twine.rs')) {
		throw new Error(
			`Refusing to delete ${absoluteRootPath}; project folders must end with .twine.rs.`
		);
	}

	let manifestStats: {isFile(): boolean};

	try {
		manifestStats = await stat(join(absoluteRootPath, 'twine.toml'));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			throw new Error(
				`Refusing to delete ${absoluteRootPath}; no twine.toml project manifest was found.`
			);
		}

		throw error;
	}

	if (!manifestStats.isFile()) {
		throw new Error(
			`Refusing to delete ${absoluteRootPath}; no twine.toml project manifest was found.`
		);
	}

	stopProjectSession(absoluteRootPath);
	await shell.trashItem(absoluteRootPath);
	forgetProjectFolder(absoluteRootPath);
}

async function ensureInitialProjectSessionBaseline(
	session: ProjectSessionState,
	storyIds?: string[],
	reservedRefreshEpoch?: number
) {
	while (!session.baseline) {
		const refreshEpoch =
			reservedRefreshEpoch ?? beginProjectAssetDigestRefresh(session);
		reservedRefreshEpoch = undefined;

		try {
			const candidate = await readProjectSessionSnapshot(
				session.rootPath,
				undefined,
				{storyIds}
			);
			assertCurrentProjectSession(session.rootPath, session);
			if (session.assetDigestRefreshEpoch === refreshEpoch) {
				const descriptor = await readProjectDescriptor(session.rootPath).catch(
					() => descriptorFromStories(candidate.stories)
				);
				assertCurrentProjectSession(session.rootPath, session);
				if (
					await installAcceptedProjectBaseline(
						session,
						candidate,
						descriptor,
						candidate.stories,
						{refreshEpoch}
					)
				) {
					return candidate;
				}
			}
		} finally {
			settleProjectAssetDigestRefresh(session, refreshEpoch);
		}
		assertCurrentProjectSession(session.rootPath, session);
		const winningEpoch = session.assetDigestRefreshEpoch ?? refreshEpoch;

		await waitForProjectAssetDigestRefresh(session, winningEpoch);
	}
	return session.baseline;
}

export async function projectSessionSnapshot(
	rootPath: string,
	storyIds?: string[]
) {
	const session = ensureProjectSession(rootPath);
	const initialRefreshEpoch = session.baseline
		? undefined
		: beginProjectAssetDigestRefresh(session);
	await waitForProjectSessionBaselineCapture(session);
	if (!session.baseline) {
		const baseline = await ensureInitialProjectSessionBaseline(
			session,
			storyIds,
			initialRefreshEpoch
		);

		session.receiptPerformance = undefined;
		return baseline;
	}
	if (initialRefreshEpoch !== undefined) {
		settleProjectAssetDigestRefresh(session, initialRefreshEpoch);
	}

	return readProjectSessionSnapshot(rootPath, session.baseline, {
		storyIds: storyIds ?? session.baseline.storyIds
	});
}

export function projectSessionAssetReadBaselines(
	rootPath: string,
	paths: string[]
): NativeProjectAssetReadBaseline[] {
	const session = projectSessions.get(projectSessionKey(rootPath));

	if (!session?.baseline) {
		throw new Error('Project assets cannot be read before indexing completes.');
	}

	const baselineFileIndex = session.baselineFileIndex;

	return paths.map(path => {
		const normalizedPath = normalizedAssetPath(path);
		const indexedPosition = baselineFileIndex?.get(normalizedPath);
		const candidate =
			indexedPosition === undefined
				? undefined
				: session.baseline?.files[indexedPosition];
		const indexed = candidate?.kind === 'asset' ? candidate : undefined;
		const digest = session.assetContentDigests?.get(normalizedPath);

		return indexed
			? {
					expectedContentDigest:
						digest?.mtimeMs === indexed.mtimeMs &&
						digest.sizeBytes === indexed.sizeBytes
							? digest.contentDigest
							: undefined,
					expectedExists: true,
					expectedModifiedAtMs: indexed.mtimeMs,
					expectedSizeBytes: indexed.sizeBytes,
					path
				}
			: {expectedExists: false, path};
	});
}

export async function startProjectSession(
	rootPath: string,
	listener?: ProjectSessionListener,
	storyIds?: string[]
) {
	const baselineStarted = performance.now();
	const session = ensureProjectSession(rootPath);
	const initialRefreshEpoch = session.baseline
		? undefined
		: beginProjectAssetDigestRefresh(session);

	if (listener) {
		session.listeners.add(listener);
	}

	await waitForProjectSessionBaselineCapture(session);
	assertCurrentProjectSession(rootPath, session);
	if (!session.baseline) {
		await ensureInitialProjectSessionBaseline(
			session,
			storyIds,
			initialRefreshEpoch
		);
		assertCurrentProjectSession(rootPath, session);
	} else if (initialRefreshEpoch !== undefined) {
		settleProjectAssetDigestRefresh(session, initialRefreshEpoch);
	}
	if (!session.baseline) {
		throw new Error(
			'Project session baseline initialization did not complete.'
		);
	}

	if (!session.watcher) {
		installProjectSessionWatcher(session);
	}

	if (!session.interval) {
		session.interval = setInterval(
			() => void pollProjectSession(session, true),
			session.watcherAvailable
				? projectSessionReconcileMs
				: projectSessionFallbackPollMs
		);
	}

	if (session.pending) {
		queueMicrotask(() => {
			if (projectSessions.get(projectSessionKey(rootPath)) === session) {
				notifyProjectSession(session);
			}
		});
	}

	assertCurrentProjectSession(rootPath, session);
	const baseline = session.baseline!;

	return {
		assets: baseline.assets,
		generation: session.generation,
		performanceTimings: performanceHarnessEnabled()
			? {
					assetCount: baseline.assets.length,
					baselineFileCount: baseline.files.length,
					baselineMode: session.receiptPerformance ? 'receipt' : 'full',
					baselinePrimeMs: performance.now() - baselineStarted,
					descriptorPathCount: session.descriptor?.paths.size ?? 0,
					receiptAdoptionMs: session.receiptPerformance?.adoptionMs,
					receiptCatchupMs: session.receiptPerformance?.catchupMs,
					receiptFileCount: session.receiptPerformance?.fileCount
				}
			: undefined,
		rootPath: baseline.rootPath,
		storyIds: baseline.storyIds
	} satisfies NativeProjectSessionStart;
}

export function unsubscribeProjectSession(
	rootPath: string,
	listener: ProjectSessionListener
) {
	const session = projectSessions.get(projectSessionKey(rootPath));

	if (!session) {
		return;
	}

	session.listeners.delete(listener);

	if (session.listeners.size === 0) {
		stopProjectSession(rootPath);
	}
}

export function stopProjectSession(rootPath: string) {
	const key = projectSessionKey(rootPath);
	const session = projectSessions.get(key);

	if (!session) {
		return;
	}

	if (session.debounceTimer) {
		clearTimeout(session.debounceTimer);
	}

	if (session.interval) {
		clearInterval(session.interval);
	}

	session.watcher?.close();
	void session.hydrationPromise?.then(project => {
		if (project.hydrationId) {
			finishProjectFolderHydration(project.hydrationId);
		}
	});
	for (const resolveWaiter of session.assetDigestRefreshWaiters ?? []) {
		resolveWaiter();
	}
	session.assetDigestRefreshWaiters?.clear();
	finishProjectSessionBaselineCapture(session);
	projectSessions.delete(key);
}

export function projectSessionMemoryDiagnostics() {
	if (!performanceHarnessEnabled()) {
		return undefined;
	}

	let baselineFileCount = 0;
	let baselineFileStringBytes = 0;
	let baselinePassageCount = 0;
	let assetDigestCount = 0;
	let assetDigestStringBytes = 0;
	let assetDigestStoryCount = 0;
	let assetDigestReadyStoryCount = 0;
	let assetDigestCandidatePathCount = 0;
	let assetDigestCandidatePathStringBytes = 0;
	let assetDigestStoryIdStringBytes = 0;
	let assetDigestUnknownReasonStringBytes = 0;
	let candidateCount = 0;
	let descriptorPathCount = 0;
	let descriptorPathStringBytes = 0;
	let resolvedCandidateCount = 0;

	for (const session of projectSessions.values()) {
		assetDigestCount += session.assetContentDigests?.size ?? 0;
		for (const [path, digest] of session.assetContentDigests ?? []) {
			assetDigestStringBytes += (path.length + digest.contentDigest.length) * 2;
		}
		assetDigestStoryCount += session.assetDigestStories?.size ?? 0;
		for (const [storyId, state] of session.assetDigestStories ?? []) {
			assetDigestStoryIdStringBytes += storyId.length * 2;
			if (state.status !== 'ready') {
				assetDigestUnknownReasonStringBytes += state.reason.length * 2;
				continue;
			}
			assetDigestReadyStoryCount++;
			assetDigestCandidatePathCount += state.paths.length;
			for (const path of state.paths) {
				assetDigestCandidatePathStringBytes += path.length * 2;
			}
		}
		baselineFileCount += session.baseline?.files.length ?? 0;
		baselinePassageCount +=
			session.baseline?.stories.reduce(
				(total, story) => total + story.passages.length,
				0
			) ?? 0;
		for (const file of session.baseline?.files ?? []) {
			baselineFileStringBytes +=
				(file.path.length + file.fingerprint.length + file.kind.length) * 2;
		}
		candidateCount += session.pending ? 1 : 0;
		descriptorPathCount += session.descriptor?.paths.size ?? 0;
		for (const path of session.descriptor?.paths.keys() ?? []) {
			descriptorPathStringBytes += path.length * 2;
		}
		resolvedCandidateCount += session.resolvedCandidates.size;
	}

	return {
		assetDigestCandidatePathCount,
		assetDigestCandidatePathStringBytes,
		assetDigestCount,
		assetDigestReadyStoryCount,
		assetDigestStoryIdStringBytes,
		assetDigestStoryCount,
		assetDigestStringBytes,
		assetDigestUnknownReasonStringBytes,
		baselineFileCount,
		baselineFileStringBytes,
		baselinePassageCount,
		candidateCount,
		descriptorPathCount,
		descriptorPathStringBytes,
		resolvedCandidateCount,
		sessionCount: projectSessions.size
	};
}

function projectSessionStart(session: ProjectSessionState) {
	const baseline = session.baseline!;

	return {
		assets: baseline.assets,
		generation: session.generation,
		rootPath: baseline.rootPath,
		storyIds: baseline.storyIds
	} satisfies NativeProjectSessionStart;
}

function rememberProjectSessionResolution(
	session: ProjectSessionState,
	deltaId: string | undefined,
	resolution: NativeProjectSessionResolution,
	start: NativeProjectSessionStart
) {
	if (!deltaId) {
		return;
	}

	session.resolvedCandidates.delete(deltaId);
	session.resolvedCandidates.set(deltaId, {resolution, start});
	while (session.resolvedCandidates.size > 32) {
		const oldest = session.resolvedCandidates.keys().next().value;

		if (oldest === undefined) {
			break;
		}
		session.resolvedCandidates.delete(oldest);
	}
}

function scheduleProjectSessionReconciliation(session: ProjectSessionState) {
	const shouldPoll =
		session.pollAfterResolution ||
		session.reconcileAfterResolution ||
		session.pathHints.size > 0;
	const reconcile = session.reconcileAfterResolution ?? false;

	session.pollAfterResolution = false;
	session.reconcileAfterResolution = false;
	if (!shouldPoll) {
		return;
	}
	if (session.debounceTimer) {
		clearTimeout(session.debounceTimer);
		session.debounceTimer = undefined;
	}

	setTimeout(() => {
		if (projectSessions.get(projectSessionKey(session.rootPath)) === session) {
			void pollProjectSession(session, reconcile);
		}
	}, 0);
}

export async function resolveProjectSessionConflicts(
	rootPath: string,
	resolution: NativeProjectSessionResolution,
	stories: Story[] = [],
	deltaId?: string
) {
	const session = ensureProjectSession(rootPath);
	const resolved = deltaId
		? session.resolvedCandidates.get(deltaId)
		: undefined;

	if (resolved) {
		if (resolved.resolution !== resolution) {
			throw new Error(
				`Project delta "${deltaId}" was already resolved as "${resolved.resolution}".`
			);
		}
		return resolved.start;
	}

	if (deltaId && (!session.pending || session.pending.delta.id !== deltaId)) {
		throw new Error(`Project delta "${deltaId}" is stale.`);
	}

	if (resolution === 'keepApp') {
		if (stories.length === 0) {
			throw new Error('Cannot keep app changes without a story snapshot.');
		}

		await writeProjectFolder(rootPath, stories[0]);
		await refreshProjectSessionBaseline(
			rootPath,
			stories.map(story => story.id),
			{stories}
		);
		session.aggregateExactNamePassageIds = undefined;
	} else if (resolution === 'acceptDisk' && session.pending) {
		const candidate = session.pending;
		const trustedDiskStories = await readProjectStories(rootPath, {
			loadPassageText: true
		});
		let retainExactNamePassageIds = false;

		if (candidate.delta.recovery) {
			const baseline = await readProjectSessionSnapshot(rootPath);
			const descriptor = await readProjectDescriptor(rootPath);

			await installAcceptedProjectBaseline(
				session,
				baseline,
				descriptor,
				trustedDiskStories,
				{forceAssetDigestRecapture: true}
			);
		} else if (candidate.passageMappingsToPersist?.length) {
			const passageMappingsToPersist = candidate.passageMappingsToPersist;
			const deferMappings = async (currentFiles?: NativeProjectFileEntry[]) => {
				session.aggregateExactNamePassageIds = new Set([
					...(session.aggregateExactNamePassageIds ?? []),
					...passageMappingsToPersist.flatMap(mapping =>
						mapping.passage.id ? [mapping.passage.id] : []
					)
				]);
				retainExactNamePassageIds = true;
				session.reconcileAfterResolution = true;
				const currentManifest = currentFiles?.find(
					file => file.path === 'twine.toml'
				);
				const files = currentManifest
					? candidate.baseline.files
							.filter(file => file.path !== 'twine.toml')
							.concat(currentManifest)
					: candidate.baseline.files;

				await installAcceptedProjectBaseline(
					session,
					{
						...candidate.baseline,
						changedPaths: [],
						conflicts: [],
						files
					},
					candidate.descriptor,
					trustedDiskStories,
					{forceAssetDigestRecapture: true}
				);
			};

			if (!(await aggregatePassageMappingsAreCurrent(rootPath, candidate))) {
				await deferMappings();
			} else {
				const persisted = await persistAggregatePassageMappings(
					rootPath,
					passageMappingsToPersist
				);
				const currentFiles = await projectFileManifest(
					rootPath,
					candidate.baseline.assets
				);

				if (!aggregatePassageMappingsMatchFiles(candidate, currentFiles)) {
					if (persisted.updated !== persisted.existing) {
						const currentManifestSource = await readTextIfPresent(
							join(rootPath, 'twine.toml')
						);

						if (currentManifestSource !== persisted.updated) {
							throw new Error(
								'twine.toml changed while passage IDs were being persisted.'
							);
						}
						await atomicWriteText(
							join(rootPath, 'twine.toml'),
							persisted.existing
						);
					}
					await deferMappings(
						await projectFileManifest(rootPath, candidate.baseline.assets)
					);
				} else {
					const currentManifest = currentFiles.find(
						file => file.path === 'twine.toml'
					);
					const files = candidate.baseline.files
						.filter(file => file.path !== 'twine.toml')
						.concat(currentManifest ? [currentManifest] : []);

					await installAcceptedProjectBaseline(
						session,
						{...candidate.baseline, files},
						candidate.descriptor,
						trustedDiskStories,
						{forceAssetDigestRecapture: true}
					);
				}
			}
		} else {
			await installAcceptedProjectBaseline(
				session,
				{
					...candidate.baseline,
					changedPaths: [],
					conflicts: []
				},
				candidate.descriptor,
				trustedDiskStories,
				{forceAssetDigestRecapture: true}
			);
		}
		if (!retainExactNamePassageIds) {
			session.aggregateExactNamePassageIds = undefined;
		}
		session.generation = candidate.delta.candidateGeneration;
		session.pending = undefined;
	} else if (resolution === 'dismiss' && session.pending) {
		session.pending.deliveryState = 'deferred';
	}

	const start = projectSessionStart(session);

	rememberProjectSessionResolution(session, deltaId, resolution, start);
	scheduleProjectSessionReconciliation(session);
	return start;
}
