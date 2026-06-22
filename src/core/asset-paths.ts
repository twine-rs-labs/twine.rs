import type {CoreAssetReference} from './bindings/CoreAssetReference';
import type {CoreAssetSnippet} from './bindings/CoreAssetSnippet';

const assetReferenceRegex =
	/([A-Za-z0-9_./~%:@?&=+-]+\.(png|jpe?g|gif|svg|webp|mp3|m4a|ogg|wav|mp4|webm|css|js))/gi;
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
	const normalized = path.replace(/\\/g, '/').replace(/^(\.\/)+/, '');

	if (protocolRegex.test(normalized) || normalized.startsWith('//')) {
		return null;
	}

	const segments = normalized.split('/').filter(segment => segment.length > 0);
	const assetsIndex = segments.findIndex(
		segment => segment.toLowerCase() === 'assets'
	);
	const assetSegments =
		assetsIndex === -1 ? segments : segments.slice(assetsIndex + 1);

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
	).toLowerCase();
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
	const assets: CoreAssetReference[] = [];

	for (
		let match = assetReferenceRegex.exec(source);
		match;
		match = assetReferenceRegex.exec(source)
	) {
		const path = localAssetReferencePath(match[0]);

		if (!path) {
			continue;
		}

		assets.push({
			end: match.index + match[0].length,
			kind: assetKindForPath(path),
			line: lineNumberAt(source, match.index),
			passageId,
			path,
			sourceId,
			sourceName,
			start: match.index
		});
	}

	return assets;
}

export function replaceAssetReferencesInSource(
	source: string,
	oldPath: string,
	newPath: string
) {
	const oldNormalized = normalizedAssetPath(oldPath);

	return source.replace(assetReferenceRegex, match =>
		normalizedAssetPath(match) === oldNormalized ? newPath : match
	);
}
