import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import {MemoryRouter} from 'react-router';
import type {
	CoreProjectHost,
	CoreProjectPatchListener
} from '../../../test-util/core-project-host-runtime';
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
	it('keeps find highlights through callback rerenders and clears them on query changes and unmount', async () => {
		const story = fakeStory();
		const matchingHit = {
			after: null,
			before: null,
			excerpt: 'needle',
			line: 1,
			passageId: story.passages[0].id,
			scope: 'passageText' as const,
			sourceId: `${story.id}:passage:${story.passages[0].id}`,
			sourceName: story.passages[0].name,
			start: 0
		};
		const host = {
			querySearchPageAsync: jest.fn(async (_storyId, options) => ({
				searchHits: options.query === 'needle' ? [matchingHit] : []
			})),
			subscribeToPatches: jest.fn(() => jest.fn())
		} as unknown as CoreProjectHost;
		const firstCallback = jest.fn();
		const latestCallback = jest.fn();
		const renderPanel = (onHighlightPassages: jest.Mock) => (
			<MemoryRouter>
				<FakeStateProvider stories={[story]}>
					<FindReplaceWorkbenchPanel
						context={{
							...contextFor(host, story),
							onHighlightPassages
						}}
						request={{key: 1, query: 'needle'}}
					/>
				</FakeStateProvider>
			</MemoryRouter>
		);
		const {rerender, unmount} = render(renderPanel(firstCallback));

		await waitFor(() =>
			expect(firstCallback).toHaveBeenCalledWith([story.passages[0].id])
		);
		const firstCallbackClearCount = firstCallback.mock.calls.filter(
			([passageIds]) => passageIds.length === 0
		).length;
		rerender(renderPanel(latestCallback));
		expect(latestCallback).toHaveBeenCalledWith([story.passages[0].id]);
		expect(
			firstCallback.mock.calls.filter(([passageIds]) => passageIds.length === 0)
		).toHaveLength(firstCallbackClearCount);

		fireEvent.change(
			screen.getByRole('textbox', {name: 'dialogs.storySearch.find'}),
			{target: {value: 'no match'}}
		);
		await waitFor(() => expect(latestCallback).toHaveBeenCalledWith([]));

		unmount();
		expect(latestCallback).toHaveBeenLastCalledWith([]);
		expect(
			firstCallback.mock.calls.filter(([passageIds]) => passageIds.length === 0)
		).toHaveLength(firstCallbackClearCount);
	});

	it('settles highlight updates when a provider rerender replaces its callback', async () => {
		const story = fakeStory();
		const highlightPassages = jest.fn();
		const host = {
			querySearchPageAsync: jest.fn(async () => ({
				searchHits: [
					{
						after: null,
						before: null,
						excerpt: 'needle',
						line: 1,
						passageId: story.passages[0].id,
						scope: 'passageText' as const,
						sourceId: `${story.id}:passage:${story.passages[0].id}`,
						sourceName: story.passages[0].name,
						start: 0
					}
				]
			})),
			subscribeToPatches: jest.fn(() => jest.fn())
		} as unknown as CoreProjectHost;
		const RerenderingProvider: React.FC = () => {
			const [, setHighlightedPassageIds] = React.useState<string[]>([]);

			return (
				<FindReplaceWorkbenchPanel
					context={{
						...contextFor(host, story),
						onHighlightPassages: passageIds => {
							highlightPassages(passageIds);
							setHighlightedPassageIds(previous =>
								previous.length === passageIds.length &&
								previous.every((id, index) => id === passageIds[index])
									? previous
									: passageIds
							);
						}
					}}
					request={{key: 1, query: 'needle'}}
				/>
			);
		};

		render(
			<React.StrictMode>
				<MemoryRouter>
					<FakeStateProvider stories={[story]}>
						<RerenderingProvider />
					</FakeStateProvider>
				</MemoryRouter>
			</React.StrictMode>
		);

		await waitFor(() =>
			expect(highlightPassages).toHaveBeenCalledWith([story.passages[0].id])
		);
		const settledCallCount = highlightPassages.mock.calls.length;
		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(highlightPassages).toHaveBeenCalledTimes(settledCallCount);
	});

	it('plans replacement through the bound project host instead of dispatching a direct command', async () => {
		const story = fakeStory();
		const summary = {
			affectedEntityCount: 1,
			changeCount: 1,
			coverage: 'complete',
			firstDetailCursor: {planDigest: 'digest', planId: 'plan', position: 0},
			operationKind: 'project-replace',
			planDigest: 'digest',
			planId: 'plan',
			projectRevision: 4,
			selectionCapabilities: {
				all: true,
				exclusions: true,
				groups: true,
				only: false
			},
			validationFailures: []
		};
		const host = {
			applyRefactorPlan: jest.fn(() => Promise.resolve({type: 'applied'})),
			closeRefactorReview: jest.fn(),
			planProjectReplace: jest.fn(() =>
				Promise.resolve({type: 'complete', summary})
			),
			queryRefactorPlanDetailAsync: jest.fn(() =>
				Promise.resolve({
					type: 'page',
					page: {changes: [], nextCursor: null}
				})
			),
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
		const queryCount = (host.querySearchPageAsync as unknown as jest.Mock).mock
			.calls.length;
		fireEvent.click(
			screen.getByRole('button', {name: 'dialogs.storySearch.replaceAll'})
		);

		await waitFor(() =>
			expect(host.planProjectReplace).toHaveBeenCalledWith(
				story.id,
				expect.objectContaining({
					includePassageNames: true,
					includePassageText: true,
					includeScript: true,
					includeStylesheet: true,
					query: 'needle',
					replacement: 'replacement'
				}),
				expect.any(Object)
			)
		);
		expect('applyStoryCommand' in host).toBe(false);
		await waitFor(() =>
			expect(host.queryRefactorPlanDetailAsync).toHaveBeenCalled()
		);
		fireEvent.click(
			screen.getByRole('button', {
				name: 'components.projectReplaceReview.apply'
			})
		);
		await waitFor(() =>
			expect(host.applyRefactorPlan).toHaveBeenCalledWith(story.id, {
				expectedProjectRevision: 4,
				planId: 'plan',
				selection: {type: 'all'}
			})
		);
		await waitFor(() =>
			expect(
				(host.querySearchPageAsync as unknown as jest.Mock).mock.calls.length
			).toBeGreaterThan(queryCount)
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

	it('routes story metadata changes through the bound project host', async () => {
		const story = fakeStory();
		const format = fakeLoadedStoryFormat();
		story.storyFormat = format.name;
		story.storyFormatVersion = format.version;
		const host = {
			applyStoryCommand: jest.fn(() => Promise.resolve()),
			queryStorySummaryAsync: jest.fn(() =>
				Promise.resolve({characterCount: 314, graph: {}})
			),
			subscribeToPatches: jest.fn(() => jest.fn())
		} as unknown as CoreProjectHost;

		render(
			<FakeStateProvider storyFormats={[format]} stories={[story]}>
				<StoryDetailsWorkbenchPanel context={contextFor(host, story)} />
			</FakeStateProvider>
		);
		await screen.findByText('314');
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
