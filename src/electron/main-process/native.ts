import {existsSync} from 'fs';
import {createRequire} from 'module';
import {join, resolve} from 'path';
import type {CoreAssetInventoryEntry} from '../../core';
import type {Story} from '../../store/stories';
import type {
	NativeProjectFileEntry,
	NativeProjectFolderResult,
	NativeProjectImportSource,
	NativeProjectSessionConflict
} from './project-folder';

interface NativeProjectAddon {
	diffProjectFileManifestJson(
		previousFilesJson: string,
		currentFilesJson: string
	): string;
	findTwineHtmlFilesJson(rootPath: string): string;
	healthJson(): string;
	listProjectAssetsJson(rootPath: string): string;
	loadProjectFolderJson(
		rootPath: string,
		loadPassageText?: boolean
	): string;
	prepareHtmlImportJson(
		sourcePath: string,
		htmlFilePath: string,
		sourceKind: string
	): string;
	projectFileManifestJson(rootPath: string, assetsJson?: string): string;
}

interface NativeHealthReport {
	features?: string[];
	ok?: boolean;
	version?: string;
}

const nativeRequire = createRequire(__filename);
let addon: NativeProjectAddon | undefined;
let addonLoadAttempted = false;
let diagnostic: string | undefined;

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
			'src/electron/main-process/native/twine_native.node'
		),
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

function callNative<T>(label: string, callback: (addon: NativeProjectAddon) => string) {
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

export function nativeProjectAvailable() {
	return nativeProjectHealth()?.ok === true;
}

export function loadNativeProjectFolder(
	rootPath: string,
	options: {loadPassageText?: boolean} = {}
) {
	return reviveProjectFolderResult(
		callNative<NativeProjectFolderResult>('project load', addon =>
			addon.loadProjectFolderJson(rootPath, options.loadPassageText !== false)
		)
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
	return callNative<NativeProjectSessionConflict[]>('file manifest diff', addon =>
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
