import {app} from 'electron';
import {randomUUID} from 'crypto';
import {mkdir, mkdirp, readdir, remove, stat, writeFile} from 'fs-extra';
import {dirname, join, resolve, sep} from 'path';
import {i18n} from './locales';
import {getAppPref} from './app-prefs';

export const maxScratchPreviewBytes = 50 * 1024 * 1024;
export const maxScratchPreviewAssetBytes = 50 * 1024 * 1024;
export const maxScratchPreviewAssetCount = 1000;
export const maxScratchPreviewSessionBytes =
	3 * (maxScratchPreviewBytes + maxScratchPreviewAssetBytes);
const scratchPreviewDirectoryPattern = /^preview-[0-9a-f-]+$/;
const scratchPreviewSessionPrefix = `preview-${randomUUID()}-`;
let scratchPreviewQueue = Promise.resolve();
let scratchPreviewShutdownStarted = false;
const currentScratchPreviewRoots = new Map<string, number>();

export interface ScratchFileAsset {
	bytes: ArrayBuffer | Uint8Array;
	mediaType?: string;
	outputPath: string;
}

export interface StagedScratchPreviewFile {
	bytes: Uint8Array;
	mediaType?: string;
	outputPath: string;
	path: string;
	sizeBytes: number;
}

export interface StagedScratchPreviewPackage {
	files: StagedScratchPreviewFile[];
	indexPath: string;
	rootPath: string;
	sizeBytes: number;
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

function scratchFileCleanupAgeMs() {
	const agePref =
		getAppPref('scratchFileCleanupAge') !== undefined
			? parseInt((getAppPref('scratchFileCleanupAge') as object).toString())
			: NaN;

	// milliseconds -> seconds -> minutes -> hours -> days
	return 1000 * 60 * (isFinite(agePref) ? agePref : 60 * 24 * 3);
}

/**
 * Deletes previews created during this application session and all other
 * scratch files older than either 3 days, or a number of minutes set in the
 * `scratchFileCleanupAge` app preference.
 */
export async function cleanScratchDirectory() {
	return queueScratchPreview(async () => {
		console.log('Cleaning scratch directory');

		const tooOld = scratchFileCleanupAgeMs();
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

				if (
					currentScratchPreviewRoots.has(scratchFile) ||
					now - stats.mtimeMs > tooOld
				) {
					console.log(`Deleting scratch preview ${scratchFile}`);
					await remove(scratchFile);
					currentScratchPreviewRoots.delete(scratchFile);
				}
			})
		);
	});
}

function assertSafeScratchPreviewData(data: string) {
	if (
		typeof data !== 'string' ||
		Buffer.byteLength(data, 'utf8') > maxScratchPreviewBytes
	) {
		throw new Error('Scratch preview exceeds the safe payload limit.');
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

export function safeScratchAssetOutputPath(outputPath: string) {
	const normalized = outputPath.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
	const segments = normalized.split('/').filter(segment => segment.length > 0);

	if (
		normalized.startsWith('/') ||
		hasUrlScheme(normalized) ||
		normalized === 'index.html' ||
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

function scratchPreviewByteLength(data: string, assets: ScratchFileAsset[]) {
	return (
		Buffer.byteLength(data, 'utf8') +
		assets.reduce((total, asset) => total + scratchAssetByteLength(asset), 0)
	);
}

function currentScratchPreviewBytes() {
	return [...currentScratchPreviewRoots.values()].reduce(
		(total, bytes) => total + bytes,
		0
	);
}

async function removeExpiredScratchPreviews(scratchRoot: string) {
	const entries = await Promise.resolve(
		readdir(scratchRoot, {withFileTypes: true})
	).catch(() => []);
	const previews = (entries ?? []).filter(
		entry =>
			entry.isDirectory() &&
			scratchPreviewDirectoryPattern.test(entry.name) &&
			!entry.name.startsWith(scratchPreviewSessionPrefix)
	);

	for (const preview of previews) {
		const previewRoot = join(scratchRoot, preview.name);
		const stats = await Promise.resolve(stat(previewRoot)).catch(() => null);

		if (stats && Date.now() - stats.mtimeMs > scratchFileCleanupAgeMs()) {
			await remove(previewRoot);
		}
	}
}

async function removeScratchPreviewRoot(previewRoot: string) {
	try {
		await remove(previewRoot);
		currentScratchPreviewRoots.delete(previewRoot);
	} catch (error) {
		console.warn(`Could not remove scratch preview ${previewRoot}.`, error);
	}
}

async function writeScratchPreview(
	data: string,
	assets: ScratchFileAsset[]
): Promise<StagedScratchPreviewPackage> {
	assertSafeScratchPreviewData(data);
	validateScratchAssets(assets);
	const previewBytes = scratchPreviewByteLength(data, assets);

	if (
		currentScratchPreviewBytes() + previewBytes >
		maxScratchPreviewSessionBytes
	) {
		throw new Error('Scratch preview session exceeds the safe byte limit.');
	}
	const scratchRoot = scratchDirectoryPath();

	await mkdirp(scratchRoot);
	await removeExpiredScratchPreviews(scratchRoot);
	const previewRoot = join(
		scratchRoot,
		`${scratchPreviewSessionPrefix}${randomUUID()}`
	);

	// A new exclusive directory prevents stale links from becoming write targets.
	await mkdir(previewRoot);
	currentScratchPreviewRoots.set(previewRoot, previewBytes);
	try {
		const files: StagedScratchPreviewFile[] = [];

		for (const asset of assets) {
			const outputPath = safeScratchAssetOutputPath(asset.outputPath);
			const targetPath = safeScratchAssetPath(previewRoot, outputPath);
			const sizeBytes = scratchAssetByteLength(asset);
			const bytes = new Uint8Array(asset.bytes).slice();

			await mkdirp(dirname(targetPath));
			await writeFile(targetPath, bytes, {flag: 'wx'});
			files.push({
				bytes,
				mediaType: asset.mediaType,
				outputPath,
				path: targetPath,
				sizeBytes
			});
		}
		const scratchPath = join(previewRoot, 'index.html');
		const htmlBuffer = Buffer.from(data, 'utf8');
		const htmlBytes = htmlBuffer.byteLength;

		await writeFile(scratchPath, data, {encoding: 'utf8', flag: 'wx'});
		return {
			files: [
				{
					bytes: new Uint8Array(htmlBuffer),
					mediaType: 'text/html; charset=utf-8',
					outputPath: 'index.html',
					path: scratchPath,
					sizeBytes: htmlBytes
				},
				...files
			],
			indexPath: scratchPath,
			rootPath: previewRoot,
			sizeBytes: previewBytes
		};
	} catch (error) {
		await removeScratchPreviewRoot(previewRoot);
		throw error;
	}
}

function queueScratchPreview<T>(operation: () => Promise<T>) {
	const result = scratchPreviewQueue.then(operation, operation);

	scratchPreviewQueue = result.then(
		() => undefined,
		() => undefined
	);
	return result;
}

function queueScratchPreviewStage<T>(operation: () => Promise<T>) {
	if (scratchPreviewShutdownStarted) {
		return Promise.reject(
			new Error('Scratch previews cannot be staged while the app is quitting.')
		);
	}

	return queueScratchPreview(operation);
}

export function beginScratchPreviewShutdown() {
	scratchPreviewShutdownStarted = true;
}

export function resumeScratchPreviewsAfterFailedShutdown() {
	scratchPreviewShutdownStarted = false;
}

/** Stages an owned package without opening it in the system browser. */
export async function stageScratchPreviewPackage(
	data: string,
	assets: ScratchFileAsset[] = []
) {
	return queueScratchPreviewStage(() => writeScratchPreview(data, assets));
}

/** Idempotently releases a staged package and its tracked byte budget. */
export async function releaseScratchPreviewPackage(
	stagedPackage: StagedScratchPreviewPackage
) {
	return queueScratchPreview(async () => {
		if (currentScratchPreviewRoots.has(stagedPackage.rootPath)) {
			await removeScratchPreviewRoot(stagedPackage.rootPath);
		}
	});
}
