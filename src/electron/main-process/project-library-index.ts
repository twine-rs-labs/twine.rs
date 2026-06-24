import {isAbsolute, join, relative, resolve, sep} from 'path';
import type {NativeProjectFolderResult} from './project-folder';
import {
	forgetNativeProjectFolder,
	listRememberedNativeProjectFolders,
	rememberNativeProjectFolder,
	type NativeRememberedProjectFolder
} from './native';
import {getStoryDirectoryPath} from './story-directory';

export function projectLibraryIndexPath() {
	return join(getStoryDirectoryPath(), '.twine', 'native-projects.json');
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

function storedProjectRootPath(rootPath: string) {
	const storyDirectoryPath = getStoryDirectoryPath();
	const resolvedRootPath = resolve(rootPath);

	if (pathContainsPath(storyDirectoryPath, resolvedRootPath)) {
		return relative(resolve(storyDirectoryPath), resolvedRootPath) || '.';
	}

	return resolvedRootPath;
}

function resolvedProjectRootPath(rootPath: string) {
	return isAbsolute(rootPath)
		? resolve(rootPath)
		: resolve(getStoryDirectoryPath(), rootPath);
}

function rememberedProjectMigrationRecord(
	project: NativeRememberedProjectFolder
) {
	const resolvedRootPath = resolvedProjectRootPath(project.rootPath);
	const storedRootPath = storedProjectRootPath(resolvedRootPath);

	return {
		changed: storedRootPath !== project.rootPath,
		originalRootPath: project.rootPath,
		project: {
			...project,
			rootPath: resolvedRootPath
		},
		storedRootPath
	};
}

export function rememberProjectFolder(project: NativeProjectFolderResult) {
	return rememberNativeProjectFolder(projectLibraryIndexPath(), {
		...project,
		rootPath: storedProjectRootPath(project.rootPath)
	});
}

export function forgetProjectFolder(rootPath: string) {
	const indexPath = projectLibraryIndexPath();
	const storedRootPath = storedProjectRootPath(rootPath);
	const result = forgetNativeProjectFolder(indexPath, storedRootPath);

	if (storedRootPath !== rootPath) {
		forgetNativeProjectFolder(indexPath, rootPath);
	}

	return result;
}

export function rememberedProjectFolders() {
	const indexPath = projectLibraryIndexPath();
	const projects = listRememberedNativeProjectFolders(indexPath) ?? [];
	const migrationRecords = projects.map(rememberedProjectMigrationRecord);

	for (const record of migrationRecords) {
		if (record.changed) {
			forgetNativeProjectFolder(indexPath, record.originalRootPath);
			rememberNativeProjectFolder(indexPath, {
				passageTextLoaded: false,
				rootPath: record.storedRootPath,
				stories: [],
				storyIds: record.project.storyIds
			});
		}
	}

	return migrationRecords.map(record => record.project);
}
