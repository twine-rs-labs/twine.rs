import {app, shell} from 'electron';
import {randomUUID} from 'crypto';
import {mkdir, mkdirp, readdir, remove, stat, writeFile} from 'fs-extra';
import {dirname, join, resolve, sep} from 'path';
import {i18n} from './locales';
import {getAppPref} from './app-prefs';

export const maxScratchPreviewBytes = 50 * 1024 * 1024;
export const maxScratchPreviewAssetBytes = 50 * 1024 * 1024;
export const maxScratchPreviewAssetCount = 1000;
export const maxRetainedScratchPreviews = 3;
const scratchPreviewDirectoryPattern = /^preview-[0-9a-f-]+$/;
let scratchPreviewQueue = Promise.resolve();

export interface ScratchFileAsset {
	bytes: ArrayBuffer | Uint8Array;
	outputPath: string;
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
	).filter(
		file =>
			(!file.isDirectory() && /\.html$/.test(file.name)) ||
			(file.isDirectory() && scratchPreviewDirectoryPattern.test(file.name))
	);

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

function assertSafeScratchPreviewData(data: string) {
	if (
		typeof data !== 'string' ||
		Buffer.byteLength(data, 'utf8') > maxScratchPreviewBytes
	) {
		throw new Error('Scratch preview exceeds the safe payload limit.');
	}
}

async function writeUniqueScratchFile(data: string) {
	return queueScratchPreview(() => writeScratchPreview(data, []));
}

export async function openWithScratchFile(data: string) {
	const scratchPath = await writeUniqueScratchFile(data);
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

function scratchAssetByteLength(asset: ScratchFileAsset) {
	return asset.bytes instanceof ArrayBuffer
		? asset.bytes.byteLength
		: asset.bytes.byteLength;
}

function validateScratchAssets(assets: ScratchFileAsset[]) {
	if (assets.length > maxScratchPreviewAssetCount) {
		throw new Error('Scratch preview asset count exceeds the safe limit.');
	}

	let totalBytes = 0;
	const outputPaths = new Set<string>();

	for (const asset of assets) {
		const normalizedOutputPath = safeScratchAssetOutputPath(asset.outputPath);

		if (outputPaths.has(normalizedOutputPath)) {
			throw new Error(`Duplicate scratch asset path "${asset.outputPath}".`);
		}
		outputPaths.add(normalizedOutputPath);
		totalBytes += scratchAssetByteLength(asset);

		if (totalBytes > maxScratchPreviewAssetBytes) {
			throw new Error('Scratch preview assets exceed the safe byte limit.');
		}
	}
}

async function pruneScratchPreviews(scratchRoot: string) {
	const entries = await Promise.resolve(
		readdir(scratchRoot, {withFileTypes: true})
	).catch(() => []);
	const previews = (entries ?? []).filter(
		entry =>
			entry.isDirectory() && scratchPreviewDirectoryPattern.test(entry.name)
	);
	const dated = await Promise.all(
		previews.map(async entry => ({
			mtimeMs: (await stat(join(scratchRoot, entry.name))).mtimeMs,
			path: join(scratchRoot, entry.name)
		}))
	);

	dated.sort((left, right) => left.mtimeMs - right.mtimeMs);
	for (const preview of dated.slice(
		0,
		Math.max(0, dated.length - maxRetainedScratchPreviews + 1)
	)) {
		await remove(preview.path);
	}
}

async function writeScratchPreview(data: string, assets: ScratchFileAsset[]) {
	assertSafeScratchPreviewData(data);
	validateScratchAssets(assets);
	const scratchRoot = scratchDirectoryPath();

	await mkdirp(scratchRoot);
	await pruneScratchPreviews(scratchRoot);
	const previewRoot = join(scratchRoot, `preview-${randomUUID()}`);

	// A new exclusive directory prevents stale links from becoming write targets.
	await mkdir(previewRoot);
	for (const asset of assets) {
		const targetPath = safeScratchAssetPath(previewRoot, asset.outputPath);

		await mkdirp(dirname(targetPath));
		await writeFile(targetPath, new Uint8Array(asset.bytes), {flag: 'wx'});
	}
	const scratchPath = join(previewRoot, 'index.html');

	await writeFile(scratchPath, data, {encoding: 'utf8', flag: 'wx'});
	return scratchPath;
}

function queueScratchPreview<T>(operation: () => Promise<T>) {
	const result = scratchPreviewQueue.then(operation, operation);

	scratchPreviewQueue = result.then(
		() => undefined,
		() => undefined
	);
	return result;
}

export async function openWithScratchPackage(
	data: string,
	assets: ScratchFileAsset[] = []
) {
	const scratchPath = await queueScratchPreview(() =>
		writeScratchPreview(data, assets)
	);
	const openError = await shell.openPath(scratchPath);

	if (openError) {
		throw new Error(openError);
	}
}
