import {FSWatcher, watch} from 'fs';
import {dialog, nativeImage} from 'electron';
import {
	copy,
	mkdirp,
	move,
	readFile,
	readJson,
	readdir,
	remove,
	stat,
	writeFile,
	writeJson
} from 'fs-extra';
import {basename, dirname, join, relative, resolve} from 'path';
import type {CoreAssetInventoryEntry} from '../../core';
import {
	assetKindForPath,
	assetSnippet,
	fileUrlForPath,
	localAssetReferencePath,
	normalizedAssetPath
} from '../../core/asset-paths';
import {Story} from '../../store/stories';
import {getStoryDirectoryPath} from './story-directory';

export interface NativeProjectFolderResult {
	rootPath: string;
	stories: Story[];
	storyIds: string[];
}

export interface NativeProjectAssetWriteResult {
	sourcePath: string;
	targetPath: string;
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

type ProjectSessionListener = (
	snapshot: NativeProjectSessionSnapshot
) => void;

interface ProjectSessionState {
	baseline?: NativeProjectSessionSnapshot;
	debounceTimer?: ReturnType<typeof setTimeout>;
	interval?: ReturnType<typeof setInterval>;
	listeners: Set<ProjectSessionListener>;
	pending?: NativeProjectSessionSnapshot;
	rescanRequested?: boolean;
	rootPath: string;
	scanning?: boolean;
	watcher?: FSWatcher;
}

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

const projectSessions = new Map<string, ProjectSessionState>();
const projectSessionPollMs = 1250;
const projectSessionWatchDebounceMs = 150;

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

async function readJsonIfPresent<T>(path: string): Promise<T | undefined> {
	try {
		return (await readJson(path)) as T;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return undefined;
		}

		throw error;
	}
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

function reviveStory(story: Story): Story {
	return {
		...story,
		lastUpdate: new Date(story.lastUpdate)
	};
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
	const imageSize =
		kind === 'image' ? nativeImage.createFromPath(absolutePath).getSize() : null;
	const width = imageSize?.width || null;
	const height = imageSize?.height || null;

	return {
		durationMs: null,
		exists: true,
		height,
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
		width
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

		assets.push(
			projectAssetInventoryEntry(assetPath, absolutePath, fileStats)
		);
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

async function projectFileManifest(rootPath: string) {
	const files: NativeProjectFileEntry[] = [];

	await Promise.all([
		scanProjectFiles(rootPath, 'twine.toml', 'manifest', files),
		scanProjectFiles(rootPath, '.twine/project.json', 'metadata', files),
		scanProjectFiles(rootPath, '.twine/graph.json', 'graph', files),
		scanProjectFiles(rootPath, 'passages', 'passage', files),
		scanProjectFiles(rootPath, 'scripts', 'script', files),
		scanProjectFiles(rootPath, 'styles', 'stylesheet', files),
		scanProjectFiles(rootPath, 'assets', 'asset', files)
	]);

	return files.sort((left, right) => left.path.localeCompare(right.path));
}

function projectSessionConflicts(
	previousFiles: NativeProjectFileEntry[],
	currentFiles: NativeProjectFileEntry[]
) {
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
	graph: {passages?: Record<string, Partial<Record<string, number>>>} | undefined,
	passageId: string
) {
	return graph?.passages?.[passageId] ?? {};
}

async function storiesFromProjectManifest(
	rootPath: string,
	metadataStories: Story[]
) {
	const source = await readTextIfPresent(join(rootPath, 'twine.toml'));

	if (!source) {
		return metadataStories;
	}

	const parsedStories = parseProjectToml(source);

	if (parsedStories.length === 0) {
		return metadataStories;
	}

	const graph = await readJsonIfPresent<{
		passages?: Record<string, Partial<Record<string, number>>>;
	}>(join(rootPath, '.twine', 'graph.json'));
	const metadataById = new Map(metadataStories.map(story => [story.id, story]));
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
			(metadataStory?.passages ?? []).map(passage => [passage.id, passage])
		);
		const passages = await Promise.all(
			parsed.passages.map(async (passage, passageIndex) => {
				const passageId =
					passage.id ?? `${storyId}-passage-${String(passageIndex + 1)}`;
				const metadataPassage = metadataPassages.get(passageId);
				const passagePath = safeProjectFilePath(rootPath, passage.file);
				const layout = graphLayoutForPassage(graph, passageId);
				const text =
					(passagePath ? await readTextIfPresent(passagePath) : undefined) ??
					metadataPassage?.text ??
					'';

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
				parsed.start_passage ?? metadataStory?.startPassage ?? passages[0]?.id ?? '',
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

	return stories;
}

async function readProjectStories(rootPath: string) {
	const data = await readJsonIfPresent<{stories?: Story[]}>(
		join(rootPath, '.twine', 'project.json')
	);
	const metadataStories = ((data?.stories ?? []) as Story[]).map(reviveStory);

	return storiesFromProjectManifest(rootPath, metadataStories);
}

async function readProjectSessionSnapshot(
	rootPath: string,
	baseline?: NativeProjectSessionSnapshot
): Promise<NativeProjectSessionSnapshot> {
	const [stories, assets, files] = await Promise.all([
		readProjectStories(rootPath),
		listProjectAssets(rootPath),
		projectFileManifest(rootPath)
	]);
	const conflicts = baseline ? projectSessionConflicts(baseline.files, files) : [];

	return {
		assets,
		changedPaths: conflicts.map(conflict => conflict.path),
		conflicts,
		files,
		rootPath,
		scannedAt: new Date().toISOString(),
		stories,
		storyIds: stories.map(story => story.id)
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
			session.baseline
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

async function refreshProjectSessionBaseline(rootPath: string) {
	const session = projectSessions.get(projectSessionKey(rootPath));

	if (!session) {
		return;
	}

	session.baseline = await readProjectSessionSnapshot(rootPath);
	session.pending = undefined;
}

export async function createProjectFolder(
	story: Story,
	preferredParent?: string
): Promise<NativeProjectFolderResult> {
	const rootPath = projectRootForStory(story, preferredParent);

	await writeProjectFolder(rootPath, story);
	await refreshProjectSessionBaseline(rootPath);

	return {
		rootPath,
		stories: [story],
		storyIds: [story.id]
	};
}

export async function saveProjectFolder(
	rootPath: string,
	story: Story
): Promise<NativeProjectFolderResult> {
	await writeProjectFolder(rootPath, story);
	await refreshProjectSessionBaseline(rootPath);

	return {
		rootPath,
		stories: [story],
		storyIds: [story.id]
	};
}

async function writeProjectFolder(rootPath: string, story: Story) {
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
	await writeJson(join(rootPath, '.twine', 'project.json'), {
		schema: 'twine.rs/renderer-project',
		version: 1,
		stories: [story]
	});
	await writeFile(
		join(rootPath, 'twine.toml'),
		projectToml(story, passageFiles),
		'utf8'
	);
}

export async function openProjectFolder(): Promise<
	NativeProjectFolderResult | undefined
> {
	const {canceled, filePaths} = await dialog.showOpenDialog({
		properties: ['openDirectory'],
		title: 'Open Project Folder'
	});

	if (canceled || !filePaths[0]) {
		return undefined;
	}

	const rootPath = filePaths[0];
	const stories = await readProjectStories(rootPath);
	await refreshProjectSessionBaseline(rootPath);

	return {
		rootPath,
		stories,
		storyIds: stories.map(story => story.id)
	};
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
	const assets: CoreAssetInventoryEntry[] = [];

	await scanAssetDirectory(rootPath, join(rootPath, 'assets'), assets);

	return assets.sort((left, right) => left.path.localeCompare(right.path));
}

export async function copyAssetToProject(
	rootPath: string,
	sourcePath: string
): Promise<NativeProjectAssetWriteResult> {
	const filename = basename(sourcePath);
	const targetPath = `assets/${filename}`;
	const destinationPath = join(rootPath, targetPath);

	await mkdirp(join(rootPath, 'assets'));
	await copy(sourcePath, destinationPath, {overwrite: true});
	await refreshProjectSessionBaseline(rootPath);

	return {
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

	await mkdirp(dirname(newAsset.absolutePath));
	await move(oldAsset.absolutePath, newAsset.absolutePath, {overwrite: true});
	await refreshProjectSessionBaseline(rootPath);

	return {
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

	await mkdirp(dirname(asset.absolutePath));
	await copy(sourcePath, asset.absolutePath, {overwrite: true});
	await refreshProjectSessionBaseline(rootPath);

	return {
		sourcePath: asset.absolutePath,
		targetPath: asset.projectPath
	};
}

export async function deleteProjectAsset(rootPath: string, path: string) {
	const asset = safeProjectAssetPath(rootPath, path);

	await remove(asset.absolutePath);
	await refreshProjectSessionBaseline(rootPath);
}

export async function projectSessionSnapshot(rootPath: string) {
	const session = ensureProjectSession(rootPath);

	if (!session.baseline) {
		session.baseline = await readProjectSessionSnapshot(rootPath);
	}

	return readProjectSessionSnapshot(rootPath, session.baseline);
}

export async function startProjectSession(
	rootPath: string,
	listener?: ProjectSessionListener
) {
	const session = ensureProjectSession(rootPath);

	if (listener) {
		session.listeners.add(listener);
	}

	if (!session.baseline) {
		session.baseline = await readProjectSessionSnapshot(rootPath);
	}

	if (!session.interval) {
		session.interval = setInterval(
			() => void pollProjectSession(session),
			projectSessionPollMs
		);
	}

	if (!session.watcher) {
		try {
			session.watcher = watch(
				rootPath,
				{recursive: true},
				() => scheduleProjectSessionPoll(session)
			);
		} catch {
			// Polling above remains active when recursive watching is unavailable.
		}
	}

	return session.pending ?? projectSessionSnapshot(rootPath);
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
