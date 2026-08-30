import * as React from 'react';
import * as ReactDOM from 'react-dom';
import {useTranslation} from 'react-i18next';
import {Badge, Button, IconButton} from '../design-system';
import type {RefactorPlanCursor} from '../../core/bindings/RefactorPlanCursor';
import type {RefactorPlanDetail} from '../../core/bindings/RefactorPlanDetail';
import type {RefactorPlanDetailPage} from '../../core/bindings/RefactorPlanDetailPage';
import type {RefactorPlanSummary} from '../../core/bindings/RefactorPlanSummary';
import {Passage, Story} from '../../store/stories';
import './passage-rename-review.css';

export interface PassageRenameReviewError {
	code: string;
	message: string;
}

export interface PassageRenameReviewProps {
	afterName: string;
	applying: boolean;
	cursor?: RefactorPlanCursor;
	error?: PassageRenameReviewError;
	onApply: () => void;
	onClose: () => void;
	onNextPage: () => void;
	onPreviousPage: () => void;
	onRetry: () => void;
	page?: RefactorPlanDetailPage;
	passage: Passage;
	progress?: {scanned: number; total: number};
	showPreviousPage: boolean;
	story: Story;
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

function entityLabel(change: RefactorPlanDetail, story: Story) {
	if (change.affectedEntity.kind === 'passage') {
		const passage = story.passages.find(
			candidate => candidate.id === change.affectedEntity.entityId
		);
		if (passage) return passage.name;
	}

	return `${change.affectedEntity.kind}: ${change.affectedEntity.entityId}`;
}

function coverageLabel(coverage: string, t: (key: string) => string) {
	const key = `components.renamePassageReview.coverage.${coverage}`;
	const translated = t(key);
	return translated === key
		? t('components.renamePassageReview.coverage.unknown')
		: translated;
}

/**
 * A bounded, nonmodal projection of route-owned rename review state.
 *
 * This component intentionally has no project-host dependency: it renders
 * immutable review DTOs and emits user intents, while the route controller owns
 * planning, paging, applying, and cleanup.
 */
export const PassageRenameReview: React.FC<
	PassageRenameReviewProps
> = props => {
	const {
		afterName,
		applying,
		cursor,
		error,
		onApply,
		onClose,
		onNextPage,
		onPreviousPage,
		onRetry,
		page,
		passage,
		progress,
		showPreviousPage,
		story,
		summary
	} = props;
	const {t} = useTranslation();
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

	const groupedChanges = React.useMemo(() => {
		const groups = new Map<string, RefactorPlanDetail[]>();
		for (const change of page?.changes ?? []) {
			const key = entityLabel(change, story);
			groups.set(key, [...(groups.get(key) ?? []), change]);
		}
		return [...groups.entries()];
	}, [page, story]);
	const validationFailed = !!summary?.validationFailures.length;
	const visibleStart = page && cursor ? cursor.position + 1 : 0;
	const visibleEnd = page && cursor ? cursor.position + page.changes.length : 0;

	return ReactDOM.createPortal(
		<div className="passage-rename-review__layer">
			<section
				aria-labelledby="passage-rename-review-title"
				className="passage-rename-review"
				role="dialog"
			>
				<header className="passage-rename-review__header">
					<h2 id="passage-rename-review-title" ref={titleRef} tabIndex={-1}>
						{t('components.renamePassageReview.title')}
					</h2>
					<IconButton
						disabled={applying}
						icon="x"
						label={t('common.close')}
						onClick={onClose}
					/>
				</header>
				<div className="passage-rename-review__content">
					{!summary && !error && (
						<p aria-live="polite">
							{progress
								? t('components.renamePassageReview.planningProgress', progress)
								: t('components.renamePassageReview.planning')}
						</p>
					)}
					{error && (
						<div className="passage-rename-review__error" role="alert">
							<strong>{error.code}</strong>: {error.message}
							<Button onClick={onRetry} variant="default">
								{t('components.renamePassageReview.retry')}
							</Button>
						</div>
					)}
					{summary && (
						<>
							<p className="passage-rename-review__rename">
								{t('components.renamePassageReview.rename', {
									afterName,
									beforeName: passage.name
								})}
							</p>
							<div className="passage-rename-review__summary">
								<Badge>
									{t('components.renamePassageReview.affectedEntities', {
										count: summary.affectedEntityCount
									})}
								</Badge>
								<Badge>
									{t('components.renamePassageReview.changes', {
										count: summary.changeCount
									})}
								</Badge>
								<Badge>{coverageLabel(summary.coverage, t)}</Badge>
							</div>
							<p>
								{t('components.renamePassageReview.expires', {
									date: new Date(summary.expiresAtEpochMs).toLocaleString()
								})}
							</p>
							{summary.coverage === 'standard-links-only' && (
								<p className="passage-rename-review__warning" role="note">
									{t('components.renamePassageReview.standardLinksOnly')}
								</p>
							)}
							{validationFailed && (
								<div className="passage-rename-review__error" role="alert">
									{summary.validationFailures.join(' ')}
								</div>
							)}
							{!page && !error && (
								<p>{t('components.renamePassageReview.loadingChanges')}</p>
							)}
							{page && (
								<>
									<p>
										{t('components.renamePassageReview.visibleChanges', {
											end: visibleEnd,
											start: visibleStart,
											total: summary.changeCount
										})}
									</p>
									{groupedChanges.map(([entity, changes]) => (
										<section
											className="passage-rename-review__group"
											key={entity}
										>
											<h3>{entity}</h3>
											{changes.map(change => (
												<article
													className="passage-rename-review__change"
													key={change.changeId}
												>
													<p>{change.description}</p>
													<dl>
														<dt>
															{t('components.renamePassageReview.before')}
														</dt>
														<dd>{valueText(change.before)}</dd>
														<dt>{t('components.renamePassageReview.after')}</dt>
														<dd>{valueText(change.after)}</dd>
														{change.location && (
															<>
																<dt>
																	{t(
																		'components.renamePassageReview.utf16Offsets'
																	)}
																</dt>
																<dd>
																	{change.location.span.start}–
																	{change.location.span.end}
																</dd>
															</>
														)}
													</dl>
												</article>
											))}
										</section>
									))}
									<div className="passage-rename-review__paging">
										<Button
											disabled={!showPreviousPage}
											onClick={onPreviousPage}
										>
											{t('components.renamePassageReview.previous')}
										</Button>
										<Button disabled={!page.nextCursor} onClick={onNextPage}>
											{t('common.next')}
										</Button>
									</div>
								</>
							)}
						</>
					)}
				</div>
				<footer className="passage-rename-review__actions">
					<Button disabled={applying} onClick={onClose} variant="ghost">
						{t('common.cancel')}
					</Button>
					<Button
						disabled={!summary || !page || validationFailed || !!error}
						loading={applying}
						onClick={onApply}
						variant="primary"
					>
						{t('components.renamePassageReview.apply')}
					</Button>
				</footer>
			</section>
		</div>,
		document.body
	);
};
