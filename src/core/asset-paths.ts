import type {CoreAssetReference} from './bindings/CoreAssetReference';
import type {CoreAssetSnippet} from './bindings/CoreAssetSnippet';

const literalAssetReferenceRegex =
	/[^\s"'<>(),;=:#?]+\.(png|jpe?g|gif|svg|webp|mp3|m4a|ogg|wav|mp4|webm|css|js)(?:\?[^\s"'<>(),;#]*)?(?:#[^\s"'<>(),;]*)?/gi;
const protocolRegex = /^[A-Za-z][A-Za-z0-9+.-]*:/;

function lineNumberAt(source: string, start: number) {
	return source.slice(0, start).split(/\r?\n/).length;
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
			(quote === "'" &&
				/[\p{L}\p{N}_]/u.test(source.slice(0, quoteStart).at(-1) ?? ''))
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

	return candidates
		.sort((left, right) => left.start - right.start || left.end - right.end)
		.flatMap(candidate => {
			const original = source.slice(candidate.start, candidate.end);
			const path = localAssetReferencePath(original);

			if (!path || assetKindForPath(path) === 'file') {
				return [];
			}

			const fragmentStart = original.indexOf('#');
			const beforeFragment =
				fragmentStart === -1 ? original : original.slice(0, fragmentStart);
			const queryStart = beforeFragment.indexOf('?');

			return [
				{
					context: candidate.context,
					end: candidate.end,
					fragment: fragmentStart === -1 ? null : original.slice(fragmentStart),
					kind: assetKindForPath(path),
					line: lineNumberAt(source, candidate.start),
					original,
					passageId,
					path,
					query: queryStart === -1 ? null : beforeFragment.slice(queryStart),
					sourceId,
					sourceName,
					start: candidate.start
				}
			];
		});
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
