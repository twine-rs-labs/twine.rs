import {
	copyAssetSnippetCommand,
	deleteAssetCommand,
	importAssetCommand,
	insertAssetSnippetCommand,
	mergeKnownAssetInventory,
	renameAssetCommand,
	replaceAssetCommand,
	revealAssetCommand,
	validateAssetReferencesCommand
} from '../index';
import {storyToCoreIndex} from '../story-index';
import {assetManagerViewModel} from '../view-models';
import {
	assetReferencesInSource,
	boundedReferencedMediaPathsInSource,
	compareAssetPaths,
	normalizedAssetPath
} from '../asset-paths';
import {fakePassage, fakeStory} from '../../test-util';

describe('asset M5 contract', () => {
	it('orders asset paths by Unicode scalar value without locale dependence', () => {
		expect(
			['assets/\u{10000}.png', 'assets/\uE000.png', 'assets/a.png'].sort(
				compareAssetPaths
			)
		).toEqual(['assets/a.png', 'assets/\uE000.png', 'assets/\u{10000}.png']);
	});
	it('keeps bounded media candidates in parity with complete full parsing', () => {
		const source = [
			'<img src="assets/z.png">',
			'<audio srcset="assets/b.ogg 1x, assets/a.mp3 2x">',
			'body { background: url("assets/c.webp") }',
			'const media = "assets/d.webm";',
			'<link href="assets/style.css">'
		].join('\n');
		const fullPaths = [
			...new Set(
				assetReferencesInSource('source', 'Source', source, null)
					.filter(reference =>
						['image', 'audio', 'video'].includes(reference.kind)
					)
					.map(reference => normalizedAssetPath(reference.path))
			)
		].sort(compareAssetPaths);

		expect(boundedReferencedMediaPathsInSource(source)).toEqual({
			complete: true,
			paths: fullPaths
		});
	});
	it('uses the no-media fast path without missing encoded media suffixes', () => {
		expect(
			boundedReferencedMediaPathsInSource(
				'Ordinary prose. const note = "archive.txt"; no local media here.'
			)
		).toEqual({complete: true, paths: []});
		expect(
			boundedReferencedMediaPathsInSource('const image = "assets/cover%2Epng";')
		).toEqual({complete: true, paths: ['assets/cover.png']});
		expect(
			boundedReferencedMediaPathsInSource(
				'const audio = "assets/theme.%6D%70%33";'
			)
		).toEqual({complete: true, paths: ['assets/theme.mp3']});
	});
	it('fails bounded scanning closed for dense and oversized sources', () => {
		expect(
			boundedReferencedMediaPathsInSource(
				Array.from(
					{length: 129},
					(_, index) => `<img src="assets/${index}.png">`
				).join('')
			).complete
		).toBe(false);
		expect(
			boundedReferencedMediaPathsInSource('x'.repeat(1024 * 1024 + 1))
		).toEqual({complete: false, paths: []});
	});
	it('fails bounded scanning closed for oversized paths and dense srcsets', () => {
		const exactAsciiPath = `assets/${'a'.repeat(4085)}.png`;
		const oversizedAsciiPath = `assets/${'a'.repeat(4086)}.png`;
		const exactMultibytePath = `assets/a${'é'.repeat(2042)}.png`;
		const oversizedMultibytePath = `assets/aa${'é'.repeat(2042)}.png`;

		expect(
			boundedReferencedMediaPathsInSource(`<img src="${exactAsciiPath}">`)
		).toEqual({complete: true, paths: [exactAsciiPath]});
		expect(
			boundedReferencedMediaPathsInSource(`<img src="${oversizedAsciiPath}">`)
		).toEqual({complete: false, paths: []});
		expect(
			boundedReferencedMediaPathsInSource(`<img src="${exactMultibytePath}">`)
		).toEqual({complete: true, paths: [exactMultibytePath]});
		expect(
			boundedReferencedMediaPathsInSource(
				`<img src="${oversizedMultibytePath}">`
			)
		).toEqual({complete: false, paths: []});
		expect(
			boundedReferencedMediaPathsInSource(
				`const blob = "${'x'.repeat(4097)}";<img src="assets/a.png">`
			)
		).toEqual({complete: true, paths: ['assets/a.png']});
		expect(
			boundedReferencedMediaPathsInSource(
				`const media = "assets/${'x'.repeat(4086)}%2Epng";`
			)
		).toEqual({complete: false, paths: []});
		expect(
			boundedReferencedMediaPathsInSource(
				`<img srcset="${','.repeat(16_384)}assets/last.png">`
			)
		).toEqual({complete: true, paths: ['assets/last.png']});
		expect(
			boundedReferencedMediaPathsInSource(
				`<img srcset="${Array.from(
					{length: 257},
					(_, index) => `assets/${index}.png 1x`
				).join(',')}">`
			)
		).toEqual({complete: false, paths: []});
	});
	it('reports full-parser lines correctly with forward scanning', () => {
		const source = [
			'first',
			'<img src="assets/a.png">',
			'猫',
			'url("assets/b.webp")'
		].join('\n');

		expect(
			assetReferencesInSource('source', 'Source', source, null).map(
				reference => [reference.path, reference.line]
			)
		).toEqual([
			['assets/a.png', 2],
			['assets/b.webp', 4]
		]);
	});
	it('creates host-first asset command shapes', () => {
		expect(importAssetCommand('story', '/tmp/cover.png')).toEqual({
			type: 'importAsset',
			overwrite: false,
			source_path: '/tmp/cover.png',
			story_id: 'story',
			target_path: null
		});
		expect(renameAssetCommand('story', 'assets/a.png', 'assets/b.png')).toEqual(
			{
				type: 'renameAsset',
				new_path: 'assets/b.png',
				path: 'assets/a.png',
				story_id: 'story',
				update_references: true
			}
		);
		expect(deleteAssetCommand('story', 'assets/a.png', true)).toEqual({
			type: 'deleteAsset',
			path: 'assets/a.png',
			remove_references: true,
			story_id: 'story'
		});
		expect(
			replaceAssetCommand('story', 'assets/a.png', '/tmp/new.png')
		).toEqual({
			type: 'replaceAsset',
			path: 'assets/a.png',
			source_path: '/tmp/new.png',
			story_id: 'story'
		});
		expect(revealAssetCommand('story', 'assets/a.png')).toEqual({
			type: 'revealAsset',
			path: 'assets/a.png',
			story_id: 'story'
		});
		expect(copyAssetSnippetCommand('story', 'assets/a.png')).toEqual({
			type: 'copyAssetSnippet',
			path: 'assets/a.png',
			snippet: null,
			story_id: 'story'
		});
		expect(
			insertAssetSnippetCommand('story', 'assets/a.png', 'passage', 12, {
				passageId: 'passage',
				snippet: '<img src="assets/a.png" alt="">'
			})
		).toEqual({
			type: 'insertAssetSnippet',
			passage_id: 'passage',
			path: 'assets/a.png',
			position: 12,
			snippet: '<img src="assets/a.png" alt="">',
			source_id: 'passage',
			story_id: 'story'
		});
		expect(validateAssetReferencesCommand('story')).toEqual({
			type: 'validateAssetReferences',
			story_id: 'story'
		});
	});

	it('feeds Asset Manager entries from inventory with reference fallback', () => {
		const story = fakeStory(0);

		story.passages = [
			fakePassage({
				id: 'start',
				name: 'Start',
				story: story.id,
				text: '<img src="assets/cover.png">'
			})
		];

		const referenceBacked = assetManagerViewModel(storyToCoreIndex(story));

		expect(referenceBacked.entries).toEqual([
			expect.objectContaining({
				exists: null,
				missing: false,
				path: 'assets/cover.png',
				referenceCount: 1,
				unused: false
			})
		]);

		const inventoryBacked = assetManagerViewModel(
			storyToCoreIndex(story, {
				knownAssets: [
					{
						...referenceBacked.entries[0].inventory,
						exists: true,
						sizeBytes: 2048,
						thumbnailUrl: 'file:///project/assets/cover.png'
					}
				]
			})
		);

		expect(inventoryBacked.entries).toEqual([
			expect.objectContaining({
				exists: true,
				path: 'assets/cover.png',
				referenceCount: 1,
				sizeBytes: 2048,
				thumbnailUrl: 'file:///project/assets/cover.png'
			})
		]);
	});

	it('keeps native file metadata when merging Rust asset references', () => {
		const story = fakeStory(0);

		story.passages = [
			fakePassage({
				id: 'start',
				name: 'Start',
				story: story.id,
				text: '<img src="assets/cover.png">'
			})
		];
		const indexed = storyToCoreIndex(story).assetInventory[0];
		const native = {
			...indexed,
			exists: true,
			modifiedAt: '2026-06-21T16:00:00.000Z',
			previewUrl: 'file:///project/assets/cover.png',
			referenceCount: 0,
			references: [],
			sizeBytes: 2048,
			thumbnailUrl: 'file:///project/assets/cover.png',
			unused: true
		};

		expect(mergeKnownAssetInventory([indexed], [native])).toEqual([
			expect.objectContaining({
				exists: true,
				modifiedAt: '2026-06-21T16:00:00.000Z',
				path: 'assets/cover.png',
				referenceCount: 1,
				references: indexed.references,
				sizeBytes: 2048,
				thumbnailUrl: 'file:///project/assets/cover.png',
				unused: false
			})
		]);
	});
});
