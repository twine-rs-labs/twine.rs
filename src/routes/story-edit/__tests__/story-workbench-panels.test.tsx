import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import {MemoryRouter} from 'react-router';
import type {
	CoreProjectHost,
	CoreProjectPatchListener
} from '../../../core/project-host';
import {projectSnapshotFromStories} from '../../../core';
import {
	fakeLoadedStoryFormat,
	fakeStory,
	FakeStateProvider
} from '../../../test-util';
import {
	FindReplaceWorkbenchPanel,
	PassageTagsWorkbenchPanel,
	StoryDetailsWorkbenchPanel
} from '../story-workbench-panels';
import type {StoryWorkbenchExtensionContext} from '../workbench-extensions';

function contextFor(
	host: CoreProjectHost,
	story = fakeStory()
): StoryWorkbenchExtensionContext {
	return {
		host,
		onRevealPassageInGraph: jest.fn(),
		onSelectPassage: jest.fn(),
		selection: {} as StoryWorkbenchExtensionContext['selection'],
		story
	};
}

describe('story workbench panels', () => {
	it('routes replace-all through the bound project host', async () => {
		const story = fakeStory();
		const host = {
			applyStoryCommand: jest.fn(() => Promise.resolve()),
			subscribeToPatches: jest.fn(() => jest.fn()),
			querySearchPageAsync: jest.fn(() =>
				Promise.resolve({
					searchHits: [
						{
							after: null,
							before: null,
							excerpt: 'needle',
							line: 1,
							passageId: story.passages[0].id,
							scope: 'passageText',
							sourceId: `${story.id}:passage:${story.passages[0].id}`,
							sourceName: story.passages[0].name,
							start: 0
						}
					]
				})
			)
		} as unknown as CoreProjectHost;

		render(
			<MemoryRouter>
				<FakeStateProvider stories={[story]}>
					<FindReplaceWorkbenchPanel context={contextFor(host, story)} />
				</FakeStateProvider>
			</MemoryRouter>
		);
		fireEvent.change(
			screen.getByRole('textbox', {name: 'dialogs.storySearch.find'}),
			{target: {value: 'needle'}}
		);
		fireEvent.change(
			screen.getByRole('textbox', {name: 'dialogs.storySearch.replaceWith'}),
			{target: {value: 'replacement'}}
		);
		await waitFor(() =>
			expect(
				screen.getByRole('button', {name: 'dialogs.storySearch.replaceAll'})
			).toBeEnabled()
		);
		const queryCount = (host.querySearchPageAsync as jest.Mock).mock.calls
			.length;
		fireEvent.click(
			screen.getByRole('button', {name: 'dialogs.storySearch.replaceAll'})
		);

		expect(host.applyStoryCommand).toHaveBeenCalledWith(
			expect.objectContaining({story_id: story.id, type: 'replaceAllText'}),
			'undoChange.replaceAllText'
		);
		await waitFor(() =>
			expect(host.querySearchPageAsync).toHaveBeenCalledTimes(queryCount + 1)
		);
	});

	it('refreshes passage tags after a successful mutation', async () => {
		const story = fakeStory();
		const queryContentsPageAsync = jest.fn(async (_storyId, options) => ({
			entries:
				options.filter === 'tag'
					? [{count: 1, detail: 'red', label: 'old-tag', passageId: null}]
					: [],
			nextCursor: null
		}));
		const host = {
			applyStoryCommand: jest.fn(() => Promise.resolve()),
			queryContentsPageAsync,
			subscribeToPatches: jest.fn(() => jest.fn())
		} as unknown as CoreProjectHost;

		render(
			<FakeStateProvider stories={[story]}>
				<PassageTagsWorkbenchPanel context={contextFor(host, story)} />
			</FakeStateProvider>
		);
		await screen.findByText('old-tag');
		const queryCount = queryContentsPageAsync.mock.calls.length;

		fireEvent.change(screen.getByRole('combobox'), {
			target: {value: 'blue'}
		});

		await waitFor(() =>
			expect(queryContentsPageAsync.mock.calls.length).toBeGreaterThan(
				queryCount
			)
		);
		expect(host.applyStoryCommand).toHaveBeenCalledWith(
			expect.objectContaining({story_id: story.id, type: 'setStoryTagColor'}),
			'undoChange.changeTagColor'
		);
	});

	it('routes story metadata changes through the bound project host', () => {
		const story = fakeStory();
		const format = fakeLoadedStoryFormat();
		story.storyFormat = format.name;
		story.storyFormatVersion = format.version;
		const host = {
			applyStoryCommand: jest.fn(() => Promise.resolve()),
			queryStorySummaryAsync: jest.fn(() => Promise.resolve({graph: {}})),
			subscribeToPatches: jest.fn(() => jest.fn())
		} as unknown as CoreProjectHost;

		render(
			<FakeStateProvider storyFormats={[format]} stories={[story]}>
				<StoryDetailsWorkbenchPanel context={contextFor(host, story)} />
			</FakeStateProvider>
		);
		fireEvent.click(
			screen.getByRole('checkbox', {
				name: 'dialogs.storyDetails.snapToGrid'
			})
		);

		expect(host.applyStoryCommand).toHaveBeenCalledWith(
			expect.objectContaining({story_id: story.id, type: 'setStorySnapToGrid'})
		);
	});

	it('refreshes story details statistics after a project patch', async () => {
		const story = fakeStory();
		const format = fakeLoadedStoryFormat();
		let onPatch: CoreProjectPatchListener | undefined;
		const queryStorySummaryAsync = jest
			.fn()
			.mockResolvedValueOnce({
				characterCount: 10,
				graph: {brokenLinks: 0, links: 1},
				passageCount: 1,
				wordCount: 2
			})
			.mockResolvedValueOnce({
				characterCount: 40,
				graph: {brokenLinks: 1, links: 3},
				passageCount: 1,
				wordCount: 8
			});
		const host = {
			applyStoryCommand: jest.fn(() => Promise.resolve()),
			queryStorySummaryAsync,
			subscribeToPatches: jest.fn((listener: CoreProjectPatchListener) => {
				onPatch = listener;
				return jest.fn();
			})
		} as unknown as CoreProjectHost;

		story.storyFormat = format.name;
		story.storyFormatVersion = format.version;
		render(
			<FakeStateProvider storyFormats={[format]} stories={[story]}>
				<StoryDetailsWorkbenchPanel context={contextFor(host, story)} />
			</FakeStateProvider>
		);
		await waitFor(() =>
			expect(queryStorySummaryAsync).toHaveBeenCalledTimes(1)
		);

		act(() =>
			onPatch?.({
				label: 'Project replaced',
				patches: [
					{
						snapshot: projectSnapshotFromStories([story]),
						type: 'projectSnapshotReplaced'
					}
				],
				transactionId: BigInt(1)
			})
		);

		await waitFor(() =>
			expect(queryStorySummaryAsync).toHaveBeenCalledTimes(2)
		);
		expect(screen.getByText('40')).toBeInTheDocument();
		expect(screen.getByText('8')).toBeInTheDocument();
		expect(screen.getByText('3')).toBeInTheDocument();
	});
});
