import {app, shell} from 'electron';
import {
	copy,
	ensureSymlink,
	lstat,
	mkdirp,
	readdir,
	remove,
	stat,
	writeFile
} from 'fs-extra';
import {dirname, join, resolve, sep} from 'path';
import {i18n} from './locales';
import {getAppPref} from './app-prefs';
import {scratchAssetStrategy} from './platform-settings';

export interface ScratchFileAsset {
	outputPath: string;
	sourcePath: string | null;
}

interface PlannedScratchAsset {
	normalizedOutputPath: string;
	sourcePath: string;
	targetPath: string;
}

interface ScratchAssetGroup {
	assets: PlannedScratchAsset[];
	outputRoot: string;
}

/**
 * Returns the path to the scratch directory. This can be overridden by the app
 * pref `scratchFolderPath`.
 */
export function scratchDirectoryPath() {
	const folderPref = getAppPref('scratchFolderPath');

	return typeof folderPref === 'string'
		? folderPref
		: join(
				app.getPath('documents'),
				app.getName(),
				i18n.t('electron.scratchDirectoryName')
			);
}

/**
 * Deletes all files in the scratch directory older than either 3 days, or a
 * number of minutes set in the `scratchFileCleanupAge` app preference.
 */
export async function cleanScratchDirectory() {
	console.log('Cleaning scratch directory');

	// Coerce the app pref to an integer. If it was set via CLI argument, it may
	// come in as a string.
	const agePref =
		getAppPref('scratchFileCleanupAge') !== undefined
			? parseInt((getAppPref('scratchFileCleanupAge') as object).toString())
			: NaN;

	// milliseconds -> seconds -> minutes -> hours -> days
	const tooOld = 1000 * 60 * (isFinite(agePref) ? agePref : 60 * 24 * 3);
	const now = Date.now();
	const scratchFiles = (
		await readdir(scratchDirectoryPath(), {withFileTypes: true})
	).filter(file => !file.isDirectory() && /\.html$/.test(file.name));

	return Promise.all(
		scratchFiles.map(async file => {
			const scratchFile = join(scratchDirectoryPath(), file.name);
			const stats = await stat(scratchFile);

			if (now - stats.mtimeMs > tooOld) {
				console.log(`Deleting old scratch file ${scratchFile}`);
				return await remove(scratchFile);
			}
		})
	);
}

export async function openWithScratchFile(data: string, filename: string) {
	const scratchPath = join(scratchDirectoryPath(), filename);

	await mkdirp(scratchDirectoryPath());
	await writeFile(scratchPath, data, 'utf8');
	const openError = await shell.openPath(scratchPath);

	if (openError) {
		throw new Error(openError);
	}
}

function safeScratchAssetPath(root: string, outputPath: string) {
	const normalizedRoot = resolve(root);
	const normalizedOutputPath = safeScratchAssetOutputPath(outputPath);
	const target = resolve(normalizedRoot, ...normalizedOutputPath.split('/'));
	const rootWithSeparator = normalizedRoot.endsWith(sep)
		? normalizedRoot
		: `${normalizedRoot}${sep}`;

	if (target !== normalizedRoot && target.startsWith(rootWithSeparator)) {
		return target;
	}

	throw new Error(`Unsafe scratch asset path "${outputPath}".`);
}

function hasUrlScheme(path: string) {
	return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path);
}

function safeScratchAssetOutputPath(outputPath: string) {
	const normalized = outputPath.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
	const segments = normalized.split('/').filter(segment => segment.length > 0);

	if (
		normalized.startsWith('/') ||
		hasUrlScheme(normalized) ||
		segments.length === 0 ||
		segments.some(segment => segment === '.' || segment === '..')
	) {
		throw new Error(`Unsafe scratch asset path "${outputPath}".`);
	}

	return segments.join('/');
}

function comparablePath(path: string) {
	const normalized = resolve(path).replace(/\\/g, '/');

	return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function samePath(left: string, right: string) {
	return comparablePath(left) === comparablePath(right);
}

function sourceRootForOutputPath(sourcePath: string, outputPath: string) {
	const normalizedSource = resolve(sourcePath).replace(/\\/g, '/');
	const suffix = `/${outputPath}`;
	const comparableSource =
		process.platform === 'win32'
			? normalizedSource.toLowerCase()
			: normalizedSource;
	const comparableSuffix =
		process.platform === 'win32' ? suffix.toLowerCase() : suffix;

	if (!comparableSource.endsWith(comparableSuffix)) {
		return null;
	}

	return normalizedSource.slice(0, normalizedSource.length - suffix.length);
}

function copyableScratchAssetGroups(
	scratchRoot: string,
	assets: ScratchFileAsset[]
) {
	const groups = new Map<string, ScratchAssetGroup>();

	for (const asset of assets) {
		if (!asset.sourcePath) {
			continue;
		}

		const normalizedOutputPath = safeScratchAssetOutputPath(asset.outputPath);
		const [outputRoot] = normalizedOutputPath.split('/');
		const group = groups.get(outputRoot) ?? {assets: [], outputRoot};

		group.assets.push({
			normalizedOutputPath,
			sourcePath: asset.sourcePath,
			targetPath: safeScratchAssetPath(scratchRoot, normalizedOutputPath)
		});
		groups.set(outputRoot, group);
	}

	return [...groups.values()];
}

function linkSourceForGroup(scratchRoot: string, group: ScratchAssetGroup) {
	let groupSourcePath: string | undefined;

	for (const asset of group.assets) {
		const sourceRoot = sourceRootForOutputPath(
			asset.sourcePath,
			asset.normalizedOutputPath
		);

		if (!sourceRoot) {
			return null;
		}

		const sourcePath = resolve(sourceRoot, group.outputRoot);

		if (
			samePath(sourcePath, safeScratchAssetPath(scratchRoot, group.outputRoot))
		) {
			return null;
		}

		if (groupSourcePath && !samePath(groupSourcePath, sourcePath)) {
			return null;
		}

		groupSourcePath = sourcePath;
	}

	return groupSourcePath ?? null;
}

async function removeScratchAssetLinkIfPresent(targetPath: string) {
	const stats = await Promise.resolve(lstat(targetPath)).catch(() => null);

	if (stats?.isSymbolicLink?.()) {
		await remove(targetPath);
	}
}

async function copyScratchAssetGroup(
	scratchRoot: string,
	group: ScratchAssetGroup
) {
	await removeScratchAssetLinkIfPresent(
		safeScratchAssetPath(scratchRoot, group.outputRoot)
	);

	for (const asset of group.assets) {
		await mkdirp(dirname(asset.targetPath));
		await copy(asset.sourcePath, asset.targetPath);
	}
}

async function linkScratchAssetGroup(
	scratchRoot: string,
	group: ScratchAssetGroup,
	sourcePath: string
) {
	const targetPath = safeScratchAssetPath(scratchRoot, group.outputRoot);

	await remove(targetPath);
	await mkdirp(dirname(targetPath));
	await ensureSymlink(
		sourcePath,
		targetPath,
		process.platform === 'win32' ? 'junction' : 'dir'
	);
}

async function prepareScratchAssets(
	scratchRoot: string,
	assets: ScratchFileAsset[]
) {
	const groups = copyableScratchAssetGroups(scratchRoot, assets);
	const useFolderLinks = scratchAssetStrategy() === 'link';

	for (const group of groups) {
		const sourcePath = useFolderLinks
			? linkSourceForGroup(scratchRoot, group)
			: null;

		if (sourcePath) {
			try {
				await linkScratchAssetGroup(scratchRoot, group, sourcePath);
				continue;
			} catch (error) {
				console.warn(
					`Unable to link scratch asset folder "${group.outputRoot}", copying assets instead.`,
					error
				);
			}
		}

		await copyScratchAssetGroup(scratchRoot, group);
	}
}

export async function openWithScratchPackage(
	data: string,
	filename: string,
	assets: ScratchFileAsset[] = []
) {
	const scratchRoot = scratchDirectoryPath();
	const scratchPath = join(scratchRoot, filename);

	await mkdirp(scratchRoot);
	await prepareScratchAssets(scratchRoot, assets);
	await writeFile(scratchPath, data, 'utf8');
	const openError = await shell.openPath(scratchPath);

	if (openError) {
		throw new Error(openError);
	}
}
