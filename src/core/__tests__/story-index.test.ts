import type {CoreAssetInventoryEntry} from '../bindings/CoreAssetInventoryEntry';
import {storyToCoreIndex} from '../story-index';
import {fakePassage, fakeStory} from '../../test-util';

function knownAsset(
	path: string,
	options: Partial<CoreAssetInventoryEntry> = {}
): CoreAssetInventoryEntry {
	const kind = options.kind ?? 'image';

	return {
		durationMs: null,
		exists: null,
		height: null,
		kind,
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
		referenceCount: 0,
		references: [],
		sizeBytes: null,
		snippet: {
			label: 'Insert asset reference',
			mediaType: kind,
			text: `<img src="${path}" alt="">`
		},
		thumbnailUrl: null,
		unused: false,
		width: null,
		...options
	};
}

describe('storyToCoreIndex', () => {
	it('indexes source files, tags, graph stats, and diagnostics', () => {
		const story = fakeStory(0);
		const start = fakePassage({
			id: 'start',
			name: 'Start',
			story: story.id,
			tags: ['scene'],
			text: 'Hello [[Next]] and [[Missing]]'
		});
		const next = fakePassage({
			id: 'next',
			name: 'Next',
			story: story.id,
			text: 'End'
		});
		const loose = fakePassage({
			id: 'loose',
			name: 'Loose',
			story: story.id,
			text: ''
		});

		story.startPassage = start.id;
		story.passages = [start, next, loose];
		story.script = 'const indexedScript = true;';
		story.stylesheet = 'tw-story { color: red; }';

		const index = storyToCoreIndex(story, 'indexed');

		expect(index.storyId).toBe(story.id);
		expect(index.files).toHaveLength(5);
		expect(index.tags).toEqual(['scene']);
		expect(index.graph).toMatchObject({
			brokenLinks: 1,
			emptyPassages: 1,
			links: 2,
			orphanPassages: 1,
			passages: 3,
			resolvedLinks: 1,
			unreachablePassages: 0
		});
		expect(index.diagnostics.map(diagnostic => diagnostic.code)).toEqual(
			expect.arrayContaining(['broken-link'])
		);
		expect(index.diagnostics.map(diagnostic => diagnostic.code)).not.toContain(
			'unreachable-passage'
		);
		expect(index.searchHits).toEqual([
			expect.objectContaining({
				scope: 'script',
				sourceName: 'Story JavaScript'
			})
		]);
	});

	it('indexes variables, assets, tag counts, and contents entries', () => {
		const story = fakeStory(0);
		const start = fakePassage({
			id: 'start',
			name: 'Start',
			story: story.id,
			tags: ['chapter-one', 'scene'],
			text: 'Set $score and _turn. <img src="assets/cover.png">'
		});
		const next = fakePassage({
			id: 'next',
			name: 'Next',
			story: story.id,
			tags: ['scene'],
			text: 'Read $score again.'
		});

		story.passages = [start, next];
		story.startPassage = start.id;
		story.tagColors = {scene: 'red'};

		const index = storyToCoreIndex(story);

		expect(index.symbols.map(symbol => symbol.name)).toEqual(
			expect.arrayContaining(['$score', '_turn'])
		);
		expect(index.assets).toEqual([
			expect.objectContaining({kind: 'image', path: 'assets/cover.png'})
		]);
		expect(index.assetInventory).toEqual([
			expect.objectContaining({
				exists: null,
				kind: 'image',
				missing: false,
				path: 'assets/cover.png',
				publish: expect.objectContaining({
					copy: true,
					outputPath: 'assets/cover.png'
				}),
				referenceCount: 1,
				snippet: expect.objectContaining({
					text: '<img src="assets/cover.png" alt="">'
				}),
				unused: false
			})
		]);
		expect(index.tagEntries).toEqual([
			expect.objectContaining({count: 1, name: 'chapter-one'}),
			expect.objectContaining({color: 'red', count: 2, name: 'scene'})
		]);
		expect(index.contents).toEqual(
			expect.arrayContaining([
				expect.objectContaining({kind: 'group', label: 'chapter-one'}),
				expect.objectContaining({
					kind: 'variable',
					label: '$score',
					passageId: start.id,
					sourceId: start.id
				}),
				expect.objectContaining({
					kind: 'asset',
					label: 'assets/cover.png',
					passageId: start.id,
					sourceId: start.id
				})
			])
		);
		expect(storyToCoreIndex(story, '$score').searchHits).toEqual(
			expect.arrayContaining([expect.objectContaining({scope: 'variable'})])
		);
		expect(storyToCoreIndex(story, 'cover.png').searchHits).toEqual(
			expect.arrayContaining([expect.objectContaining({scope: 'asset'})])
		);
	});

	it('merges known file assets and reports missing and unused asset diagnostics', () => {
		const story = fakeStory(0);
		const start = fakePassage({
			id: 'start',
			name: 'Start',
			story: story.id,
			text: '<img src="assets/missing.png">'
		});

		story.passages = [start];
		story.startPassage = start.id;

		const index = storyToCoreIndex(story, {
			knownAssets: [
				knownAsset('assets/missing.png', {exists: false}),
				knownAsset('assets/unused.png', {
					exists: true,
					sizeBytes: 1024
				})
			]
		});

		expect(index.assetInventory).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					exists: false,
					missing: true,
					path: 'assets/missing.png',
					publish: expect.objectContaining({copy: false}),
					referenceCount: 1,
					unused: false
				}),
				expect.objectContaining({
					exists: true,
					missing: false,
					path: 'assets/unused.png',
					referenceCount: 0,
					sizeBytes: 1024,
					unused: true
				})
			])
		);
		expect(index.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: 'missing-asset',
					passageId: start.id,
					severity: 'error'
				}),
				expect.objectContaining({
					code: 'unused-asset',
					sourceId: `${story.id}:assets`,
					severity: 'info'
				})
			])
		);
		expect(index.contents).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					detail: 'missing',
					kind: 'asset',
					label: 'assets/missing.png',
					severity: 'error'
				}),
				expect.objectContaining({
					detail: 'unused',
					kind: 'asset',
					label: 'assets/unused.png',
					severity: 'info'
				})
			])
		);
		expect(
			storyToCoreIndex(story, {
				knownAssets: [knownAsset('assets/unused.png', {exists: true})],
				query: 'unused.png'
			}).searchHits
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({scope: 'asset', sourceName: 'Assets'})
			])
		);
	});

	it('ignores external asset URLs and normalizes local asset references', () => {
		const story = fakeStory(0);
		const start = fakePassage({
			id: 'start',
			name: 'Start',
			story: story.id,
			text:
				'<img src="https://cdn.example.com/cover.png"> ' +
				'<img src="/assets/local.png"> ' +
				'<img src="../assets/icon.svg"> poster.jpg'
		});

		story.passages = [start];
		story.startPassage = start.id;

		const assetPaths = storyToCoreIndex(story).assetInventory.map(
			asset => asset.path
		);

		expect(assetPaths).not.toContain('https://cdn.example.com/cover.png');
		expect(assetPaths).toEqual(
			expect.arrayContaining([
				'assets/local.png',
				'assets/icon.svg',
				'assets/poster.jpg'
			])
		);
	});

	it('supports regex search options and replacement previews', () => {
		const story = fakeStory(1);

		story.passages[0].name = 'Start';
		story.passages[0].text = 'Take coin-12.';

		const index = storyToCoreIndex(story, {
			query: 'coin-(\\d+)',
			replacement: 'gem-$1',
			useRegexes: true
		});

		expect(index.searchHits[0]).toMatchObject({
			after: 'Take gem-12.',
			before: 'Take coin-12.',
			matchText: 'coin-12',
			replacement: 'gem-12',
			scope: 'passageText'
		});
		expect(index.replacePreviews).toEqual([
			expect.objectContaining({
				after: 'Take gem-12.',
				before: 'Take coin-12.'
			})
		]);
	});

	it('can fuzzy-rank a source when exact search does not match', () => {
		const story = fakeStory(1);

		story.passages[0].name = 'North Hall';
		story.passages[0].text = '';

		const index = storyToCoreIndex(story, {
			fuzzy: true,
			query: 'nrth'
		});

		expect(index.searchHits[0]).toMatchObject({
			scope: 'passageName',
			sourceName: 'North Hall'
		});
	});

	it('can skip rich facets for lean search queries', () => {
		const story = fakeStory(1);

		story.passages[0].name = 'Start';
		story.passages[0].text = 'Search $score here. [[Missing]]';
		story.script = 'const ignored = true;';

		const index = storyToCoreIndex(story, {
			includeAssets: false,
			includeContents: false,
			includeDiagnostics: false,
			includeFiles: false,
			includeGraph: false,
			includePassageNames: false,
			includeScript: false,
			includeStylesheet: false,
			includeTags: false,
			includeVariables: false,
			query: '$score'
		});

		expect(index.assetInventory).toEqual([]);
		expect(index.assets).toEqual([]);
		expect(index.contents).toEqual([]);
		expect(index.diagnostics).toEqual([]);
		expect(index.files).toEqual([]);
		expect(index.graph).toEqual({
			brokenLinks: 0,
			emptyPassages: 0,
			links: 0,
			orphanPassages: 0,
			passages: 0,
			resolvedLinks: 0,
			selfLinks: 0,
			taggedPassages: 0,
			unreachablePassages: 0
		});
		expect(index.searchHits).toEqual([
			expect.objectContaining({matchText: '$score', scope: 'passageText'})
		]);
		expect(index.symbols).toEqual([]);
	});
});
