import {fakeStory} from '../../../test-util';
import {sourceTarget} from '../source-navigation';

describe('sourceTarget', () => {
	it('preserves an exact UTF-16 source range in the route', () => {
		const story = fakeStory(1);
		const url = new URL(
			sourceTarget(story, {
				endOffset: 17,
				offset: 9,
				target: {kind: 'passage', passageId: story.passages[0].id}
			}),
			'https://example.invalid'
		);

		expect(url.pathname).toBe(`/stories/${story.id}`);
		expect(url.searchParams.get('source')).toBe(
			`passage:${story.passages[0].id}`
		);
		expect(url.searchParams.get('offset')).toBe('9');
		expect(url.searchParams.get('end')).toBe('17');
	});
});
