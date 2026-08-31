import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {useNavigate} from 'react-router';
import {
	Badge,
	Button,
	IconButton,
	Panel,
	SegmentedControl,
	Tag,
	TablerIcon
} from '../../components/design-system';
import {VisibleWhitespace} from '../../components/visible-whitespace';
import {PassageReferencesDialog} from '../../components/passage/passage-references-dialog';
import {
	assetManagerViewModel,
	contentsViewModel,
	copyAssetSnippetCommand,
	diagnosticDismissalsChangedEvent,
	diagnosticIdentity,
	diagnosticsViewModel,
	emptyStoryIndex,
	insertAssetSnippetCommand,
	loadDismissedDiagnosticIds,
	useCoreProjectHost
} from '../../core';
import type {
	AssetManagerViewModel,
	ContentsViewModelEntry,
	ContentsViewModel,
	DiagnosticsViewModel,
	WorkbenchSelection
} from '../../core';
import type {PatchBatch} from '../../core/bindings/PatchBatch';
import type {CoreStoryIndex} from '../../core/bindings/CoreStoryIndex';
import type {CoreBacklinksPage} from '../../core/bindings/CoreBacklinksPage';
import type {CorePassageLocalFacts} from '../../core/bindings/CorePassageLocalFacts';
import type {CorePassageLocation} from '../../core/bindings/CorePassageLocation';
import type {CoreWorkbenchDockModel} from '../../core/bindings/CoreWorkbenchDockModel';
import {quickFixActionsForDiagnostic} from '../../core/quick-fix-registry';
import type {CoreProjectHost} from '../../core/project-host-public';
import type {TwineElectronWindow} from '../../electron/shared';
import {
	type WorkbenchStoryMutationBarrier,
	workbenchBufferCoordinator
} from '../../util/workbench-buffer-coordinator';
import {loadProjectMetadata} from '../../store/project-metadata';
import {
	markProjectStoryHydration,
	useProjectStoryHydration
} from '../../store/project-hydration';
import {mergeProjectStories} from '../../store/merge-project-stories';
import {
	highlightPassages,
	Passage,
	PassageWithText,
	Story,
	useStoriesContext
} from '../../store/stories';
import {firstLiveAssetUsagePassage} from '../../store/use-test-from-here-action';
import {
	markPerformance,
	measurePerformance,
	recordPerformanceHarnessEvent
} from '../../util/performance';
import {EditorDockLayout, StoryEditMode} from './workspace-state';
import {EditorDock} from './editor-dock';
import {EditorWindowSpec, editorWindowId} from './editor-window-spec';
import {
	editorWindowSpecForSourceNavigationTarget,
	sourceNavigationTargetFromAssetReference,
	sourceNavigationTargetFromContentsEntry,
	sourceTarget
} from './source-navigation';
import type {
	StoryWorkbenchBottomDrawerPanel,
	StoryWorkbenchExtensionContext,
	StoryWorkbenchInspectorExtension
} from './workbench-extensions';

export interface StoryWorkspaceShellProps {
	activeBottomDrawerPanelId?: string;
	activeWindowId?: string;
	bottomDrawerOpen: boolean;
	bottomDrawerPanels?: readonly StoryWorkbenchBottomDrawerPanel[];
	editorDockLayout: EditorDockLayout;
	editorWindows?: EditorWindowSpec[];
	graphPanel: React.ReactNode;
	inspectorExtensions?: readonly StoryWorkbenchInspectorExtension[];
	leftDockCollapsed: boolean;
	mode: StoryEditMode;
	onChangeBottomDrawerOpen: (value: boolean) => void;
	onChangeBottomDrawerPanel?: (id: string) => void;
	onChangeEditorDockLayout: (value: EditorDockLayout) => void;
	onChangeLeftDockCollapsed: (value: boolean) => void;
	onChangeRightDockCollapsed: (value: boolean) => void;
	onCloseEditorWindow?: (spec: EditorWindowSpec) => void;
	onFocusEditorWindow?: (id: string) => void;
	onOpenEditorWindow?: (spec: EditorWindowSpec) => void;
	onOpenFindReplace?: (
		query: string,
		options?: {includePassageNames?: boolean}
	) => void;
	onReorderEditorWindows?: (from: number, to: number) => void;
	onRevealPassageInGraph: (passage: Passage) => void;
	onSelectPassage: (passage: Passage) => void;
	onTestPassage?: (passage: Passage) => void;
	overlay?: React.ReactNode;
	revealRequests?: Map<string, {end?: number; key: number; position?: number}>;
	rightDockCollapsed: boolean;
	searchRequests?: Map<string, {key: number; query?: string}>;
	selectedPassageId?: string;
	story: Story;
	testPassagePending?: boolean;
	testPassagePendingId?: string;
}

type NavigatorTab = 'passages' | 'contents' | 'assets';
const passageNavigatorRowHeight = 30;

function boundedWorkbenchSelection(
	story: Story,
	selectedPassageId: string | undefined
): WorkbenchSelection {
	const passage =
		story.passages.find(passage => passage.id === selectedPassageId) ??
		story.passages.find(passage => passage.id === story.startPassage) ??
		story.passages[0];
	return {
		assetReferences: [],
		backlinkCount: 0,
		backlinks: [],
		brokenLinks: [],
		diagnostics: [],
		linkFacts: [],
		links: [],
		passage,
		passageNames: [],
		sourceId: passage?.id,
		wordCount: 0
	};
}

function selectionFromPassageFacts(
	story: Story,
	selection: WorkbenchSelection,
	facts: CorePassageLocalFacts | undefined,
	backlinkPage?: CoreBacklinksPage
): WorkbenchSelection {
	if (!facts || facts.passageId !== selection.passage?.id) {
		return selection;
	}

	const linkFacts = facts.links.map(link => ({
		broken: link.broken,
		self: link.sourceId === link.targetId,
		sourceId: link.sourceId,
		sourceName:
			story.passages.find(passage => passage.id === link.sourceId)?.name ??
			link.sourceId,
		targetId: link.targetId,
		targetName: link.targetName
	}));
	const backlinks = (
		backlinkPage?.revision === facts.revision ? backlinkPage.backlinks : []
	).map(link => ({
		broken: link.broken,
		self: link.sourceId === link.targetId,
		sourceId: link.sourceId,
		sourceName:
			story.passages.find(passage => passage.id === link.sourceId)?.name ??
			link.sourceId,
		targetId: link.targetId,
		targetName: link.targetName
	}));

	return {
		...selection,
		assetReferences: facts.assetReferences,
		backlinkCount:
			backlinkPage?.revision === facts.revision ? backlinkPage.totalCount : 0,
		backlinks,
		brokenLinks: linkFacts.filter(link => link.broken),
		diagnostics: facts.diagnostics,
		linkFacts,
		links: linkFacts.map(link => link.targetName),
		wordCount: facts.wordCount
	};
}
const passageNavigatorOverscan = 12;
const virtualFallbackHeight = 540;

interface StoryOpenProgressState {
	detail: string;
	label: string;
	progress: number;
}

function navigatorStorageKey(storyId: string) {
	return `twine-story-edit-navigator-${storyId}`;
}

function readNavigatorTab(storyId: string): NavigatorTab {
	try {
		const value = window.localStorage.getItem(navigatorStorageKey(storyId));

		return value === 'assets' || value === 'contents' ? value : 'passages';
	} catch {
		return 'passages';
	}
}

function usePersistedNavigatorTab(storyId: string) {
	const [tab, setTab] = React.useState<NavigatorTab>(() =>
		readNavigatorTab(storyId)
	);

	React.useEffect(() => {
		setTab(readNavigatorTab(storyId));
	}, [storyId]);

	React.useEffect(() => {
		try {
			window.localStorage.setItem(navigatorStorageKey(storyId), tab);
		} catch {
			// Local storage is best-effort workspace memory.
		}
	}, [storyId, tab]);

	return [tab, setTab] as const;
}

function useFixedVirtualRange(
	count: number,
	rowHeight: number,
	overscan: number
) {
	const containerRef = React.useRef<HTMLDivElement>(null);
	const [viewport, setViewport] = React.useState({
		height: virtualFallbackHeight,
		top: 0
	});

	React.useEffect(() => {
		const element = containerRef.current;

		if (!element) {
			return;
		}

		const current = element;

		function update() {
			setViewport({
				height: current.clientHeight || virtualFallbackHeight,
				top: current.scrollTop
			});
		}

		update();
		current.addEventListener('scroll', update, {passive: true});
		window.addEventListener('resize', update);

		return () => {
			current.removeEventListener('scroll', update);
			window.removeEventListener('resize', update);
		};
	}, []);

	const start = Math.max(0, Math.floor(viewport.top / rowHeight) - overscan);
	const end = Math.min(
		count,
		Math.ceil((viewport.top + viewport.height) / rowHeight) + overscan
	);

	return {
		containerRef,
		end,
		start,
		totalHeight: count * rowHeight
	};
}

const DockPanel: React.FC<{
	children: React.ReactNode;
	collapsed: boolean;
	icon: string;
	label: string;
	onChangeCollapsed: (value: boolean) => void;
	side: 'left' | 'right';
	title: string;
}> = props => {
	const {children, collapsed, icon, label, onChangeCollapsed, side, title} =
		props;
	const {t} = useTranslation();
	const toggleIcon =
		side === 'left'
			? collapsed
				? 'layout-sidebar-left-expand'
				: 'layout-sidebar-left-collapse'
			: collapsed
				? 'layout-sidebar-right-expand'
				: 'layout-sidebar-right-collapse';

	return (
		<Panel
			actions={
				<IconButton
					icon={toggleIcon}
					label={t(
						collapsed
							? 'routes.storyEdit.workspace.expandDock'
							: 'routes.storyEdit.workspace.collapseDock',
						{dock: label}
					)}
					onClick={() => onChangeCollapsed(!collapsed)}
					size="sm"
				/>
			}
			className="story-edit-dock-panel"
			flush
			icon={collapsed ? toggleIcon : icon}
			title={collapsed ? undefined : title}
		>
			{!collapsed && children}
		</Panel>
	);
};

function copyText(text: string) {
	const {twineElectron} = window as TwineElectronWindow;

	if (twineElectron?.copyText) {
		twineElectron.copyText(text);
		return;
	}

	void navigator.clipboard?.writeText(text);
}

function revealPath(path: string) {
	const {twineElectron} = window as TwineElectronWindow;

	twineElectron?.revealPath(path);
}

function handlePatchSideEffects(batch: PatchBatch) {
	for (const patch of batch.patches) {
		if (patch.type === 'assetSnippetCopied') {
			copyText(patch.snippet);
		}

		if (patch.type === 'assetRevealed') {
			revealPath(patch.reveal_path);
		}
	}
}

const PassageNavigator: React.FC<{
	index: CoreStoryIndex;
	onSelectPassage: (passage: Passage) => void;
	selectedPassageId?: string;
	story: Story;
}> = props => {
	const {index, onSelectPassage, selectedPassageId, story} = props;
	const {t} = useTranslation();
	const virtual = useFixedVirtualRange(
		story.passages.length,
		passageNavigatorRowHeight,
		passageNavigatorOverscan
	);
	const visiblePassages = story.passages.slice(virtual.start, virtual.end);
	const diagnosticsByPassage = React.useMemo(() => {
		const result = new Map<string, number>();

		for (const diagnostic of index.diagnostics) {
			if (diagnostic.passageId) {
				result.set(
					diagnostic.passageId,
					(result.get(diagnostic.passageId) ?? 0) + 1
				);
			}
		}

		return result;
	}, [index.diagnostics]);

	return (
		<div
			className="story-edit-passage-list"
			data-total-count={story.passages.length}
			data-visible-count={visiblePassages.length}
			ref={virtual.containerRef}
			role="list"
		>
			<div
				aria-hidden
				className="story-edit-passage-list-spacer"
				style={{height: virtual.totalHeight}}
			/>
			{visiblePassages.map((passage, offset) => (
				<div
					className="story-edit-passage-list-row"
					key={passage.id}
					role="listitem"
					style={{
						height: passageNavigatorRowHeight,
						top: `calc(var(--sp-3) + ${
							(virtual.start + offset) * passageNavigatorRowHeight
						}px)`
					}}
				>
					<button
						aria-current={passage.id === selectedPassageId ? 'true' : undefined}
						className={classNames('story-edit-passage-list-item', {
							selected: passage.id === selectedPassageId
						})}
						onClick={() => onSelectPassage(passage)}
						type="button"
					>
						<span className="story-edit-passage-file-icon">
							<TablerIcon
								icon={
									story.startPassage === passage.id ? 'rocket' : 'file-text'
								}
							/>
						</span>
						<span className="story-edit-passage-list-name">
							<VisibleWhitespace value={passage.name} />
						</span>
						{passage.tags.length > 0 && (
							<span className="story-edit-passage-tag-count">
								{passage.tags.length}
							</span>
						)}
						{story.startPassage === passage.id && (
							<span className="story-edit-passage-start">
								{t('routes.storyEdit.workspace.startPassage')}
							</span>
						)}
						{(diagnosticsByPassage.get(passage.id) ?? 0) > 0 && (
							<span className="story-edit-passage-diagnostic-count">
								{diagnosticsByPassage.get(passage.id)}
							</span>
						)}
					</button>
				</div>
			))}
		</div>
	);
};

const StoryOpenProgress: React.FC<{state: StoryOpenProgressState}> = ({
	state
}) => (
	<div
		aria-label={state.label}
		aria-valuemax={100}
		aria-valuemin={0}
		aria-valuenow={state.progress}
		className="story-edit-open-progress"
		role="progressbar"
	>
		<div className="story-edit-open-progress__copy">
			<span>{state.label}</span>
			<b>{state.detail}</b>
		</div>
		<div className="story-edit-open-progress__track">
			<span style={{width: `${state.progress}%`}} />
		</div>
	</div>
);

const NavigatorTabs: React.FC<{
	activeTab: NavigatorTab;
	onChange: (tab: NavigatorTab) => void;
}> = ({activeTab, onChange}) => {
	const {t} = useTranslation();
	const tabs: {label: string; value: NavigatorTab}[] = [
		{label: t('routes.storyEdit.workspace.passages'), value: 'passages'},
		{label: t('routes.storyEdit.workspace.contents'), value: 'contents'},
		{label: t('routes.storyEdit.workspace.assets'), value: 'assets'}
	];

	return (
		<div className="story-edit-navigator-tabs">
			<SegmentedControl
				onChange={value => onChange(value as NavigatorTab)}
				options={tabs}
				size="sm"
				value={activeTab}
			/>
		</div>
	);
};

const AssetManager: React.FC<{
	assets: AssetManagerViewModel;
	host: CoreProjectHost;
	onSelectPassage: (passage: Passage) => void;
	onTestPassage?: (passage: Passage) => void;
	selection: WorkbenchSelection;
	selectedPassageCharacterCount: number;
	story: Story;
	testPassagePending?: boolean;
	testPassagePendingId?: string;
}> = ({
	assets,
	host,
	onSelectPassage,
	onTestPassage,
	selection,
	selectedPassageCharacterCount,
	story,
	testPassagePending = false,
	testPassagePendingId
}) => {
	const navigate = useNavigate();
	const selectedPassage = selection.passage;

	function revealFirstUsage(path: string) {
		const asset = assets.entries.find(entry => entry.path === path);
		const reference = asset?.firstReference;
		const target = reference
			? sourceNavigationTargetFromAssetReference(reference)
			: undefined;
		const passage =
			target?.kind === 'passage'
				? story.passages.find(passage => passage.id === target.passageId)
				: undefined;

		if (passage) {
			onSelectPassage(passage);
		}

		if (target && reference) {
			navigate(
				sourceTarget(story, {
					line: reference.line,
					offset: reference.start,
					target
				})
			);
		}
	}

	return (
		<div className="story-edit-asset-manager">
			<div className="story-edit-asset-toolbar">
				<Button
					icon="photo"
					onClick={() => navigate(`/stories/${story.id}/assets`)}
					size="sm"
					variant="primary"
				>
					Asset Manager
				</Button>
				<span className="story-edit-asset-stat">
					{assets.entries.length} files
				</span>
				<span className="story-edit-asset-stat">
					{assets.referenceCount} references
				</span>
			</div>
			{assets.entries.length === 0 ? (
				<p className="story-edit-empty-assets">No assets indexed</p>
			) : (
				<ol className="story-edit-asset-list">
					{assets.entries.map(asset => {
						const status = asset.missing
							? 'Missing'
							: asset.unused
								? 'Unused'
								: 'Used';
						const testPassage = firstLiveAssetUsagePassage(
							story,
							asset.references
						);

						return (
							<li className="story-edit-asset-item" key={asset.id}>
								<div className="story-edit-asset-preview">
									{asset.thumbnailUrl ? (
										<img alt="" src={asset.thumbnailUrl} />
									) : (
										<span>{asset.kind}</span>
									)}
								</div>
								<div className="story-edit-asset-main">
									<strong>{asset.path}</strong>
									<span>
										{asset.kind}
										{asset.sizeBytes !== null ? ` · ${asset.sizeBytes} B` : ''}
										{asset.width && asset.height
											? ` · ${asset.width}×${asset.height}`
											: ''}
									</span>
									<span>
										{status} · {asset.referenceCount} references ·{' '}
										{asset.publish.copy ? 'Publish' : 'Do not publish'}
									</span>
									{asset.sourceNames.length > 0 && (
										<span>{asset.sourceNames.join(', ')}</span>
									)}
								</div>
								<div className="story-edit-asset-actions">
									<Button
										icon="copy"
										onClick={() =>
											host.applyStoryCommand(
												copyAssetSnippetCommand(
													story.id,
													asset.path,
													asset.snippet.text
												)
											)
										}
										size="sm"
										variant="ghost"
									>
										Copy Snippet
									</Button>
									<Button
										disabled={!selectedPassage}
										icon="plus"
										onClick={() => {
											if (!selectedPassage) {
												return;
											}

											host.applyStoryCommand(
												insertAssetSnippetCommand(
													story.id,
													asset.path,
													selectedPassage.id,
													selectedPassageCharacterCount,
													{
														passageId: selectedPassage.id,
														snippet: asset.snippet.text
													}
												)
											);
										}}
										size="sm"
									>
										Insert
									</Button>
									<Button
										disabled={!asset.firstReference}
										icon="link"
										onClick={() => revealFirstUsage(asset.path)}
										size="sm"
										variant="ghost"
									>
										Usages
									</Button>
									<Button
										disabled={!testPassage || testPassagePending}
										icon="tool"
										loading={
											!!testPassage && testPassagePendingId === testPassage.id
										}
										onClick={() => testPassage && onTestPassage?.(testPassage)}
										size="sm"
										variant="ghost"
									>
										Test First Usage
									</Button>
								</div>
							</li>
						);
					})}
				</ol>
			)}
		</div>
	);
};

const ContentsEntryVisual: React.FC<{entry: ContentsViewModelEntry}> = ({
	entry
}) => {
	const previewUrl = entry.asset?.thumbnailUrl ?? entry.asset?.previewUrl;

	if (
		entry.core.kind === 'asset' &&
		previewUrl &&
		entry.asset?.kind === 'image'
	) {
		return (
			<span className="cn__preview story-edit-contents-preview">
				<img alt="" src={previewUrl} />
			</span>
		);
	}

	return (
		<span className={`cn__ricon story-edit-contents-kind ${entry.core.kind}`}>
			{entry.core.kind}
		</span>
	);
};

const ContentsNavigator: React.FC<{
	contents: ContentsViewModel;
	onOpenSource: (entry: ContentsViewModelEntry) => void;
	onSelectPassage: (passage: Passage) => void;
	story: Story;
}> = ({contents, onOpenSource, onSelectPassage, story}) => {
	const visibleEntries = contents.entries.slice(0, 120);

	let lastGroup: string | undefined;

	return (
		<div className="story-edit-contents-navigator cn">
			<div className="cn__toolbar">
				<span className="story-edit-contents-summary">
					{contents.totalCount} indexed
				</span>
				{contents.problemCount > 0 && (
					<span className="story-edit-contents-problems">
						{contents.problemCount} flagged
					</span>
				)}
			</div>
			<div className="cn__list">
				{visibleEntries.map(entry => {
					const passage = entry.core.passageId
						? story.passages.find(
								passage => passage.id === entry.core.passageId
							)
						: undefined;
					const canOpenSource =
						entry.core.kind === 'variable' ||
						!!sourceNavigationTargetFromContentsEntry(entry.core);
					const showGroup = entry.group !== lastGroup;
					lastGroup = entry.group;
					const content = (
						<>
							<ContentsEntryVisual entry={entry} />
							<span className="cn__rname story-edit-contents-label">
								<b>{entry.label}</b>
							</span>
							<span className="cn__rstats">
								{entry.core.count > 1 && (
									<span className="s story-edit-contents-count">
										{entry.core.count}
									</span>
								)}
								{entry.meta && (
									<span className="story-edit-contents-detail">
										{entry.meta}
									</span>
								)}
							</span>
							{entry.severity && (
								<span
									className={`story-edit-contents-severity ${entry.severity}`}
								/>
							)}
						</>
					);

					return (
						<React.Fragment key={entry.id}>
							{showGroup && <div className="cn__group-h">{entry.group}</div>}
							{passage ? (
								<button
									className={classNames('cn__row', 'story-edit-contents-item', {
										'is-problem': !!entry.severity
									})}
									onClick={() =>
										canOpenSource
											? onOpenSource(entry)
											: onSelectPassage(passage)
									}
									type="button"
								>
									{content}
								</button>
							) : canOpenSource ? (
								<button
									className={classNames('cn__row', 'story-edit-contents-item', {
										'is-problem': !!entry.severity
									})}
									onClick={() => onOpenSource(entry)}
									type="button"
								>
									{content}
								</button>
							) : (
								<div className="cn__row story-edit-contents-item inert">
									{content}
								</div>
							)}
						</React.Fragment>
					);
				})}
			</div>
		</div>
	);
};

const OutlineSection: React.FC<{
	children?: React.ReactNode;
	count?: number | string;
	icon: string;
	title: string;
}> = ({children, count, icon, title}) => (
	<section className="story-edit-outline-section">
		<header className="story-edit-outline-head">
			<TablerIcon icon={icon} />
			<span>{title}</span>
			{count !== undefined && (
				<span className="story-edit-outline-count">{count}</span>
			)}
		</header>
		{children}
	</section>
);

const OutlineItem: React.FC<{
	broken?: boolean;
	color?: string;
	label: string;
	mono?: boolean;
	muted?: boolean;
	onClick?: () => void;
	sub?: string;
}> = ({broken, color, label, mono, muted, onClick, sub}) => {
	const content = (
		<>
			<span
				className="story-edit-outline-dot"
				style={{background: color ?? 'var(--tx-4)'}}
			/>
			<span
				className={classNames('story-edit-outline-label', {
					'is-mono': mono,
					'is-muted': muted
				})}
			>
				{label}
			</span>
			{sub && (
				<span
					className={classNames('story-edit-outline-sub', {
						'is-broken': broken
					})}
				>
					{sub}
				</span>
			)}
		</>
	);

	if (onClick) {
		return (
			<button
				className="story-edit-outline-item"
				onClick={onClick}
				type="button"
			>
				{content}
			</button>
		);
	}

	return <div className="story-edit-outline-item">{content}</div>;
};

const Inspector: React.FC<{
	assets: AssetManagerViewModel;
	diagnostics: DiagnosticsViewModel;
	extensionContext: StoryWorkbenchExtensionContext;
	extensions: readonly StoryWorkbenchInspectorExtension[];
	host: CoreProjectHost;
	index: CoreStoryIndex;
	definitionStatus?: string;
	onFindReferences: (passage: Passage) => void;
	onGoToDefinition: (name: string) => void;
	onRevealPassageInGraph: (passage: Passage) => void;
	onSelectPassage: (passage: Passage) => void;
	onTestPassage?: (passage: Passage) => void;
	selection: WorkbenchSelection;
	story: Story;
	testPassagePending?: boolean;
	testPassagePendingId?: string;
}> = props => {
	const {
		assets,
		definitionStatus,
		diagnostics,
		extensionContext,
		extensions,
		host,
		index,
		onFindReferences,
		onGoToDefinition,
		onRevealPassageInGraph,
		onSelectPassage,
		onTestPassage,
		selection,
		story,
		testPassagePending = false,
		testPassagePendingId
	} = props;
	const {passage} = selection;
	const {t} = useTranslation();
	const backlinks = selection.backlinks;
	const symbolsByName = React.useMemo(() => {
		const result = new Map<string, number>();
		const scopedSymbols = passage
			? index.symbols.filter(symbol => symbol.passageId === passage.id)
			: index.symbols;

		for (const symbol of scopedSymbols) {
			result.set(symbol.name, (result.get(symbol.name) ?? 0) + 1);
		}

		return Array.from(result)
			.sort(([left], [right]) => left.localeCompare(right))
			.slice(0, 8);
	}, [index.symbols, passage]);

	return (
		<div className="story-edit-inspector">
			{passage && (
				<section className="story-edit-inspector-run">
					{onTestPassage && (
						<Button
							block
							disabled={testPassagePending}
							icon="tool"
							loading={testPassagePendingId === passage.id}
							onClick={() => onTestPassage(passage)}
							size="sm"
							variant="primary"
						>
							{t('routes.storyEdit.toolbar.testFromHere')}
						</Button>
					)}
					<Button
						block
						icon="focus-2"
						onClick={() => onRevealPassageInGraph(passage)}
						size="sm"
						variant="ghost"
					>
						{t('routes.storyEdit.workspace.revealInGraph')}
					</Button>
					<Button
						block
						icon="search"
						onClick={() => onFindReferences(passage)}
						size="sm"
						variant="ghost"
					>
						{t('routes.storyEdit.workspace.findReferences')}
					</Button>
				</section>
			)}
			<OutlineSection
				count={selection.links.length}
				icon="arrow-up-right"
				title={t('routes.storyEdit.workspace.links')}
			>
				{selection.linkFacts.length > 0 ? (
					selection.linkFacts.map(link => {
						const linkedPassage = link.targetId
							? story.passages.find(passage => passage.id === link.targetId)
							: undefined;

						return (
							<OutlineItem
								broken={!linkedPassage}
								color={linkedPassage ? 'var(--sem-link)' : 'var(--sem-error)'}
								key={`${link.sourceId}:${link.targetName}`}
								label={link.targetName}
								onClick={() => onGoToDefinition(link.targetName)}
								sub={t('routes.storyEdit.workspace.goToDefinition')}
							/>
						);
					})
				) : (
					<OutlineItem label={t('routes.storyEdit.workspace.noLinks')} muted />
				)}
				{definitionStatus && (
					<p aria-live="polite" className="story-edit-definition-status">
						{definitionStatus}
					</p>
				)}
			</OutlineSection>

			<OutlineSection
				count={selection.backlinkCount}
				icon="arrow-back-up"
				title={t('routes.storyEdit.workspace.backlinks')}
			>
				{backlinks.length > 0 ? (
					backlinks.slice(0, 8).map(backlink => {
						const sourcePassage = story.passages.find(
							passage => passage.id === backlink.sourceId
						);

						return (
							<OutlineItem
								color="var(--tx-4)"
								key={`${backlink.sourceId}:${backlink.targetName}`}
								label={backlink.sourceName}
								onClick={
									sourcePassage
										? () => onSelectPassage(sourcePassage)
										: undefined
								}
								sub={t('common.passage')}
							/>
						);
					})
				) : (
					<OutlineItem label={t('routes.storyEdit.workspace.noLinks')} muted />
				)}
			</OutlineSection>

			<OutlineSection
				count={symbolsByName.length}
				icon="variable"
				title={t('routes.storyEdit.workspace.variables')}
			>
				{symbolsByName.length > 0 ? (
					symbolsByName.map(([name, count]) => (
						<OutlineItem
							color="var(--sem-var)"
							key={name}
							label={name}
							mono
							sub={`${count}`}
						/>
					))
				) : (
					<OutlineItem label={t('colors.none')} muted />
				)}
			</OutlineSection>

			<OutlineSection
				count={passage?.tags.length ?? 0}
				icon="tags"
				title={t('common.tags')}
			>
				{passage && passage.tags.length > 0 ? (
					<div className="story-edit-outline-tags">
						{passage.tags.map(tag => (
							<Tag color={story.tagColors[tag] ?? 'blue'} key={tag}>
								{tag}
							</Tag>
						))}
					</div>
				) : (
					<OutlineItem label={t('colors.none')} muted />
				)}
			</OutlineSection>

			<OutlineSection
				count={diagnostics.totalCount}
				icon="alert-triangle"
				title={t('routes.storyEdit.workspace.diagnostics')}
			>
				{diagnostics.items.length > 0 ? (
					<div className="story-edit-diagnostic-list">
						{diagnostics.items.slice(0, 8).map(item => {
							const diagnosticPassage = item.core.passageId
								? story.passages.find(
										passage => passage.id === item.core.passageId
									)
								: undefined;
							const actions = quickFixActionsForDiagnostic(
								host,
								story,
								item.core
							);

							return (
								<div
									className={classNames(
										'story-edit-diagnostic',
										item.severity,
										{
											'is-on': selection.sourceId === item.core.sourceId
										}
									)}
									key={item.id}
								>
									<Badge
										icon={
											item.severity === 'error'
												? 'alert-octagon'
												: 'alert-triangle'
										}
										tone={item.severity === 'error' ? 'error' : 'warn'}
									>
										{item.core.code}
									</Badge>
									{diagnosticPassage ? (
										<button
											className="story-edit-diagnostic-source"
											onClick={() => onSelectPassage(diagnosticPassage)}
											type="button"
										>
											<span>{diagnosticPassage.name}</span>
											{item.message}
										</button>
									) : (
										<span className="story-edit-diagnostic-message">
											{item.message}
										</span>
									)}
									<div className="story-edit-diagnostic-location">
										{item.location}
									</div>
									{(actions.length > 0 || diagnosticPassage) && (
										<div className="story-edit-diagnostic-fixes">
											{diagnosticPassage && (
												<Button
													icon="focus-2"
													onClick={() =>
														onRevealPassageInGraph(diagnosticPassage)
													}
													size="sm"
													variant="ghost"
												>
													{t('routes.storyEdit.workspace.revealInGraph')}
												</Button>
											)}
											{diagnosticPassage && onTestPassage && (
												<Button
													disabled={testPassagePending}
													icon="tool"
													loading={
														testPassagePendingId === diagnosticPassage.id
													}
													onClick={() => onTestPassage(diagnosticPassage)}
													size="sm"
													variant="ghost"
												>
													{t('routes.storyEdit.toolbar.testFromHere')}
												</Button>
											)}
											{actions.map(action => (
												<Button
													disabled={!action.enabled}
													key={action.command}
													onClick={action.apply}
													size="sm"
													variant="ghost"
												>
													{action.title}
												</Button>
											))}
										</div>
									)}
								</div>
							);
						})}
					</div>
				) : (
					<OutlineItem label={t('colors.none')} muted />
				)}
			</OutlineSection>

			<OutlineSection icon="info-circle" title={t('common.story')}>
				<dl className="story-edit-project-stats">
					<dt>{t('common.storyFormat')}</dt>
					<dd>
						{story.storyFormat} {story.storyFormatVersion}
					</dd>
					<dt>{t('routes.storyEdit.workspace.passages')}</dt>
					<dd>{story.passages.length}</dd>
					<dt>{t('routes.storyEdit.workspace.brokenLinks')}</dt>
					<dd>{index.graph.brokenLinks}</dd>
					<dt>{t('routes.storyEdit.workspace.orphanPassages')}</dt>
					<dd>{index.graph.orphanPassages}</dd>
					<dt>{t('routes.storyEdit.workspace.unreachablePassages')}</dt>
					<dd>{index.graph.unreachablePassages}</dd>
					<dt>{t('routes.storyEdit.workspace.sourceFiles')}</dt>
					<dd>{index.files.length}</dd>
					<dt>{t('routes.storyEdit.workspace.assets')}</dt>
					<dd>{assets.entries.length}</dd>
				</dl>
			</OutlineSection>
			{extensions.map(extension => (
				<section
					className="story-edit-inspector-extension"
					data-workbench-extension={extension.id}
					key={extension.id}
				>
					{extension.render(extensionContext)}
				</section>
			))}
		</div>
	);
};

const LinksBottomDrawerContent: React.FC<{
	onSelectPassage: (passage: Passage) => void;
	selection: WorkbenchSelection;
	story: Story;
}> = ({onSelectPassage, selection, story}) => {
	const {t} = useTranslation();
	const links = selection.linkFacts;

	return links.length > 0 ? (
		<ul>
			{links.map(link => {
				const linkedPassage = link.targetId
					? story.passages.find(passage => passage.id === link.targetId)
					: undefined;

				return (
					<li key={`${link.sourceId}:${link.targetName}`}>
						{linkedPassage ? (
							<button
								className="story-edit-link-chip"
								onClick={() => onSelectPassage(linkedPassage)}
								type="button"
							>
								{link.targetName}
							</button>
						) : (
							<span className="story-edit-link-chip missing">
								{link.targetName}
							</span>
						)}
					</li>
				);
			})}
		</ul>
	) : (
		<p>{t('routes.storyEdit.workspace.noLinks')}</p>
	);
};

const BottomDrawer: React.FC<{
	activePanelId: string;
	extensionContext: StoryWorkbenchExtensionContext;
	onChangeOpen: (value: boolean) => void;
	onChangePanel?: (id: string) => void;
	onSelectPassage: (passage: Passage) => void;
	open: boolean;
	panels: readonly StoryWorkbenchBottomDrawerPanel[];
	selection: WorkbenchSelection;
	story: Story;
}> = props => {
	const {
		activePanelId,
		extensionContext,
		onChangeOpen,
		onChangePanel,
		onSelectPassage,
		open,
		panels,
		selection,
		story
	} = props;
	const {t} = useTranslation();
	const allPanels = React.useMemo<StoryWorkbenchBottomDrawerPanel[]>(
		() => [
			{
				icon: 'link',
				id: 'links',
				render: () => (
					<LinksBottomDrawerContent
						onSelectPassage={onSelectPassage}
						selection={selection}
						story={story}
					/>
				),
				title: t('routes.storyEdit.workspace.bottomDrawer')
			},
			...panels
		],
		[onSelectPassage, panels, selection, story, t]
	);
	const activePanel =
		allPanels.find(panel => panel.id === activePanelId) ?? allPanels[0];

	if (!open) {
		return null;
	}

	return (
		<section
			aria-label={t('routes.storyEdit.workspace.bottomDrawer')}
			className="story-edit-bottom-drawer"
		>
			<Panel
				actions={
					<>
						{allPanels.length > 1 && (
							<span
								aria-label="Workbench bottom panels"
								className="story-edit-bottom-drawer-tabs"
								role="tablist"
							>
								{allPanels.map(panel => (
									<Button
										aria-selected={panel.id === activePanel.id}
										icon={panel.icon}
										key={panel.id}
										onClick={() => onChangePanel?.(panel.id)}
										role="tab"
										size="sm"
										variant={panel.id === activePanel.id ? 'default' : 'ghost'}
									>
										{panel.title}
									</Button>
								))}
							</span>
						)}
						<IconButton
							icon="chevron-down"
							label={t('routes.storyEdit.workspace.closeBottomDrawer')}
							onClick={() => onChangeOpen(false)}
							size="sm"
						/>
					</>
				}
				bodyClassName="story-edit-bottom-drawer-content"
				flush
				icon={activePanel.icon}
				title={activePanel.title}
			>
				<div data-workbench-panel={activePanel.id} role="tabpanel">
					{activePanel.render(extensionContext)}
				</div>
			</Panel>
		</section>
	);
};

export const StoryWorkspaceShell: React.FC<
	StoryWorkspaceShellProps
> = props => {
	const {
		activeBottomDrawerPanelId = 'links',
		activeWindowId,
		bottomDrawerOpen,
		bottomDrawerPanels = [],
		editorDockLayout,
		editorWindows,
		graphPanel,
		inspectorExtensions = [],
		leftDockCollapsed,
		mode,
		onChangeBottomDrawerOpen,
		onChangeBottomDrawerPanel,
		onChangeEditorDockLayout,
		onChangeLeftDockCollapsed,
		onChangeRightDockCollapsed,
		onCloseEditorWindow,
		onFocusEditorWindow,
		onOpenEditorWindow,
		onOpenFindReplace,
		onReorderEditorWindows,
		onRevealPassageInGraph,
		onSelectPassage,
		onTestPassage,
		overlay,
		revealRequests,
		rightDockCollapsed,
		searchRequests,
		selectedPassageId,
		story,
		testPassagePending = false,
		testPassagePendingId
	} = props;
	const coreProjectHost = useCoreProjectHost();
	const navigate = useNavigate();
	const {dispatch: storiesDispatch, stories} = useStoriesContext();
	const [patchVersion, setPatchVersion] = React.useState(0);
	const [dismissalsVersion, setDismissalsVersion] = React.useState(0);
	const [referenceTargetId, setReferenceTargetId] = React.useState<string>();
	const [definitionStatus, setDefinitionStatus] = React.useState<string>();
	const definitionRequestGeneration = React.useRef(0);
	const referenceRevealGeneration = React.useRef(0);
	const semanticNavigationMounted = React.useRef(true);
	const semanticNavigationStoryId = React.useRef(story.id);
	const referenceTargetIdRef = React.useRef(referenceTargetId);
	if (semanticNavigationStoryId.current !== story.id) {
		semanticNavigationStoryId.current = story.id;
		definitionRequestGeneration.current += 1;
		referenceRevealGeneration.current += 1;
	}
	referenceTargetIdRef.current = referenceTargetId;
	const hydratingStories = React.useRef(new Set<string>());
	const hydrationOwners = React.useRef(
		new Map<
			string,
			{
				abandoned: boolean;
				coreLeaseAcquired: boolean;
				coreAbortRequested: boolean;
				coreLease?: symbol;
				nativeHydrationId?: string;
				phase: 'native-begin' | 'core-begin' | 'streaming';
				tokens: Set<symbol>;
			}
		>()
	);
	const [hydrationAttempt, setHydrationAttempt] = React.useState(0);
	const storiesRef = React.useRef(stories);
	storiesRef.current = stories;
	React.useEffect(() => {
		semanticNavigationMounted.current = true;
		return () => {
			semanticNavigationMounted.current = false;
			definitionRequestGeneration.current += 1;
			referenceRevealGeneration.current += 1;
		};
	}, []);
	React.useEffect(() => {
		setDefinitionStatus(undefined);
		setReferenceTargetId(undefined);
	}, [story.id]);
	const highlightExtensionPassages = React.useCallback(
		(passageIds: string[]) => {
			const currentStory = storiesRef.current.find(
				candidate => candidate.id === story.id
			);

			if (currentStory) {
				storiesDispatch(highlightPassages(currentStory, passageIds));
			}
		},
		[storiesDispatch, story.id]
	);
	const hydration = useProjectStoryHydration(story.id);
	const projectMetadata = React.useMemo(
		() => loadProjectMetadata(story.id),
		[story.id]
	);
	const isFileBackedStory =
		projectMetadata?.storageKind === 'electron-project-folder' &&
		projectMetadata.status === 'file-backed';
	const passageTextLoaded =
		!isFileBackedStory || hydration?.passageTextLoaded !== false;
	const shellIndex = React.useMemo(() => emptyStoryIndex(story.id), [story.id]);
	const [dockModel, setDockModel] = React.useState<CoreWorkbenchDockModel>();
	const [passageFacts, setPassageFacts] =
		React.useState<CorePassageLocalFacts>();
	const [backlinkPage, setBacklinkPage] = React.useState<CoreBacklinksPage>();
	const [navigatorTab, setNavigatorTab] = usePersistedNavigatorTab(story.id);
	const needsDockModel = navigatorTab !== 'passages' || bottomDrawerOpen;
	const openProgress = React.useMemo<StoryOpenProgressState | undefined>(() => {
		if (isFileBackedStory && hydration?.passageTextLoaded === false) {
			return {
				detail: 'Loading passage text',
				label: 'Opening story',
				progress: 46
			};
		}

		return undefined;
	}, [
		dockModel,
		hydration?.passageTextLoaded,
		isFileBackedStory,
		passageTextLoaded,
		story.passages.length
	]);

	React.useEffect(() => {
		if (passageTextLoaded) {
			return;
		}

		if (
			projectMetadata?.storageKind !== 'electron-project-folder' ||
			projectMetadata.status !== 'file-backed' ||
			!projectMetadata.rootPath
		) {
			return;
		}

		const bridge = (window as TwineElectronWindow).twineElectron;
		const projectRoot = projectMetadata.rootPath;
		const hydrateKey = `${projectMetadata.rootPath}:${story.id}`;

		if (!bridge) {
			return;
		}

		const token = Symbol('project-hydration-owner');
		const existingOwner = hydrationOwners.current.get(hydrateKey);

		if (existingOwner) {
			existingOwner.abandoned = false;
			existingOwner.tokens.add(token);
			recordPerformanceHarnessEvent('renderer-project-hydration-ownership', {
				event: 'attached',
				phase: existingOwner.phase,
				rootPath: projectRoot,
				storyId: story.id
			});
			return () => {
				existingOwner.tokens.delete(token);
				void Promise.resolve().then(() => {
					if (existingOwner.tokens.size > 0) return;
					existingOwner.abandoned = true;
					if (
						existingOwner.coreLeaseAcquired &&
						!existingOwner.coreAbortRequested
					) {
						existingOwner.coreAbortRequested = true;
						recordPerformanceHarnessEvent('renderer-project-hydration-abort', {
							phase: existingOwner.phase,
							rootPath: projectRoot,
							storyId: story.id
						});
						void (
							existingOwner.coreLease
								? coreProjectHost.abortHydratedProject(
										story.id,
										existingOwner.coreLease
									)
								: coreProjectHost.abortHydratedProject(story.id)
						).catch(() => undefined);
					}
				});
			};
		}

		const owner = {
			abandoned: false,
			coreAbortRequested: false,
			coreLeaseAcquired: false,
			coreLease: undefined as symbol | undefined,
			replacementLease: undefined as symbol | undefined,
			phase: 'native-begin' as 'native-begin' | 'core-begin' | 'streaming',
			nativeHydrationId: undefined as string | undefined,
			tokens: new Set([token])
		};
		hydrationOwners.current.set(hydrateKey, owner);
		const abortCoreHydration = () =>
			owner.coreLease
				? coreProjectHost.abortHydratedProject(story.id, owner.coreLease)
				: coreProjectHost.abortHydratedProject(story.id);
		const appendCoreHydration = (
			storyId: string,
			passages: PassageWithText[]
		) =>
			owner.coreLease
				? coreProjectHost.appendHydratedProjectPassages(
						storyId,
						passages,
						owner.coreLease
					)
				: coreProjectHost.appendHydratedProjectPassages(storyId, passages);
		const finishCoreHydration = () =>
			owner.coreLease
				? coreProjectHost.finishHydratedProject(story.id, owner.coreLease)
				: coreProjectHost.finishHydratedProject(story.id);
		const abortProjectReplacement = () =>
			owner.replacementLease
				? coreProjectHost.abortProjectReplacement(
						story.id,
						owner.replacementLease
					)
				: Promise.resolve();
		hydratingStories.current.add(hydrateKey);
		recordPerformanceHarnessEvent('renderer-project-hydration-start', {
			rootPath: projectRoot,
			storyId: story.id
		});
		const projectStoryIds = stories
			.filter(candidate => {
				const metadata = loadProjectMetadata(candidate.id);
				return metadata?.rootPath === projectMetadata.rootPath;
			})
			.map(candidate => candidate.id);
		void (async () => {
			const canStream =
				!!bridge.beginProjectFolderHydration &&
				!!bridge.readProjectFolderHydrationChunk &&
				!!bridge.finishProjectFolderHydration;
			let result;
			let coreHydrationComplete = false;
			let primaryError: unknown;
			let cleanupError: unknown;
			let hydrationChunkCount = 0;
			try {
				owner.replacementLease =
					await coreProjectHost.acquireProjectReplacement(story.id);
				if (owner.abandoned) return;
				if (canStream) {
					const start = await bridge.beginProjectFolderHydration(
						projectRoot,
						projectStoryIds
					);
					owner.nativeHydrationId = start.hydrationId;
					if (owner.abandoned) return;
					const metadataStories = start.stories.map(candidate => ({
						...candidate,
						passages: [] as Passage[]
					}));
					const metadataById = new Map(
						metadataStories.map(candidate => [candidate.id, candidate])
					);
					owner.phase = 'core-begin';
					const coreLease = await coreProjectHost.beginHydratedProject(
						story.id,
						start.stories,
						owner.replacementLease
					);
					owner.replacementLease = undefined;
					owner.coreLease =
						typeof coreLease === 'symbol' ? coreLease : undefined;
					owner.coreLeaseAcquired = true;
					recordPerformanceHarnessEvent(
						'renderer-project-hydration-ownership',
						{
							event: 'core-lease-acquired',
							rootPath: projectRoot,
							storyId: story.id
						}
					);
					if (owner.abandoned) {
						owner.coreAbortRequested = true;
						recordPerformanceHarnessEvent('renderer-project-hydration-abort', {
							phase: owner.phase,
							rootPath: projectRoot,
							storyId: story.id
						});
						await abortCoreHydration();
						return;
					}
					owner.phase = 'streaming';
					let cursor = 0;
					let done = false;
					while (!done) {
						const chunk = await bridge.readProjectFolderHydrationChunk(
							start.hydrationId,
							cursor,
							1000
						);
						if (owner.coreAbortRequested) {
							throw new Error('Project hydration was superseded.');
						}
						hydrationChunkCount++;
						const byStory = new Map<string, PassageWithText[]>();
						for (const {passage, storyId} of chunk.passages) {
							const passages = byStory.get(storyId) ?? [];
							passages.push(passage);
							byStory.set(storyId, passages);
							const metadataPassage: Passage = {...passage};
							delete (metadataPassage as Partial<PassageWithText>).text;
							metadataById.get(storyId)?.passages.push(metadataPassage);
						}
						for (const [storyId, passages] of byStory) {
							await appendCoreHydration(storyId, passages);
							if (owner.coreAbortRequested) {
								throw new Error('Project hydration was superseded.');
							}
						}
						cursor = chunk.nextCursor;
						done = chunk.done;
					}
					await finishCoreHydration();
					coreHydrationComplete = true;
					if (owner.coreAbortRequested) {
						throw new Error('Project hydration was superseded.');
					}
					result = {
						...start,
						passageTextLoaded: true,
						stories: metadataStories
					};
				} else {
					result = await bridge.hydrateProjectFolder(
						projectRoot,
						projectStoryIds
					);
					if (owner.abandoned) return;
				}

				recordPerformanceHarnessEvent('native-project-hydrated', {
					...result.loadPerformanceTimings,
					hydrationChunkCount,
					hydrationMode: canStream ? 'streamed' : 'full',
					graphLayoutLoaded: result.graphLayoutLoaded,
					passageTextLoaded: result.passageTextLoaded,
					rootPath: result.rootPath,
					storySourcesLoaded: result.storySourcesLoaded,
					storyCount: result.stories.length
				});
				if (result.stories.length > 0) {
					if (!canStream) {
						await coreProjectHost.initializeHydratedProject(
							story.id,
							result.stories,
							owner.replacementLease
						);
						owner.replacementLease = undefined;
						coreHydrationComplete = true;
					}
					if (owner.abandoned) return;
					const metadataStories = result.stories.map(candidate => ({
						...candidate,
						passages: candidate.passages.map(passage => ({
							...passage,
							text: ''
						}))
					}));
					const mergeStarted = performance.now();
					const hydratedStories = mergeProjectStories(
						storiesRef.current,
						metadataStories,
						{preserveExistingText: false}
					);
					recordPerformanceHarnessEvent('renderer-project-hydration-merged', {
						durationMs: performance.now() - mergeStarted,
						passageCount: hydratedStories.reduce(
							(total, candidate) => total + candidate.passages.length,
							0
						)
					});

					const dispatchStarted = performance.now();
					storiesRef.current = hydratedStories;
					storiesDispatch({
						state: hydratedStories,
						type: 'init'
					});
					if (owner.abandoned) return;
					recordPerformanceHarnessEvent(
						'renderer-project-hydration-dispatched',
						{
							durationMs: performance.now() - dispatchStarted
						}
					);
					for (const hydratedStory of result.stories) {
						markProjectStoryHydration(hydratedStory.id, {
							passageTextLoaded: true,
							rootPath: projectMetadata.rootPath
						});
					}
					markPerformance('all-passages-ready');
					measurePerformance(
						'open-to-hydrated',
						'open-start',
						'all-passages-ready'
					);
				}
			} catch (error) {
				primaryError = error;
			} finally {
				try {
					if (
						owner.coreLeaseAcquired &&
						!coreHydrationComplete &&
						!owner.coreAbortRequested
					) {
						owner.coreAbortRequested = true;
						recordPerformanceHarnessEvent('renderer-project-hydration-abort', {
							phase: owner.phase,
							rootPath: projectRoot,
							storyId: story.id
						});
						await abortCoreHydration();
					}
					if (owner.replacementLease) {
						await abortProjectReplacement();
						owner.replacementLease = undefined;
					}
				} catch (error) {
					cleanupError = error;
				}
				try {
					if (owner.nativeHydrationId) {
						await bridge.finishProjectFolderHydration(owner.nativeHydrationId);
					}
				} catch (error) {
					cleanupError ??= error;
				}
				hydratingStories.current.delete(hydrateKey);
				if (hydrationOwners.current.get(hydrateKey) === owner) {
					hydrationOwners.current.delete(hydrateKey);
				}
				recordPerformanceHarnessEvent('renderer-project-hydration-terminal', {
					abandoned: owner.abandoned,
					coreLeaseAcquired: owner.coreLeaseAcquired,
					rootPath: projectRoot,
					storyId: story.id
				});
				if (owner.tokens.size > 0 && owner.coreAbortRequested) {
					setHydrationAttempt(attempt => attempt + 1);
				}
			}
			if (primaryError) throw primaryError;
			if (cleanupError) throw cleanupError;
		})().catch(error =>
			console.warn(`Could not hydrate project folder story: ${error}`)
		);
		return () => {
			owner.tokens.delete(token);
			void Promise.resolve().then(() => {
				if (owner.tokens.size > 0) return;
				owner.abandoned = true;
				if (!owner.coreLeaseAcquired || owner.coreAbortRequested) return;
				owner.coreAbortRequested = true;
				recordPerformanceHarnessEvent('renderer-project-hydration-abort', {
					phase: owner.phase,
					rootPath: projectRoot,
					storyId: story.id
				});
				void abortCoreHydration().catch(() => undefined);
			});
		};
	}, [
		coreProjectHost,
		passageTextLoaded,
		projectMetadata,
		stories,
		storiesDispatch,
		story.id,
		hydrationAttempt
	]);

	React.useEffect(
		() =>
			coreProjectHost.subscribeToPatches(batch => {
				handlePatchSideEffects(batch);
				setPatchVersion(version => version + 1);
			}),
		[coreProjectHost]
	);

	React.useEffect(() => {
		function handleDismissalsChanged() {
			setDismissalsVersion(version => version + 1);
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
	}, []);

	React.useEffect(() => {
		let active = true;

		setDockModel(undefined);

		if (!passageTextLoaded || !needsDockModel) {
			return () => {
				active = false;
			};
		}
		const loadDockModel = () => {
			recordPerformanceHarnessEvent('workbench-dock-model-requested', {
				bottomDrawerOpen,
				navigatorTab,
				passageCount: story.passages.length,
				storyId: story.id
			});
			void coreProjectHost
				.queryWorkbenchDockModelAsync(story.id)
				.then(model => {
					if (active) {
						setDockModel(model);
					}
				});
		};

		loadDockModel();

		return () => {
			active = false;
		};
	}, [
		coreProjectHost,
		bottomDrawerOpen,
		needsDockModel,
		navigatorTab,
		passageTextLoaded,
		patchVersion,
		story.id
	]);

	React.useEffect(() => {
		let active = true;
		const passageId = selectedPassageId ?? story.startPassage;

		if (!passageId || !passageTextLoaded) {
			setPassageFacts(undefined);
			setBacklinkPage(undefined);
			return () => {
				active = false;
			};
		}

		setPassageFacts(undefined);
		setBacklinkPage(undefined);
		void coreProjectHost
			.queryPassageLocalFactsAsync(story.id, passageId)
			.then(facts => {
				if (active) {
					setPassageFacts(facts.revision > 0 ? facts : undefined);
				}
			});
		void coreProjectHost
			.queryBacklinksPageAsync(story.id, passageId, {limit: 8})
			.then(page => {
				if (active) {
					setBacklinkPage(page.revision > 0 ? page : undefined);
				}
			});

		return () => {
			active = false;
		};
	}, [
		coreProjectHost,
		passageTextLoaded,
		patchVersion,
		selectedPassageId,
		story
	]);

	const index = React.useMemo<CoreStoryIndex>(
		() => ({
			...shellIndex,
			assetInventory: dockModel?.assets.assets ?? [],
			contents: dockModel?.contents.entries ?? [],
			diagnostics: dockModel?.diagnostics.diagnostics ?? [],
			symbols: passageFacts?.symbols ?? []
		}),
		[dockModel, passageFacts?.symbols, shellIndex]
	);
	const dismissedDiagnosticIds = React.useMemo(
		() => loadDismissedDiagnosticIds(story.id),
		[dismissalsVersion, story.id]
	);
	const activeIndex = React.useMemo(() => {
		const diagnostics = index.diagnostics.filter(
			diagnostic => !dismissedDiagnosticIds.has(diagnosticIdentity(diagnostic))
		);
		const contentDiagnosticIds = new Set(
			diagnostics.map(
				diagnostic =>
					`diagnostic:${diagnostic.code}:${diagnostic.sourceId}:${diagnostic.start}`
			)
		);

		return {
			...index,
			contents: index.contents.filter(
				entry =>
					(entry.kind !== 'diagnostic' && entry.kind !== 'brokenLink') ||
					contentDiagnosticIds.has(entry.id)
			),
			diagnostics
		};
	}, [dismissedDiagnosticIds, index]);
	const contents = React.useMemo(() => {
		const model = contentsViewModel(activeIndex);
		return dockModel
			? {
					...model,
					problemCount: dockModel.contents.facets.problems,
					totalCount: dockModel.contents.totalCount
				}
			: model;
	}, [activeIndex, dockModel]);
	const diagnostics = React.useMemo(
		() => diagnosticsViewModel(activeIndex, story),
		[activeIndex, story]
	);
	const assets = React.useMemo(() => assetManagerViewModel(index), [index]);
	const selection = React.useMemo(
		() =>
			selectionFromPassageFacts(
				story,
				boundedWorkbenchSelection(story, selectedPassageId),
				passageFacts,
				backlinkPage
			),
		[backlinkPage, passageFacts, selectedPassageId, story]
	);
	const extensionContext = React.useMemo<StoryWorkbenchExtensionContext>(
		() => ({
			host: coreProjectHost,
			onHighlightPassages: highlightExtensionPassages,
			onRevealPassageInGraph,
			onSelectPassage,
			onTestPassage,
			selection,
			onOpenEditorWindow,
			story
		}),
		[
			coreProjectHost,
			highlightExtensionPassages,
			onOpenEditorWindow,
			onRevealPassageInGraph,
			onSelectPassage,
			onTestPassage,
			selection,
			story
		]
	);
	const passage = selection.passage;
	// The dock's open buffers. `undefined` follows the current selection so
	// selecting a passage in Split/Text mode shows it without an explicit open.
	const dockWindows = React.useMemo<EditorWindowSpec[]>(() => {
		const availableIds = new Set(story.passages.map(passage => passage.id));

		if (editorWindows) {
			return editorWindows.filter(
				window_ =>
					window_.kind !== 'passage' || availableIds.has(window_.passageId)
			);
		}

		return passage ? [{kind: 'passage', passageId: passage.id}] : [];
	}, [editorWindows, passage, story.passages]);
	// Per-passage-window selection facts, keyed by window id.
	const dockSelections = React.useMemo(
		() =>
			new Map(
				dockWindows
					.filter(window_ => window_.kind === 'passage')
					.map(window_ => [
						editorWindowId(window_),
						selectionFromPassageFacts(
							story,
							boundedWorkbenchSelection(
								story,
								window_.kind === 'passage' ? window_.passageId : undefined
							),
							window_.kind === 'passage' &&
								window_.passageId === selection.passage?.id
								? passageFacts
								: undefined,
							window_.kind === 'passage' &&
								window_.passageId === selection.passage?.id
								? backlinkPage
								: undefined
						)
					])
			),
		[backlinkPage, dockWindows, passageFacts, selection.passage?.id, story]
	);
	const {t} = useTranslation();

	function currentReferencePassage(location: CorePassageLocation) {
		const currentStory = storiesRef.current.find(
			candidate => candidate.id === location.storyId
		);
		if (
			location.storyId !== story.id ||
			location.revision !== coreProjectHost.sessionStatus(story.id).revision ||
			location.span.encoding !== 'utf16-code-units' ||
			!currentStory
		) {
			return undefined;
		}

		return currentStory.passages.find(
			passage => passage.id === location.passageId
		);
	}

	function closePassageReferences() {
		referenceRevealGeneration.current += 1;
		referenceTargetIdRef.current = undefined;
		setReferenceTargetId(undefined);
	}

	function handleLocalBufferChange() {
		if (referenceTargetIdRef.current) {
			closePassageReferences();
		}
	}

	async function revealReference(
		location: CorePassageLocation,
		reveal: (sourcePassage: Passage) => void
	) {
		const generation = ++referenceRevealGeneration.current;
		const requestStoryId = story.id;
		const targetId = referenceTargetIdRef.current;
		let barrier: WorkbenchStoryMutationBarrier | undefined;
		try {
			barrier =
				await workbenchBufferCoordinator.acquireStoryMutationBarrier(
					requestStoryId
				);
			const ownsRequest =
				semanticNavigationMounted.current &&
				semanticNavigationStoryId.current === requestStoryId &&
				generation === referenceRevealGeneration.current &&
				targetId !== undefined &&
				targetId === referenceTargetIdRef.current;
			const currentStory = storiesRef.current.find(
				candidate => candidate.id === requestStoryId
			);
			const sourcePassages =
				currentStory?.passages.filter(
					passage => passage.id === location.passageId
				) ?? [];
			if (
				!ownsRequest ||
				!barrier.isCurrent() ||
				location.storyId !== requestStoryId ||
				location.revision !==
					coreProjectHost.sessionStatus(requestStoryId).revision ||
				location.span.encoding !== 'utf16-code-units' ||
				!currentStory?.passages.some(passage => passage.id === targetId) ||
				sourcePassages.length !== 1
			) {
				throw new Error(t('routes.storyEdit.workspace.definitionStale'));
			}

			reveal(sourcePassages[0]);
			closePassageReferences();
		} catch (reason) {
			if (
				reason instanceof Error &&
				reason.message === t('routes.storyEdit.workspace.definitionStale')
			) {
				throw reason;
			}
			throw new Error(t('components.passageReferences.revealFailed'));
		} finally {
			barrier?.release();
		}
	}

	function handleRevealReferenceInSource(location: CorePassageLocation) {
		return revealReference(location, sourcePassage => {
			onSelectPassage(sourcePassage);
			onOpenEditorWindow?.({kind: 'passage', passageId: sourcePassage.id});
			navigate(
				sourceTarget(story, {
					endOffset: location.span.end,
					offset: location.span.start,
					target: {kind: 'passage', passageId: sourcePassage.id}
				})
			);
		});
	}

	function handleRevealReferenceInGraph(location: CorePassageLocation) {
		return revealReference(location, onRevealPassageInGraph);
	}

	function handleGoToDefinition(name: string) {
		const generation = ++definitionRequestGeneration.current;
		const requestStoryId = story.id;
		const expectedRevision =
			coreProjectHost.sessionStatus(requestStoryId).revision;
		setDefinitionStatus(undefined);
		void coreProjectHost
			.queryDefinitionAsync({
				expectedRevision,
				name,
				storyId: requestStoryId,
				symbolKind: 'passage'
			})
			.then(result => {
				if (
					generation !== definitionRequestGeneration.current ||
					!semanticNavigationMounted.current ||
					semanticNavigationStoryId.current !== requestStoryId
				)
					return;

				switch (result.type) {
					case 'unique': {
						const location = result.location;
						const passage = currentReferencePassage(location);
						if (!passage || location.passageName !== name) {
							setDefinitionStatus(
								t('routes.storyEdit.workspace.definitionStale')
							);
							return;
						}
						onSelectPassage(passage);
						return;
					}
					case 'ambiguous':
						setDefinitionStatus(
							t('routes.storyEdit.workspace.definitionAmbiguous', {
								count: result.totalCount,
								name
							})
						);
						return;
					case 'not_found':
						setDefinitionStatus(
							t('routes.storyEdit.workspace.definitionNotFound', {name})
						);
						return;
					case 'unsupported':
						setDefinitionStatus(
							t('routes.storyEdit.workspace.definitionUnsupported')
						);
						return;
					case 'stale':
						setDefinitionStatus(
							t('routes.storyEdit.workspace.definitionStale')
						);
				}
			})
			.catch(() => {
				if (
					generation === definitionRequestGeneration.current &&
					semanticNavigationMounted.current &&
					semanticNavigationStoryId.current === requestStoryId
				) {
					setDefinitionStatus(t('routes.storyEdit.workspace.definitionFailed'));
				}
			});
	}
	const showGraph = mode === 'graph' || mode === 'split';
	const showText = mode === 'text' || mode === 'split';
	const referenceTarget = referenceTargetId
		? story.passages.find(passage => passage.id === referenceTargetId)
		: undefined;

	function handleOpenContentsSource(entry: ContentsViewModelEntry) {
		if (entry.core.kind === 'variable') {
			onOpenFindReplace?.(entry.label, {includePassageNames: false});
			return;
		}

		const assetReference =
			entry.core.kind === 'asset' ? entry.asset?.references[0] : undefined;
		const assetTarget = assetReference
			? sourceNavigationTargetFromAssetReference(assetReference)
			: undefined;

		if (assetReference && assetTarget) {
			if (assetTarget.kind === 'passage') {
				const passage = story.passages.find(
					passage => passage.id === assetTarget.passageId
				);

				if (passage) {
					onSelectPassage(passage);
				}
			}

			navigate(
				sourceTarget(story, {
					line: assetReference.line,
					offset: assetReference.start,
					target: assetTarget
				})
			);
			return;
		}

		const target = sourceNavigationTargetFromContentsEntry(entry.core);

		if (!target) {
			return;
		}

		if (target.kind === 'passage') {
			const passage = story.passages.find(
				passage => passage.id === target.passageId
			);

			if (passage) {
				onSelectPassage(passage);
			}
			return;
		}

		onOpenEditorWindow?.(editorWindowSpecForSourceNavigationTarget(target));
	}

	return (
		<div
			className={classNames('story-edit-workspace', `mode-${mode}`, {
				'bottom-drawer-open': bottomDrawerOpen,
				'left-dock-collapsed': leftDockCollapsed,
				'right-dock-collapsed': rightDockCollapsed
			})}
		>
			{referenceTarget && (
				<PassageReferencesDialog
					host={coreProjectHost}
					onClose={closePassageReferences}
					onRevealInGraph={handleRevealReferenceInGraph}
					onRevealInSource={handleRevealReferenceInSource}
					story={story}
					target={referenceTarget}
				/>
			)}
			{openProgress && <StoryOpenProgress state={openProgress} />}
			<aside
				aria-label={t('routes.storyEdit.workspace.leftDock')}
				className="story-edit-dock story-edit-left-dock"
			>
				<DockPanel
					collapsed={leftDockCollapsed}
					icon={
						navigatorTab === 'contents'
							? 'list-details'
							: navigatorTab === 'assets'
								? 'photo'
								: 'files'
					}
					label={t('routes.storyEdit.workspace.leftDock')}
					onChangeCollapsed={onChangeLeftDockCollapsed}
					side="left"
					title={
						navigatorTab === 'contents'
							? t('routes.storyEdit.workspace.contents')
							: navigatorTab === 'assets'
								? t('routes.storyEdit.workspace.assets')
								: t('routes.storyEdit.workspace.passages')
					}
				>
					<NavigatorTabs activeTab={navigatorTab} onChange={setNavigatorTab} />
					{navigatorTab === 'passages' ? (
						<PassageNavigator
							index={activeIndex}
							onSelectPassage={onSelectPassage}
							selectedPassageId={passage?.id}
							story={story}
						/>
					) : navigatorTab === 'contents' ? (
						<ContentsNavigator
							contents={contents}
							onOpenSource={handleOpenContentsSource}
							onSelectPassage={onSelectPassage}
							story={story}
						/>
					) : (
						<AssetManager
							assets={assets}
							host={coreProjectHost}
							onSelectPassage={onSelectPassage}
							onTestPassage={onTestPassage}
							selection={selection}
							selectedPassageCharacterCount={
								passageFacts && passageFacts.passageId === selection.passage?.id
									? passageFacts.characterCount
									: 0
							}
							story={story}
							testPassagePending={testPassagePending}
							testPassagePendingId={testPassagePendingId}
						/>
					)}
				</DockPanel>
			</aside>
			{showGraph && graphPanel}
			{showText && (
				<div className="story-edit-text-layer">
					<EditorDock
						activeId={activeWindowId}
						compact={mode === 'split'}
						index={activeIndex}
						layout={editorDockLayout}
						onChangeLayout={onChangeEditorDockLayout}
						onClose={spec => onCloseEditorWindow?.(spec)}
						onFocus={id => onFocusEditorWindow?.(id)}
						onLocalBufferChange={handleLocalBufferChange}
						onOpen={spec => onOpenEditorWindow?.(spec)}
						onReorder={(from, to) => onReorderEditorWindows?.(from, to)}
						onRevealPassageInGraph={onRevealPassageInGraph}
						onSelectPassage={onSelectPassage}
						onTestPassage={onTestPassage}
						revealRequests={revealRequests}
						searchRequests={searchRequests}
						selectedPassageId={selectedPassageId}
						selections={dockSelections}
						story={story}
						testPassagePending={testPassagePending}
						testPassagePendingId={testPassagePendingId}
						windows={dockWindows}
					/>
				</div>
			)}
			<aside
				aria-label={t('routes.storyEdit.workspace.rightDock')}
				className="story-edit-dock story-edit-right-dock"
			>
				<DockPanel
					collapsed={rightDockCollapsed}
					icon="focus-2"
					label={t('routes.storyEdit.workspace.rightDock')}
					onChangeCollapsed={onChangeRightDockCollapsed}
					side="right"
					title={t('routes.storyEdit.workspace.inspector')}
				>
					<Inspector
						assets={assets}
						definitionStatus={definitionStatus}
						diagnostics={diagnostics}
						extensionContext={extensionContext}
						extensions={inspectorExtensions}
						host={coreProjectHost}
						index={index}
						onFindReferences={passage => {
							referenceRevealGeneration.current += 1;
							setReferenceTargetId(passage.id);
						}}
						onGoToDefinition={handleGoToDefinition}
						onRevealPassageInGraph={onRevealPassageInGraph}
						onSelectPassage={onSelectPassage}
						onTestPassage={onTestPassage}
						selection={selection}
						story={story}
						testPassagePending={testPassagePending}
						testPassagePendingId={testPassagePendingId}
					/>
				</DockPanel>
			</aside>
			<BottomDrawer
				activePanelId={activeBottomDrawerPanelId}
				extensionContext={extensionContext}
				onChangeOpen={onChangeBottomDrawerOpen}
				onChangePanel={onChangeBottomDrawerPanel}
				onSelectPassage={onSelectPassage}
				open={bottomDrawerOpen}
				panels={bottomDrawerPanels}
				selection={selection}
				story={story}
			/>
			{overlay}
		</div>
	);
};
