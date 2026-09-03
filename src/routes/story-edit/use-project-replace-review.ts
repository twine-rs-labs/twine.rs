import * as React from 'react';
import type {ProjectReplaceReviewError} from '../../components/story/project-replace-review';
import type {CoreProjectHost} from '../../core';
import type {PlanProjectReplaceRequest} from '../../core/bindings/PlanProjectReplaceRequest';
import type {RefactorPlanCursor} from '../../core/bindings/RefactorPlanCursor';
import type {RefactorPlanDetailPage} from '../../core/bindings/RefactorPlanDetailPage';
import type {RefactorPlanSummary} from '../../core/bindings/RefactorPlanSummary';

export interface ProjectReplaceReviewRequest extends PlanProjectReplaceRequest {}

export interface ProjectReplaceReviewController {
	applying: boolean;
	closeBoundary: () => void;
	cursor?: RefactorPlanCursor;
	error?: ProjectReplaceReviewError;
	excludedChangeIds: ReadonlySet<string>;
	handleApply: () => void;
	handleNextPage: () => void;
	handlePreviousPage: () => void;
	handleRetry: () => void;
	handleToggleChange: (changeId: string) => void;
	page?: RefactorPlanDetailPage;
	progress?: {scanned: number; total: number};
	showPreviousPage: boolean;
	summary?: RefactorPlanSummary;
}

function reviewError(error: unknown): ProjectReplaceReviewError {
	if (
		error &&
		typeof error === 'object' &&
		'code' in error &&
		'message' in error
	)
		return error as ProjectReplaceReviewError;
	return {
		code: 'unexpected-error',
		message: error instanceof Error ? error.message : String(error)
	};
}

/** Owns immutable project-replacement planning, review paging, and cleanup. */
export function useProjectReplaceReview(
	host: CoreProjectHost,
	request: ProjectReplaceReviewRequest | undefined,
	onApplied: () => void
): ProjectReplaceReviewController {
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
	const [error, setError] = React.useState<ProjectReplaceReviewError>();
	const [applying, setApplying] = React.useState(false);
	const [excludedChangeIds, setExcludedChangeIds] = React.useState<
		ReadonlySet<string>
	>(new Set());
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
			host.closeRefactorReview(activeStoryIdRef.current);
			activeStoryIdRef.current = undefined;
		}
	}, [host]);

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
				const result = await host.queryRefactorPlanDetailAsync(
					storyId,
					nextCursor
				);
				if (
					!mountedRef.current ||
					operationGeneration !== operationGenerationRef.current ||
					detailGeneration !== detailGenerationRef.current
				)
					return;
				if (result.type === 'failure') return setError(result.failure);
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
		[host]
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
			setExcludedChangeIds(new Set());
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
		setExcludedChangeIds(new Set());
		detailGenerationRef.current++;
		void (async () => {
			try {
				const result = await host.planProjectReplace(request.storyId, request, {
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
				});
				if (
					!mountedRef.current ||
					controller.signal.aborted ||
					operationGeneration !== operationGenerationRef.current
				)
					return;
				if (result.type === 'failure') return setError(result.failure);
				if (result.type === 'cancelled')
					return setError({
						code: 'planning-cancelled',
						message:
							'Project replacement planning was cancelled. Retry the review.'
					});
				if (result.type === 'pending')
					return setError({
						code: 'unexpected-pending-result',
						message:
							'Project replacement planning did not reach a final result.'
					});
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
			error ||
			summary.validationFailures.length
		)
			return;
		const operationGeneration = operationGenerationRef.current;
		setApplying(true);
		setError(undefined);
		const selection = excludedChangeIds.size
			? {type: 'allExcept' as const, changeIds: [...excludedChangeIds]}
			: {type: 'all' as const};
		void host
			.applyRefactorPlan(activeRequest.storyId, {
				expectedProjectRevision: summary.projectRevision,
				planId: summary.planId,
				selection
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
	}, [error, excludedChangeIds, host, page, summary]);
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
		const previous = cursorHistory.at(-1);
		if (!activeRequest || !previous) return;
		setCursorHistory(history => history.slice(0, -1));
		void loadPage(
			activeRequest.storyId,
			previous,
			operationGenerationRef.current
		);
	}, [cursorHistory, loadPage]);
	const handleToggleChange = React.useCallback(
		(changeId: string) =>
			setExcludedChangeIds(ids => {
				const next = new Set(ids);
				if (next.has(changeId)) next.delete(changeId);
				else next.add(changeId);
				return next;
			}),
		[]
	);
	return {
		applying,
		closeBoundary,
		cursor,
		error,
		excludedChangeIds,
		handleApply,
		handleNextPage,
		handlePreviousPage,
		handleRetry,
		handleToggleChange,
		page,
		progress,
		showPreviousPage: cursorHistory.length > 0,
		summary
	};
}
