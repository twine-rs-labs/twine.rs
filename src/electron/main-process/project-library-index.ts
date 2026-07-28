import {
	closeSync,
	constants as fsConstants,
	fstatSync,
	lstatSync,
	openSync,
	readSync,
	readdirSync,
	rmSync
} from 'fs';
import {dirname, isAbsolute, join, relative, resolve, sep} from 'path';
import type {NativeProjectFolderResult} from './project-folder';
import {
	forgetNativeProjectFolder,
	listRememberedNativeProjectFolders,
	rememberNativeProjectFolder,
	rememberNativeProjectFolderStrict,
	type NativeRememberedProjectFolder
} from './native';
import {
	type DuplicateStagingLease,
	duplicateStagingIdentity,
	duplicateStagingLease,
	duplicateStagingMarkerFilename
} from './project-duplication-staging';
import {getStoryDirectoryPath} from './story-directory';

const staleDuplicateStagingAgeMs = 24 * 60 * 60 * 1000;
const duplicateStagingMarkerMaxBytes = 512;

type DuplicateStagingGroup = Array<{path: string}>;

function duplicateStagingProcessIsActive(pid: number) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code !== 'ESRCH';
	}
}

function matchingDuplicateStagingLeases(
	left: DuplicateStagingLease,
	right: DuplicateStagingLease
) {
	return left.createdAt === right.createdAt && left.pid === right.pid;
}

function boundedDuplicateStagingMarker(markerPath: string) {
	const pathStats = lstatSync(markerPath);

	if (
		pathStats.isSymbolicLink() ||
		!pathStats.isFile() ||
		pathStats.size > duplicateStagingMarkerMaxBytes
	) {
		throw Object.assign(
			new Error('Invalid project duplication stage marker.'),
			{
				code: 'EINVAL'
			}
		);
	}

	const descriptor = openSync(
		markerPath,
		fsConstants.O_RDONLY |
			fsConstants.O_NONBLOCK |
			(fsConstants.O_NOFOLLOW ?? 0)
	);

	try {
		const beforeRead = fstatSync(descriptor);

		if (
			!beforeRead.isFile() ||
			beforeRead.size !== pathStats.size ||
			beforeRead.size > duplicateStagingMarkerMaxBytes ||
			beforeRead.dev !== pathStats.dev ||
			beforeRead.ino !== pathStats.ino
		) {
			throw Object.assign(
				new Error('Project duplication stage marker changed before reading.'),
				{code: 'EINVAL'}
			);
		}

		const marker = Buffer.alloc(beforeRead.size);
		let offset = 0;

		while (offset < marker.length) {
			const bytesRead = readSync(
				descriptor,
				marker,
				offset,
				marker.length - offset,
				offset
			);

			if (bytesRead === 0) {
				break;
			}
			offset += bytesRead;
		}

		const afterRead = fstatSync(descriptor);

		if (
			offset !== marker.length ||
			afterRead.size !== beforeRead.size ||
			afterRead.mtimeMs !== beforeRead.mtimeMs ||
			afterRead.ctimeMs !== beforeRead.ctimeMs
		) {
			throw Object.assign(
				new Error('Project duplication stage marker changed while reading.'),
				{code: 'EINVAL'}
			);
		}
		return marker.toString('utf8');
	} finally {
		closeSync(descriptor);
	}
}

function duplicateStagingGroupLeases(group: DuplicateStagingGroup) {
	let invalidMarker = false;
	const leases = group.flatMap(({path}) => {
		try {
			const lease = duplicateStagingLease(
				boundedDuplicateStagingMarker(
					join(path, duplicateStagingMarkerFilename)
				)
			);

			if (!lease) {
				invalidMarker = true;
			}
			return lease ? [lease] : [];
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				invalidMarker = true;
			}
			return [];
		}
	});

	return {invalidMarker, leases};
}

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

function newestProjectRecord(
	left: ReturnType<typeof rememberedProjectMigrationRecord> | undefined,
	right: ReturnType<typeof rememberedProjectMigrationRecord>
) {
	if (!left) {
		return right;
	}

	return Date.parse(right.project.updatedAt) >=
		Date.parse(left.project.updatedAt)
		? right
		: left;
}

export function rememberProjectFolder(project: NativeProjectFolderResult) {
	return rememberNativeProjectFolder(projectLibraryIndexPath(), {
		...project,
		rootPath: storedProjectRootPath(project.rootPath)
	});
}

export function rememberProjectFolderStrict(
	project: NativeProjectFolderResult
) {
	return rememberNativeProjectFolderStrict(projectLibraryIndexPath(), {
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
	const canonicalRecords = new Map<string, (typeof migrationRecords)[number]>();

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

		canonicalRecords.set(
			resolve(record.project.rootPath),
			newestProjectRecord(
				canonicalRecords.get(resolve(record.project.rootPath)),
				record
			)
		);
	}

	const rememberedProjects = [...canonicalRecords.values()].map(
		record => record.project
	);

	for (const parentPath of new Set(
		rememberedProjects.map(project => dirname(project.rootPath))
	)) {
		try {
			const stagingGroups = new Map<string, DuplicateStagingGroup>();

			for (const entry of readdirSync(parentPath, {withFileTypes: true})) {
				const identity = entry.isDirectory()
					? duplicateStagingIdentity(entry.name)
					: undefined;

				if (!identity) {
					continue;
				}

				const stagingPath = join(parentPath, entry.name);
				const group = stagingGroups.get(identity) ?? [];

				group.push({path: stagingPath});
				stagingGroups.set(identity, group);
			}

			for (const group of stagingGroups.values()) {
				const {invalidMarker, leases} = duplicateStagingGroupLeases(group);
				const lease = leases[0];

				if (
					invalidMarker ||
					!lease ||
					!leases.every(candidate =>
						matchingDuplicateStagingLeases(lease, candidate)
					) ||
					Date.now() - lease.createdAt < staleDuplicateStagingAgeMs ||
					duplicateStagingProcessIsActive(lease.pid)
				) {
					continue;
				}

				const revalidated = duplicateStagingGroupLeases(group);

				if (
					revalidated.invalidMarker ||
					revalidated.leases.length !== leases.length ||
					!revalidated.leases.every(candidate =>
						matchingDuplicateStagingLeases(lease, candidate)
					) ||
					duplicateStagingProcessIsActive(lease.pid)
				) {
					continue;
				}

				for (const staging of group) {
					const stagingStats = lstatSync(staging.path);

					if (stagingStats.isDirectory() && !stagingStats.isSymbolicLink()) {
						rmSync(staging.path, {force: true, recursive: true});
					}
				}
			}
		} catch {
			// Startup cleanup is best-effort. A later duplicate still uses a
			// fresh staging directory and cannot overwrite a destination.
		}
	}

	return rememberedProjects;
}
