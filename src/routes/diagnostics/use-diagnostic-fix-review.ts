import * as React from 'react';
import type {CoreProjectHost} from '../../core';
import type {PlanDiagnosticFixesRequest} from '../../core/bindings/PlanDiagnosticFixesRequest';
import type {RefactorPlanCursor} from '../../core/bindings/RefactorPlanCursor';
import type {RefactorPlanDetailPage} from '../../core/bindings/RefactorPlanDetailPage';
import type {RefactorPlanSummary} from '../../core/bindings/RefactorPlanSummary';

export interface DiagnosticFixReviewError {
	code: string;
	message: string;
}

export interface DiagnosticFixReviewController {
	applying: boolean;
	closeBoundary: () => void;
	cursor?: RefactorPlanCursor;
	error?: DiagnosticFixReviewError;
	handleApply: () => void;
	handleNextPage: () => void;
	handlePreviousPage: () => void;
	handleRetry: () => void;
	page?: RefactorPlanDetailPage;
	paging: boolean;
	showPreviousPage: boolean;
	summary?: RefactorPlanSummary;
}

function reviewError(error: unknown): DiagnosticFixReviewError {
	if (
		error &&
		typeof error === 'object' &&
		'code' in error &&
		'message' in error
	)
		return error as DiagnosticFixReviewError;
	return {
		code: 'unexpected-error',
		message: error instanceof Error ? error.message : String(error)
	};
}

/** Owns immutable diagnostic-fix planning, review paging, apply, and cleanup. */
export function useDiagnosticFixReview(
	host: CoreProjectHost,
	request: PlanDiagnosticFixesRequest | undefined,
	onApplied: () => void
): DiagnosticFixReviewController {
	const requestRef = React.useRef(request);
	const onAppliedRef = React.useRef(onApplied);
	const mountedRef = React.useRef(true);
	const operationGenerationRef = React.useRef(0);
	const detailGenerationRef = React.useRef(0);
	const activeStoryIdRef = React.useRef<string | undefined>(undefined);
	const pagingRef = React.useRef(false);
	const [attempt, setAttempt] = React.useState(0);
	const [summary, setSummary] = React.useState<RefactorPlanSummary>();
	const [page, setPage] = React.useState<RefactorPlanDetailPage>();
	const [cursor, setCursor] = React.useState<RefactorPlanCursor>();
	const [cursorHistory, setCursorHistory] = React.useState<
		RefactorPlanCursor[]
	>([]);
	const [error, setError] = React.useState<DiagnosticFixReviewError>();
	const [applying, setApplying] = React.useState(false);
	const [paging, setPaging] = React.useState(false);
	requestRef.current = request;
	onAppliedRef.current = onApplied;

	React.useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	const closeBoundary = React.useCallback(() => {
		operationGenerationRef.current++;
		detailGenerationRef.current++;
		pagingRef.current = false;
		setPaging(false);
		if (activeStoryIdRef.current) {
			host.closeRefactorReview(activeStoryIdRef.current);
			activeStoryIdRef.current = undefined;
		}
	}, [host]);

	const loadPage = React.useCallback(
		async (
			storyId: string,
			nextCursor: RefactorPlanCursor,
			operationGeneration: number
		): Promise<boolean> => {
			const detailGeneration = ++detailGenerationRef.current;
			setPage(undefined);
			setError(undefined);
			try {
				const result = await host.queryRefactorPlanDetailAsync(
					storyId,
					nextCursor
				);
				if (
					!mountedRef.current ||
					operationGeneration !== operationGenerationRef.current ||
					detailGeneration !== detailGenerationRef.current
				)
					return false;
				if (result.type === 'failure') {
					setError(result.failure);
					return false;
				}
				setCursor(nextCursor);
				setPage(result.page);
				return true;
			} catch (loadError) {
				if (
					mountedRef.current &&
					operationGeneration === operationGenerationRef.current &&
					detailGeneration === detailGenerationRef.current
				)
					setError(reviewError(loadError));
				return false;
			}
		},
		[host]
	);

	React.useEffect(() => {
		if (!request) {
			setSummary(undefined);
			setPage(undefined);
			setCursor(undefined);
			setCursorHistory([]);
			setError(undefined);
			setApplying(false);
			pagingRef.current = false;
			setPaging(false);
			return;
		}

		const operationGeneration = ++operationGenerationRef.current;
		activeStoryIdRef.current = request.storyId;
		setSummary(undefined);
		setPage(undefined);
		setCursor(undefined);
		setCursorHistory([]);
		setError(undefined);
		setApplying(false);
		pagingRef.current = false;
		setPaging(false);
		detailGenerationRef.current++;

		void (async () => {
			try {
				const result = await host.planDiagnosticFixes(request.storyId, request);
				if (
					!mountedRef.current ||
					operationGeneration !== operationGenerationRef.current
				)
					return;
				if (result.type === 'failure') return setError(result.failure);
				setSummary(result.summary);
				await loadPage(
					request.storyId,
					result.summary.firstDetailCursor,
					operationGeneration
				);
			} catch (planError) {
				if (
					mountedRef.current &&
					operationGeneration === operationGenerationRef.current
				)
					setError(reviewError(planError));
			}
		})();

		return () => {
			if (operationGenerationRef.current === operationGeneration)
				operationGenerationRef.current++;
			detailGenerationRef.current++;
			if (activeStoryIdRef.current === request.storyId) {
				host.closeRefactorReview(request.storyId);
				activeStoryIdRef.current = undefined;
			}
		};
	}, [attempt, host, loadPage, request]);

	const handleRetry = React.useCallback(() => {
		if (!applying) {
			closeBoundary();
			setAttempt(value => value + 1);
		}
	}, [applying, closeBoundary]);

	const handleApply = React.useCallback(() => {
		const activeRequest = requestRef.current;
		if (
			!activeRequest ||
			!summary ||
			!page ||
			pagingRef.current ||
			error ||
			summary.validationFailures.length
		)
			return;
		const operationGeneration = operationGenerationRef.current;
		setApplying(true);
		setError(undefined);
		void host
			.applyRefactorPlan(activeRequest.storyId, {
				expectedProjectRevision: summary.projectRevision,
				planId: summary.planId,
				selection: {type: 'all'}
			})
			.then(result => {
				if (
					!mountedRef.current ||
					operationGeneration !== operationGenerationRef.current
				)
					return;
				if (result.type === 'failure') {
					setError(result.failure);
					setApplying(false);
					return;
				}
				onAppliedRef.current();
			})
			.catch(applyError => {
				if (
					mountedRef.current &&
					operationGeneration === operationGenerationRef.current
				) {
					setError(reviewError(applyError));
					setApplying(false);
				}
			});
	}, [error, host, page, summary]);

	const handleNextPage = React.useCallback(() => {
		const activeRequest = requestRef.current;
		if (!activeRequest || !cursor || !page?.nextCursor || pagingRef.current)
			return;
		const previousCursor = cursor;
		const nextCursor = page.nextCursor;
		const operationGeneration = operationGenerationRef.current;
		pagingRef.current = true;
		setPaging(true);
		void loadPage(activeRequest.storyId, nextCursor, operationGeneration).then(
			succeeded => {
				if (
					succeeded &&
					mountedRef.current &&
					operationGeneration === operationGenerationRef.current
				) {
					setCursorHistory(history => [...history, previousCursor]);
				}
				if (
					mountedRef.current &&
					operationGeneration === operationGenerationRef.current
				) {
					pagingRef.current = false;
					setPaging(false);
				}
			}
		);
	}, [cursor, loadPage, page]);

	const handlePreviousPage = React.useCallback(() => {
		const activeRequest = requestRef.current;
		const previous = cursorHistory.at(-1);
		if (!activeRequest || !previous || pagingRef.current) return;
		const operationGeneration = operationGenerationRef.current;
		pagingRef.current = true;
		setPaging(true);
		void loadPage(activeRequest.storyId, previous, operationGeneration).then(
			succeeded => {
				if (
					succeeded &&
					mountedRef.current &&
					operationGeneration === operationGenerationRef.current
				) {
					setCursorHistory(history => history.slice(0, -1));
				}
				if (
					mountedRef.current &&
					operationGeneration === operationGenerationRef.current
				) {
					pagingRef.current = false;
					setPaging(false);
				}
			}
		);
	}, [cursorHistory, loadPage]);

	return {
		applying,
		closeBoundary,
		cursor,
		error,
		handleApply,
		handleNextPage,
		handlePreviousPage,
		handleRetry,
		page,
		paging,
		showPreviousPage: cursorHistory.length > 0,
		summary
	};
}
