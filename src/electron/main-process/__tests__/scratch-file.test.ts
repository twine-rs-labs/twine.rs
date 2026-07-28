import {mkdir, mkdirp, readdir, remove, stat, writeFile} from 'fs-extra';
import {basename, dirname, join, resolve} from 'path';
import {
	beginScratchPreviewShutdown,
	cleanScratchDirectory,
	maxScratchPreviewAssetBytes,
	maxScratchPreviewBytes,
	maxScratchPreviewSessionBytes,
	releaseScratchPreviewPackage,
	resumeScratchPreviewsAfterFailedShutdown,
	scratchDirectoryPath,
	stageScratchPreviewPackage
} from '../scratch-file';
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

describe('staged scratch previews', () => {
	const mkdirMock = mkdir as jest.Mock;
	const mkdirpMock = mkdirp as jest.Mock;
	const readdirMock = readdir as jest.Mock;
	const removeMock = remove as jest.Mock;
	const statMock = stat as jest.Mock;
	const writeFileMock = writeFile as jest.Mock;
	const stagedPackages: Awaited<
		ReturnType<typeof stageScratchPreviewPackage>
	>[] = [];

	async function stage(
		data: string,
		assets: Parameters<typeof stageScratchPreviewPackage>[1] = []
	) {
		const stagedPackage = await stageScratchPreviewPackage(data, assets);

		stagedPackages.push(stagedPackage);
		return stagedPackage;
	}

	beforeEach(() => {
		jest.spyOn(console, 'log').mockImplementation();
		readdirMock.mockResolvedValue([]);
	});

	afterEach(async () => {
		for (const stagedPackage of stagedPackages.splice(0)) {
			await releaseScratchPreviewPackage(stagedPackage);
		}
	});

	it("creates the scratch directory if it doesn't already exist", async () => {
		await stage('mock-data');
		expect(mkdirpMock.mock.calls).toEqual([[scratchDirectoryPath()]]);
	});

	it('rejects if creating the scratch directory fails', async () => {
		const error = new Error();

		mkdirpMock.mockRejectedValueOnce(error);
		await expect(stageScratchPreviewPackage('mock-data')).rejects.toBe(error);
	});

	it('creates an unpredictable HTML file exclusively in the scratch directory', async () => {
		const stagedPackage = await stage('mock-data');

		expect(writeFileMock).toHaveBeenCalledWith(
			expect.stringMatching(
				/mock-electron-app-path-documents\/mock-electron-app-name\/electron\.scratchDirectoryName\/preview-[0-9a-f-]+\/index\.html$/
			),
			'mock-data',
			{encoding: 'utf8', flag: 'wx'}
		);
		expect(stagedPackage).toEqual(
			expect.objectContaining({
				indexPath: expect.stringMatching(/\/index\.html$/),
				rootPath: dirname(stagedPackage.indexPath),
				sizeBytes: Buffer.byteLength('mock-data')
			})
		);
		expect(stagedPackage.files).toEqual([
			expect.objectContaining({
				mediaType: 'text/html; charset=utf-8',
				outputPath: 'index.html',
				path: stagedPackage.indexPath,
				sizeBytes: Buffer.byteLength('mock-data')
			})
		]);
	});

	it('rejects oversized preview data before writing it', async () => {
		const byteLengthSpy = jest
			.spyOn(Buffer, 'byteLength')
			.mockReturnValue(maxScratchPreviewBytes + 1);

		try {
			await expect(stageScratchPreviewPackage('oversized')).rejects.toThrow(
				'safe payload limit'
			);
		} finally {
			byteLengthSpy.mockRestore();
		}
		expect(writeFileMock).not.toHaveBeenCalled();
	});

	it('writes bounded asset bytes into an isolated preview directory', async () => {
		const stagedPackage = await stage('mock-data', [
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
		expect(stagedPackage.files).toEqual([
			expect.objectContaining({outputPath: 'index.html'}),
			expect.objectContaining({
				bytes: new Uint8Array([1, 2, 3]),
				outputPath: 'assets/cover.png',
				sizeBytes: 3
			})
		]);
	});

	it('isolates simultaneous projects with colliding and missing asset names', async () => {
		const projectA = await stage('project-a', [
			{bytes: new Uint8Array([1]), outputPath: 'assets/cover.png'},
			{bytes: new Uint8Array([3]), outputPath: 'assets/only-a.png'}
		]);
		const projectB = await stage('project-b', [
			{bytes: new Uint8Array([2]), outputPath: 'assets/cover.png'}
		]);
		const projectARoot = projectA.rootPath;
		const projectBRoot = projectB.rootPath;

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
			stageScratchPreviewPackage('mock-data', [
				{bytes: new Uint8Array([1]), outputPath: '../cover.png'}
			])
		).rejects.toThrow('Unsafe scratch asset path');
	});

	it('reserves index.html for the staged story document', async () => {
		await expect(() =>
			stageScratchPreviewPackage('mock-data', [
				{bytes: new Uint8Array([1]), outputPath: './index.html'}
			])
		).rejects.toThrow('Unsafe scratch asset path');
	});

	it('returns an owned staged package and releases it idempotently', async () => {
		const stagedPackage = await stage('mock-data', [
			{bytes: new Uint8Array([1, 2]), outputPath: 'assets/a.bin'}
		]);

		expect(stagedPackage.files).toEqual([
			expect.objectContaining({
				outputPath: 'index.html',
				sizeBytes: Buffer.byteLength('mock-data')
			}),
			expect.objectContaining({outputPath: 'assets/a.bin', sizeBytes: 2})
		]);

		await releaseScratchPreviewPackage(stagedPackage);
		await releaseScratchPreviewPackage(stagedPackage);
		expect(removeMock).toHaveBeenCalledTimes(1);
		expect(removeMock).toHaveBeenCalledWith(stagedPackage.rootPath);
	});

	it('rejects asset bytes above the per-preview quota', async () => {
		const bytes = new Uint8Array(1);
		Object.defineProperty(bytes, 'byteLength', {
			value: maxScratchPreviewAssetBytes + 1
		});

		await expect(
			stageScratchPreviewPackage('mock-data', [
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

		await stage('mock-data');

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

		await stage('mock-data');

		expect(removeMock).not.toHaveBeenCalled();
	});

	it('does not evict live staged previews when more than three are open', async () => {
		const previewRoots: string[] = [];

		for (let index = 0; index < 3; index++) {
			previewRoots.push((await stage(`project-${index}`)).rootPath);
		}

		readdirMock.mockResolvedValueOnce(
			previewRoots.map(root => ({
				isDirectory: () => true,
				name: basename(root)
			}))
		);
		await stage('project-3');

		expect(removeMock).not.toHaveBeenCalled();
	});

	it('removes a partially written preview package', async () => {
		const writeError = new Error('Asset write failed.');

		writeFileMock.mockRejectedValueOnce(writeError);
		await expect(
			stageScratchPreviewPackage('mock-data', [
				{bytes: new Uint8Array([1]), outputPath: 'assets/cover.png'}
			])
		).rejects.toBe(writeError);
		expect(removeMock).toHaveBeenCalledWith(mkdirMock.mock.calls[0][0]);
	});

	it('removes a staged preview package during session cleanup', async () => {
		const stagedPackage = await stage('mock-data');

		readdirMock.mockResolvedValueOnce([
			{isDirectory: () => true, name: basename(stagedPackage.rootPath)}
		]);
		statMock.mockResolvedValueOnce({mtimeMs: Date.now()});
		await cleanScratchDirectory();

		expect(removeMock).toHaveBeenCalledWith(stagedPackage.rootPath);
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
				await stage(`large-${index}`, [
					{bytes, outputPath: 'assets/large.bin'}
				]);
			}
			await expect(
				stageScratchPreviewPackage('over-limit', [
					{bytes, outputPath: 'assets/large.bin'}
				])
			).rejects.toThrow('session exceeds the safe byte limit');
		} finally {
			byteLengthSpy.mockRestore();
		}
		expect(maxScratchPreviewSessionBytes).toBe(300 * 1024 * 1024);
	});

	it('waits for in-flight staging and rejects new packages during cleanup', async () => {
		let finishWrite: () => void = () => {};
		const writing = new Promise<void>(resolve => {
			finishWrite = resolve;
		});

		writeFileMock.mockReturnValueOnce(writing);
		const staging = stageScratchPreviewPackage('in-flight');
		for (let index = 0; index < 10; index++) {
			await Promise.resolve();
		}
		const previewRoot = mkdirMock.mock.calls[0][0];

		readdirMock.mockResolvedValueOnce([
			{isDirectory: () => true, name: basename(previewRoot)}
		]);
		statMock.mockResolvedValueOnce({mtimeMs: Date.now()});
		beginScratchPreviewShutdown();
		const cleanup = cleanScratchDirectory();

		await expect(stageScratchPreviewPackage('too-late')).rejects.toThrow(
			'app is quitting'
		);
		expect(removeMock).not.toHaveBeenCalled();

		finishWrite();
		stagedPackages.push(await staging);
		await cleanup;
		expect(removeMock).toHaveBeenCalledWith(previewRoot);

		resumeScratchPreviewsAfterFailedShutdown();
		await stage('retry-after-canceled-quit');
	});
});
