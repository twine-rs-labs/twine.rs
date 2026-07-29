import {
	commandLineAppPrefOverrideNames,
	parseCommandLine
} from './command-line';
import {loadJsonFileSync, saveJsonFile} from './json-file';

/**
 * Name of an app-specific preference. These should only be used for preferences
 * that are related to the app build, e.g. things like folder locations.
 */
export type AppPrefName =
	| 'backupCadenceMinutes'
	| 'backupFolderPath'
	| 'backupLastReviewedTime'
	| 'backupReminderDays'
	| 'backupRetentionLimit'
	| 'externalEditorCommand'
	| 'fullscreenPersistence'
	| 'lastWindowFullscreen'
	| 'linkHandlingMode'
	| 'disableHardwareAcceleration'
	| 'scratchFolderPath'
	| 'scratchFileCleanupAge'
	| 'storyLibraryFolderPath';

const prefNames: AppPrefName[] = [
	'backupCadenceMinutes',
	'backupFolderPath',
	'backupLastReviewedTime',
	'backupReminderDays',
	'backupRetentionLimit',
	'disableHardwareAcceleration',
	'externalEditorCommand',
	'fullscreenPersistence',
	'lastWindowFullscreen',
	'linkHandlingMode',
	'scratchFolderPath',
	'scratchFileCleanupAge',
	'storyLibraryFolderPath'
];
let commandLinePrefs: Partial<Record<AppPrefName, unknown>> = {};
let explicitPrefs: Partial<Record<AppPrefName, unknown>> = {};
let persistedPrefs: Partial<Record<AppPrefName, unknown>> = {};
let prefsLoaded = false;

/**
 * Loads app-specific (e.g. not shared by the browser version) prefs. This
 * *must* be called before getAppPref or setAppPref. This function is
 * synchronous because we need at least one app pref before Electron is ready,
 * and there is no way to delay readiness.
 *
 * @see https://github.com/electron/electron/issues/21370
 */
export function loadAppPrefs() {
	const argv = parseCommandLine(process.argv.slice(1));
	let appPrefFile: any = {};

	commandLinePrefs = {};
	explicitPrefs = {};
	persistedPrefs = {};

	try {
		appPrefFile = loadJsonFileSync('app-prefs.json');
	} catch (error) {
		console.warn("Couldn't read app prefs file; continuing", error);
	}

	for (const prefName of prefNames) {
		if (Object.prototype.hasOwnProperty.call(appPrefFile, prefName)) {
			persistedPrefs[prefName] = appPrefFile[prefName];
		}

		if (
			commandLineAppPrefOverrideNames.includes(prefName) &&
			Object.prototype.hasOwnProperty.call(argv, prefName)
		) {
			commandLinePrefs[prefName] = argv[prefName];
		}

		console.log(
			`App pref ${prefName} set to ${JSON.stringify(
				commandLinePrefs[prefName] ?? persistedPrefs[prefName]
			)}`
		);
	}

	prefsLoaded = true;
}

/**
 * Returns the value set for an app preference. The order of precendence is:
 *
 * 1. Values set by setAppPref()
 * 2. Command-line arguments
 * 3. The app preference file
 *
 * If no value has been set in any of the above places, this returns undefined.
 */
export function getAppPref(name: AppPrefName): unknown {
	if (!prefsLoaded) {
		throw new Error('Tried to get an app pref before they were loaded');
	}

	if (Object.prototype.hasOwnProperty.call(explicitPrefs, name)) {
		return explicitPrefs[name];
	}

	if (Object.prototype.hasOwnProperty.call(commandLinePrefs, name)) {
		return commandLinePrefs[name];
	}

	return persistedPrefs[name];
}

/**
 * Sets an app preference and saves it to the app preference file.
 */
export async function setAppPref(name: AppPrefName, value: unknown) {
	if (!prefsLoaded) {
		throw new Error('Tried to set an app pref before they were loaded');
	}

	explicitPrefs[name] = value;

	if (value === undefined) {
		delete persistedPrefs[name];
	} else {
		persistedPrefs[name] = value;
	}

	await saveJsonFile('app-prefs.json', {...persistedPrefs});
}
