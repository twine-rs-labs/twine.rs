import {act, renderHook, waitFor} from '@testing-library/react';
import type {CoreProjectHost} from '../../../core';
import type {PlanDiagnosticFixesRequest} from '../../../core/bindings/PlanDiagnosticFixesRequest';
import {useDiagnosticFixReview} from '../use-diagnostic-fix-review';

function deferred<T>() {
	let resolve!: (value: T) => void;
	return {
		promise: new Promise<T>(nextResolve => (resolve = nextResolve)),
		resolve
	};
}

describe('useDiagnosticFixReview', () => {
	const request: PlanDiagnosticFixesRequest = {
		selection: {
			fixes: [
				{diagnosticId: 'diagnostic', quickFixCommand: 'create-passage:Missing'}
			],
			type: 'only'
		},
		storyId: 'story'
	};
	const summary = {
		affectedEntityCount: 1,
		changeCount: 1,
		coverage: 'deterministic-safe-fixes',
		expiresAtEpochMs: Date.now() + 60_000,
		firstDetailCursor: {planDigest: 'digest', planId: 'plan', position: 0},
		operationKind: 'diagnostic-fixes',
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
	const page = {changes: [], nextCursor: null};

	function host(overrides: Partial<CoreProjectHost> = {}) {
		return {
			applyRefactorPlan: jest
				.fn()
				.mockResolvedValue({batch: {}, receipt: {}, type: 'applied'}),
			closeRefactorReview: jest.fn(),
			planDiagnosticFixes: jest
				.fn()
				.mockResolvedValue({summary, type: 'complete'}),
			queryRefactorPlanDetailAsync: jest
				.fn()
				.mockResolvedValue({page, type: 'page'}),
			...overrides
		} as unknown as CoreProjectHost;
	}

	it('loads the immutable plan details and applies the complete plan', async () => {
		const projectHost = host();
		const onApplied = jest.fn();
		const {result} = renderHook(() =>
			useDiagnosticFixReview(projectHost, request, onApplied)
		);

		await waitFor(() => expect(result.current.page).toEqual(page));
		expect(projectHost.planDiagnosticFixes).toHaveBeenCalledWith(
			'story',
			request
		);
		expect(projectHost.queryRefactorPlanDetailAsync).toHaveBeenCalledWith(
			'story',
			summary.firstDetailCursor
		);
		act(() => result.current.handleApply());
		await waitFor(() =>
			expect(projectHost.applyRefactorPlan).toHaveBeenCalledWith('story', {
				expectedProjectRevision: 4,
				planId: 'plan',
				selection: {type: 'all'}
			})
		);
		await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
	});

	it('ignores a late plan from a replaced request and releases review ownership', async () => {
		const firstPlan = deferred<any>();
		const projectHost = host({
			planDiagnosticFixes: jest
				.fn()
				.mockReturnValueOnce(firstPlan.promise)
				.mockResolvedValueOnce({summary, type: 'complete'})
		});
		const nextRequest: PlanDiagnosticFixesRequest = {
			selection: {excludedDiagnosticIds: [], type: 'allSafe'},
			storyId: 'next-story'
		};
		const {rerender, result} = renderHook(
			({reviewRequest}) =>
				useDiagnosticFixReview(projectHost, reviewRequest, jest.fn()),
			{initialProps: {reviewRequest: request}}
		);

		rerender({reviewRequest: nextRequest});
		await waitFor(() => expect(result.current.page).toEqual(page));
		act(() => firstPlan.resolve({summary, type: 'complete'}));
		expect(projectHost.queryRefactorPlanDetailAsync).toHaveBeenCalledTimes(1);
		expect(projectHost.closeRefactorReview).toHaveBeenCalledWith('story');
	});

	it('blocks apply on planning failure and closes bounded ownership', async () => {
		const projectHost = host({
			planDiagnosticFixes: jest.fn().mockResolvedValue({
				failure: {code: 'stale-plan', message: 'Diagnostic changed.'},
				type: 'failure'
			})
		});
		const {result, unmount} = renderHook(() =>
			useDiagnosticFixReview(projectHost, request, jest.fn())
		);

		await waitFor(() => expect(result.current.error?.code).toBe('stale-plan'));
		act(() => result.current.handleApply());
		expect(projectHost.applyRefactorPlan).not.toHaveBeenCalled();
		unmount();
		expect(projectHost.closeRefactorReview).toHaveBeenCalledWith('story');
	});

	it('serializes rapid next and previous intents and updates history only after success', async () => {
		const nextPage = deferred<any>();
		const previousPage = deferred<any>();
		const firstPage = {
			changes: [],
			nextCursor: {planDigest: 'digest', planId: 'plan', position: 250}
		};
		const secondPage = {changes: [], nextCursor: null};
		const queryDetail = jest
			.fn()
			.mockResolvedValueOnce({page: firstPage, type: 'page'})
			.mockReturnValueOnce(nextPage.promise)
			.mockReturnValueOnce(previousPage.promise);
		const projectHost = host({queryRefactorPlanDetailAsync: queryDetail});
		const {result} = renderHook(() =>
			useDiagnosticFixReview(projectHost, request, jest.fn())
		);

		await waitFor(() => expect(result.current.page).toEqual(firstPage));
		act(() => {
			result.current.handleNextPage();
			result.current.handleNextPage();
		});
		expect(queryDetail).toHaveBeenCalledTimes(2);
		expect(result.current.paging).toBe(true);
		expect(result.current.showPreviousPage).toBe(false);

		act(() => nextPage.resolve({page: secondPage, type: 'page'}));
		await waitFor(() => expect(result.current.page).toEqual(secondPage));
		expect(result.current.showPreviousPage).toBe(true);
		expect(result.current.paging).toBe(false);

		act(() => {
			result.current.handlePreviousPage();
			result.current.handlePreviousPage();
		});
		expect(queryDetail).toHaveBeenCalledTimes(3);
		expect(result.current.paging).toBe(true);

		act(() => previousPage.resolve({page: firstPage, type: 'page'}));
		await waitFor(() => expect(result.current.page).toEqual(firstPage));
		expect(result.current.showPreviousPage).toBe(false);
		expect(result.current.paging).toBe(false);
	});
});
