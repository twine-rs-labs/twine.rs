import {act, renderHook, waitFor} from '@testing-library/react';
import type {CoreProjectHost} from '../../../core';
import type {ProjectReplaceReviewRequest} from '../use-project-replace-review';
import {useProjectReplaceReview} from '../use-project-replace-review';

function deferred<T>() {
	let resolve!: (value: T) => void;
	return {
		promise: new Promise<T>(nextResolve => (resolve = nextResolve)),
		resolve
	};
}

describe('useProjectReplaceReview', () => {
	const request: ProjectReplaceReviewRequest = {
		includePassageNames: false,
		includePassageText: true,
		includeScript: false,
		includeStylesheet: false,
		matchCase: true,
		query: 'before',
		replacement: 'after',
		storyId: 'story',
		useRegexes: false
	};
	const nextCursor = {planDigest: 'digest', planId: 'plan', position: 1};
	const summary = {
		affectedEntityCount: 2,
		changeCount: 2,
		coverage: 'selected-project-sources',
		expiresAtEpochMs: Date.now() + 60_000,
		firstDetailCursor: {planDigest: 'digest', planId: 'plan', position: 0},
		operationKind: 'project-replace',
		planDigest: 'digest',
		planId: 'plan',
		projectRevision: 4,
		selectionCapabilities: {
			all: true,
			exclusions: true,
			groups: true,
			only: true
		},
		validationFailures: []
	};
	const change = (changeId: string) => ({
		affectedEntity: {
			entityId: changeId,
			kind: 'passage' as const,
			storyId: 'story'
		},
		after: {type: 'text' as const, value: 'after'},
		before: {type: 'text' as const, value: 'before'},
		changeId,
		dependencies: [],
		description: changeId,
		groupId: null,
		kind: 'text-edit' as const,
		location: null
	});
	const firstPage = {changes: [change('first')], nextCursor};
	const secondPage = {changes: [change('second')], nextCursor: null};

	function host(overrides: Partial<CoreProjectHost> = {}) {
		return {
			applyRefactorPlan: jest
				.fn()
				.mockResolvedValue({batch: {}, receipt: {}, type: 'applied'}),
			closeRefactorReview: jest.fn(),
			planProjectReplace: jest
				.fn()
				.mockResolvedValue({summary, type: 'complete'}),
			queryRefactorPlanDetailAsync: jest
				.fn()
				.mockResolvedValueOnce({page: firstPage, type: 'page'})
				.mockResolvedValueOnce({page: secondPage, type: 'page'}),
			...overrides
		} as unknown as CoreProjectHost;
	}

	it('uses compact all by default and retains allExcept exclusions across pages', async () => {
		const projectHost = host();
		const onApplied = jest.fn();
		const {result} = renderHook(() =>
			useProjectReplaceReview(projectHost, request, onApplied)
		);

		await waitFor(() => expect(result.current.page).toEqual(firstPage));
		act(() => result.current.handleToggleChange('first'));
		act(() => result.current.handleNextPage());
		await waitFor(() => expect(result.current.page).toEqual(secondPage));
		expect(result.current.excludedChangeIds).toEqual(new Set(['first']));
		act(() => result.current.handleApply());
		await waitFor(() =>
			expect(projectHost.applyRefactorPlan).toHaveBeenCalledWith('story', {
				expectedProjectRevision: 4,
				planId: 'plan',
				selection: {changeIds: ['first'], type: 'allExcept'}
			})
		);
		await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
	});

	it('submits no selected ID list for the default all selection', async () => {
		const projectHost = host();
		const {result} = renderHook(() =>
			useProjectReplaceReview(projectHost, request, jest.fn())
		);

		await waitFor(() => expect(result.current.page).toEqual(firstPage));
		act(() => result.current.handleApply());
		await waitFor(() =>
			expect(projectHost.applyRefactorPlan).toHaveBeenCalledWith('story', {
				expectedProjectRevision: 4,
				planId: 'plan',
				selection: {type: 'all'}
			})
		);
	});

	it('ignores late planning from a replaced request', async () => {
		const firstPlan = deferred<any>();
		const projectHost = host({
			planProjectReplace: jest
				.fn()
				.mockReturnValueOnce(firstPlan.promise)
				.mockResolvedValueOnce({summary, type: 'complete'})
		});
		const nextRequest = {...request, query: 'current'};
		const {rerender, result} = renderHook(
			({reviewRequest}) =>
				useProjectReplaceReview(projectHost, reviewRequest, jest.fn()),
			{initialProps: {reviewRequest: request}}
		);

		rerender({reviewRequest: nextRequest});
		await waitFor(() => expect(result.current.page).toEqual(firstPage));
		act(() => firstPlan.resolve({summary, type: 'complete'}));
		expect(projectHost.queryRefactorPlanDetailAsync).toHaveBeenCalledTimes(1);
		expect(projectHost.closeRefactorReview).toHaveBeenCalledWith('story');
	});

	it('aborts and releases bounded review ownership on close and unmount', () => {
		const planning = deferred<any>();
		const projectHost = host({
			planProjectReplace: jest.fn().mockReturnValue(planning.promise)
		});
		const {result, unmount} = renderHook(() =>
			useProjectReplaceReview(projectHost, request, jest.fn())
		);

		act(() => result.current.closeBoundary());
		expect(projectHost.closeRefactorReview).toHaveBeenCalledWith('story');
		unmount();
		act(() => planning.resolve({summary, type: 'complete'}));
		expect(projectHost.queryRefactorPlanDetailAsync).not.toHaveBeenCalled();
	});
});
