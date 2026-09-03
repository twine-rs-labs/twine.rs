import {fakeStory} from '../../test-util';
import type {CoreProjectHost} from '../project-host-public';
import {
	materializeStoryFromSession,
	materializeStorySnapshotFromSession
} from '../materialize-story';

describe('materializeStoryFromSession()', () => {
	it('combines metadata with a revision-consistent bounded document stream', async () => {
		const story = fakeStory(2);
		const revision = 7;
		const queryDocumentPageAsync = jest
			.fn()
			.mockResolvedValueOnce({
				documents: [
					{kind: 'passage', passageId: story.passages[0].id, text: 'first'}
				],
				nextCursor: 'next',
				revision,
				storyId: story.id,
				totalCount: 4
			})
			.mockResolvedValueOnce({
				documents: [
					{kind: 'passage', passageId: story.passages[1].id, text: 'second'},
					{kind: 'script', passageId: null, text: 'script'},
					{kind: 'stylesheet', passageId: null, text: 'style'}
				],
				nextCursor: null,
				revision,
				storyId: story.id,
				totalCount: 4
			});
		const host = {
			queryDocumentPageAsync,
			sessionStatus: () => ({revision})
		} as unknown as CoreProjectHost;

		const result = await materializeStoryFromSession(host, story);

		expect(result.passages.map(passage => passage.text)).toEqual([
			'first',
			'second'
		]);
		expect(result.script).toBe('script');
		expect(result.stylesheet).toBe('style');
		expect(queryDocumentPageAsync).toHaveBeenCalledTimes(2);
	});

	it('rejects an incomplete document enumeration', async () => {
		const story = fakeStory(2);
		const host = {
			queryDocumentPageAsync: jest.fn(async () => ({
				documents: [
					{kind: 'passage', passageId: story.passages[0].id, text: 'only'}
				],
				nextCursor: null,
				revision: 1,
				storyId: story.id,
				totalCount: 1
			})),
			sessionStatus: () => ({revision: 1})
		} as unknown as CoreProjectHost;

		await expect(materializeStoryFromSession(host, story)).rejects.toThrow(
			'incomplete story'
		);
	});

	it('returns the exact revision with a preview publishing snapshot', async () => {
		const story = fakeStory(1);
		const host = {
			queryDocumentPageAsync: jest.fn(async () => ({
				documents: [
					{kind: 'passage', passageId: story.passages[0].id, text: 'live'}
				],
				nextCursor: null,
				revision: 12,
				storyId: story.id,
				totalCount: 1
			})),
			sessionStatus: () => ({revision: 12})
		} as unknown as CoreProjectHost;

		await expect(
			materializeStorySnapshotFromSession(host, story)
		).resolves.toMatchObject({
			revision: 12,
			story: {
				passages: [expect.objectContaining({text: 'live'})]
			}
		});
	});
});
