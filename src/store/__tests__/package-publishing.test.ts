import type {CoreAssetInventoryEntry} from '../../core';
import type {CoreProjectHost} from '../../test-util/core-project-host-runtime';
import type {NativeProjectPackageAssetPayloadBatch} from '../../electron/shared';
import {fakeStory} from '../../test-util';
import {
	materializeStoryPackageSnapshot,
	packageExportInputs
} from '../package-publishing';

function asset(
	path: string,
	props: Partial<CoreAssetInventoryEntry> = {}
): CoreAssetInventoryEntry {
	return {
		durationMs: null,
		exists: true,
		height: null,
		kind: 'image',
		missing: false,
		modifiedAt: null,
		normalizedPath: path,
		path,
		previewUrl: null,
		publish: {
			copy: true,
			outputPath: path,
			reason: 'Copy asset into published output'
		},
		referenceCount: 1,
		references: [],
		sizeBytes: 3,
		snippet: {
			label: 'Insert asset reference',
			mediaType: 'image',
			text: `<img src="${path}" alt="">`
		},
		thumbnailUrl: null,
		unused: false,
		width: null,
		...props
	};
}

function batch(
	props: Partial<NativeProjectPackageAssetPayloadBatch> = {}
): NativeProjectPackageAssetPayloadBatch {
	return {
		appliedLimits: {
			maxAssetFileBytes: 1024,
			maxAssetFileCount: 1000,
			maxAssetTotalBytes: 4096
		},
		excluded: [],
		failures: [],
		inventory: [],
		payloads: [],
		snapshot: {
			contentFingerprint: 'a'.repeat(64),
			generation: 4,
			inventoryFingerprint: 'b'.repeat(64),
			sessionInstanceId: 'session-1'
		},
		totalEncodedBytes: 0,
		totalSourceBytes: 0,
		...props
	};
}

function storySummary(storyId: string, revision: number) {
	return {
		assetCount: 1,
		characterCount: 4,
		diagnosticCount: 0,
		errorCount: 0,
		graph: {
			brokenLinks: 0,
			emptyPassages: 0,
			links: 0,
			orphanPassages: 0,
			passages: 1,
			resolvedLinks: 0,
			selfLinks: 0,
			taggedPassages: 0,
			unreachablePassages: 0
		},
		missingAssetCount: 0,
		passageCount: 1,
		revision,
		storyId,
		tagCount: 0,
		warningCount: 0,
		wordCount: 1
	};
}

function packageHost(
	story: ReturnType<typeof fakeStory>,
	revision: number,
	inventory: CoreAssetInventoryEntry[]
) {
	return {
		queryAssetsPageAsync: jest.fn(async () => ({
			assets: inventory,
			nextCursor: null,
			revision,
			storyId: story.id,
			totalCount: inventory.length
		})),
		queryDocumentPageAsync: jest.fn(async () => ({
			documents: story.passages.map(passage => ({
				kind: 'passage',
				passageId: passage.id,
				text: passage.text
			})),
			nextCursor: null,
			revision,
			storyId: story.id,
			totalCount: story.passages.length
		})),
		queryStorySummaryAsync: jest.fn(async () =>
			storySummary(story.id, revision)
		),
		sessionStatus: () => ({revision})
	} as unknown as CoreProjectHost;
}

describe('asset-complete package publishing', () => {
	it('creates a bounded empty asset snapshot for an explicitly web-local story', async () => {
		const story = fakeStory(1);
		const snapshot = await materializeStoryPackageSnapshot(
			packageHost(story, 1, []),
			story.id,
			() => ({revision: 1, story}),
			{storageAuthority: 'web-local'}
		);

		expect(snapshot.assetBatch).toMatchObject({
			appliedLimits: {
				maxAssetFileBytes: 0,
				maxAssetFileCount: 0,
				maxAssetTotalBytes: 0
			},
			inventory: [],
			payloads: [],
			totalSourceBytes: 0
		});
		expect(snapshot.assetBatch.snapshot.contentFingerprint).toMatch(
			/^[a-f0-9]{64}$/
		);
		expect(
			packageExportInputs([], snapshot.assetBatch, 1).packageSnapshot
		).toEqual(expect.objectContaining({source: 'browser-story-session'}));
	});

	it('requires the desktop reader when Core reports managed assets', async () => {
		const story = fakeStory(1);

		await expect(
			materializeStoryPackageSnapshot(
				packageHost(story, 1, [asset('assets/data.bin', {kind: 'file'})]),
				story.id,
				() => ({revision: 1, story}),
				{storageAuthority: 'web-local'}
			)
		).rejects.toThrow('file-backed desktop project');
	});

	it.each(['native-project', 'unknown'] as const)(
		'requires the desktop reader for an empty %s story inventory',
		async storageAuthority => {
			const story = fakeStory(1);

			await expect(
				materializeStoryPackageSnapshot(
					packageHost(story, 1, []),
					story.id,
					() => ({revision: 1, story}),
					{storageAuthority}
				)
			).rejects.toThrow('file-backed desktop project');
		}
	);

	it('retries the complete story and native asset snapshot together once', async () => {
		const story = fakeStory(1);
		let revision = 1;
		const inventory = [asset('assets/cover.png')];
		const host = {
			queryAssetsPageAsync: jest.fn(async () => ({
				assets: inventory,
				nextCursor: null,
				revision,
				storyId: story.id,
				totalCount: inventory.length
			})),
			queryDocumentPageAsync: jest.fn(async () => ({
				documents: [
					{
						kind: 'passage',
						passageId: story.passages[0].id,
						text: `revision ${revision}`
					}
				],
				nextCursor: null,
				revision,
				storyId: story.id,
				totalCount: 1
			})),
			queryStorySummaryAsync: jest.fn(async () =>
				storySummary(story.id, revision)
			),
			sessionStatus: () => ({revision})
		} as unknown as CoreProjectHost;
		const readAssets = jest
			.fn<Promise<NativeProjectPackageAssetPayloadBatch>, [string[]]>()
			.mockImplementationOnce(async () => {
				revision = 2;
				throw Object.assign(new Error('changed'), {
					code: 'PACKAGE_ASSET_SNAPSHOT_STALE'
				});
			})
			.mockResolvedValue(batch());

		await expect(
			materializeStoryPackageSnapshot(
				host,
				story.id,
				() => ({revision, story}),
				{readPackageAssets: readAssets, storageAuthority: 'native-project'}
			)
		).resolves.toMatchObject({
			revision: 2,
			story: {
				passages: [expect.objectContaining({text: 'revision 2'})]
			}
		});
		expect(readAssets).toHaveBeenCalledTimes(2);
		expect(readAssets).toHaveBeenLastCalledWith(['assets/cover.png']);
	});

	it('preserves canonical hash and percent paths when prioritizing package reads', async () => {
		const story = fakeStory(1);
		const inventory = [asset('assets/a#b.png'), asset('assets/a%2Fb.png')];
		const readAssets = jest.fn(async () => batch());

		await materializeStoryPackageSnapshot(
			packageHost(story, 1, inventory),
			story.id,
			() => ({revision: 1, story}),
			{readPackageAssets: readAssets, storageAuthority: 'native-project'}
		);

		expect(readAssets).toHaveBeenCalledWith([
			'assets/a#b.png',
			'assets/a%2Fb.png'
		]);
	});

	it('retries a successful native response containing a per-file race failure', async () => {
		const story = fakeStory(1);
		const revision = 1;
		const host = {
			queryAssetsPageAsync: jest.fn(async () => ({
				assets: [],
				nextCursor: null,
				revision,
				storyId: story.id,
				totalCount: 0
			})),
			queryDocumentPageAsync: jest.fn(async () => ({
				documents: [
					{
						kind: 'passage',
						passageId: story.passages[0].id,
						text: story.passages[0].text
					}
				],
				nextCursor: null,
				revision,
				storyId: story.id,
				totalCount: 1
			})),
			queryStorySummaryAsync: jest.fn(async () =>
				storySummary(story.id, revision)
			),
			sessionStatus: () => ({revision})
		} as unknown as CoreProjectHost;
		const changedBatch = batch({
			failures: [
				{
					message: 'Asset changed during the read.',
					path: 'assets/racing.png',
					reason: 'changed-since-index'
				}
			]
		});
		const readAssets = jest
			.fn<Promise<NativeProjectPackageAssetPayloadBatch>, [string[]]>()
			.mockResolvedValueOnce(changedBatch)
			.mockResolvedValueOnce(batch());

		await expect(
			materializeStoryPackageSnapshot(
				host,
				story.id,
				() => ({revision, story}),
				{readPackageAssets: readAssets, storageAuthority: 'native-project'}
			)
		).resolves.toMatchObject({revision});
		expect(readAssets).toHaveBeenCalledTimes(2);

		readAssets.mockReset().mockResolvedValue(changedBatch);
		await expect(
			materializeStoryPackageSnapshot(
				host,
				story.id,
				() => ({revision, story}),
				{readPackageAssets: readAssets, storageAuthority: 'native-project'}
			)
		).rejects.toThrow('changed while package assets were read');
		expect(readAssets).toHaveBeenCalledTimes(2);
	});

	it('maps physical files separately from exclusions and inventory failures', () => {
		const bytes = new Uint8Array([0, 1, 2]);
		const result = packageExportInputs(
			[asset('assets/cover.png'), asset('assets/missing.mp3', {kind: 'audio'})],
			batch({
				excluded: [{path: 'assets/.DS_Store', reason: 'platform-junk'}],
				failures: [
					{
						message: 'A symlink is not a regular project asset.',
						path: 'assets/link.png',
						reason: 'symlink'
					}
				],
				inventory: [
					{
						modifiedAtMs: 1,
						path: 'assets/cover.png',
						requiredByStaticReference: true,
						sizeBytes: bytes.length
					}
				],
				payloads: [
					{
						bytes,
						encodedSizeBytes: 4,
						mediaType: 'image/png',
						path: 'assets/cover.png',
						sha256: 'c'.repeat(64),
						sizeBytes: bytes.length
					},
					{
						bytes,
						encodedSizeBytes: 4,
						mediaType: 'application/octet-stream',
						path: 'assets/unexpected.bin',
						sha256: 'd'.repeat(64),
						sizeBytes: bytes.length
					}
				]
			}),
			8
		);

		expect(result.packageAssets).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					logicalPath: 'assets/cover.png',
					status: 'included'
				}),
				expect.objectContaining({
					logicalPath: 'assets/.DS_Store',
					reasonCode: 'excluded',
					status: 'failed'
				}),
				expect.objectContaining({
					logicalPath: 'assets/missing.mp3',
					reasonCode: 'missing',
					status: 'failed'
				})
			])
		);
		expect(result.packageInventoryIssues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path: 'assets/link.png',
					reasonCode: 'symlink'
				}),
				expect.objectContaining({
					path: 'assets/unexpected.bin',
					reasonCode: 'unexpected-payload'
				})
			])
		);
		expect(result.packageCompleteness.projectAssetBytes).toBe('incomplete');
		expect(result.packageSnapshot).toMatchObject({
			generation: 4,
			revision: 8,
			sessionInstanceId: 'session-1'
		});
	});

	it('keeps project byte completeness when the only omissions are platform junk', () => {
		const result = packageExportInputs(
			[],
			batch({
				excluded: [{path: 'assets/.DS_Store', reason: 'platform-junk'}]
			}),
			1
		);

		expect(result.packageCompleteness.projectAssetBytes).toBe('complete');
	});

	it('marks a referenced platform-junk exclusion incomplete', () => {
		const result = packageExportInputs(
			[asset('assets/._cover.png')],
			batch({
				excluded: [{path: 'assets/._cover.png', reason: 'platform-junk'}]
			}),
			1
		);

		expect(result.packageAssets).toContainEqual(
			expect.objectContaining({
				logicalPath: 'assets/._cover.png',
				requiredByStaticReference: true
			})
		);
		expect(result.packageCompleteness.projectAssetBytes).toBe('incomplete');
	});

	it('retains the full Core reference bit beyond native priority truncation', () => {
		const result = packageExportInputs(
			[asset('assets/deferred.png')],
			batch({
				failures: [
					{
						message: 'The package file-count limit was reached.',
						path: 'assets/deferred.png',
						reason: 'file-count-exceeded'
					}
				],
				inventory: [
					{
						modifiedAtMs: 1,
						path: 'assets/deferred.png',
						requiredByStaticReference: false,
						sizeBytes: 3
					}
				]
			}),
			1
		);

		expect(result.packageAssets).toContainEqual(
			expect.objectContaining({
				logicalPath: 'assets/deferred.png',
				reasonCode: 'file-count-exceeded',
				requiredByStaticReference: true,
				status: 'failed'
			})
		);
	});

	it('preserves canonical hash and literal-percent inventory identities', () => {
		const bytes = new Uint8Array([1, 2, 3]);
		const paths = ['assets/a#b.png', 'assets/a%2Fb.png'];
		const result = packageExportInputs(
			paths.map(path => asset(path)),
			batch({
				inventory: paths.map(path => ({
					modifiedAtMs: 1,
					path,
					requiredByStaticReference: false,
					sizeBytes: bytes.length
				})),
				payloads: paths.map((path, index) => ({
					bytes,
					encodedSizeBytes: 4,
					mediaType: 'image/png',
					path,
					sha256: `${index + 1}`.repeat(64),
					sizeBytes: bytes.length
				}))
			}),
			1
		);

		expect(result.packageAssets).toEqual(
			paths.map(path =>
				expect.objectContaining({
					archivePath: path,
					logicalPath: path,
					requiredByStaticReference: true,
					status: 'included'
				})
			)
		);
	});
});
