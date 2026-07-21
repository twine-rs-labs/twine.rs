import type {CoreAssetInventoryEntry} from '../../core/bindings/CoreAssetInventoryEntry';
import {fakeStory} from '../../test-util';
import {
	externalAssetEmbeddingReport,
	inlineReferencedAssets
} from '../inline-assets';

function asset(
	path: string,
	passageId: string,
	start: number,
	end: number,
	original = path
): CoreAssetInventoryEntry {
	return {
		durationMs: null,
		exists: true,
		height: null,
		kind: 'image',
		missing: false,
		modifiedAt: null,
		normalizedPath: path.toLowerCase(),
		path,
		previewUrl: null,
		publish: {copy: true, outputPath: path, reason: 'Referenced media'},
		referenceCount: 1,
		references: [
			{
				context: 'html-src',
				end,
				fragment: null,
				kind: 'image',
				line: 1,
				original,
				passageId,
				path,
				query: null,
				sourceId: passageId,
				sourceName: 'Start',
				start
			}
		],
		sizeBytes: 3,
		snippet: {label: '', mediaType: 'image', text: ''},
		thumbnailUrl: null,
		unused: false,
		width: null
	} as CoreAssetInventoryEntry;
}

describe('inlineReferencedAssets', () => {
	it('replaces exact ranges from right to left without mutating source', () => {
		const story = fakeStory();
		const source = '<img src="assets/a.png"> <img src="assets/a.png?cache=1">';
		const first = source.indexOf('assets/a.png');
		const second = source.indexOf('assets/a.png?cache=1');

		story.passages[0].text = source;
		const entry = asset(
			'assets/a.png',
			story.passages[0].id,
			first,
			first + 'assets/a.png'.length
		);
		entry.referenceCount = 2;
		entry.references.push({
			...entry.references[0],
			end: second + 'assets/a.png?cache=1'.length,
			original: 'assets/a.png?cache=1',
			query: '?cache=1',
			start: second
		} as (typeof entry.references)[number]);

		const result = inlineReferencedAssets({
			assetInventory: [entry],
			payloads: [
				{
					bytes: new Uint8Array([0, 1, 255]),
					mediaType: 'image/png',
					path: 'assets/a.png'
				}
			],
			story
		});

		expect(story.passages[0].text).toBe(source);
		expect(result.story.passages[0].text).toBe(
			'<img src="data:image/png;base64,AAH/"> <img src="data:image/png;base64,AAH/">'
		);
		expect(result.report).toEqual(
			expect.objectContaining({
				assetInliningComplete: true,
				externalAssetCount: 0,
				inlinedAssetCount: 1,
				inlinedEncodedBytes: 52,
				inlinedReferenceCount: 2,
				inlinedSourceBytes: 3
			})
		);
	});

	it('reports missing, unsupported, fragment, and stale-range references', () => {
		const story = fakeStory();
		const path = 'assets/a.png';

		story.passages[0].text = path;
		const fragment = asset(path, story.passages[0].id, 0, path.length);
		Object.assign(fragment.references[0], {fragment: '#icon'});

		const fragmentResult = inlineReferencedAssets({
			assetInventory: [fragment],
			payloads: [{bytes: new Uint8Array(), mediaType: 'image/png', path}],
			story
		});

		expect(fragmentResult.story.passages[0].text).toBe(path);
		expect(fragmentResult.report.assetInliningComplete).toBe(false);
		expect(fragmentResult.report.unresolvedAssets[0].reason).toMatch(
			/fragments/
		);

		const unsupported = inlineReferencedAssets({
			assetInventory: [fragment],
			failures: [{path, reason: 'Unsupported extension.', type: 'unsupported'}],
			payloads: [],
			story
		});

		expect(unsupported.report.unsupportedAssets).toEqual([
			{path, reason: 'Unsupported extension.'}
		]);
	});

	it('rejects overlapping ranges without counting rejected payload bytes', () => {
		const story = fakeStory();
		const source = 'assets/a.png';
		const accepted = asset(
			'assets/a.png',
			story.passages[0].id,
			0,
			source.length
		);
		const overlapping = asset(
			'assets/b.png',
			story.passages[0].id,
			0,
			source.length,
			source
		);

		story.passages[0].text = source;
		const result = inlineReferencedAssets({
			assetInventory: [accepted, overlapping],
			payloads: [
				{
					bytes: new Uint8Array([1]),
					mediaType: 'image/png',
					path: accepted.path
				},
				{
					bytes: new Uint8Array([2, 3]),
					mediaType: 'image/png',
					path: overlapping.path
				}
			],
			story
		});

		expect(result.story.passages[0].text).toBe('data:image/png;base64,AQ==');
		expect(result.report).toEqual(
			expect.objectContaining({
				assetInliningComplete: false,
				externalAssetCount: 1,
				inlinedAssetCount: 1,
				inlinedEncodedBytes: 26,
				inlinedReferenceCount: 1,
				inlinedSourceBytes: 1
			})
		);
		expect(result.report.unresolvedAssets[0].reason).toMatch(/Overlapping/);
	});

	it('uses UTF-16 ranges for story script and stylesheet documents', () => {
		const story = fakeStory();
		const path = 'assets/a.png';
		const source = `const face = "😀 ${path}";`;
		const start = source.indexOf(path);
		const scriptAsset = asset(
			path,
			story.passages[0].id,
			start,
			start + path.length
		);

		story.script = source;
		Object.assign(scriptAsset.references[0], {
			passageId: null,
			sourceId: `${story.id}:script`,
			sourceName: 'Story JavaScript'
		});

		const result = inlineReferencedAssets({
			assetInventory: [scriptAsset],
			payloads: [{bytes: new Uint8Array(), mediaType: 'image/png', path}],
			story
		});

		expect(result.story.script).toBe(
			'const face = "😀 data:image/png;base64,";'
		);
		expect(story.script).toBe(source);
	});

	it('reports external mode truthfully', () => {
		const story = fakeStory();
		const entry = asset('assets/a.png', story.passages[0].id, 0, 0);

		expect(externalAssetEmbeddingReport([entry])).toEqual(
			expect.objectContaining({
				assetInliningComplete: false,
				externalAssetCount: 1,
				inlinedAssetCount: 0
			})
		);
	});
});
