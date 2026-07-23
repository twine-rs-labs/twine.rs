import {mkdir, mkdirp, readdir, remove, stat, writeFile} from 'fs-extra';
import {basename, dirname, join, resolve} from 'path';
import {
	beginScratchPreviewShutdown,
	cleanScratchDirectory,
	maxScratchPreviewAssetBytes,
	maxScratchPreviewBytes,
	maxScratchPreviewSessionBytes,
	openWithScratchFile,
	openWithScratchPackage,
	resumeScratchPreviewsAfterFailedShutdown,
	scratchDirectoryPath
} from '../scratch-file';
import {shell} from 'electron';
import {AppPrefName, getAppPref} from '../app-prefs';

jest.mock('electron');
jest.mock('fs-extra');
jest.mock('../app-prefs');

describe('scratchDirectoryPath', () => {
	const getAppPrefMock = getAppPref as jest.Mock;

	it('returns a localized path to a Scratch directory under the Twine directory by default', () =>
		expect(scratchDirectoryPath()).toBe(
			'mock-electron-app-path-documents/mock-electron-app-name/electron.scratchDirectoryName'
		));

	it('returns the app pref scratchFolderPath if set', () => {
		getAppPrefMock.mockImplementation((name: AppPrefName) => {
			if (name === 'scratchFolderPath') {
				return 'mock-scratch-folder-path';
			}

			throw new Error(`Asked for a non-mocked pref: ${name}`);
		});
		expect(scratchDirectoryPath()).toBe('mock-scratch-folder-path');
	});
});

describe('cleanScratchDirectoryPath', () => {
	const getAppPrefMock = getAppPref as jest.Mock;
	const readdirMock = readdir as jest.Mock;
	const removeMock = remove as jest.Mock;
	const statMock = stat as jest.Mock;

	beforeEach(() => {
		jest.spyOn(console, 'log').mockReturnValue();
	});

	describe('If the scratchFileCleanupAge app pref is undefined', () => {
		beforeEach(() => getAppPrefMock.mockReturnValue(undefined));

		it('deletes .html files older than 3 days', async () => {
			readdirMock.mockResolvedValue([
				{isDirectory: () => false, name: 'deleteme.html'},
				{isDirectory: () => false, name: 'deleteme2.html'}
			]);
			statMock.mockImplementation((name: string) => {
				switch (name) {
					case 'mock-electron-app-path-documents/mock-electron-app-name/electron.scratchDirectoryName/deleteme.html':
						// older than the limit by 1ms
						return {mtimeMs: Date.now() - 1001 * 60 * 60 * 24 * 3};
					case 'mock-electron-app-path-documents/mock-electron-app-name/electron.scratchDirectoryName/deleteme2.html':
						// older by 1 day
						return {mtimeMs: Date.now() - 1000 * 60 * 60 * 24 * 4};
					default:
						throw new Error(`Asked to stat unmocked file: ${name}`);
				}
			});
			await cleanScratchDirectory();
			expect(removeMock.mock.calls).toEqual([
				[
					'mock-electron-app-path-documents/mock-electron-app-name/electron.scratchDirectoryName/deleteme.html'
				],
				[
					'mock-electron-app-path-documents/mock-electron-app-name/electron.scratchDirectoryName/deleteme2.html'
				]
			]);
		});

		it("doesn't delete a .html file less than 3 days old", async () => {
			readdirMock.mockResolvedValue([
				{isDirectory: () => false, name: 'dontdeleteme.html'},
				{isDirectory: () => false, name: 'dontdeleteme2.html'}
			]);
			statMock.mockImplementation((name: string) => {
				switch (name) {
					case 'mock-electron-app-path-documents/mock-electron-app-name/electron.scratchDirectoryName/dontdeleteme.html':
						// younger than the limit by 1ms
						return {mtimeMs: Date.now() - 999 * 60 * 60 * 24 * 3};
					case 'mock-electron-app-path-documents/mock-electron-app-name/electron.scratchDirectoryName/dontdeleteme2.html':
						// younger by 1 day
						return {mtimeMs: Date.now() - 1000 * 60 * 60 * 24 * 2};
					default:
						throw new Error(`Asked to stat unmocked file: ${name}`);
				}
			});
			await cleanScratchDirectory();
			expect(removeMock).not.toHaveBeenCalled();
		});

		it("doesn't delete an old file that has a non-.html suffix", async () => {
			readdirMock.mockResolvedValue([
				{isDirectory: () => false, name: 'dontdeleteme.txt'},
				{isDirectory: () => false, name: 'dontdeleteme2.jpeg'}
			]);
			statMock.mockImplementation(() => ({
				mtimeMs: Date.now() - 1000 * 60 * 60 * 24 * 10
			}));
			await cleanScratchDirectory();
			expect(removeMock).not.toHaveBeenCalled();
		});

		it("doesn't delete an old directory", async () => {
			readdirMock.mockResolvedValue([
				{isDirectory: () => true, name: 'dontdeleteme'}
			]);
			statMock.mockImplementation(() => ({
				mtimeMs: Date.now() - 1001 * 60 * 60 * 24 * 10
			}));
			await cleanScratchDirectory();
			expect(removeMock).not.toHaveBeenCalled();
		});
	});

	describe('If the scratchFileCleanupAge app pref is set to an integer', () => {
		beforeEach(() => {
			getAppPrefMock.mockImplementation((name: AppPrefName) => {
				switch (name) {
					case 'scratchFileCleanupAge':
						// Return a string to test the case where it needs to be converted.
						return '60';

					case 'scratchFolderPath':
						return undefined;

					default:
						throw new Error(`Asked for a non-mocked pref: ${name}`);
				}
			});
		});

		it('deletes .html files older than the limit set', async () => {
			readdirMock.mockResolvedValue([
				{isDirectory: () => false, name: 'deleteme.html'},
				{isDirectory: () => false, name: 'deleteme2.html'}
			]);
			statMock.mockImplementation((name: string) => {
				switch (name) {
					case 'mock-electron-app-path-documents/mock-electron-app-name/electron.scratchDirectoryName/deleteme.html':
						// older than the limit by 1ms
						return {mtimeMs: Date.now() - 1001 * 60 * 60};
					case 'mock-electron-app-path-documents/mock-electron-app-name/electron.scratchDirectoryName/deleteme2.html':
						// older by 1 day
						return {mtimeMs: Date.now() - 1000 * 60 * 60 * 24};
					default:
						throw new Error(`Asked to stat unmocked file: ${name}`);
				}
			});
			await cleanScratchDirectory();
			expect(removeMock.mock.calls).toEqual([
				[
					'mock-electron-app-path-documents/mock-electron-app-name/electron.scratchDirectoryName/deleteme.html'
				],
				[
					'mock-electron-app-path-documents/mock-electron-app-name/electron.scratchDirectoryName/deleteme2.html'
				]
			]);
		});

		it("doesn't delete a .html file less than the limit set", async () => {
			readdirMock.mockResolvedValue([
				{isDirectory: () => false, name: 'dontdeleteme.html'},
				{isDirectory: () => false, name: 'dontdeleteme2.html'}
			]);
			statMock.mockImplementation((name: string) => {
				switch (name) {
					case 'mock-electron-app-path-documents/mock-electron-app-name/electron.scratchDirectoryName/dontdeleteme.html':
						// younger than the limit by 1ms
						return {mtimeMs: Date.now() - 999 * 60 * 60};
					case 'mock-electron-app-path-documents/mock-electron-app-name/electron.scratchDirectoryName/dontdeleteme2.html':
						// younger by 1 day
						return {mtimeMs: Date.now() - 1000 * 60 * 60};
					default:
						throw new Error(`Asked to stat unmocked file: ${name}`);
				}
			});
			await cleanScratchDirectory();
			expect(removeMock).not.toHaveBeenCalled();
		});

		it("doesn't delete an old file that has a non-.html suffix", async () => {
			readdirMock.mockResolvedValue([
				{isDirectory: () => false, name: 'dontdeleteme.txt'},
				{isDirectory: () => false, name: 'dontdeleteme2.jpeg'}
			]);
			statMock.mockImplementation(() => ({
				mtimeMs: Date.now() - 1000 * 60 * 61
			}));
			await cleanScratchDirectory();
			expect(removeMock).not.toHaveBeenCalled();
		});

		it("doesn't delete an old directory", async () => {
			readdirMock.mockResolvedValue([
				{isDirectory: () => true, name: 'dontdeleteme'}
			]);
			statMock.mockImplementation(() => ({
				mtimeMs: Date.now() - 1001 * 60 * 61
			}));
			await cleanScratchDirectory();
			expect(removeMock).not.toHaveBeenCalled();
		});
	});

	describe('If the scratchFileCleanupAge app pref is set to an invalid value', () => {
		beforeEach(() => {
			getAppPrefMock.mockImplementation((name: AppPrefName) => {
				switch (name) {
					case 'scratchFileCleanupAge':
						return 'bad';

					case 'scratchFolderPath':
						return undefined;

					default:
						throw new Error(`Asked for a non-mocked pref: ${name}`);
				}
			});
		});

		it('deletes .html files older than 3 days', async () => {
			readdirMock.mockResolvedValue([
				{isDirectory: () => false, name: 'deleteme.html'},
				{isDirectory: () => false, name: 'deleteme2.html'}
			]);
			statMock.mockImplementation((name: string) => {
				switch (name) {
					case 'mock-electron-app-path-documents/mock-electron-app-name/electron.scratchDirectoryName/deleteme.html':
						// older than the limit by 1ms
						return {mtimeMs: Date.now() - 1001 * 60 * 60 * 24 * 3};
					case 'mock-electron-app-path-documents/mock-electron-app-name/electron.scratchDirectoryName/deleteme2.html':
						// older by 1 day
						return {mtimeMs: Date.now() - 1000 * 60 * 60 * 24 * 4};
					default:
						throw new Error(`Asked to stat unmocked file: ${name}`);
				}
			});
			await cleanScratchDirectory();
			expect(removeMock.mock.calls).toEqual([
				[
					'mock-electron-app-path-documents/mock-electron-app-name/electron.scratchDirectoryName/deleteme.html'
				],
				[
					'mock-electron-app-path-documents/mock-electron-app-name/electron.scratchDirectoryName/deleteme2.html'
				]
			]);
		});

		it("doesn't delete a .html file less than 3 days old", async () => {
			readdirMock.mockResolvedValue([
				{isDirectory: () => false, name: 'dontdeleteme.html'},
				{isDirectory: () => false, name: 'dontdeleteme2.html'}
			]);
			statMock.mockImplementation((name: string) => {
				switch (name) {
					case 'mock-electron-app-path-documents/mock-electron-app-name/electron.scratchDirectoryName/dontdeleteme.html':
						// younger than the limit by 1ms
						return {mtimeMs: Date.now() - 999 * 60 * 60 * 24 * 3};
					case 'mock-electron-app-path-documents/mock-electron-app-name/electron.scratchDirectoryName/dontdeleteme2.html':
						// younger by 1 day
						return {mtimeMs: Date.now() - 1000 * 60 * 60 * 24 * 2};
					default:
						throw new Error(`Asked to stat unmocked file: ${name}`);
				}
			});
			await cleanScratchDirectory();
			expect(removeMock).not.toHaveBeenCalled();
		});

		it("doesn't delete an old file that has a non-.html suffix", async () => {
			readdirMock.mockResolvedValue([
				{isDirectory: () => false, name: 'dontdeleteme.txt'},
				{isDirectory: () => false, name: 'dontdeleteme2.jpeg'}
			]);
			statMock.mockImplementation(() => ({
				mtimeMs: Date.now() - 1000 * 60 * 60 * 24 * 10
			}));
			await cleanScratchDirectory();
			expect(removeMock).not.toHaveBeenCalled();
		});

		it("doesn't delete an old directory", async () => {
			readdirMock.mockResolvedValue([
				{isDirectory: () => true, name: 'dontdeleteme'}
			]);
			statMock.mockImplementation(() => ({
				mtimeMs: Date.now() - 1001 * 60 * 60 * 24 * 10
			}));
			await cleanScratchDirectory();
			expect(removeMock).not.toHaveBeenCalled();
		});
	});
});

describe('openWithScratchFile', () => {
	const mkdirpMock = mkdirp as jest.Mock;
	const openMock = shell.openPath as jest.Mock;
	const writeFileMock = writeFile as jest.Mock;

	beforeEach(() => openMock.mockResolvedValue(''));

	it("creates the scratch directory if it doesn't already exist", async () => {
		await openWithScratchFile('mock-data');
		expect(mkdirpMock.mock.calls).toEqual([[scratchDirectoryPath()]]);
	});

	it('rejects if creating the scratch directory fails', async () => {
		const error = new Error();

		mkdirpMock.mockRejectedValue(error);
		await expect(() => openWithScratchFile('mock-data')).rejects.toBe(error);
	});

	it('creates an unpredictable HTML file exclusively in the scratch directory', async () => {
		await openWithScratchFile('mock-data');
		expect(writeFileMock).toHaveBeenCalledWith(
			expect.stringMatching(
				/mock-electron-app-path-documents\/mock-electron-app-name\/electron\.scratchDirectoryName\/preview-[0-9a-f-]+\/index\.html$/
			),
			'mock-data',
			{encoding: 'utf8', flag: 'wx'}
		);
	});

	it('opens the file once written to', async () => {
		await openWithScratchFile('mock-data');
		expect(openMock).toHaveBeenCalledTimes(1);
		expect(openMock.mock.calls[0]).toEqual([writeFileMock.mock.calls[0][0]]);
	});

	it('rejects if the operating system cannot open the file', async () => {
		openMock.mockResolvedValueOnce('No application can open this file.');

		await expect(openWithScratchFile('mock-data')).rejects.toThrow(
			'No application can open this file.'
		);
	});

	it('rejects oversized preview data before writing it', async () => {
		const byteLengthSpy = jest
			.spyOn(Buffer, 'byteLength')
			.mockReturnValue(maxScratchPreviewBytes + 1);

		try {
			await expect(openWithScratchFile('oversized')).rejects.toThrow(
				'safe payload limit'
			);
		} finally {
			byteLengthSpy.mockRestore();
		}
		expect(writeFileMock).not.toHaveBeenCalled();
	});
});

describe('openWithScratchPackage', () => {
	const mkdirMock = mkdir as jest.Mock;
	const mkdirpMock = mkdirp as jest.Mock;
	const openMock = shell.openPath as jest.Mock;
	const readdirMock = readdir as jest.Mock;
	const removeMock = remove as jest.Mock;
	const statMock = stat as jest.Mock;
	const writeFileMock = writeFile as jest.Mock;

	beforeEach(() => {
		jest.spyOn(console, 'log').mockImplementation();
		openMock.mockResolvedValue('');
		readdirMock.mockResolvedValue([]);
	});

	it('writes bounded asset bytes into an isolated preview directory', async () => {
		await openWithScratchPackage('mock-data', [
			{bytes: new Uint8Array([1, 2, 3]), outputPath: 'assets/cover.png'}
		]);

		expect(mkdirpMock).toHaveBeenCalledWith(
			expect.stringMatching(/\/preview-[0-9a-f-]+\/assets$/)
		);
		expect(writeFileMock).toHaveBeenCalledWith(
			expect.stringMatching(/\/preview-[0-9a-f-]+\/assets\/cover\.png$/),
			new Uint8Array([1, 2, 3]),
			{flag: 'wx'}
		);
		expect(writeFileMock).toHaveBeenCalledWith(
			expect.stringMatching(/\/preview-[0-9a-f-]+\/index\.html$/),
			'mock-data',
			{encoding: 'utf8', flag: 'wx'}
		);
		expect(openMock).toHaveBeenCalledWith(
			expect.stringMatching(/\/preview-[0-9a-f-]+\/index\.html$/)
		);
	});

	it('isolates simultaneous projects with colliding and missing asset names', async () => {
		await openWithScratchPackage('project-a', [
			{bytes: new Uint8Array([1]), outputPath: 'assets/cover.png'},
			{bytes: new Uint8Array([3]), outputPath: 'assets/only-a.png'}
		]);
		await openWithScratchPackage('project-b', [
			{bytes: new Uint8Array([2]), outputPath: 'assets/cover.png'}
		]);

		const [projectAPath, projectBPath] = openMock.mock.calls.map(
			([path]) => path
		);
		const projectARoot = dirname(projectAPath);
		const projectBRoot = dirname(projectBPath);

		expect(projectARoot).not.toBe(projectBRoot);
		expect(writeFileMock).toHaveBeenCalledWith(
			join(resolve(projectARoot), 'assets', 'cover.png'),
			new Uint8Array([1]),
			{flag: 'wx'}
		);
		expect(writeFileMock).toHaveBeenCalledWith(
			join(resolve(projectARoot), 'assets', 'only-a.png'),
			new Uint8Array([3]),
			{flag: 'wx'}
		);
		expect(writeFileMock).toHaveBeenCalledWith(
			join(resolve(projectBRoot), 'assets', 'cover.png'),
			new Uint8Array([2]),
			{flag: 'wx'}
		);
		expect(writeFileMock).not.toHaveBeenCalledWith(
			join(resolve(projectBRoot), 'assets', 'only-a.png'),
			expect.anything(),
			expect.anything()
		);
	});

	it('rejects unsafe asset output paths', async () => {
		await expect(() =>
			openWithScratchPackage('mock-data', [
				{bytes: new Uint8Array([1]), outputPath: '../cover.png'}
			])
		).rejects.toThrow('Unsafe scratch asset path');
	});

	it('rejects asset bytes above the per-preview quota', async () => {
		const bytes = new Uint8Array(1);
		Object.defineProperty(bytes, 'byteLength', {
			value: maxScratchPreviewAssetBytes + 1
		});

		await expect(
			openWithScratchPackage('mock-data', [
				{bytes, outputPath: 'assets/cover.png'}
			])
		).rejects.toThrow('safe byte limit');
		expect(writeFileMock).not.toHaveBeenCalled();
	});

	it('removes expired preview directories left by an earlier session', async () => {
		const entries = Array.from({length: 3}, (_, index) => ({
			isDirectory: () => true,
			name: `preview-00000000-0000-4000-8000-00000000000${index}`
		}));
		readdirMock.mockResolvedValueOnce(entries);
		statMock.mockResolvedValue({
			mtimeMs: Date.now() - 1001 * 60 * 60 * 24 * 3
		});

		await openWithScratchPackage('mock-data');

		expect(removeMock).toHaveBeenCalledTimes(3);
		expect(removeMock).toHaveBeenCalledWith(
			expect.stringMatching(/preview-00000000-0000-4000-8000-000000000000$/)
		);
	});

	it('preserves recent previews owned by another app session', async () => {
		readdirMock.mockResolvedValueOnce([
			{
				isDirectory: () => true,
				name: 'preview-00000000-0000-4000-8000-000000000000'
			}
		]);
		statMock.mockResolvedValueOnce({mtimeMs: Date.now()});

		await openWithScratchPackage('mock-data');

		expect(removeMock).not.toHaveBeenCalled();
	});

	it('does not evict live previews when more than three are open', async () => {
		for (let index = 0; index < 3; index++) {
			await openWithScratchPackage(`project-${index}`);
		}
		const previewRoots = openMock.mock.calls.map(([path]) => dirname(path));

		readdirMock.mockResolvedValueOnce(
			previewRoots.map(root => ({
				isDirectory: () => true,
				name: basename(root)
			}))
		);
		await openWithScratchPackage('project-3');

		expect(openMock).toHaveBeenCalledTimes(4);
		expect(removeMock).not.toHaveBeenCalled();
	});

	it('rejects if the operating system cannot open the package', async () => {
		openMock.mockResolvedValueOnce('Preview launch failed.');

		await expect(openWithScratchPackage('mock-data')).rejects.toThrow(
			'Preview launch failed.'
		);
		expect(removeMock).toHaveBeenCalledWith(
			dirname(writeFileMock.mock.calls.at(-1)?.[0])
		);
	});

	it('removes a partially written preview package', async () => {
		const writeError = new Error('Asset write failed.');

		writeFileMock.mockRejectedValueOnce(writeError);
		await expect(
			openWithScratchPackage('mock-data', [
				{bytes: new Uint8Array([1]), outputPath: 'assets/cover.png'}
			])
		).rejects.toBe(writeError);
		expect(removeMock).toHaveBeenCalledWith(mkdirMock.mock.calls[0][0]);
	});

	it('removes a successful preview package during session cleanup', async () => {
		await openWithScratchPackage('mock-data');
		const previewRoot = dirname(openMock.mock.calls[0][0]);

		readdirMock.mockResolvedValueOnce([
			{isDirectory: () => true, name: basename(previewRoot)}
		]);
		statMock.mockResolvedValueOnce({mtimeMs: Date.now()});
		await cleanScratchDirectory();

		expect(removeMock).toHaveBeenCalledWith(previewRoot);
	});

	it('rejects new previews after reaching the aggregate session quota', async () => {
		const previewPartBytes = 49 * 1024 * 1024;
		const bytes = new Uint8Array(1);
		const byteLengthSpy = jest
			.spyOn(Buffer, 'byteLength')
			.mockReturnValue(previewPartBytes);

		Object.defineProperty(bytes, 'byteLength', {value: previewPartBytes});
		try {
			for (let index = 0; index < 3; index++) {
				await openWithScratchPackage(`large-${index}`, [
					{bytes, outputPath: 'assets/large.bin'}
				]);
			}
			await expect(
				openWithScratchPackage('over-limit', [
					{bytes, outputPath: 'assets/large.bin'}
				])
			).rejects.toThrow('session exceeds the safe byte limit');
		} finally {
			byteLengthSpy.mockRestore();
		}
		expect(openMock).toHaveBeenCalledTimes(3);
		expect(maxScratchPreviewSessionBytes).toBe(300 * 1024 * 1024);
	});

	it('waits for an in-flight launch and rejects new launches during cleanup', async () => {
		let finishOpen: (error: string) => void = () => {};
		const opening = new Promise<string>(resolve => {
			finishOpen = resolve;
		});

		openMock.mockReturnValue(opening);
		const launch = openWithScratchPackage('in-flight');
		for (let index = 0; index < 10; index++) {
			await Promise.resolve();
		}
		const previewRoot = dirname(openMock.mock.calls[0][0]);

		readdirMock.mockResolvedValueOnce([
			{isDirectory: () => true, name: basename(previewRoot)}
		]);
		statMock.mockResolvedValueOnce({mtimeMs: Date.now()});
		beginScratchPreviewShutdown();
		const cleanup = cleanScratchDirectory();

		await expect(openWithScratchPackage('too-late')).rejects.toThrow(
			'app is quitting'
		);
		expect(removeMock).not.toHaveBeenCalled();

		finishOpen('');
		await launch;
		await cleanup;
		expect(removeMock).toHaveBeenCalledWith(previewRoot);

		resumeScratchPreviewsAfterFailedShutdown();
		openMock.mockResolvedValue('');
		await openWithScratchPackage('retry-after-canceled-quit');
		expect(openMock).toHaveBeenCalledTimes(2);
	});
});
