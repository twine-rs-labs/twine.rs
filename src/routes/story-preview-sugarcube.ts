import {builtins} from '../store/story-formats/defaults';
import type {
	StoryFormat,
	StoryFormatProperties
} from '../store/story-formats/story-formats.types';

export const SUGARCUBE_COMPATIBILITY = [
	{
		adapterId: 'sugarcube-2.31.0',
		readProfileId: 'sugarcube-read-2.31',
		restartProfileId: 'sugarcube-restart-2.31',
		sourceSha256:
			'83d87082885b6e9f5eaf54bc33cbeae946603c9a92815260e52a559123a836d2',
		url: 'story-formats/sugarcube-2.31.0/format.js',
		version: '2.31.0'
	},
	{
		adapterId: 'sugarcube-2.31.1',
		readProfileId: 'sugarcube-read-2.31',
		restartProfileId: 'sugarcube-restart-2.31',
		sourceSha256:
			'5da92f2b2f68ad8ec78096cda24fde53fd9bfddfe6230b7fe523ab01543282bc',
		url: 'story-formats/sugarcube-2.31.1/format.js',
		version: '2.31.1'
	},
	{
		adapterId: 'sugarcube-2.32.0',
		readProfileId: 'sugarcube-read-2.32-2.35',
		restartProfileId: 'sugarcube-restart-2.32-2.33.0',
		sourceSha256:
			'1b212aae076475039ba2f17d28a18ad06cf209c5daeda7d03c88d67cb7db688a',
		url: 'story-formats/sugarcube-2.32.0/format.js',
		version: '2.32.0'
	},
	{
		adapterId: 'sugarcube-2.33.0',
		readProfileId: 'sugarcube-read-2.32-2.35',
		restartProfileId: 'sugarcube-restart-2.32-2.33.0',
		sourceSha256:
			'b45ca255655c290f303e55c1e7af6bd048db3c8d55f70831f9ea1872e1634229',
		url: 'story-formats/sugarcube-2.33.0/format.js',
		version: '2.33.0'
	},
	{
		adapterId: 'sugarcube-2.33.1',
		readProfileId: 'sugarcube-read-2.32-2.35',
		restartProfileId: 'sugarcube-restart-2.33.1-2.34.1',
		sourceSha256:
			'4b6f141f644c4d25519f6f0dc5e18c10a316c2bfc41fdd118eabcfb266794de0',
		url: 'story-formats/sugarcube-2.33.1/format.js',
		version: '2.33.1'
	},
	{
		adapterId: 'sugarcube-2.33.2',
		readProfileId: 'sugarcube-read-2.32-2.35',
		restartProfileId: 'sugarcube-restart-2.33.1-2.34.1',
		sourceSha256:
			'f692bc35c1da5390166264f4900ddee3cc90b42d1c3291e9b8222a9d3379b395',
		url: 'story-formats/sugarcube-2.33.2/format.js',
		version: '2.33.2'
	},
	{
		adapterId: 'sugarcube-2.33.3',
		readProfileId: 'sugarcube-read-2.32-2.35',
		restartProfileId: 'sugarcube-restart-2.33.1-2.34.1',
		sourceSha256:
			'1ed27c2de282372f162841e5b98005c85561204d2672469dee3aca6a2f74c47f',
		url: 'story-formats/sugarcube-2.33.3/format.js',
		version: '2.33.3'
	},
	{
		adapterId: 'sugarcube-2.33.4',
		readProfileId: 'sugarcube-read-2.32-2.35',
		restartProfileId: 'sugarcube-restart-2.33.1-2.34.1',
		sourceSha256:
			'0aa47b20e8a7d233c809896df16e6f1d38db63d2608819d6de925ca529d45caa',
		url: 'story-formats/sugarcube-2.33.4/format.js',
		version: '2.33.4'
	},
	{
		adapterId: 'sugarcube-2.34.0',
		readProfileId: 'sugarcube-read-2.32-2.35',
		restartProfileId: 'sugarcube-restart-2.33.1-2.34.1',
		sourceSha256:
			'c3b794a27095bc310daf80a123a89303f25680b042a4eccb56bc07874a90318a',
		url: 'story-formats/sugarcube-2.34.0/format.js',
		version: '2.34.0'
	},
	{
		adapterId: 'sugarcube-2.34.1',
		readProfileId: 'sugarcube-read-2.32-2.35',
		restartProfileId: 'sugarcube-restart-2.33.1-2.34.1',
		sourceSha256:
			'5ce9f9528a6be5c5c37d493609d700ee91a10827f7e506696999d141b6e17e01',
		url: 'story-formats/sugarcube-2.34.1/format.js',
		version: '2.34.1'
	},
	{
		adapterId: 'sugarcube-2.35.0',
		readProfileId: 'sugarcube-read-2.32-2.35',
		restartProfileId: 'sugarcube-restart-2.35',
		sourceSha256:
			'3f6344162d94bd896f411845a5f238dce4f112b71b065d2fe326ff273a460c3c',
		url: 'story-formats/sugarcube-2.35.0/format.js',
		version: '2.35.0'
	},
	{
		adapterId: 'sugarcube-2.36.0',
		readProfileId: 'sugarcube-read-2.36',
		restartProfileId: 'sugarcube-restart-2.36',
		sourceSha256:
			'84b480220e1c0873b3263be4b876c01466eb0fb89ac1b7939dc583f422a03aef',
		url: 'story-formats/sugarcube-2.36.0/format.js',
		version: '2.36.0'
	},
	{
		adapterId: 'sugarcube-2.36.1',
		readProfileId: 'sugarcube-read-2.36',
		restartProfileId: 'sugarcube-restart-2.36',
		sourceSha256:
			'0dc22abfd93af05636b2dbab5a3a5892687c849d38b0c3f174484e407126685d',
		url: 'story-formats/sugarcube-2.36.1/format.js',
		version: '2.36.1'
	},
	{
		adapterId: 'sugarcube-2.37.0',
		readProfileId: 'sugarcube-read-2.37',
		restartProfileId: 'sugarcube-restart-2.37',
		sourceSha256:
			'bbb5660be99b3e1f05f30574c716cbb78637172f8d9fafbf1b52cfb3dd939a34',
		url: 'story-formats/sugarcube-2.37.0/format.js',
		version: '2.37.0'
	},
	{
		adapterId: 'sugarcube-2.37.3',
		readProfileId: 'sugarcube-read-2.37',
		restartProfileId: 'sugarcube-restart-2.37',
		sourceSha256:
			'9a2954dd88a55a6738411fe7a93409ff2150662e5296e76808ce5c0d9310b533',
		url: 'story-formats/sugarcube-2.37.3/format.js',
		version: '2.37.3'
	}
] as const;

export type SugarCubeCompatibilityEntry =
	(typeof SUGARCUBE_COMPATIBILITY)[number];
export type BundledSugarCubeVersion = SugarCubeCompatibilityEntry['version'];
export type ExactSugarCubeAdapterId = SugarCubeCompatibilityEntry['adapterId'];
export type SugarCubeReadProfileId =
	SugarCubeCompatibilityEntry['readProfileId'];
export type SugarCubeRestartProfileId = NonNullable<
	SugarCubeCompatibilityEntry['restartProfileId']
>;

export interface SugarCubeReadProfile {
	history: string;
	passage: string;
	temporary: string;
	variables: string;
}

export interface SugarCubeRestartProfile {
	engineRestartSource: string;
	resetSource: string;
	startupFragment: string;
	startupReplacement: string;
}

export const SUGARCUBE_READ_PROFILES = {
	'sugarcube-read-2.31': {
		history: 'function m(){return H}',
		passage: 'function p(){return J.title}',
		temporary: 'function Q(){return K}',
		variables: 'function h(){return J.variables}'
	},
	'sugarcube-read-2.32-2.35': {
		history: 'function m(){return $}',
		passage: 'function p(){return H.title}',
		temporary: 'function Q(){return Y}',
		variables: 'function h(){return H.variables}'
	},
	'sugarcube-read-2.36': {
		history: 'function(){return _history}',
		passage: 'function(){return _active.title}',
		temporary: 'function(){return _tempVariables}',
		variables: 'function(){return _active.variables}'
	},
	'sugarcube-read-2.37': {
		history: 'function(){return _history}',
		passage: 'function(){return _active.title}',
		temporary: 'function(){return _temporary}',
		variables: 'function(){return _active.variables}'
	}
} as const satisfies Record<SugarCubeReadProfileId, SugarCubeReadProfile>;

const pre237Startup =
	'Save.init(),Setting.init(),Macro.init(),Engine.start(),Config.debug&&DebugBar.init()';
const pre237Replacement =
	'Save.init(),Setting.init(),Macro.init(),window.__twineRsPreviewSugarCubeStart(Engine,Config),Config.debug&&DebugBar.init()';
const v237Startup =
	'Engine.runUserInit(),UIBar.start(),Engine.start(),DebugBar.start()';
const v237Replacement =
	'Engine.runUserInit(),UIBar.start(),window.__twineRsPreviewSugarCubeStart(Engine,Config),DebugBar.start()';
const pre236Restart =
	'function r(){LoadScreen.show(),window.scroll(0,0),State.reset(),jQuery.event.trigger(":enginerestart"),window.location.reload()}';
const v236Restart =
	'function(){LoadScreen.show(),window.scroll(0,0),State.reset(),jQuery.event.trigger(":enginerestart"),window.location.reload()}';
const v237Restart =
	'function(){LoadScreen.show(),window.scroll(0,0),State.reset(),triggerEvent(":enginerestart"),window.location.reload()}';

export const SUGARCUBE_RESTART_PROFILES = {
	'sugarcube-restart-2.31': {
		engineRestartSource: pre236Restart,
		resetSource:
			'function e(){session.delete("state"),H=[],J=c(),G=-1,Z=[],Y=null===Y?null:new PRNGWrapper(Y.seed,!1)}',
		startupFragment: pre237Startup,
		startupReplacement: pre237Replacement
	},
	'sugarcube-restart-2.32-2.33.0': {
		engineRestartSource: pre236Restart,
		resetSource:
			'function e(){session.delete("state"),$=[],H=c(),J=-1,G=[],\nZ=null===Z?null:new PRNGWrapper(Z.seed,!1)}',
		startupFragment: pre237Startup,
		startupReplacement: pre237Replacement
	},
	'sugarcube-restart-2.33.1-2.34.1': {
		engineRestartSource: pre236Restart,
		resetSource:
			'function e(){session.delete("state"),$=[],H=c(),J=-1,G=[],Z=null===Z?null:new PRNGWrapper(Z.seed,!1)}',
		startupFragment: pre237Startup,
		startupReplacement: pre237Replacement
	},
	'sugarcube-restart-2.35': {
		engineRestartSource: pre236Restart,
		resetSource:
			'function e(){session.delete("state"),$=[],H=c(),J=-1,Z=[],G=null===G?null:new PRNGWrapper(G.seed,!1)}',
		startupFragment: pre237Startup,
		startupReplacement: pre237Replacement
	},
	'sugarcube-restart-2.36': {
		engineRestartSource: v236Restart,
		resetSource:
			'function(){session.delete("state"),_history=[],_active=momentCreate(),_activeIndex=-1,_expired=[],_prng=null===_prng?null:new PRNGWrapper(_prng.seed,!1)}',
		startupFragment: pre237Startup,
		startupReplacement: pre237Replacement
	},
	'sugarcube-restart-2.37': {
		engineRestartSource: v237Restart,
		resetSource:
			'function(){session.delete("state"),_history=[],_active=momentCreate(),_activeIndex=-1,_expired=[],_prng=null===_prng?null:prngCreate(_prng.seed),tempVariablesClear()}',
		startupFragment: v237Startup,
		startupReplacement: v237Replacement
	}
} as const satisfies Record<SugarCubeRestartProfileId, SugarCubeRestartProfile>;

export function sugarCubeReadProfileForAdapter(adapterId: unknown) {
	const compatibility = sugarCubeCompatibilityForAdapter(adapterId);

	return compatibility
		? SUGARCUBE_READ_PROFILES[compatibility.readProfileId]
		: undefined;
}

export function sugarCubeRestartProfileForAdapter(adapterId: unknown) {
	const compatibility = sugarCubeCompatibilityForAdapter(adapterId);

	return compatibility?.restartProfileId
		? SUGARCUBE_RESTART_PROFILES[compatibility.restartProfileId]
		: undefined;
}

export type PreviewFormatAdmission =
	| {
			adapterId: ExactSugarCubeAdapterId;
			format: 'SugarCube';
			kind: 'builtin-sha256';
			sourceSha256: string;
			version: BundledSugarCubeVersion;
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

export function sugarCubeCompatibilityForAdapter(
	adapterId: unknown
): SugarCubeCompatibilityEntry | undefined {
	return SUGARCUBE_COMPATIBILITY.find(entry => entry.adapterId === adapterId);
}

export function sugarCubeCompatibilityForVersion(
	version: unknown
): SugarCubeCompatibilityEntry | undefined {
	return SUGARCUBE_COMPATIBILITY.find(entry => entry.version === version);
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
		const entry = sugarCubeCompatibilityForAdapter(adapterId);

		if (
			!entry ||
			format !== 'SugarCube' ||
			version !== entry.version ||
			typeof sourceSha256 !== 'string' ||
			!/^[0-9a-f]{64}$/.test(sourceSha256) ||
			sourceSha256 !== entry.sourceSha256
		) {
			return undefined;
		}

		return {
			adapterId: entry.adapterId,
			format: 'SugarCube',
			kind: 'builtin-sha256',
			sourceSha256: entry.sourceSha256,
			version: entry.version
		};
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
	const entry = sugarCubeCompatibilityForVersion(selected.version);

	if (
		!entry ||
		selected.userAdded ||
		selected.name !== 'SugarCube' ||
		selected.url !== entry.url ||
		snapshot.canonicalBuiltinCount !== 1 ||
		snapshot.matchingInstalledBuiltinCount !== 1 ||
		properties.name !== 'SugarCube' ||
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
			tuple?.format !== 'SugarCube' ||
			tuple.version !== entry.version
		) {
			return NO_PREVIEW_FORMAT_ADMISSION;
		}

		return {
			adapterId: entry.adapterId,
			format: 'SugarCube',
			kind: 'builtin-sha256',
			sourceSha256,
			version: entry.version
		};
	} catch {
		return NO_PREVIEW_FORMAT_ADMISSION;
	}
}
