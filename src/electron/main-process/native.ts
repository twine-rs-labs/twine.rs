import {existsSync} from 'fs';
import {createRequire} from 'module';
import {join, resolve} from 'path';
import {performance} from 'perf_hooks';
import type {CoreAssetInventoryEntry} from '../../core';
import type {StoryWithDocuments as Story} from '../../store/stories';
import type {
	NativeProjectAssetPayloadBatch,
	NativeProjectAssetPayloadLimits,
	ProjectStoryReplacement,
	ProjectSourceLayout
} from '../shared';
import type {
	NativeProjectAssetReadBaseline,
	NativeProjectFileEntry,
	NativeProjectFolderResult,
	NativeProjectHydrationChunk,
	NativeProjectHydrationStart,
	NativeProjectImportSource,
	NativeProjectSessionConflict
} from './project-folder';

interface NativeAddonProjectAssetPayloadBatch extends NativeProjectAssetPayloadBatch {
	payloads: Array<
		NativeProjectAssetPayloadBatch['payloads'][number] & {
			modifiedAtMs: number;
		}
	>;
}

export interface NativeProjectAssetDigestRequest {
	expectedModifiedAtMs: number;
	expectedSizeBytes: number;
	path: string;
}

export interface NativeProjectAssetDigestBatch {
	digests: Array<{contentDigest: string; path: string}>;
	failures: NativeProjectAssetPayloadBatch['failures'];
	totalSourceBytes: number;
}

interface NativeProjectAddon {
	beginProjectFolderHydrationJson(
		rootPath: string,
		storyIdsJson?: string
	): string;
	diffProjectFileManifestJson(
		previousFilesJson: string,
		currentFilesJson: string
	): string;
	findTwineHtmlFilesJson(rootPath: string): string;
	finishProjectFolderHydration(hydrationId: string): void;
	forgetProjectFolderJson(indexPath: string, rootPath: string): string;
	healthJson(): string;
	hydrationMemoryDiagnosticsJson(): string;
	listProjectAssetsJson(rootPath: string): string;
	listRememberedProjectFoldersJson(indexPath: string): string;
	loadProjectFolderJson(
		rootPath: string,
		loadProfile?: 'full' | 'shell'
	): string;
	prepareProjectImportJson(sourcePath: string): string;
	prepareHtmlImportJson(
		sourcePath: string,
		htmlFilePath: string,
		sourceKind: string
	): string;
	readProjectFolderHydrationChunkJson(
		hydrationId: string,
		cursor: number,
		limit: number
	): string;
	readProjectAssetPayloads?(
		rootPath: string,
		requests: Array<
			NativeProjectAssetReadBaseline & {enforceBaseline: boolean}
		>,
		maxFileBytes: number,
		maxFileCount: number,
		maxTotalEncodedBytes: number
	): Promise<NativeAddonProjectAssetPayloadBatch>;
	readProjectPreviewAssetPayloads?(
		rootPath: string,
		requests: Array<
			NativeProjectAssetReadBaseline & {enforceBaseline: boolean}
		>,
		maxFileBytes: number,
		maxFileCount: number,
		maxTotalEncodedBytes: number
	): Promise<NativeAddonProjectAssetPayloadBatch>;
	captureProjectAssetDigests?(
		rootPath: string,
		requests: NativeProjectAssetDigestRequest[],
		maxFileCount: number,
		maxTotalEncodedBytes: number
	): Promise<NativeProjectAssetDigestBatch>;
	createProjectFolderJson(
		rootPath: string,
		storyJson: string,
		sourceLayout?: ProjectSourceLayout
	): string;
	projectFileManifestJson(rootPath: string, assetsJson?: string): string;
	rememberProjectFolderJson(indexPath: string, projectJson: string): string;
	replaceProjectFolderStoriesJson(
		rootPath: string,
		replacementsJson: string
	): string;
	installProjectFolderNoReplace(
		stagingRootPath: string,
		destinationRootPath: string
	): string;
	saveProjectFolderJson(
		rootPath: string,
		storyJson: string,
		sourceLayout?: ProjectSourceLayout
	): string;
}

interface NativeHealthReport {
	features?: string[];
	ok?: boolean;
	version?: string;
}

export interface NativeRememberedProjectFolder {
	rootPath: string;
	storyIds: string[];
	updatedAt: string;
}

const nativeRequire = createRequire(__filename);
let addon: NativeProjectAddon | undefined;
let addonLoadAttempted = false;
let diagnostic: string | undefined;
let nativeAssetReadActive = false;
let queuedNativeAssetRead: (() => void) | undefined;
const nativeAssetDigestMaxFileCount = 100;
const nativeAssetMaxTotalEncodedBytes = 25 * 1024 * 1024;
export const nativeAssetReadBusyCode = 'NATIVE_ASSET_READER_BUSY';
const nativeAssetReadBusyMessage =
	'The referenced-media native reader is busy.';

export function nativeAssetReadBusy(error: unknown) {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		error.code === nativeAssetReadBusyCode
	);
}

function warnDiagnostic() {
	if (diagnostic && process.env.NODE_ENV !== 'test') {
		console.warn(diagnostic);
	}
}

function nativeDisabled() {
	const setting = process.env.TWINE_NATIVE?.toLowerCase();

	return (
		setting === '0' ||
		setting === 'false' ||
		setting === 'off' ||
		(process.env.NODE_ENV === 'test' && setting !== 'force')
	);
}

function addonCandidates() {
	return [
		join(__dirname, 'native', 'twine_native.node'),
		resolve(
			process.cwd(),
			'electron-build/main/src/electron/main-process/native/twine_native.node'
		)
	];
}

function loadAddon() {
	if (addonLoadAttempted) {
		return addon;
	}

	addonLoadAttempted = true;

	if (nativeDisabled()) {
		diagnostic = 'Native project backend disabled; using TypeScript fallback.';
		return undefined;
	}

	for (const candidate of addonCandidates()) {
		if (!existsSync(candidate)) {
			continue;
		}

		try {
			addon = nativeRequire(candidate) as NativeProjectAddon;
			diagnostic = undefined;
			return addon;
		} catch (error) {
			diagnostic = `Native project backend failed to load from ${candidate}: ${
				(error as Error).message
			}`;
			warnDiagnostic();
		}
	}

	if (!diagnostic) {
		diagnostic =
			'Native project backend was not built; using TypeScript fallback.';
	}

	warnDiagnostic();
	return undefined;
}

function parseNativeJson<T>(label: string, source: string): T | undefined {
	try {
		return JSON.parse(source) as T;
	} catch (error) {
		diagnostic = `Native project backend returned invalid ${label}: ${
			(error as Error).message
		}`;
		console.warn(diagnostic);
		return undefined;
	}
}

function callNative<T>(
	label: string,
	callback: (addon: NativeProjectAddon) => string
) {
	const loaded = loadAddon();

	if (!loaded) {
		return undefined;
	}

	try {
		return parseNativeJson<T>(label, callback(loaded));
	} catch (error) {
		diagnostic = `Native project backend ${label} failed: ${
			(error as Error).message
		}`;
		console.warn(diagnostic);
		return undefined;
	}
}

/**
 * Returns undefined only when the native addon is unavailable. Once the addon
 * accepts a call, validation and operational failures must propagate so a
 * compatibility writer cannot bypass a native security decision.
 */
function callNativeStrict<T>(
	label: string,
	callback: (addon: NativeProjectAddon) => string
) {
	const loaded = loadAddon();

	if (!loaded) {
		return undefined;
	}

	try {
		const result = parseNativeJson<T>(label, callback(loaded));

		if (result === undefined) {
			throw new Error(
				diagnostic ?? `Native project backend returned invalid ${label}.`
			);
		}

		return result;
	} catch (error) {
		diagnostic = `Native project backend ${label} failed: ${
			(error as Error).message
		}`;
		warnDiagnostic();
		throw error;
	}
}

function reviveDate(value: unknown) {
	const date =
		value instanceof Date
			? value
			: typeof value === 'string' || typeof value === 'number'
				? new Date(value)
				: new Date();

	return Number.isFinite(date.getTime()) ? date : new Date();
}

function reviveStory(story: Story): Story {
	return {
		...story,
		lastUpdate: reviveDate(story.lastUpdate),
		passages: Array.isArray(story.passages) ? story.passages : [],
		selected: story.selected ?? false,
		tagColors: story.tagColors ?? {},
		tags: story.tags ?? []
	};
}

function reviveProjectFolderResult(
	result: NativeProjectFolderResult | undefined
) {
	if (!result) {
		return undefined;
	}

	const stories = Array.isArray(result.stories)
		? result.stories.map(reviveStory)
		: [];

	return {
		...result,
		stories,
		storyIds: Array.isArray(result.storyIds)
			? result.storyIds
			: stories.map(story => story.id)
	};
}

export function nativeProjectHealth() {
	return callNative<NativeHealthReport>('health', addon => addon.healthJson());
}

export function nativeProjectDiagnostic() {
	loadAddon();
	return diagnostic;
}

export function nativeHydrationMemoryDiagnostics() {
	if (process.env.TWINE_PERF !== '1') {
		return undefined;
	}

	return callNative<{
		activeLeaseCount: number;
		passageCount: number;
		textCapacityBytes: number;
		textLengthBytes: number;
	}>('native hydration memory diagnostics', addon =>
		addon.hydrationMemoryDiagnosticsJson()
	);
}

export function nativeProjectAvailable() {
	return nativeProjectHealth()?.ok === true;
}

export function nativeProjectAssetEmbeddingAvailable() {
	return typeof loadAddon()?.readProjectAssetPayloads === 'function';
}

export function nativeProjectAssetDigestCaptureAvailable() {
	return typeof loadAddon()?.captureProjectAssetDigests === 'function';
}

function enqueueNativeAssetRead<T>(operation: () => Promise<T> | T) {
	if (nativeAssetReadActive && queuedNativeAssetRead) {
		return Promise.reject(
			Object.assign(new Error(nativeAssetReadBusyMessage), {
				code: nativeAssetReadBusyCode
			})
		);
	}
	return new Promise<T>((resolvePromise, rejectPromise) => {
		const run = () => {
			nativeAssetReadActive = true;
			Promise.resolve()
				.then(operation)
				.then(resolvePromise, rejectPromise)
				.finally(() => {
					const next = queuedNativeAssetRead;

					queuedNativeAssetRead = undefined;
					if (next) {
						next();
					} else {
						nativeAssetReadActive = false;
					}
				});
		};

		if (nativeAssetReadActive) {
			queuedNativeAssetRead = run;
		} else {
			run();
		}
	});
}

export async function captureNativeProjectAssetDigests(
	rootPath: string,
	requests: NativeProjectAssetDigestRequest[]
) {
	const capture = loadAddon()?.captureProjectAssetDigests;

	if (!capture) {
		throw new Error(
			'The native referenced-media digest reader is unavailable.'
		);
	}
	return enqueueNativeAssetRead(() =>
		capture(
			rootPath,
			requests,
			nativeAssetDigestMaxFileCount,
			nativeAssetMaxTotalEncodedBytes
		)
	);
}

export async function readNativeProjectAssetPayloads(
	rootPath: string,
	baselines: NativeProjectAssetReadBaseline[],
	limits: NativeProjectAssetPayloadLimits
) {
	const reader = loadAddon()?.readProjectAssetPayloads;

	if (!reader) {
		throw new Error(
			'The native referenced-media embedding reader is unavailable.'
		);
	}
	return enqueueNativeAssetRead(async () => {
		const result = await reader(
			rootPath,
			baselines.map(baseline => ({...baseline, enforceBaseline: true})),
			limits.maxFileBytes,
			limits.maxFileCount,
			limits.maxTotalEncodedBytes
		);

		return {
			...result,
			payloads: result.payloads.map(payload => ({
				bytes: payload.bytes,
				encodedSizeBytes: payload.encodedSizeBytes,
				mediaType: payload.mediaType,
				path: payload.path,
				sizeBytes: payload.sizeBytes
			}))
		} satisfies NativeProjectAssetPayloadBatch;
	});
}

export async function readNativeProjectPreviewAssetPayloads(
	rootPath: string,
	baselines: NativeProjectAssetReadBaseline[],
	limits: NativeProjectAssetPayloadLimits
) {
	const reader = loadAddon()?.readProjectPreviewAssetPayloads;

	if (!reader) {
		throw new Error('The native scratch-preview asset reader is unavailable.');
	}
	return enqueueNativeAssetRead(async () => {
		const result = await reader(
			rootPath,
			baselines.map(baseline => ({...baseline, enforceBaseline: true})),
			limits.maxFileBytes,
			limits.maxFileCount,
			limits.maxTotalEncodedBytes
		);

		return {
			...result,
			payloads: result.payloads.map(payload => ({
				bytes: payload.bytes,
				encodedSizeBytes: payload.encodedSizeBytes,
				mediaType: payload.mediaType,
				path: payload.path,
				sizeBytes: payload.sizeBytes
			}))
		} satisfies NativeProjectAssetPayloadBatch;
	});
}

export function loadNativeProjectFolder(
	rootPath: string,
	options: {loadPassageText?: boolean} = {}
) {
	const loaded = loadAddon();

	if (!loaded) {
		return undefined;
	}

	try {
		const nativeStarted = performance.now();
		const source = loaded.loadProjectFolderJson(
			rootPath,
			options.loadPassageText === false ? 'shell' : 'full'
		);
		const nativeFinished = performance.now();
		const parseStarted = performance.now();
		const result = parseNativeJson<NativeProjectFolderResult>(
			'project load',
			source
		);
		const parseFinished = performance.now();

		if (result?.loadPerformanceTimings && process.env.TWINE_PERF === '1') {
			result.loadPerformanceTimings = {
				...result.loadPerformanceTimings,
				jsJsonParseMs: parseFinished - parseStarted,
				mainNativeCallMs: nativeFinished - nativeStarted,
				payloadBytes: Buffer.byteLength(source)
			};
		}

		return reviveProjectFolderResult(result);
	} catch (error) {
		diagnostic = `Native project backend project load failed: ${
			(error as Error).message
		}`;
		warnDiagnostic();
		return undefined;
	}
}

export function beginNativeProjectFolderHydration(
	rootPath: string,
	storyIds?: string[]
) {
	const loaded = loadAddon();
	if (!loaded?.beginProjectFolderHydrationJson) {
		return undefined;
	}
	const nativeStarted = performance.now();
	const source = loaded.beginProjectFolderHydrationJson(
		rootPath,
		storyIds?.length ? JSON.stringify(storyIds) : undefined
	);
	const nativeFinished = performance.now();
	const parseStarted = performance.now();
	const result = parseNativeJson<NativeProjectHydrationStart>(
		'project hydration start',
		source
	);
	const parseFinished = performance.now();

	if (result?.loadPerformanceTimings && process.env.TWINE_PERF === '1') {
		result.loadPerformanceTimings = {
			...result.loadPerformanceTimings,
			jsJsonParseMs: parseFinished - parseStarted,
			mainNativeCallMs: nativeFinished - nativeStarted,
			payloadBytes: Buffer.byteLength(source)
		};
	}
	return reviveProjectFolderResult(result) as NativeProjectHydrationStart;
}

export function readNativeProjectFolderHydrationChunk(
	hydrationId: string,
	cursor: number,
	limit: number
) {
	const loaded = loadAddon();
	if (!loaded?.readProjectFolderHydrationChunkJson) {
		return undefined;
	}
	return parseNativeJson<NativeProjectHydrationChunk>(
		'project hydration chunk',
		loaded.readProjectFolderHydrationChunkJson(hydrationId, cursor, limit)
	);
}

export function finishNativeProjectFolderHydration(hydrationId: string) {
	loadAddon()?.finishProjectFolderHydration?.(hydrationId);
}

export function saveNativeProjectFolder(
	rootPath: string,
	story: Story,
	sourceLayout?: ProjectSourceLayout
) {
	return reviveProjectFolderResult(
		callNativeStrict<NativeProjectFolderResult>('project save', addon =>
			addon.saveProjectFolderJson(rootPath, JSON.stringify(story), sourceLayout)
		)
	);
}

export function createNativeProjectFolder(
	rootPath: string,
	story: Story,
	sourceLayout?: ProjectSourceLayout
) {
	return reviveProjectFolderResult(
		callNativeStrict<NativeProjectFolderResult>('project create', addon =>
			addon.createProjectFolderJson(
				rootPath,
				JSON.stringify(story),
				sourceLayout
			)
		)
	);
}

export function replaceNativeProjectFolderStories(
	rootPath: string,
	replacements: ProjectStoryReplacement[]
) {
	return reviveProjectFolderResult(
		callNativeStrict<NativeProjectFolderResult>('project duplication', addon =>
			addon.replaceProjectFolderStoriesJson(
				rootPath,
				JSON.stringify(replacements)
			)
		)
	);
}

export function installNativeProjectFolderNoReplace(
	stagingRootPath: string,
	destinationRootPath: string
) {
	return callNativeStrict<boolean>('project-folder installation', addon =>
		addon.installProjectFolderNoReplace(stagingRootPath, destinationRootPath)
	);
}

export function rememberNativeProjectFolder(
	indexPath: string,
	project: NativeProjectFolderResult
) {
	return callNative<NativeRememberedProjectFolder>(
		'project library remember',
		addon => addon.rememberProjectFolderJson(indexPath, JSON.stringify(project))
	);
}

export function rememberNativeProjectFolderStrict(
	indexPath: string,
	project: NativeProjectFolderResult
) {
	return callNativeStrict<NativeRememberedProjectFolder>(
		'project library remember',
		addon => addon.rememberProjectFolderJson(indexPath, JSON.stringify(project))
	);
}

export function forgetNativeProjectFolder(indexPath: string, rootPath: string) {
	return callNative<NativeRememberedProjectFolder[]>(
		'project library forget',
		addon => addon.forgetProjectFolderJson(indexPath, rootPath)
	);
}

export function listRememberedNativeProjectFolders(indexPath: string) {
	return callNative<NativeRememberedProjectFolder[]>(
		'project library list',
		addon => addon.listRememberedProjectFoldersJson(indexPath)
	);
}

export function listNativeProjectAssets(rootPath: string) {
	return callNative<CoreAssetInventoryEntry[]>('asset scan', addon =>
		addon.listProjectAssetsJson(rootPath)
	);
}

export function nativeProjectFileManifest(
	rootPath: string,
	assets?: CoreAssetInventoryEntry[]
) {
	return callNative<NativeProjectFileEntry[]>('file manifest', addon =>
		addon.projectFileManifestJson(
			rootPath,
			assets ? JSON.stringify(assets) : undefined
		)
	);
}

export function diffNativeProjectFileManifest(
	previousFiles: NativeProjectFileEntry[],
	currentFiles: NativeProjectFileEntry[]
) {
	return callNative<NativeProjectSessionConflict[]>(
		'file manifest diff',
		addon =>
			addon.diffProjectFileManifestJson(
				JSON.stringify(previousFiles),
				JSON.stringify(currentFiles)
			)
	);
}

export function findNativeTwineHtmlFiles(rootPath: string) {
	return callNative<string[]>('HTML discovery', addon =>
		addon.findTwineHtmlFilesJson(rootPath)
	);
}

export function prepareNativeProjectImport(sourcePath: string) {
	return callNative<
		Omit<NativeProjectImportSource, 'id'> & {cleanupPath?: string}
	>('project import preparation', addon =>
		addon.prepareProjectImportJson(sourcePath)
	);
}

export function prepareNativeHtmlImport(
	sourcePath: string,
	htmlFilePath: string,
	sourceKind: NativeProjectImportSource['sourceKind']
) {
	return callNative<Omit<NativeProjectImportSource, 'id'>>(
		'HTML import preparation',
		addon => addon.prepareHtmlImportJson(sourcePath, htmlFilePath, sourceKind)
	);
}
