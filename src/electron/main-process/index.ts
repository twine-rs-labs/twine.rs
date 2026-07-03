import {app} from 'electron';
import {join} from 'path';
import {initApp} from './init-app';
import {loadAppPrefs} from './app-prefs';
import {initHardwareAcceleration} from './hardware-acceleration';
import {
	commandLineHelpRequested,
	commandLineHelpText,
	commandLineOpenPaths,
	queueCommandLineOpenPaths
} from './command-line';
import {
	markMainPerformance,
	performanceHarnessSessionDataPath,
	performanceHarnessUserDataPath,
	recordMainLaunchPhase
} from './performance-harness';

const nativeAppName = 'Twine RS';
const nativeUserDataName = 'twine-rs';

recordMainLaunchPhase('main-module');
app.setName(nativeAppName);
const performanceUserData = performanceHarnessUserDataPath();
const performanceSessionData = performanceHarnessSessionDataPath();

app.setPath(
	'userData',
	performanceUserData ?? join(app.getPath('appData'), nativeUserDataName)
);
if (performanceSessionData) {
	app.setPath('sessionData', performanceSessionData);
}
markMainPerformance('app-configured');
recordMainLaunchPhase('app-configured');

// We need to load prefs here *and block* because disabling hardware
// acceleration has to happen before the app is ready.
// @see https://github.com/electron/electron/issues/21370

loadAppPrefs();
initHardwareAcceleration();

// Continue initialization that needs to happen after Electron is ready.

const commandLineArgs = process.argv.slice(app.isPackaged ? 1 : 2);

if (commandLineHelpRequested(commandLineArgs)) {
	console.log(commandLineHelpText(app.getName()));
	app.quit();
} else {
	queueCommandLineOpenPaths(commandLineOpenPaths(commandLineArgs));
	app.on('open-file', (event, path) => {
		event.preventDefault();
		queueCommandLineOpenPaths([path]);
	});
	app.whenReady().then(() => {
		markMainPerformance('app-ready');
		recordMainLaunchPhase('app-ready');
		return initApp();
	});
	app.on('window-all-closed', () => app.quit());
}
