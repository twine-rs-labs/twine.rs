export const maxImportSourceBytes = 50 * 1024 * 1024;
export const maxImportPassageBytes = 10 * 1024 * 1024;
export const maxImportTweeHeaderBytes = 64 * 1024;
export const maxImportPassages = 100_000;
export const maxImportTagsPerPassage = 256;
export const maxImportTotalTags = 250_000;
export const maxImportStoryGraphMetadataBytes = 2 * 1024 * 1024;
export const maxImportStoryGraphEntries = 100_000;
export const maxImportTagColors = 10_000;
export const maxImportAssets = 1_000;
export const maxImportAssetScanEntries = 10_000;
export const maxImportAssetScanDepth = 32;
export const maxImportAssetPathComponentCharacters = 255;
export const maxLegacyImportAggregateBytes = 250 * 1024 * 1024;
export const maxImportStories = 1_000;
export const maxImportHtmlElements = 250_000;
export const maxImportHtmlNestingDepth = 256;
export const maxImportZipBytes = 100 * 1024 * 1024;
export const maxImportZipEntries = 10_000;
export const maxImportZipEntryBytes = 100 * 1024 * 1024;
export const maxImportZipExpandedBytes = 500 * 1024 * 1024;
export const maxImportZipNestingDepth = 32;
export const maxImportZipCompressionRatio = 200;

const htmlVoidElements = new Set([
	'area',
	'base',
	'br',
	'col',
	'embed',
	'hr',
	'img',
	'input',
	'link',
	'meta',
	'param',
	'source',
	'track',
	'wbr'
]);
const htmlRawTextElements = new Set([
	'iframe',
	'noembed',
	'noframes',
	'noscript',
	'script',
	'style',
	'textarea',
	'title',
	'xmp'
]);
const htmlHeadingElements = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const htmlForeignContentIntegrationPoints = new Set([
	'annotation-xml',
	'desc',
	'foreignobject',
	'title'
]);
const htmlForeignContentBreakoutElements = new Set([
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
	'font',
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
const htmlBlockElementsThatCloseParagraphs = new Set([
	'address',
	'article',
	'aside',
	'blockquote',
	'div',
	'dl',
	'fieldset',
	'footer',
	'form',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'header',
	'hr',
	'menu',
	'nav',
	'ol',
	'p',
	'pre',
	'section',
	'table',
	'ul'
]);

export interface HtmlImportBudget {
	maxElements?: number;
	maxNestingDepth?: number;
	maxPassages?: number;
	maxSourceBytes?: number;
	maxStories?: number;
}

interface HtmlStackEntry {
	foreign: boolean;
	name: string;
}

function formattedMebibytes(bytes: number) {
	return bytes < 1024 * 1024
		? `${bytes / 1024} KiB`
		: `${bytes / (1024 * 1024)} MiB`;
}

function utf8ByteLengthThroughLimit(value: string, limit: number) {
	let bytes = 0;

	for (let index = 0; index < value.length; index++) {
		const codeUnit = value.charCodeAt(index);

		if (codeUnit <= 0x7f) {
			bytes++;
		} else if (codeUnit <= 0x7ff) {
			bytes += 2;
		} else if (
			codeUnit >= 0xd800 &&
			codeUnit <= 0xdbff &&
			index + 1 < value.length &&
			value.charCodeAt(index + 1) >= 0xdc00 &&
			value.charCodeAt(index + 1) <= 0xdfff
		) {
			bytes += 4;
			index++;
		} else {
			bytes += 3;
		}

		if (bytes > limit) {
			return bytes;
		}
	}

	return bytes;
}

export function assertImportFileSize(
	sizeBytes: number,
	maxBytes = maxImportSourceBytes
) {
	if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
		throw new Error('Import source has an invalid file size.');
	}
	if (sizeBytes > maxBytes) {
		throw new Error(
			`Import source exceeds the ${formattedMebibytes(maxBytes)} limit.`
		);
	}
}

export function cumulativeImportBytes(
	currentBytes: number,
	additionalBytes: number,
	maxBytes = maxLegacyImportAggregateBytes
) {
	if (
		!Number.isSafeInteger(currentBytes) ||
		currentBytes < 0 ||
		!Number.isSafeInteger(additionalBytes) ||
		additionalBytes < 0 ||
		currentBytes > maxBytes - additionalBytes
	) {
		throw new Error(
			`Imported sources exceed the ${formattedMebibytes(
				maxBytes
			)} aggregate limit.`
		);
	}

	return currentBytes + additionalBytes;
}

export function assertImportTextSize(
	source: string,
	maxBytes = maxImportSourceBytes
) {
	if (utf8ByteLengthThroughLimit(source, maxBytes) > maxBytes) {
		throw new Error(
			`Import source exceeds the ${formattedMebibytes(maxBytes)} limit.`
		);
	}
}

function implicitlyCloseHtmlElement(
	stack: HtmlStackEntry[],
	openingName: string
) {
	const current = stack[stack.length - 1];
	const currentName = current?.foreign ? undefined : current?.name;

	if (
		(openingName === 'li' && currentName === 'li') ||
		(['dt', 'dd'].includes(openingName) &&
			['dt', 'dd'].includes(currentName ?? '')) ||
		(['rt', 'rp'].includes(openingName) &&
			['rt', 'rp'].includes(currentName ?? '')) ||
		(openingName === 'option' && currentName === 'option') ||
		(openingName === 'optgroup' && currentName === 'optgroup') ||
		(openingName === 'tr' && currentName === 'tr') ||
		(['td', 'th'].includes(openingName) &&
			['td', 'th'].includes(currentName ?? '')) ||
		(['thead', 'tbody', 'tfoot'].includes(openingName) &&
			['thead', 'tbody', 'tfoot'].includes(currentName ?? '')) ||
		(htmlHeadingElements.has(openingName) &&
			htmlHeadingElements.has(currentName ?? '')) ||
		(currentName === 'p' &&
			htmlBlockElementsThatCloseParagraphs.has(openingName))
	) {
		stack.pop();
	}
}

function scanHtmlImportStructure(
	html: string,
	maxElements: number,
	maxPassages: number,
	maxStories: number,
	maxNestingDepth: number
) {
	const stack: HtmlStackEntry[] = [];
	let elementCount = 0;
	let index = 0;
	let passageCount = 0;
	let storyCount = 0;

	while (index < html.length) {
		const tagStart = html.indexOf('<', index);

		if (tagStart === -1) {
			break;
		}

		index = tagStart + 1;
		const stackParent = stack[stack.length - 1];
		const rawTextParent = stackParent?.foreign ? undefined : stackParent?.name;
		let closing = false;

		if (rawTextParent && htmlRawTextElements.has(rawTextParent)) {
			if (html[index] !== '/') {
				continue;
			}
			closing = true;
			index++;
		} else if (html.startsWith('!--', index)) {
			const contentStart = index + 3;
			const standardEnd = html.indexOf('-->', contentStart);
			const bangEnd = html.indexOf('--!>', contentStart);
			let commentEnd =
				standardEnd === -1
					? bangEnd
					: bangEnd === -1
						? standardEnd
						: Math.min(standardEnd, bangEnd);
			let terminatorLength = commentEnd === bangEnd && bangEnd !== -1 ? 4 : 3;

			if (html[contentStart] === '>') {
				commentEnd = contentStart;
				terminatorLength = 1;
			} else if (html.startsWith('->', contentStart)) {
				commentEnd = contentStart;
				terminatorLength = 2;
			}
			index = commentEnd === -1 ? html.length : commentEnd + terminatorLength;
			continue;
		} else if (html[index] === '/') {
			closing = true;
			index++;
		} else if (html[index] === '!' || html[index] === '?') {
			const declarationEnd = html.indexOf('>', index + 1);

			index = declarationEnd === -1 ? html.length : declarationEnd + 1;
			continue;
		}

		const nameStart = index;

		while (index < html.length && /[A-Za-z0-9:-]/.test(html[index])) {
			index++;
		}
		if (index === nameStart) {
			continue;
		}

		const name = html.slice(nameStart, index).toLowerCase();

		if (rawTextParent && htmlRawTextElements.has(rawTextParent)) {
			if (name !== rawTextParent) {
				continue;
			}
		}

		let quote: string | undefined;
		let tagEnd = index;

		for (; tagEnd < html.length; tagEnd++) {
			const character = html[tagEnd];

			if (quote) {
				if (character === quote) {
					quote = undefined;
				}
			} else if (character === '"' || character === "'") {
				quote = character;
			} else if (character === '>') {
				break;
			}
		}
		if (tagEnd === html.length) {
			break;
		}

		const hasSelfClosingSyntax = html
			.slice(index, tagEnd)
			.trimEnd()
			.endsWith('/');

		index = tagEnd + 1;
		elementCount++;
		if (elementCount > maxElements) {
			throw new Error(
				`Import HTML contains more than ${maxElements.toLocaleString(
					'en-US'
				)} element tags.`
			);
		}
		if (closing) {
			let matchingIndex = -1;

			for (let stackIndex = stack.length - 1; stackIndex >= 0; stackIndex--) {
				if (stack[stackIndex].name === name) {
					matchingIndex = stackIndex;
					break;
				}
			}

			if (matchingIndex !== -1) {
				stack.length = matchingIndex;
			}
			continue;
		}

		if (name === 'tw-passagedata') {
			passageCount++;
			if (passageCount > maxPassages) {
				throw new Error(
					`Import contains more than ${maxPassages.toLocaleString('en-US')} passages.`
				);
			}
		}
		if (name === 'tw-storydata') {
			storyCount++;
			if (storyCount > maxStories) {
				throw new Error(
					`Import contains more than ${maxStories.toLocaleString(
						'en-US'
					)} stories.`
				);
			}
		}

		const parentUsesHtmlRules =
			!stackParent?.foreign ||
			htmlForeignContentIntegrationPoints.has(stackParent.name);
		const foreign =
			name === 'svg' ||
			name === 'math' ||
			(!parentUsesHtmlRules && !htmlForeignContentBreakoutElements.has(name));
		const selfClosing = hasSelfClosingSyntax && foreign;
		const voidElement = !foreign && htmlVoidElements.has(name);

		if (!selfClosing && !voidElement) {
			if (!foreign) {
				implicitlyCloseHtmlElement(stack, name);
			}
			stack.push({foreign, name});
			if (stack.length > maxNestingDepth) {
				throw new Error(
					`Import HTML nesting exceeds ${maxNestingDepth} levels.`
				);
			}
		}
	}
}

export function assertHtmlImportWithinBudget(
	html: string,
	budget: HtmlImportBudget = {}
) {
	const {
		maxElements = maxImportHtmlElements,
		maxNestingDepth = maxImportHtmlNestingDepth,
		maxPassages = maxImportPassages,
		maxSourceBytes = maxImportSourceBytes,
		maxStories = maxImportStories
	} = budget;

	assertImportTextSize(html, maxSourceBytes);
	scanHtmlImportStructure(
		html,
		maxElements,
		maxPassages,
		maxStories,
		maxNestingDepth
	);
}

export function assertTweePassageCount(
	source: string,
	maxPassageCount = maxImportPassages
) {
	let count = 0;
	const passageHeader = /^::/gm;
	let match = passageHeader.exec(source);

	while (match) {
		count++;
		if (count > maxPassageCount) {
			throw new Error(
				`Import contains more than ${maxPassageCount.toLocaleString('en-US')} passages.`
			);
		}
		match = passageHeader.exec(source);
	}
}
