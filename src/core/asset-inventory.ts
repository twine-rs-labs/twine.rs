import type {CoreAssetInventoryEntry} from './bindings/CoreAssetInventoryEntry';
import {normalizedAssetPath} from './asset-paths';

function assetInventoryKey(asset: CoreAssetInventoryEntry) {
	return normalizedAssetPath(asset.normalizedPath || asset.path);
}

function mergeAssetInventoryEntry(
	indexed: CoreAssetInventoryEntry,
	known: CoreAssetInventoryEntry
) {
	const references = indexed.references;
	const referenceCount = Math.max(references.length, indexed.referenceCount);
	const exists = known.exists ?? indexed.exists;
	const missing = exists === false && referenceCount > 0;
	const unused = exists === true && referenceCount === 0;
	const publish = known.publish.outputPath ? known.publish : indexed.publish;

	return {
		...indexed,
		...known,
		durationMs: known.durationMs ?? indexed.durationMs,
		exists,
		height: known.height ?? indexed.height,
		missing,
		modifiedAt: known.modifiedAt ?? indexed.modifiedAt,
		normalizedPath: assetInventoryKey(known),
		previewUrl: known.previewUrl ?? indexed.previewUrl,
		publish: missing
			? {
					...publish,
					copy: false,
					reason: 'Referenced file is missing'
				}
			: publish,
		referenceCount,
		references,
		sizeBytes: known.sizeBytes ?? indexed.sizeBytes,
		snippet: known.snippet.text ? known.snippet : indexed.snippet,
		thumbnailUrl: known.thumbnailUrl ?? indexed.thumbnailUrl,
		unused,
		width: known.width ?? indexed.width
	} satisfies CoreAssetInventoryEntry;
}

/**
 * Adds filesystem metadata from the known/native inventory to Rust-indexed
 * entries without losing references discovered from story source.
 */
export function mergeKnownAssetInventory(
	indexedAssets: CoreAssetInventoryEntry[],
	knownAssets: CoreAssetInventoryEntry[],
	options: {includeUnindexed?: boolean} = {}
) {
	if (knownAssets.length === 0) {
		return indexedAssets;
	}

	const knownByPath = new Map(
		knownAssets.map(asset => [assetInventoryKey(asset), asset])
	);
	const merged = indexedAssets.map(asset => {
		const key = assetInventoryKey(asset);
		const known = knownByPath.get(key);

		if (!known) {
			return asset;
		}

		knownByPath.delete(key);
		return mergeAssetInventoryEntry(asset, known);
	});

	if (options.includeUnindexed) {
		merged.push(...knownByPath.values());
	}

	return merged;
}
