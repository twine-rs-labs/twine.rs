// Parses a Twine story format's `format.js` source into its manifest
// properties WITHOUT executing it. Twine formats are distributed as a JSONP
// call — `window.storyFormat({ ...manifest... })` — so we locate that call and
// extract the single JSON object argument with a string-aware brace scan, then
// JSON.parse it. Kept free of Electron imports so it is straightforward to unit
// test (W7.3 validation: "is this actually a story format?").

import type {StoryFormatProperties} from '../../store/story-formats/story-formats.types';

const storyFormatCall = /(?:window\.|this\.)?storyFormat\s*\(/;
const setupProperty = /,\s*"setup"\s*:\s*function\b/g;

function parseSerializableManifestPrefix(source: string, open: number) {
	setupProperty.lastIndex = open;

	for (
		let match = setupProperty.exec(source);
		match;
		match = setupProperty.exec(source)
	) {
		try {
			// Harlowe appends a legacy editor-only setup function after its JSON
			// manifest fields. Parse only the validated JSON prefix so privileged
			// Electron code never evaluates that function or anything after it.
			return JSON.parse(`${source.slice(open, match.index)}}`);
		} catch {
			// A matching string inside a manifest value cannot form a valid JSON
			// object prefix. Keep looking for the top-level setup property.
		}
	}
}

export function extractStoryFormatProperties(
	source: string
): StoryFormatProperties {
	const call = storyFormatCall.exec(source);

	if (!call) {
		throw new Error(
			'This file is not a Twine story format (no storyFormat() call found).'
		);
	}

	const open = source.indexOf('{', call.index + call[0].length);

	if (open === -1) {
		throw new Error('This story format has no manifest object.');
	}

	// Walk forward to the brace that closes the manifest object, ignoring braces
	// that appear inside string literals (descriptions routinely contain them).
	let depth = 0;
	let inString = false;
	let quote = '';
	let end = -1;

	for (let i = open; i < source.length; i++) {
		const char = source[i];

		if (inString) {
			if (char === '\\') {
				i++; // skip the escaped character
				continue;
			}

			if (char === quote) {
				inString = false;
			}

			continue;
		}

		if (char === '"' || char === "'") {
			inString = true;
			quote = char;
		} else if (char === '{') {
			depth++;
		} else if (char === '}') {
			depth--;

			if (depth === 0) {
				end = i + 1;
				break;
			}
		}
	}

	let properties: StoryFormatProperties | undefined;

	if (end !== -1) {
		try {
			properties = JSON.parse(source.slice(open, end));
		} catch {
			// Some legacy formats append a non-JSON setup function. It is
			// editor-only and is intentionally excluded below.
		}
	}

	properties ??= parseSerializableManifestPrefix(source, open);

	if (!properties) {
		throw new Error(
			end === -1
				? 'This story format manifest is malformed.'
				: 'This story format manifest is not valid JSON.'
		);
	}

	if (
		!properties ||
		typeof properties.name !== 'string' ||
		typeof properties.version !== 'string'
	) {
		throw new Error('This story format manifest is missing a name or version.');
	}

	return properties;
}
