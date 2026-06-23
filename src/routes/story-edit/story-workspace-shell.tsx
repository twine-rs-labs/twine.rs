import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {useHistory} from 'react-router-dom';
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
import {
	assetManagerViewModel,
	contentsViewModel,
	copyAssetSnippetCommand,
	diagnosticDismissalsChangedEvent,
	diagnosticIdentity,
	diagnosticsViewModel,
	insertAssetSnippetCommand,
	loadDismissedDiagnosticIds,
	storyShellIndex,
	useKnownAssetInventoryForStory,
	useCoreProjectHost,
	workbenchSelection
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
import type {CoreContentsEntry} from '../../core/bindings/CoreContentsEntry';
import {quickFixActionsForDiagnostic} from '../../core/quick-fix-registry';
import type {CoreProjectHost} from '../../core/project-host';
import type {TwineElectronWindow} from '../../electron/shared';
import {useDialogsContext} from '../../dialogs/context';
import {
	canOpenStorySource,
	openStorySourceDialog
} from '../../dialogs/story-source-dialog';
import {loadProjectMetadata} from '../../store/project-metadata';
import {
	markProjectStoryHydration,
	useProjectStoryHydration
} from '../../store/project-hydration';
import {mergeProjectStories} from '../../store/merge-project-stories';
import {Passage, Story, useStoriesContext} from '../../store/stories';
import {
	markPerformance,
	measurePerformance,
	scheduleIdleWork
} from '../../util/performance';
import {StoryEditMode} from './workspace-state';
import {EditorDock} from './editor-dock';
import {EditorWindowSpec, editorWindowId} from './editor-window-spec';

export interface StoryWorkspaceShellProps {
	activeWindowId?: string;
	bottomDrawerOpen: boolean;
	editorWindows?: EditorWindowSpec[];
	graphPanel: React.ReactNode;
	leftDockCollapsed: boolean;
	mode: StoryEditMode;
	onChangeBottomDrawerOpen: (value: boolean) => void;
	onChangeLeftDockCollapsed: (value: boolean) => void;
	onChangeRightDockCollapsed: (value: boolean) => void;
	onCloseEditorWindow?: (spec: EditorWindowSpec) => void;
	onFocusEditorWindow?: (id: string) => void;
	onOpenEditorWindow?: (spec: EditorWindowSpec) => void;
	onReorderEditorWindows?: (from: number, to: number) => void;
	onRevealPassageInGraph: (passage: Passage) => void;
	onSelectPassage: (passage: Passage) => void;
	onTestPassage?: (passage: Passage) => void;
	overlay?: React.ReactNode;
	rightDockCollapsed: boolean;
	selectedPassageId?: string;
	story: Story;
}

type NavigatorTab = 'passages' | 'contents' | 'assets';
const deferIndexPassageThreshold = 500;
const passageNavigatorRowHeight = 30;
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
	story: Story;
}> = ({assets, host, onSelectPassage, onTestPassage, selection, story}) => {
	const history = useHistory();
	const selectedPassage = selection.passage;

	function revealFirstUsage(path: string) {
		const asset = assets.entries.find(entry => entry.path === path);
		const passage = asset?.firstReference?.passageId
			? story.passages.find(
					passage => passage.id === asset.firstReference?.passageId
				)
			: undefined;

		if (passage) {
			onSelectPassage(passage);
		}
	}

	function testFirstUsage(path: string) {
		const asset = assets.entries.find(entry => entry.path === path);
		const passage = asset?.firstReference?.passageId
			? story.passages.find(
					passage => passage.id === asset.firstReference?.passageId
				)
			: undefined;

		if (passage) {
			onTestPassage?.(passage);
		}
	}

	return (
		<div className="story-edit-asset-manager">
			<div className="story-edit-asset-toolbar">
				<Button
					icon="photo"
					onClick={() => history.push(`/stories/${story.id}/assets`)}
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
													selectedPassage.text.length,
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
										icon="link"
										onClick={() => revealFirstUsage(asset.path)}
										size="sm"
										variant="ghost"
									>
										Usages
									</Button>
									<Button
										disabled={!asset.firstReference?.passageId}
										icon="tool"
										onClick={() => testFirstUsage(asset.path)}
										size="sm"
										variant="ghost"
									>
										Test Usage
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
	onOpenSource: (entry: CoreContentsEntry) => void;
	onSelectPassage: (passage: Passage) => void;
	story: Story;
}> = ({contents, onOpenSource, onSelectPassage, story}) => {
	const visibleEntries = contents.entries.slice(0, 120);

	function passageForEntry(entry: CoreContentsEntry) {
		return entry.passageId
			? story.passages.find(passage => passage.id === entry.passageId)
			: undefined;
	}

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
					const passage = passageForEntry(entry.core);
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
									onClick={() => onSelectPassage(passage)}
									type="button"
								>
									{content}
								</button>
							) : canOpenStorySource(entry.core.sourceId, entry.core.kind) ? (
								<button
									className={classNames('cn__row', 'story-edit-contents-item', {
										'is-problem': !!entry.severity
									})}
									onClick={() => onOpenSource(entry.core)}
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
	host: CoreProjectHost;
	index: CoreStoryIndex;
	onRevealPassageInGraph: (passage: Passage) => void;
	onSelectPassage: (passage: Passage) => void;
	onTestPassage?: (passage: Passage) => void;
	selection: WorkbenchSelection;
	story: Story;
}> = props => {
	const {
		assets,
		diagnostics,
		host,
		index,
		onRevealPassageInGraph,
		onSelectPassage,
		onTestPassage,
		selection,
		story
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
			{passage && onTestPassage && (
				<section className="story-edit-inspector-run">
					<Button
						block
						icon="tool"
						onClick={() => onTestPassage(passage)}
						size="sm"
						variant="primary"
					>
						{t('routes.storyEdit.toolbar.testFromHere')}
					</Button>
					<Button
						block
						icon="focus-2"
						onClick={() => onRevealPassageInGraph(passage)}
						size="sm"
						variant="ghost"
					>
						{t('routes.storyEdit.workspace.revealInGraph')}
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
								onClick={
									linkedPassage
										? () => onSelectPassage(linkedPassage)
										: undefined
								}
								sub={linkedPassage ? t('common.passage') : 'broken'}
							/>
						);
					})
				) : (
					<OutlineItem label={t('routes.storyEdit.workspace.noLinks')} muted />
				)}
			</OutlineSection>

			<OutlineSection
				count={backlinks.length}
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
													icon="tool"
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
		</div>
	);
};

const BottomDrawer: React.FC<{
	onChangeOpen: (value: boolean) => void;
	onSelectPassage: (passage: Passage) => void;
	open: boolean;
	selection: WorkbenchSelection;
	story: Story;
}> = props => {
	const {onChangeOpen, onSelectPassage, open, selection, story} = props;
	const {t} = useTranslation();
	const links = selection.linkFacts;

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
					<IconButton
						icon="chevron-down"
						label={t('routes.storyEdit.workspace.closeBottomDrawer')}
						onClick={() => onChangeOpen(false)}
						size="sm"
					/>
				}
				bodyClassName="story-edit-bottom-drawer-content"
				flush
				icon="link"
				title={t('routes.storyEdit.workspace.bottomDrawer')}
			>
				{links.length > 0 ? (
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
				)}
			</Panel>
		</section>
	);
};

export const StoryWorkspaceShell: React.FC<
	StoryWorkspaceShellProps
> = props => {
	const {
		activeWindowId,
		bottomDrawerOpen,
		editorWindows,
		graphPanel,
		leftDockCollapsed,
		mode,
		onChangeBottomDrawerOpen,
		onChangeLeftDockCollapsed,
		onChangeRightDockCollapsed,
		onCloseEditorWindow,
		onFocusEditorWindow,
		onOpenEditorWindow,
		onReorderEditorWindows,
		onRevealPassageInGraph,
		onSelectPassage,
		onTestPassage,
		overlay,
		rightDockCollapsed,
		selectedPassageId,
		story
	} = props;
	const coreProjectHost = useCoreProjectHost();
	const {dispatch: storiesDispatch, stories} = useStoriesContext();
	const [patchVersion, setPatchVersion] = React.useState(0);
	const [dismissalsVersion, setDismissalsVersion] = React.useState(0);
	const hydratingStories = React.useRef(new Set<string>());
	const storiesRef = React.useRef(stories);
	const knownAssets = useKnownAssetInventoryForStory(story.id);
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
	const shellIndex = React.useMemo(
		() => storyShellIndex(story, knownAssets),
		[knownAssets, story]
	);
	const [fullIndex, setFullIndex] = React.useState<CoreStoryIndex>();
	const openProgress = React.useMemo<StoryOpenProgressState | undefined>(() => {
		if (isFileBackedStory && hydration?.passageTextLoaded === false) {
			return {
				detail: 'Loading passage text',
				label: 'Opening story',
				progress: 46
			};
		}

		if (
			passageTextLoaded &&
			story.passages.length > deferIndexPassageThreshold &&
			!fullIndex
		) {
			return {
				detail: 'Indexing contents and diagnostics',
				label: 'Opening story',
				progress: 78
			};
		}

		return undefined;
	}, [
		fullIndex,
		hydration?.passageTextLoaded,
		isFileBackedStory,
		passageTextLoaded,
		story.passages.length
	]);

	React.useEffect(() => {
		storiesRef.current = stories;
	}, [stories]);

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
		const hydrateKey = `${projectMetadata.rootPath}:${story.id}`;

		if (
			!bridge?.hydrateProjectFolder ||
			hydratingStories.current.has(hydrateKey)
		) {
			return;
		}

		hydratingStories.current.add(hydrateKey);
		void bridge
			.hydrateProjectFolder(projectMetadata.rootPath, [story.id])
			.then(result => {
				if (result.stories.length > 0) {
					const hydratedStories = mergeProjectStories(
						storiesRef.current,
						result.stories,
						{
							preserveExistingText: true
						}
					);

					storiesRef.current = hydratedStories;
					storiesDispatch({
						state: hydratedStories,
						type: 'init'
					});
					markProjectStoryHydration(story.id, {
						passageTextLoaded: true,
						rootPath: projectMetadata.rootPath
					});
					markPerformance('all-passages-ready');
					measurePerformance(
						'open-to-hydrated',
						'open-start',
						'all-passages-ready'
					);
				}
			})
			.catch(error =>
				console.warn(`Could not hydrate project folder story: ${error}`)
			);
	}, [passageTextLoaded, projectMetadata, stories, storiesDispatch, story.id]);

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

		setFullIndex(undefined);

		if (!passageTextLoaded) {
			return () => {
				active = false;
			};
		}

		const loadFullIndex = () => {
			void coreProjectHost.queryStoryIndexAsync(story.id).then(index => {
				if (active) {
					setFullIndex(index);
				}
			});
		};

		if (story.passages.length <= deferIndexPassageThreshold) {
			loadFullIndex();
			return () => {
				active = false;
			};
		}

		const cancelIdleWork = scheduleIdleWork(loadFullIndex);

		return () => {
			active = false;
			cancelIdleWork();
		};
	}, [coreProjectHost, knownAssets, passageTextLoaded, patchVersion, story]);

	const index = fullIndex ?? shellIndex;
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
	const contents = React.useMemo(
		() => contentsViewModel(activeIndex),
		[activeIndex]
	);
	const diagnostics = React.useMemo(
		() => diagnosticsViewModel(activeIndex, story),
		[activeIndex, story]
	);
	const assets = React.useMemo(() => assetManagerViewModel(index), [index]);
	const selection = React.useMemo(
		() => workbenchSelection(story, activeIndex, selectedPassageId),
		[activeIndex, selectedPassageId, story]
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
						workbenchSelection(
							story,
							activeIndex,
							window_.kind === 'passage' ? window_.passageId : undefined
						)
					])
			),
		[activeIndex, dockWindows, story]
	);
	const {dispatch: dialogsDispatch} = useDialogsContext();
	const {t} = useTranslation();
	const [navigatorTab, setNavigatorTab] = usePersistedNavigatorTab(story.id);
	const showGraph = mode === 'graph' || mode === 'split';
	const showText = mode === 'text' || mode === 'split';

	function handleOpenContentsSource(entry: CoreContentsEntry) {
		openStorySourceDialog(
			dialogsDispatch,
			story.id,
			entry.sourceId,
			entry.kind
		);
	}

	return (
		<div
			className={classNames('story-edit-workspace', `mode-${mode}`, {
				'bottom-drawer-open': bottomDrawerOpen,
				'left-dock-collapsed': leftDockCollapsed,
				'right-dock-collapsed': rightDockCollapsed
			})}
		>
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
							story={story}
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
						onClose={spec => onCloseEditorWindow?.(spec)}
						onFocus={id => onFocusEditorWindow?.(id)}
						onOpen={spec => onOpenEditorWindow?.(spec)}
						onReorder={(from, to) => onReorderEditorWindows?.(from, to)}
						onRevealPassageInGraph={onRevealPassageInGraph}
						onSelectPassage={onSelectPassage}
						onTestPassage={onTestPassage}
						selectedPassageId={selectedPassageId}
						selections={dockSelections}
						story={story}
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
						diagnostics={diagnostics}
						host={coreProjectHost}
						index={index}
						onRevealPassageInGraph={onRevealPassageInGraph}
						onSelectPassage={onSelectPassage}
						onTestPassage={onTestPassage}
						selection={selection}
						story={story}
					/>
				</DockPanel>
			</aside>
			<BottomDrawer
				onChangeOpen={onChangeBottomDrawerOpen}
				onSelectPassage={onSelectPassage}
				open={bottomDrawerOpen}
				selection={selection}
				story={story}
			/>
			{overlay}
		</div>
	);
};
