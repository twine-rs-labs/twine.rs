import {
	existsSync,
	mkdtempSync,
	mkdirSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {
	forgetNativeProjectFolder,
	listRememberedNativeProjectFolders,
	rememberNativeProjectFolder,
	rememberNativeProjectFolderStrict
} from '../native';
import {getStoryDirectoryPath} from '../story-directory';
import {
	forgetProjectFolder,
	rememberedProjectFolders,
	rememberProjectFolder,
	rememberProjectFolderStrict
} from '../project-library-index';
import {
	duplicateStagingMarker,
	duplicateStagingMarkerFilename
} from '../project-duplication-staging';

jest.mock('../native', () => ({
	forgetNativeProjectFolder: jest.fn(),
	listRememberedNativeProjectFolders: jest.fn(),
	rememberNativeProjectFolder: jest.fn(),
	rememberNativeProjectFolderStrict: jest.fn()
}));
jest.mock('../story-directory', () => ({
	getStoryDirectoryPath: jest.fn()
}));

describe('project library index', () => {
	const forgetNativeProjectFolderMock = forgetNativeProjectFolder as jest.Mock;
	const listRememberedNativeProjectFoldersMock =
		listRememberedNativeProjectFolders as jest.Mock;
	const rememberNativeProjectFolderMock =
		rememberNativeProjectFolder as jest.Mock;
	const rememberNativeProjectFolderStrictMock =
		rememberNativeProjectFolderStrict as jest.Mock;
	const getStoryDirectoryPathMock = getStoryDirectoryPath as jest.Mock;

	beforeEach(() => {
		jest.clearAllMocks();
		listRememberedNativeProjectFoldersMock.mockReturnValue([]);
		getStoryDirectoryPathMock.mockReturnValue('mock-story-library');
	});

	it('stores in-library project paths relative to the story library', () => {
		rememberProjectFolder({
			passageTextLoaded: false,
			rootPath: 'mock-story-library/Projects/moon-castle.twine.rs',
			stories: [],
			storyIds: ['story-id']
		});

		expect(rememberNativeProjectFolderMock).toHaveBeenCalledWith(
			'mock-story-library/.twine/native-projects.json',
			expect.objectContaining({
				rootPath: 'Projects/moon-castle.twine.rs',
				storyIds: ['story-id']
			})
		);
	});

	it('uses strict registration only when explicitly requested', () => {
		const project = {
			passageTextLoaded: false,
			rootPath: 'mock-story-library/Projects/moon-castle.twine.rs',
			stories: [],
			storyIds: ['story-id']
		};

		rememberProjectFolder(project);
		rememberProjectFolderStrict(project);

		expect(rememberNativeProjectFolderMock).toHaveBeenCalledTimes(1);
		expect(rememberNativeProjectFolderStrictMock).toHaveBeenCalledTimes(1);
		expect(rememberNativeProjectFolderStrictMock).toHaveBeenCalledWith(
			'mock-story-library/.twine/native-projects.json',
			expect.objectContaining({
				rootPath: 'Projects/moon-castle.twine.rs',
				storyIds: ['story-id']
			})
		);
	});

	it('returns remembered relative project paths as absolute paths', () => {
		listRememberedNativeProjectFoldersMock.mockReturnValue([
			{
				rootPath: 'Projects/moon-castle.twine.rs',
				storyIds: ['story-id'],
				updatedAt: '2026-06-23T12:00:00.000Z'
			}
		]);

		expect(rememberedProjectFolders()).toEqual([
			{
				rootPath: expect.stringMatching(
					/mock-story-library\/Projects\/moon-castle\.twine\.rs$/
				),
				storyIds: ['story-id'],
				updatedAt: '2026-06-23T12:00:00.000Z'
			}
		]);
	});

	it('deduplicates remembered project paths after resolving them', () => {
		listRememberedNativeProjectFoldersMock.mockReturnValue([
			{
				rootPath: 'Projects/moon-castle.twine.rs',
				storyIds: ['old-story-id'],
				updatedAt: '2026-06-23T12:00:00.000Z'
			},
			{
				rootPath: `${process.cwd()}/mock-story-library/Projects/moon-castle.twine.rs`,
				storyIds: ['new-story-id'],
				updatedAt: '2026-06-23T12:05:00.000Z'
			}
		]);

		expect(rememberedProjectFolders()).toEqual([
			expect.objectContaining({
				rootPath: expect.stringMatching(
					/mock-story-library\/Projects\/moon-castle\.twine\.rs$/
				),
				storyIds: ['new-story-id']
			})
		]);
	});

	it('deduplicates filesystem aliases and keeps them removable after deletion', () => {
		if (process.platform === 'win32') {
			return;
		}

		const parentPath = mkdtempSync(join(tmpdir(), 'twine-project-alias-'));
		const realLibraryPath = join(parentPath, 'real-library');
		const aliasLibraryPath = join(parentPath, 'alias-library');
		const projectRelativePath = 'Projects/moon-castle.twine.rs';
		const projectPath = join(realLibraryPath, projectRelativePath);
		const aliasedProjectPath = join(aliasLibraryPath, projectRelativePath);

		try {
			mkdirSync(projectPath, {recursive: true});
			symlinkSync(realLibraryPath, aliasLibraryPath, 'dir');
			const canonicalProjectPath = realpathSync.native(projectPath);
			const nativeRealpathSpy = jest.spyOn(realpathSync, 'native');

			getStoryDirectoryPathMock.mockReturnValue(aliasLibraryPath);
			listRememberedNativeProjectFoldersMock.mockReturnValue([
				{
					rootPath: projectPath,
					storyIds: ['old-story-id'],
					updatedAt: '2026-06-23T12:00:00.000Z'
				},
				{
					rootPath: projectRelativePath,
					storyIds: ['new-story-id'],
					updatedAt: '2026-06-23T12:05:00.000Z'
				}
			]);

			expect(rememberedProjectFolders()).toEqual([
				expect.objectContaining({
					rootPath: canonicalProjectPath,
					storyIds: ['new-story-id']
				})
			]);
			expect(nativeRealpathSpy).toHaveBeenCalledWith(aliasLibraryPath);
			expect(forgetNativeProjectFolderMock).toHaveBeenCalledWith(
				expect.any(String),
				projectPath
			);
			expect(forgetNativeProjectFolderMock).toHaveBeenCalledWith(
				expect.any(String),
				projectRelativePath
			);
			expect(rememberNativeProjectFolderMock).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					rootPath: projectRelativePath,
					storyIds: ['new-story-id']
				})
			);

			forgetNativeProjectFolderMock.mockClear();
			rmSync(projectPath, {force: true, recursive: true});
			forgetProjectFolder(aliasedProjectPath);

			expect(forgetNativeProjectFolderMock).toHaveBeenCalledWith(
				expect.any(String),
				projectRelativePath
			);
			nativeRealpathSpy.mockRestore();
		} finally {
			jest.restoreAllMocks();
			rmSync(parentPath, {force: true, recursive: true});
		}
	});

	it('migrates existing absolute in-library project paths to relative paths', () => {
		listRememberedNativeProjectFoldersMock.mockReturnValue([
			{
				rootPath: `${process.cwd()}/mock-story-library/Projects/moon-castle.twine.rs`,
				storyIds: ['story-id'],
				updatedAt: '2026-06-23T12:00:00.000Z'
			}
		]);

		rememberedProjectFolders();

		expect(forgetNativeProjectFolderMock).toHaveBeenCalledWith(
			'mock-story-library/.twine/native-projects.json',
			`${process.cwd()}/mock-story-library/Projects/moon-castle.twine.rs`
		);
		expect(rememberNativeProjectFolderMock).toHaveBeenCalledWith(
			'mock-story-library/.twine/native-projects.json',
			expect.objectContaining({
				rootPath: 'Projects/moon-castle.twine.rs',
				storyIds: ['story-id']
			})
		);
	});

	it('forgets both relative and legacy absolute forms for in-library projects', () => {
		forgetProjectFolder('mock-story-library/Projects/moon-castle.twine.rs');

		expect(forgetNativeProjectFolderMock).toHaveBeenCalledWith(
			'mock-story-library/.twine/native-projects.json',
			'Projects/moon-castle.twine.rs'
		);
		expect(forgetNativeProjectFolderMock).toHaveBeenCalledWith(
			'mock-story-library/.twine/native-projects.json',
			'mock-story-library/Projects/moon-castle.twine.rs'
		);
	});

	it('cleans old orphaned duplication staging folders on startup', () => {
		const parentPath = mkdtempSync(join(tmpdir(), 'twine-project-library-'));
		const projectPath = join(parentPath, 'remembered.twine.rs');
		const stagingPath = join(parentPath, '.twine-rs-duplicate-orphan');
		const savePath = join(
			parentPath,
			'..twine-rs-duplicate-orphan.save-123456'
		);
		const retiredPath = join(
			parentPath,
			'.twine-rs-duplicate-orphan.retired-123456'
		);
		const unmarkedPath = join(parentPath, '.twine-rs-duplicate-safety');
		const activePath = join(parentPath, '.twine-rs-duplicate-active');
		const oversizedPath = join(parentPath, '.twine-rs-duplicate-hugeXX');
		const symlinkPath = join(parentPath, '.twine-rs-duplicate-linkXX');
		const markerTarget = join(parentPath, 'marker-target.json');
		const killSpy = jest.spyOn(process, 'kill').mockImplementation(pid => {
			if (pid === process.pid) {
				return true;
			}
			throw Object.assign(new Error('missing process'), {code: 'ESRCH'});
		});

		try {
			mkdirSync(projectPath);
			mkdirSync(stagingPath);
			mkdirSync(savePath);
			mkdirSync(retiredPath);
			mkdirSync(unmarkedPath);
			mkdirSync(activePath);
			mkdirSync(oversizedPath);
			mkdirSync(symlinkPath);

			writeFileSync(
				join(stagingPath, duplicateStagingMarkerFilename),
				duplicateStagingMarker(Date.now() - 25 * 60 * 60 * 1000, 12345)
			);
			writeFileSync(
				join(activePath, duplicateStagingMarkerFilename),
				duplicateStagingMarker(Date.now() - 25 * 60 * 60 * 1000, process.pid)
			);
			writeFileSync(
				join(oversizedPath, duplicateStagingMarkerFilename),
				'x'.repeat(513)
			);
			writeFileSync(
				markerTarget,
				duplicateStagingMarker(Date.now() - 25 * 60 * 60 * 1000, 12345)
			);
			if (process.platform !== 'win32') {
				symlinkSync(
					markerTarget,
					join(symlinkPath, duplicateStagingMarkerFilename)
				);
			}
			listRememberedNativeProjectFoldersMock.mockReturnValue([
				{
					rootPath: projectPath,
					storyIds: ['story-id'],
					updatedAt: '2026-06-23T12:00:00.000Z'
				}
			]);

			rememberedProjectFolders();

			expect(existsSync(stagingPath)).toBe(false);
			expect(existsSync(savePath)).toBe(false);
			expect(existsSync(retiredPath)).toBe(false);
			expect(existsSync(unmarkedPath)).toBe(true);
			expect(existsSync(activePath)).toBe(true);
			expect(existsSync(oversizedPath)).toBe(true);
			expect(existsSync(symlinkPath)).toBe(true);
		} finally {
			killSpy.mockRestore();
			rmSync(parentPath, {force: true, recursive: true});
		}
	});
});
