import type {CoreAssetReference} from './bindings/CoreAssetReference';
import type {CoreAssetSnippet} from './bindings/CoreAssetSnippet';
import {DecodingMode, EntityDecoder, htmlDecodeTree} from 'entities/decode';

const literalAssetReferenceRegex =
	/[^\s"'<>(),;=:#?]+\.(png|jpe?g|gif|svg|webp|mp3|m4a|ogg|wav|mp4|webm|css|js)(?:\?[^\s"'<>(),;#]*)?(?:#[^\s"'<>(),;]*)?/gi;
const protocolRegex = /^[A-Za-z][A-Za-z0-9+.-]*:/;

export function compareAssetPaths(left: string, right: string) {
	let leftIndex = 0;
	let rightIndex = 0;

	while (leftIndex < left.length && rightIndex < right.length) {
		const leftPoint = left.codePointAt(leftIndex)!;
		const rightPoint = right.codePointAt(rightIndex)!;

		if (leftPoint !== rightPoint) {
			return leftPoint < rightPoint ? -1 : 1;
		}
		leftIndex += leftPoint > 0xffff ? 2 : 1;
		rightIndex += rightPoint > 0xffff ? 2 : 1;
	}

	return leftIndex < left.length ? 1 : rightIndex < right.length ? -1 : 0;
}

function percentEncodeFilePath(path: string) {
	return Array.from(path)
		.map(character =>
			/[A-Za-z0-9\-._~/:]/.test(character)
				? character
				: encodeURIComponent(character)
		)
		.join('');
}

export function fileUrlForPath(path: string) {
	const normalized = path.replace(/\\/g, '/');
	const isWindowsAbsolutePath = /^[A-Za-z]:\//.test(normalized);

	if (protocolRegex.test(normalized) && !isWindowsAbsolutePath) {
		return normalized.toLowerCase().startsWith('file:') ? normalized : null;
	}

	const absolutePath =
		normalized.startsWith('/') || isWindowsAbsolutePath
			? `/${normalized.replace(/^\/+/, '')}`
			: `/${normalized}`;

	return `file://${percentEncodeFilePath(absolutePath)}`;
}

export function assetKindForPath(path: string) {
	const extension = path.split('.').pop()?.toLowerCase() ?? '';

	if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(extension)) {
		return 'image';
	}

	if (['mp3', 'm4a', 'ogg', 'wav'].includes(extension)) {
		return 'audio';
	}

	if (['mp4', 'webm'].includes(extension)) {
		return 'video';
	}

	if (extension === 'css') {
		return 'stylesheet';
	}

	if (extension === 'js') {
		return 'script';
	}

	return 'file';
}

export function assetSnippet(
	path: string,
	kind = assetKindForPath(path)
): CoreAssetSnippet {
	const referencePath = encodedAssetReferencePath(path);
	const text =
		kind === 'image'
			? `<img src="${referencePath}" alt="">`
			: kind === 'audio'
				? `<audio src="${referencePath}" controls></audio>`
				: kind === 'video'
					? `<video src="${referencePath}" controls></video>`
					: kind === 'stylesheet'
						? `<link rel="stylesheet" href="${referencePath}">`
						: kind === 'script'
							? `<script src="${referencePath}"></script>`
							: referencePath;

	return {
		label: 'Insert asset reference',
		mediaType: kind,
		text
	};
}

function urlTrimmedSourceRange(source: string, start = 0, end = source.length) {
	while (
		start < end &&
		source.charCodeAt(start) > 0 &&
		source.charCodeAt(start) <= 0x20
	)
		start++;
	while (
		end > start &&
		source.charCodeAt(end - 1) > 0 &&
		source.charCodeAt(end - 1) <= 0x20
	)
		end--;
	return {end, start};
}

export function urlPreprocessedValue(value: string) {
	const range = urlTrimmedSourceRange(value);

	return value.slice(range.start, range.end).replace(/[\t\n\r]/g, '');
}

function parsedLocalAssetReference(path: string) {
	const preprocessed = urlPreprocessedValue(path);
	const suffixStart = preprocessed.search(/[?#]/);
	const sourcePath =
		suffixStart === -1 ? preprocessed : preprocessed.slice(0, suffixStart);
	let normalized = sourcePath.replace(/\\/g, '/');

	if (protocolRegex.test(normalized) || normalized.startsWith('//'))
		return null;
	const absolute = normalized.startsWith('/');

	if (absolute) normalized = normalized.slice(1);
	const rawSegments = normalized.split('/');

	if (rawSegments.some(segment => segment.length === 0)) return null;
	const segments: string[] = [];

	for (const rawSegment of rawSegments) {
		let segment: string;

		try {
			segment = decodeURIComponent(rawSegment);
		} catch {
			return null;
		}
		if (/[\\/\0]/.test(segment)) return null;
		segments.push(segment);
	}
	while (segments[0] === '.') segments.shift();
	const explicitlyManaged = segments[0]?.toLowerCase() === 'assets';

	if (absolute && !explicitlyManaged) return null;
	const assetSegments = explicitlyManaged ? segments.slice(1) : segments;

	if (
		assetSegments.length === 0 ||
		assetSegments.some(segment => segment === '.' || segment === '..')
	) {
		return null;
	}
	return {
		explicitlyManaged,
		path: `assets/${assetSegments.join('/')}`
	};
}

export function localAssetReferencePath(path: string) {
	return parsedLocalAssetReference(path)?.path ?? null;
}

/** Normalizes an already-logical project asset path without URL parsing it. */
export function canonicalLogicalAssetPath(path: string) {
	const normalized = path.replace(/\\/g, '/').replace(/^(\.\/)+/, '');

	if (normalized.startsWith('/') || normalized.includes('\0')) return null;
	const segments = normalized.split('/');

	if (
		segments[0]?.toLowerCase() !== 'assets' ||
		segments.length < 2 ||
		segments.some(segment => !segment || segment === '.' || segment === '..')
	)
		return null;
	return `assets/${segments.slice(1).join('/')}`;
}

/** Encodes a canonical logical asset path for use as an authored URL. */
export function encodedAssetReferencePath(path: string) {
	const logicalPath = canonicalLogicalAssetPath(path);

	if (!logicalPath) return path;
	return logicalPath
		.split('/')
		.map(component =>
			encodeURIComponent(component).replace(
				/[!'()*]/g,
				character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
			)
		)
		.join('/');
}

function explicitlyManagedAssetReference(path: string) {
	return parsedLocalAssetReference(path)?.explicitlyManaged ?? false;
}

function contextSupportsArbitraryAsset(context: string, original: string) {
	return (
		[
			'css-import',
			'css-url',
			'html-background',
			'html-poster',
			'html-src',
			'html-srcset',
			'html-href',
			'html-data',
			'html-refresh'
		].includes(context) || explicitlyManagedAssetReference(original)
	);
}

export function normalizedAssetPath(path: string) {
	const logical = path.replace(/\\/g, '/').replace(/^(\.\/)+/, '');

	return (
		canonicalLogicalAssetPath(logical) ??
		localAssetReferencePath(path) ??
		logical
	);
}

export function projectAssetPath(path: string) {
	return (
		canonicalLogicalAssetPath(path) ??
		localAssetReferencePath(path) ??
		'assets/asset'
	);
}

const boundedAssetSourceMaxBytes = 1024 * 1024;
const boundedAssetSourceMaxCandidates = 256;
const boundedAssetSourceMaxPaths = 25;
const boundedAssetPathMaxBytes = 4096;
const boundedAssetCssMaxNestingDepth = 256;

function sourceRangeFitsUtf8ByteLimit(
	source: string,
	start: number,
	end: number,
	limit: number
) {
	let bytes = 0;

	for (let index = start; index < end; index++) {
		const point = source.codePointAt(index)!;

		bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
		if (bytes > limit) {
			return false;
		}
		if (point > 0xffff) {
			index++;
		}
	}
	return true;
}

function sourceFitsUtf8ByteLimit(source: string, limit: number) {
	return sourceRangeFitsUtf8ByteLimit(source, 0, source.length, limit);
}

function htmlSpace(character: string | undefined) {
	return character !== undefined && /[\t\n\f\r ]/u.test(character);
}

function htmlAsciiLower(value: string) {
	return value.replace(/[A-Z]/gu, character =>
		String.fromCharCode(character.charCodeAt(0) + 0x20)
	);
}

/** Locates the destination consumed by HTML's declarative-refresh algorithm. */
export function declarativeRefreshUrlRange(input: string) {
	let cursor = 0;

	while (htmlSpace(input[cursor])) cursor++;
	const integerStart = cursor;
	while (/[0-9]/u.test(input[cursor] ?? '')) cursor++;
	if (cursor === integerStart && input[cursor] !== '.') return null;
	while (/[0-9.]/u.test(input[cursor] ?? '')) cursor++;
	if (cursor >= input.length) return null;
	if (
		input[cursor] !== ';' &&
		input[cursor] !== ',' &&
		!htmlSpace(input[cursor])
	)
		return null;
	while (htmlSpace(input[cursor])) cursor++;
	if (input[cursor] === ';' || input[cursor] === ',') cursor++;
	while (htmlSpace(input[cursor])) cursor++;
	if (cursor >= input.length) return null;

	const originalStart = cursor;
	if (input[cursor]?.toLowerCase() === 'u') {
		let urlCursor = cursor + 1;

		if (input[urlCursor]?.toLowerCase() !== 'r')
			return {end: input.length, start: originalStart};
		urlCursor++;
		if (input[urlCursor]?.toLowerCase() !== 'l')
			return {end: input.length, start: originalStart};
		urlCursor++;
		while (htmlSpace(input[urlCursor])) urlCursor++;
		if (input[urlCursor] !== '=')
			return {end: input.length, start: originalStart};
		cursor = urlCursor + 1;
		while (htmlSpace(input[cursor])) cursor++;
	}

	const quote =
		input[cursor] === '"' || input[cursor] === "'" ? input[cursor++] : '';
	const quotedEnd = quote ? input.indexOf(quote, cursor) : -1;

	return {end: quotedEnd === -1 ? input.length : quotedEnd, start: cursor};
}

type DecodedSourceValue = {
	end: number;
	entities: HtmlEntitySegment[];
	start: number;
	value: string;
};

type HtmlEntitySegment = {
	decodedEnd: number;
	decodedStart: number;
	rawEnd: number;
	rawStart: number;
};

type HtmlAssetAttribute = {
	attribute: string;
	value: DecodedSourceValue;
};

type ParsedHtmlAttribute = {
	name: string;
	value: DecodedSourceValue | null;
};

type HtmlNamespace = 'html' | 'math' | 'svg';

type HtmlOpenElement = {
	htmlIntegrationPoint: boolean;
	mathTextIntegrationPoint: boolean;
	namespace: HtmlNamespace;
	tag: string;
};

type HtmlLexicalScan = {
	attributes: HtmlAssetAttribute[];
	complete: boolean;
	ignoredFallbackSpans: AssetSourceRange[];
	styleAttributes: DecodedSourceValue[];
	styleContents: AssetSourceRange[];
};

const htmlResourceLinkRelations = new Set([
	'apple-touch-icon',
	'apple-touch-icon-precomposed',
	'compression-dictionary',
	'dns-prefetch',
	'icon',
	'manifest',
	'mask-icon',
	'modulepreload',
	'pingback',
	'preconnect',
	'prefetch',
	'preload',
	'stylesheet'
]);

const decodedHtmlAttributeNames = new Set([
	'as',
	'background',
	'clip-path',
	'content',
	'cursor',
	'data',
	'encoding',
	'fill',
	'filter',
	'href',
	'http-equiv',
	'imagesrcset',
	'marker',
	'marker-end',
	'marker-mid',
	'marker-start',
	'mask',
	'poster',
	'rel',
	'src',
	'srcset',
	'stroke',
	'style',
	'type',
	'xlink:href'
]);

const svgCssPresentationAttributes = new Set([
	'clip-path',
	'cursor',
	'fill',
	'filter',
	'marker',
	'marker-end',
	'marker-mid',
	'marker-start',
	'mask',
	'stroke'
]);

const htmlNonresourceLinkRelations = new Set([
	'alternate',
	'author',
	'bookmark',
	'canonical',
	'expect',
	'external',
	'help',
	'license',
	'next',
	'nofollow',
	'noopener',
	'noreferrer',
	'opener',
	'prev',
	'privacy-policy',
	'search',
	'shortcut',
	'sponsored',
	'tag',
	'terms-of-service',
	'ugc'
]);

export type HtmlLinkRelationClassification = {
	href: boolean;
	imagesrcset: boolean;
	stylesheet: boolean;
	unknown: boolean;
};

export type HtmlAssetAttributeKind = 'resource' | 'srcset';

const htmlBackgroundElements = new Set([
	'body',
	'table',
	'tbody',
	'td',
	'tfoot',
	'th',
	'thead',
	'tr'
]);

const htmlSrcElements = new Set([
	'audio',
	'embed',
	'frame',
	'iframe',
	'img',
	'script',
	'source',
	'track',
	'video'
]);

/** Classifies native URL-bearing attributes on HTML elements. */
export function classifyHtmlAssetAttribute(
	tagName: string,
	attributeName: string,
	inputType = ''
): HtmlAssetAttributeKind | null {
	const authoredTag = htmlAsciiLower(tagName);
	const tag = authoredTag === 'image' ? 'img' : authoredTag;
	const attribute = htmlAsciiLower(attributeName);

	if (attribute === 'background' && htmlBackgroundElements.has(tag)) {
		return 'resource';
	}
	if (attribute === 'data' && tag === 'object') return 'resource';
	if (attribute === 'poster' && tag === 'video') return 'resource';
	if (attribute === 'srcset' && (tag === 'img' || tag === 'source')) {
		return 'srcset';
	}
	if (attribute !== 'src') return null;
	if (htmlSrcElements.has(tag)) return 'resource';
	if (tag === 'input' && htmlAsciiLower(inputType) === 'image') {
		return 'resource';
	}
	return null;
}

export type SvgHrefDisposition = 'navigation' | 'resource' | 'structural';

const svgHrefResourceElements = new Set([
	'feimage',
	'image',
	'lineargradient',
	'mpath',
	'pattern',
	'radialgradient',
	'script',
	'textpath',
	'use'
]);

const svgHrefStructuralElements = new Set([
	'animate',
	'animatemotion',
	'animatetransform',
	'set'
]);

/** Classifies SVG elements whose `href`/`xlink:href` has URL semantics. */
export function classifySvgHrefElement(
	tagName: string
): SvgHrefDisposition | null {
	const tag = htmlAsciiLower(tagName);

	if (tag === 'a') return 'navigation';
	if (svgHrefResourceElements.has(tag)) return 'resource';
	return svgHrefStructuralElements.has(tag) ? 'structural' : null;
}

/** Classifies decoded `link` rel/as values for every static dependency scanner. */
export function classifyHtmlLinkRelations(
	rel: string,
	as: string
): HtmlLinkRelationClassification {
	let preload = false;
	let resource = false;
	let stylesheet = false;
	let unknown = false;

	for (const token of rel.split(/[\t\n\f\r ]+/u)) {
		if (!token) continue;
		const relation = htmlAsciiLower(token);

		if (htmlResourceLinkRelations.has(relation)) {
			resource = true;
			preload ||= relation === 'preload';
			stylesheet ||= relation === 'stylesheet';
		} else if (!htmlNonresourceLinkRelations.has(relation)) {
			unknown = true;
		}
	}

	return {
		href: resource,
		imagesrcset: preload && htmlAsciiLower(as) === 'image',
		stylesheet,
		unknown: unknown && !resource
	};
}

function decodeHtmlAttributeValue(raw: string, rawStart: number) {
	if (!raw.includes('&'))
		return {
			end: rawStart + raw.length,
			entities: [],
			start: rawStart,
			value: raw
		};
	let emitted: number[] = [];
	const decoder = new EntityDecoder(htmlDecodeTree, codepoint => {
		emitted.push(codepoint);
	});
	let value = '';
	const entitySegments: HtmlEntitySegment[] = [];
	let cursor = 0;

	while (cursor < raw.length) {
		const ampersand = raw.indexOf('&', cursor);

		if (ampersand === -1) {
			value += raw.slice(cursor);
			break;
		}
		if (ampersand > cursor) {
			value += raw.slice(cursor, ampersand);
			cursor = ampersand;
		}
		if (raw[cursor] === '&') {
			emitted = [];
			decoder.startEntity(DecodingMode.Attribute);
			let consumed = decoder.write(raw, cursor + 1);

			if (consumed === -1) consumed = decoder.end();
			if (consumed > 0 && emitted.length > 0) {
				const decodedStart = value.length;

				for (const codepoint of emitted) {
					value += String.fromCodePoint(codepoint);
				}
				entitySegments.push({
					decodedEnd: value.length,
					decodedStart,
					rawEnd: rawStart + cursor + consumed,
					rawStart: rawStart + cursor
				});
				cursor += consumed;
				continue;
			}
		}
		value += '&';
		cursor++;
	}

	return {
		end: rawStart + raw.length,
		entities: entitySegments,
		start: rawStart,
		value
	};
}

function decodedBoundaryToRaw(value: DecodedSourceValue, offset: number) {
	let low = 0;
	let high = value.entities.length;

	while (low < high) {
		const middle = low + Math.floor((high - low) / 2);

		if (value.entities[middle].decodedEnd < offset) low = middle + 1;
		else high = middle;
	}
	const entity = value.entities[low];
	const delta =
		low === 0
			? value.start
			: value.entities[low - 1].rawEnd - value.entities[low - 1].decodedEnd;

	if (!entity || offset < entity.decodedStart) return delta + offset;
	if (offset === entity.decodedStart) return entity.rawStart;
	if (offset < entity.decodedEnd) return null;
	return entity.rawEnd;
}

function firstEntityEndingAfter(entities: HtmlEntitySegment[], offset: number) {
	let low = 0;
	let high = entities.length;

	while (low < high) {
		const middle = low + Math.floor((high - low) / 2);

		if (entities[middle].decodedEnd <= offset) low = middle + 1;
		else high = middle;
	}
	return low;
}

function firstEntityStartingAtOrAfter(
	entities: HtmlEntitySegment[],
	offset: number
) {
	let low = 0;
	let high = entities.length;

	while (low < high) {
		const middle = low + Math.floor((high - low) / 2);

		if (entities[middle].decodedStart < offset) low = middle + 1;
		else high = middle;
	}
	return low;
}

function projectDecodedSourceValue(
	value: DecodedSourceValue,
	start: number,
	end: number
) {
	const rawStart = decodedBoundaryToRaw(value, start);
	const rawEnd = decodedBoundaryToRaw(value, end);

	if (rawStart === null || rawEnd === null) return null;
	const entityStart = firstEntityEndingAfter(value.entities, start);
	const entityEnd = firstEntityStartingAtOrAfter(value.entities, end);
	const entities = new Array<HtmlEntitySegment>(entityEnd - entityStart);

	for (let index = entityStart; index < entityEnd; index++) {
		const entity = value.entities[index];

		entities[index - entityStart] = {
			decodedEnd: entity.decodedEnd - start,
			decodedStart: entity.decodedStart - start,
			rawEnd: entity.rawEnd,
			rawStart: entity.rawStart
		};
	}
	return {
		end: rawEnd,
		entities,
		start: rawStart,
		value: value.value.slice(start, end)
	};
}

function htmlTagEnd(source: string, start: number) {
	let quote = '';

	for (let cursor = start; cursor < source.length; cursor++) {
		const character = source[cursor];

		if (quote) {
			if (character === quote) quote = '';
		} else if (character === '"' || character === "'") {
			quote = character;
		} else if (character === '>') {
			return cursor + 1;
		}
	}
	return null;
}

function htmlCommentEnd(source: string, start: number) {
	let cursor = start + 4;

	if (source[cursor] === '>') return cursor + 1;
	if (source.startsWith('->', cursor)) return cursor + 2;
	while (cursor < source.length) {
		if (source.startsWith('-->', cursor)) return cursor + 3;
		if (source.startsWith('--!>', cursor)) return cursor + 4;
		cursor++;
	}
	return source.length;
}

function appropriateRawEndTag(source: string, start: number, tag: string) {
	if (source[start] !== '<' || source[start + 1] !== '/') return false;
	if (htmlAsciiLower(source.slice(start + 2, start + 2 + tag.length)) !== tag)
		return false;
	const boundary = source[start + 2 + tag.length];

	return boundary === '>' || boundary === '/' || htmlSpace(boundary);
}

function rawTextEnd(source: string, start: number, tag: string) {
	let cursor = start;

	while ((cursor = source.indexOf('</', cursor)) !== -1) {
		if (appropriateRawEndTag(source, cursor, tag)) return cursor;
		cursor += 2;
	}
	return source.length;
}

function scriptTextEnd(source: string, start: number) {
	type State =
		| 'data'
		| 'double'
		| 'double-dash'
		| 'double-dash-dash'
		| 'escaped'
		| 'escaped-dash'
		| 'escaped-dash-dash';
	let state: State = 'data';
	let cursor = start;
	const asciiAlpha = (character: string | undefined) =>
		character !== undefined && /[A-Za-z]/u.test(character);
	const escapedLessThan = () => {
		if (appropriateRawEndTag(source, cursor, 'script')) return 'end' as const;
		if (!asciiAlpha(source[cursor + 1])) return 'escaped' as const;
		let end = cursor + 1;

		while (asciiAlpha(source[end])) end++;
		const word = htmlAsciiLower(source.slice(cursor + 1, end));
		const boundary = source[end];
		const delimiter =
			boundary === '/' || boundary === '>' || htmlSpace(boundary);

		cursor = delimiter ? end : end - 1;
		return word === 'script' && delimiter
			? ('double' as const)
			: ('escaped' as const);
	};
	const doubleLessThan = () => {
		if (source[cursor + 1] !== '/') return 'double' as const;
		let end = cursor + 2;

		while (asciiAlpha(source[end])) end++;
		const word = htmlAsciiLower(source.slice(cursor + 2, end));
		const boundary = source[end];
		const delimiter =
			boundary === '/' || boundary === '>' || htmlSpace(boundary);

		cursor = delimiter ? end : end - 1;
		return word === 'script' && delimiter
			? ('escaped' as const)
			: ('double' as const);
	};

	while (cursor < source.length) {
		const character = source[cursor];

		if (state === 'data') {
			if (appropriateRawEndTag(source, cursor, 'script')) return cursor;
			if (source.startsWith('<!--', cursor)) {
				state = 'escaped-dash-dash';
				cursor += 4;
				continue;
			}
		} else if (state === 'escaped') {
			if (character === '-') state = 'escaped-dash';
			else if (character === '<') {
				const next = escapedLessThan();

				if (next === 'end') return cursor;
				state = next;
			}
		} else if (state === 'escaped-dash') {
			if (character === '-') state = 'escaped-dash-dash';
			else if (character === '<') {
				const next = escapedLessThan();

				if (next === 'end') return cursor;
				state = next;
			} else state = 'escaped';
		} else if (state === 'escaped-dash-dash') {
			if (character === '<') {
				const next = escapedLessThan();

				if (next === 'end') return cursor;
				state = next;
			} else if (character === '>') state = 'data';
			else if (character !== '-') state = 'escaped';
		} else if (state === 'double') {
			if (character === '-') state = 'double-dash';
			else if (character === '<') state = doubleLessThan();
		} else if (state === 'double-dash') {
			if (character === '-') state = 'double-dash-dash';
			else if (character === '<') state = doubleLessThan();
			else state = 'double';
		} else if (character === '<') state = doubleLessThan();
		else if (character === '>') state = 'data';
		else if (character !== '-') state = 'double';
		cursor++;
	}
	return source.length;
}

const htmlVoidElements = new Set([
	'area',
	'base',
	'basefont',
	'bgsound',
	'br',
	'col',
	'embed',
	'frame',
	'hr',
	'image',
	'img',
	'input',
	'keygen',
	'link',
	'meta',
	'param',
	'source',
	'track',
	'wbr'
]);

const htmlForeignBreakoutElements = new Set([
	'b',
	'big',
	'blockquote',
	'body',
	'br',
	'center',
	'code',
	'dd',
	'div',
	'dl',
	'dt',
	'em',
	'embed',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'head',
	'hr',
	'i',
	'img',
	'li',
	'listing',
	'menu',
	'meta',
	'nobr',
	'ol',
	'p',
	'pre',
	'ruby',
	's',
	'small',
	'span',
	'strike',
	'strong',
	'sub',
	'sup',
	'table',
	'tt',
	'u',
	'ul',
	'var'
]);

function htmlChildrenUseHtml(stack: HtmlOpenElement[], nextTag?: string) {
	const current = stack.at(-1);

	if (!current || current.namespace === 'html') return true;
	if (current.htmlIntegrationPoint) return true;
	if (
		current.namespace === 'math' &&
		current.tag === 'annotation-xml' &&
		nextTag === 'svg'
	)
		return true;
	return (
		current.mathTextIntegrationPoint &&
		nextTag !== 'mglyph' &&
		nextTag !== 'malignmark'
	);
}

function htmlLexicalScan(source: string): HtmlLexicalScan {
	const attributes: HtmlAssetAttribute[] = [];
	const ignoredFallbackSpans: AssetSourceRange[] = [];
	const stack: HtmlOpenElement[] = [];
	const styleAttributes: DecodedSourceValue[] = [];
	const styleContents: AssetSourceRange[] = [];
	let complete = true;
	let cursor = 0;

	while (cursor < source.length) {
		if (source.startsWith('<!--', cursor)) {
			const resume = htmlCommentEnd(source, cursor);

			ignoredFallbackSpans.push({end: resume, start: cursor});
			cursor = resume;
			continue;
		}
		if (source.startsWith('<![CDATA[', cursor) && !htmlChildrenUseHtml(stack)) {
			const end = source.indexOf(']]>', cursor + 9);
			const resume = end === -1 ? source.length : end + 3;

			ignoredFallbackSpans.push({end: resume, start: cursor});
			cursor = resume;
			continue;
		}
		if (source[cursor] !== '<') {
			cursor++;
			continue;
		}
		if (source[cursor + 1] === '!' || source[cursor + 1] === '?') {
			const end = source.indexOf('>', cursor + 2);
			const resume = end === -1 ? source.length : end + 1;

			ignoredFallbackSpans.push({end: resume, start: cursor});
			cursor = resume;
			continue;
		}
		if (source[cursor + 1] === '/') {
			if (!/[A-Za-z]/u.test(source[cursor + 2] ?? '')) {
				if (source[cursor + 2] === '>') {
					cursor += 3;
					continue;
				}
				const end = source.indexOf('>', cursor + 2);
				const resume = end === -1 ? source.length : end + 1;

				ignoredFallbackSpans.push({end: resume, start: cursor});
				cursor = resume;
				continue;
			}
			let nameEnd = cursor + 2;

			while (
				nameEnd < source.length &&
				!htmlSpace(source[nameEnd]) &&
				!['/', '>'].includes(source[nameEnd])
			)
				nameEnd++;
			const tag = htmlAsciiLower(source.slice(cursor + 2, nameEnd));
			const end = htmlTagEnd(source, nameEnd);

			if (!tag || end === null) {
				cursor = end ?? source.length;
				continue;
			}
			const stackIndex = stack.map(item => item.tag).lastIndexOf(tag);

			if (stackIndex !== -1) stack.length = stackIndex;
			cursor = end;
			continue;
		}

		if (!/[A-Za-z]/u.test(source[cursor + 1] ?? '')) {
			cursor++;
			continue;
		}
		let index = cursor + 1;

		while (
			index < source.length &&
			!htmlSpace(source[index]) &&
			!['/', '>'].includes(source[index])
		)
			index++;
		const tag = htmlAsciiLower(source.slice(cursor + 1, index));

		if (!tag) {
			cursor++;
			continue;
		}

		const tagAttributes: ParsedHtmlAttribute[] = [];
		const seenAttributes = new Set<string>();
		let closed = false;
		let selfClosing = false;

		while (index < source.length) {
			while (htmlSpace(source[index])) index++;
			if (source[index] === '>') {
				closed = true;
				index++;
				break;
			}
			if (source[index] === '/' && source[index + 1] === '>') {
				closed = true;
				selfClosing = true;
				index += 2;
				break;
			}
			const nameStart = index;

			while (
				index < source.length &&
				!htmlSpace(source[index]) &&
				!['=', '>', '/'].includes(source[index])
			)
				index++;
			const name = htmlAsciiLower(source.slice(nameStart, index));

			while (htmlSpace(source[index])) index++;
			if (!name || source[index] !== '=') {
				if (name && !seenAttributes.has(name)) {
					seenAttributes.add(name);
					tagAttributes.push({name, value: null});
				}
				if (index === nameStart) index++;
				continue;
			}
			index++;
			while (htmlSpace(source[index])) index++;
			const quote = source[index];
			let valueStart: number;
			let valueEnd: number;

			if (quote === '"' || quote === "'") {
				valueStart = ++index;
				while (index < source.length && source[index] !== quote) index++;
				if (index >= source.length) break;
				valueEnd = index++;
			} else {
				valueStart = index;
				while (
					index < source.length &&
					!htmlSpace(source[index]) &&
					source[index] !== '>'
				)
					index++;
				valueEnd = index;
			}
			if (!seenAttributes.has(name)) {
				seenAttributes.add(name);
				const rawValue = source.slice(valueStart, valueEnd);
				const decodedAttribute = decodedHtmlAttributeNames.has(name);

				if (decodedAttribute && rawValue.includes('\0')) complete = false;
				tagAttributes.push({
					name,
					value: decodedAttribute
						? decodeHtmlAttributeValue(rawValue, valueStart)
						: null
				});
			}
		}
		if (!closed) {
			cursor = Math.max(cursor + 1, index);
			continue;
		}
		// Parsed start tags are authoritative. Generic filename heuristics apply
		// only to free source text, never to labels, metadata, or other attributes.
		ignoredFallbackSpans.push({end: index, start: cursor});

		const attribute = (name: string) =>
			tagAttributes.find(item => item.name === name)?.value ?? null;
		let htmlContext = htmlChildrenUseHtml(stack, tag);
		const topNamespace = stack.at(-1)?.namespace ?? 'html';
		const fontBreakout =
			tag === 'font' &&
			tagAttributes.some(item => ['color', 'face', 'size'].includes(item.name));

		if (
			!htmlContext &&
			(htmlForeignBreakoutElements.has(tag) || fontBreakout)
		) {
			while (stack.length > 0 && !htmlChildrenUseHtml(stack, tag)) stack.pop();
			htmlContext = true;
		}
		const namespace: HtmlNamespace = htmlContext
			? tag === 'svg'
				? 'svg'
				: tag === 'math'
					? 'math'
					: 'html'
			: topNamespace;
		const style = attribute('style');

		if (style) styleAttributes.push(style);
		if (namespace === 'svg') {
			for (const item of tagAttributes) {
				if (item.value && svgCssPresentationAttributes.has(item.name)) {
					styleAttributes.push(item.value);
				}
			}
		}

		const hasDownload = tagAttributes.some(item => item.name === 'download');
		let linkClassification: HtmlLinkRelationClassification | null = null;

		if (namespace === 'html' && tag === 'link') {
			linkClassification = classifyHtmlLinkRelations(
				attribute('rel')?.value ?? '',
				attribute('as')?.value ?? ''
			);
			if (
				linkClassification.unknown &&
				(attribute('href') || attribute('imagesrcset'))
			)
				complete = false;
		}

		if (
			namespace === 'html' &&
			tag === 'meta' &&
			htmlAsciiLower(attribute('http-equiv')?.value ?? '') === 'refresh'
		) {
			const content = attribute('content');
			const range = content ? declarativeRefreshUrlRange(content.value) : null;
			const projected =
				content && range
					? projectDecodedSourceValue(content, range.start, range.end)
					: null;

			if (projected) attributes.push({attribute: 'refresh', value: projected});
			else if (content && range) complete = false;
		}
		const svgHrefDisposition =
			namespace === 'svg' ? classifySvgHrefElement(tag) : null;
		const hasSvgHref = tagAttributes.some(item => item.name === 'href');
		const inputType = attribute('type')?.value ?? '';

		for (const item of tagAttributes) {
			if (!item.value) continue;
			const isSvgReference =
				(svgHrefDisposition === 'resource' ||
					(svgHrefDisposition === 'navigation' && hasDownload)) &&
				(item.name === 'href' || (item.name === 'xlink:href' && !hasSvgHref));
			const isLinkResource =
				tag === 'link' &&
				namespace === 'html' &&
				((item.name === 'href' && linkClassification?.href) ||
					(item.name === 'imagesrcset' && linkClassification?.imagesrcset));
			const isHtmlDownloadHref =
				namespace === 'html' &&
				(tag === 'a' || tag === 'area') &&
				hasDownload &&
				item.name === 'href';
			const htmlAssetAttribute =
				namespace === 'html'
					? classifyHtmlAssetAttribute(tag, item.name, inputType)
					: null;

			const structuredAssetAttribute =
				htmlAssetAttribute !== null ||
				isSvgReference ||
				isLinkResource ||
				isHtmlDownloadHref;

			if (structuredAssetAttribute) {
				attributes.push({attribute: item.name, value: item.value});
			}
		}

		const htmlIntegrationPoint =
			namespace === 'svg' && ['desc', 'foreignobject', 'title'].includes(tag);
		const encoding = htmlAsciiLower(attribute('encoding')?.value ?? '');
		const mathHtmlIntegrationPoint =
			namespace === 'math' &&
			tag === 'annotation-xml' &&
			(encoding === 'text/html' || encoding === 'application/xhtml+xml');
		const shouldPush =
			namespace === 'html' ? !htmlVoidElements.has(tag) : !selfClosing;

		if (shouldPush) {
			if (stack.length >= 512) complete = false;
			else
				stack.push({
					htmlIntegrationPoint:
						htmlIntegrationPoint || mathHtmlIntegrationPoint,
					mathTextIntegrationPoint:
						namespace === 'math' &&
						['mi', 'mn', 'mo', 'ms', 'mtext'].includes(tag),
					namespace,
					tag
				});
		}

		if (namespace !== 'html') {
			cursor = index;
			continue;
		}
		if (tag === 'plaintext') {
			ignoredFallbackSpans.push({end: source.length, start: index});
			cursor = source.length;
			continue;
		}
		if (tag === 'script') {
			const end = scriptTextEnd(source, index);

			ignoredFallbackSpans.push({end, start: index});
			cursor = end;
			continue;
		}
		if (tag === 'style') {
			const end = rawTextEnd(source, index, tag);

			styleContents.push({end, start: index});
			ignoredFallbackSpans.push({end, start: index});
			cursor = end;
			continue;
		}
		if (
			[
				'iframe',
				'noembed',
				'noframes',
				'noscript',
				'title',
				'textarea',
				'xmp'
			].includes(tag)
		) {
			const end = rawTextEnd(source, index, tag);

			ignoredFallbackSpans.push({end, start: index});
			cursor = end;
			continue;
		}
		cursor = index;
	}

	return {
		attributes,
		complete,
		ignoredFallbackSpans,
		styleAttributes,
		styleContents
	};
}

function emptyHtmlLexicalScan(): HtmlLexicalScan {
	return {
		attributes: [],
		complete: true,
		ignoredFallbackSpans: [],
		styleAttributes: [],
		styleContents: []
	};
}

export function* srcsetCandidateRanges(value: string) {
	let cursor = 0;

	while (cursor < value.length) {
		while (htmlSpace(value[cursor]) || value[cursor] === ',') cursor++;
		if (cursor >= value.length) break;

		const start = cursor;
		while (cursor < value.length && !htmlSpace(value[cursor])) cursor++;
		let end = cursor;
		let trailingComma = false;

		while (end > start && value[end - 1] === ',') {
			trailingComma = true;
			end--;
		}
		if (!trailingComma) {
			let state: 'after-descriptor' | 'in-descriptor' | 'in-parens' =
				'in-descriptor';

			while (cursor < value.length) {
				const character = value[cursor];

				if (state === 'in-parens') {
					cursor++;
					if (character === ')') state = 'in-descriptor';
				} else if (state === 'after-descriptor') {
					if (htmlSpace(character)) cursor++;
					else state = 'in-descriptor';
				} else if (character === ',') {
					cursor++;
					break;
				} else {
					cursor++;
					if (character === '(') state = 'in-parens';
					else if (htmlSpace(character)) state = 'after-descriptor';
				}
			}
		}
		if (end === start) continue;
		const prefix = value.slice(start, Math.min(end, start + 5)).toLowerCase();

		yield {
			end,
			ignored: prefix === 'data:' || prefix === 'blob:',
			start
		};
	}
}

function sourceRangeMayBeMediaPath(source: string, start: number, end: number) {
	const extensions = [
		'.png',
		'.jpg',
		'.jpeg',
		'.gif',
		'.svg',
		'.webp',
		'.mp3',
		'.m4a',
		'.ogg',
		'.wav',
		'.mp4',
		'.webm'
	];
	for (let index = start; index < end; index++) {
		if (source[index] === '?' || source[index] === '#') {
			end = index;
			break;
		}
	}
	for (const extension of extensions) {
		if (end - start < extension.length) {
			continue;
		}
		let matches = true;

		for (let index = 0; index < extension.length; index++) {
			if (
				source[end - extension.length + index].toLowerCase() !==
				extension[index]
			) {
				matches = false;
				break;
			}
		}
		if (matches) {
			return true;
		}
	}
	for (
		let candidateStart = Math.max(start, end - 18);
		candidateStart < end;
		candidateStart++
	) {
		let cursor = candidateStart;
		let decoded = '';

		while (cursor < end && decoded.length <= 5) {
			if (
				source[cursor] === '%' &&
				cursor + 2 < end &&
				/[0-9a-f]/i.test(source[cursor + 1]) &&
				/[0-9a-f]/i.test(source[cursor + 2])
			) {
				decoded += String.fromCharCode(
					Number.parseInt(source.slice(cursor + 1, cursor + 3), 16)
				);
				cursor += 3;
			} else {
				decoded += source[cursor];
				cursor++;
			}
		}
		if (extensions.includes(decoded.toLowerCase())) {
			return true;
		}
	}
	return false;
}

function asciiSourceDefinitelyHasNoMediaPath(source: string) {
	const extensions = [
		'png',
		'jpg',
		'jpeg',
		'gif',
		'svg',
		'webp',
		'mp3',
		'm4a',
		'ogg',
		'wav',
		'mp4',
		'webm'
	];

	for (let index = 0; index < source.length; index++) {
		const code = source.charCodeAt(index);

		if (code > 0x7f || code === 37 || code === 38 || code === 92) {
			return false;
		}
		if (code !== 46) {
			continue;
		}
		for (const extension of extensions) {
			if (index + extension.length >= source.length) {
				continue;
			}
			let matches = true;

			for (let offset = 0; offset < extension.length; offset++) {
				const candidate = source.charCodeAt(index + offset + 1) | 32;

				if (candidate !== extension.charCodeAt(offset)) {
					matches = false;
					break;
				}
			}
			if (matches) {
				return false;
			}
		}
	}
	return true;
}

type AssetSourceRange = {end: number; start: number};

type SemanticSourceRange = AssetSourceRange & {
	semantic?: string;
	semanticEntities?: HtmlEntitySegment[];
};

function semanticSourceRange(value: DecodedSourceValue): SemanticSourceRange {
	return {
		end: value.end,
		semantic: value.value,
		semanticEntities: value.entities,
		start: value.start
	};
}

function sortedSpanOverlapCursor(spans: AssetSourceRange[]) {
	let index = 0;

	return (start: number, end: number) => {
		while (spans[index] && spans[index].end <= start) index++;
		const span = spans[index];

		return !!span && start < span.end && end > span.start;
	};
}

function cssNameCharacter(character: string | undefined) {
	return character !== undefined && /[A-Za-z0-9_-]/u.test(character);
}

function cssWhitespace(character: string | undefined) {
	return character !== undefined && /[\t\n\f\r ]/u.test(character);
}

/** Finds CSS url() values without treating comments or ordinary strings as CSS. */
function lexicalCssUrlRanges(source: string) {
	const ignoredSpans: AssetSourceRange[] = [];
	const importRanges: AssetSourceRange[] = [];
	const ranges: AssetSourceRange[] = [];
	const functions: Array<{imageSet: boolean; optionStart: boolean}> = [];
	let complete = true;
	let cursor = 0;
	const pushFunction = (imageSet: boolean) => {
		if (functions.length >= boundedAssetCssMaxNestingDepth) {
			complete = false;
			return false;
		}
		functions.push({imageSet, optionStart: imageSet});
		return true;
	};

	const skipTrivia = (start: number) => {
		let end = start;

		while (end < source.length) {
			if (cssWhitespace(source[end])) {
				end++;
				continue;
			}
			if (source[end] === '/' && source[end + 1] === '*') {
				const commentEnd = source.indexOf('*/', end + 2);

				if (commentEnd === -1) {
					ignoredSpans.push({end: source.length, start: end});
					return {complete: false, end: source.length};
				}
				ignoredSpans.push({end: commentEnd + 2, start: end});
				end = commentEnd + 2;
				continue;
			}
			break;
		}

		return {complete: true, end};
	};
	const readName = (start: number) => {
		let end = start;
		let value = '';

		while (end < source.length) {
			if (cssNameCharacter(source[end])) {
				value += source[end++];
				continue;
			}
			if (source[end] === '\\')
				return {complete: false, end: Math.min(end + 2, source.length), value};
			if (source[end] === '/' && source[end + 1] === '*') {
				const commentEnd = source.indexOf('*/', end + 2);

				if (commentEnd === -1)
					return {complete: false, end: source.length, value};
				ignoredSpans.push({end: commentEnd + 2, start: end});
				end = commentEnd + 2;
				continue;
			}
			break;
		}

		return {complete: true, end, value};
	};

	while (cursor < source.length) {
		if (source[cursor] === '/' && source[cursor + 1] === '*') {
			const end = source.indexOf('*/', cursor + 2);

			if (end === -1) {
				ignoredSpans.push({end: source.length, start: cursor});
				break;
			}
			ignoredSpans.push({end: end + 2, start: cursor});
			cursor = end + 2;
			continue;
		}
		const quote = source[cursor];
		if (quote === '\\') {
			complete = false;
			cursor = Math.min(cursor + 2, source.length);
			continue;
		}
		if (source[cursor] === '@' && cssNameCharacter(source[cursor + 1])) {
			const context = functions.at(-1);

			if (context?.imageSet && context.optionStart) context.optionStart = false;
			const name = readName(cursor + 1);

			if (!name.complete) {
				complete = false;
				break;
			}
			if (name.value.toLowerCase() === 'import') {
				const trivia = skipTrivia(name.end);

				if (!trivia.complete) {
					complete = false;
					break;
				}
				const quoteStart = trivia.end;
				const importQuote = source[quoteStart];

				if (importQuote === '"' || importQuote === "'") {
					let end = quoteStart + 1;
					let valid = true;

					while (end < source.length && source[end] !== importQuote) {
						if (source[end] === '\\') {
							valid = false;
							complete = false;
							end += 2;
						} else {
							end++;
						}
					}
					const closed = source[end] === importQuote;

					ignoredSpans.push({
						end: closed ? end + 1 : source.length,
						start: quoteStart
					});
					if (valid && closed && end > quoteStart + 1) {
						importRanges.push({end, start: quoteStart + 1});
					}
					cursor = closed ? end + 1 : source.length;
					continue;
				}
			}
			cursor = Math.max(name.end, cursor + 1);
			continue;
		}

		if (
			(quote === '"' || quote === "'" || quote === '`') &&
			!(quote === "'" && /[\p{L}\p{N}_]/u.test(source[cursor - 1] ?? ''))
		) {
			const start = cursor;
			const context = functions.at(-1);
			const imageSetOption =
				(quote === '"' || quote === "'") &&
				context?.imageSet === true &&
				context.optionStart;
			let escaped = false;

			cursor++;
			while (cursor < source.length) {
				if (source[cursor] === '\\') {
					escaped = true;
					cursor += 2;
					continue;
				}
				if (source[cursor++] === quote) break;
			}
			ignoredSpans.push({end: cursor, start});
			if (imageSetOption && escaped) complete = false;
			if (
				imageSetOption &&
				!escaped &&
				source[cursor - 1] === quote &&
				cursor > start + 2
			)
				ranges.push({end: cursor - 1, start: start + 1});
			if (context?.imageSet) context.optionStart = false;
			continue;
		}
		if (source[cursor] === '(') {
			const context = functions.at(-1);

			if (context?.imageSet && context.optionStart) context.optionStart = false;
			if (!pushFunction(false)) break;
			cursor++;
			continue;
		}
		if (source[cursor] === ')') {
			functions.pop();
			cursor++;
			continue;
		}
		if (source[cursor] === ',') {
			const context = functions.at(-1);

			if (context?.imageSet) context.optionStart = true;
			cursor++;
			continue;
		}
		if (
			cssNameCharacter(source[cursor]) &&
			!cssNameCharacter(source[cursor - 1])
		) {
			const name = readName(cursor);

			if (!name.complete) {
				complete = false;
				break;
			}
			const nameTrivia = skipTrivia(name.end);

			if (!nameTrivia.complete) {
				complete = false;
				break;
			}
			const open = nameTrivia.end;
			const lowerName = name.value.toLowerCase();
			const context = functions.at(-1);

			if (source[open] !== '(') {
				if (context?.imageSet && context.optionStart)
					context.optionStart = false;
				cursor = Math.max(name.end, cursor + 1);
				continue;
			}
			if (lowerName !== 'url') {
				if (context?.imageSet && context.optionStart)
					context.optionStart = false;
				const imageSet =
					lowerName === 'image-set' || lowerName === '-webkit-image-set';

				if (!pushFunction(imageSet)) break;
				cursor = open + 1;
				continue;
			}
			if (context?.imageSet && context.optionStart) context.optionStart = false;
			const leadingTrivia = skipTrivia(open + 1);

			if (!leadingTrivia.complete) {
				complete = false;
				break;
			}
			let valueStart = leadingTrivia.end;
			let valueEnd = valueStart;
			let end = valueStart;
			let valid = true;

			if (source[valueStart] === '"' || source[valueStart] === "'") {
				const valueQuote = source[valueStart++];

				end = valueStart;
				while (end < source.length && source[end] !== valueQuote) {
					if (source[end] === '\\') {
						valid = false;
						complete = false;
						end += 2;
					} else {
						end++;
					}
				}
				valueEnd = end;
				const trailingTrivia = skipTrivia(end + 1);

				end = trailingTrivia.end;
				valid &&= source[valueEnd] === valueQuote && source[end] === ')';
			} else {
				while (end < source.length && source[end] !== ')') {
					if (
						cssWhitespace(source[end]) ||
						(source[end] === '/' && source[end + 1] === '*')
					) {
						valueEnd = end;
						const trailingTrivia = skipTrivia(end);

						end = trailingTrivia.end;
						valid &&= trailingTrivia.complete && source[end] === ')';
						break;
					}
					if (
						source[end] === '\\' ||
						source[end] === '"' ||
						source[end] === "'" ||
						(source[end] === '/' && source[end + 1] === '*')
					) {
						valid = false;
						if (source[end] === '\\') complete = false;
					}
					end++;
				}
				if (valueEnd === valueStart) valueEnd = end;
				while (valueEnd > valueStart && cssWhitespace(source[valueEnd - 1]))
					valueEnd--;
				valid &&= source[end] === ')';
			}
			while (valueStart < valueEnd && cssWhitespace(source[valueStart]))
				valueStart++;
			while (valueEnd > valueStart && cssWhitespace(source[valueEnd - 1]))
				valueEnd--;

			if (valid && valueEnd > valueStart)
				ranges.push({end: valueEnd, start: valueStart});
			cursor = source[end] === ')' ? end + 1 : Math.max(end, open + 1);
			continue;
		}

		const context = functions.at(-1);

		if (
			context?.imageSet &&
			context.optionStart &&
			!cssWhitespace(source[cursor])
		)
			context.optionStart = false;
		cursor++;
	}

	return {complete, ignoredSpans, importRanges, ranges};
}

function lexicalCssUrlRangesInSource(
	source: string,
	fullCssSource: boolean,
	html: HtmlLexicalScan
) {
	const lexical = fullCssSource
		? lexicalCssUrlRanges(source)
		: {complete: true, ignoredSpans: [], importRanges: [], ranges: []};
	const result = {
		complete: lexical.complete,
		cssContextSpans: fullCssSource
			? [{end: source.length, start: 0}]
			: ([] as AssetSourceRange[]),
		ignoredSpans: lexical.ignoredSpans,
		importRanges: lexical.importRanges as SemanticSourceRange[],
		ranges: lexical.ranges as SemanticSourceRange[]
	};

	if (!fullCssSource) {
		for (const contentSpan of html.styleContents) {
			const value = source.slice(contentSpan.start, contentSpan.end);
			const nested = lexicalCssUrlRanges(value);

			result.complete &&= nested.complete;
			result.cssContextSpans.push({
				end: contentSpan.end,
				start: contentSpan.start
			});
			result.ranges.push(
				...nested.ranges.map(range => ({
					end: contentSpan.start + range.end,
					start: contentSpan.start + range.start
				}))
			);
			result.importRanges.push(
				...nested.importRanges.map(range => ({
					end: contentSpan.start + range.end,
					start: contentSpan.start + range.start
				}))
			);
			result.ignoredSpans.push(
				...nested.ignoredSpans.map(span => ({
					end: contentSpan.start + span.end,
					start: contentSpan.start + span.start
				}))
			);
		}
	}

	for (const value of fullCssSource ? [] : html.styleAttributes) {
		const nested = lexicalCssUrlRanges(value.value);

		result.complete &&= nested.complete;
		result.cssContextSpans.push({
			end: value.end,
			start: value.start
		});
		for (const range of nested.ranges) {
			const projected = projectDecodedSourceValue(
				value,
				range.start,
				range.end
			);

			if (projected) result.ranges.push(semanticSourceRange(projected));
			else result.complete = false;
		}
		for (const range of nested.importRanges) {
			const projected = projectDecodedSourceValue(
				value,
				range.start,
				range.end
			);

			if (projected) result.importRanges.push(semanticSourceRange(projected));
			else result.complete = false;
		}
		for (const span of nested.ignoredSpans) {
			const projected = projectDecodedSourceValue(value, span.start, span.end);

			if (projected)
				result.ignoredSpans.push({end: projected.end, start: projected.start});
			else result.complete = false;
		}
	}
	if (!fullCssSource) result.ignoredSpans.push(...html.ignoredFallbackSpans);
	result.ranges.sort(
		(left, right) => left.start - right.start || left.end - right.end
	);
	result.importRanges.sort(
		(left, right) => left.start - right.start || left.end - right.end
	);
	result.cssContextSpans.sort(
		(left, right) => left.start - right.start || left.end - right.end
	);
	result.ignoredSpans.sort(
		(left, right) => left.start - right.start || left.end - right.end
	);
	return result;
}

export function boundedReferencedMediaPathsInSource(
	source: string,
	fullCssSource = false,
	fullScriptSource = false
): {
	complete: boolean;
	paths: string[];
} {
	type Span = SemanticSourceRange;
	if (source.length > boundedAssetSourceMaxBytes) {
		return {complete: false, paths: []};
	}
	if (asciiSourceDefinitelyHasNoMediaPath(source)) {
		return {complete: true, paths: []};
	}
	if (!sourceFitsUtf8ByteLimit(source, boundedAssetSourceMaxBytes)) {
		return {complete: false, paths: []};
	}
	const html =
		fullCssSource || fullScriptSource
			? emptyHtmlLexicalScan()
			: htmlLexicalScan(source);
	const cssRanges = lexicalCssUrlRangesInSource(source, fullCssSource, html);

	if (!html.complete || !cssRanges.complete)
		return {complete: false, paths: []};
	const candidates: Span[] = [];
	const quotedSpans: Span[] = [];
	let syntacticCount = 0;
	const reserve = () => ++syntacticCount <= boundedAssetSourceMaxCandidates;
	const pushCandidate = (candidate: Span) => {
		const semantic =
			candidate.semantic ?? source.slice(candidate.start, candidate.end);

		if (
			!sourceFitsUtf8ByteLimit(semantic, boundedAssetPathMaxBytes) ||
			!reserve()
		) {
			return false;
		}
		candidates.push(candidate);
		return true;
	};

	for (const htmlAttribute of fullCssSource ? [] : html.attributes) {
		const attribute = htmlAttribute.attribute;
		const decoded = htmlAttribute.value;
		const value = decoded.value;
		if (attribute === 'srcset' || attribute === 'imagesrcset') {
			for (const token of srcsetCandidateRanges(value)) {
				if (!reserve()) return {complete: false, paths: []};
				const projected = projectDecodedSourceValue(
					decoded,
					token.start,
					token.end
				);
				if (
					!token.ignored &&
					token.end > token.start &&
					(!projected ||
						!sourceFitsUtf8ByteLimit(projected.value, boundedAssetPathMaxBytes))
				) {
					return {complete: false, paths: []};
				}
				if (!token.ignored && token.end > token.start && projected)
					candidates.push(semanticSourceRange(projected));
			}
		} else {
			const trimmed = urlTrimmedSourceRange(value);
			const projected = projectDecodedSourceValue(
				decoded,
				trimmed.start,
				trimmed.end
			);

			if (
				trimmed.end > trimmed.start &&
				(!projected || !pushCandidate(semanticSourceRange(projected)))
			) {
				return {complete: false, paths: []};
			}
		}
	}

	for (const range of cssRanges.ranges) {
		if (!pushCandidate(range)) {
			return {complete: false, paths: []};
		}
	}
	for (const range of cssRanges.importRanges) {
		if (!pushCandidate(range)) {
			return {complete: false, paths: []};
		}
	}
	const structuredCandidateSpans = [...candidates].sort(
		(left, right) => left.start - right.start || left.end - right.end
	);
	const quotedCandidateOverlap = sortedSpanOverlapCursor(
		structuredCandidateSpans
	);

	let quoteStart = 0;
	let commentIndex = 0;
	while (quoteStart < source.length) {
		while (
			cssRanges.ignoredSpans[commentIndex] &&
			cssRanges.ignoredSpans[commentIndex].end <= quoteStart
		) {
			commentIndex++;
		}
		const ignored = cssRanges.ignoredSpans[commentIndex];

		if (ignored && quoteStart >= ignored.start) {
			quoteStart = ignored.end;
			continue;
		}
		const quote = source[quoteStart];

		if (
			(quote !== '"' && quote !== "'" && quote !== '`') ||
			(quote === "'" && /[\p{L}\p{N}_]/u.test(source[quoteStart - 1] ?? ''))
		) {
			quoteStart++;
			continue;
		}
		const contentStart = quoteStart + 1;
		let cursor = contentStart;
		let safeStaticLiteral = true;

		while (cursor < source.length && source[cursor] !== quote) {
			if (source[cursor] === '\\') {
				safeStaticLiteral = false;
				cursor += 2;
				continue;
			}
			if (
				quote === '`' &&
				source[cursor] === '$' &&
				source[cursor + 1] === '{'
			) {
				safeStaticLiteral = false;
			}
			cursor++;
		}
		const contentEnd = Math.min(cursor, source.length);

		if (!reserve()) {
			return {complete: false, paths: []};
		}
		quotedSpans.push({end: contentEnd, start: contentStart});
		if (cursor >= source.length) {
			break;
		}
		const trimmed = urlTrimmedSourceRange(source, contentStart, contentEnd);
		const overlapsCandidate = quotedCandidateOverlap(
			trimmed.start,
			trimmed.end
		);

		const literalFitsPathLimit = sourceRangeFitsUtf8ByteLimit(
			source,
			trimmed.start,
			trimmed.end,
			boundedAssetPathMaxBytes
		);

		if (
			safeStaticLiteral &&
			!overlapsCandidate &&
			!literalFitsPathLimit &&
			sourceRangeMayBeMediaPath(source, trimmed.start, trimmed.end)
		) {
			return {complete: false, paths: []};
		}
		const original =
			safeStaticLiteral && !overlapsCandidate && literalFitsPathLimit
				? source.slice(trimmed.start, trimmed.end)
				: '';
		const start = trimmed.start;
		const path = safeStaticLiteral ? localAssetReferencePath(original) : null;

		if (path && !sourceFitsUtf8ByteLimit(path, boundedAssetPathMaxBytes)) {
			return {complete: false, paths: []};
		}
		if (
			path &&
			assetKindForPath(path) !== 'file' &&
			!overlapsCandidate &&
			!pushCandidate({end: start + original.length, start})
		) {
			return {complete: false, paths: []};
		}
		quoteStart = cursor + 1;
	}

	const literalRegex = new RegExp(
		literalAssetReferenceRegex.source,
		literalAssetReferenceRegex.flags
	);
	const literalCandidateSpans = [...candidates].sort(
		(left, right) => left.start - right.start || left.end - right.end
	);
	const literalCandidateOverlap = sortedSpanOverlapCursor(
		literalCandidateSpans
	);
	const literalQuoteOverlap = sortedSpanOverlapCursor(quotedSpans);
	const literalIgnoredOverlap = sortedSpanOverlapCursor(cssRanges.ignoredSpans);
	for (
		let match = literalRegex.exec(source);
		match;
		match = literalRegex.exec(source)
	) {
		const start = match.index;
		const end = start + match[0].length;

		if (
			!literalIgnoredOverlap(start, end) &&
			!literalCandidateOverlap(start, end) &&
			!literalQuoteOverlap(start, end) &&
			!pushCandidate({end, start})
		) {
			return {complete: false, paths: []};
		}
	}

	const paths = new Set<string>();
	for (const candidate of candidates) {
		const path = localAssetReferencePath(
			candidate.semantic ?? source.slice(candidate.start, candidate.end)
		);

		if (path && !sourceFitsUtf8ByteLimit(path, boundedAssetPathMaxBytes)) {
			return {complete: false, paths: []};
		}

		if (path && ['image', 'audio', 'video'].includes(assetKindForPath(path))) {
			paths.add(normalizedAssetPath(path));
		}
	}
	return {
		complete: true,
		paths: [...paths]
			.sort(compareAssetPaths)
			.slice(0, boundedAssetSourceMaxPaths)
	};
}

export function assetReferencesInSource(
	sourceId: string,
	sourceName: string,
	source: string,
	passageId: string | null
): CoreAssetReference[] {
	type Candidate = SemanticSourceRange & {context: string};
	const candidates: Candidate[] = [];
	const fullCssSource =
		sourceId.toLowerCase().endsWith(':stylesheet') ||
		sourceName.toLowerCase() === 'story stylesheet';
	const fullScriptSource =
		sourceId.toLowerCase().endsWith(':script') ||
		sourceName.toLowerCase() === 'story javascript';
	const html =
		fullCssSource || fullScriptSource
			? emptyHtmlLexicalScan()
			: htmlLexicalScan(source);
	const cssRanges = lexicalCssUrlRangesInSource(source, fullCssSource, html);
	for (const htmlAttribute of fullCssSource ? [] : html.attributes) {
		const attribute = htmlAttribute.attribute;
		const decoded = htmlAttribute.value;
		const value = decoded.value;

		if (attribute === 'srcset' || attribute === 'imagesrcset') {
			for (const token of srcsetCandidateRanges(value)) {
				if (!token.ignored && token.end > token.start) {
					const projected = projectDecodedSourceValue(
						decoded,
						token.start,
						token.end
					);

					if (!projected) continue;
					candidates.push({
						...semanticSourceRange(projected),
						context: 'html-srcset'
					});
				}
			}
		} else {
			const range = urlTrimmedSourceRange(value);
			const semantic = value.slice(range.start, range.end);
			const projected = projectDecodedSourceValue(
				decoded,
				range.start,
				range.end
			);

			if (semantic && projected) {
				candidates.push({
					...semanticSourceRange(projected),
					context:
						attribute === 'data'
							? 'html-data'
							: attribute === 'xlink:href'
								? 'html-href'
								: `html-${attribute}`
				});
			}
		}
	}

	candidates.push(
		...cssRanges.ranges.map(range => ({...range, context: 'css-url'})),
		...cssRanges.importRanges.map(range => ({
			...range,
			context: 'css-import'
		}))
	);
	const structuredCandidateSpans = [...candidates].sort(
		(left, right) => left.start - right.start || left.end - right.end
	);
	const quotedCandidateOverlap = sortedSpanOverlapCursor(
		structuredCandidateSpans
	);

	const quotedSpans: Array<{end: number; start: number}> = [];
	let quoteStart = 0;
	let commentIndex = 0;

	while (quoteStart < source.length) {
		while (
			cssRanges.ignoredSpans[commentIndex] &&
			cssRanges.ignoredSpans[commentIndex].end <= quoteStart
		) {
			commentIndex++;
		}
		const ignored = cssRanges.ignoredSpans[commentIndex];

		if (ignored && quoteStart >= ignored.start) {
			quoteStart = ignored.end;
			continue;
		}
		const quote = source[quoteStart];

		if (
			(quote !== '"' && quote !== "'" && quote !== '`') ||
			(quote === "'" && /[\p{L}\p{N}_]/u.test(source[quoteStart - 1] ?? ''))
		) {
			quoteStart++;
			continue;
		}

		const contentStart = quoteStart + 1;
		let cursor = contentStart;
		let safeStaticLiteral = true;

		while (cursor < source.length && source[cursor] !== quote) {
			if (source[cursor] === '\\') {
				safeStaticLiteral = false;
				cursor += 2;
				continue;
			}
			if (
				quote === '`' &&
				source[cursor] === '$' &&
				source[cursor + 1] === '{'
			) {
				safeStaticLiteral = false;
			}
			cursor++;
		}

		const contentEnd = Math.min(cursor, source.length);

		quotedSpans.push({end: contentEnd, start: contentStart});
		if (cursor >= source.length) {
			break;
		}

		const range = urlTrimmedSourceRange(source, contentStart, contentEnd);
		const original = source.slice(range.start, range.end);
		const start = range.start;
		const path = safeStaticLiteral ? localAssetReferencePath(original) : null;

		if (
			path &&
			(assetKindForPath(path) !== 'file' ||
				explicitlyManagedAssetReference(original)) &&
			!quotedCandidateOverlap(start, start + original.length)
		) {
			candidates.push({
				context: 'literal',
				end: start + original.length,
				start
			});
		}
		quoteStart = cursor + 1;
	}

	const literalCandidateSpans = [...candidates].sort(
		(left, right) => left.start - right.start || left.end - right.end
	);
	const literalCandidateOverlap = sortedSpanOverlapCursor(
		literalCandidateSpans
	);
	const literalQuoteOverlap = sortedSpanOverlapCursor(quotedSpans);
	const literalIgnoredOverlap = sortedSpanOverlapCursor(cssRanges.ignoredSpans);
	for (
		let match = literalAssetReferenceRegex.exec(source);
		match;
		match = literalAssetReferenceRegex.exec(source)
	) {
		const start = match.index;
		const end = start + match[0].length;

		if (
			!literalIgnoredOverlap(start, end) &&
			!literalCandidateOverlap(start, end) &&
			!literalQuoteOverlap(start, end)
		) {
			candidates.push({context: 'literal', end, start});
		}
	}

	const references: CoreAssetReference[] = [];
	let line = 1;
	let lineCursor = 0;

	for (const candidate of candidates.sort(
		(left, right) => left.start - right.start || left.end - right.end
	)) {
		while (lineCursor < candidate.start) {
			if (source.charCodeAt(lineCursor) === 10) {
				line++;
			}
			lineCursor++;
		}
		const original = source.slice(candidate.start, candidate.end);
		const semantic = candidate.semantic ?? original;
		const path = localAssetReferencePath(semantic);

		if (
			!path ||
			(assetKindForPath(path) === 'file' &&
				!contextSupportsArbitraryAsset(candidate.context, semantic))
		) {
			continue;
		}

		const fragmentStart = semantic.indexOf('#');
		const beforeFragment =
			fragmentStart === -1 ? semantic : semantic.slice(0, fragmentStart);
		const queryStart = beforeFragment.indexOf('?');
		const rawBoundary = (semanticOffset: number) => {
			if (!candidate.semanticEntities) return semanticOffset;
			const raw = decodedBoundaryToRaw(
				{
					end: candidate.end,
					entities: candidate.semanticEntities,
					start: candidate.start,
					value: semantic
				},
				semanticOffset
			);

			return raw === null ? null : raw - candidate.start;
		};
		const rawQueryStart = queryStart === -1 ? null : rawBoundary(queryStart);
		const rawFragmentStart =
			fragmentStart === -1 ? null : rawBoundary(fragmentStart);

		if (
			(queryStart !== -1 && rawQueryStart === null) ||
			(fragmentStart !== -1 && rawFragmentStart === null)
		)
			continue;

		references.push({
			context: candidate.context,
			end: candidate.end,
			fragment:
				rawFragmentStart === null ? null : original.slice(rawFragmentStart),
			kind: assetKindForPath(path),
			line,
			original,
			passageId,
			path,
			query:
				rawQueryStart === null
					? null
					: original.slice(rawQueryStart, rawFragmentStart ?? original.length),
			sourceId,
			sourceName,
			start: candidate.start
		});
	}
	return references;
}

export function replaceAssetReferencesInSource(
	source: string,
	oldPath: string,
	newPath: string,
	fullCssSource = false,
	fullScriptSource = false
) {
	const oldNormalized = normalizedAssetPath(oldPath);
	const replacementPath = encodedAssetReferencePath(newPath);
	let output = source;

	for (const reference of assetReferencesInSource(
		fullCssSource ? 'story:stylesheet' : fullScriptSource ? 'story:script' : '',
		'',
		source,
		null
	)
		.filter(reference => normalizedAssetPath(reference.path) === oldNormalized)
		.sort((left, right) => right.start - left.start)) {
		output =
			output.slice(0, reference.start) +
			replacementPath +
			(reference.query ?? '') +
			(reference.fragment ?? '') +
			output.slice(reference.end);
	}

	return output;
}
