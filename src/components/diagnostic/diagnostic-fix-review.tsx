import * as React from 'react';
import * as ReactDOM from 'react-dom';
import {Badge, Button, IconButton} from '../design-system';
import type {RefactorPlanCursor} from '../../core/bindings/RefactorPlanCursor';
import type {RefactorPlanDetail} from '../../core/bindings/RefactorPlanDetail';
import type {RefactorPlanDetailPage} from '../../core/bindings/RefactorPlanDetailPage';
import type {RefactorPlanSummary} from '../../core/bindings/RefactorPlanSummary';
import type {DiagnosticFixReviewError} from '../../routes/diagnostics/use-diagnostic-fix-review';
import './diagnostic-fix-review.css';

export interface DiagnosticFixReviewProps {
	applying: boolean;
	cursor?: RefactorPlanCursor;
	error?: DiagnosticFixReviewError;
	onApply: () => void;
	onClose: () => void;
	onNextPage: () => void;
	onPreviousPage: () => void;
	onRetry: () => void;
	page?: RefactorPlanDetailPage;
	paging: boolean;
	showPreviousPage: boolean;
	summary?: RefactorPlanSummary;
}

function valueText(value: RefactorPlanDetail['before']) {
	if (!value) return '—';
	if ('value' in value)
		return typeof value.value === 'string'
			? value.value
			: JSON.stringify(value.value);
	if (value.type === 'passage') return value.passage.name;
	return JSON.stringify(value);
}

/** Pure presentation of a route-owned immutable diagnostic-fix plan. */
export const DiagnosticFixReview: React.FC<
	DiagnosticFixReviewProps
> = props => {
	const {
		applying,
		cursor,
		error,
		onApply,
		onClose,
		onNextPage,
		onPreviousPage,
		onRetry,
		page,
		paging,
		showPreviousPage,
		summary
	} = props;
	const titleRef = React.useRef<HTMLHeadingElement>(null);

	React.useEffect(() => titleRef.current?.focus(), []);
	React.useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === 'Escape' && !applying) {
				event.preventDefault();
				onClose();
			}
		}
		document.addEventListener('keydown', onKeyDown);
		return () => document.removeEventListener('keydown', onKeyDown);
	}, [applying, onClose]);

	const validationFailed = !!summary?.validationFailures.length;
	const visibleStart = page && cursor ? cursor.position + 1 : 0;
	const visibleEnd = page && cursor ? cursor.position + page.changes.length : 0;

	return ReactDOM.createPortal(
		<div className="diagnostic-fix-review__layer">
			<section
				aria-labelledby="diagnostic-fix-review-title"
				className="diagnostic-fix-review"
				role="dialog"
			>
				<header className="diagnostic-fix-review__header">
					<h2 id="diagnostic-fix-review-title" ref={titleRef} tabIndex={-1}>
						Review Diagnostic Fixes
					</h2>
					<IconButton
						disabled={applying}
						icon="x"
						label="Close"
						onClick={onClose}
					/>
				</header>
				<div className="diagnostic-fix-review__content">
					{!summary && !error && (
						<p aria-live="polite">Planning deterministic fixes…</p>
					)}
					{error && (
						<div className="diagnostic-fix-review__error" role="alert">
							<strong>{error.code}</strong>: {error.message}
							<Button onClick={onRetry}>Retry</Button>
						</div>
					)}
					{summary && (
						<>
							<div className="diagnostic-fix-review__summary">
								<Badge>{summary.affectedEntityCount} affected entities</Badge>
								<Badge>{summary.changeCount} changes</Badge>
								<Badge>{summary.coverage}</Badge>
							</div>
							<p>
								Plan expires{' '}
								{new Date(summary.expiresAtEpochMs).toLocaleString()}.
							</p>
							{validationFailed && (
								<div className="diagnostic-fix-review__error" role="alert">
									{summary.validationFailures.join(' ')}
								</div>
							)}
							{!page && !error && <p>Loading planned changes…</p>}
							{page && (
								<>
									<p>
										Showing {visibleStart}–{visibleEnd} of {summary.changeCount}{' '}
										changes.
									</p>
									{page.changes.map(change => (
										<article
											className="diagnostic-fix-review__change"
											key={change.changeId}
										>
											<p>{change.description}</p>
											<dl>
												<dt>Before</dt>
												<dd>{valueText(change.before)}</dd>
												<dt>After</dt>
												<dd>{valueText(change.after)}</dd>
											</dl>
										</article>
									))}
									<div className="diagnostic-fix-review__paging">
										<Button
											disabled={!showPreviousPage || applying || paging}
											onClick={onPreviousPage}
										>
											Previous
										</Button>
										<Button
											disabled={!page.nextCursor || applying || paging}
											onClick={onNextPage}
										>
											Next
										</Button>
									</div>
								</>
							)}
						</>
					)}
				</div>
				<footer className="diagnostic-fix-review__actions">
					<Button disabled={applying} onClick={onClose} variant="ghost">
						Cancel
					</Button>
					<Button
						disabled={
							!summary || !page || validationFailed || !!error || paging
						}
						loading={applying}
						onClick={onApply}
						variant="primary"
					>
						Apply Fixes
					</Button>
				</footer>
			</section>
		</div>,
		document.body
	);
};
