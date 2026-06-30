import {dialog} from 'electron';
import {createHash} from 'crypto';
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
	cleanupStaleProjectAssetEffects,
	copyProjectImportAssets,
	copyAssetToProject,
	createProjectFolder,
	deleteProjectAsset,
	deleteProjectFolder,
	discardProjectAssetEffect,
	discardProjectImport,
	hydrateProjectFolder,
	listProjectAssets,
	openProjectFolder,
	prepareProjectImport,
	projectSessionSnapshot,
	renameProjectAsset,
	replaceProjectAsset,
	saveProjectFolder,
	startProjectSession,
	stopProjectSession
} from '../project-folder';
import {
	diffNativeProjectFileManifest,
	findNativeTwineHtmlFiles,
	forgetNativeProjectFolder,
	listNativeProjectAssets,
	listRememberedNativeProjectFolders,
	loadNativeProjectFolder,
	nativeProjectDiagnostic,
	nativeProjectFileManifest,
	prepareNativeHtmlImport,
	prepareNativeProjectImport,
	rememberNativeProjectFolder,
	saveNativeProjectFolder
} from '../native';

jest.mock('electron');
jest.mock('extract-zip', () => jest.fn());
jest.mock('fs-extra');
jest.mock('../native', () => ({
	diffNativeProjectFileManifest: jest.fn(),
	findNativeTwineHtmlFiles: jest.fn(),
	forgetNativeProjectFolder: jest.fn(),
	listNativeProjectAssets: jest.fn(),
	listRememberedNativeProjectFolders: jest.fn(),
	loadNativeProjectFolder: jest.fn(),
	nativeProjectDiagnostic: jest.fn(),
	nativeProjectFileManifest: jest.fn(),
	prepareNativeHtmlImport: jest.fn(),
	prepareNativeProjectImport: jest.fn(),
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
	const writeFileMock = writeFile as jest.Mock;
	const diffNativeProjectFileManifestMock =
		diffNativeProjectFileManifest as jest.Mock;
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
			story
		);
		expect(writeFileMock).not.toHaveBeenCalled();
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

	it('reuses the opened asset inventory for the session baseline', async () => {
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
		).toHaveLength(1);
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

	it('can open a project folder shell without reading passage body files', async () => {
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
				height: 144,
				left: 22,
				text: '',
				top: 33,
				width: 155
			})
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

		expect(removeMock).toHaveBeenCalledWith('/native/project.twine.rs');
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
		expect(removeMock).not.toHaveBeenCalled();
	});

	it('rejects unsafe native project asset paths', async () => {
		await expect(
			deleteProjectAsset('/native/project.twine.rs', '../outside.png')
		).rejects.toThrow('Unsafe project asset path');
	});
});
