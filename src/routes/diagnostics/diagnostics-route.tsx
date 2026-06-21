import * as React from 'react';
import classNames from 'classnames';
import {useHistory, useParams} from 'react-router-dom';
import {Badge, Button, Input, TablerIcon} from '../../components/design-system';
import {diagnosticsViewModel, useCoreProjectHost} from '../../core';
import {quickFixActionsForDiagnostic} from '../../core/quick-fix-registry';
import type {DiagnosticsViewModelItem} from '../../core/view-models';
import type {CoreDiagnosticSeverity} from '../../core/bindings/CoreDiagnosticSeverity';
import {
	Passage,
	selectPassage,
	Story,
	useStoriesContext
} from '../../store/stories';
import './diagnostics-route.css';

type SeverityFilter = CoreDiagnosticSeverity | 'all';

const severityFilters: Array<{
	id: SeverityFilter;
	icon: string;
	label: string;
}> = [
	{id: 'all', icon: 'list-check', label: 'All'},
	{id: 'error', icon: 'alert-octagon', label: 'Errors'},
	{id: 'warning', icon: 'alert-triangle', label: 'Warnings'},
	{id: 'info', icon: 'info-circle', label: 'Info'}
];

const typeFilters = [
	'All Types',
	'Broken Links',
	'Missing Assets',
	'Duplicate Names',
	'Invalid Metadata',
	'Format Errors',
	'Export Blockers',
	'Unreachable',
	'Assets'
];

function storyForId(stories: Story[], storyId: string | undefined) {
	return stories.find(story => story.id === storyId);
}

function severityTone(severity: CoreDiagnosticSeverity) {
	if (severity === 'error') {
		return 'error';
	}

	if (severity === 'warning') {
		return 'warn';
	}

	return 'link';
}

function severityIcon(severity: CoreDiagnosticSeverity) {
	if (severity === 'error') {
		return 'alert-octagon';
	}

	if (severity === 'warning') {
		return 'alert-triangle';
	}

	return 'info-circle';
}

function diagnosticPassage(story: Story, item: DiagnosticsViewModelItem) {
	return item.core.passageId
		? story.passages.find(passage => passage.id === item.core.passageId)
		: undefined;
}

function sourceTarget(story: Story, mode: 'graph' | 'text', passage?: Passage) {
	const query = new URLSearchParams({mode});

	if (passage) {
		query.set('passage', passage.id);
	}

	return `/stories/${story.id}?${query.toString()}`;
}

function matchesQuery(item: DiagnosticsViewModelItem, query: string) {
	const normalized = query.trim().toLowerCase();

	if (!normalized) {
		return true;
	}

	return [
		item.core.code,
		item.group,
		item.location,
		item.message,
		item.severity
	].some(value => value.toLowerCase().includes(normalized));
}

function severityCount(
	items: DiagnosticsViewModelItem[],
	severity: SeverityFilter
) {
	return severity === 'all'
		? items.length
		: items.filter(item => item.severity === severity).length;
}

function typeCount(items: DiagnosticsViewModelItem[], group: string) {
	return group === 'All Types'
		? items.length
		: items.filter(item => item.group === group).length;
}

export const DiagnosticsRoute: React.FC = () => {
	const {storyId} = useParams<{storyId: string}>();
	const {dispatch, stories} = useStoriesContext();
	const history = useHistory();
	const coreProjectHost = useCoreProjectHost();
	const story = storyForId(stories, storyId);
	const [severity, setSeverity] = React.useState<SeverityFilter>('all');
	const [type, setType] = React.useState('All Types');
	const [query, setQuery] = React.useState('');
	const [selectedId, setSelectedId] = React.useState<string>();
	const [patchVersion, setPatchVersion] = React.useState(0);

	React.useEffect(
		() =>
			coreProjectHost.subscribeToPatches(() =>
				setPatchVersion(version => version + 1)
			),
		[coreProjectHost]
	);

	const index = React.useMemo(
		() => (story ? coreProjectHost.queryStoryIndex(story.id) : undefined),
		[coreProjectHost, patchVersion, story]
	);
	const diagnostics = React.useMemo(
		() => (story && index ? diagnosticsViewModel(index, story) : undefined),
		[index, story]
	);
	const visibleItems = React.useMemo(() => {
		const items = diagnostics?.items ?? [];

		return items.filter(
			item =>
				(severity === 'all' || item.severity === severity) &&
				(type === 'All Types' || item.group === type) &&
				matchesQuery(item, query)
		);
	}, [diagnostics, query, severity, type]);
	const selectedItem =
		visibleItems.find(item => item.id === selectedId) ?? visibleItems[0];
	const selectedPassage =
		story && selectedItem ? diagnosticPassage(story, selectedItem) : undefined;
	const selectedActions =
		story && selectedItem
			? quickFixActionsForDiagnostic(coreProjectHost, story, selectedItem.core)
			: [];
	const enabledActions = selectedActions.filter(action => action.enabled);

	React.useEffect(() => {
		if (selectedItem && selectedItem.id !== selectedId) {
			setSelectedId(selectedItem.id);
		}
	}, [selectedId, selectedItem]);

	function reveal(
		item: DiagnosticsViewModelItem | undefined,
		mode: 'graph' | 'text'
	) {
		if (!story || !item) {
			return;
		}

		const passage = diagnosticPassage(story, item);

		if (passage) {
			dispatch(selectPassage(story, passage, true));
		}

		history.push(sourceTarget(story, mode, passage));
	}

	function fixAllSafe() {
		if (!story || !diagnostics) {
			return;
		}

		for (const item of visibleItems) {
			for (const action of quickFixActionsForDiagnostic(
				coreProjectHost,
				story,
				item.core
			)) {
				if (action.enabled) {
					action.apply();
				}
			}
		}
	}

	if (!story || !diagnostics) {
		return (
			<div className="diagnostics-route__empty">
				<TablerIcon icon="alert-triangle" />
				<span>No story is open.</span>
			</div>
		);
	}

	let lastGroup: string | undefined;

	return (
		<div className="diagnostics-route">
			<aside
				aria-label="Diagnostic filters"
				className="diagnostics-route__filters"
			>
				<div className="diagnostics-route__filter-label">Severity</div>
				{severityFilters.map(candidate => (
					<button
						aria-current={candidate.id === severity}
						className="diagnostics-route__filter"
						key={candidate.id}
						onClick={() => setSeverity(candidate.id)}
						type="button"
					>
						<TablerIcon icon={candidate.icon} />
						<span>{candidate.label}</span>
						<span className="diagnostics-route__count">
							{severityCount(diagnostics.items, candidate.id)}
						</span>
					</button>
				))}
				<div className="diagnostics-route__filter-label">Type</div>
				{typeFilters.map(candidate => (
					<button
						aria-current={candidate === type}
						className="diagnostics-route__filter"
						key={candidate}
						onClick={() => setType(candidate)}
						type="button"
					>
						<span>{candidate}</span>
						<span className="diagnostics-route__count">
							{typeCount(diagnostics.items, candidate)}
						</span>
					</button>
				))}
			</aside>
			<main className="diagnostics-route__main" aria-label="Diagnostics">
				<div className="diagnostics-route__toolbar">
					<Input
						aria-label="Filter diagnostics"
						block
						icon="search"
						onChange={event => setQuery(event.target.value)}
						placeholder="Filter diagnostics"
						value={query}
					/>
					<span className="diagnostics-route__toolbar-stat">
						{visibleItems.length} issues
					</span>
					<Button
						disabled={visibleItems.length === 0}
						icon="refresh"
						onClick={() => setPatchVersion(version => version + 1)}
						size="sm"
						variant="ghost"
					>
						Recheck Project
					</Button>
					<Button
						disabled={
							!visibleItems.some(item =>
								quickFixActionsForDiagnostic(
									coreProjectHost,
									story,
									item.core
								).some(action => action.enabled)
							)
						}
						icon="wand"
						onClick={fixAllSafe}
						size="sm"
						variant="primary"
					>
						Fix All Safe
					</Button>
				</div>
				<div className="diagnostics-route__list">
					{visibleItems.length === 0 ? (
						<div className="diagnostics-route__list-empty">
							No diagnostics match this filter.
						</div>
					) : (
						visibleItems.map(item => {
							const showGroup = item.group !== lastGroup;

							lastGroup = item.group;

							return (
								<React.Fragment key={item.id}>
									{showGroup && (
										<div className="diagnostics-route__group">
											<TablerIcon icon="chevron-down" />
											{item.group}
										</div>
									)}
									<button
										aria-current={item.id === selectedItem?.id}
										className={classNames(
											'diagnostics-route__row',
											`diagnostics-route__row--${item.severity}`
										)}
										onClick={() => setSelectedId(item.id)}
										type="button"
									>
										<TablerIcon
											className="diagnostics-route__severity-icon"
											icon={severityIcon(item.severity)}
										/>
										<span className="diagnostics-route__row-text">
											<span className="diagnostics-route__message">
												<b>{item.core.code}</b>
												{item.message}
											</span>
											<span className="diagnostics-route__location">
												{item.location}
											</span>
										</span>
										<span className="diagnostics-route__row-fix">
											{item.core.quickFixes.length > 0 ? 'Fix' : 'Review'}
										</span>
									</button>
								</React.Fragment>
							);
						})
					)}
				</div>
			</main>
			<aside
				className="diagnostics-route__detail"
				aria-label="Diagnostic detail"
			>
				{selectedItem ? (
					<>
						<Badge
							icon={severityIcon(selectedItem.severity)}
							tone={severityTone(selectedItem.severity)}
						>
							{selectedItem.severity}
						</Badge>
						<h1>{selectedItem.core.code}</h1>
						<div className="diagnostics-route__detail-location">
							{selectedItem.location}
						</div>
						<p>{selectedItem.message}</p>
						<div className="diagnostics-route__code">
							{selectedPassage
								? selectedPassage.text || selectedPassage.name
								: selectedItem.core.sourceId}
						</div>
						<div className="diagnostics-route__section-title">Proposed Fix</div>
						{selectedActions.length > 0 ? (
							<div className="diagnostics-route__actions">
								{selectedActions.map(action => (
									<Button
										block
										disabled={!action.enabled}
										icon="wand"
										key={action.command}
										onClick={action.apply}
										size="sm"
										variant={action.enabled ? 'primary' : 'ghost'}
									>
										{action.title}
									</Button>
								))}
							</div>
						) : (
							<p className="diagnostics-route__muted">
								This diagnostic needs manual review.
							</p>
						)}
						<div className="diagnostics-route__section-title">Navigation</div>
						<div className="diagnostics-route__actions">
							<Button
								block
								icon="file-text"
								onClick={() => reveal(selectedItem, 'text')}
								size="sm"
							>
								Reveal Source
							</Button>
							<Button
								block
								disabled={!selectedPassage}
								icon="binary-tree"
								onClick={() => reveal(selectedItem, 'graph')}
								size="sm"
							>
								Reveal Graph
							</Button>
							<Button block icon="book" size="sm" variant="ghost">
								Open Format Docs
							</Button>
						</div>
						{enabledActions.length > 0 && (
							<p className="diagnostics-route__muted">
								{enabledActions.length} safe fix
								{enabledActions.length === 1 ? '' : 'es'} available.
							</p>
						)}
					</>
				) : (
					<div className="diagnostics-route__empty-detail">
						Select a diagnostic.
					</div>
				)}
			</aside>
		</div>
	);
};
