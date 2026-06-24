import {app, dialog} from 'electron';
import {copy, mkdirp, pathExists, readFile, stat, writeFile} from 'fs-extra';
import {dirname, isAbsolute, join, relative, resolve} from 'path';
import isAbsoluteUrl from 'is-absolute-url';
import {fileUrlForPath} from '../../core/asset-paths';
import {loadJsonFile} from './json-file';
import {extractStoryFormatProperties} from './story-format-source';

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

function sanitizeSegment(value: string) {
	return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'format';
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
	if (properties.image && !isAbsoluteUrl(properties.image)) {
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
