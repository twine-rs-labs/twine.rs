import {app, dialog, shell} from 'electron';
import {copy, mkdirp, readdir, remove, stat} from 'fs-extra';
import {getAppPref, setAppPref} from '../app-prefs';
import {showRelaunchDialog} from '../relaunch-dialog';
import {
	backupStoryDirectory,
	createStoryDirectory,
	revealStoryDirectory,
	getStoryDirectoryPath,
	initStoryDirectory,
	chooseStoryDirectoryPath,
	resetStoryDirectoryPath
} from '../story-directory';

jest.mock('electron');
jest.mock('fs-extra');
jest.mock('../app-prefs');
jest.mock('../relaunch-dialog');

const getAppPrefMock = getAppPref as jest.Mock;
const setAppPrefMock = setAppPref as jest.Mock;

beforeEach(() => {
	getAppPrefMock.mockImplementation((name: string) => {
		if (['backupFolderPath', 'storyLibraryFolderPath'].includes(name)) {
			return undefined;
		}

		return undefined;
	});
});

describe('backupStoryDirectory()', () => {
	const copyMock = copy as jest.Mock;
	const mkdirpMock = mkdirp as jest.Mock;
	const readdirMock = readdir as jest.Mock;
	const removeMock = remove as jest.Mock;
	const statMock = stat as jest.Mock;

	beforeEach(() => {
		readdirMock.mockResolvedValue([
			{isDirectory: () => true, name: 'mock-backup-1'},
			{isDirectory: () => true, name: 'mock-backup-2'}
		]);
		statMock.mockImplementation((name: string) => {
			switch (name) {
				case 'mock-electron-app-path-documents/mock-electron-app-name/electron.backupsDirectoryName/mock-backup-1':
				case 'test-app-pref-backup-directory/mock-backup-1':
					return {mtimeMs: 1000};
				case 'mock-electron-app-path-documents/mock-electron-app-name/electron.backupsDirectoryName/mock-backup-2':
				case 'test-app-pref-backup-directory/mock-backup-2':
					return {mtimeMs: 500};
				default:
					throw new Error(`Asked to stat unmocked file: ${name}`);
			}
		});
		jest.spyOn(console, 'log').mockReturnValue();
		initStoryDirectory();
	});

	describe.each([
		[
			"isn't set",
			undefined,
			'mock-electron-app-path-documents/mock-electron-app-name/electron.backupsDirectoryName'
		],
		[
			'is set',
			'test-app-pref-backup-directory',
			'test-app-pref-backup-directory'
		]
	])('When the backupFolderPath app pref %s', (_, appPref, path) => {
		beforeEach(() => {
			getAppPrefMock.mockImplementation((name: string) => {
				if (name === 'backupFolderPath') {
					return appPref;
				}

				return undefined;
			});
		});

		it(`copies the story directory to ${path}`, async () => {
			await backupStoryDirectory();
			expect(copyMock.mock.calls).toEqual([
				[
					'mock-electron-app-path-documents/mock-electron-app-name/electron.storiesDirectoryName',
					expect.stringMatching(new RegExp(`${path}/.+`)),
					{filter: expect.any(Function)}
				]
			]);
		});

		it('filters generated backup, scratch, and cache folders without dropping project metadata', async () => {
			const storyPath =
				'mock-electron-app-path-documents/mock-electron-app-name/electron.storiesDirectoryName';

			await backupStoryDirectory();

			const filter = copyMock.mock.calls[0][2].filter;

			expect(filter(`${storyPath}/passages/001-start.twee`)).toBe(true);
			expect(filter(`${storyPath}/.twine/project.json`)).toBe(true);
			expect(filter(`${storyPath}/electron.backupsDirectoryName/old`)).toBe(
				false
			);
			expect(
				filter(`${storyPath}/electron.scratchDirectoryName/preview.html`)
			).toBe(false);
			expect(filter(`${storyPath}/.twine/cache/index`)).toBe(false);
		});

		it('uses unique names for backup directories', async () => {
			await backupStoryDirectory();
			await new Promise(resolve => window.setTimeout(resolve, 5));
			await backupStoryDirectory();
			expect(copyMock.mock.calls[0][1]).not.toBe(copyMock.mock.calls[1][1]);
		});

		it('prunes the oldest backups if the number of backups is above the limit', async () => {
			await backupStoryDirectory(1);
			expect(removeMock.mock.calls).toEqual([[`${path}/mock-backup-2`]]);
			removeMock.mockReset();
			await backupStoryDirectory(0);
			expect(removeMock.mock.calls).toEqual([
				[`${path}/mock-backup-2`],
				[`${path}/mock-backup-1`]
			]);
		});

		it('does not prune any backups if the number of backups is below or at the limit', async () => {
			await backupStoryDirectory(3);
			expect(removeMock).not.toHaveBeenCalled();
			await backupStoryDirectory(2);
			expect(removeMock).not.toHaveBeenCalled();
		});
	});

	describe.each([
		['inside the story directory', 'test-story-directory/Backups'],
		['above the story directory', 'test-story-directory/..']
	])('When the backupFolderPath app pref is %s', (_, backupPath) => {
		beforeEach(async () => {
			getAppPrefMock.mockImplementation((name: string) => {
				if (name === 'storyLibraryFolderPath') {
					return 'test-story-directory';
				}

				return undefined;
			});

			await initStoryDirectory();

			getAppPrefMock.mockImplementation((name: string) => {
				if (name === 'storyLibraryFolderPath') {
					return 'test-story-directory';
				}

				if (name === 'backupFolderPath') {
					return backupPath;
				}

				return undefined;
			});
		});

		it("doesn't copy the story directory", async () => {
			await expect(backupStoryDirectory()).rejects.toThrow(
				'The story library cannot be backed up'
			);
			expect(copyMock).not.toHaveBeenCalled();
			expect(mkdirpMock).not.toHaveBeenCalledWith(backupPath);
		});
	});
});

describe('resetStoryDirectoryPath()', () => {
	const showRelaunchDialogMock = showRelaunchDialog as jest.Mock;

	beforeEach(() => {
		jest.spyOn(console, 'log').mockReturnValue();
		initStoryDirectory();
	});

	it('resets the app pref and tracks the default story directory', async () => {
		await expect(resetStoryDirectoryPath()).resolves.toBe(
			'mock-electron-app-path-documents/mock-electron-app-name/electron.storiesDirectoryName'
		);
		expect(setAppPrefMock).toHaveBeenCalledWith(
			'storyLibraryFolderPath',
			undefined
		);
		expect(getStoryDirectoryPath()).toBe(
			'mock-electron-app-path-documents/mock-electron-app-name/electron.storiesDirectoryName'
		);
	});

	it('shows the relaunch dialog', async () => {
		await resetStoryDirectoryPath();
		expect(showRelaunchDialogMock).toHaveBeenCalledTimes(1);
	});
});

describe('chooseStoryDirectory()', () => {
	const copyMock = copy as jest.Mock;
	const removeMock = remove as jest.Mock;
	const showErrorBoxMock = dialog.showErrorBox as jest.Mock;
	const showMessageBoxMock = dialog.showMessageBox as jest.Mock;
	const showRelaunchDialogMock = showRelaunchDialog as jest.Mock;
	const showOpenDialogMock = dialog.showOpenDialog as jest.Mock;

	beforeEach(() => {
		jest.spyOn(console, 'log').mockReturnValue();
		initStoryDirectory();
		showMessageBoxMock.mockResolvedValue({response: 1});
		showOpenDialogMock.mockResolvedValue({canceled: true});
	});

	it('opens a directory picker dialog', async () => {
		await chooseStoryDirectoryPath();
		expect(showOpenDialogMock.mock.calls).toEqual([
			[
				{
					defaultPath: getStoryDirectoryPath(),
					properties: ['createDirectory', 'openDirectory'],
					title: 'Choose a folder'
				}
			]
		]);
	});

	it('does nothing if the user cancels out of the dialog', async () => {
		await chooseStoryDirectoryPath();
		expect(setAppPrefMock).not.toBeCalled();
		expect(showRelaunchDialogMock).not.toBeCalled();
	});

	describe('If the user chooses a directory', () => {
		beforeEach(() =>
			showOpenDialogMock.mockResolvedValue({
				canceled: false,
				filePaths: ['mock-new-path']
			})
		);

		it('updates the app pref', async () => {
			await chooseStoryDirectoryPath();
			expect(setAppPrefMock.mock.calls).toEqual([
				['storyLibraryFolderPath', 'mock-new-path']
			]);
		});

		it('asks how to use the chosen directory', async () => {
			await chooseStoryDirectoryPath();
			expect(showMessageBoxMock).toHaveBeenCalledWith(
				expect.objectContaining({
					buttons: [
						'Move Existing Stories Here',
						'Use Existing Stories Here',
						'Start Empty Here',
						'Cancel'
					],
					message: 'Change Story Library Folder',
					type: 'question'
				})
			);
		});

		it('moves the existing library if the user chooses to move it', async () => {
			showMessageBoxMock.mockResolvedValue({response: 0});

			await chooseStoryDirectoryPath();

			expect(copyMock).toHaveBeenCalledWith(
				'mock-electron-app-path-documents/mock-electron-app-name/electron.storiesDirectoryName',
				'mock-new-path',
				{errorOnExist: true, overwrite: false}
			);
			expect(removeMock).toHaveBeenCalledWith(
				'mock-electron-app-path-documents/mock-electron-app-name/electron.storiesDirectoryName'
			);
			expect(setAppPrefMock).toHaveBeenCalledWith(
				'storyLibraryFolderPath',
				'mock-new-path'
			);
		});

		it('does not move the existing library if the user chooses to use the destination as-is', async () => {
			await chooseStoryDirectoryPath();
			expect(copyMock).not.toHaveBeenCalled();
			expect(removeMock).not.toHaveBeenCalled();
			expect(setAppPrefMock).toHaveBeenCalledWith(
				'storyLibraryFolderPath',
				'mock-new-path'
			);
		});

		it('does nothing if the user cancels the choice dialog', async () => {
			showMessageBoxMock.mockResolvedValue({response: 3});

			await chooseStoryDirectoryPath();

			expect(setAppPrefMock).not.toHaveBeenCalled();
			expect(showRelaunchDialogMock).not.toHaveBeenCalled();
		});

		it('rejects a directory that contains the default backup folder', async () => {
			showOpenDialogMock.mockResolvedValue({
				canceled: false,
				filePaths: ['mock-electron-app-path-documents/mock-electron-app-name']
			});

			await chooseStoryDirectoryPath();

			expect(showErrorBoxMock).toHaveBeenCalledWith(
				'Story library folder cannot be used.',
				'Choose a folder that is not the parent of Twine RS backups.'
			);
			expect(showMessageBoxMock).not.toHaveBeenCalled();
			expect(setAppPrefMock).not.toHaveBeenCalled();
		});

		it('returns and tracks the chosen path immediately', async () => {
			await expect(chooseStoryDirectoryPath()).resolves.toBe('mock-new-path');
			expect(getStoryDirectoryPath()).toBe('mock-new-path');
		});

		it('shows the relaunch dialog', async () => {
			await chooseStoryDirectoryPath();
			expect(showRelaunchDialogMock).toBeCalledTimes(1);
		});
	});
});

describe('createStoryDirectory()', () => {
	const mkdirpMock = mkdirp as jest.Mock;

	beforeEach(() => {
		jest.spyOn(console, 'log').mockReturnValue();
		initStoryDirectory();
	});

	it('resolves after calling mkdirp() on the story directory path', async () => {
		await createStoryDirectory();
		expect(mkdirpMock.mock.calls).toEqual([[getStoryDirectoryPath()]]);
	});

	it('rejects if mkdirp() rejects', async () => {
		const error = new Error();

		mkdirpMock.mockRejectedValue(error);
		await expect(createStoryDirectory).rejects.toBe(error);
	});
});

describe('initStoryDirectoryPath()', () => {
	const mkdirpMock = mkdirp as jest.Mock;
	const readdirMock = readdir as jest.Mock;

	beforeEach(() => jest.spyOn(console, 'log').mockReturnValue());

	it('returns the default path if no app pref is set', async () => {
		await initStoryDirectory();
		expect(getStoryDirectoryPath()).toBe(
			'mock-electron-app-path-documents/mock-electron-app-name/electron.storiesDirectoryName'
		);
	});

	describe('When an app pref is set', () => {
		beforeEach(() => {
			getAppPrefMock.mockImplementation((name: string) => {
				if (name === 'storyLibraryFolderPath') {
					return 'mock-story-library-folder-app-pref';
				}

				return undefined;
			});
		});

		it('returns the app pref path if it is readable', async () => {
			readdirMock.mockReturnValue(undefined);
			await initStoryDirectory();
			expect(getStoryDirectoryPath()).toBe(
				'mock-story-library-folder-app-pref'
			);
		});

		it('resets the app pref if it would make the default backup folder a child of the story library', async () => {
			getAppPrefMock.mockImplementation((name: string) => {
				if (name === 'storyLibraryFolderPath') {
					return 'mock-electron-app-path-documents/mock-electron-app-name';
				}

				return undefined;
			});
			jest.spyOn(console, 'warn').mockReturnValue();

			await initStoryDirectory();

			expect(getStoryDirectoryPath()).toBe(
				'mock-electron-app-path-documents/mock-electron-app-name/electron.storiesDirectoryName'
			);
			expect(setAppPrefMock).toHaveBeenCalledWith(
				'storyLibraryFolderPath',
				undefined
			);
			expect(readdirMock).not.toHaveBeenCalledWith(
				'mock-electron-app-path-documents/mock-electron-app-name'
			);
		});

		it('resets an unsafe backup folder app pref instead of keeping it', async () => {
			getAppPrefMock.mockImplementation((name: string) => {
				if (name === 'storyLibraryFolderPath') {
					return 'mock-story-library-folder-app-pref';
				}

				if (name === 'backupFolderPath') {
					return 'mock-story-library-folder-app-pref/Backups';
				}

				return undefined;
			});
			readdirMock.mockReturnValue(undefined);
			jest.spyOn(console, 'warn').mockReturnValue();

			await initStoryDirectory();

			expect(getStoryDirectoryPath()).toBe(
				'mock-story-library-folder-app-pref'
			);
			expect(setAppPrefMock).toHaveBeenCalledWith(
				'backupFolderPath',
				undefined
			);
		});

		it("returns the app pref path if it isn't readable, but can be created", async () => {
			// First attempt is the initial one; second is after the mkdirp call.

			readdirMock.mockImplementationOnce(() => {
				throw new Error();
			});
			await initStoryDirectory();
			expect(getStoryDirectoryPath()).toBe(
				'mock-story-library-folder-app-pref'
			);
			expect(mkdirpMock).toBeCalledTimes(1);
		});

		describe("When the app pref isn't readable nor can be created", () => {
			const quitMock = app.quit as jest.Mock;
			const showMessageBoxMock = dialog.showMessageBox as jest.Mock;

			beforeEach(() => {
				readdirMock.mockImplementation(() => {
					throw new Error();
				});
				showMessageBoxMock.mockResolvedValue({response: 0});
			});

			it('shows a dialog to the user', async () => {
				await initStoryDirectory();
				expect(showMessageBoxMock.mock.calls).toEqual([
					[
						expect.objectContaining({
							message: 'electron.errors.storyLibraryFolderAppPref.message',
							type: 'error',
							buttons: [
								'electron.errors.storyLibraryFolderAppPref.useDefault',
								'electron.errors.storyLibraryFolderAppPref.quit'
							],
							defaultId: 0
						})
					]
				]);
			});

			it('quits if the user chooses that option', async () => {
				showMessageBoxMock.mockResolvedValue({response: 1});
				await initStoryDirectory();
				expect(quitMock).toBeCalledTimes(1);
			});

			it('continues and returns the default path if the user chooses that option', async () => {
				showMessageBoxMock.mockResolvedValue({response: 0});
				await initStoryDirectory();
				expect(getStoryDirectoryPath()).toBe(
					'mock-electron-app-path-documents/mock-electron-app-name/electron.storiesDirectoryName'
				);
				expect(quitMock).not.toBeCalled();
			});
		});
	});
});

describe('revealStoryDirectoryPath()', () => {
	let openPathSpy: jest.SpyInstance;

	beforeEach(() => {
		openPathSpy = jest.spyOn(shell, 'openPath');
		jest.spyOn(console, 'log').mockReturnValue();
		initStoryDirectory();
	});

	it('resolves after showing the story directory', async () => {
		await revealStoryDirectory();
		expect(openPathSpy.mock.calls).toEqual([
			[
				'mock-electron-app-path-documents/mock-electron-app-name/electron.storiesDirectoryName'
			]
		]);
	});

	it('rejects with an error if showing the story directory fails', async () => {
		const error = new Error();

		openPathSpy.mockRejectedValue(error);
		await expect(revealStoryDirectory).rejects.toBe(error);
	});
});
