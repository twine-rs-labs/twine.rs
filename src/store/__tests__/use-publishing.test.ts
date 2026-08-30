import type {CoreProjectHost} from '../../test-util/core-project-host-runtime';
import {fakeStory} from '../../test-util';
import {
	currentStoryPreviewMetadata,
	materializeStoryPreviewSnapshot
} from '../use-publishing';

function storySummary(storyId: string, revision: number) {
	return {
		assetCount: 0,
		characterCount: 0,
		diagnosticCount: 0,
		errorCount: 0,
		graph: {
			brokenLinks: 0,
			emptyPassages: 0,
			links: 0,
			orphanPassages: 0,
			passages: 1,
			resolvedLinks: 0,
			selfLinks: 0,
			taggedPassages: 0,
			unreachablePassages: 0
		},
		missingAssetCount: 0,
		passageCount: 1,
		revision,
		storyId,
		tagCount: 0,
		warningCount: 0,
		wordCount: 0
	};
}

describe('materializeStoryPreviewSnapshot()', () => {
	it('re-reads revision-attached metadata on retry', async () => {
		const originalStory = {...fakeStory(1), name: 'Original'};
		const renamedStory = {...originalStory, name: 'Renamed'};
		let revision = 1;
		let metadata = {revision, story: originalStory};
		const host = {
			queryDocumentPageAsync: jest.fn(async () => ({
				documents: [
					{
						kind: 'passage',
						passageId: originalStory.passages[0].id,
						text: `revision ${revision}`
					}
				],
				nextCursor: null,
				revision,
				storyId: originalStory.id,
				totalCount: 1
			})),
			queryStorySummaryAsync: jest.fn(async () => {
				if (revision === 1) {
					revision = 2;
					metadata = {revision, story: renamedStory};
				}

				return storySummary(originalStory.id, revision);
			}),
			sessionStatus: () => ({revision})
		} as unknown as CoreProjectHost;

		await expect(
			materializeStoryPreviewSnapshot(host, originalStory.id, () => metadata)
		).resolves.toMatchObject({
			revision: 2,
			story: {
				name: 'Renamed',
				passages: [expect.objectContaining({text: 'revision 2'})]
			},
			summary: {revision: 2}
		});
	});

	it('reads a document-only Core revision without requiring new story metadata', async () => {
		const story = fakeStory(1);
		let revision = 1;
		const host = {
			queryDocumentPageAsync: jest.fn(async () => ({
				documents: [
					{
						kind: 'passage',
						passageId: story.passages[0].id,
						text: `revision ${revision}`
					}
				],
				nextCursor: null,
				revision,
				storyId: story.id,
				totalCount: 1
			})),
			queryStorySummaryAsync: jest.fn(async () => {
				if (revision === 1) {
					revision = 2;
				}

				return storySummary(story.id, revision);
			}),
			sessionStatus: () => ({revision})
		} as unknown as CoreProjectHost;

		await expect(
			materializeStoryPreviewSnapshot(host, story.id, () =>
				currentStoryPreviewMetadata(host, [story], story.id)
			)
		).resolves.toMatchObject({
			revision: 2,
			story: {
				passages: [expect.objectContaining({text: 'revision 2'})]
			},
			summary: {revision: 2}
		});
	});

	it('rejects instead of combining stale metadata with a newer Core revision', async () => {
		const story = fakeStory(1);
		const metadata = {revision: 1, story};
		let revision = 1;
		const host = {
			queryDocumentPageAsync: jest.fn(async () => ({
				documents: [
					{
						kind: 'passage',
						passageId: story.passages[0].id,
						text: `revision ${revision}`
					}
				],
				nextCursor: null,
				revision,
				storyId: story.id,
				totalCount: 1
			})),
			queryStorySummaryAsync: jest.fn(async () => {
				revision = 2;
				return storySummary(story.id, revision);
			}),
			sessionStatus: () => ({revision})
		} as unknown as CoreProjectHost;

		await expect(
			materializeStoryPreviewSnapshot(host, story.id, () => metadata)
		).rejects.toThrow('changed while its preview metadata');
	});
});
