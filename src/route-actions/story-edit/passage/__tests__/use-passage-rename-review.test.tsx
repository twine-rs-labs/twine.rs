import {act, renderHook, waitFor} from '@testing-library/react';
import * as React from 'react';
import type {CoreProjectHost} from '../../../../core';
import {fakeStory, FakeStateProvider} from '../../../../test-util';
import {
	PassageRenameReviewRequest,
	usePassageRenameReview
} from '../use-passage-rename-review';

function deferred<T>() {
	let resolve!: (value: T) => void;
	return {
		promise: new Promise<T>(nextResolve => (resolve = nextResolve)),
		resolve
	};
}

describe('usePassageRenameReview', () => {
	const story = fakeStory(1);
	const request: PassageRenameReviewRequest = {
		afterName: 'Renamed',
		passageId: story.passages[0].id,
		storyId: story.id
	};
	const summary = {
		affectedEntityCount: 1,
		changeCount: 1,
		coverage: 'standard-links-only',
		expiresAtEpochMs: 0,
		firstDetailCursor: {planDigest: 'digest', planId: 'plan', position: 0},
		operationKind: 'rename-passage',
		planDigest: 'digest',
		planId: 'plan',
		projectRevision: 4,
		selectionCapabilities: {
			all: true,
			exclusions: false,
			groups: false,
			only: false
		},
		validationFailures: []
	};
	const page = {
		changes: [],
		nextCursor: null
	};

	function host(overrides: Partial<CoreProjectHost> = {}) {
		return {
			applyRefactorPlan: jest
				.fn()
				.mockResolvedValue({batch: {}, receipt: {}, type: 'applied'}),
			closeRefactorReview: jest.fn(),
			planPassageRename: jest
				.fn()
				.mockResolvedValue({summary, type: 'complete'}),
			queryRefactorPlanDetailAsync: jest
				.fn()
				.mockResolvedValue({page, type: 'page'}),
			...overrides
		} as unknown as CoreProjectHost;
	}

	function wrapper(coreProjectHost: CoreProjectHost) {
		return ({children}: {children: React.ReactNode}) => (
			<FakeStateProvider coreProjectHost={coreProjectHost} stories={[story]}>
				{children}
			</FakeStateProvider>
		);
	}

	it('plans, loads a page, and applies only the opaque reviewed identity', async () => {
		const detail = deferred<any>();
		const coreProjectHost = host({
			queryRefactorPlanDetailAsync: jest.fn().mockReturnValue(detail.promise)
		});
		const onApplied = jest.fn();
		const {result} = renderHook(
			() => usePassageRenameReview(request, onApplied),
			{wrapper: wrapper(coreProjectHost)}
		);

		await waitFor(() => expect(result.current.summary).toEqual(summary));
		act(() => result.current.handleApply());
		expect(coreProjectHost.applyRefactorPlan).not.toHaveBeenCalled();

		act(() => detail.resolve({page, type: 'page'}));
		await waitFor(() => expect(result.current.page).toEqual(page));
		act(() => result.current.handleApply());
		await waitFor(() =>
			expect(coreProjectHost.applyRefactorPlan).toHaveBeenCalledWith(story.id, {
				expectedProjectRevision: 4,
				planId: 'plan',
				selection: {type: 'all'}
			})
		);
		await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
	});

	it('renders a retryable state when planning is cancelled by the host', async () => {
		const coreProjectHost = host({
			planPassageRename: jest
				.fn()
				.mockResolvedValueOnce({type: 'cancelled'})
				.mockResolvedValueOnce({summary, type: 'complete'})
		});
		const {result} = renderHook(
			() => usePassageRenameReview(request, jest.fn()),
			{wrapper: wrapper(coreProjectHost)}
		);

		await waitFor(() =>
			expect(result.current.error?.code).toBe('planning-cancelled')
		);
		act(() => result.current.handleRetry());
		await waitFor(() =>
			expect(coreProjectHost.planPassageRename).toHaveBeenCalledTimes(2)
		);
		await waitFor(() => expect(result.current.page).toEqual(page));
	});

	it('replans after a stale apply failure and uses only the new plan identity', async () => {
		const refreshedSummary = {
			...summary,
			firstDetailCursor: {
				planDigest: 'new-digest',
				planId: 'new-plan',
				position: 0
			},
			planDigest: 'new-digest',
			planId: 'new-plan',
			projectRevision: 5
		};
		const coreProjectHost = host({
			applyRefactorPlan: jest
				.fn()
				.mockResolvedValueOnce({
					failure: {
						code: 'stale-project-revision',
						message: 'The project changed.'
					},
					type: 'failure'
				})
				.mockResolvedValueOnce({batch: {}, receipt: {}, type: 'applied'}),
			planPassageRename: jest
				.fn()
				.mockResolvedValueOnce({summary, type: 'complete'})
				.mockResolvedValueOnce({summary: refreshedSummary, type: 'complete'})
		});
		const onApplied = jest.fn();
		const {result} = renderHook(
			() => usePassageRenameReview(request, onApplied),
			{wrapper: wrapper(coreProjectHost)}
		);

		await waitFor(() => expect(result.current.page).toEqual(page));
		act(() => result.current.handleApply());
		await waitFor(() =>
			expect(result.current.error?.code).toBe('stale-project-revision')
		);
		act(() => result.current.handleRetry());
		await waitFor(() =>
			expect(result.current.summary).toEqual(refreshedSummary)
		);
		await waitFor(() => expect(result.current.page).toEqual(page));
		act(() => result.current.handleApply());
		await waitFor(() =>
			expect(coreProjectHost.applyRefactorPlan).toHaveBeenLastCalledWith(
				story.id,
				{
					expectedProjectRevision: 5,
					planId: 'new-plan',
					selection: {type: 'all'}
				}
			)
		);
		await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
	});

	it('discards a stale detail response when the request is replaced', async () => {
		const firstDetail = deferred<any>();
		const currentPage = {changes: [], nextCursor: null};
		const secondRequest = {...request, afterName: 'Current'};
		const coreProjectHost = host({
			planPassageRename: jest
				.fn()
				.mockResolvedValueOnce({summary, type: 'complete'})
				.mockResolvedValueOnce({summary, type: 'complete'}),
			queryRefactorPlanDetailAsync: jest
				.fn()
				.mockReturnValueOnce(firstDetail.promise)
				.mockResolvedValueOnce({page: currentPage, type: 'page'})
		});
		const {rerender, result} = renderHook(
			({reviewRequest}) => usePassageRenameReview(reviewRequest, jest.fn()),
			{
				initialProps: {reviewRequest: request},
				wrapper: wrapper(coreProjectHost)
			}
		);

		await waitFor(() =>
			expect(
				coreProjectHost.queryRefactorPlanDetailAsync
			).toHaveBeenCalledTimes(1)
		);
		rerender({reviewRequest: secondRequest});
		await waitFor(() => expect(result.current.page).toEqual(currentPage));
		act(() =>
			firstDetail.resolve({page: {changes: [], nextCursor: null}, type: 'page'})
		);
		expect(coreProjectHost.queryRefactorPlanDetailAsync).toHaveBeenCalledTimes(
			2
		);
		expect(result.current.page).toEqual(currentPage);
	});

	it('discards a stale planning response when the request is replaced', async () => {
		const firstPlan = deferred<any>();
		const secondRequest = {...request, afterName: 'Current'};
		const coreProjectHost = host({
			planPassageRename: jest
				.fn()
				.mockReturnValueOnce(firstPlan.promise)
				.mockResolvedValueOnce({summary, type: 'complete'})
		});
		const {rerender, result} = renderHook(
			({reviewRequest}) => usePassageRenameReview(reviewRequest, jest.fn()),
			{
				initialProps: {reviewRequest: request},
				wrapper: wrapper(coreProjectHost)
			}
		);

		rerender({reviewRequest: secondRequest});
		await waitFor(() => expect(result.current.page).toEqual(page));
		act(() => firstPlan.resolve({summary, type: 'complete'}));
		expect(coreProjectHost.queryRefactorPlanDetailAsync).toHaveBeenCalledTimes(
			1
		);
	});

	it('releases the bounded review and ignores late work on close and unmount', async () => {
		const planning = deferred<any>();
		const coreProjectHost = host({
			planPassageRename: jest.fn().mockReturnValue(planning.promise)
		});
		const {result, unmount} = renderHook(
			() => usePassageRenameReview(request, jest.fn()),
			{wrapper: wrapper(coreProjectHost)}
		);

		act(() => result.current.closeBoundary());
		expect(coreProjectHost.closeRefactorReview).toHaveBeenCalledWith(story.id);
		unmount();
		act(() => planning.resolve({summary, type: 'complete'}));
		expect(coreProjectHost.queryRefactorPlanDetailAsync).not.toHaveBeenCalled();
	});

	it('releases review ownership and ignores late planning after unmount', () => {
		const planning = deferred<any>();
		const coreProjectHost = host({
			planPassageRename: jest.fn().mockReturnValue(planning.promise)
		});
		const {unmount} = renderHook(
			() => usePassageRenameReview(request, jest.fn()),
			{wrapper: wrapper(coreProjectHost)}
		);

		unmount();
		expect(coreProjectHost.closeRefactorReview).toHaveBeenCalledWith(story.id);
		act(() => planning.resolve({summary, type: 'complete'}));
		expect(coreProjectHost.queryRefactorPlanDetailAsync).not.toHaveBeenCalled();
	});
});
