import {storyToCoreIndex} from '../story-index';
import {fakePassage, fakeStory} from '../../test-util';

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
			unreachablePassages: 1
		});
		expect(index.diagnostics.map(diagnostic => diagnostic.code)).toEqual(
			expect.arrayContaining(['broken-link', 'unreachable-passage'])
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
});
