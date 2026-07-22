import {dialog, shell} from 'electron';
import {createHash} from 'crypto';
import {FSWatcher, watch} from 'fs';
import {lstat, open as openFile, opendir, realpath} from 'fs/promises';
import {performance} from 'perf_hooks';
import {setImmediate} from 'timers';
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
import extractZip from 'extract-zip';
import {EventEmitter} from 'events';
import {open as openZip} from 'yauzl';
import * as assetPaths from '../../../core/asset-paths';
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
	projectSessionAssetReadBaselines,
	projectSessionScratchAssets,
	projectSessionMemoryDiagnostics,
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
	captureNativeProjectAssetDigests,
	createNativeProjectFolder,
	diffNativeProjectFileManifest,
	findNativeTwineHtmlFiles,
	finishNativeProjectFolderHydration,
	forgetNativeProjectFolder,
	listNativeProjectAssets,
	listRememberedNativeProjectFolders,
	loadNativeProjectFolder,
	nativeAssetReadBusy,
	nativeProjectAssetDigestCaptureAvailable,
	nativeProjectDiagnostic,
	nativeProjectFileManifest,
	prepareNativeHtmlImport,
	prepareNativeProjectImport,
	readNativeProjectFolderHydrationChunk,
	rememberNativeProjectFolder,
	saveNativeProjectFolder
} from '../native';
import {performanceHarnessEnabled} from '../performance-harness';
import {
	maxImportSourceBytes,
	maxImportZipEntryBytes
} from '../../../util/import-limits';

jest.mock('electron');
jest.mock('extract-zip', () => jest.fn());
jest.mock('fs', () => ({...jest.requireActual('fs'), watch: jest.fn()}));
jest.mock('fs/promises', () => ({
	lstat: jest.fn(),
	open: jest.fn(),
	opendir: jest.fn(),
	realpath: jest.fn()
}));
jest.mock('fs-extra');
jest.mock('yauzl', () => ({open: jest.fn()}));
jest.mock('../native', () => ({
	beginNativeProjectFolderHydration: jest.fn(),
	captureNativeProjectAssetDigests: jest.fn(),
	createNativeProjectFolder: jest.fn(),
	diffNativeProjectFileManifest: jest.fn(),
	findNativeTwineHtmlFiles: jest.fn(),
	finishNativeProjectFolderHydration: jest.fn(),
	forgetNativeProjectFolder: jest.fn(),
	listNativeProjectAssets: jest.fn(),
	listRememberedNativeProjectFolders: jest.fn(),
	loadNativeProjectFolder: jest.fn(),
	nativeAssetReadBusy: jest.fn(
		(error: unknown) =>
			typeof error === 'object' &&
			error !== null &&
			'code' in error &&
			error.code === 'NATIVE_ASSET_READER_BUSY'
	),
	nativeProjectAssetDigestCaptureAvailable: jest.fn(() => false),
	nativeProjectDiagnostic: jest.fn(),
	nativeProjectFileManifest: jest.fn(),
	prepareNativeHtmlImport: jest.fn(),
	prepareNativeProjectImport: jest.fn(),
	readNativeProjectFolderHydrationChunk: jest.fn(),
	rememberNativeProjectFolder: jest.fn(),
	saveNativeProjectFolder: jest.fn()
}));
jest.mock('../performance-harness', () => ({
	...jest.requireActual('../performance-harness'),
	performanceHarnessEnabled: jest.fn(() => false)
}));
jest.mock('../story-directory', () => ({
	getStoryDirectoryPath: () => 'mock-story-library'
}));

describe('project-folder native bridge', () => {
	const mkdirpMock = mkdirp as jest.Mock;
	const mkdirMock = mkdir as jest.Mock;
	const mkdtempMock = mkdtemp as jest.Mock;
	const copyMock = copy as jest.Mock;
	const lstatMock = lstat as jest.Mock;
	const extractZipMock = extractZip as jest.Mock;
	const openFileMock = openFile as jest.Mock;
	const opendirMock = opendir as jest.Mock;
	const openZipMock = openZip as unknown as jest.Mock;
	const moveMock = move as jest.Mock;
	const readFileMock = readFile as jest.Mock;
	const readJsonMock = readJson as jest.Mock;
	const readdirMock = readdir as jest.Mock;
	const realpathMock = realpath as jest.Mock;
	const removeMock = remove as jest.Mock;
	const showOpenDialogMock = dialog.showOpenDialog as jest.Mock;
	const statMock = stat as jest.Mock;
	const watchMock = watch as jest.Mock;
	const writeFileMock = writeFile as jest.Mock;
	const diffNativeProjectFileManifestMock =
		diffNativeProjectFileManifest as jest.Mock;
	const beginNativeProjectFolderHydrationMock =
		beginNativeProjectFolderHydration as jest.Mock;
	const captureNativeProjectAssetDigestsMock =
		captureNativeProjectAssetDigests as jest.Mock;
	const createNativeProjectFolderMock = createNativeProjectFolder as jest.Mock;
	const finishNativeProjectFolderHydrationMock =
		finishNativeProjectFolderHydration as jest.Mock;
	const findNativeTwineHtmlFilesMock = findNativeTwineHtmlFiles as jest.Mock;
	const forgetNativeProjectFolderMock = forgetNativeProjectFolder as jest.Mock;
	const listNativeProjectAssetsMock = listNativeProjectAssets as jest.Mock;
	const listRememberedNativeProjectFoldersMock =
		listRememberedNativeProjectFolders as jest.Mock;
	const loadNativeProjectFolderMock = loadNativeProjectFolder as jest.Mock;
	const nativeProjectAssetDigestCaptureAvailableMock =
		nativeProjectAssetDigestCaptureAvailable as jest.Mock;
	const nativeAssetReadBusyMock = nativeAssetReadBusy as jest.Mock;
	const nativeProjectDiagnosticMock = nativeProjectDiagnostic as jest.Mock;
	const nativeProjectFileManifestMock = nativeProjectFileManifest as jest.Mock;
	const performanceHarnessEnabledMock = performanceHarnessEnabled as jest.Mock;
	const prepareNativeHtmlImportMock = prepareNativeHtmlImport as jest.Mock;
	const prepareNativeProjectImportMock =
		prepareNativeProjectImport as jest.Mock;
	const readNativeProjectFolderHydrationChunkMock =
		readNativeProjectFolderHydrationChunk as jest.Mock;
	const rememberNativeProjectFolderMock =
		rememberNativeProjectFolder as jest.Mock;
	const saveNativeProjectFolderMock = saveNativeProjectFolder as jest.Mock;

	function mockZipEntries(entries: any[], entryCount = entries.length) {
		openZipMock.mockImplementation(
			(_path, _options, callback: (error: null, archive: any) => void) => {
				const archive = new EventEmitter() as EventEmitter & {
					close: jest.Mock;
					entryCount: number;
					readEntry: jest.Mock;
				};
				let index = 0;

				archive.close = jest.fn();
				archive.entryCount = entryCount;
				archive.readEntry = jest.fn(() =>
					queueMicrotask(() => {
						if (index < entries.length) {
							archive.emit('entry', entries[index++]);
						} else {
							archive.emit('end');
						}
					})
				);
				callback(null, archive);
			}
		);
	}

	beforeEach(() => {
		jest.clearAllMocks();
		performanceHarnessEnabledMock.mockReturnValue(false);
		writeFileMock.mockResolvedValue(undefined);
		copyMock.mockResolvedValue(undefined);
		extractZipMock.mockResolvedValue(undefined);
		opendirMock.mockImplementation(async path => {
			const names = await readdirMock(path);

			return {
				close: jest.fn(async () => undefined),
				async *[Symbol.asyncIterator]() {
					for (const name of names) {
						yield {name};
					}
				}
			};
		});
		openFileMock.mockImplementation(async (path, flags) => {
			if (flags === 'wx') {
				return {
					close: jest.fn(async () => undefined),
					write: jest.fn(async (_buffer, _offset, length) => ({
						bytesWritten: length
					}))
				};
			}
			const value = await readFileMock(path, 'utf8');
			const source = Buffer.isBuffer(value)
				? value
				: Buffer.from(String(value));
			let offset = 0;

			return {
				close: jest.fn(async () => undefined),
				read: jest.fn(
					async (buffer: Buffer, bufferOffset = 0, length = buffer.length) => {
						const bytesRead = source.copy(
							buffer,
							bufferOffset,
							offset,
							Math.min(source.length, offset + length)
						);

						offset += bytesRead;
						return {buffer, bytesRead};
					}
				),
				stat: jest.fn(async () => ({
					isFile: () => true,
					size: source.length
				}))
			};
		});
		openZipMock.mockImplementation(
			(_path, _options, callback: (error: null, archive: any) => void) => {
				const archive = new EventEmitter() as EventEmitter & {
					close: jest.Mock;
					entryCount: number;
					readEntry: jest.Mock;
				};

				archive.close = jest.fn();
				archive.entryCount = 0;
				archive.readEntry = jest.fn(() =>
					queueMicrotask(() => archive.emit('end'))
				);
				callback(null, archive);
			}
		);
		mkdtempMock.mockResolvedValue('/tmp/twine-import-abc');
		moveMock.mockResolvedValue(undefined);
		removeMock.mockResolvedValue(undefined);
		mkdirMock.mockResolvedValue(undefined);
		mkdirpMock.mockResolvedValue(undefined);
		readFileMock.mockResolvedValue('');
		readJsonMock.mockResolvedValue({});
		diffNativeProjectFileManifestMock.mockReturnValue(undefined);
		findNativeTwineHtmlFilesMock.mockReturnValue(undefined);
		forgetNativeProjectFolderMock.mockReturnValue(undefined);
		listNativeProjectAssetsMock.mockReturnValue(undefined);
		listRememberedNativeProjectFoldersMock.mockReturnValue([]);
		loadNativeProjectFolderMock.mockReturnValue(undefined);
		nativeProjectAssetDigestCaptureAvailableMock.mockReturnValue(false);
		nativeAssetReadBusyMock.mockImplementation(
			(error: unknown) =>
				typeof error === 'object' &&
				error !== null &&
				'code' in error &&
				error.code === 'NATIVE_ASSET_READER_BUSY'
		);
		captureNativeProjectAssetDigestsMock.mockResolvedValue({
			digests: [],
			failures: [],
			totalSourceBytes: 0
		});
		createNativeProjectFolderMock.mockReturnValue(undefined);
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
		realpathMock.mockImplementation(async path => String(path));
		statMock.mockImplementation(async path => ({
			isDirectory: () => String(path).endsWith('.twine.rs'),
			isFile: () => !String(path).endsWith('.twine.rs'),
			mtime: new Date('2026-06-21T16:00:00.000Z'),
			mtimeMs: 1,
			size: 0
		}));
		lstatMock.mockImplementation(async path => ({
			...(await statMock(path)),
			isSymbolicLink: () => false
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
		expect(createNativeProjectFolderMock).toHaveBeenCalledWith(
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
		readFileMock.mockImplementation(async path =>
			String(path).endsWith('twine.toml')
				? [
						'schema_version = 1',
						'[[stories]]',
						'id = "story-id"',
						'name = "Moon Castle"',
						'[[stories.passages]]',
						`id = "${story.passages[0].id}"`,
						'file = "passages/moon-castle/0001-start.twee"'
					].join('\n')
				: ''
		);

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

	it('preserves a complete multi-story native save result and session baseline', async () => {
		const rootPath = '/native/project.twine.rs';
		const firstOriginal = fakeStory(1);
		const secondOriginal = fakeStory(1);
		const firstStory = {
			...firstOriginal,
			id: 'story-one',
			name: 'Story One',
			passages: firstOriginal.passages.map(passage => ({
				...passage,
				id: 'passage-one',
				story: 'story-one',
				text: '<img src="assets/one.png">'
			}))
		};
		const secondStory = {
			...secondOriginal,
			id: 'story-two',
			name: 'Story Two',
			passages: secondOriginal.passages.map(passage => ({
				...passage,
				id: 'passage-two',
				story: 'story-two',
				text: '<img src="assets/two.png">'
			}))
		};
		const storyIds = [firstStory.id, secondStory.id];
		const stories = [firstStory, secondStory];
		const manifestSource = [
			'schema_version = 1',
			'name = "Project"',
			'[[stories]]',
			'id = "story-one"',
			'name = "Story One"',
			'[[stories.passages]]',
			'id = "passage-one"',
			'name = "Start One"',
			'file = "passages/story-one/0001-start-one.twee"',
			'[[stories]]',
			'id = "story-two"',
			'name = "Story Two"',
			'[[stories.passages]]',
			'id = "passage-two"',
			'name = "Start Two"',
			'file = "passages/story-two/0001-start-two.twee"'
		].join('\n');
		const files = [
			{
				fingerprint: '1:1',
				kind: 'manifest' as const,
				modifiedAt: '2026-06-21T16:00:00.000Z',
				mtimeMs: 1,
				path: 'twine.toml',
				sizeBytes: 1
			},
			...['assets/one.png', 'assets/two.png'].map(path => ({
				fingerprint: '1:3',
				kind: 'asset' as const,
				modifiedAt: '2026-06-21T16:00:00.000Z',
				mtimeMs: 1,
				path,
				sizeBytes: 3
			}))
		];
		const nativeResult = {
			passageTextLoaded: true,
			rootPath,
			stories,
			storyIds
		};

		readFileMock.mockImplementation(async path =>
			String(path).endsWith('twine.toml') ? manifestSource : ''
		);
		listNativeProjectAssetsMock.mockReturnValue([]);
		nativeProjectFileManifestMock.mockReturnValue(files);
		await startProjectSession(rootPath, undefined, [firstStory.id]);
		nativeProjectAssetDigestCaptureAvailableMock.mockReturnValue(true);
		captureNativeProjectAssetDigestsMock.mockImplementation(
			async (_rootPath, requests) => ({
				digests: requests.map((request: {path: string}) => ({
					contentDigest: request.path.includes('one')
						? '1'.repeat(64)
						: '2'.repeat(64),
					path: request.path
				})),
				failures: [],
				totalSourceBytes: requests.length * 3
			})
		);
		saveNativeProjectFolderMock.mockReturnValue(nativeResult);

		const result = await saveProjectFolder(rootPath, firstStory);
		const snapshot = await projectSessionSnapshot(rootPath);

		expect(result).toEqual(nativeResult);
		expect(rememberNativeProjectFolderMock).toHaveBeenLastCalledWith(
			'mock-story-library/.twine/native-projects.json',
			nativeResult
		);
		expect(snapshot.storyIds).toEqual(storyIds);
		expect(captureNativeProjectAssetDigestsMock).toHaveBeenCalledWith(
			rootPath,
			[
				{
					expectedModifiedAtMs: 1,
					expectedSizeBytes: 3,
					path: 'assets/one.png'
				},
				{
					expectedModifiedAtMs: 1,
					expectedSizeBytes: 3,
					path: 'assets/two.png'
				}
			]
		);
		expect(
			projectSessionAssetReadBaselines(rootPath, [
				'assets/one.png',
				'assets/two.png'
			]).map(baseline => baseline.expectedContentDigest)
		).toEqual(['1'.repeat(64), '2'.repeat(64)]);
		expect(
			projectSessionScratchAssets(rootPath, [
				{outputPath: 'media/one.png', path: 'assets/one.png'}
			])
		).toEqual([
			{
				outputPath: 'media/one.png',
				path: 'assets/one.png'
			}
		]);
		expect(() =>
			projectSessionScratchAssets(rootPath, [
				{outputPath: 'stolen.txt', path: '/tmp/stolen.txt'}
			])
		).toThrow('is not indexed');
	});

	it('does not fall back after native save validation fails', async () => {
		const story = fakeStory(1);

		saveNativeProjectFolderMock.mockImplementation(() => {
			throw new Error('native rejected the project root');
		});

		await expect(
			saveProjectFolder('/native/moon-castle.twine.rs', story)
		).rejects.toThrow('native rejected the project root');
		expect(writeFileMock).not.toHaveBeenCalled();
		expect(mkdirpMock).not.toHaveBeenCalled();
	});

	it('does not fall back after native create validation fails', async () => {
		const story = {...fakeStory(1), name: 'Rejected Create'};

		createNativeProjectFolderMock.mockImplementation(() => {
			throw new Error('native rejected the create target');
		});

		await expect(createProjectFolder(story)).rejects.toThrow(
			'native rejected the create target'
		);
		expect(writeFileMock).not.toHaveBeenCalled();
		expect(mkdirpMock).not.toHaveBeenCalled();
	});

	it.each([
		['punctuation', 'A:B', 'A?B'],
		['case', 'Case:Collision', 'CASE?COLLISION'],
		['truncation', `${'a'.repeat(64)}-one`, `${'a'.repeat(64)}-two`]
	])(
		'propagates native %s slug collisions without using the fallback',
		async (_collision, firstName, secondName) => {
			const firstStory = {...fakeStory(1), id: 'first-story', name: firstName};
			const secondStory = {
				...fakeStory(1),
				id: 'second-story',
				name: secondName
			};
			const rejection = new Error(
				'A new project cannot replace an existing filesystem entry.'
			);
			let firstRootPath = '';

			createNativeProjectFolderMock
				.mockImplementationOnce((rootPath: string) => {
					firstRootPath = rootPath;

					return {
						passageTextLoaded: true,
						rootPath,
						stories: [firstStory],
						storyIds: [firstStory.id]
					};
				})
				.mockImplementationOnce(() => {
					throw rejection;
				});

			await createProjectFolder(firstStory);
			writeFileMock.mockClear();
			mkdirpMock.mockClear();

			await expect(createProjectFolder(secondStory)).rejects.toBe(rejection);

			expect(createNativeProjectFolderMock).toHaveBeenCalledTimes(2);
			expect(createNativeProjectFolderMock.mock.calls[0][0]).toBe(
				firstRootPath
			);
			expect(createNativeProjectFolderMock.mock.calls[1][0]).toBe(
				firstRootPath
			);
			expect(writeFileMock).not.toHaveBeenCalled();
			expect(mkdirpMock).not.toHaveBeenCalled();
			stopProjectSession(firstRootPath);
		}
	);

	it('validates the project manifest before using the save fallback', async () => {
		const story = fakeStory(1);

		readFileMock.mockImplementation(async path =>
			String(path).endsWith('twine.toml') ? 'schema_version = 99' : ''
		);

		await expect(
			saveProjectFolder('/native/moon-castle.twine.rs', story)
		).rejects.toThrow('Project schema 99');
		expect(writeFileMock).not.toHaveBeenCalled();
		expect(mkdirpMock).not.toHaveBeenCalled();
	});

	it('refuses a legacy multi-story save before mutating the project', async () => {
		const original = fakeStory(1);
		const story = {...original, id: 'story-one', name: 'Story One'};
		const manifestSource = [
			'schema_version = 1',
			'name = "Project"',
			'[[stories]]',
			'id = "story-one"',
			'name = "Story One"',
			'[[stories.passages]]',
			'id = "passage-one"',
			'name = "Start One"',
			'file = "passages/story-one/0001-start-one.twee"',
			'[[stories]]',
			'id = "story-two"',
			'name = "Story Two"',
			'[[stories.passages]]',
			'id = "passage-two"',
			'name = "Start Two"',
			'file = "passages/story-two/0001-start-two.twee"'
		].join('\n');

		readFileMock.mockImplementation(async path =>
			String(path).endsWith('twine.toml') ? manifestSource : ''
		);

		await expect(
			saveProjectFolder('/native/project.twine.rs', story)
		).rejects.toThrow(
			'Legacy project compatibility saving cannot safely update a multi-story project.'
		);
		expect(writeFileMock).not.toHaveBeenCalled();
		expect(moveMock).not.toHaveBeenCalled();
		expect(mkdirMock).not.toHaveBeenCalled();
		expect(mkdirpMock).not.toHaveBeenCalled();
	});

	it('atomically refuses to create over an existing path in the fallback', async () => {
		mkdirMock.mockRejectedValue(
			Object.assign(new Error('already exists'), {code: 'EEXIST'})
		);

		await expect(createProjectFolder(fakeStory(1))).rejects.toThrow(
			'cannot replace an existing filesystem entry'
		);
		expect(createNativeProjectFolderMock).toHaveBeenCalled();
		expect(writeFileMock).not.toHaveBeenCalled();
	});

	it('incrementally saves a passage text edit through the active project session', async () => {
		let passageSource = '<img src="assets/old.png">';
		const story = {
			...fakeStory(1),
			id: 'story-id',
			name: 'Story',
			passages: [
				{
					...fakeStory(1).passages[0],
					id: 'passage-id',
					name: 'Start',
					text: passageSource
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
		const assetFiles = ['assets/new.png', 'assets/old.png'].map(path => ({
			fingerprint: '1:3',
			kind: 'asset' as const,
			modifiedAt: '2026-06-21T16:00:00.000Z',
			mtimeMs: 1,
			path,
			sizeBytes: 3
		}));

		readFileMock.mockImplementation(async path =>
			String(path).endsWith('twine.toml') ? manifestSource : passageSource
		);
		listNativeProjectAssetsMock.mockReturnValue([]);
		nativeProjectAssetDigestCaptureAvailableMock.mockReturnValue(true);
		captureNativeProjectAssetDigestsMock.mockImplementation(
			async (_rootPath, requests) => ({
				digests: requests.map((request: {path: string}) => ({
					contentDigest: request.path.includes('new')
						? 'a'.repeat(64)
						: 'b'.repeat(64),
					path: request.path
				})),
				failures: [],
				totalSourceBytes: requests.length * 3
			})
		);
		nativeProjectFileManifestMock.mockReturnValue([
			manifestFile,
			passageFile,
			...assetFiles
		]);

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
					text: '<img src="assets/old.png"><img src="assets/new.png">',
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
			'<img src="assets/old.png"><img src="assets/new.png">',
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
		expect(captureNativeProjectAssetDigestsMock).toHaveBeenNthCalledWith(
			2,
			'/native/project.twine.rs',
			[
				{
					expectedModifiedAtMs: 1,
					expectedSizeBytes: 3,
					path: 'assets/new.png'
				}
			]
		);
		expect(
			projectSessionAssetReadBaselines('/native/project.twine.rs', [
				'assets/new.png',
				'assets/old.png'
			]).map(baseline => baseline.expectedContentDigest)
		).toEqual(['a'.repeat(64), 'b'.repeat(64)]);

		passageSource = '<img src="assets/old.png"><img src="assets/new.png">';
		await saveProjectFolder('/native/project.twine.rs', story, {
			documentUpdates: [
				{
					passageId: 'passage-id',
					storyId: 'story-id',
					text: '<img src="assets/new.png">',
					type: 'passageText'
				}
			],
			hints: [
				{passageId: 'passage-id', storyId: 'story-id', type: 'passageText'}
			]
		});

		expect(captureNativeProjectAssetDigestsMock).toHaveBeenCalledTimes(2);
		expect(
			projectSessionAssetReadBaselines('/native/project.twine.rs', [
				'assets/new.png',
				'assets/old.png'
			]).map(baseline => baseline.expectedContentDigest)
		).toEqual([undefined, undefined]);
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

		statMock.mockImplementation(async path => ({
			isDirectory: () => String(path) === '/native/project.twine.rs',
			isFile: () => String(path) !== '/native/project.twine.rs',
			mtime: new Date('2026-06-21T16:00:01.000Z'),
			mtimeMs: 2,
			size: 0
		}));
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
		let firstPassageSource = '<img src="assets/one.png">';
		const secondPassageSource = '<img src="assets/two.png">';
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
		const secondOriginal = fakeStory(1);
		const secondStory = {
			...secondOriginal,
			id: 'story-two',
			name: 'Story Two',
			passages: secondOriginal.passages.map(passage => ({
				...passage,
				id: 'passage-two',
				story: 'story-two',
				text: secondPassageSource
			}))
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
			'file = "passages/story/001-start.twee"',
			'[[stories]]',
			'id = "story-two"',
			'ifid = "STORY-TWO"',
			'name = "Story Two"',
			'start_passage = "passage-two"',
			'[[stories.passages]]',
			'id = "passage-two"',
			'name = "Second"',
			'file = "passages/story-two/001-second.twee"'
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
			},
			{
				fingerprint: '1:0',
				kind: 'passage' as const,
				modifiedAt: '2026-06-21T16:00:00.000Z',
				mtimeMs: 1,
				path: 'passages/story-two/001-second.twee',
				sizeBytes: 0
			},
			...['assets/one.png', 'assets/three.png', 'assets/two.png'].map(path => ({
				fingerprint: '1:3',
				kind: 'asset' as const,
				modifiedAt: '2026-06-21T16:00:00.000Z',
				mtimeMs: 1,
				path,
				sizeBytes: 3
			}))
		];

		readFileMock.mockImplementation(async path =>
			String(path).endsWith('twine.toml')
				? manifestSource
				: String(path).includes('story-two')
					? secondPassageSource
					: firstPassageSource
		);
		writeFileMock.mockImplementation(async (path, source) => {
			if (
				String(path).includes('/twine.toml.') ||
				String(path).endsWith('/twine.toml')
			) {
				manifestSource = String(source);
			} else if (String(path).includes('/passages/story/')) {
				firstPassageSource = String(source);
			}
		});
		listNativeProjectAssetsMock.mockReturnValue([]);
		nativeProjectAssetDigestCaptureAvailableMock.mockReturnValue(true);
		captureNativeProjectAssetDigestsMock.mockImplementation(
			async (_rootPath, requests) => ({
				digests: requests.map((request: {path: string}) => ({
					contentDigest: request.path.includes('two')
						? '2'.repeat(64)
						: request.path.includes('three')
							? '3'.repeat(64)
							: '1'.repeat(64),
					path: request.path
				})),
				failures: [],
				totalSourceBytes: requests.length * 3
			})
		);
		nativeProjectFileManifestMock.mockReturnValue(files);

		await startProjectSession('/native/project.twine.rs', undefined, [
			'story-id',
			'story-two'
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
		expect(
			projectSessionAssetReadBaselines('/native/project.twine.rs', [
				'assets/two.png'
			])
		).toEqual([
			{
				expectedContentDigest: '2'.repeat(64),
				expectedExists: true,
				expectedModifiedAtMs: 1,
				expectedSizeBytes: 3,
				path: 'assets/two.png'
			}
		]);
		expect(
			projectSessionAssetReadBaselines('/native/project.twine.rs', [
				'assets/one.png'
			])[0].expectedContentDigest
		).toBeUndefined();

		const passageReadsBeforeFullSave = readFileMock.mock.calls.filter(
			([path]) => String(path).includes('/passages/')
		).length;
		story.passages[0].text = '<img src="assets/three.png">';
		captureNativeProjectAssetDigestsMock.mockRejectedValueOnce(
			Object.assign(new Error('busy'), {code: 'NATIVE_ASSET_READER_BUSY'})
		);
		saveNativeProjectFolderMock.mockImplementation(() => {
			firstPassageSource = story.passages[0].text;

			return {
				passageTextLoaded: true,
				rootPath: '/native/project.twine.rs',
				stories: [story, secondStory],
				storyIds: [story.id, secondStory.id]
			};
		});
		await expect(
			saveProjectFolder('/native/project.twine.rs', story)
		).resolves.toEqual(
			expect.objectContaining({stories: [story, secondStory]})
		);

		expect(firstPassageSource).toBe('<img src="assets/three.png">');
		expect(
			readFileMock.mock.calls.filter(([path]) =>
				String(path).includes('/passages/')
			).length
		).toBe(passageReadsBeforeFullSave);
		expect(
			projectSessionAssetReadBaselines('/native/project.twine.rs', [
				'assets/one.png',
				'assets/three.png',
				'assets/two.png'
			]).map(baseline => baseline.expectedContentDigest)
		).toEqual([undefined, undefined, '2'.repeat(64)]);
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
		let manifestSource = [
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
			'file = "passages/story/002-second.twee"',
			'[[stories]]',
			'id = "story-2"',
			'ifid = "STORY-2"',
			'name = "Story Two"',
			'start_passage = "passage-1"',
			'[[stories.passages]]',
			'id = "passage-1"',
			'name = "Other First"',
			'file = "passages/story-two/001-first.twee"'
		].join('\n');
		let graphSource = {
			passages: {
				byStory: {
					'story-id': {
						'passage-1': {
							bounds: {height: 100, left: 10, top: 20, width: 100},
							group: 'opening',
							metadata: {locked: true}
						},
						'passage-2': {
							bounds: {height: 110, left: 30, top: 40, width: 120},
							metadata: {note: 'keep'}
						}
					},
					'story-2': {
						'passage-1': {
							bounds: {height: 130, left: 800, top: 90, width: 140},
							group: 'other-story'
						}
					}
				},
				schema: 2
			},
			viewport: {scale: 0.75}
		};
		let graphWritten = false;
		let manifestWritten = false;
		let pendingGraphSource: typeof graphSource | undefined;
		let pendingManifestSource: string | undefined;
		const manifestFile = () => ({
			fingerprint: manifestWritten ? '2:0' : '1:0',
			kind: 'manifest' as const,
			modifiedAt: '2026-06-21T16:00:00.000Z',
			mtimeMs: manifestWritten ? 2 : 1,
			path: 'twine.toml',
			sizeBytes: 0
		});
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
			String(path).endsWith('.twine/graph.json') ? graphSource : {}
		);
		listNativeProjectAssetsMock.mockReturnValue([]);
		nativeProjectFileManifestMock.mockImplementation(() => [
			manifestFile(),
			graphFile()
		]);
		statMock.mockImplementation(async path => {
			const root = String(path) === '/native/project.twine.rs';
			const graph = String(path).endsWith('.twine/graph.json');
			const manifest = String(path).endsWith('twine.toml');
			const mtimeMs =
				(graph && graphWritten) || (manifest && manifestWritten) ? 2 : 1;

			return {
				isDirectory: () => root,
				isFile: () => !root,
				mtime: new Date('2026-06-21T16:00:00.000Z'),
				mtimeMs,
				size: 0
			};
		});
		writeFileMock.mockImplementation(async (path, text) => {
			if (/\/twine\.toml\..+\.tmp$/.test(String(path))) {
				pendingManifestSource = String(text);
			}
			if (/\/\.twine\/graph\.json\..+\.tmp$/.test(String(path))) {
				pendingGraphSource = JSON.parse(String(text));
			}
		});
		moveMock.mockImplementation(async (_source, target) => {
			if (String(target).endsWith('twine.toml')) {
				manifestWritten = true;
				manifestSource = pendingManifestSource ?? manifestSource;
			}
			if (String(target).endsWith('.twine/graph.json')) {
				graphWritten = true;
				graphSource = pendingGraphSource ?? graphSource;
			}
		});

		await startProjectSession('/native/project.twine.rs', undefined, [
			'story-id',
			'story-2'
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
				byStory: {
					'story-id': {
						'passage-1': {
							bounds: expect.objectContaining({left: 420, top: 240}),
							group: 'opening',
							metadata: {locked: true}
						},
						'passage-2': {
							bounds: {height: 110, left: 30, top: 40, width: 120},
							metadata: {note: 'keep'}
						}
					},
					'story-2': {
						'passage-1': {
							bounds: {height: 130, left: 800, top: 90, width: 140},
							group: 'other-story'
						}
					}
				},
				schema: 2
			},
			viewport: {scale: 0.75}
		});
		expect(saveNativeProjectFolderMock).not.toHaveBeenCalled();
		const manifestWrite = writeFileMock.mock.calls.find(call =>
			/^\/native\/project\.twine\.rs\/twine\.toml\..+\.tmp$/.test(
				String(call[0])
			)
		);
		expect(manifestWrite?.[1]).toContain('schema_version = 2');
		expect(
			writeFileMock.mock.calls.some(call =>
				String(call[0]).includes('/.twine/project.json.')
			)
		).toBe(false);
		expect(
			moveMock.mock.invocationCallOrder.find((_, index) =>
				String(moveMock.mock.calls[index][1]).endsWith('twine.toml')
			)
		).toBeLessThan(
			moveMock.mock.invocationCallOrder.find((_, index) =>
				String(moveMock.mock.calls[index][1]).endsWith('.twine/graph.json')
			) as number
		);
		await expect(
			projectSessionSnapshot('/native/project.twine.rs', [
				'story-id',
				'story-2'
			])
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
			'schema_version = 2',
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
				byStory: {
					'story-id': {
						'passage-id': {
							bounds: {height: 100, left: 10, top: 20, width: 100}
						}
					}
				},
				schema: 2
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
		statMock.mockImplementation(async path => ({
			isDirectory: () => String(path) === '/native/project.twine.rs',
			isFile: () => String(path) !== '/native/project.twine.rs',
			mtime: new Date('2026-06-21T16:00:00.000Z'),
			mtimeMs: 2,
			size: 0
		}));

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

	it('time-slices trusted story digest scanning and waits before session start', async () => {
		const rootPath = '/native/time-sliced-digest.twine.rs';
		const passageCount = 300;
		const manifestSource = [
			'schema_version = 1',
			'name = "Project"',
			'[[stories]]',
			'id = "story-id"',
			'ifid = "STORY-ID"',
			'name = "Story"',
			...Array.from({length: passageCount}, (_, index) => [
				'[[stories.passages]]',
				`id = "passage-${index}"`,
				`name = "Passage ${index}"`,
				`file = "passages/${index}.twee"`
			]).flat()
		].join('\n');
		const files = [
			{
				fingerprint: '1:1',
				kind: 'manifest' as const,
				modifiedAt: '2026-06-21T16:00:00.000Z',
				mtimeMs: 1,
				path: 'twine.toml',
				sizeBytes: 1
			},
			...Array.from({length: passageCount}, (_, index) => ({
				fingerprint: '1:8',
				kind: 'passage' as const,
				modifiedAt: '2026-06-21T16:00:00.000Z',
				mtimeMs: 1,
				path: `passages/${index}.twee`,
				sizeBytes: 8
			}))
		];
		let now = 0;
		const performanceNowSpy = jest
			.spyOn(performance, 'now')
			.mockImplementation(() => (now += 9));
		let eventLoopTurnObserved = false;

		readFileMock.mockImplementation(async path =>
			String(path).endsWith('twine.toml') ? manifestSource : 'no media'
		);
		nativeProjectFileManifestMock.mockReturnValue(files);
		nativeProjectAssetDigestCaptureAvailableMock.mockReturnValue(true);
		setImmediate(() => {
			eventLoopTurnObserved = true;
		});

		try {
			await startProjectSession(rootPath, undefined, ['story-id']);
			expect(eventLoopTurnObserved).toBe(true);
		} finally {
			stopProjectSession(rootPath);
			performanceNowSpy.mockRestore();
		}
	});

	it('starts fail-closed when native digest admission is busy', async () => {
		const rootPath = '/native/busy-digest-start.twine.rs';
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
			'file = "passages/start.twee"'
		].join('\n');
		const assetPath = 'assets/a.png';

		readFileMock.mockImplementation(async path =>
			String(path).endsWith('twine.toml')
				? manifestSource
				: `<img src="${assetPath}">`
		);
		nativeProjectFileManifestMock.mockReturnValue([
			{
				fingerprint: '1:1',
				kind: 'manifest',
				modifiedAt: '2026-06-21T16:00:00.000Z',
				mtimeMs: 1,
				path: 'twine.toml',
				sizeBytes: 1
			},
			{
				fingerprint: '1:1',
				kind: 'passage',
				modifiedAt: '2026-06-21T16:00:00.000Z',
				mtimeMs: 1,
				path: 'passages/start.twee',
				sizeBytes: 1
			},
			{
				fingerprint: '1:3',
				kind: 'asset',
				modifiedAt: '2026-06-21T16:00:00.000Z',
				mtimeMs: 1,
				path: assetPath,
				sizeBytes: 3
			}
		]);
		nativeProjectAssetDigestCaptureAvailableMock.mockReturnValue(true);
		captureNativeProjectAssetDigestsMock.mockRejectedValue(
			Object.assign(new Error('busy'), {code: 'NATIVE_ASSET_READER_BUSY'})
		);

		try {
			await expect(
				startProjectSession(rootPath, undefined, ['story-id'])
			).resolves.toEqual(expect.objectContaining({storyIds: ['story-id']}));
			expect(
				projectSessionAssetReadBaselines(rootPath, [assetPath])[0]
					.expectedContentDigest
			).toBeUndefined();
		} finally {
			stopProjectSession(rootPath);
		}
	});

	it('does not publish an initial baseline superseded in the digest commit microtask gap', async () => {
		const rootPath = '/native/superseded-initial-baseline.twine.rs';
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
			'file = "passages/start.twee"'
		].join('\n');
		const oldPath = 'assets/old.png';
		const newPath = 'assets/new.png';
		const filesAt = (mtimeMs: number) => [
			{
				fingerprint: `${mtimeMs}:1`,
				kind: 'manifest' as const,
				modifiedAt: '2026-06-21T16:00:00.000Z',
				mtimeMs,
				path: 'twine.toml',
				sizeBytes: 1
			},
			{
				fingerprint: `${mtimeMs}:1`,
				kind: 'passage' as const,
				modifiedAt: '2026-06-21T16:00:00.000Z',
				mtimeMs,
				path: 'passages/start.twee',
				sizeBytes: 1
			},
			...[oldPath, newPath].map(path => ({
				fingerprint: `${mtimeMs}:3`,
				kind: 'asset' as const,
				modifiedAt: '2026-06-21T16:00:00.000Z',
				mtimeMs,
				path,
				sizeBytes: 3
			}))
		];
		const oldDigest = 'a'.repeat(64);
		const newDigest = 'b'.repeat(64);
		let passageSource = `<img src="${oldPath}">`;
		let secondStart: ReturnType<typeof startProjectSession> | undefined;
		let gapError: unknown;

		readFileMock.mockImplementation(async path =>
			String(path).endsWith('twine.toml') ? manifestSource : passageSource
		);
		listNativeProjectAssetsMock.mockReturnValue([]);
		nativeProjectAssetDigestCaptureAvailableMock.mockReturnValue(true);
		nativeProjectFileManifestMock
			.mockReturnValueOnce(filesAt(1))
			.mockReturnValue(filesAt(2));
		watchMock.mockReturnValue({close: jest.fn()});
		captureNativeProjectAssetDigestsMock
			.mockImplementationOnce(() => ({
				then(resolveCapture: (capture: unknown) => void) {
					queueMicrotask(() => {
						passageSource = `<img src="${newPath}">`;
						secondStart = startProjectSession(rootPath, undefined, [
							'story-id'
						]);
						queueMicrotask(() => {
							try {
								projectSessionAssetReadBaselines(rootPath, [oldPath]);
							} catch (error) {
								gapError = error;
							}
						});
					});
					resolveCapture({
						digests: [{contentDigest: oldDigest, path: oldPath}],
						failures: [],
						totalSourceBytes: 3
					});
				}
			}))
			.mockResolvedValueOnce({
				digests: [{contentDigest: newDigest, path: newPath}],
				failures: [],
				totalSourceBytes: 3
			});

		try {
			const firstStart = startProjectSession(rootPath, undefined, ['story-id']);

			await expect(firstStart).resolves.toEqual(
				expect.objectContaining({storyIds: ['story-id']})
			);
			await expect(secondStart).resolves.toEqual(
				expect.objectContaining({storyIds: ['story-id']})
			);
			expect(gapError).toEqual(
				expect.objectContaining({
					message: 'Project assets cannot be read before indexing completes.'
				})
			);
			expect(
				projectSessionAssetReadBaselines(rootPath, [newPath, oldPath])
			).toEqual([
				{
					expectedContentDigest: newDigest,
					expectedExists: true,
					expectedModifiedAtMs: 2,
					expectedSizeBytes: 3,
					path: newPath
				},
				{
					expectedContentDigest: undefined,
					expectedExists: true,
					expectedModifiedAtMs: 2,
					expectedSizeBytes: 3,
					path: oldPath
				}
			]);
		} finally {
			stopProjectSession(rootPath);
		}
	});

	it('wakes an initial baseline waiter when a newer pre-scan refresh rejects', async () => {
		const rootPath = '/native/rejected-newer-initial-refresh.twine.rs';
		const story = {...fakeStory(1), id: 'story-id', name: 'Story'};
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
			'file = "passages/start.twee"'
		].join('\n');
		const oldPath = 'assets/old.png';
		const retryPath = 'assets/retry.png';
		const filesAt = (mtimeMs: number) => [
			{
				fingerprint: `${mtimeMs}:1`,
				kind: 'manifest' as const,
				modifiedAt: '2026-06-21T16:00:00.000Z',
				mtimeMs,
				path: 'twine.toml',
				sizeBytes: 1
			},
			{
				fingerprint: `${mtimeMs}:1`,
				kind: 'passage' as const,
				modifiedAt: '2026-06-21T16:00:00.000Z',
				mtimeMs,
				path: 'passages/start.twee',
				sizeBytes: 1
			},
			...[oldPath, retryPath].map(path => ({
				fingerprint: `${mtimeMs}:3`,
				kind: 'asset' as const,
				modifiedAt: '2026-06-21T16:00:00.000Z',
				mtimeMs,
				path,
				sizeBytes: 3
			}))
		];
		const oldDigest = 'a'.repeat(64);
		const retryDigest = 'c'.repeat(64);
		let passageSource = `<img src="${oldPath}">`;
		let resolveOldCapture!: (capture: {
			digests: Array<{contentDigest: string; path: string}>;
			failures: never[];
			totalSourceBytes: number;
		}) => void;
		let rejectNewerSnapshot!: (error: Error) => void;
		let markOldCaptureStarted!: () => void;
		let markNewerSnapshotStarted!: () => void;
		const oldCaptureStarted = new Promise<void>(resolveStarted => {
			markOldCaptureStarted = resolveStarted;
		});
		const newerSnapshotStarted = new Promise<void>(resolveStarted => {
			markNewerSnapshotStarted = resolveStarted;
		});
		const oldCapture = new Promise<{
			digests: Array<{contentDigest: string; path: string}>;
			failures: never[];
			totalSourceBytes: number;
		}>(resolveCapture => {
			resolveOldCapture = resolveCapture;
		});
		const rejectedManifest = new Promise<never>((_resolve, rejectSnapshot) => {
			rejectNewerSnapshot = rejectSnapshot;
		});

		story.passages = story.passages.map(passage => ({
			...passage,
			id: 'passage-id',
			story: 'story-id',
			text: `<img src="${retryPath}">`
		}));
		readFileMock.mockImplementation(async path =>
			String(path).endsWith('twine.toml') ? manifestSource : passageSource
		);
		listNativeProjectAssetsMock.mockReturnValue([]);
		nativeProjectAssetDigestCaptureAvailableMock.mockReturnValue(true);
		nativeProjectFileManifestMock
			.mockReturnValueOnce(filesAt(1))
			.mockImplementationOnce(() => {
				markNewerSnapshotStarted();
				return rejectedManifest;
			})
			.mockReturnValue(filesAt(3));
		captureNativeProjectAssetDigestsMock
			.mockImplementationOnce(() => {
				markOldCaptureStarted();
				return oldCapture;
			})
			.mockResolvedValue({
				digests: [{contentDigest: retryDigest, path: retryPath}],
				failures: [],
				totalSourceBytes: 3
			});
		saveNativeProjectFolderMock.mockReturnValue({
			passageTextLoaded: true,
			rootPath,
			stories: [story],
			storyIds: [story.id]
		});
		watchMock.mockReturnValue({close: jest.fn()});

		try {
			const initialStart = startProjectSession(rootPath, undefined, [story.id]);

			await oldCaptureStarted;
			const newerSave = saveProjectFolder(rootPath, story);

			await newerSnapshotStarted;
			passageSource = `<img src="${retryPath}">`;
			resolveOldCapture({
				digests: [{contentDigest: oldDigest, path: oldPath}],
				failures: [],
				totalSourceBytes: 3
			});
			expect(() =>
				projectSessionAssetReadBaselines(rootPath, [oldPath])
			).toThrow('Project assets cannot be read before indexing completes.');
			expect(watchMock).not.toHaveBeenCalled();
			await new Promise<void>(resolveRejection =>
				setImmediate(() => {
					rejectNewerSnapshot(new Error('newer snapshot failed'));
					resolveRejection();
				})
			);

			await expect(newerSave).rejects.toThrow('newer snapshot failed');
			await expect(initialStart).resolves.toEqual(
				expect.objectContaining({storyIds: [story.id]})
			);
			expect(
				projectSessionAssetReadBaselines(rootPath, [retryPath, oldPath])
			).toEqual([
				{
					expectedContentDigest: retryDigest,
					expectedExists: true,
					expectedModifiedAtMs: 3,
					expectedSizeBytes: 3,
					path: retryPath
				},
				{
					expectedContentDigest: undefined,
					expectedExists: true,
					expectedModifiedAtMs: 3,
					expectedSizeBytes: 3,
					path: oldPath
				}
			]);
		} finally {
			stopProjectSession(rootPath);
		}
	});

	it('stops time-sliced trusted story scanning when the session is canceled', async () => {
		const rootPath = '/native/canceled-digest-scan.twine.rs';
		const passageCount = 300;
		const manifestSource = [
			'schema_version = 1',
			'name = "Project"',
			'[[stories]]',
			'id = "story-id"',
			'ifid = "STORY-ID"',
			'name = "Story"',
			...Array.from({length: passageCount}, (_, index) => [
				'[[stories.passages]]',
				`id = "passage-${index}"`,
				`name = "Passage ${index}"`,
				`file = "passages/${index}.twee"`
			]).flat()
		].join('\n');
		const files = [
			{
				fingerprint: '1:1',
				kind: 'manifest' as const,
				modifiedAt: '2026-06-21T16:00:00.000Z',
				mtimeMs: 1,
				path: 'twine.toml',
				sizeBytes: 1
			},
			...Array.from({length: passageCount}, (_, index) => ({
				fingerprint: '1:8',
				kind: 'passage' as const,
				modifiedAt: '2026-06-21T16:00:00.000Z',
				mtimeMs: 1,
				path: `passages/${index}.twee`,
				sizeBytes: 8
			}))
		];
		let now = 0;
		const performanceNowSpy = jest
			.spyOn(performance, 'now')
			.mockImplementation(() => (now += 9));
		const scanSpy = jest.spyOn(
			assetPaths,
			'boundedReferencedMediaPathsInSource'
		);

		readFileMock.mockImplementation(async path =>
			String(path).endsWith('twine.toml') ? manifestSource : 'no media'
		);
		nativeProjectFileManifestMock.mockReturnValue(files);
		nativeProjectAssetDigestCaptureAvailableMock.mockReturnValue(true);

		try {
			const start = startProjectSession(rootPath, undefined, ['story-id']);

			setImmediate(() => stopProjectSession(rootPath));
			await expect(start).rejects.toMatchObject({
				code: 'PROJECT_SESSION_START_CANCELED'
			});
			expect(scanSpy).toHaveBeenCalledTimes(1);
		} finally {
			stopProjectSession(rootPath);
			scanSpy.mockRestore();
			performanceNowSpy.mockRestore();
		}
	});

	it('lets a newer digest refresh supersede an older yielded full save', async () => {
		const rootPath = '/native/superseded-digest-save.twine.rs';
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
			'file = "passages/start.twee"'
		].join('\n');
		const assetPaths = [
			'assets/initial.png',
			'assets/newer.png',
			'assets/older.png'
		];
		const filesAt = (mtimeMs: number) => [
			{
				fingerprint: `${mtimeMs}:1`,
				kind: 'manifest' as const,
				modifiedAt: '2026-06-21T16:00:00.000Z',
				mtimeMs,
				path: 'twine.toml',
				sizeBytes: 1
			},
			{
				fingerprint: `${mtimeMs}:1`,
				kind: 'passage' as const,
				modifiedAt: '2026-06-21T16:00:00.000Z',
				mtimeMs,
				path: 'passages/start.twee',
				sizeBytes: 1
			},
			...assetPaths.map(path => ({
				fingerprint: `${mtimeMs}:3`,
				kind: 'asset' as const,
				modifiedAt: '2026-06-21T16:00:00.000Z',
				mtimeMs,
				path,
				sizeBytes: 3
			}))
		];
		const olderStory = {...fakeStory(300), id: 'story-id', name: 'Story'};
		olderStory.passages = olderStory.passages.map((passage, index) => ({
			...passage,
			id: `older-${index}`,
			story: 'story-id',
			text: index === 0 ? '<img src="assets/older.png">' : 'no media'
		}));
		const newerStory = {...fakeStory(1), id: 'story-id', name: 'Story'};
		newerStory.passages = newerStory.passages.map(passage => ({
			...passage,
			story: 'story-id',
			text: '<img src="assets/newer.png">'
		}));

		readFileMock.mockImplementation(async path =>
			String(path).endsWith('twine.toml')
				? manifestSource
				: '<img src="assets/initial.png">'
		);
		listNativeProjectAssetsMock.mockReturnValue([]);
		nativeProjectAssetDigestCaptureAvailableMock.mockReturnValue(true);
		nativeProjectFileManifestMock.mockReturnValueOnce(filesAt(1));
		await startProjectSession(rootPath, undefined, ['story-id']);
		captureNativeProjectAssetDigestsMock.mockClear();
		captureNativeProjectAssetDigestsMock.mockImplementation(
			async (_rootPath, requests) => ({
				digests: requests.map((request: {path: string}) => ({
					contentDigest: 'a'.repeat(64),
					path: request.path
				})),
				failures: [],
				totalSourceBytes: requests.length * 3
			})
		);
		saveNativeProjectFolderMock.mockImplementation(
			(_rootPath: string, savedStory: typeof olderStory) => ({
				passageTextLoaded: true,
				rootPath,
				stories: [savedStory],
				storyIds: [savedStory.id]
			})
		);
		nativeProjectFileManifestMock
			.mockReturnValueOnce(filesAt(2))
			.mockReturnValueOnce(filesAt(3));
		let now = 0;
		const performanceNowSpy = jest
			.spyOn(performance, 'now')
			.mockImplementation(() => (now += 9));

		try {
			const olderSave = saveProjectFolder(rootPath, olderStory);
			let newerSave!: Promise<Awaited<ReturnType<typeof saveProjectFolder>>>;

			await new Promise<void>(resolveLaunch =>
				setImmediate(() => {
					newerSave = saveProjectFolder(rootPath, newerStory);
					resolveLaunch();
				})
			);
			await expect(Promise.all([olderSave, newerSave])).resolves.toHaveLength(
				2
			);
			expect(captureNativeProjectAssetDigestsMock).toHaveBeenCalledTimes(1);
			expect(captureNativeProjectAssetDigestsMock).toHaveBeenCalledWith(
				rootPath,
				[
					{
						expectedModifiedAtMs: 3,
						expectedSizeBytes: 3,
						path: 'assets/newer.png'
					}
				]
			);
			expect(
				projectSessionAssetReadBaselines(rootPath, [
					'assets/newer.png',
					'assets/older.png'
				])
			).toEqual([
				{
					expectedContentDigest: 'a'.repeat(64),
					expectedExists: true,
					expectedModifiedAtMs: 3,
					expectedSizeBytes: 3,
					path: 'assets/newer.png'
				},
				{
					expectedContentDigest: undefined,
					expectedExists: true,
					expectedModifiedAtMs: 3,
					expectedSizeBytes: 3,
					path: 'assets/older.png'
				}
			]);
		} finally {
			stopProjectSession(rootPath);
			performanceNowSpy.mockRestore();
		}
	});

	it('retains at most one hundred trusted story digest states', async () => {
		performanceHarnessEnabledMock.mockReturnValue(true);
		const realFs = jest.requireActual<typeof import('fs')>('fs');
		const rootPath = `/tmp/twine-story-digest-limit-${Date.now()}.twine.rs`;
		const sharedPath = 'assets/shared.png';
		const stories = Array.from({length: 101}, (_, index) => {
			const id = `story-${String(index).padStart(3, '0')}`;
			const story = {...fakeStory(1), id};

			story.passages = story.passages.map(passage => ({
				...passage,
				story: id,
				text: `<img src="${sharedPath}">`
			}));
			return story;
		});
		const files = [
			{
				fingerprint: '1:1',
				kind: 'manifest' as const,
				modifiedAt: '2026-06-21T16:00:00.000Z',
				mtimeMs: 1,
				path: 'twine.toml',
				sizeBytes: 1
			},
			{
				fingerprint: '1:3',
				kind: 'asset' as const,
				modifiedAt: '2026-06-21T16:00:00.000Z',
				mtimeMs: 1,
				path: sharedPath,
				sizeBytes: 3
			}
		];
		const receipt = {
			assets: [],
			completedAt: '2026-06-21T16:00:01.000Z',
			files,
			id: 'story-limit',
			layoutDataJson: '{}',
			rootPath,
			schemaVersion: 1,
			startedAt: '2026-06-21T16:00:00.000Z',
			storyIds: stories.map(story => story.id)
		};

		realFs.mkdirSync(rootPath, {recursive: true});
		watchMock.mockReturnValue({close: jest.fn()});
		nativeProjectAssetDigestCaptureAvailableMock.mockReturnValue(true);
		captureNativeProjectAssetDigestsMock.mockResolvedValue({
			digests: [{contentDigest: 'a'.repeat(64), path: sharedPath}],
			failures: [],
			totalSourceBytes: 3
		});
		loadNativeProjectFolderMock
			.mockReturnValueOnce({
				passageTextLoaded: false,
				rootPath,
				stories,
				storyIds: stories.map(story => story.id)
			})
			.mockReturnValueOnce({
				baselineReceipt: receipt,
				passageTextLoaded: true,
				rootPath,
				stories,
				storyIds: stories.map(story => story.id)
			});

		try {
			await openProjectFolder(rootPath, {loadPassageText: false});
			await hydrateProjectFolder(
				rootPath,
				stories.map(story => story.id)
			);
			await startProjectSession(
				rootPath,
				undefined,
				stories.map(story => story.id)
			);

			expect(projectSessionMemoryDiagnostics()).toEqual(
				expect.objectContaining({
					assetDigestCandidatePathCount: 100,
					assetDigestCandidatePathStringBytes: sharedPath.length * 2 * 100,
					assetDigestCount: 1,
					assetDigestReadyStoryCount: 100,
					assetDigestStoryIdStringBytes: stories
						.slice(0, 100)
						.reduce((total, story) => total + story.id.length * 2, 0),
					assetDigestStoryCount: 100,
					assetDigestUnknownReasonStringBytes: 0
				})
			);
		} finally {
			stopProjectSession(rootPath);
			realFs.rmSync(rootPath, {force: true, recursive: true});
		}
	});

	it('captures one bounded digest batch and rejects a whole story beyond the session ceiling', async () => {
		performanceHarnessEnabledMock.mockReturnValue(true);
		const story = fakeStory(1);
		const secondStory = {...fakeStory(1), id: 'second-story'};
		const remainingStories = Array.from({length: 3}, (_, storyIndex) => {
			const candidate = {
				...fakeStory(1),
				id: `story-${storyIndex + 3}`
			};

			candidate.passages[0].text = Array.from(
				{length: 25},
				(_, pathIndex) =>
					`<img src="assets/story-${storyIndex + 3}-${String(pathIndex).padStart(2, '0')}.png">`
			).join('');
			return candidate;
		});
		const stories = [story, secondStory, ...remainingStories];
		const realFs = jest.requireActual<typeof import('fs')>('fs');
		const rootPath = `/tmp/twine-digest-${Date.now()}.twine.rs`;
		const mediaPaths = Array.from(
			{length: 30},
			(_, index) => `assets/media-${String(index).padStart(2, '0')}.png`
		);
		const expectedPaths = mediaPaths
			.slice()
			.sort((left, right) => left.localeCompare(right))
			.slice(0, 25);
		const secondMediaPaths = Array.from(
			{length: 30},
			(_, index) => `assets/other-${String(index).padStart(2, '0')}.png`
		);
		const secondExpectedPaths = secondMediaPaths.slice(0, 25);
		const remainingPaths = remainingStories.map((_, storyIndex) =>
			Array.from(
				{length: 25},
				(_, pathIndex) =>
					`assets/story-${storyIndex + 3}-${String(pathIndex).padStart(2, '0')}.png`
			)
		);
		const admittedPaths = [
			...expectedPaths,
			...secondExpectedPaths,
			...remainingPaths[0],
			...remainingPaths[1]
		];
		story.passages[0].text = [
			'<link href="assets/style.css">',
			...mediaPaths
				.slice()
				.reverse()
				.map(path => `<img src="${path}">`)
		].join('');
		secondStory.passages[0].text = secondMediaPaths
			.slice()
			.reverse()
			.map(path => `<img src="${path}">`)
			.join('');
		const files = [
			{
				fingerprint: '1:42',
				kind: 'manifest' as const,
				modifiedAt: '2026-06-21T16:00:00.000Z',
				mtimeMs: 1,
				path: 'twine.toml',
				sizeBytes: 42
			},
			...[
				'assets/style.css',
				...mediaPaths,
				...secondMediaPaths,
				...remainingPaths.flat()
			].map(path => ({
				fingerprint: '2:3',
				kind: 'asset' as const,
				modifiedAt: '2026-06-21T16:00:00.000Z',
				mtimeMs: 2,
				path,
				sizeBytes: 3
			}))
		];
		const baselineReceipt = {
			assets: [],
			completedAt: '2026-06-21T16:00:01.000Z',
			files,
			id: 'load-digest',
			layoutDataJson: '{}',
			rootPath,
			schemaVersion: 1,
			startedAt: '2026-06-21T16:00:00.000Z',
			storyIds: stories.map(story => story.id)
		};
		realFs.mkdirSync(rootPath, {recursive: true});
		nativeProjectAssetDigestCaptureAvailableMock.mockReturnValue(true);
		captureNativeProjectAssetDigestsMock.mockImplementation(
			async (_rootPath, requests) => ({
				digests: requests
					.filter(
						(request: {path: string}) => request.path !== 'assets/other-24.png'
					)
					.map((request: {path: string}) => ({
						contentDigest: 'a'.repeat(64),
						path: request.path
					})),
				failures: requests.some(
					(request: {path: string}) => request.path === 'assets/other-24.png'
				)
					? [
							{
								message: 'too large',
								path: 'assets/other-24.png',
								reason: 'file-too-large'
							}
						]
					: [],
				totalSourceBytes: requests.length * 3
			})
		);
		loadNativeProjectFolderMock
			.mockReturnValueOnce({
				passageTextLoaded: false,
				rootPath,
				stories,
				storyIds: stories.map(story => story.id)
			})
			.mockReturnValueOnce({
				baselineReceipt,
				passageTextLoaded: true,
				rootPath,
				stories,
				storyIds: stories.map(story => story.id)
			});

		try {
			await openProjectFolder(rootPath, {loadPassageText: false});
			await hydrateProjectFolder(
				rootPath,
				stories.map(story => story.id)
			);
			await startProjectSession(
				rootPath,
				undefined,
				stories.map(story => story.id)
			);

			expect(captureNativeProjectAssetDigestsMock).toHaveBeenCalledTimes(1);
			expect(captureNativeProjectAssetDigestsMock).toHaveBeenCalledWith(
				rootPath,
				admittedPaths.map(path => ({
					expectedModifiedAtMs: 2,
					expectedSizeBytes: 3,
					path
				}))
			);
			expect(projectSessionAssetReadBaselines(rootPath, expectedPaths)).toEqual(
				expectedPaths.map(path => ({
					expectedContentDigest: 'a'.repeat(64),
					expectedExists: true,
					expectedModifiedAtMs: 2,
					expectedSizeBytes: 3,
					path
				}))
			);
			expect(
				projectSessionAssetReadBaselines(rootPath, secondExpectedPaths)
			).toEqual(
				secondExpectedPaths.map(path => ({
					expectedContentDigest:
						path === 'assets/other-24.png' ? undefined : 'a'.repeat(64),
					expectedExists: true,
					expectedModifiedAtMs: 2,
					expectedSizeBytes: 3,
					path
				}))
			);
			expect(
				projectSessionAssetReadBaselines(rootPath, ['assets/style.css'])[0]
					.expectedContentDigest
			).toBeUndefined();
			expect(
				projectSessionAssetReadBaselines(rootPath, remainingPaths[2]).every(
					baseline => baseline.expectedContentDigest === undefined
				)
			).toBe(true);
			expect(projectSessionMemoryDiagnostics()).toEqual(
				expect.objectContaining({
					assetDigestCandidatePathCount: 100,
					assetDigestCandidatePathStringBytes: admittedPaths.reduce(
						(total, path) => total + path.length * 2,
						0
					),
					assetDigestCount: 99,
					assetDigestReadyStoryCount: 4,
					assetDigestStoryIdStringBytes: stories.reduce(
						(total, story) => total + story.id.length * 2,
						0
					),
					assetDigestStoryCount: 5,
					assetDigestStringBytes: admittedPaths
						.filter(path => path !== 'assets/other-24.png')
						.reduce((total, path) => total + (path.length + 64) * 2, 0),
					assetDigestUnknownReasonStringBytes: 'session-path-limit'.length * 2
				})
			);
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

	it('cleans native zip data when prepared asset validation fails', async () => {
		prepareNativeProjectImportMock.mockReturnValue({
			assets: [
				{
					originalPath: 'images/cover.png',
					sourcePath: '/tmp/twine-import-native/images/cover.png',
					targetPath: 'assets/images/cover.png'
				}
			],
			cleanupPath: '/tmp/twine-import-native',
			htmlFilePath: '/tmp/twine-import-native/story.html',
			htmlSource: '<tw-storydata></tw-storydata>',
			sourceKind: 'zip',
			sourcePath: '/downloads/story.zip'
		});
		lstatMock.mockResolvedValue({
			isFile: () => false,
			isSymbolicLink: () => true,
			size: 0
		});

		await expect(prepareProjectImport('/downloads/story.zip')).rejects.toThrow(
			'regular files'
		);
		expect(removeMock).toHaveBeenCalledWith('/tmp/twine-import-native');
	});

	it('rejects an oversized direct import before invoking either backend', async () => {
		statMock.mockResolvedValue({
			isFile: () => true,
			size: maxImportSourceBytes + 1
		});

		await expect(
			prepareProjectImport('/imports/oversized.html')
		).rejects.toThrow('Import source exceeds the 50 MiB limit.');
		expect(prepareNativeProjectImportMock).not.toHaveBeenCalled();
		expect(prepareNativeHtmlImportMock).not.toHaveBeenCalled();
		expect(openFileMock).not.toHaveBeenCalled();
	});

	it('cleans a partial zip import when preflight quotas reject an entry', async () => {
		statMock.mockResolvedValue({isFile: () => true, size: 1024});
		mockZipEntries([
			{
				compressedSize: 1024,
				fileName: 'oversized.bin',
				uncompressedSize: maxImportZipEntryBytes + 1
			}
		]);

		await expect(
			prepareProjectImport('/downloads/oversized.zip')
		).rejects.toThrow('expanded-size limit');
		expect(extractZipMock).not.toHaveBeenCalled();
		expect(removeMock).toHaveBeenCalledWith('/tmp/twine-import-abc');
	});

	it('rejects zip symlinks before extraction and cleans temporary data', async () => {
		statMock.mockResolvedValue({isFile: () => true, size: 1024});
		mockZipEntries([
			{
				compressedSize: 8,
				externalFileAttributes: 0xa000 << 16,
				fileName: 'story.html',
				uncompressedSize: 8
			}
		]);

		await expect(
			prepareProjectImport('/downloads/symlink.zip')
		).rejects.toThrow('may not contain symbolic links');
		expect(extractZipMock).not.toHaveBeenCalled();
		expect(removeMock).toHaveBeenCalledWith('/tmp/twine-import-abc');
	});

	it('rechecks zip quotas during extraction and cleans race failures', async () => {
		statMock.mockResolvedValue({isFile: () => true, size: 1024});
		mockZipEntries([
			{compressedSize: 5, fileName: 'story.html', uncompressedSize: 5}
		]);
		extractZipMock.mockImplementation(async (_path, options) => {
			options.onEntry(
				{
					compressedSize: 1,
					fileName: 'changed.html',
					uncompressedSize: maxImportZipEntryBytes + 1
				},
				{entryCount: 1}
			);
		});

		await expect(
			prepareProjectImport('/downloads/changed.zip')
		).rejects.toThrow('expanded-size limit');
		expect(removeMock).toHaveBeenCalledWith('/tmp/twine-import-abc');
	});

	it('rejects an oversized extracted HTML file before either HTML reader', async () => {
		findNativeTwineHtmlFilesMock.mockReturnValue([
			'/tmp/twine-import-abc/story.html'
		]);
		statMock.mockImplementation(async path => ({
			isFile: () => true,
			size: path.endsWith('.zip') ? 1024 : maxImportSourceBytes + 1
		}));

		await expect(
			prepareProjectImport('/downloads/oversized-html.zip')
		).rejects.toThrow('Import source exceeds the 50 MiB limit.');
		expect(prepareNativeHtmlImportMock).not.toHaveBeenCalled();
		expect(openFileMock).not.toHaveBeenCalled();
		expect(removeMock).toHaveBeenCalledWith('/tmp/twine-import-abc');
	});

	it('skips oversized nonselected HTML candidates during zip discovery', async () => {
		readFileMock.mockResolvedValue(
			'<tw-storydata name="Story"></tw-storydata>'
		);
		readdirMock.mockImplementation(async path =>
			path === '/tmp/twine-import-abc' ? ['decoy.html', 'story.html'] : []
		);
		statMock.mockImplementation(async path => ({
			isDirectory: () => false,
			isFile: () => true,
			mtime: new Date('2026-06-21T16:00:00.000Z'),
			mtimeMs: 1,
			size: path.endsWith('decoy.html') ? maxImportSourceBytes + 1 : 1024
		}));

		const prepared = await prepareProjectImport('/downloads/story.zip');

		expect(prepared.htmlFilePath).toBe('/tmp/twine-import-abc/story.html');
		expect(
			openFileMock.mock.calls.some(([path]) => path.endsWith('decoy.html'))
		).toBe(false);
	});

	it('prepares an HTML import by rewriting sibling media paths and copying assets', async () => {
		const htmlSource = `
			<tw-storydata name="Transylvania" hidden>
				<style role="stylesheet">body { background-image: url("images/cover.png"); }</style>
				<tw-passagedata pid="1" name="Start">Play audio/theme.mp3</tw-passagedata>
			</tw-storydata>
		`;

		readFileMock.mockImplementation(async path =>
			String(path).endsWith('.html') ? htmlSource : Buffer.alloc(2048)
		);
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
				path === '/imports/images' ||
				path === '/imports/audio' ||
				path === '/native/project.twine.rs' ||
				path === '/native/project.twine.rs/assets' ||
				path === '/native/project.twine.rs/assets/audio' ||
				path === '/native/project.twine.rs/assets/images',
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
		expect(moveMock).toHaveBeenCalledWith(
			expect.stringMatching(
				/^\/native\/project\.twine\.rs\/assets\/audio\/\.theme\.mp3\.import-.+\.tmp$/
			),
			'/native/project.twine.rs/assets/audio/theme.mp3',
			{overwrite: true}
		);
		expect(moveMock).toHaveBeenCalledWith(
			expect.stringMatching(
				/^\/native\/project\.twine\.rs\/assets\/images\/\.cover\.png\.import-.+\.tmp$/
			),
			'/native/project.twine.rs/assets/images/cover.png',
			{overwrite: true}
		);
		expect(copyMock).not.toHaveBeenCalled();
		expect(readdirMock).toHaveBeenCalledWith('/native/project.twine.rs/assets');
	});

	it('rewrites an obvious asset root containing spaces in one pass', async () => {
		const htmlSource =
			'<tw-storydata><img src="transylvania files/cover.png"></tw-storydata>';

		readFileMock.mockResolvedValue(htmlSource);
		readdirMock.mockImplementation(async path => {
			if (path === '/imports') {
				return ['Transylvania.html', 'Transylvania Files'];
			}
			if (path === '/imports/Transylvania Files') {
				return ['cover.png'];
			}
			return [];
		});
		statMock.mockImplementation(async path => ({
			isDirectory: () => path === '/imports/Transylvania Files',
			isFile: () => !String(path).endsWith('Transylvania Files'),
			mtime: new Date('2026-06-21T16:00:00.000Z'),
			mtimeMs: 1,
			size: String(path).endsWith('.png') ? 1 : Buffer.byteLength(htmlSource)
		}));

		const preparedImport = await prepareProjectImport(
			'/imports/Transylvania.html'
		);

		expect(preparedImport.htmlSource).toContain(
			'src="assets/Transylvania Files/cover.png"'
		);
	});

	it('keeps whitespace-heavy nonmatching asset roots within a linear time budget', async () => {
		const htmlBaseName = `${'a '.repeat(120)}x`;
		const assetRoot = `${htmlBaseName}-files`;
		const component = `${'a '.repeat(120)}y-files/`;
		const adversarialSource = component.repeat(
			Math.ceil((10 * 1024 * 1024) / component.length)
		);

		readFileMock.mockImplementation(async path =>
			String(path).endsWith('.html') ? adversarialSource : Buffer.from([1])
		);
		readdirMock.mockImplementation(async path => {
			if (path === '/imports') {
				return [`${htmlBaseName}.html`, assetRoot];
			}
			if (path === `/imports/${assetRoot}`) {
				return ['cover.png'];
			}
			return [];
		});
		statMock.mockImplementation(async path => ({
			isDirectory: () => path === `/imports/${assetRoot}`,
			isFile: () => path !== `/imports/${assetRoot}`,
			mtime: new Date('2026-06-21T16:00:00.000Z'),
			mtimeMs: 1,
			size: String(path).endsWith('.png')
				? 1
				: Buffer.byteLength(adversarialSource)
		}));
		const startedAt = performance.now();

		await prepareProjectImport(`/imports/${htmlBaseName}.html`);

		expect(performance.now() - startedAt).toBeLessThan(2000);
	});

	it('resets asset reference scanning after a quota rejection', async () => {
		const rejectedSource = 'http://example.test/missing.png '.repeat(10_001);
		const acceptedSource = '<img src="images/cover.png">';

		readFileMock
			.mockResolvedValueOnce(rejectedSource)
			.mockResolvedValueOnce(acceptedSource);
		readdirMock.mockResolvedValue([]);
		statMock.mockImplementation(async path => ({
			isDirectory: () => false,
			isFile: () => true,
			mtime: new Date('2026-06-21T16:00:00.000Z'),
			mtimeMs: 1,
			size: String(path).endsWith('cover.png') ? 1 : rejectedSource.length
		}));

		await expect(
			prepareProjectImport('/imports/rejected.html')
		).rejects.toThrow('asset references exceed');
		const accepted = await prepareProjectImport('/imports/accepted.html');

		expect(accepted.assets).toEqual([
			{
				originalPath: 'images/cover.png',
				sourcePath: '/imports/images/cover.png',
				targetPath: 'assets/images/cover.png'
			}
		]);
	});

	it('stops streaming a sibling asset directory at the scan quota', async () => {
		let yieldedEntries = 0;
		const close = jest.fn(async () => undefined);

		opendirMock.mockResolvedValue({
			close,
			async *[Symbol.asyncIterator]() {
				for (let index = 0; index <= 10_000; index++) {
					yieldedEntries++;
					yield {name: `entry-${index}`};
				}
			}
		});
		readFileMock.mockResolvedValue('<tw-storydata></tw-storydata>');

		await expect(prepareProjectImport('/imports/story.html')).rejects.toThrow(
			'asset scan exceeds'
		);
		expect(yieldedEntries).toBe(10_001);
		expect(close).toHaveBeenCalled();
	});

	it('invalidates and cleans an import when an asset changes before copy', async () => {
		prepareNativeProjectImportMock.mockReturnValue({
			assets: [
				{
					originalPath: 'images/cover.png',
					sourcePath: '/tmp/twine-import-native/images/cover.png',
					targetPath: 'assets/images/cover.png'
				}
			],
			cleanupPath: '/tmp/twine-import-native',
			htmlFilePath: '/tmp/twine-import-native/story.html',
			htmlSource: '<tw-storydata></tw-storydata>',
			sourceKind: 'zip',
			sourcePath: '/downloads/story.zip'
		});
		lstatMock.mockImplementation(async path => ({
			isDirectory: () =>
				path === '/native/project.twine.rs' ||
				path === '/native/project.twine.rs/assets' ||
				path === '/native/project.twine.rs/assets/images',
			isFile: () => String(path).endsWith('.png'),
			isSymbolicLink: () => false,
			size: 1
		}));

		const prepared = await prepareProjectImport('/downloads/story.zip');

		openFileMock.mockResolvedValue({
			close: jest.fn(async () => undefined),
			stat: jest.fn(async () => ({isFile: () => true, size: 2}))
		});
		await expect(
			copyProjectImportAssets(prepared.id, '/native/project.twine.rs')
		).rejects.toThrow('changed after preparation');
		expect(removeMock).toHaveBeenCalledWith('/tmp/twine-import-native');
		await expect(
			copyProjectImportAssets(prepared.id, '/native/project.twine.rs')
		).rejects.toThrow('No prepared project import');
	});

	it('rejects a symlinked project asset destination before opening a source', async () => {
		prepareNativeHtmlImportMock.mockReturnValue({
			assets: [
				{
					originalPath: 'images/cover.png',
					sourcePath: '/imports/images/cover.png',
					targetPath: 'assets/images/cover.png'
				}
			],
			htmlFilePath: '/imports/story.html',
			htmlSource: '<tw-storydata></tw-storydata>',
			sourceKind: 'html',
			sourcePath: '/imports/story.html'
		});

		const prepared = await prepareProjectImport('/imports/story.html');

		lstatMock.mockImplementation(async path => ({
			isDirectory: () => false,
			isFile: () => false,
			isSymbolicLink: () => path === '/native/project.twine.rs/assets',
			size: 0
		}));
		openFileMock.mockClear();
		await expect(
			copyProjectImportAssets(prepared.id, '/native/project.twine.rs')
		).rejects.toThrow('symbolic link');
		expect(openFileMock).not.toHaveBeenCalled();
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
			isFile: () =>
				path.endsWith('.html') ||
				path.endsWith('.png') ||
				path.endsWith('.zip'),
			mtime: new Date('2026-06-21T16:00:00.000Z'),
			mtimeMs: 1,
			size: 2048
		}));

		const preparedImport = await prepareProjectImport(
			'/downloads/Archive Story.zip'
		);

		expect(extractZipMock).toHaveBeenCalledWith(
			'/downloads/Archive Story.zip',
			expect.objectContaining({
				dir: '/tmp/twine-import-abc'
			})
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

	it('does not install watcher resources when canceled during digest capture', async () => {
		const rootPath = '/native/digest-cancel.twine.rs';
		let resolveDigestCapture!: (value: {
			digests: Array<{contentDigest: string; path: string}>;
			failures: [];
			totalSourceBytes: number;
		}) => void;
		const digestCapture = new Promise<{
			digests: Array<{contentDigest: string; path: string}>;
			failures: [];
			totalSourceBytes: number;
		}>(resolvePromise => {
			resolveDigestCapture = resolvePromise;
		});
		const setIntervalSpy = jest.spyOn(global, 'setInterval');
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
			'file = "passages/start.twee"'
		].join('\n');
		readFileMock.mockImplementation(async path =>
			String(path).endsWith('twine.toml')
				? manifestSource
				: '<img src="assets/a.png">'
		);
		listNativeProjectAssetsMock.mockReturnValue([]);
		nativeProjectAssetDigestCaptureAvailableMock.mockReturnValue(true);
		captureNativeProjectAssetDigestsMock.mockReturnValue(digestCapture);
		nativeProjectFileManifestMock.mockReturnValue([
			{
				fingerprint: '1:1',
				kind: 'manifest',
				modifiedAt: '2026-06-21T16:00:00.000Z',
				mtimeMs: 1,
				path: 'twine.toml',
				sizeBytes: 1
			},
			{
				fingerprint: '1:1',
				kind: 'passage',
				modifiedAt: '2026-06-21T16:00:00.000Z',
				mtimeMs: 1,
				path: 'passages/start.twee',
				sizeBytes: 1
			},
			{
				fingerprint: '1:3',
				kind: 'asset',
				modifiedAt: '2026-06-21T16:00:00.000Z',
				mtimeMs: 1,
				path: 'assets/a.png',
				sizeBytes: 3
			}
		]);

		try {
			const start = startProjectSession(rootPath, jest.fn(), ['story-id']);

			for (
				let attempts = 0;
				attempts < 100 &&
				captureNativeProjectAssetDigestsMock.mock.calls.length === 0;
				attempts++
			) {
				await Promise.resolve();
			}
			expect(captureNativeProjectAssetDigestsMock).toHaveBeenCalled();
			stopProjectSession(rootPath);
			resolveDigestCapture({
				digests: [{contentDigest: 'a'.repeat(64), path: 'assets/a.png'}],
				failures: [],
				totalSourceBytes: 3
			});

			await expect(start).rejects.toMatchObject({
				code: 'PROJECT_SESSION_START_CANCELED'
			});
			expect(captureNativeProjectAssetDigestsMock).toHaveBeenCalledTimes(1);
			expect(watchMock).not.toHaveBeenCalled();
			expect(setIntervalSpy).not.toHaveBeenCalled();
		} finally {
			stopProjectSession(rootPath);
			setIntervalSpy.mockRestore();
		}
	});

	it('forces accepted-disk digest recapture when asset metadata is unchanged', async () => {
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
		const assetFiles = ['assets/after.png', 'assets/before.png'].map(path => ({
			fingerprint: '1:3',
			kind: 'asset' as const,
			modifiedAt: '2026-06-21T16:00:00.000Z',
			mtimeMs: 1,
			path,
			sizeBytes: 3
		}));
		const listener = jest.fn();
		let passageSource = '<img src="assets/before.png"> old';
		let digestCaptureCount = 0;

		readFileMock.mockImplementation(async path =>
			String(path).endsWith('twine.toml') ? manifestSource : passageSource
		);
		listNativeProjectAssetsMock.mockReturnValue([]);
		nativeProjectAssetDigestCaptureAvailableMock.mockReturnValue(true);
		captureNativeProjectAssetDigestsMock.mockImplementation(
			async (_rootPath, requests) => ({
				digests: requests.map((request: {path: string}) => ({
					contentDigest: (++digestCaptureCount === 1 ? 'b' : 'a').repeat(64),
					path: request.path
				})),
				failures: [],
				totalSourceBytes: requests.length * 3
			})
		);
		nativeProjectFileManifestMock
			.mockReturnValueOnce([manifestFile, passageFile, ...assetFiles])
			.mockReturnValueOnce([manifestFile, changedPassageFile, ...assetFiles]);

		try {
			const start = await startProjectSession(
				'/native/project.twine.rs',
				listener,
				['story-id']
			);

			expect(start).toEqual(
				expect.objectContaining({
					generation: 1,
					sessionInstanceId: expect.any(String),
					storyIds: ['story-id']
				})
			);
			expect(captureNativeProjectAssetDigestsMock).toHaveBeenLastCalledWith(
				'/native/project.twine.rs',
				[
					{
						expectedModifiedAtMs: 1,
						expectedSizeBytes: 3,
						path: 'assets/before.png'
					}
				]
			);
			passageSource = '<img src="assets/before.png"> new';
			await jest.advanceTimersByTimeAsync(1250);

			expect(listener).toHaveBeenCalledWith(
				expect.objectContaining({
					baseGeneration: 1,
					candidateGeneration: 2,
					changedPaths: ['passages/story/001-start.twee'],
					sessionInstanceId: start.sessionInstanceId,
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
			await resolveProjectSessionConflicts(
				'/native/project.twine.rs',
				'acceptDisk',
				[],
				listener.mock.calls[0][0].id
			);
			expect(captureNativeProjectAssetDigestsMock).toHaveBeenLastCalledWith(
				'/native/project.twine.rs',
				[
					{
						expectedModifiedAtMs: 1,
						expectedSizeBytes: 3,
						path: 'assets/before.png'
					}
				]
			);
			expect(
				projectSessionAssetReadBaselines('/native/project.twine.rs', [
					'assets/before.png'
				])
			).toEqual([
				{
					expectedContentDigest: 'a'.repeat(64),
					expectedExists: true,
					expectedModifiedAtMs: 1,
					expectedSizeBytes: 3,
					path: 'assets/before.png'
				}
			]);
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

	it('maps scoped graph watcher changes for colliding passage IDs', async () => {
		jest.useFakeTimers();
		const manifestSource = [
			'schema_version = 2',
			'name = "Project"',
			'[[stories]]',
			'id = "story-1"',
			'name = "First"',
			'[[stories.passages]]',
			'id = "shared"',
			'name = "First Start"',
			'file = "passages/first/start.twee"',
			'[[stories]]',
			'id = "story-2"',
			'name = "Second"',
			'[[stories.passages]]',
			'id = "shared"',
			'name = "Second Start"',
			'file = "passages/second/start.twee"'
		].join('\n');
		const manifestFile = {
			fingerprint: '1:100',
			kind: 'manifest' as const,
			modifiedAt: '2026-06-21T16:00:00.000Z',
			mtimeMs: 1,
			path: 'twine.toml',
			sizeBytes: 100
		};
		const graphFile = {
			fingerprint: '1:100',
			kind: 'graph' as const,
			modifiedAt: '2026-06-21T16:00:00.000Z',
			mtimeMs: 1,
			path: '.twine/graph.json',
			sizeBytes: 100
		};
		let graph = {
			passages: {
				byStory: {
					'story-1': {
						shared: {bounds: {height: 100, left: 10, top: 20, width: 100}}
					},
					'story-2': {
						shared: {bounds: {height: 100, left: 800, top: 20, width: 100}}
					}
				},
				schema: 2
			}
		};
		const listener = jest.fn();

		readFileMock.mockImplementation(async path =>
			String(path).endsWith('twine.toml') ? manifestSource : ''
		);
		readJsonMock.mockImplementation(async path =>
			String(path).endsWith('.twine/graph.json') ? graph : {}
		);
		listNativeProjectAssetsMock.mockReturnValue([]);
		nativeProjectFileManifestMock
			.mockReturnValueOnce([manifestFile, graphFile])
			.mockReturnValueOnce([
				manifestFile,
				{...graphFile, fingerprint: '2:100', mtimeMs: 2}
			]);

		try {
			await startProjectSession('/native/project.twine.rs', listener, [
				'story-1',
				'story-2'
			]);
			graph = {
				passages: {
					byStory: {
						'story-1': {
							shared: {
								bounds: {height: 100, left: 111, top: 20, width: 100}
							}
						},
						'story-2': {
							shared: {
								bounds: {height: 100, left: 888, top: 20, width: 100}
							}
						}
					},
					schema: 2
				}
			};
			await jest.advanceTimersByTimeAsync(1250);

			expect(listener.mock.calls[0][0].delta.changes).toEqual([
				{
					layout: {height: 100, left: 111, top: 20, width: 100},
					passage_id: 'shared',
					story_id: 'story-1',
					type: 'updatePassageLayout'
				},
				{
					layout: {height: 100, left: 888, top: 20, width: 100},
					passage_id: 'shared',
					story_id: 'story-2',
					type: 'updatePassageLayout'
				}
			]);
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

	it('keeps a committed asset effect successful when baseline refresh fails', async () => {
		const rootPath = '/native/refresh-failure.twine.rs';
		const manifestSource = [
			'schema_version = 1',
			'name = "Project"',
			'[[stories]]',
			'id = "story-id"',
			'name = "Story"',
			'source_layout = "single-twee"',
			'source = "story.twee"'
		].join('\n');
		const fingerprint = createHash('sha256')
			.update('asset bytes')
			.digest('hex');
		let assetExists = true;

		listNativeProjectAssetsMock.mockReturnValue([]);
		nativeProjectFileManifestMock.mockReturnValue([
			{
				fingerprint: '1:1',
				kind: 'manifest',
				modifiedAt: '2026-06-21T16:00:00.000Z',
				mtimeMs: 1,
				path: 'twine.toml',
				sizeBytes: 1
			},
			{
				fingerprint: '1:1',
				kind: 'passage',
				modifiedAt: '2026-06-21T16:00:00.000Z',
				mtimeMs: 1,
				path: 'story.twee',
				sizeBytes: 1
			}
		]);
		readFileMock.mockImplementation(async path => {
			if (String(path).endsWith('twine.toml')) {
				return manifestSource;
			}
			if (String(path).endsWith('assets/cover.png')) {
				if (!assetExists) {
					throw Object.assign(new Error('missing'), {code: 'ENOENT'});
				}
				return 'asset bytes';
			}
			return '';
		});

		try {
			await startProjectSession(rootPath, undefined, ['story-id']);
			readJsonMock.mockResolvedValue({
				afterFingerprint: fingerprint,
				kind: 'import',
				rootPath,
				targetPath: 'assets/cover.png',
				token: 'effect-refresh-failure'
			});
			removeMock.mockImplementation(async path => {
				if (String(path).endsWith('assets/cover.png')) {
					assetExists = false;
				}
			});
			nativeProjectFileManifestMock.mockImplementation(() => {
				throw new Error('baseline refresh failed');
			});

			await expect(
				applyProjectAssetEffect('effect-refresh-failure', 'undo', rootPath)
			).resolves.toBeUndefined();
			expect(assetExists).toBe(false);
		} finally {
			stopProjectSession(rootPath);
		}
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

	it('rejects asset journals bound to a different project root', async () => {
		readJsonMock.mockResolvedValue({
			afterFingerprint: 'expected',
			kind: 'replace',
			rootPath: '/native/other.twine.rs',
			targetPath: 'assets/cover.png',
			token: 'effect-other'
		});

		await expect(
			applyProjectAssetEffect(
				'effect-other',
				'undo',
				'/native/project.twine.rs'
			)
		).rejects.toThrow('does not belong to this project root');
		await expect(
			discardProjectAssetEffect('effect-other', '/native/project.twine.rs')
		).rejects.toThrow('does not belong to this project root');
		expect(removeMock).not.toHaveBeenCalledWith(
			expect.stringContaining('effect-other')
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
