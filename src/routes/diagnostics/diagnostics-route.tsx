import * as React from 'react';
import classNames from 'classnames';
import {useHistory, useParams} from 'react-router-dom';
import {Badge, Button, Input, TablerIcon} from '../../components/design-system';
import {
	diagnosticDismissalsChangedEvent,
	diagnosticIdentity,
	diagnosticsViewModel,
	isDiagnosticDismissed,
	loadDismissedDiagnosticIds,
	saveDismissedDiagnosticIds,
	useCoreProjectHost
} from '../../core';
import {quickFixActionsForDiagnostic} from '../../core/quick-fix-registry';
import type {DiagnosticsViewModelItem} from '../../core/view-models';
import type {CoreDiagnosticSeverity} from '../../core/bindings/CoreDiagnosticSeverity';
import type {CoreStoryIndex} from '../../core';
import {selectPassage, Story, useStoriesContext} from '../../store/stories';
import {useStoryLaunch} from '../../store/use-story-launch';
import {
	sourceNavigationTargetFromSourceId,
	sourceTarget
} from '../story-edit/source-navigation';
import './diagnostics-route.css';

type SeverityFilter = CoreDiagnosticSeverity | 'all';
type VisibilityFilter = 'active' | 'dismissed';
type RouteDiagnosticItem = DiagnosticsViewModelItem & {
	dismissalId: string;
	dismissed: boolean;
};

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

const allTypesFilter = 'All Types';

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

function diagnosticSourceTarget(item: DiagnosticsViewModelItem) {
	return sourceNavigationTargetFromSourceId(
		item.core.sourceId,
		item.core.passageId
	);
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

function severityCount(items: RouteDiagnosticItem[], severity: SeverityFilter) {
	return severity === 'all'
		? items.length
		: items.filter(item => item.severity === severity).length;
}

function typeCount(items: RouteDiagnosticItem[], group: string) {
	return group === allTypesFilter
		? items.length
		: items.filter(item => item.group === group).length;
}

export const DiagnosticsRoute: React.FC = () => {
	const {storyId} = useParams<{storyId: string}>();
	const {dispatch, stories} = useStoriesContext();
	const history = useHistory();
	const {testStory} = useStoryLaunch();
	const coreProjectHost = useCoreProjectHost();
	const story = storyForId(stories, storyId);
	const [severity, setSeverity] = React.useState<SeverityFilter>('all');
	const [visibility, setVisibility] =
		React.useState<VisibilityFilter>('active');
	const [type, setType] = React.useState(allTypesFilter);
	const [query, setQuery] = React.useState('');
	const [selectedId, setSelectedId] = React.useState<string>();
	const [patchVersion, setPatchVersion] = React.useState(0);
	const [index, setIndex] = React.useState<CoreStoryIndex>();
	const [dismissedIds, setDismissedIds] = React.useState<Set<string>>(
		() => new Set()
	);

	React.useEffect(
		() =>
			coreProjectHost.subscribeToPatches(() =>
				setPatchVersion(version => version + 1)
			),
		[coreProjectHost]
	);

	React.useEffect(() => {
		setDismissedIds(story ? loadDismissedDiagnosticIds(story.id) : new Set());
	}, [story]);

	React.useEffect(() => {
		if (!story) {
			return;
		}

		const currentStoryId: string = story.id;

		function handleDismissalsChanged(event: Event) {
			const detail = (event as CustomEvent<{storyId?: string}>).detail;

			if (!detail?.storyId || detail.storyId === currentStoryId) {
				setDismissedIds(loadDismissedDiagnosticIds(currentStoryId));
			}
		}

		window.addEventListener(
			diagnosticDismissalsChangedEvent,
			handleDismissalsChanged
		);

		return () =>
			window.removeEventListener(
				diagnosticDismissalsChangedEvent,
				handleDismissalsChanged
			);
	}, [story?.id]);

	React.useEffect(() => {
		let active = true;

		if (!story) {
			setIndex(undefined);
			return () => {
				active = false;
			};
		}

		setIndex(undefined);
		void coreProjectHost
			.queryStoryIndexAsync(story.id, {
				includeAssets: true,
				includeContents: true,
				includeDiagnostics: true,
				includeFiles: false,
				includeGraph: true,
				includePassageNames: false,
				includePassageText: false,
				includeScript: true,
				includeStylesheet: true,
				includeTags: false,
				includeVariables: true
			})
			.then(index => {
				if (active) {
					setIndex(index);
				}
			});

		return () => {
			active = false;
		};
	}, [coreProjectHost, patchVersion, story]);
	const diagnostics = React.useMemo(
		() => (story && index ? diagnosticsViewModel(index, story) : undefined),
		[index, story]
	);
	const items = React.useMemo<RouteDiagnosticItem[]>(() => {
		return (diagnostics?.items ?? []).map(item => ({
			...item,
			dismissalId: diagnosticIdentity(item.core),
			dismissed: isDiagnosticDismissed(item.core, dismissedIds)
		}));
	}, [diagnostics, dismissedIds]);
	const activeItems = React.useMemo(
		() => items.filter(item => !item.dismissed),
		[items]
	);
	const dismissedItems = React.useMemo(
		() => items.filter(item => item.dismissed),
		[items]
	);
	const statusItems = visibility === 'active' ? activeItems : dismissedItems;
	const visibleSeverityFilters =
		statusItems.length === 0
			? []
			: severityFilters.filter(
					candidate =>
						candidate.id === 'all' ||
						severityCount(statusItems, candidate.id) > 0
				);
	const visibleTypeFilters =
		statusItems.length === 0
			? []
			: [
					allTypesFilter,
					...Array.from(new Set(statusItems.map(item => item.group))).sort()
				];
	const visibleItems = React.useMemo(() => {
		return statusItems.filter(
			item =>
				(severity === 'all' || item.severity === severity) &&
				(type === allTypesFilter || item.group === type) &&
				matchesQuery(item, query)
		);
	}, [query, severity, statusItems, type]);
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

	React.useEffect(() => {
		if (severity !== 'all' && severityCount(statusItems, severity) === 0) {
			setSeverity('all');
		}
	}, [severity, statusItems]);

	React.useEffect(() => {
		if (type !== allTypesFilter && typeCount(statusItems, type) === 0) {
			setType(allTypesFilter);
		}
	}, [statusItems, type]);

	function reveal(
		item: DiagnosticsViewModelItem | undefined,
		mode: 'graph' | 'text'
	) {
		if (!story || !item) {
			return;
		}

		const passage = diagnosticPassage(story, item);

		if (mode === 'graph') {
			if (!passage) {
				return;
			}

			dispatch(selectPassage(story, passage, true));
			history.push(
				sourceTarget(story, {
					mode,
					target: {kind: 'passage', passageId: passage.id}
				})
			);
			return;
		}

		const target = diagnosticSourceTarget(item);

		if (!target) {
			return;
		}

		if (passage) {
			dispatch(selectPassage(story, passage, true));
		}

		history.push(
			sourceTarget(story, {
				line: item.core.line,
				mode,
				offset: item.core.start,
				target
			})
		);
	}

	function fixAllSafe() {
		if (!story || !diagnostics) {
			return;
		}

		for (const item of visibleItems) {
			if (item.dismissed) {
				continue;
			}

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

	function updateDismissed(
		item: RouteDiagnosticItem | undefined,
		dismiss: boolean
	) {
		if (!story || !item) {
			return;
		}

		const next = new Set(dismissedIds);

		if (dismiss) {
			next.add(item.dismissalId);
		} else {
			next.delete(item.dismissalId);
		}

		setDismissedIds(next);
		saveDismissedDiagnosticIds(story.id, next);
	}

	function testSelectedPassage() {
		if (story && selectedPassage) {
			void testStory(story.id, selectedPassage.id);
		}
	}

	if (!story) {
		return (
			<div className="diagnostics-route__empty">
				<TablerIcon icon="alert-triangle" />
				<span>No story is open.</span>
			</div>
		);
	}

	if (!diagnostics) {
		return (
			<div className="diagnostics-route__empty">
				<TablerIcon icon="search" />
				<span>Checking diagnostics...</span>
			</div>
		);
	}

	let lastGroup: string | undefined;
	const emptyListState =
		items.length === 0 ? (
			<div className="diagnostics-route__empty-state" aria-live="polite">
				<TablerIcon icon="circle-check" />
				<h1>No issues found — your story is healthy</h1>
				<p>
					Diagnostics check story structure, links, passage names, start
					passages, assets, and format/export problems.
				</p>
			</div>
		) : statusItems.length === 0 ? (
			<div
				className="diagnostics-route__empty-state diagnostics-route__empty-state--neutral"
				aria-live="polite"
			>
				<TablerIcon
					icon={visibility === 'active' ? 'circle-check' : 'archive'}
				/>
				<h1>
					{visibility === 'active'
						? 'No active diagnostics'
						: 'No dismissed diagnostics'}
				</h1>
				<p>
					{visibility === 'active'
						? 'Every known diagnostic is resolved or dismissed.'
						: 'Dismissed diagnostics will appear here when you archive them.'}
				</p>
			</div>
		) : (
			<div
				className="diagnostics-route__empty-state diagnostics-route__empty-state--neutral"
				aria-live="polite"
			>
				<TablerIcon icon="search" />
				<h1>No matching diagnostics</h1>
				<p>Try another severity, category, or search term.</p>
			</div>
		);

	return (
		<div className="diagnostics-route">
			<aside
				aria-label="Diagnostic filters"
				className="diagnostics-route__filters"
			>
				<div className="diagnostics-route__filter-label">Status</div>
				<button
					aria-current={visibility === 'active'}
					className="diagnostics-route__filter"
					disabled={activeItems.length === 0 && visibility !== 'active'}
					onClick={() => setVisibility('active')}
					type="button"
				>
					<TablerIcon icon="alert-triangle" />
					<span>Active</span>
					<span className="diagnostics-route__count">{activeItems.length}</span>
				</button>
				<button
					aria-current={visibility === 'dismissed'}
					className="diagnostics-route__filter"
					disabled={dismissedItems.length === 0 && visibility !== 'dismissed'}
					onClick={() => setVisibility('dismissed')}
					type="button"
				>
					<TablerIcon icon="archive" />
					<span>Dismissed</span>
					<span className="diagnostics-route__count">
						{dismissedItems.length}
					</span>
				</button>
				{visibleSeverityFilters.length > 0 && (
					<>
						<div className="diagnostics-route__filter-label">Severity</div>
						{visibleSeverityFilters.map(candidate => (
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
									{severityCount(statusItems, candidate.id)}
								</span>
							</button>
						))}
					</>
				)}
				{visibleTypeFilters.length > 0 && (
					<>
						<div className="diagnostics-route__filter-label">Type</div>
						{visibleTypeFilters.map(candidate => (
							<button
								aria-current={candidate === type}
								className="diagnostics-route__filter"
								key={candidate}
								onClick={() => setType(candidate)}
								type="button"
							>
								<span>{candidate}</span>
								<span className="diagnostics-route__count">
									{typeCount(statusItems, candidate)}
								</span>
							</button>
						))}
					</>
				)}
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
						{visibleItems.length} {visibility}
						{dismissedItems.length > 0 &&
							` (${dismissedItems.length} dismissed)`}
					</span>
					<Button
						icon="refresh"
						onClick={() => setPatchVersion(version => version + 1)}
						size="sm"
						variant="ghost"
					>
						Recheck Project
					</Button>
					<Button
						disabled={
							!visibleItems.some(
								item =>
									!item.dismissed &&
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
					{visibleItems.length === 0
						? emptyListState
						: visibleItems.map(item => {
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
												`diagnostics-route__row--${item.severity}`,
												item.dismissed && 'diagnostics-route__row--dismissed'
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
												{item.dismissed
													? 'Dismissed'
													: item.core.quickFixes.length > 0
														? 'Fix'
														: 'Review'}
											</span>
										</button>
									</React.Fragment>
								);
							})}
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
						<div className="diagnostics-route__actions">
							<Button
								block
								icon={selectedItem.dismissed ? 'refresh' : 'archive'}
								onClick={() =>
									updateDismissed(selectedItem, !selectedItem.dismissed)
								}
								size="sm"
								variant="ghost"
							>
								{selectedItem.dismissed
									? 'Restore Diagnostic'
									: 'Dismiss Diagnostic'}
							</Button>
						</div>
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
								disabled={!selectedPassage}
								icon="tool"
								onClick={testSelectedPassage}
								size="sm"
								variant="primary"
							>
								Test From Here
							</Button>
							<Button
								block
								disabled={
									!selectedItem || !diagnosticSourceTarget(selectedItem)
								}
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
						{items.length === 0
							? 'No diagnostic detail.'
							: 'Select a diagnostic.'}
					</div>
				)}
			</aside>
		</div>
	);
};
