import {app, dialog, shell} from 'electron';
import {
	mkdtemp,
	move,
	readdir,
	readFile,
	rename,
	stat,
	writeFile
} from 'fs-extra';
import {basename, join, resolve} from 'path';
import {i18n} from './locales';
import {openProjectFolder} from './project-folder';
import {
	forgetProjectFolder,
	rememberedProjectFolders
} from './project-library-index';
import {getStoryDirectoryPath} from './story-directory';
import {Story} from '../../store/stories/stories.types';
import type {
	ElectronLegacyStoryFile,
	ElectronLoadedStoryEntry
} from '../shared';
import {storyFileName} from '../shared/story-filename';
import {
	stopTrackingFile,
	fileWasTouched,
	wasFileChangedExternally
} from './track-file-changes';

export interface StoryFile extends ElectronLegacyStoryFile {}

function appendNativeProjectStories(
	result: ElectronLoadedStoryEntry[],
	openedProject: Awaited<ReturnType<typeof openProjectFolder>>
) {
	if (!openedProject) {
		return;
	}

	for (const story of openedProject.stories) {
		result.push({
			kind: 'native-project',
			passageTextLoaded: openedProject.passageTextLoaded !== false,
			rootPath: openedProject.rootPath,
			story,
			storyIds: openedProject.storyIds
		});
	}
}

async function directoryEntries(path: string) {
	try {
		return await readdir(path, {withFileTypes: true});
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;

		if (code === 'ENOENT' || code === 'ENOTDIR') {
			return [];
		}

		throw error;
	}
}

async function isNativeProjectFolder(path: string) {
	try {
		const manifestStats = await stat(join(path, 'twine.toml'));

		return manifestStats.isFile();
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;

		if (code === 'ENOENT' || code === 'ENOTDIR') {
			return false;
		}

		throw error;
	}
}

async function scanNativeProjectFolders() {
	const storyPath = getStoryDirectoryPath();
	const parentPaths = [storyPath, join(storyPath, 'Projects')];
	const result: string[] = [];

	for (const parentPath of parentPaths) {
		const entries = await directoryEntries(parentPath);

		await Promise.all(
			entries
				.filter(
					entry =>
						typeof entry !== 'string' &&
						entry.isDirectory() &&
						entry.name[0] !== '.'
				)
				.map(async entry => {
					const candidatePath = join(parentPath, entry.name);

					if (await isNativeProjectFolder(candidatePath)) {
						result.push(candidatePath);
					}
				})
		);
	}

	return result;
}

async function loadRememberedProjectStories(
	result: ElectronLoadedStoryEntry[]
) {
	const rememberedProjects = rememberedProjectFolders();
	const loadedProjectPaths = new Set<string>();
	const missingProjectPathsByBasename = new Map<string, string[]>();

	for (const project of rememberedProjects) {
		try {
			const openedProject = await openProjectFolder(project.rootPath, {
				loadPassageText: false
			});

			appendNativeProjectStories(result, openedProject);

			if (openedProject) {
				loadedProjectPaths.add(resolve(openedProject.rootPath));
			}
		} catch (error) {
			console.warn(
				`Could not load remembered native project ${project.rootPath}: ${
					(error as Error).message
				}`
			);

			const code = (error as NodeJS.ErrnoException).code;

			if (code === 'ENOENT' || code === 'ENOTDIR') {
				const projectBasename = basename(project.rootPath);
				const paths = missingProjectPathsByBasename.get(projectBasename) ?? [];

				paths.push(project.rootPath);
				missingProjectPathsByBasename.set(projectBasename, paths);
			}
		}
	}

	if (
		rememberedProjects.length === 0 ||
		missingProjectPathsByBasename.size > 0
	) {
		for (const projectPath of await scanNativeProjectFolders()) {
			if (loadedProjectPaths.has(resolve(projectPath))) {
				continue;
			}

			try {
				const openedProject = await openProjectFolder(projectPath, {
					loadPassageText: false
				});

				appendNativeProjectStories(result, openedProject);

				if (openedProject) {
					loadedProjectPaths.add(resolve(openedProject.rootPath));
				}
			} catch (error) {
				console.warn(
					`Could not load scanned native project ${projectPath}: ${
						(error as Error).message
					}`
				);
			}
		}
	}

	for (const missingProjectPaths of missingProjectPathsByBasename.values()) {
		for (const missingProjectPath of missingProjectPaths) {
			forgetProjectFolder(missingProjectPath);
		}
	}
}

/**
 * Returns native project stories remembered by the project library index, then
 * legacy HTML story files from the story directory.
 */
export async function loadStories() {
	const storyPath = getStoryDirectoryPath();
	const result: ElectronLoadedStoryEntry[] = [];

	await loadRememberedProjectStories(result);

	let files: string[];

	try {
		files = await readdir(storyPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return result;
		}

		throw error;
	}

	await Promise.all(
		files
			.filter(f => /\.html$/i.test(f))
			.map(async f => {
				const filePath = join(storyPath, f);
				const stats = await stat(filePath);

				if (!stats.isDirectory()) {
					result.push({
						mtime: stats.mtime,
						htmlSource: await readFile(filePath, 'utf8')
					});
					return fileWasTouched(filePath);
				}
			})
	);

	return result;
}

/**
 * Saves story HTML to the file system. This returns a promise that resolves
 * when complete.
 */
export async function saveStoryHtml(story: Story, storyHtml: string) {
	// We save to a temp file first, then overwrite the existing if that succeeds,
	// so that if any step fails, the original file is left intact.

	const savedFilePath = join(getStoryDirectoryPath(), storyFileName(story));

	console.log(`Saving ${savedFilePath}`);

	try {
		const tempFileDirectory = await mkdtemp(
			join(app.getPath('temp'), `twine-${story.id}`)
		);
		const tempFilePath = join(tempFileDirectory, storyFileName(story));

		if (await wasFileChangedExternally(savedFilePath)) {
			const {response} = await dialog.showMessageBox({
				buttons: [
					i18n.t('electron.errors.storyFileChangedExternally.overwriteChoice'),
					i18n.t('electron.errors.storyFileChangedExternally.relaunchChoice')
				],
				detail: i18n.t('electron.errors.storyFileChangedExternally.detail'),
				message: i18n.t('electron.errors.storyFileChangedExternally.message', {
					fileName: basename(savedFilePath)
				}),
				type: 'warning'
			});

			if (response === 1) {
				app.relaunch();
				app.quit();
				return;
			}
		}

		await writeFile(tempFilePath, storyHtml, 'utf8');
		await move(tempFilePath, savedFilePath, {
			overwrite: true
		});
		await fileWasTouched(savedFilePath);
		console.log(`Successfully saved ${savedFilePath}`);
	} catch (e) {
		console.error(`Error while saving ${savedFilePath}: ${e}`);
		throw e;
	}
}

/**
 * Deletes a story by moving it to the trash. This returns a promise that resolves
 * when finished.
 */
export async function deleteStory(story: Story) {
	try {
		const deletedFilePath = join(getStoryDirectoryPath(), storyFileName(story));

		console.log(`Trashing ${deletedFilePath}`);
		await shell.trashItem(deletedFilePath);
		stopTrackingFile(deletedFilePath);
		console.log(`Successfully trashed ${deletedFilePath}`);
	} catch (e) {
		console.warn(`Error while deleting story: ${e}`);
		throw e;
	}
}

/**
 * Renames a story in the file system. This returns a promise that resolves when
 * finished.
 */
export async function renameStory(oldStory: Story, newStory: Story) {
	try {
		const storyPath = getStoryDirectoryPath();
		const newStoryPath = join(storyPath, storyFileName(newStory));
		const oldStoryPath = join(storyPath, storyFileName(oldStory));

		console.log(`Renaming ${oldStoryPath} to ${newStoryPath}`);
		await rename(oldStoryPath, newStoryPath);
		stopTrackingFile(oldStoryPath);
		await fileWasTouched(newStoryPath);
		console.log(`Successfully renamed ${oldStoryPath} to ${newStoryPath}`);
	} catch (e) {
		console.warn(`Error while renaming story: ${e}`);
		throw e;
	}
}
