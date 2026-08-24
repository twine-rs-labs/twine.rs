import {builtins} from '../store/story-formats/defaults';
import type {
	StoryFormat,
	StoryFormatProperties
} from '../store/story-formats/story-formats.types';
import {
	HARLOWE_3_3_9_COMPATIBILITY,
	type ExactHarloweAdapterId
} from './story-preview-harlowe';
import {
	sugarCubeCompatibilityForAdapter,
	sugarCubeCompatibilityForVersion,
	type BundledSugarCubeVersion,
	type ExactSugarCubeAdapterId
} from './story-preview-sugarcube';

export type PreviewFormatAdmission =
	| {
			adapterId: ExactSugarCubeAdapterId;
			format: 'SugarCube';
			kind: 'builtin-sha256';
			sourceSha256: string;
			version: BundledSugarCubeVersion;
	  }
	| {
			adapterId: ExactHarloweAdapterId;
			format: 'Harlowe';
			kind: 'builtin-sha256';
			sourceSha256: string;
			version: typeof HARLOWE_3_3_9_COMPATIBILITY.version;
	  }
	| {kind: 'none'};

export const NO_PREVIEW_FORMAT_ADMISSION = Object.freeze({
	kind: 'none'
}) satisfies PreviewFormatAdmission;

export interface PreviewStoryFormatSnapshot {
	buildProperties: StoryFormatProperties;
	canonicalBuiltinCount: number;
	matchingInstalledBuiltinCount: number;
	properties: Readonly<
		Pick<StoryFormatProperties, 'name' | 'source' | 'version'>
	>;
	selected: Readonly<
		Pick<StoryFormat, 'id' | 'name' | 'url' | 'userAdded' | 'version'>
	>;
}

function exactOwnFields(value: object, expected: readonly string[]) {
	const keys = Object.keys(value);

	return (
		keys.length === expected.length &&
		keys.every(key => expected.includes(key)) &&
		expected.every(key => {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);

			return descriptor !== undefined && 'value' in descriptor;
		})
	);
}

function ownData(value: object, key: string) {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);

	return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function previewFormatCompatibilityForAdapter(adapterId: unknown) {
	if (adapterId === HARLOWE_3_3_9_COMPATIBILITY.adapterId) {
		return HARLOWE_3_3_9_COMPATIBILITY;
	}

	return sugarCubeCompatibilityForAdapter(adapterId);
}

function previewFormatCompatibilityForTuple(format: unknown, version: unknown) {
	if (format === 'Harlowe' && version === HARLOWE_3_3_9_COMPATIBILITY.version) {
		return HARLOWE_3_3_9_COMPATIBILITY;
	}
	if (format === 'SugarCube') {
		return sugarCubeCompatibilityForVersion(version);
	}

	return undefined;
}

/**
 * Canonicalizes admission after a browser/Electron serialization boundary.
 * A missing value defaults safely to no admission; a malformed supplied value
 * is rejected so callers can distinguish corruption from absence.
 */
export function canonicalPreviewFormatAdmission(
	value: unknown
): PreviewFormatAdmission | undefined {
	if (value === undefined) {
		return NO_PREVIEW_FORMAT_ADMISSION;
	}
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}

	try {
		const kind = ownData(value, 'kind');

		if (kind === 'none') {
			return exactOwnFields(value, ['kind'])
				? NO_PREVIEW_FORMAT_ADMISSION
				: undefined;
		}
		if (
			kind !== 'builtin-sha256' ||
			!exactOwnFields(value, [
				'adapterId',
				'format',
				'kind',
				'sourceSha256',
				'version'
			])
		) {
			return undefined;
		}

		const adapterId = ownData(value, 'adapterId');
		const format = ownData(value, 'format');
		const sourceSha256 = ownData(value, 'sourceSha256');
		const version = ownData(value, 'version');
		const entry = previewFormatCompatibilityForAdapter(adapterId);
		const expectedFormat =
			entry === HARLOWE_3_3_9_COMPATIBILITY ? 'Harlowe' : 'SugarCube';

		if (
			!entry ||
			format !== expectedFormat ||
			version !== entry.version ||
			typeof sourceSha256 !== 'string' ||
			!/^[0-9a-f]{64}$/.test(sourceSha256) ||
			sourceSha256 !== entry.sourceSha256
		) {
			return undefined;
		}

		return {
			adapterId: entry.adapterId,
			format: expectedFormat,
			kind: 'builtin-sha256',
			sourceSha256: entry.sourceSha256,
			version: entry.version
		} as PreviewFormatAdmission;
	} catch {
		return undefined;
	}
}

export function snapshotPreviewStoryFormat(
	formats: StoryFormat[],
	selectedFormat: StoryFormat,
	loadedProperties: StoryFormatProperties
): PreviewStoryFormatSnapshot {
	const selected = Object.freeze({
		id: selectedFormat.id,
		name: selectedFormat.name,
		url: selectedFormat.url,
		userAdded: selectedFormat.userAdded,
		version: selectedFormat.version
	});
	const properties = Object.freeze({
		name: loadedProperties.name,
		source: loadedProperties.source,
		version: loadedProperties.version
	});
	const canonicalBuiltinCount = builtins().filter(
		builtin =>
			builtin.name === selected.name &&
			builtin.version === selected.version &&
			builtin.url === selected.url
	).length;
	const matchingInstalledBuiltinCount = formats.filter(
		format =>
			!format.userAdded &&
			format.name === selected.name &&
			format.version === selected.version &&
			format.url === selected.url
	).length;

	return {
		buildProperties: {
			...loadedProperties,
			name: properties.name,
			source: properties.source,
			version: properties.version
		},
		canonicalBuiltinCount,
		matchingInstalledBuiltinCount,
		properties,
		selected
	};
}

function previewHtmlTagEnd(html: string, start: number) {
	let quote = '';

	for (let index = start; index < html.length; index += 1) {
		const character = html[index];

		if (quote) {
			if (character === quote) {
				quote = '';
			}
		} else if (character === '"' || character === "'") {
			quote = character;
		} else if (character === '>') {
			return index;
		}
	}

	return -1;
}

function previewRawClosingTag(
	html: string,
	lowerHtml: string,
	tag: string,
	from: number
) {
	const needle = `</${tag}`;
	let start = lowerHtml.indexOf(needle, from);

	while (start !== -1) {
		const delimiter = lowerHtml[start + needle.length];

		if (delimiter === '>' || /\s/.test(delimiter ?? '')) {
			const end = previewHtmlTagEnd(html, start + needle.length);

			return end === -1 ? undefined : {end, start};
		}
		start = lowerHtml.indexOf(needle, start + needle.length);
	}

	return undefined;
}

function previewStartTagAttribute(opening: string, wantedName: string) {
	const tag = /^<([a-z][a-z0-9:-]*)/i.exec(opening);

	if (!tag) {
		return undefined;
	}
	let cursor = tag[0].length;
	const values: Array<string | undefined> = [];

	while (cursor < opening.length) {
		while (/\s/.test(opening[cursor] ?? '')) {
			cursor += 1;
		}
		if (opening[cursor] === '>' || opening[cursor] === '/') {
			break;
		}
		const nameStart = cursor;

		while (cursor < opening.length && !/[\s"'<>/=]/.test(opening[cursor])) {
			cursor += 1;
		}
		if (cursor === nameStart) {
			return undefined;
		}
		const name = opening.slice(nameStart, cursor).toLowerCase();

		while (/\s/.test(opening[cursor] ?? '')) {
			cursor += 1;
		}
		let value: string | undefined;

		if (opening[cursor] === '=') {
			cursor += 1;
			while (/\s/.test(opening[cursor] ?? '')) {
				cursor += 1;
			}
			const quote = opening[cursor];

			if (quote === '"' || quote === "'") {
				const valueStart = ++cursor;

				while (cursor < opening.length && opening[cursor] !== quote) {
					cursor += 1;
				}
				if (opening[cursor] !== quote) {
					return undefined;
				}
				value = opening.slice(valueStart, cursor);
				cursor += 1;
			} else {
				const valueStart = cursor;

				while (cursor < opening.length && !/[\s"'`=<>]/.test(opening[cursor])) {
					cursor += 1;
				}
				if (cursor === valueStart) {
					return undefined;
				}
				value = opening.slice(valueStart, cursor);
			}
		}

		if (name === wantedName) {
			values.push(value);
		}
	}

	return values.length === 1 ? values[0] : undefined;
}

function serializedPreviewFormatTuple(html: string) {
	const lowerHtml = html.toLowerCase();
	const rawTextTags = [
		'iframe',
		'noembed',
		'noframes',
		'noscript',
		'script',
		'style',
		'textarea',
		'title',
		'xmp'
	];
	const suppressedContainerTags = ['math', 'select', 'svg', 'template'];
	const suppressedContainers: string[] = [];
	let cursor = 0;
	let storyDataCount = 0;
	let tuple: {format: string; version: string} | undefined;

	while (cursor < html.length) {
		const start = html.indexOf('<', cursor);

		if (start === -1) {
			break;
		}
		if (lowerHtml.startsWith('<!--', start)) {
			const commentEnd = lowerHtml.indexOf('-->', start + 4);

			if (commentEnd === -1) {
				return undefined;
			}
			cursor = commentEnd + 3;
			continue;
		}
		if (lowerHtml.startsWith('<!doctype', start)) {
			const doctypeEnd = previewHtmlTagEnd(html, start + 9);

			if (
				doctypeEnd === -1 ||
				!/^<!doctype\s+html\s*>$/i.test(html.slice(start, doctypeEnd + 1))
			) {
				return undefined;
			}
			cursor = doctypeEnd + 1;
			continue;
		}
		const tagMatch = /^<(\/)?([a-z][a-z0-9:-]*)(?=\s|\/?>)/i.exec(
			html.slice(start)
		);

		if (!tagMatch) {
			return undefined;
		}
		const isClosingTag = tagMatch[1] === '/';
		const tag = tagMatch[2].toLowerCase();
		const openEnd = previewHtmlTagEnd(html, start + tagMatch[0].length);

		if (openEnd === -1) {
			return undefined;
		}
		if (isClosingTag) {
			if (suppressedContainers.at(-1) === tag) {
				suppressedContainers.pop();
			} else if (suppressedContainers.includes(tag)) {
				return undefined;
			}
			cursor = openEnd + 1;
			continue;
		}
		if (tag === 'plaintext') {
			break;
		}
		if (rawTextTags.includes(tag)) {
			const closing = previewRawClosingTag(html, lowerHtml, tag, openEnd + 1);

			if (!closing) {
				return undefined;
			}
			cursor = closing.end + 1;
			continue;
		}
		if (tag === 'frameset') {
			return undefined;
		}
		if (
			(tag === 'math' || tag === 'svg') &&
			!suppressedContainers.includes('template')
		) {
			// The lightweight Electron scanner cannot reproduce HTML's foreign-
			// content breakout and integration-point rules. Those rules can move
			// serialized descendants (including role scripts and story data) into
			// effective HTML positions, so active foreign markup is outside exact
			// admission. Foreign-looking text and inert template content remain safe.
			return undefined;
		}
		if (suppressedContainerTags.includes(tag)) {
			if (tag === 'select' && suppressedContainers.includes('select')) {
				return undefined;
			}
			const selfClosing = /\/\s*>$/.test(html.slice(start, openEnd + 1));

			if (!(selfClosing && (tag === 'math' || tag === 'svg'))) {
				suppressedContainers.push(tag);
			}
		} else if (tag === 'tw-storydata' && suppressedContainers.length === 0) {
			storyDataCount += 1;
			if (storyDataCount !== 1) {
				return undefined;
			}
			const opening = html.slice(start, openEnd + 1);
			const format = previewStartTagAttribute(opening, 'format');
			const version = previewStartTagAttribute(opening, 'format-version');

			if (format === undefined || version === undefined) {
				return undefined;
			}
			tuple = {format, version};
		}
		cursor = openEnd + 1;
	}

	return storyDataCount === 1 ? tuple : undefined;
}

export function structuralPreviewFormatTuple(
	html: string
): {format: string; version: string} | undefined {
	const serializedTuple = serializedPreviewFormatTuple(html);

	if (!serializedTuple) {
		return undefined;
	}
	try {
		const Parser = globalThis.DOMParser;

		if (typeof Parser !== 'function') {
			return serializedTuple;
		}
		const document = new Parser().parseFromString(html, 'text/html');
		const storyData = Array.from(
			document.querySelectorAll('tw-storydata')
		).filter(
			element =>
				element.namespaceURI === 'http://www.w3.org/1999/xhtml' &&
				!element.closest('math, noscript, select, svg, template')
		);

		if (storyData.length !== 1) {
			return undefined;
		}
		const element = storyData[0];
		const format = element.getAttribute('format');
		const version = element.getAttribute('format-version');

		return format === serializedTuple.format &&
			version === serializedTuple.version
			? serializedTuple
			: undefined;
	} catch {
		return undefined;
	}
}

export function previewFormatAdmissionForHtml(
	admission: PreviewFormatAdmission,
	html: string
): PreviewFormatAdmission {
	if (admission.kind !== 'builtin-sha256') {
		return NO_PREVIEW_FORMAT_ADMISSION;
	}
	const tuple = structuralPreviewFormatTuple(html);

	return tuple?.format === admission.format &&
		tuple.version === admission.version
		? admission
		: NO_PREVIEW_FORMAT_ADMISSION;
}

async function sha256Utf8(value: string) {
	const subtle = globalThis.crypto?.subtle;

	if (!subtle) {
		throw new Error('SHA-256 is unavailable.');
	}
	const digest = await subtle.digest(
		'SHA-256',
		new TextEncoder().encode(value)
	);

	return Array.from(new Uint8Array(digest), byte =>
		byte.toString(16).padStart(2, '0')
	).join('');
}

export async function previewFormatAdmissionForBuild(
	snapshot: PreviewStoryFormatSnapshot,
	html: string
): Promise<PreviewFormatAdmission> {
	const {selected, properties} = snapshot;
	const entry = previewFormatCompatibilityForTuple(
		selected.name,
		selected.version
	);

	if (
		!entry ||
		selected.userAdded ||
		selected.url !== entry.url ||
		snapshot.canonicalBuiltinCount !== 1 ||
		snapshot.matchingInstalledBuiltinCount !== 1 ||
		properties.name !== selected.name ||
		properties.version !== entry.version
	) {
		return NO_PREVIEW_FORMAT_ADMISSION;
	}

	try {
		const [sourceSha256, tuple] = await Promise.all([
			sha256Utf8(properties.source),
			Promise.resolve(structuralPreviewFormatTuple(html))
		]);

		if (
			sourceSha256 !== entry.sourceSha256 ||
			tuple?.format !== selected.name ||
			tuple.version !== entry.version
		) {
			return NO_PREVIEW_FORMAT_ADMISSION;
		}

		return {
			adapterId: entry.adapterId,
			format: selected.name,
			kind: 'builtin-sha256',
			sourceSha256,
			version: entry.version
		} as PreviewFormatAdmission;
	} catch {
		return NO_PREVIEW_FORMAT_ADMISSION;
	}
}
