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
			unreachablePassages: 1
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
