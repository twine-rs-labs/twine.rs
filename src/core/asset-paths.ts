import type {CoreAssetReference} from './bindings/CoreAssetReference';
import type {CoreAssetSnippet} from './bindings/CoreAssetSnippet';

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
	const text =
		kind === 'image'
			? `<img src="${path}" alt="">`
			: kind === 'audio'
				? `<audio src="${path}" controls></audio>`
				: kind === 'video'
					? `<video src="${path}" controls></video>`
					: kind === 'stylesheet'
						? `<link rel="stylesheet" href="${path}">`
						: kind === 'script'
							? `<script src="${path}"></script>`
							: path;

	return {
		label: 'Insert asset reference',
		mediaType: kind,
		text
	};
}

export function localAssetReferencePath(path: string) {
	const suffixStart = path.search(/[?#]/);
	const sourcePath = (
		suffixStart === -1 ? path : path.slice(0, suffixStart)
	).trim();
	let normalized: string;

	try {
		normalized = decodeURIComponent(sourcePath).replace(/\\/g, '/');
	} catch {
		return null;
	}

	while (normalized.startsWith('./')) {
		normalized = normalized.slice(2);
	}

	if (
		protocolRegex.test(normalized) ||
		normalized.startsWith('//') ||
		normalized.includes('\0')
	) {
		return null;
	}

	if (normalized.startsWith('/')) {
		if (!normalized.slice(1).toLowerCase().startsWith('assets/')) {
			return null;
		}

		normalized = normalized.slice(1);
	}

	const segments = normalized.split('/').filter(segment => segment.length > 0);
	const assetSegments =
		segments[0]?.toLowerCase() === 'assets' ? segments.slice(1) : segments;

	if (
		assetSegments.length === 0 ||
		assetSegments.some(segment => segment === '.' || segment === '..')
	) {
		return null;
	}

	return `assets/${assetSegments.join('/')}`;
}

export function normalizedAssetPath(path: string) {
	return (
		localAssetReferencePath(path) ??
		path.replace(/\\/g, '/').replace(/^(\.\/)+/, '')
	);
}

export function projectAssetPath(path: string) {
	return localAssetReferencePath(path) ?? 'assets/asset';
}

const boundedAssetSourceMaxBytes = 1024 * 1024;
const boundedAssetSourceMaxCandidates = 256;
const boundedAssetSourceMaxPaths = 25;
const boundedAssetPathMaxBytes = 4096;

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

function trimmedSourceRange(source: string, start: number, end: number) {
	while (start < end && /\s/u.test(source[start])) {
		start++;
	}
	while (end > start && /\s/u.test(source[end - 1])) {
		end--;
	}
	return {end, start};
}

function srcsetDescriptorInRange(source: string, start: number, end: number) {
	if (start >= end || !/[wxh]/i.test(source[end - 1])) {
		return false;
	}
	let cursor = start;
	let digitsBeforeDecimal = 0;

	while (cursor < end - 1 && /[0-9]/.test(source[cursor])) {
		cursor++;
		digitsBeforeDecimal++;
	}
	if (digitsBeforeDecimal === 0) {
		return false;
	}
	if (source[cursor] === '.') {
		cursor++;
		const decimalStart = cursor;

		while (cursor < end - 1 && /[0-9]/.test(source[cursor])) {
			cursor++;
		}
		if (cursor === decimalStart) {
			return false;
		}
	}
	return cursor === end - 1;
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

		if (code > 0x7f || code === 37) {
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

export function boundedReferencedMediaPathsInSource(source: string): {
	complete: boolean;
	paths: string[];
} {
	type Span = {end: number; start: number};
	if (!sourceFitsUtf8ByteLimit(source, boundedAssetSourceMaxBytes)) {
		return {complete: false, paths: []};
	}
	if (asciiSourceDefinitelyHasNoMediaPath(source)) {
		return {complete: true, paths: []};
	}
	const candidates: Span[] = [];
	const quotedSpans: Span[] = [];
	let syntacticCount = 0;
	const reserve = () => ++syntacticCount <= boundedAssetSourceMaxCandidates;
	const pushCandidate = (candidate: Span) => {
		if (
			!sourceRangeFitsUtf8ByteLimit(
				source,
				candidate.start,
				candidate.end,
				boundedAssetPathMaxBytes
			) ||
			!reserve()
		) {
			return false;
		}
		candidates.push(candidate);
		return true;
	};
	const htmlAttribute =
		/(?:^|[\s<])(srcset|src|href|poster)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
	const cssUrl = /\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi;

	for (
		let match = htmlAttribute.exec(source);
		match;
		match = htmlAttribute.exec(source)
	) {
		const attribute = match[1].toLowerCase();
		const value = match[2] ?? match[3] ?? '';
		const valueStart = match.index + match[0].lastIndexOf(value);

		if (value.includes('\\')) {
			continue;
		}
		if (attribute === 'srcset') {
			if (/\b(?:data|blob):/i.test(value)) {
				continue;
			}
			let segmentStart = 0;

			while (segmentStart <= value.length) {
				const comma = value.indexOf(',', segmentStart);
				const segmentEnd = comma === -1 ? value.length : comma;
				const token = trimmedSourceRange(value, segmentStart, segmentEnd);
				let tokenEnd = token.end;
				let descriptorStart = tokenEnd;

				while (
					descriptorStart > token.start &&
					!/\s/u.test(value[descriptorStart - 1])
				) {
					descriptorStart--;
				}
				if (
					descriptorStart > token.start &&
					srcsetDescriptorInRange(value, descriptorStart, tokenEnd)
				) {
					tokenEnd = trimmedSourceRange(
						value,
						token.start,
						descriptorStart
					).end;
				}
				if (
					tokenEnd > token.start &&
					!pushCandidate({
						end: valueStart + tokenEnd,
						start: valueStart + token.start
					})
				) {
					return {complete: false, paths: []};
				}
				if (comma === -1) {
					break;
				}
				segmentStart = comma + 1;
			}
		} else {
			const trimmed = trimmedSourceRange(value, 0, value.length);
			const start = valueStart + trimmed.start;

			if (
				trimmed.end > trimmed.start &&
				!pushCandidate({end: valueStart + trimmed.end, start})
			) {
				return {complete: false, paths: []};
			}
		}
	}

	for (let match = cssUrl.exec(source); match; match = cssUrl.exec(source)) {
		const value = match[1] ?? match[2] ?? match[3] ?? '';
		const trimmed = trimmedSourceRange(value, 0, value.length);
		const valueStart = match.index + match[0].lastIndexOf(value);
		const start = valueStart + trimmed.start;

		if (
			trimmed.end > trimmed.start &&
			!value.includes('\\') &&
			!pushCandidate({end: valueStart + trimmed.end, start})
		) {
			return {complete: false, paths: []};
		}
	}

	let quoteStart = 0;
	while (quoteStart < source.length) {
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
		const trimmed = trimmedSourceRange(source, contentStart, contentEnd);
		const overlapsCandidate = candidates.some(
			candidate =>
				trimmed.start < candidate.end && trimmed.end > candidate.start
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
			!candidates.some(
				candidate =>
					start < candidate.end && start + original.length > candidate.start
			) &&
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
	for (
		let match = literalRegex.exec(source);
		match;
		match = literalRegex.exec(source)
	) {
		const start = match.index;
		const end = start + match[0].length;

		if (
			!candidates.some(
				candidate => start < candidate.end && end > candidate.start
			) &&
			!quotedSpans.some(span => start < span.end && end > span.start) &&
			!pushCandidate({end, start})
		) {
			return {complete: false, paths: []};
		}
	}

	const paths = new Set<string>();
	for (const candidate of candidates) {
		const path = localAssetReferencePath(
			source.slice(candidate.start, candidate.end)
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
	type Candidate = {context: string; end: number; start: number};
	const candidates: Candidate[] = [];
	const htmlAttribute =
		/(?:^|[\s<])(srcset|src|href|poster)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
	const cssUrl = /\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi;

	for (
		let match = htmlAttribute.exec(source);
		match;
		match = htmlAttribute.exec(source)
	) {
		const attribute = match[1].toLowerCase();
		const value = match[2] ?? match[3] ?? '';
		const valueStart = match.index + match[0].lastIndexOf(value);

		if (value.includes('\\')) {
			continue;
		}

		if (attribute === 'srcset') {
			if (/\b(?:data|blob):/i.test(value)) {
				continue;
			}
			let segmentStart = 0;

			for (const segment of value.split(',')) {
				const leading = segment.length - segment.trimStart().length;
				const token = segment
					.trim()
					.replace(/\s+\d+(?:\.\d+)?[wxh]\s*$/i, '')
					.trimEnd();

				if (token) {
					const start = valueStart + segmentStart + leading;

					candidates.push({
						context: 'html-srcset',
						end: start + token.length,
						start
					});
				}

				segmentStart += segment.length + 1;
			}
		} else {
			const leading = value.length - value.trimStart().length;
			const original = value.trim();
			const start = valueStart + leading;

			if (original) {
				candidates.push({
					context: `html-${attribute}`,
					end: start + original.length,
					start
				});
			}
		}
	}

	for (let match = cssUrl.exec(source); match; match = cssUrl.exec(source)) {
		const value = match[1] ?? match[2] ?? match[3] ?? '';
		const leading = value.length - value.trimStart().length;
		const original = value.trim();
		const start = match.index + match[0].lastIndexOf(value) + leading;

		if (original && !value.includes('\\')) {
			candidates.push({
				context: 'css-url',
				end: start + original.length,
				start
			});
		}
	}

	const quotedSpans: Array<{end: number; start: number}> = [];
	let quoteStart = 0;

	while (quoteStart < source.length) {
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

		const value = source.slice(contentStart, contentEnd);
		const leading = value.length - value.trimStart().length;
		const original = value.trim();
		const start = contentStart + leading;
		const path = safeStaticLiteral ? localAssetReferencePath(original) : null;

		if (
			path &&
			assetKindForPath(path) !== 'file' &&
			!candidates.some(
				candidate =>
					start < candidate.end && start + original.length > candidate.start
			)
		) {
			candidates.push({
				context: 'literal',
				end: start + original.length,
				start
			});
		}
		quoteStart = cursor + 1;
	}

	for (
		let match = literalAssetReferenceRegex.exec(source);
		match;
		match = literalAssetReferenceRegex.exec(source)
	) {
		const start = match.index;
		const end = start + match[0].length;

		if (
			!candidates.some(
				candidate => start < candidate.end && end > candidate.start
			) &&
			!quotedSpans.some(span => start < span.end && end > span.start)
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
		const path = localAssetReferencePath(original);

		if (!path || assetKindForPath(path) === 'file') {
			continue;
		}

		const fragmentStart = original.indexOf('#');
		const beforeFragment =
			fragmentStart === -1 ? original : original.slice(0, fragmentStart);
		const queryStart = beforeFragment.indexOf('?');

		references.push({
			context: candidate.context,
			end: candidate.end,
			fragment: fragmentStart === -1 ? null : original.slice(fragmentStart),
			kind: assetKindForPath(path),
			line,
			original,
			passageId,
			path,
			query: queryStart === -1 ? null : beforeFragment.slice(queryStart),
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
	newPath: string
) {
	const oldNormalized = normalizedAssetPath(oldPath);
	let output = source;

	for (const reference of assetReferencesInSource('', '', source, null)
		.filter(reference => normalizedAssetPath(reference.path) === oldNormalized)
		.sort((left, right) => right.start - left.start)) {
		output =
			output.slice(0, reference.start) +
			newPath +
			(reference.query ?? '') +
			(reference.fragment ?? '') +
			output.slice(reference.end);
	}

	return output;
}
