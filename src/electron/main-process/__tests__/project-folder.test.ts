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
import {fakeStory} from '../../../test-util';
import {
	chooseAssetFile,
	copyAssetToProject,
	createProjectFolder,
	deleteProjectAsset,
	listProjectAssets,
	openProjectFolder,
	projectSessionSnapshot,
	renameProjectAsset,
	replaceProjectAsset,
	saveProjectFolder,
	stopProjectSession
} from '../project-folder';

jest.mock('electron');
jest.mock('fs-extra');
jest.mock('../story-directory', () => ({
	getStoryDirectoryPath: () => 'mock-story-library'
}));

describe('project-folder native bridge', () => {
	const mkdirpMock = mkdirp as jest.Mock;
	const copyMock = copy as jest.Mock;
	const moveMock = move as jest.Mock;
	const readFileMock = readFile as jest.Mock;
	const readJsonMock = readJson as jest.Mock;
	const readdirMock = readdir as jest.Mock;
	const removeMock = remove as jest.Mock;
	const createFromPathMock = nativeImage.createFromPath as jest.Mock;
	const showOpenDialogMock = dialog.showOpenDialog as jest.Mock;
	const statMock = stat as jest.Mock;
	const writeFileMock = writeFile as jest.Mock;
	const writeJsonMock = writeJson as jest.Mock;

	beforeEach(() => {
		jest.clearAllMocks();
		writeFileMock.mockResolvedValue(undefined);
		writeJsonMock.mockResolvedValue(undefined);
		copyMock.mockResolvedValue(undefined);
		moveMock.mockResolvedValue(undefined);
		removeMock.mockResolvedValue(undefined);
		mkdirpMock.mockResolvedValue(undefined);
		readFileMock.mockResolvedValue('');
		createFromPathMock.mockReturnValue({
			getSize: () => ({height: 480, width: 640})
		});
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

		expect(result.rootPath).toBe('mock-story-library/Projects/moon-castle.twine.rs');
		expect(mkdirpMock).toHaveBeenCalledWith(
			'mock-story-library/Projects/moon-castle.twine.rs/assets'
		);
		expect(writeFileMock).toHaveBeenCalledWith(
			'mock-story-library/Projects/moon-castle.twine.rs/twine.toml',
			expect.stringContaining('Native twine.rs desktop project folder'),
			'utf8'
		);
		expect(writeJsonMock).toHaveBeenCalledWith(
			'mock-story-library/Projects/moon-castle.twine.rs/.twine/project.json',
			expect.objectContaining({
				schema: 'twine.rs/renderer-project',
				stories: [story]
			})
		);
	});

	it('saves an existing native project folder in place', async () => {
		const story = {
			...fakeStory(1),
			id: 'story-id',
			name: 'Moon Castle'
		};

		const result = await saveProjectFolder('/native/moon-castle.twine.rs', story);

		expect(result.rootPath).toBe('/native/moon-castle.twine.rs');
		expect(writeJsonMock).toHaveBeenCalledWith(
			'/native/moon-castle.twine.rs/.twine/project.json',
			expect.objectContaining({
				schema: 'twine.rs/renderer-project',
				stories: [story]
			})
		);
		expect(writeFileMock).toHaveBeenCalledWith(
			'/native/moon-castle.twine.rs/twine.toml',
			expect.stringContaining('Moon Castle'),
			'utf8'
		);
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
				return {passages: {start: {height: 144, left: 22, top: 33, width: 155}}};
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
		await expect(
			copyAssetToProject('/native/project.twine.rs', '/tmp/cover.png')
		).resolves.toEqual({
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

		await expect(listProjectAssets('/native/project.twine.rs')).resolves.toEqual([
			expect.objectContaining({
				height: null,
				kind: 'audio',
				path: 'assets/audio/theme.mp3',
				sizeBytes: 4096,
				thumbnailUrl: null,
				width: null
			}),
			expect.objectContaining({
				height: 480,
				kind: 'image',
				modifiedAt: '2026-06-21T16:00:00.000Z',
				path: 'assets/cover.png',
				sizeBytes: 2048,
				thumbnailUrl: 'file:///native/project.twine.rs/assets/cover.png',
				width: 640
			})
		]);
	});

	it('returns an empty asset inventory when the project assets folder is absent', async () => {
		readdirMock.mockRejectedValue(Object.assign(new Error('missing'), {
			code: 'ENOENT'
		}));

		await expect(listProjectAssets('/native/project.twine.rs')).resolves.toEqual(
			[]
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
		readdirMock.mockRejectedValue(Object.assign(new Error('missing'), {
			code: 'ENOENT'
		}));
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
		await expect(
			renameProjectAsset(
				'/native/project.twine.rs',
				'assets/cover.png',
				'assets/hero.png'
			)
		).resolves.toEqual({
			sourcePath: '/native/project.twine.rs/assets/hero.png',
			targetPath: 'assets/hero.png'
		});
		expect(mkdirpMock).toHaveBeenCalledWith('/native/project.twine.rs/assets');
		expect(moveMock).toHaveBeenCalledWith(
			'/native/project.twine.rs/assets/cover.png',
			'/native/project.twine.rs/assets/hero.png',
			{overwrite: true}
		);

		await expect(
			replaceProjectAsset(
				'/native/project.twine.rs',
				'assets/hero.png',
				'/tmp/new-hero.png'
			)
		).resolves.toEqual({
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

	it('rejects unsafe native project asset paths', async () => {
		await expect(
			deleteProjectAsset('/native/project.twine.rs', '../outside.png')
		).rejects.toThrow('Unsafe project asset path');
	});
});
