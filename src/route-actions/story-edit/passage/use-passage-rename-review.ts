import * as React from 'react';
import type {PassageRenameReviewError} from '../../../components/passage/passage-rename-review';
import {useCoreProjectHost} from '../../../core';
import type {RefactorPlanCursor} from '../../../core/bindings/RefactorPlanCursor';
import type {RefactorPlanDetailPage} from '../../../core/bindings/RefactorPlanDetailPage';
import type {RefactorPlanSummary} from '../../../core/bindings/RefactorPlanSummary';

export interface PassageRenameReviewRequest {
	afterName: string;
	passageId: string;
	storyId: string;
}

export interface PassageRenameReviewController {
	applying: boolean;
	closeBoundary: () => void;
	cursor?: RefactorPlanCursor;
	error?: PassageRenameReviewError;
	handleApply: () => void;
	handleNextPage: () => void;
	handlePreviousPage: () => void;
	handleRetry: () => void;
	page?: RefactorPlanDetailPage;
	progress?: {scanned: number; total: number};
	showPreviousPage: boolean;
	summary?: RefactorPlanSummary;
}

function reviewError(error: unknown): PassageRenameReviewError {
	if (
		error &&
		typeof error === 'object' &&
		'code' in error &&
		'message' in error
	) {
		return error as PassageRenameReviewError;
	}

	return {
		code: 'unexpected-error',
		message: error instanceof Error ? error.message : String(error)
	};
}

/** Owns the refactor-plan boundary for the story-edit route. */
export function usePassageRenameReview(
	request: PassageRenameReviewRequest | undefined,
	onApplied: () => void
): PassageRenameReviewController {
	const coreProjectHost = useCoreProjectHost();
	const requestRef = React.useRef(request);
	const onAppliedRef = React.useRef(onApplied);
	const mountedRef = React.useRef(true);
	const abortRef = React.useRef<AbortController | undefined>(undefined);
	const operationGenerationRef = React.useRef(0);
	const detailGenerationRef = React.useRef(0);
	const activeStoryIdRef = React.useRef<string | undefined>(undefined);
	const [attempt, setAttempt] = React.useState(0);
	const [summary, setSummary] = React.useState<RefactorPlanSummary>();
	const [page, setPage] = React.useState<RefactorPlanDetailPage>();
	const [cursor, setCursor] = React.useState<RefactorPlanCursor>();
	const [cursorHistory, setCursorHistory] = React.useState<
		RefactorPlanCursor[]
	>([]);
	const [progress, setProgress] = React.useState<{
		scanned: number;
		total: number;
	}>();
	const [error, setError] = React.useState<PassageRenameReviewError>();
	const [applying, setApplying] = React.useState(false);

	requestRef.current = request;
	onAppliedRef.current = onApplied;

	React.useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	const closeBoundary = React.useCallback(() => {
		abortRef.current?.abort();
		operationGenerationRef.current++;
		detailGenerationRef.current++;
		if (activeStoryIdRef.current) {
			coreProjectHost.closeRefactorReview(activeStoryIdRef.current);
			activeStoryIdRef.current = undefined;
		}
	}, [coreProjectHost]);

	const loadPage = React.useCallback(
		async (
			storyId: string,
			nextCursor: RefactorPlanCursor,
			operationGeneration: number
		) => {
			const detailGeneration = ++detailGenerationRef.current;
			setPage(undefined);
			setError(undefined);
			try {
				const result = await coreProjectHost.queryRefactorPlanDetailAsync(
					storyId,
					nextCursor
				);
				if (
					!mountedRef.current ||
					operationGeneration !== operationGenerationRef.current ||
					detailGeneration !== detailGenerationRef.current
				)
					return;
				if (result.type === 'failure') {
					setError(result.failure);
					return;
				}
				setCursor(nextCursor);
				setPage(result.page);
			} catch (loadError) {
				if (
					mountedRef.current &&
					operationGeneration === operationGenerationRef.current &&
					detailGeneration === detailGenerationRef.current
				)
					setError(reviewError(loadError));
			}
		},
		[coreProjectHost]
	);

	React.useEffect(() => {
		if (!request) {
			setSummary(undefined);
			setPage(undefined);
			setCursor(undefined);
			setCursorHistory([]);
			setProgress(undefined);
			setError(undefined);
			setApplying(false);
			return;
		}

		const controller = new AbortController();
		const operationGeneration = ++operationGenerationRef.current;
		abortRef.current = controller;
		activeStoryIdRef.current = request.storyId;
		setSummary(undefined);
		setPage(undefined);
		setCursor(undefined);
		setCursorHistory([]);
		setProgress(undefined);
		setError(undefined);
		setApplying(false);
		detailGenerationRef.current++;

		void (async () => {
			try {
				const result = await coreProjectHost.planPassageRename(
					request.storyId,
					request,
					{
						signal: controller.signal,
						onProgress: next => {
							if (
								!mountedRef.current ||
								controller.signal.aborted ||
								operationGeneration !== operationGenerationRef.current ||
								next.type !== 'pending'
							)
								return;
							setProgress({
								scanned: next.progress.scannedPassageCount,
								total: next.progress.totalPassageCount
							});
						}
					}
				);
				if (
					!mountedRef.current ||
					controller.signal.aborted ||
					operationGeneration !== operationGenerationRef.current
				)
					return;
				if (result.type === 'failure') {
					setError(result.failure);
					return;
				}
				if (result.type === 'cancelled') {
					setError({
						code: 'planning-cancelled',
						message: 'Passage rename planning was cancelled. Retry the review.'
					});
					return;
				}
				if (result.type === 'pending') {
					setError({
						code: 'unexpected-pending-result',
						message: 'Passage rename planning did not reach a final result.'
					});
					return;
				}
				setSummary(result.summary);
				await loadPage(
					request.storyId,
					result.summary.firstDetailCursor,
					operationGeneration
				);
			} catch (planError) {
				if (
					!controller.signal.aborted &&
					mountedRef.current &&
					operationGeneration === operationGenerationRef.current
				)
					setError(reviewError(planError));
			}
		})();

		return () => {
			controller.abort();
			if (abortRef.current === controller) abortRef.current = undefined;
			if (operationGenerationRef.current === operationGeneration)
				operationGenerationRef.current++;
			detailGenerationRef.current++;
			if (activeStoryIdRef.current === request.storyId) {
				coreProjectHost.closeRefactorReview(request.storyId);
				activeStoryIdRef.current = undefined;
			}
		};
	}, [attempt, coreProjectHost, loadPage, request]);

	const handleRetry = React.useCallback(() => {
		if (applying) return;
		closeBoundary();
		setAttempt(value => value + 1);
	}, [applying, closeBoundary]);

	const handleApply = React.useCallback(() => {
		const activeRequest = requestRef.current;
		if (
			!activeRequest ||
			!summary ||
			!page ||
			error ||
			summary.validationFailures.length > 0
		)
			return;
		const operationGeneration = operationGenerationRef.current;
		setApplying(true);
		setError(undefined);
		void (async () => {
			try {
				const result = await coreProjectHost.applyRefactorPlan(
					activeRequest.storyId,
					{
						expectedProjectRevision: summary.projectRevision,
						planId: summary.planId,
						selection: {type: 'all'}
					}
				);
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
			} catch (applyError) {
				if (
					mountedRef.current &&
					operationGeneration === operationGenerationRef.current
				) {
					setError(reviewError(applyError));
					setApplying(false);
				}
			}
		})();
	}, [coreProjectHost, error, page, summary]);

	const handleNextPage = React.useCallback(() => {
		const activeRequest = requestRef.current;
		if (!activeRequest || !cursor || !page?.nextCursor) return;
		setCursorHistory(history => [...history, cursor]);
		void loadPage(
			activeRequest.storyId,
			page.nextCursor,
			operationGenerationRef.current
		);
	}, [cursor, loadPage, page]);

	const handlePreviousPage = React.useCallback(() => {
		const activeRequest = requestRef.current;
		const previous = cursorHistory[cursorHistory.length - 1];
		if (!activeRequest || !previous) return;
		setCursorHistory(history => history.slice(0, -1));
		void loadPage(
			activeRequest.storyId,
			previous,
			operationGenerationRef.current
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
		progress,
		showPreviousPage: cursorHistory.length > 0,
		summary
	};
}
