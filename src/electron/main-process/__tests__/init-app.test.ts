import {app, BrowserWindow, dialog, shell} from 'electron';
import {initApp} from '../init-app';
import {initIpc, storyWritesReadyForQuit} from '../ipc';
import {initLocales} from '../locales';
import {initMenuBar} from '../menu-bar';
import {
	backupStoryDirectory,
	createStoryDirectory,
	initStoryDirectory
} from '../story-directory';

jest.mock('electron');
jest.mock('../app-prefs');
jest.mock('../ipc');
jest.mock('../locales');
jest.mock('../menu-bar');
jest.mock('../story-directory');

describe('initApp', () => {
	const initIpcMock = initIpc as jest.Mock;
	const initLocalesMock = initLocales as jest.Mock;
	const initMenuBarMock = initMenuBar as jest.Mock;
	const initStoryDirectoryMock = initStoryDirectory as jest.Mock;
	const backupStoryDirectoryMock = backupStoryDirectory as jest.Mock;
	const createStoryDirectoryMock = createStoryDirectory as jest.Mock;
	const quitMock = app.quit as jest.Mock;
	const openExternalMock = shell.openExternal as jest.Mock;
	const showErrorBoxMock = dialog.showErrorBox as jest.Mock;
	const storyWritesReadyForQuitMock = storyWritesReadyForQuit as jest.Mock;

	beforeEach(() => {
		jest.spyOn(global, 'setInterval');
		storyWritesReadyForQuitMock.mockReturnValue(false);
	});

	it('initializes locales', async () => {
		await initApp();
		expect(initLocalesMock).toHaveBeenCalledTimes(1);
	});

	it('initializes the story directory', async () => {
		await initApp();
		expect(initStoryDirectoryMock).toHaveBeenCalledTimes(1);
	});

	it('creates the story directory', async () => {
		await initApp();
		expect(createStoryDirectoryMock).toHaveBeenCalledTimes(1);
	});

	it('backs up the story directory', async () => {
		await initApp();
		expect(backupStoryDirectoryMock).toHaveBeenCalledTimes(1);
	});

	it('initializes backing up the story directory every 20 minutes', async () => {
		await initApp();
		expect((global.setInterval as unknown as jest.Mock).mock.calls).toEqual([
			[expect.any(Function), 1000 * 60 * 20]
		]);
	});

	it('initializes IPC', async () => {
		await initApp();
		expect(initIpcMock).toHaveBeenCalledTimes(1);
	});

	it('initializes the menu bar', async () => {
		await initApp();
		expect(initMenuBarMock).toHaveBeenCalledTimes(1);
	});

	it('keeps the renderer alive until story writes allow window close', async () => {
		const windowOn = jest.spyOn(BrowserWindow.prototype, 'on');

		await initApp();
		const closeListener = (windowOn.mock.calls as any[]).find(
			([event]) => event === 'close'
		)?.[1] as (event: {preventDefault: () => void}) => void;
		const pendingEvent = {preventDefault: jest.fn()};
		const readyEvent = {preventDefault: jest.fn()};

		closeListener(pendingEvent);
		expect(pendingEvent.preventDefault).toHaveBeenCalledTimes(1);
		expect(quitMock).toHaveBeenCalledTimes(1);

		storyWritesReadyForQuitMock.mockReturnValue(true);
		closeListener(readyEvent);
		expect(readyEvent.preventDefault).not.toHaveBeenCalled();
		expect(quitMock).toHaveBeenCalledTimes(1);
	});

	it('opens only safe external navigation in the system browser', async () => {
		jest.spyOn(console, 'warn').mockReturnValue();
		await initApp();
		const window = (
			BrowserWindow as unknown as {instances: BrowserWindow[]}
		).instances.at(-1) as BrowserWindow & {
			webContents: {
				on: jest.Mock;
				setWindowOpenHandler: jest.Mock;
			};
		};
		const willNavigate = window.webContents.on.mock.calls.find(
			([event]) => event === 'will-navigate'
		)?.[1];
		const openWindow = window.webContents.setWindowOpenHandler.mock.calls[0][0];
		const blockedEvent = {preventDefault: jest.fn()};
		const allowedEvent = {preventDefault: jest.fn()};

		willNavigate(blockedEvent, 'file:///tmp/story.html');
		openWindow({url: 'custom-handler://open'});
		willNavigate(allowedEvent, 'https://example.com/help');
		await Promise.resolve();

		expect(blockedEvent.preventDefault).toHaveBeenCalledTimes(1);
		expect(allowedEvent.preventDefault).toHaveBeenCalledTimes(1);
		expect(openExternalMock).toHaveBeenCalledTimes(1);
		expect(openExternalMock).toHaveBeenCalledWith('https://example.com/help');
	});

	it.todo('creates the main window');
	it.todo('injects user CSS into the main window if available');

	it('does not show an error dialog when everything loads', async () => {
		await initApp();
		expect(showErrorBoxMock).not.toHaveBeenCalled();
	});

	it("doesn't quit if the automatic story directory backup fails", async () => {
		const warnMock = jest.spyOn(console, 'warn').mockReturnValue();
		const error = new Error('Backup failed');

		backupStoryDirectoryMock.mockRejectedValue(error);
		await initApp();
		await Promise.resolve();

		expect(showErrorBoxMock).not.toHaveBeenCalled();
		expect(quitMock).not.toHaveBeenCalled();
		expect(initIpcMock).toHaveBeenCalledTimes(1);
		expect(initMenuBarMock).toHaveBeenCalledTimes(1);
		expect(warnMock).toHaveBeenCalledWith(
			'Story library backup failed; continuing startup.',
			error
		);
	});

	it('displays an error dialog and quits if an error occurs', async () => {
		initLocalesMock.mockRejectedValue(new Error());
		await initApp();
		expect(showErrorBoxMock).toHaveBeenCalledTimes(1);
		expect(quitMock).toHaveBeenCalledTimes(1);
	});
});
