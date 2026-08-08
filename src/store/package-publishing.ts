import type {
	CoreAssetInventoryEntry,
	CoreAssetsPage,
	CoreStorySummary
} from '../core';
import {canonicalLogicalAssetPath} from '../core/asset-paths';
import {materializeStorySnapshotFromSession} from '../core/materialize-story';
import type {CoreProjectHost} from '../core/project-host';
import type {
	NativeProjectAssetPayloadFailure,
	NativeProjectPackageAssetPayloadBatch
} from '../electron/shared';
import {
	type PackageExportAsset,
	type PackageExportAssetFailureReason,
	type PackageExportCompleteness,
	type PackageExportInventoryIssue,
	type PackageExportLimits,
	type PackageExportSnapshot
} from '../util/package-export';
import type {Story, StoryWithDocuments} from './stories';

export interface RevisionedPackageStoryMetadata {
	revision: number;
	story: Story;
}

export interface StoryPackageSnapshot {
	assetBatch: NativeProjectPackageAssetPayloadBatch;
	assetInventory: CoreAssetInventoryEntry[];
	revision: number;
	story: StoryWithDocuments;
	summary: CoreStorySummary;
}

export interface PackageExportInputs {
	packageAssets: PackageExportAsset[];
	packageCompleteness: PackageExportCompleteness;
	packageInventoryIssues: PackageExportInventoryIssue[];
	packageLimits: PackageExportLimits;
	packageSnapshot: PackageExportSnapshot;
}

export interface MaterializeStoryPackageSnapshotOptions {
	readPackageAssets?: (
		priorityPaths: string[]
	) => Promise<NativeProjectPackageAssetPayloadBatch>;
	storageAuthority: 'native-project' | 'unknown' | 'web-local';
}

const packagePriorityPathLimit = 1000;
const packageCoreInventoryLimit = 10000;
const packageGeneratedByteLimit = 50 * 1024 * 1024;
const packageZipByteLimit = 128 * 1024 * 1024;
const emptyPackageAssetFingerprint =
	'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function bytewiseCompare(left: string, right: string) {
	const leftBytes = new TextEncoder().encode(left);
	const rightBytes = new TextEncoder().encode(right);
	const length = Math.min(leftBytes.length, rightBytes.length);

	for (let index = 0; index < length; index++) {
		if (leftBytes[index] !== rightBytes[index]) {
			return leftBytes[index] - rightBytes[index];
		}
	}

	return leftBytes.length - rightBytes.length;
}

function stalePackageSnapshotError(error: unknown) {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		error.code === 'PACKAGE_ASSET_SNAPSHOT_STALE'
	);
}

function stalePackageAssetBatch(batch: NativeProjectPackageAssetPayloadBatch) {
	return batch.failures.some(
		failure =>
			failure.reason === 'session-stale' || failure.reason.includes('changed')
	);
}

export async function assetInventoryForStoryRevision(
	host: CoreProjectHost,
	storyId: string,
	expectedRevision: number
) {
	const inventory: CoreAssetInventoryEntry[] = [];
	const cursors = new Set<string>();
	let cursor: string | null = null;

	do {
		const page: CoreAssetsPage = await host.queryAssetsPageAsync(storyId, {
			cursor,
			limit: 250
		});

		if (page.storyId !== storyId || page.revision !== expectedRevision) {
			throw Object.assign(
				new Error('Core asset inventory changed during package preparation.'),
				{code: 'PACKAGE_STORY_SNAPSHOT_STALE'}
			);
		}
		inventory.push(...page.assets);
		if (inventory.length > packageCoreInventoryLimit) {
			throw new Error(
				`Core asset inventory exceeds the ${packageCoreInventoryLimit}-entry package limit.`
			);
		}
		if (page.nextCursor && cursors.has(page.nextCursor)) {
			throw new Error('Core asset inventory returned a repeated cursor.');
		}
		if (page.nextCursor) cursors.add(page.nextCursor);
		cursor = page.nextCursor;
	} while (cursor);

	return inventory;
}

function priorityPaths(inventory: CoreAssetInventoryEntry[]) {
	return [
		...new Set(
			inventory
				.filter(asset => asset.referenceCount > 0)
				.map(asset => canonicalLogicalAssetPath(asset.path))
				.filter((path): path is string => path !== null)
		)
	]
		.sort(bytewiseCompare)
		.slice(0, packagePriorityPathLimit);
}

/**
 * Captures story documents, their exact asset index revision, and native asset
 * bytes as one retryable package snapshot.
 */
export async function materializeStoryPackageSnapshot(
	host: CoreProjectHost,
	storyId: string,
	currentMetadata: () => RevisionedPackageStoryMetadata,
	{readPackageAssets, storageAuthority}: MaterializeStoryPackageSnapshotOptions
): Promise<StoryPackageSnapshot> {
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			const metadata = currentMetadata();
			const snapshot = await materializeStorySnapshotFromSession(
				host,
				metadata.story
			);
			const summary = await host.queryStorySummaryAsync(storyId);
			const inventory = await assetInventoryForStoryRevision(
				host,
				storyId,
				metadata.revision
			);
			const beforeRead = currentMetadata();

			if (
				snapshot.revision !== metadata.revision ||
				summary.revision !== metadata.revision ||
				host.sessionStatus(storyId).revision !== metadata.revision ||
				beforeRead.revision !== metadata.revision ||
				beforeRead.story !== metadata.story
			) {
				throw Object.assign(
					new Error('The story changed before package assets were read.'),
					{code: 'PACKAGE_STORY_SNAPSHOT_STALE'}
				);
			}

			let assetBatch: NativeProjectPackageAssetPayloadBatch;

			if (readPackageAssets) {
				assetBatch = await readPackageAssets(priorityPaths(inventory));
			} else {
				if (inventory.length > 0 || storageAuthority !== 'web-local') {
					throw new Error(
						'Asset-complete Package export requires a file-backed desktop project when managed project assets are present or referenced.'
					);
				}
				assetBatch = {
					appliedLimits: {
						maxAssetFileBytes: 0,
						maxAssetFileCount: 0,
						maxAssetTotalBytes: 0
					},
					excluded: [],
					failures: [],
					inventory: [],
					payloads: [],
					snapshot: {
						contentFingerprint: emptyPackageAssetFingerprint,
						generation: metadata.revision,
						inventoryFingerprint: emptyPackageAssetFingerprint,
						sessionInstanceId: `browser-story:${storyId}`
					},
					totalEncodedBytes: 0,
					totalSourceBytes: 0
				};
			}
			const afterRead = currentMetadata();

			if (
				stalePackageAssetBatch(assetBatch) ||
				host.sessionStatus(storyId).revision !== metadata.revision ||
				afterRead.revision !== metadata.revision ||
				afterRead.story !== metadata.story
			) {
				throw Object.assign(
					new Error('The story changed while package assets were read.'),
					{code: 'PACKAGE_STORY_SNAPSHOT_STALE'}
				);
			}

			return {
				assetBatch,
				assetInventory: inventory,
				revision: metadata.revision,
				story: snapshot.story,
				summary
			};
		} catch (error) {
			if (
				attempt === 1 ||
				(!stalePackageSnapshotError(error) &&
					!(
						(error as {code?: unknown})?.code === 'PACKAGE_STORY_SNAPSHOT_STALE'
					))
			) {
				throw error;
			}
		}
	}

	throw new Error(
		'The story or project assets changed during package preparation.'
	);
}

function packageFailureReason(reason: string): PackageExportAssetFailureReason {
	if (reason === 'file-count-exceeded') return 'file-count-exceeded';
	if (reason === 'file-too-large') return 'file-too-large';
	if (reason === 'total-limit-exceeded') return 'total-limit-exceeded';
	if (reason === 'missing') return 'missing';
	if (reason.includes('changed')) return 'changed';
	if (reason === 'invalid-path') return 'invalid-path';
	if (reason.includes('symlink')) return 'symlink-escape';
	if (reason.includes('security')) return 'security';
	if (reason.includes('not-file') || reason.includes('unsupported')) {
		return 'not-file';
	}

	return 'unreadable';
}

function failureByPath(failures: NativeProjectAssetPayloadFailure[]) {
	const result = new Map<string, NativeProjectAssetPayloadFailure>();

	for (const failure of failures) {
		if (!result.has(failure.path)) result.set(failure.path, failure);
	}

	return result;
}

/** Maps the capability-bound native batch into the public Package v2 model. */
export function packageExportInputs(
	assetInventory: CoreAssetInventoryEntry[],
	batch: NativeProjectPackageAssetPayloadBatch,
	revision: number
): PackageExportInputs {
	const payloads = new Map(
		batch.payloads.map(payload => [payload.path, payload])
	);
	const failures = failureByPath(batch.failures);
	const referenced = new Map(
		assetInventory.map(asset => [
			canonicalLogicalAssetPath(asset.path) ?? asset.path,
			asset.referenceCount > 0
		])
	);
	const packageAssets: PackageExportAsset[] = [];
	const knownPaths = new Set<string>();
	const inventoryPaths = new Set(batch.inventory.map(entry => entry.path));
	const excludedPaths = new Set(batch.excluded.map(entry => entry.path));

	for (const entry of batch.inventory) {
		knownPaths.add(entry.path);
		const payload = payloads.get(entry.path);
		const failure = failures.get(entry.path);
		const requiredByStaticReference =
			entry.requiredByStaticReference || referenced.get(entry.path) === true;

		if (payload && !failure) {
			packageAssets.push({
				archivePath: entry.path,
				bytes: payload.bytes,
				logicalPath: entry.path,
				mediaType: payload.mediaType,
				requiredByStaticReference,
				sha256: payload.sha256,
				sizeBytes: payload.sizeBytes,
				status: 'included'
			});
		} else {
			packageAssets.push({
				logicalPath: entry.path,
				reasonCode: packageFailureReason(failure?.reason ?? 'unreadable'),
				reasonMessage:
					failure?.message ??
					'The package reader returned no bytes for this asset.',
				requiredByStaticReference,
				status: 'failed'
			});
		}
	}

	for (const excluded of batch.excluded) {
		knownPaths.add(excluded.path);
		packageAssets.push({
			logicalPath: excluded.path,
			reasonCode: 'excluded',
			reasonMessage: 'Known platform metadata is excluded from packages.',
			requiredByStaticReference: referenced.get(excluded.path) ?? false,
			status: 'failed'
		});
	}

	for (const asset of assetInventory) {
		if (asset.referenceCount === 0) continue;
		const path = canonicalLogicalAssetPath(asset.path);

		if (!path || knownPaths.has(path)) continue;
		knownPaths.add(path);
		packageAssets.push({
			logicalPath: path,
			reasonCode: 'missing',
			reasonMessage: 'A statically referenced project asset was not found.',
			requiredByStaticReference: true,
			status: 'failed'
		});
	}

	const inventoryIssues = batch.failures
		.filter(failure => !inventoryPaths.has(failure.path))
		.filter(failure => !excludedPaths.has(failure.path))
		.map(failure => ({
			path: failure.path,
			reasonCode: failure.reason,
			reasonMessage: failure.message
		}));

	for (const payload of batch.payloads) {
		if (!inventoryPaths.has(payload.path)) {
			inventoryIssues.push({
				path: payload.path,
				reasonCode: 'unexpected-payload',
				reasonMessage:
					'The package reader returned bytes for a path outside its captured inventory.'
			});
		}
	}
	const failedInScope = packageAssets.some(
		asset =>
			asset.status === 'failed' &&
			(asset.reasonCode !== 'excluded' || asset.requiredByStaticReference)
	);

	return {
		packageAssets,
		packageCompleteness: {
			copiedAssetContents: 'not-evaluated',
			dynamicDependencies: 'not-evaluated',
			projectAssetBytes:
				failedInScope || inventoryIssues.length > 0 ? 'incomplete' : 'complete',
			staticRuntimeDependencies: 'unknown'
		},
		packageInventoryIssues: inventoryIssues,
		packageLimits: {
			maxAssetFileBytes: batch.appliedLimits.maxAssetFileBytes,
			maxAssetFileCount: batch.appliedLimits.maxAssetFileCount,
			maxAssetTotalBytes: batch.appliedLimits.maxAssetTotalBytes,
			maxComponentBytes: 255,
			maxEntryCount: batch.appliedLimits.maxAssetFileCount + 5,
			maxGeneratedBytes: packageGeneratedByteLimit,
			maxPathBytes: 240,
			maxZipBytes: packageZipByteLimit
		},
		packageSnapshot: {
			contentFingerprint: batch.snapshot.contentFingerprint,
			generation: batch.snapshot.generation,
			id: batch.snapshot.contentFingerprint,
			inventoryFingerprint: batch.snapshot.inventoryFingerprint,
			revision,
			sessionInstanceId: batch.snapshot.sessionInstanceId,
			source: batch.snapshot.sessionInstanceId.startsWith('browser-story:')
				? 'browser-story-session'
				: 'desktop-project-session'
		}
	};
}
