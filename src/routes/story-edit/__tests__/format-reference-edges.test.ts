import type {CoreGraphProjection} from '../../../core/bindings/CoreGraphProjection';
import {fakeStory} from '../../../test-util';
import type {StoryWithDocuments} from '../../../store/stories';
import {formatReferenceEdges} from '../format-reference-edges';

describe('formatReferenceEdges()', () => {
	function story(): StoryWithDocuments {
		const result = fakeStory() as StoryWithDocuments;

		result.passages = [
			{
				...result.passages[0],
				id: 'source',
				name: 'Source',
				story: result.id,
				text: 'format source'
			},
			{
				...result.passages[0],
				id: 'target',
				name: 'Target',
				story: result.id,
				text: ''
			}
		];
		result.startPassage = 'source';
		return result;
	}

	function projection(): CoreGraphProjection {
		const node = {
			bounds: {height: 100, left: 0, top: 0, width: 100},
			brokenLinkCount: 0,
			excerpt: '',
			incomingCount: 0,
			isEmpty: false,
			isOrphan: false,
			isStart: false,
			isUnreachable: false,
			layoutSource: 'saved' as const,
			outgoingCount: 0,
			selfLinkCount: 0,
			tags: []
		};

		return {
			bounds: {height: 100, left: 0, top: 0, width: 300},
			edges: [],
			layoutState: 'saved',
			nodes: [
				{...node, id: 'source', isStart: true, name: 'Source'},
				{
					...node,
					bounds: {...node.bounds, left: 200},
					id: 'target',
					name: 'Target'
				}
			],
			stats: {
				brokenLinks: 0,
				emptyPassages: 1,
				links: 0,
				orphanPassages: 1,
				passages: 2,
				resolvedLinks: 0,
				selfLinks: 0,
				taggedPassages: 0,
				unreachablePassages: 1
			}
		};
	}

	it('draws unique references to existing passages only', () => {
		expect(
			formatReferenceEdges(story(), projection(), text =>
				text === 'format source' ? ['Target', 'Missing', 'Target'] : []
			)
		).toEqual([
			{
				kind: 'reference',
				sourceBounds: {height: 100, left: 0, top: 0, width: 100},
				sourceId: 'source',
				targetBounds: {height: 100, left: 200, top: 0, width: 100},
				targetId: 'target',
				targetName: 'Target'
			}
		]);
	});

	it('isolates parser failures to the affected passage', () => {
		jest.spyOn(console, 'warn').mockImplementation(() => undefined);

		expect(
			formatReferenceEdges(story(), projection(), text => {
				if (text === 'format source') {
					throw new Error('bad extension');
				}

				return [];
			})
		).toEqual([]);
		expect(console.warn).toHaveBeenCalledWith(
			expect.stringContaining('Source'),
			expect.any(Error)
		);
	});
});
