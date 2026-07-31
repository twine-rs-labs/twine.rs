import {app, BrowserWindow, dialog, screen} from 'electron';
import path from 'path';
import {pathToFileURL} from 'url';
import {initIpc, storyWritesReadyForQuit} from './ipc';
import {initLocales} from './locales';
import {initMenuBar} from './menu-bar';
import {setAppPref} from './app-prefs';
import {
	backupCadenceMs,
	fullscreenPersistenceEnabled,
	lastWindowFullscreen,
	linkHandlingMode
} from './platform-settings';
import {
	backupStoryDirectory,
	createStoryDirectory,
	initStoryDirectory
} from './story-directory';
import {getUserCss} from './user-css';
import {
	markMainPerformance,
	performanceHarnessEnabled,
	recordMainLaunchPhase
} from './performance-harness';
import {initStoryPreviewProtocol} from './story-preview-protocol';
import {initStoryPreviewWindowManager} from './story-preview-window-manager';
import {openExternalUrl} from './external-url';
import {setCommandLineOpenRequestNotifier} from './command-line';
import {installPermissionPolicy} from './permission-policy';

let mainWindow: BrowserWindow | null;

async function createWindow() {
	markMainPerformance('window-create-start');
	const screenSize = screen.getPrimaryDisplay().workAreaSize;
	const rendererUrl = pathToFileURL(
		path.resolve(__dirname, '../../../../renderer/index.html')
	).toString();

	mainWindow = new BrowserWindow({
		fullscreen: fullscreenPersistenceEnabled() && lastWindowFullscreen(),
		height: Math.round(screenSize.height * 0.9),
		width: Math.round(screenSize.width * 0.9),
		show: false,
		title: 'Twine RS',
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			nodeIntegrationInSubFrames: false,
			preload: path.resolve(__dirname, './preload.js'),
			sandbox: true,
			webSecurity: true
		}
	});
	installPermissionPolicy(
		mainWindow.webContents.session,
		mainWindow.webContents,
		rendererUrl
	);
	setCommandLineOpenRequestNotifier(() => {
		mainWindow?.webContents.send('command-line-open-request');
	});
	if (fullscreenPersistenceEnabled()) {
		mainWindow.on('enter-full-screen', () => {
			void setAppPref('lastWindowFullscreen', true);
		});
		mainWindow.on('leave-full-screen', () => {
			void setAppPref('lastWindowFullscreen', false);
		});
	}

	// Path is relative to this file in the electron-build/ directory that's
	// created during `npm run build:electron-main`.
	mainWindow.loadURL(rendererUrl);

	mainWindow.once('ready-to-show', async () => {
		markMainPerformance('window-ready-to-show');
		const userCss = await getUserCss();

		if (userCss) {
			console.log('Adding user CSS');
			mainWindow!.webContents.insertCSS(userCss);
		}

		mainWindow!.show();

		if (!app.isPackaged && !performanceHarnessEnabled()) {
			mainWindow!.webContents.openDevTools();
		}
	});
	mainWindow.on('close', event => {
		if (!storyWritesReadyForQuit()) {
			event.preventDefault();
			app.quit();
		}
	});
	mainWindow.on('closed', () => {
		mainWindow = null;
		setCommandLineOpenRequestNotifier(undefined);
	});

	// Load external links in the system browser.
	const openNavigationExternally = (url: string) => {
		void openExternalUrl(url).catch(error => {
			console.warn('Blocked or failed to open an external link.', error);
		});
	};

	mainWindow.webContents.on('will-navigate', (event, url) => {
		if (linkHandlingMode() === 'system') {
			openNavigationExternally(url);
		}

		event.preventDefault();
	});
	mainWindow.webContents.setWindowOpenHandler(({url}) => {
		if (linkHandlingMode() === 'system') {
			openNavigationExternally(url);
		}

		return {action: 'deny'};
	});
}

async function runAutomaticStoryDirectoryBackup() {
	try {
		await backupStoryDirectory();
	} catch (error) {
		console.warn('Story library backup failed; continuing startup.', error);
	}
}

export async function initApp() {
	try {
		await initLocales();
		if ((await initStoryDirectory()) === false) {
			return;
		}
		await createStoryDirectory();
		void runAutomaticStoryDirectoryBackup();
		setInterval(
			() => void runAutomaticStoryDirectoryBackup(),
			backupCadenceMs()
		);
		initIpc();
		initStoryPreviewProtocol();
		initStoryPreviewWindowManager();
		initMenuBar();
		await createWindow();
		markMainPerformance('window-created');
		recordMainLaunchPhase('window-created');
	} catch (error) {
		// Not localized because that may be the cause of the error.

		dialog.showErrorBox(
			'An error occurred during startup.',
			(error as Error).message
		);
		app.quit();
	}
}
