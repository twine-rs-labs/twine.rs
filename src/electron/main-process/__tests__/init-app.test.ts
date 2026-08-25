import {app, BrowserWindow, dialog, shell} from 'electron';
import {initApp} from '../init-app';
import {initIpc, storyWritesReadyForQuit} from '../ipc';
import {initLocales} from '../locales';
import {initMenuBar} from '../menu-bar';
import {setCommandLineOpenRequestNotifier} from '../command-line';
import {
	backupStoryDirectory,
	createStoryDirectory,
	initStoryDirectory
} from '../story-directory';
import {getUserCss} from '../user-css';

jest.mock('electron');
jest.mock('../app-prefs');
jest.mock('../command-line');
jest.mock('../ipc');
jest.mock('../locales');
jest.mock('../menu-bar');
jest.mock('../story-directory');
jest.mock('../user-css');
jest.mock('../performance-harness', () => ({
	...jest.requireActual('../performance-harness'),
	performanceHarnessEnabled: () => process.env.TWINE_PERF === '1'
}));

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
	const setCommandLineOpenRequestNotifierMock =
		setCommandLineOpenRequestNotifier as jest.Mock;
	const getUserCssMock = getUserCss as jest.Mock;

	beforeEach(() => {
		jest.spyOn(global, 'setInterval');
		storyWritesReadyForQuitMock.mockReturnValue(false);
		getUserCssMock.mockResolvedValue(undefined);
	});

	it('keeps the ready main window hidden for the exact E2E opt-in', async () => {
		const previousBackground = process.env.TWINE_E2E_BACKGROUND_WINDOW;
		const previousPerformance = process.env.TWINE_PERF;
		process.env.TWINE_E2E_BACKGROUND_WINDOW = '1';
		process.env.TWINE_PERF = '1';
		try {
			const windowOnce = jest.spyOn(BrowserWindow.prototype, 'once');
			await initApp();
			const window = (
				BrowserWindow as unknown as {instances: BrowserWindow[]}
			).instances.at(-1) as BrowserWindow;
			const show = jest.spyOn(window, 'show');
			const readyToShow = (windowOnce.mock.calls as any[]).find(
				([event]) => event === 'ready-to-show'
			)?.[1] as () => Promise<void>;

			await readyToShow();

			expect(show).not.toHaveBeenCalled();
			expect(
				(BrowserWindow as unknown as {options: any[]}).options.at(-1)
			).toEqual(
				expect.objectContaining({
					webPreferences: expect.objectContaining({
						backgroundThrottling: false
					})
				})
			);
		} finally {
			if (previousBackground === undefined) {
				delete process.env.TWINE_E2E_BACKGROUND_WINDOW;
			} else {
				process.env.TWINE_E2E_BACKGROUND_WINDOW = previousBackground;
			}
			if (previousPerformance === undefined) {
				delete process.env.TWINE_PERF;
			} else {
				process.env.TWINE_PERF = previousPerformance;
			}
		}
	});

	it('keeps normal window activation for the lone background flag', async () => {
		const previousBackground = process.env.TWINE_E2E_BACKGROUND_WINDOW;
		const previousPerformance = process.env.TWINE_PERF;
		process.env.TWINE_E2E_BACKGROUND_WINDOW = '1';
		delete process.env.TWINE_PERF;
		try {
			const windowOnce = jest.spyOn(BrowserWindow.prototype, 'once');
			await initApp();
			const window = (
				BrowserWindow as unknown as {instances: BrowserWindow[]}
			).instances.at(-1) as BrowserWindow;
			const show = jest.spyOn(window, 'show');
			const readyToShow = (windowOnce.mock.calls as any[]).find(
				([event]) => event === 'ready-to-show'
			)?.[1] as () => Promise<void>;

			await readyToShow();

			expect(show).toHaveBeenCalledTimes(1);
			expect(
				(BrowserWindow as unknown as {options: any[]}).options.at(-1)
			).toEqual(
				expect.objectContaining({
					webPreferences: expect.not.objectContaining({
						backgroundThrottling: false
					})
				})
			);
		} finally {
			if (previousBackground === undefined) {
				delete process.env.TWINE_E2E_BACKGROUND_WINDOW;
			} else {
				process.env.TWINE_E2E_BACKGROUND_WINDOW = previousBackground;
			}
			if (previousPerformance === undefined) {
				delete process.env.TWINE_PERF;
			} else {
				process.env.TWINE_PERF = previousPerformance;
			}
		}
	});

	it('initializes locales', async () => {
		await initApp();
		expect(initLocalesMock).toHaveBeenCalledTimes(1);
	});

	it('initializes the story directory', async () => {
		await initApp();
		expect(initStoryDirectoryMock).toHaveBeenCalledTimes(1);
	});

	it('stops startup cleanly if story directory recovery quits', async () => {
		initStoryDirectoryMock.mockResolvedValue(false);

		await initApp();

		expect(createStoryDirectoryMock).not.toHaveBeenCalled();
		expect(backupStoryDirectoryMock).not.toHaveBeenCalled();
		expect(initIpcMock).not.toHaveBeenCalled();
		expect(initMenuBarMock).not.toHaveBeenCalled();
		expect(showErrorBoxMock).not.toHaveBeenCalled();
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
		const options = initIpcMock.mock.calls[0][0];
		const window = (
			BrowserWindow as unknown as {instances: BrowserWindow[]}
		).instances.at(-1) as BrowserWindow;

		expect(options.authoringRendererEstablished()).toBe(false);
		expect(options.authoringRendererWasEstablished()).toBe(false);
		expect(options.authoringWebContents()).toBe(window.webContents);
		options.onAuthoringRendererReady();
		expect(options.authoringRendererEstablished()).toBe(true);
		expect(options.authoringRendererWasEstablished()).toBe(true);
	});

	it.each(['destroyed', 'render-process-gone'])(
		'resets renderer readiness when webContents emits %s',
		async eventName => {
			await initApp();
			const options = initIpcMock.mock.calls[0][0];
			const window = (
				BrowserWindow as unknown as {instances: BrowserWindow[]}
			).instances.at(-1) as BrowserWindow & {webContents: {on: jest.Mock}};

			options.onAuthoringRendererReady();
			const listener = window.webContents.on.mock.calls.find(
				([name]) => name === eventName
			)?.[1];

			listener();
			expect(options.authoringRendererEstablished()).toBe(false);
		}
	);

	it('resets renderer readiness on top-level cross-document navigation', async () => {
		await initApp();
		const options = initIpcMock.mock.calls[0][0];
		const window = (
			BrowserWindow as unknown as {instances: BrowserWindow[]}
		).instances.at(-1) as BrowserWindow & {webContents: {on: jest.Mock}};
		const navigation = window.webContents.on.mock.calls.find(
			([name]) => name === 'did-start-navigation'
		)?.[1];

		options.onAuthoringRendererReady();
		navigation({
			isMainFrame: true,
			isSameDocument: true,
			url: 'file:///renderer/index.html#same-document'
		});
		expect(options.authoringRendererEstablished()).toBe(true);
		navigation({
			isMainFrame: true,
			isSameDocument: false,
			url: 'file:///replacement.html'
		});
		expect(options.authoringRendererEstablished()).toBe(false);
	});

	it('restores readiness when a started cross-document navigation is prevented', async () => {
		await initApp();
		const options = initIpcMock.mock.calls[0][0];
		const window = (
			BrowserWindow as unknown as {instances: BrowserWindow[]}
		).instances.at(-1) as BrowserWindow & {webContents: {on: jest.Mock}};
		const navigation = window.webContents.on.mock.calls.find(
			([name]) => name === 'did-start-navigation'
		)?.[1];
		const willNavigate = window.webContents.on.mock.calls.find(
			([name]) => name === 'will-navigate'
		)?.[1];
		const event = {preventDefault: jest.fn()};
		const blockedUrl = 'https://example.com/blocked';

		options.onAuthoringRendererReady();
		navigation({
			isMainFrame: true,
			isSameDocument: false,
			url: blockedUrl
		});
		expect(options.authoringRendererEstablished()).toBe(false);

		willNavigate(event, blockedUrl);
		expect(event.preventDefault).toHaveBeenCalledTimes(1);
		expect(options.authoringRendererEstablished()).toBe(true);

		navigation({
			isMainFrame: true,
			isSameDocument: false,
			url: 'file:///committed-replacement.html'
		});
		expect(options.authoringRendererEstablished()).toBe(false);

		options.onAuthoringRendererReady();
		const processGone = window.webContents.on.mock.calls.find(
			([name]) => name === 'render-process-gone'
		)?.[1];

		processGone();
		expect(options.authoringRendererEstablished()).toBe(false);
	});

	it('initializes the menu bar', async () => {
		await initApp();
		expect(initMenuBarMock).toHaveBeenCalledTimes(1);
	});

	it('pushes queued file-open notifications to the renderer after startup', async () => {
		await initApp();
		const window = (
			BrowserWindow as unknown as {instances: BrowserWindow[]}
		).instances.at(-1) as BrowserWindow & {
			webContents: {send: jest.Mock};
		};
		const notify = setCommandLineOpenRequestNotifierMock.mock.calls.find(
			([notifier]) => typeof notifier === 'function'
		)?.[0] as () => void;

		notify();

		expect(window.webContents.send).toHaveBeenCalledWith(
			'command-line-open-request'
		);
	});

	it('stops file-open notifications when the main window closes', async () => {
		const windowOn = jest.spyOn(BrowserWindow.prototype, 'on');

		await initApp();
		const closedListener = (windowOn.mock.calls as any[]).find(
			([event]) => event === 'closed'
		)?.[1] as () => void;

		closedListener();

		expect(setCommandLineOpenRequestNotifierMock).toHaveBeenLastCalledWith(
			undefined
		);
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
