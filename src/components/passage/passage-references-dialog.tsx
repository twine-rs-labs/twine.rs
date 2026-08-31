import * as React from 'react';
import * as ReactDOM from 'react-dom';
import {useTranslation} from 'react-i18next';
import type {CorePassageLocation} from '../../core/bindings/CorePassageLocation';
import type {CorePassageReferencesPage} from '../../core/bindings/CorePassageReferencesPage';
import type {CoreProjectHost} from '../../core';
import type {Passage, Story} from '../../store/stories';
import {
	type WorkbenchStoryMutationBarrier,
	workbenchBufferCoordinator
} from '../../util/workbench-buffer-coordinator';
import {Badge, Button, IconButton} from '../design-system';
import './passage-references-dialog.css';

const pageLimit = 50;

interface PagePosition {
	cursor: string | null;
	position: number;
}

export interface PassageReferencesDialogProps {
	host: CoreProjectHost;
	onClose: () => void;
	onRevealInGraph: (location: CorePassageLocation) => Promise<void> | void;
	onRevealInSource: (location: CorePassageLocation) => Promise<void> | void;
	story: Story;
	target: Passage;
}

/** A bounded, revision-safe browser for Rust-owned standard passage references. */
export const PassageReferencesDialog: React.FC<
	PassageReferencesDialogProps
> = ({host, onClose, onRevealInGraph, onRevealInSource, story, target}) => {
	const {t} = useTranslation();
	const [history, setHistory] = React.useState<PagePosition[]>([
		{cursor: null, position: 0}
	]);
	const [historyIndex, setHistoryIndex] = React.useState(0);
	const [page, setPage] = React.useState<CorePassageReferencesPage>();
	const [error, setError] = React.useState<string>();
	const [retryGeneration, setRetryGeneration] = React.useState(0);
	const patchGeneration = React.useRef(0);
	const requestGeneration = React.useRef(0);
	const translation = React.useRef(t);
	translation.current = t;
	const titleRef = React.useRef<HTMLHeadingElement>(null);
	const current = history[historyIndex];

	React.useEffect(() => titleRef.current?.focus(), []);
	React.useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				onClose();
			}
		};

		document.addEventListener('keydown', onKeyDown);
		return () => document.removeEventListener('keydown', onKeyDown);
	}, [onClose]);

	React.useEffect(() => {
		return host.subscribeToPatches(() => {
			patchGeneration.current += 1;
			setPage(undefined);
			setError(t('components.passageReferences.stale'));
		});
	}, [host, t]);

	React.useEffect(() => {
		let active = true;
		const generation = ++requestGeneration.current;

		setPage(undefined);
		setError(undefined);
		void (async () => {
			let barrier: WorkbenchStoryMutationBarrier | undefined;
			try {
				barrier = await workbenchBufferCoordinator.acquireStoryMutationBarrier(
					story.id
				);
				if (!active || generation !== requestGeneration.current) return;
				const queryPatchGeneration = patchGeneration.current;
				setError(undefined);
				const result = await host.queryPassageReferencesPageAsync(
					story.id,
					target.id,
					{cursor: current.cursor, limit: pageLimit}
				);
				if (
					!active ||
					generation !== requestGeneration.current ||
					queryPatchGeneration !== patchGeneration.current
				)
					return;
				if (
					!barrier.isCurrent() ||
					result.storyId !== story.id ||
					result.passageId !== target.id
				) {
					throw new Error(
						translation.current('components.passageReferences.mismatchedResult')
					);
				}
				if (result.revision !== host.sessionStatus(story.id).revision) {
					throw new Error(
						translation.current('components.passageReferences.stale')
					);
				}
				setPage(result);
			} catch (reason) {
				if (!active || generation !== requestGeneration.current) return;
				setError(
					reason instanceof Error
						? reason.message
						: translation.current('components.passageReferences.loadFailed')
				);
			} finally {
				barrier?.release();
			}
		})();

		return () => {
			active = false;
		};
	}, [current.cursor, host, retryGeneration, story.id, target.id]);

	function retry() {
		setHistory([{cursor: null, position: 0}]);
		setHistoryIndex(0);
		setRetryGeneration(value => value + 1);
	}

	function nextPage() {
		if (!page?.nextCursor) return;
		const next = {
			cursor: page.nextCursor,
			position: current.position + page.references.length
		};

		setHistory(previous => [...previous.slice(0, historyIndex + 1), next]);
		setHistoryIndex(value => value + 1);
	}

	async function reveal(
		action: (location: CorePassageLocation) => Promise<void> | void,
		location: CorePassageLocation
	) {
		setError(undefined);
		try {
			await action(location);
		} catch (reason) {
			setError(
				reason instanceof Error
					? reason.message
					: t('components.passageReferences.revealFailed')
			);
		}
	}

	const visibleStart = page?.references.length ? current.position + 1 : 0;
	const visibleEnd = page ? current.position + page.references.length : 0;

	return ReactDOM.createPortal(
		<div className="passage-references__layer">
			<section
				aria-labelledby="passage-references-title"
				className="passage-references"
				role="dialog"
			>
				<header className="passage-references__header">
					<div>
						<h2 id="passage-references-title" ref={titleRef} tabIndex={-1}>
							{t('components.passageReferences.title', {name: target.name})}
						</h2>
						{page && (
							<p>
								{t('components.passageReferences.visibleResults', {
									end: visibleEnd,
									start: visibleStart,
									total: page.totalCount
								})}
							</p>
						)}
					</div>
					<IconButton icon="x" label={t('common.close')} onClick={onClose} />
				</header>
				<div className="passage-references__content">
					{!page && !error && (
						<p aria-live="polite">
							{t('components.passageReferences.loading')}
						</p>
					)}
					{error && (
						<div className="passage-references__error" role="alert">
							<p>{error}</p>
							<Button onClick={retry}>
								{t('components.passageReferences.refresh')}
							</Button>
						</div>
					)}
					{page && (
						<>
							<p className="passage-references__coverage" role="note">
								{t(
									page.coverage === 'ambiguous-passage-name'
										? 'components.passageReferences.ambiguousPassageName'
										: 'components.passageReferences.standardLinksOnly'
								)}
							</p>
							{page.references.length === 0 ? (
								<p>{t('components.passageReferences.noReferences')}</p>
							) : (
								<div className="passage-references__results">
									{page.references.map(reference => {
										const {location} = reference;
										return (
											<article
												className="passage-references__result"
												key={location.resultKey}
											>
												<div className="passage-references__result-heading">
													<h3>{location.passageName}</h3>
													<Badge>
														{location.span.start}–{location.span.end} UTF-16
													</Badge>
												</div>
												<p className="passage-references__provenance">
													{location.provenance.providerIdentifier} ·{' '}
													{t('components.passageReferences.revision', {
														revision: location.revision
													})}
												</p>
												<div className="passage-references__result-actions">
													<Button
														onClick={() =>
															void reveal(onRevealInSource, location)
														}
														variant="primary"
													>
														{t('components.passageReferences.revealInSource')}
													</Button>
													<Button
														onClick={() =>
															void reveal(onRevealInGraph, location)
														}
													>
														{t('routes.storyEdit.workspace.revealInGraph')}
													</Button>
												</div>
											</article>
										);
									})}
								</div>
							)}
						</>
					)}
				</div>
				<footer className="passage-references__footer">
					<div className="passage-references__paging">
						<Button
							disabled={historyIndex === 0 || !page}
							onClick={() => setHistoryIndex(value => value - 1)}
						>
							{t('common.previous')}
						</Button>
						<Button disabled={!page?.nextCursor} onClick={nextPage}>
							{t('common.next')}
						</Button>
					</div>
					<Button onClick={onClose} variant="ghost">
						{t('common.close')}
					</Button>
				</footer>
			</section>
		</div>,
		document.body
	);
};
