import {app, dialog, net} from 'electron';
import {
	copy,
	mkdirp,
	pathExists,
	readFile,
	realpath,
	stat,
	writeFile
} from 'fs-extra';
import {dirname, isAbsolute, join, relative, resolve} from 'path';
import {fileURLToPath, pathToFileURL} from 'url';
import {fileUrlForPath} from '../../core/asset-paths';
import {hasUrlScheme} from '../../util/has-url-scheme';
import {loadJsonFile} from './json-file';
import {extractStoryFormatProperties} from './story-format-source';

const maxStoryFormatBytes = 25 * 1024 * 1024;
const defaultStoryFormatTimeoutMs = 10_000;
const maxStoryFormatRedirects = 5;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

export async function loadStoryFormats() {
	return await loadJsonFile('story-formats.json');
}

/**
 * Result of importing a local story format: the file:// URL of the managed copy
 * (which the renderer hydrates via JSONP) plus the parsed name/version so the
 * caller can dedupe before adding.
 */
export interface AddLocalStoryFormatResult {
	name: string;
	url: string;
	version: string;
}

function managedFormatsDirectory() {
	return join(app.getPath('userData'), 'story-formats');
}

function bundledFormatsDirectory() {
	return resolve(__dirname, '../../../../renderer/story-formats');
}

function isWithin(root: string, candidate: string) {
	const within = relative(root, candidate);

	return within === '' || (!within.startsWith('..') && !isAbsolute(within));
}

async function canonicalAllowedFormatPath(filePath: string) {
	const canonicalFile = await realpath(filePath);
	const roots = [bundledFormatsDirectory(), managedFormatsDirectory()];

	for (const root of roots) {
		const canonicalRoot = await realpath(root).catch(() => resolve(root));

		if (isWithin(canonicalRoot, canonicalFile)) {
			return canonicalFile;
		}
	}

	throw new Error(
		'Story format files must be bundled or imported by Twine RS.'
	);
}

function checkedRemoteUrl(value: string) {
	const parsed = new URL(value);

	if (parsed.protocol !== 'https:') {
		throw new Error('Remote story formats must use HTTPS.');
	}

	if (!parsed.hostname) {
		throw new Error('The story format URL has no host.');
	}

	return parsed;
}

async function fetchRemoteStoryFormat(url: URL, signal: AbortSignal) {
	let current = url;

	for (let redirects = 0; ; redirects++) {
		const response = await net.fetch(current.toString(), {
			redirect: 'manual',
			signal
		});

		if (!redirectStatuses.has(response.status)) {
			return response;
		}

		if (redirects >= maxStoryFormatRedirects) {
			await response.body?.cancel();
			throw new Error('The story format URL redirected too many times.');
		}

		const location = response.headers.get('location');

		if (!location) {
			await response.body?.cancel();
			throw new Error('The story format redirect has no location.');
		}

		// Validate before issuing the redirected request. This prevents even an
		// intermediate cleartext or non-network hop from being fetched.
		current = checkedRemoteUrl(new URL(location, current).toString());
		await response.body?.cancel();
	}
}

async function boundedResponseText(response: Response) {
	const contentLength = Number(response.headers.get('content-length'));

	if (Number.isFinite(contentLength) && contentLength > maxStoryFormatBytes) {
		throw new Error('The story format response is too large.');
	}

	if (!response.body) {
		return '';
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let size = 0;
	let source = '';

	try {
		for (;;) {
			const {done, value} = await reader.read();

			if (done) {
				break;
			}

			size += value.byteLength;

			if (size > maxStoryFormatBytes) {
				await reader.cancel();
				throw new Error('The story format response is too large.');
			}

			source += decoder.decode(value, {stream: true});
		}

		return source + decoder.decode();
	} finally {
		reader.releaseLock();
	}
}

async function storyFormatSource(
	url: string,
	timeout = defaultStoryFormatTimeoutMs
) {
	if (typeof url !== 'string' || url.trim() === '') {
		throw new Error('A story format URL is required.');
	}

	const safeTimeout = Number.isFinite(timeout)
		? Math.min(Math.max(Math.trunc(timeout), 250), 30_000)
		: defaultStoryFormatTimeoutMs;
	let parsed: URL;

	try {
		parsed = new URL(
			url,
			pathToFileURL(
				resolve(__dirname, '../../../../renderer/index.html')
			).toString()
		);
	} catch {
		throw new Error('The story format URL is invalid.');
	}

	if (parsed.protocol === 'file:') {
		const filePath = await canonicalAllowedFormatPath(fileURLToPath(parsed));
		const fileStats = await stat(filePath);

		if (!fileStats.isFile() || fileStats.size > maxStoryFormatBytes) {
			throw new Error('The story format file is invalid or too large.');
		}

		const source = await readFile(filePath, 'utf8');

		if (Buffer.byteLength(source, 'utf8') > maxStoryFormatBytes) {
			throw new Error('The story format file is too large.');
		}

		return source;
	}

	const remoteUrl = checkedRemoteUrl(parsed.toString());
	const response = await fetchRemoteStoryFormat(
		remoteUrl,
		AbortSignal.timeout(safeTimeout)
	);

	if (!response.ok) {
		throw new Error(`Could not load story format: HTTP ${response.status}.`);
	}

	return boundedResponseText(response);
}

/**
 * Loads the JSON manifest without evaluating the JSONP wrapper or its optional
 * hydration program. Executable editor integration is intentionally omitted
 * from the privileged Electron renderer.
 */
export async function loadStoryFormatProperties(url: string, timeout?: number) {
	const properties = extractStoryFormatProperties(
		await storyFormatSource(url, timeout)
	);

	return {
		...properties,
		editorExtensions: undefined,
		hydrate: undefined
	};
}

function sanitizeSegment(value: string) {
	return (
		value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'format'
	);
}

/**
 * Prompts the user to pick a `format.js` file (or a folder containing one),
 * validates that it is a real Twine story format, then copies it — and its
 * relative icon — into a managed directory under userData so the icon resolves
 * and the format survives the original file being moved. Resolves to the
 * managed file:// URL + manifest identity, or `undefined` if the user cancels.
 */
export async function addLocalStoryFormat(): Promise<
	AddLocalStoryFormatResult | undefined
> {
	const {canceled, filePaths} = await dialog.showOpenDialog({
		filters: [{name: 'Story Format', extensions: ['js']}],
		// macOS can offer files and folders in one dialog; elsewhere the user
		// picks the format.js file directly (we still resolve folders below).
		properties:
			process.platform === 'darwin'
				? ['openFile', 'openDirectory']
				: ['openFile'],
		title: 'Add Story Format'
	});

	if (canceled || filePaths.length === 0) {
		return undefined;
	}

	let sourceFile = filePaths[0];

	if ((await stat(sourceFile)).isDirectory()) {
		sourceFile = join(sourceFile, 'format.js');

		if (!(await pathExists(sourceFile))) {
			throw new Error('That folder does not contain a format.js file.');
		}
	}

	const source = await readFile(sourceFile, 'utf8');
	const properties = extractStoryFormatProperties(source);
	const sourceDir = dirname(sourceFile);
	const targetDir = join(
		managedFormatsDirectory(),
		`${sanitizeSegment(properties.name)}-${sanitizeSegment(properties.version)}`
	);

	await mkdirp(targetDir);

	const targetFile = join(targetDir, 'format.js');

	await writeFile(targetFile, source, 'utf8');

	// Bring the format's icon along if it's a relative file, so the screen's
	// <img> resolves it next to the copied format.js. Absolute URLs (http/data)
	// are used as-is by the renderer and need no copying.
	if (properties.image && !hasUrlScheme(properties.image)) {
		const imageSource = join(sourceDir, properties.image);
		const imageTarget = join(targetDir, properties.image);
		const within = relative(targetDir, imageTarget);

		// Refuse path-traversal in a manifest's image field.
		if (
			!within.startsWith('..') &&
			!isAbsolute(within) &&
			(await pathExists(imageSource))
		) {
			await mkdirp(dirname(imageTarget));
			await copy(imageSource, imageTarget, {overwrite: true});
		}
	}

	const url = fileUrlForPath(resolve(targetFile));

	if (!url) {
		throw new Error('Could not resolve the copied story format path.');
	}

	return {name: properties.name, url, version: properties.version};
}
