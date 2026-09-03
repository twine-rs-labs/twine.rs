import {fakeStory} from '../../../test-util';
import {
	allocateSourceNavigationFocusPreservationLease,
	claimSourceNavigationFocusPreservationLease,
	releaseSourceNavigationFocusPreservationLease,
	sourceTarget
} from '../source-navigation';

describe('sourceTarget', () => {
	it('preserves an exact UTF-16 source range and focus intent in the route', () => {
		const story = fakeStory(1);
		const url = new URL(
			sourceTarget(story, {
				endOffset: 17,
				focus: 'preserve',
				offset: 9,
				restoreToken: 'reference-restore-1',
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
		expect(url.searchParams.get('focus')).toBe('preserve');
		expect(url.searchParams.get('restoreToken')).toBe('reference-restore-1');
	});

	it('omits the default editor focus intent', () => {
		const story = fakeStory(1);
		const url = new URL(
			sourceTarget(story, {
				target: {kind: 'passage', passageId: story.passages[0].id}
			}),
			'https://example.invalid'
		);

		expect(url.searchParams.has('focus')).toBe(false);
	});

	it('admits a preserve intent only for a live lease once', () => {
		const token = allocateSourceNavigationFocusPreservationLease();

		expect(claimSourceNavigationFocusPreservationLease(token)).toBe(true);
		expect(claimSourceNavigationFocusPreservationLease(token)).toBe(false);
		expect(releaseSourceNavigationFocusPreservationLease(token)).toBe(true);
	});

	it('rejects direct, released, and superseded preserve tokens', () => {
		expect(claimSourceNavigationFocusPreservationLease('reloaded-token')).toBe(
			false
		);

		const released = allocateSourceNavigationFocusPreservationLease();
		releaseSourceNavigationFocusPreservationLease(released);
		expect(claimSourceNavigationFocusPreservationLease(released)).toBe(false);

		const superseded = allocateSourceNavigationFocusPreservationLease();
		releaseSourceNavigationFocusPreservationLease(superseded);
		expect(claimSourceNavigationFocusPreservationLease(superseded)).toBe(false);
	});
});
