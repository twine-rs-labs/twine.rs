import {app, dialog, shell} from 'electron';
import {copy, mkdirp, readdir, remove, stat} from 'fs-extra';
import {isAbsolute, join, relative, resolve, sep} from 'path';
import {i18n} from './locales';
import {getAppPref, setAppPref} from './app-prefs';
import {showRelaunchDialog} from './relaunch-dialog';
import type {NativeBackupResult} from '../shared';
import {backupRetentionLimit} from './platform-settings';

// We can't initialize this because the i18n module needs to set itself up
// first.

let storyDirectoryPath: string;

function appDocumentsDirectoryPath() {
	return join(app.getPath('documents'), app.getName());
}

function defaultStoryDirectoryPath() {
	return join(
		appDocumentsDirectoryPath(),
		i18n.t('electron.storiesDirectoryName')
	);
}

function documentsBackupDirectoryPath() {
	return join(
		appDocumentsDirectoryPath(),
		i18n.t('electron.backupsDirectoryName')
	);
}

function appDataBackupDirectoryPath() {
	return join(app.getPath('userData'), i18n.t('electron.backupsDirectoryName'));
}

function pathContainsPath(parentPath: string, childPath: string) {
	const relativePath = relative(resolve(parentPath), resolve(childPath));

	return (
		relativePath === '' ||
		(relativePath !== '..' &&
			!relativePath.startsWith(`..${sep}`) &&
			!isAbsolute(relativePath))
	);
}

function pathsOverlap(pathA: string, pathB: string) {
	return pathContainsPath(pathA, pathB) || pathContainsPath(pathB, pathA);
}

function defaultBackupDirectoryPath(storyPath = storyDirectoryPath) {
	const backupPath = documentsBackupDirectoryPath();

	if (storyPath !== undefined && pathsOverlap(storyPath, backupPath)) {
		return appDataBackupDirectoryPath();
	}

	return backupPath;
}

function validateBackupDirectoryPath(storyPath: string, backupPath: string) {
	if (pathsOverlap(storyPath, backupPath)) {
		throw new Error(
			`The story library cannot be backed up to a folder inside it or to one of its parent folders. Story library: ${storyPath}; backup folder: ${backupPath}`
		);
	}
}

function validateStoryDirectoryMovePath(
	sourcePath: string,
	destinationPath: string
) {
	if (resolve(sourcePath) === resolve(destinationPath)) {
		return;
	}

	if (pathsOverlap(sourcePath, destinationPath)) {
		throw new Error(
			`The story library cannot be moved into itself or one of its parent folders. Story library: ${sourcePath}; destination: ${destinationPath}`
		);
	}
}

function isUnsafeStoryDirectoryPreferencePath(prefPath: string) {
	return pathsOverlap(prefPath, documentsBackupDirectoryPath());
}

function recoveryBackupDirectoryPath() {
	const prefPath = getAppPref('backupFolderPath');

	return typeof prefPath === 'string' ? prefPath : appDataBackupDirectoryPath();
}

async function isStoryDirectoryReadableOrCanBeCreated(path: string) {
	try {
		await readdir(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
			return false;
		}

		try {
			await mkdirp(path);
			await readdir(path);
			return true;
		} catch {
			return false;
		}
	}
}

async function chooseStartupStoryDirectoryPath() {
	while (true) {
		const {response} = await dialog.showMessageBox({
			buttons: ['Choose Another Folder', 'Quit'],
			cancelId: 1,
			defaultId: 0,
			detail:
				'Twine cannot read its default story library folder. Choose another readable folder to continue.',
			message: 'Story Library Folder Is Unavailable',
			type: 'error'
		});

		if (response !== 0) {
			app.quit();
			return undefined;
		}

		const {canceled, filePaths} = await dialog.showOpenDialog({
			properties: ['createDirectory', 'openDirectory'],
			title: 'Choose a readable story library folder'
		});

		if (canceled || !filePaths[0]) {
			app.quit();
			return undefined;
		}

		const path = filePaths[0];

		if (
			isUnsafeStoryDirectoryPreferencePath(path) ||
			pathsOverlap(path, recoveryBackupDirectoryPath())
		) {
			dialog.showErrorBox(
				'Story library folder cannot be used.',
				'Choose a folder that is not the parent of Twine RS backups.'
			);
			continue;
		}

		if (await isStoryDirectoryReadableOrCanBeCreated(path)) {
			return path;
		}

		dialog.showErrorBox(
			'Story library folder cannot be used.',
			'Twine could not read the selected folder. Choose a readable folder.'
		);
	}
}

async function prepareRecoveryBackupDirectoryPath(storyPath: string) {
	if (typeof getAppPref('backupFolderPath') === 'string') {
		return;
	}

	const backupPath = appDataBackupDirectoryPath();

	validateBackupDirectoryPath(storyPath, backupPath);
	await mkdirp(backupPath);
	await readdir(backupPath);
	await setAppPref('backupFolderPath', backupPath);
}

async function resetBackupDirectoryPreferenceIfUnsafe(storyPath: string) {
	const backupPrefPath = getAppPref('backupFolderPath');

	if (
		typeof backupPrefPath === 'string' &&
		pathsOverlap(storyPath, backupPrefPath)
	) {
		console.warn(
			`Backup path ${backupPrefPath} overlaps the story library; resetting to the default backup path.`
		);
		await setAppPref('backupFolderPath', undefined);
	}
}

function backupCopyFilter(storyPath: string, backupPath: string) {
	const excludedPaths = [
		backupPath,
		join(storyPath, i18n.t('electron.backupsDirectoryName')),
		join(storyPath, i18n.t('electron.scratchDirectoryName')),
		join(storyPath, '.twine', 'cache'),
		join(storyPath, '.twine', 'tmp')
	].map(path => resolve(path));

	return (sourcePath: string) => {
		const resolvedSourcePath = resolve(sourcePath);

		return !excludedPaths.some(
			excludedPath =>
				resolvedSourcePath !== resolve(storyPath) &&
				pathContainsPath(excludedPath, resolvedSourcePath)
		);
	};
}

async function moveStoryDirectory(destinationPath: string) {
	const sourcePath = getStoryDirectoryPath();

	if (resolve(sourcePath) === resolve(destinationPath)) {
		return;
	}

	validateStoryDirectoryMovePath(sourcePath, destinationPath);
	await mkdirp(destinationPath);
	await copy(sourcePath, destinationPath, {
		errorOnExist: true,
		overwrite: false
	});
	await readdir(destinationPath);
	await remove(sourcePath);
}

/**
 * Initializes the user story directory, deciding whether to use one set by app
 * preference or fall back to the default (if the the app pref is unset, or the
 * directory in the app pref can't be read).
 *
 * If the app pref directory is unavailable, the user will be shown a warning
 * dialog that allows either continuing with the default or quitting the app.
 * If the user continues, their preference will be reset.
 *
 * This must be called before any other functions in this module.
 */
export async function initStoryDirectory() {
	const prefPath = getAppPref('storyLibraryFolderPath');

	if (typeof prefPath === 'string') {
		if (isUnsafeStoryDirectoryPreferencePath(prefPath)) {
			console.warn(
				`Story library path ${prefPath} overlaps Twine's backup folder; resetting to the default story library path.`
			);
			await setAppPref('storyLibraryFolderPath', undefined);
		} else {
			// Use readdir() instead of access() because access() only tells us if we
			// can see the directory itself, not anything inside it.

			if (await isStoryDirectoryReadableOrCanBeCreated(prefPath)) {
				storyDirectoryPath = prefPath;
				await resetBackupDirectoryPreferenceIfUnsafe(storyDirectoryPath);
				console.log(`Story library path initialized as ${storyDirectoryPath}`);
				return true;
			}

			const {response} = await dialog.showMessageBox({
				detail: i18n.t('electron.errors.storyLibraryFolderAppPref.detail', {
					path: prefPath
				}),
				message: i18n.t('electron.errors.storyLibraryFolderAppPref.message'),
				type: 'error',
				buttons: [
					i18n.t('electron.errors.storyLibraryFolderAppPref.useDefault'),
					i18n.t('electron.errors.storyLibraryFolderAppPref.quit')
				],
				defaultId: 0
			});

			if (response === 1) {
				app.quit();
				return false;
			}

			// Reset the preference and fall through to the default path.

			await setAppPref('storyLibraryFolderPath', undefined);
		}
	}

	const defaultPath = defaultStoryDirectoryPath();

	if (await isStoryDirectoryReadableOrCanBeCreated(defaultPath)) {
		storyDirectoryPath = defaultPath;
	} else {
		const replacementPath = await chooseStartupStoryDirectoryPath();

		if (replacementPath === undefined) {
			return false;
		}

		await prepareRecoveryBackupDirectoryPath(replacementPath);
		storyDirectoryPath = replacementPath;
		await setAppPref('storyLibraryFolderPath', replacementPath);
	}

	await resetBackupDirectoryPreferenceIfUnsafe(storyDirectoryPath);
	console.log(`Story library path initialized as ${storyDirectoryPath}`);
	return true;
}

/**
 * Returns the full path of the user's story directory.
 */
export function getStoryDirectoryPath() {
	if (storyDirectoryPath === undefined) {
		throw new Error(
			'getStoryDirectoryPath() must be called after initStoryDirectory()'
		);
	}

	return storyDirectoryPath;
}

/**
 * Asks the user to choose a story directory folder and updates the app pref as needed.
 */
export async function chooseStoryDirectoryPath() {
	const {canceled, filePaths} = await dialog.showOpenDialog({
		defaultPath: getStoryDirectoryPath(),
		properties: ['createDirectory', 'openDirectory'],
		title: 'Choose a folder'
	});

	if (canceled || !filePaths[0]) {
		return undefined;
	}

	const destinationPath = filePaths[0];

	if (resolve(destinationPath) === resolve(getStoryDirectoryPath())) {
		return getStoryDirectoryPath();
	}

	if (isUnsafeStoryDirectoryPreferencePath(destinationPath)) {
		dialog.showErrorBox(
			'Story library folder cannot be used.',
			'Choose a folder that is not the parent of Twine RS backups.'
		);
		return undefined;
	}

	const {response} = await dialog.showMessageBox({
		buttons: [
			'Move Existing Stories Here',
			'Use Existing Stories Here',
			'Start Empty Here',
			'Cancel'
		],
		cancelId: 3,
		defaultId: 0,
		detail:
			'Moving copies the current story library to the selected folder, verifies the copy, and then removes the old folder. Starting empty requires a folder with no files or subfolders.',
		message: 'Change Story Library Folder',
		type: 'question'
	});

	if (response === 3) {
		return undefined;
	}

	if (response === 0) {
		await moveStoryDirectory(destinationPath);
	}

	if (response === 2) {
		try {
			const destinationEntries = await readdir(destinationPath);

			if (destinationEntries.length > 0) {
				dialog.showErrorBox(
					'Selected folder is not empty.',
					'Choose an empty folder with no files or subfolders to start a new story library.'
				);
				return undefined;
			}
		} catch {
			dialog.showErrorBox(
				'Story library folder cannot be used.',
				'Twine could not read the selected folder. Choose a readable empty folder.'
			);
			return undefined;
		}
	}

	await setAppPref('storyLibraryFolderPath', destinationPath);
	storyDirectoryPath = destinationPath;
	await showRelaunchDialog();
	return destinationPath;
}

/**
 * Clears the story-library app preference and uses the default story directory.
 */
export async function resetStoryDirectoryPath() {
	storyDirectoryPath = defaultStoryDirectoryPath();
	await setAppPref('storyLibraryFolderPath', undefined);
	await resetBackupDirectoryPreferenceIfUnsafe(storyDirectoryPath);
	await showRelaunchDialog();
	return storyDirectoryPath;
}

/**
 * Creates the stories directory, if it doesn't already exist. If it does exist,
 * this does nothing. In either case, it returns a promise that resolves once
 * done.
 */
export async function createStoryDirectory() {
	return await mkdirp(getStoryDirectoryPath());
}

/**
 * Shows the story directory in the user's file browser.
 */
export async function revealStoryDirectory() {
	return await shell.openPath(getStoryDirectoryPath());
}

/**
 * Returns the path where story-directory backups are stored.
 */
export function getBackupDirectoryPath() {
	const prefPath = getAppPref('backupFolderPath');

	return typeof prefPath === 'string' ? prefPath : defaultBackupDirectoryPath();
}

/**
 * Shows the backup directory in the user's file browser.
 */
export async function revealBackupDirectory() {
	return await shell.openPath(getBackupDirectoryPath());
}

/**
 * Creates a backup of the entire story directory.
 */
export async function backupStoryDirectory(
	maxBackups = backupRetentionLimit()
): Promise<NativeBackupResult> {
	const storyPath = getStoryDirectoryPath();
	const backupPath = getBackupDirectoryPath();

	console.log(`Backing up story library to ${backupPath}`);
	validateBackupDirectoryPath(storyPath, backupPath);
	await mkdirp(backupPath);

	const now = new Date();
	const backupDirectoryName = join(
		backupPath,
		`${now.getFullYear()}-${
			now.getMonth() + 1
		}-${now.getDate()} ${now.getHours()}-${now.getMinutes()}-${now.getSeconds()}-${now.getMilliseconds()}`
	);

	await copy(storyPath, backupDirectoryName, {
		filter: backupCopyFilter(storyPath, backupPath)
	});
	console.log(`Backed up story library to ${backupDirectoryName}`);

	const backupDirs = (await readdir(backupPath, {withFileTypes: true})).filter(
		file => file.isDirectory() && file.name[0] !== '.'
	);

	if (backupDirs.length > maxBackups) {
		console.log(
			`There are ${backupDirs.length} story library backups; pruning`
		);

		const backups = await Promise.all(
			backupDirs.map(async directory => {
				const stats = await stat(join(backupPath, directory.name));

				return {stats, name: directory.name};
			})
		);

		backups.sort((a, b) => a.stats.mtimeMs - b.stats.mtimeMs);

		const toDelete = backups.slice(0, backups.length - maxBackups);
		const prunedBackupNames = toDelete.map(file => file.name);

		await Promise.allSettled(
			toDelete.map(file => {
				const directoryName = join(backupPath, file.name);

				console.log(`Deleting ${directoryName}`);
				return remove(directoryName);
			})
		);

		return {
			backupDirectoryName,
			backupPath,
			createdAt: now.toISOString(),
			prunedBackupNames
		};
	}

	return {
		backupDirectoryName,
		backupPath,
		createdAt: now.toISOString(),
		prunedBackupNames: []
	};
}
