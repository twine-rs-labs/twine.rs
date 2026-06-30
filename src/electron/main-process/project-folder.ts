import {FSWatcher, watch} from 'fs';
import {createHash} from 'crypto';
import {tmpdir} from 'os';
import {dialog} from 'electron';
import {v4 as uuid} from '@lukeed/uuid';
import extractZip from 'extract-zip';
import {
	copy,
	mkdtemp,
	mkdirp,
	move,
	readFile,
	readJson,
	readdir,
	remove,
	stat,
	writeFile
} from 'fs-extra';
import {basename, dirname, extname, join, relative, resolve} from 'path';
import type {CoreAssetInventoryEntry} from '../../core';
import {
	assetKindForPath,
	assetSnippet,
	fileUrlForPath,
	localAssetReferencePath,
	normalizedAssetPath
} from '../../core/asset-paths';
import {Passage, Story} from '../../store/stories';
import {
	diffNativeProjectFileManifest,
	findNativeTwineHtmlFiles,
	listNativeProjectAssets,
	loadNativeProjectFolder,
	nativeProjectFileManifest,
	nativeProjectDiagnostic,
	prepareNativeHtmlImport,
	prepareNativeProjectImport,
	saveNativeProjectFolder
} from './native';
import {
	forgetProjectFolder,
	rememberProjectFolder
} from './project-library-index';
import {getStoryDirectoryPath} from './story-directory';

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
	| 'acceptDisk'
	| 'dismiss'
	| 'keepApp';

export interface NativeProjectFileEntry {
	fingerprint: string;
	kind: NativeProjectFileKind;
	modifiedAt: string;
	mtimeMs: number;
	path: string;
	sizeBytes: number;
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

type ProjectSessionListener = (snapshot: NativeProjectSessionSnapshot) => void;

interface ProjectSessionState {
	baseline?: NativeProjectSessionSnapshot;
	baselineReusableUntil?: number;
	debounceTimer?: ReturnType<typeof setTimeout>;
	interval?: ReturnType<typeof setInterval>;
	listeners: Set<ProjectSessionListener>;
	pending?: NativeProjectSessionSnapshot;
	rescanRequested?: boolean;
	rootPath: string;
	scanning?: boolean;
	watcher?: FSWatcher;
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
	name?: string;
	passages: ParsedProjectPassage[];
	script?: string;
	snap_to_grid?: boolean;
	start_passage?: string;
	story_format?: string;
	story_format_version?: string;
	stylesheet?: string;
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
const preparedProjectImports = new Map<
	string,
	{assets: NativeProjectImportAsset[]; cleanupPath?: string}
>();
const projectSessionPollMs = 1250;
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
	return (
		value
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9._-]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 80) || 'untitled-story'
	);
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
		story.passages = story.passages.map(passage => ({
			...passage,
			tags: coerceStringArray(passage.tags)
		}));
	}

	return stories.filter(story => story.id || story.name);
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
	const folderName = `${pathSlug(story.name)}.twine.rs`;

	return basename(parent) === folderName ? parent : join(parent, folderName);
}

function passageFileName(index: number, passageName: string) {
	return `${String(index + 1).padStart(3, '0')}-${pathSlug(passageName)}.twee`;
}

function projectToml(story: Story, passageFiles: string[]) {
	const storySlug = pathSlug(story.name);
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
			`file = ${tomlString(passageFiles[index])}`,
			`tags = ${tomlStringArray(passage.tags)}`,
			''
		);
	}

	return `${lines.join('\n')}\n`;
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
	const absolutePath = join(rootPath, projectPath);
	let fileStats: Awaited<ReturnType<typeof stat>>;

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
		fingerprint: `${fileStats.mtimeMs}:${fileStats.size}`,
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
		fingerprint: `${mtimeMs}:${asset.sizeBytes}`,
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
	const scans = [
		scanProjectFiles(rootPath, 'twine.toml', 'manifest', files),
		scanProjectFiles(rootPath, '.twine/project.json', 'metadata', files),
		scanProjectFiles(rootPath, '.twine/graph.json', 'graph', files),
		scanProjectFiles(rootPath, 'passages', 'passage', files),
		scanProjectFiles(rootPath, 'scripts', 'script', files),
		scanProjectFiles(rootPath, 'styles', 'stylesheet', files)
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
		| {passages?: Record<string, Partial<Record<string, number>>>}
		| undefined,
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

	const graph = await readJsonIfPresent<{
		passages?: Record<string, Partial<Record<string, number>>>;
	}>(join(rootPath, '.twine', 'graph.json'), {ignoreInvalidJson: true});
	const metadataById = new Map(
		metadataStories.flatMap(story =>
			story.id ? [[story.id, story] as const] : []
		)
	);
	const stories: Story[] = [];

	for (const [storyIndex, parsed] of parsedStories.entries()) {
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
			(scriptPath ? await readTextIfPresent(scriptPath) : undefined) ??
			metadataStory?.script ??
			'';
		const stylesheet =
			(stylesheetPath ? await readTextIfPresent(stylesheetPath) : undefined) ??
			metadataStory?.stylesheet ??
			'';
		const metadataPassages = new Map(
			(metadataStory?.passages ?? [])
				.filter(
					(passage): passage is RendererProjectMetadataPassage & {id: string} =>
						typeof passage.id === 'string'
				)
				.map(passage => [passage.id, passage])
		);
		const passages = await Promise.all(
			parsed.passages.map(async (passage, passageIndex) => {
				const passageId =
					passage.id ?? `${storyId}-passage-${String(passageIndex + 1)}`;
				const metadataPassage = metadataPassages.get(passageId);
				const passagePath = safeProjectFilePath(rootPath, passage.file);
				const layout = graphLayoutForPassage(graph, passageId);
				const text =
					options.loadPassageText === false
						? ''
						: ((passagePath
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
						passage.name ??
						metadataPassage?.name ??
						`Passage ${passageIndex + 1}`,
					selected: metadataPassage?.selected ?? false,
					story: storyId,
					tags: passage.tags ?? metadataPassage?.tags ?? [],
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
			tagColors: metadataStory?.tagColors ?? {},
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
		passageTextLoaded: options.loadPassageText !== false,
		rootPath,
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

function notifyProjectSession(session: ProjectSessionState) {
	const snapshot = session.pending;

	if (!snapshot) {
		return;
	}

	for (const listener of session.listeners) {
		listener(snapshot);
	}
}

async function pollProjectSession(session: ProjectSessionState) {
	if (session.scanning) {
		session.rescanRequested = true;
		return;
	}

	session.scanning = true;

	try {
		const snapshot = await readProjectSessionSnapshot(
			session.rootPath,
			session.baseline,
			{storyIds: session.baseline?.storyIds}
		);
		const previousConflictIds = (session.pending?.conflicts ?? [])
			.map(conflict => conflict.id)
			.join('\n');
		const currentConflictIds = snapshot.conflicts
			.map(conflict => conflict.id)
			.join('\n');

		if (snapshot.conflicts.length > 0) {
			session.pending = snapshot;

			if (currentConflictIds !== previousConflictIds) {
				notifyProjectSession(session);
			}
		} else {
			session.pending = undefined;
			session.baseline = snapshot;
		}
	} finally {
		session.scanning = false;

		if (session.rescanRequested) {
			session.rescanRequested = false;
			void pollProjectSession(session);
		}
	}
}

function scheduleProjectSessionPoll(session: ProjectSessionState) {
	if (session.debounceTimer) {
		clearTimeout(session.debounceTimer);
	}

	session.debounceTimer = setTimeout(() => {
		session.debounceTimer = undefined;
		void pollProjectSession(session);
	}, projectSessionWatchDebounceMs);
}

function ensureProjectSession(rootPath: string) {
	const key = projectSessionKey(rootPath);
	let session = projectSessions.get(key);

	if (!session) {
		session = {
			listeners: new Set<ProjectSessionListener>(),
			rootPath
		};
		projectSessions.set(key, session);
	}

	return session;
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

	session.baseline = await readProjectSessionSnapshot(rootPath, undefined, {
		...hints,
		storyIds: storyIds ?? session.baseline?.storyIds
	});
	session.pending = undefined;
	session.baselineReusableUntil = undefined;
}

async function primeProjectSessionBaseline(
	rootPath: string,
	hints: ProjectSessionSnapshotHints
) {
	const session = ensureProjectSession(rootPath);

	session.baseline = await readProjectSessionSnapshot(
		rootPath,
		undefined,
		hints
	);
	session.pending = undefined;
	session.baselineReusableUntil = Date.now() + projectSessionPollMs;

	return session.baseline;
}

function reusableProjectSessionBaseline(
	session: ProjectSessionState,
	storyIds?: string[]
) {
	if (
		!session.baseline ||
		!session.baselineReusableUntil ||
		Date.now() > session.baselineReusableUntil
	) {
		return undefined;
	}

	if (
		storyIds?.length &&
		!storyIds.every(storyId => session.baseline?.storyIds.includes(storyId))
	) {
		return undefined;
	}

	return session.baseline;
}

export async function createProjectFolder(
	story: Story,
	preferredParent?: string
): Promise<NativeProjectFolderResult> {
	const rootPath = projectRootForStory(story, preferredParent);

	const writtenProject = await writeProjectFolder(rootPath, story);
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
	story: Story
): Promise<NativeProjectFolderResult> {
	const writtenProject = await writeProjectFolder(rootPath, story);
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

async function writeProjectFolder(rootPath: string, story: Story) {
	const nativeResult = saveNativeProjectFolder(rootPath, story);

	if (nativeResult) {
		return nativeResult;
	}

	if (!legacyProjectFallbackEnabled()) {
		requireNativeProjectBackend('Project folder saving');
	}

	const storySlug = pathSlug(story.name);
	const passageRoot = join(rootPath, 'passages', storySlug);
	const passageFiles = story.passages.map(
		(passage, index) =>
			`passages/${storySlug}/${passageFileName(index, passage.name)}`
	);

	await mkdirp(passageRoot);
	await mkdirp(join(rootPath, 'scripts'));
	await mkdirp(join(rootPath, 'styles'));
	await mkdirp(join(rootPath, 'assets'));
	await mkdirp(join(rootPath, '.twine'));

	await Promise.all(
		story.passages.map((passage, index) =>
			writeFile(join(rootPath, passageFiles[index]), passage.text, 'utf8')
		)
	);
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
		projectToml(story, passageFiles),
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

	const projectFolder = await readProjectFolder(rootPath, options);
	await primeProjectSessionBaseline(rootPath, {
		stories: projectFolder.stories,
		storyIds: projectFolder.storyIds
	});
	rememberProjectFolder(projectFolder);

	return projectFolder;
}

export async function hydrateProjectFolder(
	rootPath: string,
	storyIds?: string[]
): Promise<NativeProjectFolderResult> {
	const projectFolder = await readProjectFolder(rootPath, {
		loadPassageText: true
	});
	const {stories} = projectFolder;
	const filteredStories = storyIds?.length
		? stories.filter(story => storyIds.includes(story.id))
		: stories;

	const result = {
		passageTextLoaded: true,
		rootPath: projectFolder.rootPath,
		stories: filteredStories,
		storyIds: filteredStories.map(story => story.id)
	};

	rememberProjectFolder(result);
	return result;
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
	await remove(absoluteRootPath);
	forgetProjectFolder(absoluteRootPath);
}

export async function projectSessionSnapshot(
	rootPath: string,
	storyIds?: string[]
) {
	const session = ensureProjectSession(rootPath);
	const reusable = reusableProjectSessionBaseline(session, storyIds);

	if (reusable) {
		return reusable;
	}

	if (!session.baseline) {
		session.baseline = await readProjectSessionSnapshot(rootPath, undefined, {
			storyIds
		});
		return session.baseline;
	}

	return readProjectSessionSnapshot(rootPath, session.baseline, {
		storyIds: storyIds ?? session.baseline.storyIds
	});
}

export async function startProjectSession(
	rootPath: string,
	listener?: ProjectSessionListener,
	storyIds?: string[]
) {
	const session = ensureProjectSession(rootPath);

	if (listener) {
		session.listeners.add(listener);
	}

	const baselineWasMissing = !session.baseline;
	const reusable = reusableProjectSessionBaseline(session, storyIds);

	if (!session.baseline) {
		session.baseline = await readProjectSessionSnapshot(rootPath, undefined, {
			storyIds
		});
	}

	if (!session.interval) {
		session.interval = setInterval(
			() => void pollProjectSession(session),
			projectSessionPollMs
		);
	}

	if (!session.watcher) {
		try {
			session.watcher = watch(rootPath, {recursive: true}, () =>
				scheduleProjectSessionPoll(session)
			);
		} catch {
			// Polling above remains active when recursive watching is unavailable.
		}
	}

	if (session.pending) {
		return session.pending;
	}

	if (reusable) {
		return reusable;
	}

	if (baselineWasMissing) {
		return session.baseline;
	}

	return readProjectSessionSnapshot(rootPath, session.baseline, {
		storyIds: storyIds ?? session.baseline.storyIds
	});
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
	projectSessions.delete(key);
}

export async function resolveProjectSessionConflicts(
	rootPath: string,
	resolution: NativeProjectSessionResolution,
	stories: Story[] = []
) {
	if (resolution === 'keepApp') {
		if (stories.length === 0) {
			throw new Error('Cannot keep app changes without a story snapshot.');
		}

		await writeProjectFolder(rootPath, stories[0]);
	}

	const session = ensureProjectSession(rootPath);
	const snapshot = await readProjectSessionSnapshot(rootPath);

	session.baseline = snapshot;
	session.pending = undefined;

	return snapshot;
}
