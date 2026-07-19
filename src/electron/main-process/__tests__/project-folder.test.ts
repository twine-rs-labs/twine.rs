import {dialog, shell} from 'electron';
import {createHash} from 'crypto';
import {FSWatcher, watch} from 'fs';
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
import extractZip from 'extract-zip';
import {fakeStory} from '../../../test-util';
import {
	chooseAssetFile,
	applyProjectAssetEffect,
	beginProjectFolderHydration,
	cleanupStaleProjectAssetEffects,
	copyProjectImportAssets,
	copyAssetToProject,
	createProjectFolder,
	deleteProjectAsset,
	deleteProjectFolder,
	discardProjectAssetEffect,
	discardProjectImport,
	finishProjectFolderHydration,
	hydrateProjectFolder,
	listProjectAssets,
	openProjectFolder,
	prepareProjectImport,
	projectSessionSnapshot,
	readProjectFolderHydrationChunk,
	renameProjectAsset,
	replaceProjectAsset,
	resolveProjectSessionConflicts,
	saveProjectFolder,
	startProjectSession,
	stopProjectSession
} from '../project-folder';
import {
	beginNativeProjectFolderHydration,
	diffNativeProjectFileManifest,
	findNativeTwineHtmlFiles,
	finishNativeProjectFolderHydration,
	forgetNativeProjectFolder,
	listNativeProjectAssets,
	listRememberedNativeProjectFolders,
	loadNativeProjectFolder,
	nativeProjectDiagnostic,
	nativeProjectFileManifest,
	prepareNativeHtmlImport,
	prepareNativeProjectImport,
	readNativeProjectFolderHydrationChunk,
	rememberNativeProjectFolder,
	saveNativeProjectFolder
} from '../native';

jest.mock('electron');
jest.mock('extract-zip', () => jest.fn());
jest.mock('fs', () => ({...jest.requireActual('fs'), watch: jest.fn()}));
jest.mock('fs-extra');
jest.mock('../native', () => ({
	beginNativeProjectFolderHydration: jest.fn(),
	diffNativeProjectFileManifest: jest.fn(),
	findNativeTwineHtmlFiles: jest.fn(),
	finishNativeProjectFolderHydration: jest.fn(),
	forgetNativeProjectFolder: jest.fn(),
	listNativeProjectAssets: jest.fn(),
	listRememberedNativeProjectFolders: jest.fn(),
	loadNativeProjectFolder: jest.fn(),
	nativeProjectDiagnostic: jest.fn(),
	nativeProjectFileManifest: jest.fn(),
	prepareNativeHtmlImport: jest.fn(),
	prepareNativeProjectImport: jest.fn(),
	readNativeProjectFolderHydrationChunk: jest.fn(),
	rememberNativeProjectFolder: jest.fn(),
	saveNativeProjectFolder: jest.fn()
}));
jest.mock('../story-directory', () => ({
	getStoryDirectoryPath: () => 'mock-story-library'
}));

describe('project-folder native bridge', () => {
	const mkdirpMock = mkdirp as jest.Mock;
	const mkdtempMock = mkdtemp as jest.Mock;
	const copyMock = copy as jest.Mock;
	const extractZipMock = extractZip as jest.Mock;
	const moveMock = move as jest.Mock;
	const readFileMock = readFile as jest.Mock;
	const readJsonMock = readJson as jest.Mock;
	const readdirMock = readdir as jest.Mock;
	const removeMock = remove as jest.Mock;
	const showOpenDialogMock = dialog.showOpenDialog as jest.Mock;
	const statMock = stat as jest.Mock;
	const watchMock = watch as jest.Mock;
	const writeFileMock = writeFile as jest.Mock;
	const diffNativeProjectFileManifestMock =
		diffNativeProjectFileManifest as jest.Mock;
	const beginNativeProjectFolderHydrationMock =
		beginNativeProjectFolderHydration as jest.Mock;
	const finishNativeProjectFolderHydrationMock =
		finishNativeProjectFolderHydration as jest.Mock;
	const findNativeTwineHtmlFilesMock = findNativeTwineHtmlFiles as jest.Mock;
	const forgetNativeProjectFolderMock = forgetNativeProjectFolder as jest.Mock;
	const listNativeProjectAssetsMock = listNativeProjectAssets as jest.Mock;
	const listRememberedNativeProjectFoldersMock =
		listRememberedNativeProjectFolders as jest.Mock;
	const loadNativeProjectFolderMock = loadNativeProjectFolder as jest.Mock;
	const nativeProjectDiagnosticMock = nativeProjectDiagnostic as jest.Mock;
	const nativeProjectFileManifestMock = nativeProjectFileManifest as jest.Mock;
	const prepareNativeHtmlImportMock = prepareNativeHtmlImport as jest.Mock;
	const prepareNativeProjectImportMock =
		prepareNativeProjectImport as jest.Mock;
	const readNativeProjectFolderHydrationChunkMock =
		readNativeProjectFolderHydrationChunk as jest.Mock;
	const rememberNativeProjectFolderMock =
		rememberNativeProjectFolder as jest.Mock;
	const saveNativeProjectFolderMock = saveNativeProjectFolder as jest.Mock;

	beforeEach(() => {
		jest.clearAllMocks();
		writeFileMock.mockResolvedValue(undefined);
		copyMock.mockResolvedValue(undefined);
		extractZipMock.mockResolvedValue(undefined);
		mkdtempMock.mockResolvedValue('/tmp/twine-import-abc');
		moveMock.mockResolvedValue(undefined);
		removeMock.mockResolvedValue(undefined);
		mkdirpMock.mockResolvedValue(undefined);
		readFileMock.mockResolvedValue('');
		readJsonMock.mockResolvedValue({});
		diffNativeProjectFileManifestMock.mockReturnValue(undefined);
		findNativeTwineHtmlFilesMock.mockReturnValue(undefined);
		forgetNativeProjectFolderMock.mockReturnValue(undefined);
		listNativeProjectAssetsMock.mockReturnValue(undefined);
		listRememberedNativeProjectFoldersMock.mockReturnValue([]);
		loadNativeProjectFolderMock.mockReturnValue(undefined);
		nativeProjectDiagnosticMock.mockReturnValue(
			'Native project backend was not built.'
		);
		nativeProjectFileManifestMock.mockReturnValue(undefined);
		prepareNativeHtmlImportMock.mockReturnValue(undefined);
		prepareNativeProjectImportMock.mockReturnValue(undefined);
		rememberNativeProjectFolderMock.mockReturnValue(undefined);
		saveNativeProjectFolderMock.mockReturnValue(undefined);
		readdirMock.mockRejectedValue(
			Object.assign(new Error('missing'), {code: 'ENOENT'})
		);
		statMock.mockImplementation(async path => ({
			isDirectory: () => String(path).endsWith('.twine.rs'),
			isFile: () => !String(path).endsWith('.twine.rs'),
			mtime: new Date('2026-06-21T16:00:00.000Z'),
			mtimeMs: 1,
			size: 0
		}));
		watchMock.mockImplementation(
			jest.requireActual<typeof import('fs')>('fs').watch
		);
	});

	afterEach(() => {
		stopProjectSession('/native/project.twine.rs');
		stopProjectSession('/native/moon-castle.twine.rs');
	});

	it('creates a native project folder with manifest, source files, and metadata', async () => {
		const story = {
			...fakeStory(1),
			id: 'story-id',
			name: 'Moon Castle'
		};

		const result = await createProjectFolder(story);

		expect(result.rootPath).toBe(
			'mock-story-library/Projects/moon-castle.twine.rs'
		);
		expect(mkdirpMock).toHaveBeenCalledWith(
			'mock-story-library/Projects/moon-castle.twine.rs/assets'
		);
		expect(writeFileMock).toHaveBeenCalledWith(
			'mock-story-library/Projects/moon-castle.twine.rs/twine.toml',
			expect.stringContaining('Native twine.rs desktop project folder'),
			'utf8'
		);
		const projectJsonTempPath = expect.stringMatching(
			/^mock-story-library\/Projects\/moon-castle\.twine\.rs\/\.twine\/project\.json\..+\.tmp$/
		);

		expect(writeFileMock).toHaveBeenCalledWith(
			projectJsonTempPath,
			expect.stringContaining('"schema":"twine.rs/renderer-project"'),
			'utf8'
		);
		expect(writeFileMock).toHaveBeenCalledWith(
			projectJsonTempPath,
			expect.stringContaining(`"id":"${story.id}"`),
			'utf8'
		);
		expect(moveMock).toHaveBeenCalledWith(
			projectJsonTempPath,
			'mock-story-library/Projects/moon-castle.twine.rs/.twine/project.json',
			{overwrite: true}
		);
		const manifest = String(
			writeFileMock.mock.calls.find(([path]) =>
				String(path).endsWith('/twine.toml')
			)?.[1]
		);

		expect(manifest).not.toContain('source_layout');
		expect(manifest).toMatch(
			/file = "passages\/moon-castle\/0001-[^"]+\.twee"/
		);
	});

	it('creates one complete Twee source with scripts and styles kept separate', async () => {
		const original = fakeStory(2);
		const story = {
			...original,
			id: 'story-id',
			name: 'Moon Castle',
			passages: original.passages.map((passage, index) => ({
				...passage,
				id: `passage-${index + 1}`,
				name: index === 0 ? 'Start' : 'Second',
				story: 'story-id',
				text: index === 0 ? 'first body' : 'second body'
			})),
			script: 'window.aggregateScript = true;',
			stylesheet: '.aggregate-style { color: red; }'
		};

		await createProjectFolder(story, undefined, 'single-twee');

		const aggregateWrite = writeFileMock.mock.calls.find(([path]) =>
			String(path).endsWith('/story.twee')
		);
		const aggregateSource = String(aggregateWrite?.[1]);
		const manifest = String(
			writeFileMock.mock.calls.find(([path]) =>
				String(path).endsWith('/twine.toml')
			)?.[1]
		);

		expect(aggregateWrite).toEqual([
			expect.stringMatching(
				/(?:^|\/)mock-story-library\/Projects\/moon-castle\.twine\.rs\/story\.twee$/
			),
			expect.any(String),
			'utf8'
		]);
		expect(aggregateSource).toContain(':: StoryTitle\nMoon Castle');
		expect(aggregateSource).toContain(':: StoryData');
		expect(aggregateSource).toContain(':: Start');
		expect(aggregateSource).toContain('first body');
		expect(aggregateSource).toContain(':: Second');
		expect(aggregateSource).toContain('second body');
		expect(aggregateSource).not.toContain(story.script);
		expect(aggregateSource).not.toContain(story.stylesheet);
		expect(writeFileMock).toHaveBeenCalledWith(
			'mock-story-library/Projects/moon-castle.twine.rs/scripts/moon-castle.js',
			story.script,
			'utf8'
		);
		expect(writeFileMock).toHaveBeenCalledWith(
			'mock-story-library/Projects/moon-castle.twine.rs/styles/moon-castle.css',
			story.stylesheet,
			'utf8'
		);
		expect(manifest).toContain('source_layout = "single-twee"');
		expect(manifest).toContain('source = "story.twee"');
		expect(manifest).not.toContain('file = ');
		expect(saveNativeProjectFolderMock).toHaveBeenCalledWith(
			'mock-story-library/Projects/moon-castle.twine.rs',
			story,
			'single-twee'
		);
	});

	it('matches Rust path slugs and four-digit passage numbering', async () => {
		const original = fakeStory(1);
		const story = {
			...original,
			id: 'Story.ID',
			name: 'Untitled',
			passages: [
				{
					...original.passages[0],
					name: 'A_B.C',
					story: 'Story.ID'
				}
			]
		};

		const result = await createProjectFolder(story);

		expect(result.rootPath).toBe(
			'mock-story-library/Projects/story-id.twine.rs'
		);
		expect(writeFileMock).toHaveBeenCalledWith(
			'mock-story-library/Projects/story-id.twine.rs/passages/story-id/0001-a-b-c.twee',
			story.passages[0].text,
			'utf8'
		);
		expect(writeFileMock).toHaveBeenCalledWith(
			'mock-story-library/Projects/story-id.twine.rs/scripts/story-id.js',
			story.script,
			'utf8'
		);
	});

	it('saves an existing native project folder in place', async () => {
		const story = {
			...fakeStory(1),
			id: 'story-id',
			name: 'Moon Castle'
		};

		const result = await saveProjectFolder(
			'/native/moon-castle.twine.rs',
			story
		);

		expect(result.rootPath).toBe('/native/moon-castle.twine.rs');
		const projectJsonTempPath = expect.stringMatching(
			/^\/native\/moon-castle\.twine\.rs\/\.twine\/project\.json\..+\.tmp$/
		);

		expect(writeFileMock).toHaveBeenCalledWith(
			projectJsonTempPath,
			expect.stringContaining('"schema":"twine.rs/renderer-project"'),
			'utf8'
		);
		expect(writeFileMock).toHaveBeenCalledWith(
			projectJsonTempPath,
			expect.stringContaining(`"id":"${story.id}"`),
			'utf8'
		);
		expect(moveMock).toHaveBeenCalledWith(
			projectJsonTempPath,
			'/native/moon-castle.twine.rs/.twine/project.json',
			{overwrite: true}
		);
		expect(writeFileMock).toHaveBeenCalledWith(
			'/native/moon-castle.twine.rs/twine.toml',
			expect.stringContaining('Moon Castle'),
			'utf8'
		);
	});

	it('reopens and retains a single-Twee layout on later full saves', async () => {
		const manifestSource = [
			'schema_version = 1',
			'name = "Moon Castle"',
			'[[stories]]',
			'id = "story-id"',
			'ifid = "STORY-ID"',
			'name = "Moon Castle"',
			'script = "scripts/moon-castle.js"',
			'source_layout = "single-twee"',
			'source = "story.twee"',
			'start_passage = "passage-1"',
			'stylesheet = "styles/moon-castle.css"',
			'[[stories.passages]]',
			'id = "passage-1"',
			'name = "Start"',
			'[[stories.passages]]',
			'id = "passage-2"',
			'name = "Second"',
			'tags = ["visited"]'
		].join('\n');
		const aggregateSource = [
			':: StoryTitle',
			'Moon Castle',
			'',
			':: StoryData',
			'{"ifid":"STORY-ID","format":"Chapbook","format-version":"2.1.0","start":"Start","zoom":1}',
			'',
			':: Start',
			'first body',
			'',
			':: Second [visited]',
			'second body'
		].join('\n');

		readFileMock.mockImplementation(async path => {
			const normalized = String(path);

			if (normalized.endsWith('twine.toml')) {
				return manifestSource;
			}
			if (normalized.endsWith('story.twee')) {
				return aggregateSource;
			}
			if (normalized.endsWith('moon-castle.js')) {
				return 'window.script = true;';
			}
			if (normalized.endsWith('moon-castle.css')) {
				return '.story { color: red; }';
			}
			return '';
		});

		const opened = await openProjectFolder('/native/moon-castle.twine.rs');

		expect(opened?.stories[0].passages).toEqual([
			expect.objectContaining({
				id: 'passage-1',
				name: 'Start',
				text: 'first body'
			}),
			expect.objectContaining({
				id: 'passage-2',
				name: 'Second',
				tags: ['visited'],
				text: 'second body'
			})
		]);
		await saveProjectFolder('/native/moon-castle.twine.rs', opened!.stories[0]);

		expect(saveNativeProjectFolderMock).toHaveBeenLastCalledWith(
			'/native/moon-castle.twine.rs',
			opened!.stories[0],
			'single-twee'
		);
		expect(writeFileMock).toHaveBeenCalledWith(
			'/native/moon-castle.twine.rs/story.twee',
			expect.stringContaining(':: StoryData'),
			'utf8'
		);
		const savedManifest = String(
			writeFileMock.mock.calls.find(
				([path]) => String(path) === '/native/moon-castle.twine.rs/twine.toml'
			)?.[1]
		);

		expect(savedManifest).toContain('source_layout = "single-twee"');
		expect(savedManifest).toContain('source = "story.twee"');
		expect(savedManifest).not.toContain('file = ');
	});

	it('uses the native project saver when it is available', async () => {
		const story = {
			...fakeStory(1),
			id: 'story-id',
			name: 'Moon Castle'
		};

		saveNativeProjectFolderMock.mockReturnValue({
			passageTextLoaded: true,
			rootPath: '/native/moon-castle.twine.rs',
			stories: [story],
			storyIds: [story.id]
		});

		await expect(
			saveProjectFolder('/native/moon-castle.twine.rs', story)
		).resolves.toEqual({
			passageTextLoaded: true,
			rootPath: '/native/moon-castle.twine.rs',
			stories: [story],
			storyIds: [story.id]
		});
		expect(saveNativeProjectFolderMock).toHaveBeenCalledWith(
			'/native/moon-castle.twine.rs',
			story,
			'passage-files'
		);
		expect(writeFileMock).not.toHaveBeenCalled();
		expect(moveMock).not.toHaveBeenCalled();
	});

	it('incrementally saves a passage text edit through the active project session', async () => {
		const story = {
			...fakeStory(1),
			id: 'story-id',
			name: 'Story',
			passages: [
				{
					...fakeStory(1).passages[0],
					id: 'passage-id',
					name: 'Start',
					text: 'from disk'
				}
			]
		};
		const manifestSource = [
			'schema_version = 1',
			'name = "Project"',
			'[[stories]]',
			'id = "story-id"',
			'ifid = "STORY-ID"',
			'name = "Story"',
			'start_passage = "passage-id"',
			'[[stories.passages]]',
			'id = "passage-id"',
			'name = "Start"',
			'file = "passages/story/001-start.twee"'
		].join('\n');
		const manifestFile = {
			fingerprint: '1:0',
			kind: 'manifest' as const,
			modifiedAt: '2026-06-21T16:00:00.000Z',
			mtimeMs: 1,
			path: 'twine.toml',
			sizeBytes: 0
		};
		const passageFile = {
			fingerprint: '1:0',
			kind: 'passage' as const,
			modifiedAt: '2026-06-21T16:00:00.000Z',
			mtimeMs: 1,
			path: 'passages/story/001-start.twee',
			sizeBytes: 0
		};

		readFileMock.mockImplementation(async path =>
			String(path).endsWith('twine.toml') ? manifestSource : 'from disk'
		);
		listNativeProjectAssetsMock.mockReturnValue([]);
		nativeProjectFileManifestMock.mockReturnValue([manifestFile, passageFile]);

		await startProjectSession('/native/project.twine.rs', undefined, [
			'story-id'
		]);
		const manifestReadsBeforeSave = readFileMock.mock.calls.filter(call =>
			String(call[0]).endsWith('twine.toml')
		).length;
		const result = await saveProjectFolder('/native/project.twine.rs', story, {
			documentUpdates: [
				{
					passageId: 'passage-id',
					storyId: 'story-id',
					text: 'updated text',
					type: 'passageText'
				}
			],
			hints: [
				{passageId: 'passage-id', storyId: 'story-id', type: 'passageText'}
			]
		});

		expect(result.performanceTimings?.mode).toBeUndefined();
		expect(saveNativeProjectFolderMock).not.toHaveBeenCalled();
		expect(writeFileMock).toHaveBeenCalledWith(
			expect.stringMatching(
				/^\/native\/project\.twine\.rs\/passages\/story\/001-start\.twee\..+\.tmp$/
			),
			'updated text',
			'utf8'
		);
		expect(moveMock).toHaveBeenCalledWith(
			expect.stringMatching(
				/^\/native\/project\.twine\.rs\/passages\/story\/001-start\.twee\..+\.tmp$/
			),
			'/native/project.twine.rs/passages/story/001-start.twee',
			{overwrite: true}
		);
		expect(writeFileMock).not.toHaveBeenCalledWith(
			'/native/project.twine.rs/twine.toml',
			expect.anything(),
			'utf8'
		);
		expect(
			writeFileMock.mock.calls.some(call =>
				String(call[0]).includes('/.twine/project.json.')
			)
		).toBe(false);
		expect(
			readFileMock.mock.calls.filter(call =>
				String(call[0]).endsWith('twine.toml')
			).length
		).toBe(manifestReadsBeforeSave);
	});

	it('incrementally rewrites one aggregate source while preserving other passages', async () => {
		const original = fakeStory(2);
		const compactStory = {
			...original,
			id: 'story-id',
			name: 'Story',
			passages: [
				{
					...original.passages[0],
					id: 'passage-1',
					name: 'Start',
					story: 'story-id',
					text: 'updated first'
				}
			],
			script: 'window.separate = true;',
			startPassage: 'passage-1',
			stylesheet: '.separate { color: blue; }'
		};
		const manifestSource = [
			'schema_version = 1',
			'name = "Project"',
			'[[stories]]',
			'id = "story-id"',
			'ifid = "STORY-ID"',
			'name = "Story"',
			'script = "scripts/story.js"',
			'source_layout = "single-twee"',
			'source = "story.twee"',
			'start_passage = "passage-1"',
			'stylesheet = "styles/story.css"',
			'[[stories.passages]]',
			'id = "passage-1"',
			'name = "Start"',
			'[[stories.passages]]',
			'id = "passage-2"',
			'name = "Second"'
		].join('\n');
		const aggregateSource = [
			'This preamble belongs to another tool.',
			'',
			':: StoryTitle',
			'Story',
			'',
			':: StoryData',
			'{"ifid":"STORY-ID","format":"Chapbook","format-version":"2.1.0","start":"Start","zoom":1,"tool":{"keep":true}}',
			'',
			':: Start {"position":"0,0","size":"100,100","source-pid":"original","tool":"keep"}',
			'old first',
			'',
			':: Second',
			'preserved second',
			'',
			':: Tool Notes [tool] {"tool":"keep"}',
			'custom section',
			'',
			':: Legacy Script [script]',
			'window.legacy = true;'
		].join('\n');
		const files = [
			{
				fingerprint: '1:0',
				kind: 'manifest' as const,
				modifiedAt: '2026-06-21T16:00:00.000Z',
				mtimeMs: 1,
				path: 'twine.toml',
				sizeBytes: 0
			},
			{
				fingerprint: '1:0',
				kind: 'passage' as const,
				modifiedAt: '2026-06-21T16:00:00.000Z',
				mtimeMs: 1,
				path: 'story.twee',
				sizeBytes: 0
			}
		];

		readFileMock.mockImplementation(async path =>
			String(path).endsWith('twine.toml')
				? manifestSource
				: String(path).endsWith('story.twee')
					? aggregateSource
					: ''
		);
		listNativeProjectAssetsMock.mockReturnValue([]);
		nativeProjectFileManifestMock.mockReturnValue(files);

		await startProjectSession('/native/project.twine.rs', undefined, [
			'story-id'
		]);
		await saveProjectFolder('/native/project.twine.rs', compactStory, {
			documentUpdates: [
				{
					passageId: 'passage-1',
					storyId: 'story-id',
					text: 'updated first',
					type: 'passageText'
				}
			],
			hints: [
				{passageId: 'passage-1', storyId: 'story-id', type: 'passageText'}
			],
			incrementalOnly: true
		});

		const aggregateWrite = writeFileMock.mock.calls.find(([path]) =>
			/^\/native\/project\.twine\.rs\/story\.twee\..+\.tmp$/.test(String(path))
		);
		const aggregateSave = String(aggregateWrite?.[1]);

		expect(aggregateSave).toContain(':: StoryTitle\nStory');
		expect(aggregateSave).toContain(':: StoryData');
		expect(aggregateSave).toContain('updated first');
		expect(aggregateSave).toContain('preserved second');
		expect(aggregateSave).toContain('This preamble belongs to another tool.');
		expect(aggregateSave).toContain('"tool": {');
		expect(aggregateSave).toContain('"keep": true');
		expect(aggregateSave).toContain('"source-pid":"original"');
		expect(aggregateSave).toContain(':: Tool Notes [tool] {"tool":"keep"}');
		expect(aggregateSave).toContain('custom section');
		expect(aggregateSave).toContain(':: Legacy Script [script]');
		expect(aggregateSave).toContain('window.legacy = true;');
		expect(aggregateSave).not.toContain(compactStory.script);
		expect(aggregateSave).not.toContain(compactStory.stylesheet);
		expect(moveMock).toHaveBeenCalledWith(
			expect.stringMatching(
				/^\/native\/project\.twine\.rs\/story\.twee\..+\.tmp$/
			),
			'/native/project.twine.rs/story.twee',
			{overwrite: true}
		);
		expect(saveNativeProjectFolderMock).not.toHaveBeenCalled();

		statMock.mockResolvedValue({
			isDirectory: () => false,
			isFile: () => true,
			mtime: new Date('2026-06-21T16:00:01.000Z'),
			mtimeMs: 2,
			size: 0
		});
		await expect(
			saveProjectFolder('/native/project.twine.rs', compactStory, {
				documentUpdates: [
					{
						passageId: 'passage-1',
						storyId: 'story-id',
						text: 'updated again',
						type: 'passageText'
					}
				],
				hints: [
					{
						passageId: 'passage-1',
						storyId: 'story-id',
						type: 'passageText'
					}
				],
				incrementalOnly: true
			})
		).rejects.toThrow(
			'story.twee changed outside twine.rs; refusing to overwrite it.'
		);
	});

	it('keeps a custom aggregate source path when incrementally saving metadata', async () => {
		const original = fakeStory(1);
		const story = {
			...original,
			id: 'story-id',
			name: 'Story',
			passages: [
				{
					...original.passages[0],
					id: 'passage-1',
					name: 'Renamed Start',
					story: 'story-id',
					tags: ['new-tag'],
					text: 'body'
				}
			],
			startPassage: 'passage-1'
		};
		const manifestSource = [
			'schema_version = 1',
			'name = "Project"',
			'tool_mode = "preserve-me"',
			'[tooling]',
			'owner = "external"',
			'[[stories]]',
			'id = "story-id"',
			'ifid = "STORY-ID"',
			'name = "Story"',
			'script = "custom/scripts/main.js"',
			'source_layout = "single-twee"',
			'source = "sources/main.twee"',
			'start_passage = "passage-1"',
			'stylesheet = "custom/styles/main.css"',
			'tool_story_key = "preserve-me"',
			'[[stories.passages]]',
			'id = "passage-1"',
			'name = "Start" # passage label',
			'tags = [',
			'  "old-tag",',
			'] # managed tags',
			'tool_passage_key = "preserve-me"',
			'notes = """',
			'[stories.not-a-real-table]',
			'"""',
			'[stories.tooling]',
			'enabled = true'
		].join('\n');
		const aggregateSource = [
			':: StoryTitle',
			'Story',
			'',
			':: StoryData',
			'{"ifid":"STORY-ID","start":"Start"}',
			'',
			':: Start',
			'body'
		].join('\n');
		const files = [
			{
				fingerprint: '1:0',
				kind: 'manifest' as const,
				modifiedAt: '2026-06-21T16:00:00.000Z',
				mtimeMs: 1,
				path: 'twine.toml',
				sizeBytes: 0
			},
			{
				fingerprint: '1:0',
				kind: 'passage' as const,
				modifiedAt: '2026-06-21T16:00:00.000Z',
				mtimeMs: 1,
				path: 'sources/main.twee',
				sizeBytes: 0
			}
		];

		readFileMock.mockImplementation(async path =>
			String(path).endsWith('twine.toml')
				? manifestSource
				: String(path).endsWith('sources/main.twee')
					? aggregateSource
					: ''
		);
		listNativeProjectAssetsMock.mockReturnValue([]);
		nativeProjectFileManifestMock.mockReturnValue(files);

		await startProjectSession('/native/project.twine.rs', undefined, [
			'story-id'
		]);
		await saveProjectFolder('/native/project.twine.rs', story, {
			hints: [
				{
					passageId: 'passage-1',
					storyId: 'story-id',
					type: 'passageMetadata'
				}
			],
			incrementalOnly: true
		});

		const manifestWrite = writeFileMock.mock.calls.find(([path]) =>
			/^\/native\/project\.twine\.rs\/twine\.toml\..+\.tmp$/.test(String(path))
		);

		expect(String(manifestWrite?.[1])).toContain(
			'source = "sources/main.twee"'
		);
		expect(String(manifestWrite?.[1])).toContain(
			'script = "custom/scripts/main.js"'
		);
		expect(String(manifestWrite?.[1])).toContain(
			'stylesheet = "custom/styles/main.css"'
		);
		expect(String(manifestWrite?.[1])).toContain(
			'name = "Renamed Start" # passage label'
		);
		expect(String(manifestWrite?.[1])).toContain(
			'tags = ["new-tag"] # managed tags'
		);
		expect(String(manifestWrite?.[1])).not.toContain('"old-tag"');
		expect(String(manifestWrite?.[1])).toContain(
			'notes = """\n[stories.not-a-real-table]\n"""'
		);
		expect(String(manifestWrite?.[1])).toContain(
			'tool_passage_key = "preserve-me"'
		);
		expect(String(manifestWrite?.[1])).toContain('[stories.tooling]');
		expect(String(manifestWrite?.[1])).toContain('tool_mode = "preserve-me"');
		expect(
			writeFileMock.mock.calls.some(([path]) =>
				/^\/native\/project\.twine\.rs\/sources\/main\.twee\..+\.tmp$/.test(
					String(path)
				)
			)
		).toBe(true);
		expect(
			writeFileMock.mock.calls.some(([path]) =>
				String(path).includes('/story.twee.')
			)
		).toBe(false);
	});

	it('incrementally saves passage names without reallocating source paths', async () => {
		const story = {
			...fakeStory(1),
			id: 'story-id',
			name: 'Story',
			passages: [
				{
					...fakeStory(1).passages[0],
					id: 'passage-id',
					name: 'Renamed',
					text: ''
				}
			]
		};
		let manifestSource = [
			'schema_version = 1',
			'name = "Project"',
			'[[stories]]',
			'id = "story-id"',
			'ifid = "STORY-ID"',
			'name = "Story"',
			'start_passage = "passage-id"',
			'[[stories.passages]]',
			'id = "passage-id"',
			'name = "Start"',
			'file = "passages/story/001-start.twee"'
		].join('\n');
		const files = [
			{
				fingerprint: '1:0',
				kind: 'manifest' as const,
				modifiedAt: '2026-06-21T16:00:00.000Z',
				mtimeMs: 1,
				path: 'twine.toml',
				sizeBytes: 0
			},
			{
				fingerprint: '1:0',
				kind: 'passage' as const,
				modifiedAt: '2026-06-21T16:00:00.000Z',
				mtimeMs: 1,
				path: 'passages/story/001-start.twee',
				sizeBytes: 0
			}
		];

		readFileMock.mockImplementation(async path =>
			String(path).endsWith('twine.toml') ? manifestSource : ''
		);
		writeFileMock.mockImplementation(async (path, source) => {
			if (String(path).includes('/twine.toml.')) {
				manifestSource = String(source);
			}
		});
		listNativeProjectAssetsMock.mockReturnValue([]);
		nativeProjectFileManifestMock.mockReturnValue(files);

		await startProjectSession('/native/project.twine.rs', undefined, [
			'story-id'
		]);
		await saveProjectFolder('/native/project.twine.rs', story, {
			hints: [
				{
					passageId: 'passage-id',
					storyId: 'story-id',
					type: 'passageMetadata'
				}
			]
		});

		expect(manifestSource).toContain('name = "Renamed"');
		expect(manifestSource).toContain('file = "passages/story/001-start.twee"');
		expect(saveNativeProjectFolderMock).not.toHaveBeenCalled();
	});

	it('incrementally saves moved passage layout and patches the session baseline', async () => {
		const original = fakeStory(2);
		const story = {
			...original,
			id: 'story-id',
			name: 'Story',
			passages: original.passages.map((passage, index) => ({
				...passage,
				id: `passage-${index + 1}`,
				left: index === 0 ? 420 : passage.left,
				story: 'story-id',
				top: index === 0 ? 240 : passage.top
			}))
		};
		const manifestSource = [
			'schema_version = 1',
			'name = "Project"',
			'[[stories]]',
			'id = "story-id"',
			'ifid = "STORY-ID"',
			'name = "Story"',
			'start_passage = "passage-1"',
			'[[stories.passages]]',
			'id = "passage-1"',
			'name = "First"',
			'file = "passages/story/001-first.twee"',
			'[[stories.passages]]',
			'id = "passage-2"',
			'name = "Second"',
			'file = "passages/story/002-second.twee"'
		].join('\n');
		const initialGraph = {
			passages: {
				'passage-1': {height: 100, left: 10, top: 20, width: 100},
				'passage-2': {height: 110, left: 30, top: 40, width: 120}
			},
			viewport: {scale: 0.75}
		};
		let graphWritten = false;
		const manifestFile = {
			fingerprint: '1:0',
			kind: 'manifest' as const,
			modifiedAt: '2026-06-21T16:00:00.000Z',
			mtimeMs: 1,
			path: 'twine.toml',
			sizeBytes: 0
		};
		const graphFile = () => ({
			fingerprint: graphWritten ? '2:0' : '1:0',
			kind: 'graph' as const,
			modifiedAt: '2026-06-21T16:00:00.000Z',
			mtimeMs: graphWritten ? 2 : 1,
			path: '.twine/graph.json',
			sizeBytes: 0
		});

		readFileMock.mockImplementation(async path =>
			String(path).endsWith('twine.toml') ? manifestSource : ''
		);
		readJsonMock.mockImplementation(async path =>
			String(path).endsWith('.twine/graph.json') ? initialGraph : {}
		);
		listNativeProjectAssetsMock.mockReturnValue([]);
		nativeProjectFileManifestMock.mockImplementation(() => [
			manifestFile,
			graphFile()
		]);
		statMock.mockImplementation(async path => {
			const graph = String(path).endsWith('.twine/graph.json');
			const mtimeMs = graph && graphWritten ? 2 : 1;

			return {
				isDirectory: () => false,
				isFile: () => true,
				mtime: new Date('2026-06-21T16:00:00.000Z'),
				mtimeMs,
				size: 0
			};
		});
		moveMock.mockImplementation(async (_source, target) => {
			if (String(target).endsWith('.twine/graph.json')) {
				graphWritten = true;
			}
		});

		await startProjectSession('/native/project.twine.rs', undefined, [
			'story-id'
		]);
		await saveProjectFolder('/native/project.twine.rs', story, {
			hints: [
				{passageId: 'passage-1', storyId: 'story-id', type: 'passageLayout'}
			],
			incrementalOnly: true,
			revision: 7,
			sessionId: 'project:/native/project.twine.rs'
		});

		const graphWrite = writeFileMock.mock.calls.find(call =>
			/^\/native\/project\.twine\.rs\/\.twine\/graph\.json\..+\.tmp$/.test(
				String(call[0])
			)
		);
		expect(graphWrite).toBeDefined();
		const savedGraph = JSON.parse(String(graphWrite?.[1]));

		expect(savedGraph).toEqual({
			passages: {
				'passage-1': expect.objectContaining({left: 420, top: 240}),
				'passage-2': initialGraph.passages['passage-2']
			},
			viewport: {scale: 0.75}
		});
		expect(saveNativeProjectFolderMock).not.toHaveBeenCalled();
		expect(
			writeFileMock.mock.calls.some(call =>
				String(call[0]).includes('/.twine/project.json.')
			)
		).toBe(false);
		expect(
			writeFileMock.mock.calls.some(call =>
				String(call[0]).endsWith('/twine.toml')
			)
		).toBe(false);
		await expect(
			projectSessionSnapshot('/native/project.twine.rs', ['story-id'])
		).resolves.toEqual(
			expect.objectContaining({changedPaths: [], conflicts: []})
		);
	});

	it('refuses an incremental layout save when graph.json changed externally', async () => {
		const story = {
			...fakeStory(1),
			id: 'story-id',
			passages: [
				{
					...fakeStory(1).passages[0],
					id: 'passage-id',
					left: 420,
					story: 'story-id'
				}
			]
		};
		const manifestSource = [
			'schema_version = 1',
			'name = "Project"',
			'[[stories]]',
			'id = "story-id"',
			'ifid = "STORY-ID"',
			'name = "Story"',
			'[[stories.passages]]',
			'id = "passage-id"',
			'name = "Start"',
			'file = "passages/story/001-start.twee"'
		].join('\n');

		readFileMock.mockImplementation(async path =>
			String(path).endsWith('twine.toml') ? manifestSource : ''
		);
		readJsonMock.mockResolvedValue({
			passages: {
				'passage-id': {height: 100, left: 10, top: 20, width: 100}
			}
		});
		listNativeProjectAssetsMock.mockReturnValue([]);
		nativeProjectFileManifestMock.mockReturnValue([
			{
				fingerprint: '1:0',
				kind: 'manifest',
				modifiedAt: '2026-06-21T16:00:00.000Z',
				mtimeMs: 1,
				path: 'twine.toml',
				sizeBytes: 0
			},
			{
				fingerprint: '1:0',
				kind: 'graph',
				modifiedAt: '2026-06-21T16:00:00.000Z',
				mtimeMs: 1,
				path: '.twine/graph.json',
				sizeBytes: 0
			}
		]);
		statMock.mockResolvedValue({
			isDirectory: () => false,
			isFile: () => true,
			mtime: new Date('2026-06-21T16:00:00.000Z'),
			mtimeMs: 2,
			size: 0
		});

		await startProjectSession('/native/project.twine.rs', undefined, [
			'story-id'
		]);
		await expect(
			saveProjectFolder('/native/project.twine.rs', story, {
				hints: [
					{
						passageId: 'passage-id',
						storyId: 'story-id',
						type: 'passageLayout'
					}
				],
				incrementalOnly: true
			})
		).rejects.toThrow(
			'.twine/graph.json changed outside twine.rs; refusing to overwrite it.'
		);
		expect(moveMock).not.toHaveBeenCalled();
	});

	it('opens a native project folder from renderer metadata', async () => {
		const story = fakeStory(1);

		showOpenDialogMock.mockResolvedValue({
			canceled: false,
			filePaths: ['/native/moon-castle.twine.rs']
		});
		readJsonMock.mockResolvedValue({
			stories: [{...story, lastUpdate: story.lastUpdate.toISOString()}]
		});

		const result = await openProjectFolder();

		expect(result).toEqual(
			expect.objectContaining({
				rootPath: '/native/moon-castle.twine.rs',
				storyIds: [story.id]
			})
		);
		expect(result?.stories[0].lastUpdate).toBeInstanceOf(Date);
	});

	it('opens a native project folder without writing project files', async () => {
		const story = fakeStory(1);

		readJsonMock.mockResolvedValue({
			stories: [{...story, lastUpdate: story.lastUpdate.toISOString()}]
		});

		await openProjectFolder('/native/moon-castle.twine.rs');

		expect(writeFileMock).not.toHaveBeenCalled();
		expect(moveMock).not.toHaveBeenCalled();
	});

	it('uses the native project loader when it is available', async () => {
		const story = fakeStory(1);

		loadNativeProjectFolderMock.mockReturnValue({
			passageTextLoaded: false,
			rootPath: '/native/moon-castle.twine.rs',
			stories: [story],
			storyIds: [story.id]
		});

		const result = await openProjectFolder('/native/moon-castle.twine.rs', {
			loadPassageText: false
		});

		expect(loadNativeProjectFolderMock).toHaveBeenCalledWith(
			'/native/moon-castle.twine.rs',
			{loadPassageText: false}
		);
		expect(result).toEqual(
			expect.objectContaining({
				passageTextLoaded: false,
				stories: [story],
				storyIds: [story.id]
			})
		);
		expect(readFileMock).not.toHaveBeenCalledWith(
			'/native/moon-castle.twine.rs/twine.toml',
			'utf8'
		);
		expect(rememberNativeProjectFolderMock).toHaveBeenCalledWith(
			'mock-story-library/.twine/native-projects.json',
			expect.objectContaining({
				rootPath: '/native/moon-castle.twine.rs',
				storyIds: [story.id]
			})
		);
	});

	it('adopts the full native load receipt without rescanning project files', async () => {
		const story = fakeStory(1);
		const realFs = jest.requireActual<typeof import('fs')>('fs');
		const rootPath = `/tmp/twine-receipt-${Date.now()}.twine.rs`;
		realFs.mkdirSync(rootPath, {recursive: true});
		const manifestFile = {
			fingerprint: '1:42',
			kind: 'manifest' as const,
			modifiedAt: '2026-06-21T16:00:00.000Z',
			mtimeMs: 1,
			path: 'twine.toml',
			sizeBytes: 42
		};

		loadNativeProjectFolderMock
			.mockReturnValueOnce({
				passageTextLoaded: false,
				rootPath,
				stories: [story],
				storyIds: [story.id]
			})
			.mockReturnValueOnce({
				baselineReceipt: {
					assets: [],
					completedAt: '2026-06-21T16:00:01.000Z',
					files: [manifestFile],
					id: 'load-1',
					layoutDataJson: '{}',
					rootPath,
					schemaVersion: 1,
					startedAt: '2026-06-21T16:00:00.000Z',
					storyIds: [story.id]
				},
				passageTextLoaded: true,
				rootPath,
				stories: [story],
				storyIds: [story.id]
			});

		try {
			await openProjectFolder(rootPath, {loadPassageText: false});
			await hydrateProjectFolder(rootPath, [story.id]);
			const start = await startProjectSession(rootPath, undefined, [story.id]);

			expect(start).toEqual(
				expect.objectContaining({generation: 1, storyIds: [story.id]})
			);
			expect(nativeProjectFileManifestMock).not.toHaveBeenCalled();
		} finally {
			stopProjectSession(rootPath);
			realFs.rmSync(rootPath, {force: true, recursive: true});
		}
	});

	it('reconstructs a one-passage custom aggregate source from a native receipt', async () => {
		const original = fakeStory(1);
		const story = {
			...original,
			id: 'story-id',
			name: 'Story',
			passages: [
				{
					...original.passages[0],
					id: 'passage-1',
					name: 'Start',
					story: 'story-id',
					text: 'updated'
				}
			],
			startPassage: 'passage-1'
		};
		const rootPath = '/native/custom-source.twine.rs';
		const aggregateSource = [
			':: StoryTitle',
			'Story',
			'',
			':: StoryData',
			`{"ifid":"${story.ifid}","start":"Start"}`,
			'',
			':: Start',
			'old'
		].join('\n');
		const baselineReceipt = {
			assets: [],
			completedAt: '2026-06-21T16:00:01.000Z',
			files: [
				{
					fingerprint: '1:0',
					kind: 'manifest' as const,
					modifiedAt: '2026-06-21T16:00:00.000Z',
					mtimeMs: 1,
					path: 'twine.toml',
					sizeBytes: 0
				},
				{
					fingerprint: '1:0',
					kind: 'passage' as const,
					modifiedAt: '2026-06-21T16:00:00.000Z',
					mtimeMs: 1,
					path: 'sources/only.twee',
					sizeBytes: 0,
					storyId: 'story-id'
				}
			],
			id: 'load-custom',
			layoutDataJson: '{}',
			rootPath,
			schemaVersion: 1,
			startedAt: '2026-06-21T16:00:00.000Z',
			storyIds: ['story-id']
		};

		loadNativeProjectFolderMock.mockReturnValue({
			baselineReceipt,
			passageTextLoaded: true,
			rootPath,
			stories: [story],
			storyIds: ['story-id']
		});
		readFileMock.mockImplementation(async path =>
			String(path).endsWith('sources/only.twee') ? aggregateSource : ''
		);

		try {
			await openProjectFolder(rootPath);
			await saveProjectFolder(rootPath, story, {
				documentUpdates: [
					{
						passageId: 'passage-1',
						storyId: 'story-id',
						text: 'updated',
						type: 'passageText'
					}
				],
				hints: [
					{
						passageId: 'passage-1',
						storyId: 'story-id',
						type: 'passageText'
					}
				],
				incrementalOnly: true
			});

			expect(
				writeFileMock.mock.calls.some(([path]) =>
					/^\/native\/custom-source\.twine\.rs\/sources\/only\.twee\..+\.tmp$/.test(
						String(path)
					)
				)
			).toBe(true);
			expect(
				writeFileMock.mock.calls.some(([path]) =>
					String(path).includes('/passages/')
				)
			).toBe(false);
		} finally {
			stopProjectSession(rootPath);
		}
	});

	it('keeps project loading native-only when legacy fallback is disabled', async () => {
		const previousFallback = process.env.TWINE_LEGACY_PROJECT_FALLBACK;

		process.env.TWINE_LEGACY_PROJECT_FALLBACK = '0';

		try {
			await expect(
				openProjectFolder('/native/moon-castle.twine.rs')
			).rejects.toThrow('native Rust project backend');

			expect(readFileMock).not.toHaveBeenCalled();
			expect(readJsonMock).not.toHaveBeenCalled();
			expect(readdirMock).not.toHaveBeenCalled();
			expect(extractZipMock).not.toHaveBeenCalled();
		} finally {
			if (previousFallback === undefined) {
				delete process.env.TWINE_LEGACY_PROJECT_FALLBACK;
			} else {
				process.env.TWINE_LEGACY_PROJECT_FALLBACK = previousFallback;
			}
		}
	});

	it('allows import preparation and asset scans to use compatibility fallback', async () => {
		const previousFallback = process.env.TWINE_LEGACY_PROJECT_FALLBACK;

		process.env.TWINE_LEGACY_PROJECT_FALLBACK = '0';
		readFileMock.mockResolvedValue('<tw-storydata></tw-storydata>');
		readdirMock.mockRejectedValue(
			Object.assign(new Error('missing'), {code: 'ENOENT'})
		);

		try {
			await expect(
				listProjectAssets('/native/moon-castle.twine.rs')
			).resolves.toEqual([]);
			await expect(
				prepareProjectImport('/imports/Transylvania.html')
			).resolves.toEqual(
				expect.objectContaining({
					assets: [],
					htmlFilePath: '/imports/Transylvania.html',
					htmlSource: '<tw-storydata></tw-storydata>',
					sourceKind: 'html',
					sourcePath: '/imports/Transylvania.html'
				})
			);
		} finally {
			if (previousFallback === undefined) {
				delete process.env.TWINE_LEGACY_PROJECT_FALLBACK;
			} else {
				process.env.TWINE_LEGACY_PROJECT_FALLBACK = previousFallback;
			}
		}
	});

	it('repairs native SugarCube project shells mislabeled as Harlowe', async () => {
		const story = {
			...fakeStory(1),
			name: 'Trigaea',
			passages: [
				{
					...fakeStory(1).passages[0],
					tags: ['widget'],
					text: ''
				}
			],
			storyFormat: 'Harlowe',
			storyFormatVersion: '3.3.9'
		};

		loadNativeProjectFolderMock.mockReturnValue({
			passageTextLoaded: false,
			rootPath: '/native/trigaea.twine.rs',
			stories: [story],
			storyIds: [story.id]
		});

		const result = await openProjectFolder('/native/trigaea.twine.rs', {
			loadPassageText: false
		});

		expect(result?.stories[0]).toEqual(
			expect.objectContaining({
				storyFormat: 'SugarCube',
				storyFormatVersion: ''
			})
		);
	});

	it('merges renderer sidecar metadata into native project loads', async () => {
		const story = {
			...fakeStory(1),
			selected: false,
			tagColors: {},
			passages: [
				{
					...fakeStory(1).passages[0],
					height: 100,
					highlighted: false,
					left: 0,
					selected: false,
					top: 0,
					width: 100
				}
			]
		};

		loadNativeProjectFolderMock.mockReturnValue({
			passageTextLoaded: true,
			rootPath: '/native/moon-castle.twine.rs',
			stories: [story],
			storyIds: [story.id]
		});
		readJsonMock.mockResolvedValue({
			stories: [
				{
					id: story.id,
					passages: [
						{
							height: 130,
							highlighted: true,
							id: story.passages[0].id,
							left: 200,
							selected: true,
							top: 300,
							width: 120
						}
					],
					selected: true,
					tagColors: {urgent: '#f00'}
				}
			]
		});

		const result = await openProjectFolder('/native/moon-castle.twine.rs');

		expect(result?.stories[0]).toEqual(
			expect.objectContaining({
				selected: true,
				tagColors: {urgent: '#f00'}
			})
		);
		expect(result?.stories[0].passages[0]).toEqual(
			expect.objectContaining({
				height: 130,
				highlighted: true,
				left: 200,
				selected: true,
				top: 300,
				width: 120
			})
		);
	});

	it('rescans assets only for an explicit session snapshot', async () => {
		readFileMock.mockImplementation(async path => {
			if (path.endsWith('twine.toml')) {
				return [
					'[[stories]]',
					'id = "story-id"',
					'ifid = "ifid-1"',
					'name = "Moon Castle"',
					'start_passage = "start"',
					'[[stories.passages]]',
					'id = "start"',
					'name = "Start"'
				].join('\n');
			}

			return '';
		});
		readJsonMock.mockRejectedValue(
			Object.assign(new Error('missing'), {code: 'ENOENT'})
		);
		readdirMock.mockImplementation(async path => {
			if (String(path).endsWith('/assets')) {
				return ['cover.png'];
			}

			throw Object.assign(new Error('missing'), {code: 'ENOENT'});
		});
		statMock.mockImplementation(async path => {
			const normalized = String(path);

			if (
				normalized === '/native/moon-castle.twine.rs' ||
				normalized.endsWith('/assets')
			) {
				return {
					isDirectory: () => true,
					isFile: () => false,
					mtime: new Date('2026-06-21T16:00:00.000Z'),
					mtimeMs: 1,
					size: 0
				};
			}

			if (
				normalized.endsWith('twine.toml') ||
				normalized.endsWith('/assets/cover.png')
			) {
				return {
					isDirectory: () => false,
					isFile: () => true,
					mtime: new Date('2026-06-21T16:00:00.000Z'),
					mtimeMs: 1,
					size: 42
				};
			}

			throw Object.assign(new Error('missing'), {code: 'ENOENT'});
		});

		await openProjectFolder('/native/moon-castle.twine.rs', {
			loadPassageText: false
		});
		await startProjectSession('/native/moon-castle.twine.rs', undefined, [
			'story-id'
		]);
		await projectSessionSnapshot('/native/moon-castle.twine.rs', ['story-id']);

		expect(
			readdirMock.mock.calls.filter(([path]) =>
				String(path).endsWith('/assets')
			)
		).toHaveLength(2);
	});

	it('scans a declared aggregate source outside the passages directory', async () => {
		const manifestSource = [
			'schema_version = 1',
			'name = "Project"',
			'[[stories]]',
			'id = "story-id"',
			'name = "Story"',
			'source_layout = "single-twee"',
			'source = "story.twee"',
			'[[stories.passages]]',
			'id = "passage-id"',
			'name = "Start"'
		].join('\n');

		readFileMock.mockImplementation(async path =>
			String(path).endsWith('twine.toml') ? manifestSource : ''
		);
		listNativeProjectAssetsMock.mockReturnValue([]);
		nativeProjectFileManifestMock.mockReturnValue(undefined);
		statMock.mockImplementation(async path => {
			const normalized = String(path);

			if (
				normalized.endsWith('/twine.toml') ||
				normalized.endsWith('/story.twee')
			) {
				return {
					isDirectory: () => false,
					isFile: () => true,
					mtime: new Date('2026-06-21T16:00:00.000Z'),
					mtimeMs: 1,
					size: 42
				};
			}
			throw Object.assign(new Error('missing'), {code: 'ENOENT'});
		});

		await startProjectSession('/native/project.twine.rs', undefined, [
			'story-id'
		]);
		const snapshot = await projectSessionSnapshot('/native/project.twine.rs', [
			'story-id'
		]);

		expect(snapshot.files).toEqual(
			expect.arrayContaining([
				expect.objectContaining({kind: 'manifest', path: 'twine.toml'}),
				expect.objectContaining({kind: 'passage', path: 'story.twee'})
			])
		);
	});

	it('opens a native project folder from manifest source files when present', async () => {
		const story = {
			...fakeStory(1),
			id: 'story-id',
			name: 'Moon Castle',
			passages: [
				{
					...fakeStory(1).passages[0],
					id: 'start',
					name: 'Start',
					story: 'story-id',
					text: 'old text'
				}
			],
			script: 'old script',
			stylesheet: 'old stylesheet'
		};

		showOpenDialogMock.mockResolvedValue({
			canceled: false,
			filePaths: ['/native/moon-castle.twine.rs']
		});
		readJsonMock.mockImplementation(async path => {
			if (path.endsWith('.twine/project.json')) {
				return {
					stories: [{...story, lastUpdate: story.lastUpdate.toISOString()}]
				};
			}

			if (path.endsWith('.twine/graph.json')) {
				return {
					passages: {start: {height: 144, left: 22, top: 33, width: 155}}
				};
			}

			return {};
		});
		readFileMock.mockImplementation(async path => {
			if (path.endsWith('twine.toml')) {
				return [
					'[[stories]]',
					'id = "story-id"',
					'ifid = "ifid-1"',
					'last_update = "2026-06-21T16:00:00.000Z"',
					'name = "Moon Castle"',
					'script = "scripts/moon-castle.js"',
					'start_passage = "start"',
					'story_format = "Chapbook"',
					'story_format_version = "2.1.0"',
					'stylesheet = "styles/moon-castle.css"',
					'tags = ["night"]',
					'zoom = 1',
					'[[stories.passages]]',
					'id = "start"',
					'name = "Start"',
					'file = "passages/moon-castle/001-start.twee"',
					'tags = ["entry"]'
				].join('\n');
			}

			if (path.endsWith('001-start.twee')) {
				return 'edited passage text';
			}

			if (path.endsWith('moon-castle.js')) {
				return 'edited script';
			}

			if (path.endsWith('moon-castle.css')) {
				return 'edited stylesheet';
			}

			return '';
		});

		const result = await openProjectFolder();

		expect(result?.stories[0]).toEqual(
			expect.objectContaining({
				id: 'story-id',
				name: 'Moon Castle',
				script: 'edited script',
				stylesheet: 'edited stylesheet',
				storyFormat: 'Chapbook',
				tags: ['night']
			})
		);
		expect(result?.stories[0].passages[0]).toEqual(
			expect.objectContaining({
				height: 144,
				left: 22,
				tags: ['entry'],
				text: 'edited passage text',
				top: 33,
				width: 155
			})
		);
	});

	it('opens a lightweight shell without reading bodies or graph layout', async () => {
		const story = {
			...fakeStory(1),
			id: 'story-id',
			name: 'Moon Castle',
			passages: [
				{
					...fakeStory(1).passages[0],
					id: 'start',
					name: 'Start',
					story: 'story-id',
					text: 'stale metadata body'
				}
			]
		};

		readJsonMock.mockImplementation(async path => {
			if (path.endsWith('.twine/project.json')) {
				return {
					stories: [{...story, lastUpdate: story.lastUpdate.toISOString()}]
				};
			}

			if (path.endsWith('.twine/graph.json')) {
				return {
					passages: {start: {height: 144, left: 22, top: 33, width: 155}}
				};
			}

			return {};
		});
		readFileMock.mockImplementation(async path => {
			if (path.endsWith('twine.toml')) {
				return [
					'[[stories]]',
					'id = "story-id"',
					'ifid = "ifid-1"',
					'last_update = "2026-06-21T16:00:00.000Z"',
					'name = "Moon Castle"',
					'start_passage = "start"',
					'story_format = "Chapbook"',
					'story_format_version = "2.1.0"',
					'[[stories.passages]]',
					'id = "start"',
					'name = "Start"',
					'file = "passages/moon-castle/001-start.twee"'
				].join('\n');
			}

			if (path.endsWith('001-start.twee')) {
				return 'body should not be read';
			}

			return '';
		});

		const result = await openProjectFolder('/native/moon-castle.twine.rs', {
			loadPassageText: false
		});

		expect(result?.passageTextLoaded).toBe(false);
		expect(result?.stories[0].passages[0]).toEqual(
			expect.objectContaining({
				text: ''
			})
		);
		expect(readJsonMock).not.toHaveBeenCalledWith(
			expect.stringContaining('.twine/graph.json'),
			expect.anything()
		);
		expect(readFileMock).not.toHaveBeenCalledWith(
			expect.stringContaining('001-start.twee'),
			'utf8'
		);
	});

	it('hydrates project folder passage body files on demand', async () => {
		readJsonMock.mockImplementation(async path => {
			if (path.endsWith('.twine/project.json')) {
				return {stories: []};
			}

			return {};
		});
		readFileMock.mockImplementation(async path => {
			if (path.endsWith('twine.toml')) {
				return [
					'[[stories]]',
					'id = "story-id"',
					'ifid = "ifid-1"',
					'name = "Moon Castle"',
					'start_passage = "start"',
					'[[stories.passages]]',
					'id = "start"',
					'name = "Start"',
					'file = "passages/moon-castle/001-start.twee"'
				].join('\n');
			}

			if (path.endsWith('001-start.twee')) {
				return 'hydrated passage text';
			}

			return '';
		});

		const result = await hydrateProjectFolder('/native/moon-castle.twine.rs', [
			'story-id'
		]);

		expect(result.passageTextLoaded).toBe(true);
		expect(result.stories[0].passages[0].text).toBe('hydrated passage text');
	});

	it('leases full hydration as bounded passage chunks', async () => {
		const story = fakeStory(3);
		loadNativeProjectFolderMock.mockReturnValue({
			passageTextLoaded: true,
			rootPath: '/native/chunked.twine.rs',
			stories: [story],
			storyIds: [story.id]
		});

		const start = await beginProjectFolderHydration(
			'/native/chunked.twine.rs',
			[story.id]
		);
		expect(start.stories[0].passages).toEqual([]);
		expect(start.passageCount).toBe(3);

		const first = readProjectFolderHydrationChunk(start.hydrationId, 0, 2);
		expect(first.passages).toHaveLength(2);
		expect(first.done).toBe(false);
		const second = readProjectFolderHydrationChunk(
			start.hydrationId,
			first.nextCursor,
			2
		);
		expect(second.passages).toHaveLength(1);
		expect(second.done).toBe(true);

		finishProjectFolderHydration(start.hydrationId);
		expect(() => readProjectFolderHydrationChunk(start.hydrationId, 0)).toThrow(
			'Unknown or expired project hydration'
		);
	});

	it('keeps native hydration bodies in the addon lease', async () => {
		const story = fakeStory(1);
		const passage = {...story.passages[0], text: 'native leased body'};
		beginNativeProjectFolderHydrationMock.mockReturnValue({
			graphLayoutLoaded: true,
			hydrationId: 'native-lease-1',
			passageCount: 1,
			passageTextLoaded: true,
			rootPath: '/native/leased.twine.rs',
			stories: [{...story, passages: [{...passage, text: ''}]}],
			storyIds: [story.id],
			storySourcesLoaded: true
		});
		readNativeProjectFolderHydrationChunkMock.mockReturnValue({
			done: true,
			nextCursor: 1,
			passages: [{passage, storyId: story.id}]
		});

		const start = await beginProjectFolderHydration('/native/leased.twine.rs', [
			story.id
		]);
		expect(start.stories[0].passages).toEqual([]);
		const chunk = readProjectFolderHydrationChunk(start.hydrationId, 0, 1000);
		expect(chunk.passages[0].passage.text).toBe('native leased body');
		finishProjectFolderHydration(start.hydrationId);
		expect(finishNativeProjectFolderHydrationMock).toHaveBeenCalledWith(
			'native-lease-1'
		);
	});

	it('falls back to manifest source files when renderer metadata JSON is mid-write', async () => {
		const warnSpy = jest.spyOn(console, 'warn').mockReturnValue();
		showOpenDialogMock.mockResolvedValue({
			canceled: false,
			filePaths: ['/native/moon-castle.twine.rs']
		});
		readJsonMock.mockImplementation(async path => {
			if (path.endsWith('.twine/project.json')) {
				throw new SyntaxError('Unterminated string in JSON');
			}

			if (path.endsWith('.twine/graph.json')) {
				return {
					passages: {start: {height: 144, left: 22, top: 33, width: 155}}
				};
			}

			return {};
		});
		readFileMock.mockImplementation(async path => {
			if (path.endsWith('twine.toml')) {
				return [
					'[[stories]]',
					'id = "story-id"',
					'ifid = "ifid-1"',
					'last_update = "2026-06-21T16:00:00.000Z"',
					'name = "Moon Castle"',
					'script = "scripts/moon-castle.js"',
					'start_passage = "start"',
					'story_format = "Chapbook"',
					'story_format_version = "2.1.0"',
					'stylesheet = "styles/moon-castle.css"',
					'tags = ["night"]',
					'zoom = 1',
					'[[stories.passages]]',
					'id = "start"',
					'name = "Start"',
					'file = "passages/moon-castle/001-start.twee"',
					'tags = ["entry"]'
				].join('\n');
			}

			if (path.endsWith('001-start.twee')) {
				return 'edited passage text';
			}

			return '';
		});

		const result = await openProjectFolder();

		expect(result?.stories[0]).toEqual(
			expect.objectContaining({
				id: 'story-id',
				name: 'Moon Castle',
				storyFormat: 'Chapbook'
			})
		);
		expect(result?.stories[0].passages[0]).toEqual(
			expect.objectContaining({
				height: 144,
				left: 22,
				text: 'edited passage text',
				top: 33,
				width: 155
			})
		);
		warnSpy.mockRestore();
	});

	it('returns undefined when opening a project folder is canceled', async () => {
		showOpenDialogMock.mockResolvedValue({canceled: true, filePaths: []});

		await expect(openProjectFolder()).resolves.toBeUndefined();
	});

	it('chooses an asset file with a native dialog', async () => {
		showOpenDialogMock.mockResolvedValue({
			canceled: false,
			filePaths: ['/native/assets/cover.png']
		});

		await expect(chooseAssetFile('/native/assets')).resolves.toBe(
			'/native/assets/cover.png'
		);
		expect(showOpenDialogMock).toHaveBeenCalledWith(
			expect.objectContaining({
				defaultPath: '/native/assets',
				properties: ['openFile']
			})
		);
	});

	it('copies an asset into the native project assets folder', async () => {
		let destinationExists = false;

		readFileMock.mockImplementation(async path => {
			if (String(path).endsWith('assets/cover.png') && !destinationExists) {
				throw Object.assign(new Error('missing'), {code: 'ENOENT'});
			}
			return 'asset bytes';
		});
		copyMock.mockImplementation(async (_source, destination) => {
			if (String(destination).endsWith('assets/cover.png')) {
				destinationExists = true;
			}
		});
		await expect(
			copyAssetToProject('/native/project.twine.rs', '/tmp/cover.png')
		).resolves.toEqual({
			effectToken: expect.any(String),
			sourcePath: '/native/project.twine.rs/assets/cover.png',
			targetPath: 'assets/cover.png'
		});
		expect(mkdirpMock).toHaveBeenCalledWith('/native/project.twine.rs/assets');
		expect(copyMock).toHaveBeenCalledWith(
			'/tmp/cover.png',
			'/native/project.twine.rs/assets/cover.png',
			{overwrite: true}
		);
	});

	it('uses the native asset scanner when it is available', async () => {
		const nativeAssets = [
			{
				durationMs: null,
				exists: true,
				height: null,
				kind: 'image',
				missing: false,
				modifiedAt: '2026-06-21T16:00:00.000Z',
				normalizedPath: 'assets/cover.png',
				path: 'assets/cover.png',
				previewUrl: 'file:///native/project.twine.rs/assets/cover.png',
				publish: {
					copy: true,
					outputPath: 'assets/cover.png',
					reason: 'Copy asset into published output'
				},
				referenceCount: 0,
				references: [],
				sizeBytes: 2048,
				snippet: {
					label: 'Insert asset reference',
					mediaType: 'image',
					text: '<img src="assets/cover.png" alt="">'
				},
				thumbnailUrl: 'file:///native/project.twine.rs/assets/cover.png',
				unused: true,
				width: null
			}
		];

		listNativeProjectAssetsMock.mockReturnValue(nativeAssets);

		await expect(listProjectAssets('/native/project.twine.rs')).resolves.toBe(
			nativeAssets
		);
		expect(listNativeProjectAssetsMock).toHaveBeenCalledWith(
			'/native/project.twine.rs'
		);
		expect(readdirMock).not.toHaveBeenCalledWith(
			'/native/project.twine.rs/assets'
		);
	});

	it('lists native project assets with file metadata and preview URLs', async () => {
		const mtime = new Date('2026-06-21T16:00:00.000Z');

		readdirMock.mockImplementation(async path => {
			if (path === '/native/project.twine.rs/assets') {
				return ['cover.png', 'audio'];
			}

			if (path === '/native/project.twine.rs/assets/audio') {
				return ['theme.mp3'];
			}

			return [];
		});
		statMock.mockImplementation(async path => ({
			isDirectory: () => path.endsWith('/audio'),
			isFile: () => !path.endsWith('/audio'),
			mtime,
			size: path.endsWith('.mp3') ? 4096 : 2048
		}));

		await expect(
			listProjectAssets('/native/project.twine.rs')
		).resolves.toEqual([
			expect.objectContaining({
				height: null,
				kind: 'audio',
				path: 'assets/audio/theme.mp3',
				sizeBytes: 4096,
				thumbnailUrl: null,
				width: null
			}),
			expect.objectContaining({
				height: null,
				kind: 'image',
				modifiedAt: '2026-06-21T16:00:00.000Z',
				path: 'assets/cover.png',
				sizeBytes: 2048,
				thumbnailUrl: 'file:///native/project.twine.rs/assets/cover.png',
				width: null
			})
		]);
	});

	it('returns an empty asset inventory when the project assets folder is absent', async () => {
		readdirMock.mockRejectedValue(
			Object.assign(new Error('missing'), {
				code: 'ENOENT'
			})
		);

		await expect(
			listProjectAssets('/native/project.twine.rs')
		).resolves.toEqual([]);
	});

	it('uses native HTML import preparation when it is available', async () => {
		prepareNativeHtmlImportMock.mockReturnValue({
			assets: [
				{
					originalPath: 'images/cover.png',
					sourcePath: '/imports/images/cover.png',
					targetPath: 'assets/images/cover.png'
				}
			],
			htmlFilePath: '/imports/Transylvania.html',
			htmlSource: '<tw-storydata></tw-storydata>',
			sourceKind: 'html',
			sourcePath: '/imports/Transylvania.html'
		});

		const preparedImport = await prepareProjectImport(
			'/imports/Transylvania.html'
		);

		expect(preparedImport).toEqual(
			expect.objectContaining({
				assets: [
					{
						originalPath: 'images/cover.png',
						sourcePath: '/imports/images/cover.png',
						targetPath: 'assets/images/cover.png'
					}
				],
				htmlSource: '<tw-storydata></tw-storydata>',
				sourceKind: 'html'
			})
		);
		expect(preparedImport.id).toEqual(expect.any(String));
		expect(prepareNativeHtmlImportMock).toHaveBeenCalledWith(
			'/imports/Transylvania.html',
			'/imports/Transylvania.html',
			'html'
		);
		expect(readFileMock).not.toHaveBeenCalledWith(
			'/imports/Transylvania.html',
			'utf8'
		);
	});

	it('uses native zip import preparation when it is available', async () => {
		prepareNativeProjectImportMock.mockReturnValue({
			assets: [
				{
					originalPath: 'images/cover.png',
					sourcePath: '/tmp/twine-import-native/images/cover.png',
					targetPath: 'assets/images/cover.png'
				}
			],
			cleanupPath: '/tmp/twine-import-native',
			htmlFilePath: '/tmp/twine-import-native/Archive Story.html',
			htmlSource: '<tw-storydata></tw-storydata>',
			sourceKind: 'zip',
			sourcePath: '/downloads/Archive Story.zip'
		});

		const preparedImport = await prepareProjectImport(
			'/downloads/Archive Story.zip'
		);

		expect(preparedImport).toEqual(
			expect.objectContaining({
				assets: [
					{
						originalPath: 'images/cover.png',
						sourcePath: '/tmp/twine-import-native/images/cover.png',
						targetPath: 'assets/images/cover.png'
					}
				],
				htmlFilePath: '/tmp/twine-import-native/Archive Story.html',
				htmlSource: '<tw-storydata></tw-storydata>',
				sourceKind: 'zip'
			})
		);
		expect(prepareNativeProjectImportMock).toHaveBeenCalledWith(
			'/downloads/Archive Story.zip'
		);
		expect(extractZipMock).not.toHaveBeenCalled();

		await discardProjectImport(preparedImport.id);
		expect(removeMock).toHaveBeenCalledWith('/tmp/twine-import-native');
	});

	it('prepares an HTML import by rewriting sibling media paths and copying assets', async () => {
		readFileMock.mockResolvedValue(`
			<tw-storydata name="Transylvania" hidden>
				<style role="stylesheet">body { background-image: url("images/cover.png"); }</style>
				<tw-passagedata pid="1" name="Start">Play audio/theme.mp3</tw-passagedata>
			</tw-storydata>
		`);
		readdirMock.mockImplementation(async path => {
			if (path === '/imports') {
				return ['Transylvania.html', 'images', 'audio'];
			}

			if (path === '/imports/images') {
				return ['cover.png'];
			}

			if (path === '/imports/audio') {
				return ['theme.mp3'];
			}

			return [];
		});
		statMock.mockImplementation(async path => ({
			isDirectory: () =>
				path === '/imports/images' || path === '/imports/audio',
			isFile: () =>
				path.endsWith('.html') ||
				path.endsWith('.png') ||
				path.endsWith('.mp3'),
			mtime: new Date('2026-06-21T16:00:00.000Z'),
			mtimeMs: 1,
			size: 2048
		}));

		const preparedImport = await prepareProjectImport(
			'/imports/Transylvania.html'
		);

		expect(preparedImport.sourceKind).toBe('html');
		expect(preparedImport.assets).toEqual([
			{
				originalPath: 'audio/theme.mp3',
				sourcePath: '/imports/audio/theme.mp3',
				targetPath: 'assets/audio/theme.mp3'
			},
			{
				originalPath: 'images/cover.png',
				sourcePath: '/imports/images/cover.png',
				targetPath: 'assets/images/cover.png'
			}
		]);
		expect(preparedImport.htmlSource).toContain('assets/images/cover.png');
		expect(preparedImport.htmlSource).toContain('assets/audio/theme.mp3');

		await expect(
			copyProjectImportAssets(preparedImport.id, '/native/project.twine.rs')
		).resolves.toEqual([
			{
				sourcePath: '/native/project.twine.rs/assets/audio/theme.mp3',
				targetPath: 'assets/audio/theme.mp3'
			},
			{
				sourcePath: '/native/project.twine.rs/assets/images/cover.png',
				targetPath: 'assets/images/cover.png'
			}
		]);
		expect(copyMock).toHaveBeenCalledWith(
			'/imports/audio/theme.mp3',
			'/native/project.twine.rs/assets/audio/theme.mp3',
			{overwrite: true}
		);
		expect(copyMock).toHaveBeenCalledWith(
			'/imports/images/cover.png',
			'/native/project.twine.rs/assets/images/cover.png',
			{overwrite: true}
		);
		expect(readdirMock).toHaveBeenCalledWith('/native/project.twine.rs/assets');
	});

	it('prepares a zip import by extracting it and cleaning up when discarded', async () => {
		readFileMock.mockResolvedValue(`
			<tw-storydata name="Archive Story" hidden>
				<tw-passagedata pid="1" name="Start">images/cover.png</tw-passagedata>
			</tw-storydata>
		`);
		readdirMock.mockImplementation(async path => {
			if (path === '/tmp/twine-import-abc') {
				return ['Archive Story.html', 'images'];
			}

			if (path === '/tmp/twine-import-abc/images') {
				return ['cover.png'];
			}

			return [];
		});
		statMock.mockImplementation(async path => ({
			isDirectory: () => path === '/tmp/twine-import-abc/images',
			isFile: () => path.endsWith('.html') || path.endsWith('.png'),
			mtime: new Date('2026-06-21T16:00:00.000Z'),
			mtimeMs: 1,
			size: 2048
		}));

		const preparedImport = await prepareProjectImport(
			'/downloads/Archive Story.zip'
		);

		expect(extractZipMock).toHaveBeenCalledWith(
			'/downloads/Archive Story.zip',
			{
				dir: '/tmp/twine-import-abc'
			}
		);
		expect(preparedImport.sourceKind).toBe('zip');
		expect(preparedImport.htmlFilePath).toBe(
			'/tmp/twine-import-abc/Archive Story.html'
		);
		expect(preparedImport.assets).toEqual([
			{
				originalPath: 'images/cover.png',
				sourcePath: '/tmp/twine-import-abc/images/cover.png',
				targetPath: 'assets/images/cover.png'
			}
		]);

		await discardProjectImport(preparedImport.id);
		expect(removeMock).toHaveBeenCalledWith('/tmp/twine-import-abc');
	});

	it('uses native project file manifests and diffs for session snapshots', async () => {
		const story = fakeStory(1);
		const previousFile = {
			fingerprint: '1:42',
			kind: 'manifest' as const,
			modifiedAt: '2026-06-21T16:00:01.000Z',
			mtimeMs: 1,
			path: 'twine.toml',
			sizeBytes: 42
		};
		const currentFile = {
			...previousFile,
			fingerprint: '2:42',
			modifiedAt: '2026-06-21T16:00:02.000Z',
			mtimeMs: 2
		};

		loadNativeProjectFolderMock.mockReturnValue({
			passageTextLoaded: true,
			rootPath: '/native/project.twine.rs',
			stories: [story],
			storyIds: [story.id]
		});
		listNativeProjectAssetsMock.mockReturnValue([]);
		nativeProjectFileManifestMock
			.mockReturnValueOnce([previousFile])
			.mockReturnValueOnce([currentFile]);
		diffNativeProjectFileManifestMock.mockReturnValue([
			{
				change: 'modified',
				current: currentFile,
				id: 'modified:twine.toml',
				kind: 'manifest',
				message: 'twine.toml changed outside twine.rs.',
				path: 'twine.toml',
				previous: previousFile
			}
		]);

		await expect(
			projectSessionSnapshot('/native/project.twine.rs')
		).resolves.toEqual(expect.objectContaining({conflicts: []}));
		await expect(
			projectSessionSnapshot('/native/project.twine.rs')
		).resolves.toEqual(
			expect.objectContaining({
				changedPaths: ['twine.toml'],
				conflicts: [expect.objectContaining({path: 'twine.toml'})]
			})
		);
		expect(nativeProjectFileManifestMock).toHaveBeenCalledWith(
			'/native/project.twine.rs',
			[]
		);
		expect(diffNativeProjectFileManifestMock).toHaveBeenCalledWith(
			[previousFile],
			[currentFile]
		);
	});

	it('reports project session conflicts when watched files change', async () => {
		const story = fakeStory(1);
		let manifestVersion = 1;

		readJsonMock.mockImplementation(async path => {
			if (path.endsWith('.twine/project.json')) {
				return {stories: [story]};
			}

			throw Object.assign(new Error('missing'), {code: 'ENOENT'});
		});
		readdirMock.mockRejectedValue(
			Object.assign(new Error('missing'), {
				code: 'ENOENT'
			})
		);
		statMock.mockImplementation(async path => {
			if (path.endsWith('twine.toml')) {
				return {
					isDirectory: () => false,
					isFile: () => true,
					mtime: new Date(`2026-06-21T16:00:0${manifestVersion}.000Z`),
					mtimeMs: manifestVersion,
					size: 42
				};
			}

			throw Object.assign(new Error('missing'), {code: 'ENOENT'});
		});

		await expect(
			projectSessionSnapshot('/native/project.twine.rs')
		).resolves.toEqual(expect.objectContaining({conflicts: []}));

		manifestVersion = 2;

		await expect(
			projectSessionSnapshot('/native/project.twine.rs')
		).resolves.toEqual(
			expect.objectContaining({
				changedPaths: ['twine.toml'],
				conflicts: [
					expect.objectContaining({
						change: 'modified',
						kind: 'manifest',
						path: 'twine.toml'
					})
				]
			})
		);
	});

	it('cancels a stopped pending start without installing stale session resources', async () => {
		const rootPath = '/native/project.twine.rs';
		let resolveBaseline!: (files: []) => void;
		const delayedBaseline = new Promise<[]>(resolve => {
			resolveBaseline = resolve;
		});
		const watcher = {close: jest.fn()};
		const setIntervalSpy = jest.spyOn(global, 'setInterval');
		const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

		watchMock.mockReturnValue(watcher as unknown as FSWatcher);
		listNativeProjectAssetsMock.mockReturnValue([]);
		nativeProjectFileManifestMock
			.mockReturnValueOnce(delayedBaseline)
			.mockReturnValue([]);

		try {
			const staleStart = startProjectSession(rootPath, jest.fn(), ['stale']);

			for (
				let attempts = 0;
				attempts < 10 && nativeProjectFileManifestMock.mock.calls.length === 0;
				attempts++
			) {
				await Promise.resolve();
			}
			expect(nativeProjectFileManifestMock).toHaveBeenCalledTimes(1);

			stopProjectSession(rootPath);
			const liveStart = await startProjectSession(rootPath, jest.fn(), [
				'live'
			]);

			expect(liveStart.storyIds).toEqual(['live']);
			expect(watchMock).toHaveBeenCalledTimes(1);
			expect(setIntervalSpy).toHaveBeenCalledTimes(1);
			expect(clearIntervalSpy).not.toHaveBeenCalled();
			expect(watcher.close).not.toHaveBeenCalled();

			resolveBaseline([]);
			await expect(staleStart).rejects.toMatchObject({
				code: 'PROJECT_SESSION_START_CANCELED'
			});
			expect(watchMock).toHaveBeenCalledTimes(1);
			expect(setIntervalSpy).toHaveBeenCalledTimes(1);

			await expect(
				startProjectSession(rootPath, undefined, ['live'])
			).resolves.toEqual(
				expect.objectContaining({
					generation: liveStart.generation,
					storyIds: ['live']
				})
			);
			expect(watchMock).toHaveBeenCalledTimes(1);
			expect(setIntervalSpy).toHaveBeenCalledTimes(1);

			const interval = setIntervalSpy.mock.results[0].value;

			stopProjectSession(rootPath);
			expect(watcher.close).toHaveBeenCalledTimes(1);
			expect(clearIntervalSpy).toHaveBeenCalledWith(interval);
		} finally {
			stopProjectSession(rootPath);
			setIntervalSpy.mockRestore();
			clearIntervalSpy.mockRestore();
		}
	});

	it('emits a generation-bound passage delta without loading the full project', async () => {
		jest.useFakeTimers();
		const manifestSource = [
			'schema_version = 1',
			'name = "Project"',
			'[[stories]]',
			'id = "story-id"',
			'ifid = "STORY-ID"',
			'name = "Story"',
			'start_passage = "passage-id"',
			'[[stories.passages]]',
			'id = "passage-id"',
			'name = "Start"',
			'file = "passages/story/001-start.twee"'
		].join('\n');
		const manifestFile = {
			fingerprint: '1:100',
			kind: 'manifest' as const,
			modifiedAt: '2026-06-21T16:00:00.000Z',
			mtimeMs: 1,
			path: 'twine.toml',
			sizeBytes: 100
		};
		const passageFile = {
			fingerprint: '1:4',
			kind: 'passage' as const,
			modifiedAt: '2026-06-21T16:00:00.000Z',
			mtimeMs: 1,
			path: 'passages/story/001-start.twee',
			sizeBytes: 4
		};
		const changedPassageFile = {
			...passageFile,
			fingerprint: '2:9',
			modifiedAt: '2026-06-21T16:00:01.000Z',
			mtimeMs: 2,
			sizeBytes: 9
		};
		const listener = jest.fn();

		readFileMock.mockImplementation(async path =>
			String(path).endsWith('twine.toml') ? manifestSource : 'from disk'
		);
		listNativeProjectAssetsMock.mockReturnValue([]);
		nativeProjectFileManifestMock
			.mockReturnValueOnce([manifestFile, passageFile])
			.mockReturnValueOnce([manifestFile, changedPassageFile]);

		try {
			const start = await startProjectSession(
				'/native/project.twine.rs',
				listener,
				['story-id']
			);

			expect(start).toEqual(
				expect.objectContaining({generation: 1, storyIds: ['story-id']})
			);
			await jest.advanceTimersByTimeAsync(1250);

			expect(listener).toHaveBeenCalledWith(
				expect.objectContaining({
					baseGeneration: 1,
					candidateGeneration: 2,
					changedPaths: ['passages/story/001-start.twee'],
					delta: expect.objectContaining({
						changes: [
							expect.objectContaining({
								passage_id: 'passage-id',
								story_id: 'story-id',
								type: 'updatePassage'
							})
						]
					})
				})
			);
			expect(loadNativeProjectFolderMock).not.toHaveBeenCalled();
		} finally {
			stopProjectSession('/native/project.twine.rs');
			jest.useRealTimers();
		}
	});

	it('maps one aggregate source watcher change to every owned passage', async () => {
		jest.useFakeTimers();
		const manifestSource = [
			'schema_version = 1',
			'name = "Project"',
			'[[stories]]',
			'id = "story-id"',
			'ifid = "STORY-ID"',
			'name = "Story"',
			'source_layout = "single-twee"',
			'source = "story.twee"',
			'start_passage = "passage-1"',
			'[[stories.passages]]',
			'id = "passage-1"',
			'name = "Start"',
			'[[stories.passages]]',
			'id = "passage-2"',
			'name = "Second"'
		].join('\n');
		const aggregateSource = [
			':: StoryTitle',
			'Story',
			'',
			':: StoryData',
			'{"ifid":"STORY-ID","start":"Start"}',
			'',
			':: Start',
			'changed first',
			'',
			':: Second [fresh]',
			'changed second'
		].join('\n');
		const manifestFile = {
			fingerprint: '1:100',
			kind: 'manifest' as const,
			modifiedAt: '2026-06-21T16:00:00.000Z',
			mtimeMs: 1,
			path: 'twine.toml',
			sizeBytes: 100
		};
		const aggregateFile = {
			fingerprint: '1:100',
			kind: 'passage' as const,
			modifiedAt: '2026-06-21T16:00:00.000Z',
			mtimeMs: 1,
			path: 'story.twee',
			sizeBytes: 100
		};
		const changedAggregateFile = {
			...aggregateFile,
			fingerprint: '2:120',
			modifiedAt: '2026-06-21T16:00:01.000Z',
			mtimeMs: 2,
			sizeBytes: 120
		};
		const listener = jest.fn();

		readFileMock.mockImplementation(async path =>
			String(path).endsWith('twine.toml')
				? manifestSource
				: String(path).endsWith('story.twee')
					? aggregateSource
					: ''
		);
		listNativeProjectAssetsMock.mockReturnValue([]);
		nativeProjectFileManifestMock
			.mockReturnValueOnce([manifestFile, aggregateFile])
			.mockReturnValueOnce([manifestFile, changedAggregateFile]);

		try {
			await startProjectSession('/native/project.twine.rs', listener, [
				'story-id'
			]);
			await jest.advanceTimersByTimeAsync(1250);

			const changes = listener.mock.calls[0][0].delta.changes;

			expect(changes).toEqual([
				expect.objectContaining({
					changes: expect.objectContaining({
						name: 'Start',
						text: 'changed first'
					}),
					passage_id: 'passage-1',
					story_id: 'story-id',
					type: 'updatePassage'
				}),
				expect.objectContaining({
					changes: expect.objectContaining({
						name: 'Second',
						tags: ['fresh'],
						text: 'changed second'
					}),
					passage_id: 'passage-2',
					story_id: 'story-id',
					type: 'updatePassage'
				})
			]);
			expect(readFileMock).toHaveBeenCalledWith(
				'/native/project.twine.rs/story.twee',
				'utf8'
			);
		} finally {
			stopProjectSession('/native/project.twine.rs');
			jest.useRealTimers();
		}
	});

	it('applies watched StoryTitle and StoryData metadata changes', async () => {
		jest.useFakeTimers();
		const manifestSource = [
			'schema_version = 1',
			'name = "Project"',
			'[[stories]]',
			'id = "story-id"',
			'ifid = "OLD-IFID"',
			'name = "Old Story"',
			'source_layout = "single-twee"',
			'source = "story.twee"',
			'start_passage = "passage-1"',
			'[[stories.passages]]',
			'id = "passage-1"',
			'name = "Start"',
			'[[stories.passages]]',
			'id = "passage-2"',
			'name = "Second"'
		].join('\n');
		let aggregateSource = [
			':: StoryTitle',
			'Old Story',
			'',
			':: StoryData',
			'{"ifid":"OLD-IFID","format":"Harlowe","format-version":"3.3.9","start":"Start","tag-colors":{"old":"red"},"zoom":1}',
			'',
			':: Start',
			'first',
			'',
			':: Second',
			'second'
		].join('\n');
		const manifestFile = {
			fingerprint: '1:100',
			kind: 'manifest' as const,
			modifiedAt: '2026-06-21T16:00:00.000Z',
			mtimeMs: 1,
			path: 'twine.toml',
			sizeBytes: 100
		};
		const aggregateFile = {
			fingerprint: '1:100',
			kind: 'passage' as const,
			modifiedAt: '2026-06-21T16:00:00.000Z',
			mtimeMs: 1,
			path: 'story.twee',
			sizeBytes: 100
		};
		const listener = jest.fn();

		readFileMock.mockImplementation(async path =>
			String(path).endsWith('twine.toml')
				? manifestSource
				: String(path).endsWith('story.twee')
					? aggregateSource
					: ''
		);
		listNativeProjectAssetsMock.mockReturnValue([]);
		nativeProjectFileManifestMock
			.mockReturnValueOnce([manifestFile, aggregateFile])
			.mockReturnValueOnce([
				manifestFile,
				{...aggregateFile, fingerprint: '2:140', mtimeMs: 2}
			]);

		try {
			await startProjectSession('/native/project.twine.rs', listener, [
				'story-id'
			]);
			aggregateSource = [
				':: StoryTitle',
				'New Story',
				'',
				':: StoryData',
				'{"ifid":"NEW-IFID","format":"Chapbook","format-version":"2.3.1","start":"Second","tag-colors":{"new":"#123456"},"zoom":1.5,"tool":"preserved"}',
				'',
				':: Start',
				'first',
				'',
				':: Second',
				'second'
			].join('\n');
			await jest.advanceTimersByTimeAsync(1250);

			expect(listener.mock.calls[0][0].delta.changes).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						changes: expect.objectContaining({
							ifid: 'NEW-IFID',
							name: 'New Story',
							storyFormat: 'Chapbook',
							storyFormatVersion: '2.3.1',
							tagColors: {new: '#123456'},
							zoom: 1.5
						}),
						story_id: 'story-id',
						type: 'updateStoryMetadata'
					}),
					expect.objectContaining({
						passage_id: 'passage-2',
						story_id: 'story-id',
						type: 'updateStoryStartPassage'
					})
				])
			);
		} finally {
			stopProjectSession('/native/project.twine.rs');
			jest.useRealTimers();
		}
	});

	it('applies Rust defaults when watched story metadata is removed or invalid', async () => {
		jest.useFakeTimers();
		const manifestSource = [
			'schema_version = 1',
			'name = "Project"',
			'[[stories]]',
			'id = "story-id"',
			'ifid = "MANIFEST-IFID"',
			'name = "Manifest Story"',
			'source_layout = "single-twee"',
			'source = "story.twee"',
			'start_passage = "passage-2"',
			'[[stories.passages]]',
			'id = "passage-1"',
			'name = "First"',
			'[[stories.passages]]',
			'id = "passage-2"',
			'name = "Second"'
		].join('\n');
		let aggregateSource = [
			':: StoryTitle',
			'Source Story',
			'',
			':: StoryData',
			'{"ifid":"SOURCE-IFID","format":"Chapbook","format-version":"2.3.1","start":"First","tag-colors":{"old":"red"},"zoom":1.5}',
			'',
			':: First',
			'first',
			'',
			':: Second',
			'second'
		].join('\n');
		const manifestFile = {
			fingerprint: '1:100',
			kind: 'manifest' as const,
			modifiedAt: '2026-06-21T16:00:00.000Z',
			mtimeMs: 1,
			path: 'twine.toml',
			sizeBytes: 100
		};
		const aggregateFile = {
			fingerprint: '1:100',
			kind: 'passage' as const,
			modifiedAt: '2026-06-21T16:00:00.000Z',
			mtimeMs: 1,
			path: 'story.twee',
			sizeBytes: 100
		};
		const listener = jest.fn();

		readFileMock.mockImplementation(async path =>
			String(path).endsWith('twine.toml')
				? manifestSource
				: String(path).endsWith('story.twee')
					? aggregateSource
					: ''
		);
		listNativeProjectAssetsMock.mockReturnValue([]);
		nativeProjectFileManifestMock
			.mockReturnValueOnce([manifestFile, aggregateFile])
			.mockReturnValueOnce([
				manifestFile,
				{...aggregateFile, fingerprint: '2:140', mtimeMs: 2}
			]);

		try {
			await startProjectSession('/native/project.twine.rs', listener, [
				'story-id'
			]);
			aggregateSource = [
				':: StoryData',
				'{"ifid":42,"format":false,"format-version":null,"tag-colors":[],"zoom":"wide"}',
				'',
				':: First',
				'first',
				'',
				':: Second',
				'second'
			].join('\n');
			await jest.advanceTimersByTimeAsync(1250);

			expect(listener.mock.calls[0][0].delta.changes).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						changes: expect.objectContaining({
							ifid: expect.stringMatching(
								/^[A-F0-9]{8}-[A-F0-9]{4}-4[A-F0-9]{3}-8[A-F0-9]{3}-[A-F0-9]{12}$/
							),
							name: 'Manifest Story',
							storyFormat: '',
							storyFormatVersion: '',
							tagColors: {},
							zoom: 1
						}),
						story_id: 'story-id',
						type: 'updateStoryMetadata'
					}),
					expect.objectContaining({
						passage_id: 'passage-2',
						story_id: 'story-id',
						type: 'updateStoryStartPassage'
					})
				])
			);
		} finally {
			stopProjectSession('/native/project.twine.rs');
			jest.useRealTimers();
		}
	});

	it('reconciles aggregate passage renames, additions, and deletions', async () => {
		jest.useFakeTimers();
		let manifestSource = [
			'schema_version = 1',
			'name = "Project"',
			'[[stories]]',
			'id = "story-id"',
			'ifid = "STORY-ID"',
			'name = "Story"',
			'source_layout = "single-twee"',
			'source = "story.twee"',
			'[[stories.passages]]',
			'id = "passage-1"',
			'name = "Start"',
			'[[stories.passages]]',
			'id = "passage-2"',
			'name = "Second"'
		].join('\n');
		const storySource = (sections: string[]) =>
			[
				':: StoryTitle',
				'Story',
				'',
				':: StoryData',
				'{"ifid":"STORY-ID"}',
				'',
				...sections
			].join('\n');
		let aggregateSource = storySource([
			':: Start',
			'start body',
			'',
			':: Second',
			'second body'
		]);
		let aggregateVersion = 1;
		let manifestVersion = 1;
		let pendingManifestSource: string | undefined;
		const manifestFile = {
			fingerprint: '1:100',
			kind: 'manifest' as const,
			modifiedAt: '2026-06-21T16:00:00.000Z',
			mtimeMs: 1,
			path: 'twine.toml',
			sizeBytes: 100
		};
		const aggregateFile = {
			fingerprint: '1:100',
			kind: 'passage' as const,
			modifiedAt: '2026-06-21T16:00:00.000Z',
			mtimeMs: 1,
			path: 'story.twee',
			sizeBytes: 100
		};
		const listener = jest.fn();

		readFileMock.mockImplementation(async path =>
			String(path).endsWith('twine.toml')
				? manifestSource
				: String(path).endsWith('story.twee')
					? aggregateSource
					: ''
		);
		writeFileMock.mockImplementation(async (path, source) => {
			if (
				/^\/native\/project\.twine\.rs\/twine\.toml\..+\.tmp$/.test(
					String(path)
				)
			) {
				pendingManifestSource = String(source);
			}
		});
		moveMock.mockImplementation(async (_source, destination) => {
			if (
				String(destination) === '/native/project.twine.rs/twine.toml' &&
				pendingManifestSource !== undefined
			) {
				manifestSource = pendingManifestSource;
				pendingManifestSource = undefined;
				manifestVersion++;
			}
		});
		listNativeProjectAssetsMock.mockReturnValue([]);
		nativeProjectFileManifestMock.mockImplementation(() => [
			{
				...manifestFile,
				fingerprint: `${manifestVersion}:100`,
				mtimeMs: manifestVersion
			},
			{
				...aggregateFile,
				fingerprint: `${aggregateVersion}:120`,
				mtimeMs: aggregateVersion
			}
		]);

		try {
			await startProjectSession('/native/project.twine.rs', listener, [
				'story-id'
			]);
			aggregateSource = storySource([
				':: Start Renamed',
				'renamed body',
				'',
				':: Second',
				'second body',
				'',
				':: Added',
				'added body'
			]);
			aggregateVersion = 2;
			await jest.advanceTimersByTimeAsync(1250);
			const firstDelta = listener.mock.calls[0][0];
			const firstChanges = firstDelta.delta.changes;
			const added = firstChanges.find(
				(change: {type: string}) => change.type === 'upsertPassage'
			);

			expect(firstChanges).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						changes: expect.objectContaining({name: 'Start Renamed'}),
						passage_id: 'passage-1',
						type: 'updatePassage'
					}),
					expect.objectContaining({
						passage: expect.objectContaining({
							name: 'Added',
							text: 'added body'
						}),
						type: 'upsertPassage'
					})
				])
			);
			expect(added.passage.id).toMatch(/^passage-.+-[a-f0-9]{16}$/);

			aggregateSource = storySource([
				':: Second',
				'second body',
				'',
				':: Added',
				'added body'
			]);
			aggregateVersion = 3;
			await resolveProjectSessionConflicts(
				'/native/project.twine.rs',
				'acceptDisk',
				[],
				firstDelta.id
			);
			expect(manifestSource).not.toContain(`id = "${added.passage.id}"`);
			await jest.advanceTimersByTimeAsync(1);

			expect(listener.mock.calls[1][0].delta.changes).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						passage_id: 'passage-1',
						story_id: 'story-id',
						type: 'deletePassage'
					}),
					expect.objectContaining({
						passage_id: added.passage.id,
						type: 'updatePassage'
					})
				])
			);
			await resolveProjectSessionConflicts(
				'/native/project.twine.rs',
				'acceptDisk',
				[],
				listener.mock.calls[1][0].id
			);
			expect(manifestSource).toContain(`id = "${added.passage.id}"`);
			stopProjectSession('/native/project.twine.rs');
			const reopened = await openProjectFolder('/native/project.twine.rs');
			const reopenedAdded = reopened?.stories[0].passages.find(
				passage => passage.name === 'Added'
			);

			expect(reopenedAdded?.id).toBe(added.passage.id);
		} finally {
			stopProjectSession('/native/project.twine.rs');
			jest.useRealTimers();
		}
	});

	it('does not persist a stale ID when an unaccepted passage is replaced', async () => {
		jest.useFakeTimers();
		let manifestSource = [
			'schema_version = 1',
			'name = "Project"',
			'[[stories]]',
			'id = "story-id"',
			'ifid = "STORY-ID"',
			'name = "Story"',
			'source_layout = "single-twee"',
			'source = "story.twee"',
			'[[stories.passages]]',
			'id = "passage-1"',
			'name = "Start"'
		].join('\n');
		const storySource = (secondName?: string) =>
			[
				':: StoryTitle',
				'Story',
				'',
				':: StoryData',
				'{"ifid":"STORY-ID"}',
				'',
				':: Start',
				'start body',
				...(secondName ? ['', `:: ${secondName}`, 'second body'] : [])
			].join('\n');
		let aggregateSource = storySource();
		let aggregateVersion = 1;
		let manifestVersion = 1;
		let pendingManifestSource: string | undefined;
		let replaceAggregateDuringManifestWrite = false;
		const manifestFile = {
			fingerprint: '1:100',
			kind: 'manifest' as const,
			modifiedAt: '2026-06-21T16:00:00.000Z',
			mtimeMs: 1,
			path: 'twine.toml',
			sizeBytes: 100
		};
		const aggregateFile = {
			fingerprint: '1:100',
			kind: 'passage' as const,
			modifiedAt: '2026-06-21T16:00:00.000Z',
			mtimeMs: 1,
			path: 'story.twee',
			sizeBytes: 100
		};
		const listener = jest.fn();

		readFileMock.mockImplementation(async path =>
			String(path).endsWith('twine.toml')
				? manifestSource
				: String(path).endsWith('story.twee')
					? aggregateSource
					: ''
		);
		writeFileMock.mockImplementation(async (path, source) => {
			if (
				/^\/native\/race\.twine\.rs\/twine\.toml\..+\.tmp$/.test(String(path))
			) {
				pendingManifestSource = String(source);
			}
		});
		moveMock.mockImplementation(async (_source, destination) => {
			if (
				String(destination) === '/native/race.twine.rs/twine.toml' &&
				pendingManifestSource !== undefined
			) {
				const writtenManifest = pendingManifestSource;

				manifestSource = writtenManifest;
				pendingManifestSource = undefined;
				manifestVersion++;
				if (
					replaceAggregateDuringManifestWrite &&
					aggregateVersion === 2 &&
					(writtenManifest.match(/\[\[stories\.passages\]\]/g)?.length ?? 0) > 1
				) {
					replaceAggregateDuringManifestWrite = false;
					aggregateSource = storySource('Replacement');
					aggregateVersion = 3;
				}
			}
		});
		listNativeProjectAssetsMock.mockReturnValue([]);
		nativeProjectFileManifestMock.mockImplementation(() => [
			{
				...manifestFile,
				fingerprint: `${manifestVersion}:100`,
				mtimeMs: manifestVersion
			},
			{
				...aggregateFile,
				fingerprint: `${aggregateVersion}:120`,
				mtimeMs: aggregateVersion
			}
		]);

		try {
			await startProjectSession('/native/race.twine.rs', listener, [
				'story-id'
			]);
			aggregateSource = storySource('Added');
			aggregateVersion = 2;
			await jest.advanceTimersByTimeAsync(1250);
			const firstDelta = listener.mock.calls[0][0];
			const staleAddition = firstDelta.delta.changes.find(
				(change: {type: string}) => change.type === 'upsertPassage'
			);

			replaceAggregateDuringManifestWrite = true;
			await resolveProjectSessionConflicts(
				'/native/race.twine.rs',
				'acceptDisk',
				[],
				firstDelta.id
			);
			expect(manifestSource).not.toContain(
				`id = "${staleAddition.passage.id}"`
			);
			expect(
				moveMock.mock.calls.filter(
					([, destination]) =>
						String(destination) === '/native/race.twine.rs/twine.toml'
				)
			).toHaveLength(2);
			await jest.advanceTimersByTimeAsync(1);

			const secondDelta = listener.mock.calls[1][0];
			const replacement = secondDelta.delta.changes.find(
				(change: {passage?: {name?: string}; type: string}) =>
					change.type === 'upsertPassage' &&
					change.passage?.name === 'Replacement'
			);

			expect(secondDelta.delta.changes).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						passage_id: staleAddition.passage.id,
						type: 'deletePassage'
					}),
					expect.objectContaining({
						passage: expect.objectContaining({name: 'Replacement'}),
						type: 'upsertPassage'
					})
				])
			);
			expect(replacement.passage.id).not.toBe(staleAddition.passage.id);
			await resolveProjectSessionConflicts(
				'/native/race.twine.rs',
				'acceptDisk',
				[],
				secondDelta.id
			);
			expect(manifestSource).not.toContain(
				`id = "${staleAddition.passage.id}"`
			);
			expect(manifestSource).toContain(`id = "${replacement.passage.id}"`);
		} finally {
			stopProjectSession('/native/race.twine.rs');
			jest.useRealTimers();
		}
	});

	it('holds a delivered candidate until exact acknowledgement, then rescans', async () => {
		jest.useFakeTimers();
		const manifestSource = [
			'schema_version = 1',
			'name = "Project"',
			'[[stories]]',
			'id = "story-id"',
			'ifid = "STORY-ID"',
			'name = "Story"',
			'start_passage = "passage-id"',
			'[[stories.passages]]',
			'id = "passage-id"',
			'name = "Start"',
			'file = "passages/story/001-start.twee"'
		].join('\n');
		const manifestFile = {
			fingerprint: '1:100',
			kind: 'manifest' as const,
			modifiedAt: '2026-06-21T16:00:00.000Z',
			mtimeMs: 1,
			path: 'twine.toml',
			sizeBytes: 100
		};
		const passageFile = {
			fingerprint: '1:4',
			kind: 'passage' as const,
			modifiedAt: '2026-06-21T16:00:00.000Z',
			mtimeMs: 1,
			path: 'passages/story/001-start.twee',
			sizeBytes: 4
		};
		const firstChange = {
			...passageFile,
			fingerprint: '2:9',
			modifiedAt: '2026-06-21T16:00:01.000Z',
			mtimeMs: 2,
			sizeBytes: 9
		};
		const secondChange = {
			...firstChange,
			fingerprint: '3:10',
			modifiedAt: '2026-06-21T16:00:02.000Z',
			mtimeMs: 3,
			sizeBytes: 10
		};
		const listener = jest.fn();

		readFileMock.mockImplementation(async path =>
			String(path).endsWith('twine.toml') ? manifestSource : 'from disk'
		);
		listNativeProjectAssetsMock.mockReturnValue([]);
		nativeProjectFileManifestMock
			.mockReturnValueOnce([manifestFile, passageFile])
			.mockReturnValueOnce([manifestFile, firstChange])
			.mockReturnValueOnce([manifestFile, secondChange]);

		try {
			await startProjectSession('/native/leased.twine.rs', listener, [
				'story-id'
			]);
			await jest.advanceTimersByTimeAsync(1250);
			const firstDelta = listener.mock.calls[0][0];

			expect(firstDelta).toEqual(
				expect.objectContaining({
					baseGeneration: 1,
					candidateGeneration: 2
				})
			);
			await jest.advanceTimersByTimeAsync(1250);
			expect(listener).toHaveBeenCalledTimes(1);
			expect(nativeProjectFileManifestMock).toHaveBeenCalledTimes(2);

			const accepted = await resolveProjectSessionConflicts(
				'/native/leased.twine.rs',
				'acceptDisk',
				[],
				firstDelta.id
			);

			expect(accepted.generation).toBe(2);
			await jest.advanceTimersByTimeAsync(1);
			expect(listener).toHaveBeenCalledTimes(2);
			expect(listener.mock.calls[1][0]).toEqual(
				expect.objectContaining({
					baseGeneration: 2,
					candidateGeneration: 3
				})
			);
			expect(nativeProjectFileManifestMock).toHaveBeenCalledTimes(3);

			await expect(
				resolveProjectSessionConflicts(
					'/native/leased.twine.rs',
					'acceptDisk',
					[],
					firstDelta.id
				)
			).resolves.toEqual(accepted);
			await expect(
				resolveProjectSessionConflicts(
					'/native/leased.twine.rs',
					'dismiss',
					[],
					firstDelta.id
				)
			).rejects.toThrow('already resolved as "acceptDisk"');
		} finally {
			stopProjectSession('/native/leased.twine.rs');
			jest.useRealTimers();
		}
	});

	it('defers an unchanged candidate and replaces it only after disk changes', async () => {
		jest.useFakeTimers();
		const manifestSource = [
			'schema_version = 1',
			'name = "Project"',
			'[[stories]]',
			'id = "story-id"',
			'ifid = "STORY-ID"',
			'name = "Story"',
			'start_passage = "passage-id"',
			'[[stories.passages]]',
			'id = "passage-id"',
			'name = "Start"',
			'file = "passages/story/001-start.twee"'
		].join('\n');
		const manifestFile = {
			fingerprint: '1:100',
			kind: 'manifest' as const,
			modifiedAt: '2026-06-21T16:00:00.000Z',
			mtimeMs: 1,
			path: 'twine.toml',
			sizeBytes: 100
		};
		const passageFile = {
			fingerprint: '1:4',
			kind: 'passage' as const,
			modifiedAt: '2026-06-21T16:00:00.000Z',
			mtimeMs: 1,
			path: 'passages/story/001-start.twee',
			sizeBytes: 4
		};
		const firstChange = {
			...passageFile,
			fingerprint: '2:9',
			modifiedAt: '2026-06-21T16:00:01.000Z',
			mtimeMs: 2,
			sizeBytes: 9
		};
		const secondChange = {
			...firstChange,
			fingerprint: '3:10',
			modifiedAt: '2026-06-21T16:00:02.000Z',
			mtimeMs: 3,
			sizeBytes: 10
		};
		const listener = jest.fn();
		let passageReads = 0;

		readFileMock.mockImplementation(async path => {
			if (String(path).endsWith('twine.toml')) {
				return manifestSource;
			}

			passageReads++;
			return passageReads < 3 ? 'first disk text' : 'second disk text';
		});
		listNativeProjectAssetsMock.mockReturnValue([]);
		nativeProjectFileManifestMock
			.mockReturnValueOnce([manifestFile, passageFile])
			.mockReturnValueOnce([manifestFile, firstChange])
			.mockReturnValueOnce([manifestFile, firstChange])
			.mockReturnValueOnce([manifestFile, secondChange])
			.mockReturnValueOnce([manifestFile, passageFile])
			.mockReturnValueOnce([manifestFile, firstChange]);

		try {
			await startProjectSession('/native/deferred.twine.rs', listener, [
				'story-id'
			]);
			await jest.advanceTimersByTimeAsync(1250);
			const firstDelta = listener.mock.calls[0][0];

			const dismissed = await resolveProjectSessionConflicts(
				'/native/deferred.twine.rs',
				'dismiss',
				[],
				firstDelta.id
			);

			expect(dismissed.generation).toBe(1);
			await jest.advanceTimersByTimeAsync(1250);
			expect(listener).toHaveBeenCalledTimes(1);

			await jest.advanceTimersByTimeAsync(1250);
			expect(listener).toHaveBeenCalledTimes(2);
			expect(listener.mock.calls[1][0]).toEqual(
				expect.objectContaining({
					baseGeneration: 1,
					candidateGeneration: 2
				})
			);
			expect(listener.mock.calls[1][0].id).not.toBe(firstDelta.id);

			await resolveProjectSessionConflicts(
				'/native/deferred.twine.rs',
				'dismiss',
				[],
				listener.mock.calls[1][0].id
			);
			await jest.advanceTimersByTimeAsync(1250);
			expect(listener).toHaveBeenCalledTimes(2);

			await jest.advanceTimersByTimeAsync(1250);
			expect(listener).toHaveBeenCalledTimes(3);
		} finally {
			stopProjectSession('/native/deferred.twine.rs');
			jest.useRealTimers();
		}
	});

	it('emits asset-only deltas without parsing story sources', async () => {
		jest.useFakeTimers();
		const manifestSource = [
			'schema_version = 1',
			'name = "Project"',
			'[[stories]]',
			'id = "story-id"',
			'ifid = "STORY-ID"',
			'name = "Story"'
		].join('\n');
		const manifestFile = {
			fingerprint: '1:100',
			kind: 'manifest' as const,
			modifiedAt: '2026-06-21T16:00:00.000Z',
			mtimeMs: 1,
			path: 'twine.toml',
			sizeBytes: 100
		};
		const assetFile = {
			fingerprint: '1:4',
			kind: 'asset' as const,
			modifiedAt: '2026-06-21T16:00:00.000Z',
			mtimeMs: 1,
			path: 'assets/cover.png',
			sizeBytes: 4
		};
		const changedAssetFile = {
			...assetFile,
			fingerprint: '2:9',
			modifiedAt: '2026-06-21T16:00:01.000Z',
			mtimeMs: 2,
			sizeBytes: 9
		};
		const inventory = {
			durationMs: null,
			exists: true,
			height: null,
			kind: 'image',
			missing: false,
			modifiedAt: assetFile.modifiedAt,
			normalizedPath: assetFile.path,
			path: assetFile.path,
			previewUrl: null,
			publish: {copy: true, outputPath: assetFile.path, reason: 'Copy asset'},
			referenceCount: 0,
			references: [],
			sizeBytes: assetFile.sizeBytes,
			snippet: {label: 'cover.png', mediaType: 'image/png', text: ''},
			thumbnailUrl: null,
			unused: true,
			width: null
		};
		const listener = jest.fn();

		readFileMock.mockImplementation(async path =>
			String(path).endsWith('twine.toml') ? manifestSource : 'unexpected'
		);
		listNativeProjectAssetsMock.mockReturnValue([inventory]);
		nativeProjectFileManifestMock
			.mockReturnValueOnce([manifestFile, assetFile])
			.mockReturnValueOnce([manifestFile, changedAssetFile]);

		try {
			await startProjectSession('/native/project.twine.rs', listener, [
				'story-id'
			]);
			readFileMock.mockClear();
			await jest.advanceTimersByTimeAsync(1250);

			expect(listener).toHaveBeenCalledWith(
				expect.objectContaining({
					changedPaths: ['assets/cover.png'],
					delta: expect.objectContaining({
						changes: [
							expect.objectContaining({
								asset: expect.objectContaining({path: 'assets/cover.png'}),
								type: 'upsertAsset'
							})
						]
					})
				})
			);
			expect(readFileMock).not.toHaveBeenCalled();
		} finally {
			stopProjectSession('/native/project.twine.rs');
			jest.useRealTimers();
		}
	});

	it('renames, replaces, and deletes native project asset files safely', async () => {
		let heroExists = false;

		readFileMock.mockImplementation(async path => {
			if (String(path).endsWith('assets/hero.png') && !heroExists) {
				throw Object.assign(new Error('missing'), {code: 'ENOENT'});
			}
			return String(path);
		});
		moveMock.mockImplementation(async () => {
			heroExists = true;
		});
		await expect(
			renameProjectAsset(
				'/native/project.twine.rs',
				'assets/cover.png',
				'assets/hero.png'
			)
		).resolves.toEqual({
			effectToken: expect.any(String),
			sourcePath: '/native/project.twine.rs/assets/hero.png',
			targetPath: 'assets/hero.png'
		});
		expect(mkdirpMock).toHaveBeenCalledWith('/native/project.twine.rs/assets');
		expect(moveMock).toHaveBeenCalledWith(
			'/native/project.twine.rs/assets/cover.png',
			'/native/project.twine.rs/assets/hero.png'
		);

		await expect(
			replaceProjectAsset(
				'/native/project.twine.rs',
				'assets/hero.png',
				'/tmp/new-hero.png'
			)
		).resolves.toEqual({
			effectToken: expect.any(String),
			sourcePath: '/native/project.twine.rs/assets/hero.png',
			targetPath: 'assets/hero.png'
		});
		expect(copyMock).toHaveBeenCalledWith(
			'/tmp/new-hero.png',
			'/native/project.twine.rs/assets/hero.png',
			{overwrite: true}
		);

		await deleteProjectAsset('/native/project.twine.rs', 'assets/hero.png');
		expect(removeMock).toHaveBeenCalledWith(
			'/native/project.twine.rs/assets/hero.png'
		);
	});

	it('undoes and redoes journaled asset imports with fingerprint checks', async () => {
		const fingerprint = createHash('sha256')
			.update('asset bytes')
			.digest('hex');
		let exists = true;

		readJsonMock.mockResolvedValue({
			afterFingerprint: fingerprint,
			kind: 'import',
			rootPath: '/native/project.twine.rs',
			targetPath: 'assets/cover.png',
			token: 'effect-1'
		});
		readFileMock.mockImplementation(async path => {
			if (String(path).endsWith('assets/cover.png')) {
				if (!exists) {
					throw Object.assign(new Error('missing'), {code: 'ENOENT'});
				}
				return 'asset bytes';
			}
			return 'asset bytes';
		});
		removeMock.mockImplementation(async path => {
			if (String(path).endsWith('assets/cover.png')) {
				exists = false;
			}
		});
		copyMock.mockImplementation(async (_source, destination) => {
			if (String(destination).endsWith('assets/cover.png')) {
				exists = true;
			}
		});

		await applyProjectAssetEffect('effect-1', 'undo');
		expect(removeMock).toHaveBeenCalledWith(
			'/native/project.twine.rs/assets/cover.png'
		);

		await applyProjectAssetEffect('effect-1', 'redo');
		expect(copyMock).toHaveBeenCalledWith(
			expect.stringContaining('effect-1/after.bin'),
			'/native/project.twine.rs/assets/cover.png',
			{overwrite: true}
		);
	});

	it('stops asset undo when the journaled file was externally modified', async () => {
		readJsonMock.mockResolvedValue({
			afterFingerprint: 'expected',
			kind: 'replace',
			rootPath: '/native/project.twine.rs',
			targetPath: 'assets/cover.png',
			token: 'effect-2'
		});
		readFileMock.mockResolvedValue('externally modified');

		await expect(applyProjectAssetEffect('effect-2', 'undo')).rejects.toThrow(
			'changed outside Twine'
		);
		expect(removeMock).not.toHaveBeenCalledWith(
			'/native/project.twine.rs/assets/cover.png'
		);
	});

	it('discards evicted asset effect journals', async () => {
		await discardProjectAssetEffect('effect-3');

		expect(removeMock).toHaveBeenCalledWith(
			expect.stringContaining('effect-3')
		);
	});

	it('cleans stale crash journals at startup', async () => {
		await cleanupStaleProjectAssetEffects();

		expect(removeMock).toHaveBeenCalledWith(
			'mock-story-library/.twine-rs-asset-journal'
		);
	});

	it('deletes validated native project folders', async () => {
		await deleteProjectFolder('/native/project.twine.rs');

		expect(shell.trashItem).toHaveBeenCalledWith('/native/project.twine.rs');
		expect(removeMock).not.toHaveBeenCalledWith('/native/project.twine.rs');
	});

	it('refuses to delete folders that are not native project folders', async () => {
		statMock.mockResolvedValue({
			isDirectory: () => true,
			isFile: () => false,
			mtime: new Date('2026-06-21T16:00:00.000Z'),
			mtimeMs: 1,
			size: 0
		});

		await expect(deleteProjectFolder('/native/not-a-project')).rejects.toThrow(
			'must end with .twine.rs'
		);
		expect(shell.trashItem).not.toHaveBeenCalled();
		expect(removeMock).not.toHaveBeenCalled();
	});

	it('refuses to delete project folders without a manifest', async () => {
		statMock.mockImplementation(async path => {
			if (String(path) === '/native/project.twine.rs') {
				return {
					isDirectory: () => true,
					isFile: () => false,
					mtime: new Date('2026-06-21T16:00:00.000Z'),
					mtimeMs: 1,
					size: 0
				};
			}

			throw Object.assign(new Error('missing'), {code: 'ENOENT'});
		});

		await expect(
			deleteProjectFolder('/native/project.twine.rs')
		).rejects.toThrow('no twine.toml project manifest was found');
		expect(shell.trashItem).not.toHaveBeenCalled();
		expect(removeMock).not.toHaveBeenCalled();
	});

	it('rejects unsafe native project asset paths', async () => {
		await expect(
			deleteProjectAsset('/native/project.twine.rs', '../outside.png')
		).rejects.toThrow('Unsafe project asset path');
	});
});
