import * as React from 'react';
import * as ReactDOM from 'react-dom';
import {useTranslation} from 'react-i18next';
import {Badge, Button, Checkbox, IconButton} from '../design-system';
import type {RefactorPlanCursor} from '../../core/bindings/RefactorPlanCursor';
import type {RefactorPlanDetail} from '../../core/bindings/RefactorPlanDetail';
import type {RefactorPlanDetailPage} from '../../core/bindings/RefactorPlanDetailPage';
import type {RefactorPlanSummary} from '../../core/bindings/RefactorPlanSummary';
import './project-replace-review.css';

export interface ProjectReplaceReviewError {
	code: string;
	message: string;
}
export interface ProjectReplaceReviewProps {
	applying: boolean;
	cursor?: RefactorPlanCursor;
	error?: ProjectReplaceReviewError;
	excludedChangeIds: ReadonlySet<string>;
	onApply: () => void;
	onClose: () => void;
	onNextPage: () => void;
	onPreviousPage: () => void;
	onRetry: () => void;
	onToggleChange: (changeId: string) => void;
	page?: RefactorPlanDetailPage;
	progress?: {scanned: number; total: number};
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

/** Nonmodal presentation of route-owned immutable project replacement review state. */
export const ProjectReplaceReview: React.FC<
	ProjectReplaceReviewProps
> = props => {
	const {
		applying,
		cursor,
		error,
		excludedChangeIds,
		onApply,
		onClose,
		onNextPage,
		onPreviousPage,
		onRetry,
		onToggleChange,
		page,
		progress,
		showPreviousPage,
		summary
	} = props;
	const {t} = useTranslation();
	const titleRef = React.useRef<HTMLHeadingElement>(null);
	React.useEffect(() => titleRef.current?.focus(), []);
	React.useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape' && !applying) {
				event.preventDefault();
				onClose();
			}
		};
		document.addEventListener('keydown', onKeyDown);
		return () => document.removeEventListener('keydown', onKeyDown);
	}, [applying, onClose]);
	const validationFailed = !!summary?.validationFailures.length;
	const canExclude = !!summary?.selectionCapabilities.exclusions;
	const visibleStart = page && cursor ? cursor.position + 1 : 0;
	const visibleEnd = page && cursor ? cursor.position + page.changes.length : 0;
	return ReactDOM.createPortal(
		<div className="project-replace-review__layer">
			<section
				aria-labelledby="project-replace-review-title"
				className="project-replace-review"
				role="dialog"
			>
				<header className="project-replace-review__header">
					<h2 id="project-replace-review-title" ref={titleRef} tabIndex={-1}>
						{t('components.projectReplaceReview.title')}
					</h2>
					<IconButton
						disabled={applying}
						icon="x"
						label={t('common.close')}
						onClick={onClose}
					/>
				</header>
				<div className="project-replace-review__content">
					{!summary && !error && (
						<p aria-live="polite">
							{progress
								? t(
										'components.projectReplaceReview.planningProgress',
										progress
									)
								: t('components.projectReplaceReview.planning')}
						</p>
					)}
					{error && (
						<div className="project-replace-review__error" role="alert">
							<strong>{error.code}</strong>: {error.message}
							<Button onClick={onRetry}>
								{t('components.projectReplaceReview.retry')}
							</Button>
						</div>
					)}
					{summary && (
						<>
							<div className="project-replace-review__summary">
								<Badge>
									{t('components.projectReplaceReview.affectedEntities', {
										count: summary.affectedEntityCount
									})}
								</Badge>
								<Badge>
									{t('components.projectReplaceReview.changes', {
										count: summary.changeCount
									})}
								</Badge>
							</div>
							{validationFailed && (
								<div className="project-replace-review__error" role="alert">
									{summary.validationFailures.join(' ')}
								</div>
							)}
							{!page && !error && (
								<p>{t('components.projectReplaceReview.loadingChanges')}</p>
							)}
							{page && (
								<>
									<p>
										{t('components.projectReplaceReview.visibleChanges', {
											start: visibleStart,
											end: visibleEnd,
											total: summary.changeCount
										})}
									</p>
									{page.changes.map(change => {
										const selectable = canExclude && !change.groupId;
										const checked = !excludedChangeIds.has(change.changeId);
										return (
											<article
												className="project-replace-review__change"
												key={change.changeId}
											>
												<Checkbox
													checked={checked}
													disabled={!selectable || applying}
													label={
														selectable
															? t(
																	'components.projectReplaceReview.includeChange'
																)
															: t(
																	'components.projectReplaceReview.requiredGroup'
																)
													}
													onChange={() => onToggleChange(change.changeId)}
												/>
												<p>{change.description}</p>
												<dl>
													<dt>{t('components.projectReplaceReview.before')}</dt>
													<dd>{valueText(change.before)}</dd>
													<dt>{t('components.projectReplaceReview.after')}</dt>
													<dd>{valueText(change.after)}</dd>
												</dl>
											</article>
										);
									})}
									<div className="project-replace-review__paging">
										<Button
											disabled={!showPreviousPage || applying}
											onClick={onPreviousPage}
										>
											{t('components.projectReplaceReview.previous')}
										</Button>
										<Button
											disabled={!page.nextCursor || applying}
											onClick={onNextPage}
										>
											{t('common.next')}
										</Button>
									</div>
								</>
							)}
						</>
					)}
				</div>
				<footer className="project-replace-review__actions">
					<Button disabled={applying} onClick={onClose} variant="ghost">
						{t('common.cancel')}
					</Button>
					<Button
						disabled={!summary || !page || validationFailed || !!error}
						loading={applying}
						onClick={onApply}
						variant="primary"
					>
						{t('components.projectReplaceReview.apply')}
					</Button>
				</footer>
			</section>
		</div>,
		document.body
	);
};
