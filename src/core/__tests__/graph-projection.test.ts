import {
	saveGeneratedGraphLayout,
	storyToCoreGraphProjection
} from '../graph-projection';
import {fakePassage, fakeStory} from '../../test-util';

function graphStory() {
	const story = fakeStory(0);
	const start = fakePassage({
		height: 100,
		id: 'start',
		left: 0,
		name: 'Start',
		selected: false,
		story: story.id,
		tags: ['hub'],
		text: 'Go to [[Next]] and [[Missing]]',
		top: 0,
		width: 100
	});
	const next = fakePassage({
		height: 100,
		id: 'next',
		left: 125,
		name: 'Next',
		selected: false,
		story: story.id,
		text: 'Loop to [[Next]]',
		top: 0,
		width: 100
	});
	const loose = fakePassage({
		height: 100,
		id: 'loose',
		left: 1000,
		name: 'Loose',
		selected: false,
		story: story.id,
		text: '',
		top: 0,
		width: 100
	});

	story.passages = [start, next, loose];
	story.startPassage = start.id;
	return {loose, next, start, story};
}

describe('storyToCoreGraphProjection', () => {
	it('projects nodes, edges, graph stats, and saved layout state', () => {
		const {story} = graphStory();
		const projection = storyToCoreGraphProjection(story);
		const nodes = new Map(projection.nodes.map(node => [node.id, node]));

		expect(projection.layoutState).toBe('saved');
		expect(projection.stats).toMatchObject({
			brokenLinks: 1,
			emptyPassages: 1,
			links: 3,
			orphanPassages: 1,
			passages: 3,
			resolvedLinks: 1,
			selfLinks: 1,
			unreachablePassages: 0
		});
		expect(nodes.get('start')).toMatchObject({
			brokenLinkCount: 1,
			isStart: true,
			outgoingCount: 2
		});
		expect(nodes.get('next')).toMatchObject({
			incomingCount: 1,
			selfLinkCount: 1
		});
		expect(projection.edges.map(edge => edge.kind)).toEqual([
			'resolved',
			'broken',
			'selfLink'
		]);
	});

	it('filters viewport nodes, focus neighborhoods, and link layers', () => {
		const {story} = graphStory();
		const projection = storyToCoreGraphProjection(story, {
			focus: {direction: 'incoming', passageIds: ['next'], radius: 1},
			layers: {broken: false},
			viewport: {height: 150, left: 0, top: 0, width: 150}
		});

		expect(projection.nodes.map(node => node.id)).toEqual(['start', 'next']);
		expect(projection.edges).toEqual([
			expect.objectContaining({
				kind: 'resolved',
				sourceId: 'start',
				targetId: 'next'
			}),
			expect.objectContaining({
				kind: 'selfLink',
				sourceId: 'next',
				targetId: 'next'
			})
		]);
	});

	it('keeps large graph projections bounded by the requested viewport', () => {
		const story = fakeStory(0);

		story.passages = Array.from({length: 10000}, (_, index) => ({
			height: 100,
			highlighted: false,
			id: `passage-${index}`,
			left: (index % 100) * 220,
			name: `Passage ${index}`,
			selected: false,
			story: story.id,
			tags: [],
			text: index < 9999 ? `[[Passage ${index + 1}]]` : '',
			top: Math.floor(index / 100) * 150,
			width: 160
		}));
		story.startPassage = 'passage-0';

		const projection = storyToCoreGraphProjection(story, {
			viewport: {height: 500, left: 0, top: 0, width: 500}
		});

		expect(projection.stats.passages).toBe(10000);
		expect(projection.nodes.length).toBeLessThan(50);
		expect(projection.edges.length).toBeLessThan(80);
	});

	it('wraps dense generated graph levels into a usable block shape', () => {
		const story = fakeStory(0);
		const targets = Array.from({length: 12}, (_, index) =>
			fakePassage({
				height: 0,
				id: `target-${index}`,
				left: Number.NaN,
				name: `Target ${index}`,
				selected: false,
				story: story.id,
				tags: [],
				text: '',
				top: Number.NaN,
				width: 0
			})
		);
		const start = fakePassage({
			height: 0,
			id: 'start',
			left: Number.NaN,
			name: 'Start',
			selected: false,
			story: story.id,
			tags: [],
			text: targets.map(target => `[[${target.name}]]`).join(' '),
			top: Number.NaN,
			width: 0
		});

		story.passages = [start, ...targets];
		story.startPassage = start.id;

		const projection = storyToCoreGraphProjection(story);
		const targetNodes = projection.nodes.filter(node =>
			node.id.startsWith('target-')
		);

		expect(projection.layoutState).toBe('generated');
		expect(
			new Set(targetNodes.map(node => node.bounds.left)).size
		).toBeGreaterThan(1);
		expect(new Set(targetNodes.map(node => node.bounds.top)).size).toBeLessThan(
			targetNodes.length
		);
	});
});

describe('saveGeneratedGraphLayout', () => {
	it('promotes generated graph layout into passage moves', () => {
		const {story} = graphStory();

		story.passages = story.passages.map(passage => ({
			...passage,
			height: 0,
			left: Number.NaN,
			top: Number.NaN,
			width: 0
		}));

		const {moves, projection} = saveGeneratedGraphLayout(story);

		expect(projection.layoutState).toBe('saved');
		expect(moves.map(move => move.passageId)).toEqual([
			'start',
			'next',
			'loose'
		]);
		expect(moves[0].bounds).toEqual({
			height: 110,
			left: 0,
			top: 0,
			width: 184
		});
	});
});
