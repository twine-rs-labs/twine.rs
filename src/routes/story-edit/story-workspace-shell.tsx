import classNames from 'classnames';
import {
	IconChevronDown,
	IconChevronLeft,
	IconChevronRight
} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../components/control/icon-button';
import {TagGrid} from '../../components/tag';
import {VisibleWhitespace} from '../../components/visible-whitespace';
import {
	assetManagerViewModel,
	contentsViewModel,
	diagnosticsViewModel,
	useCoreProjectHost,
	workbenchSelection
} from '../../core';
import type {
	AssetManagerViewModel,
	ContentsViewModel,
	DiagnosticsViewModel,
	WorkbenchSelection
} from '../../core';
import type {CoreStoryIndex} from '../../core/bindings/CoreStoryIndex';
import type {CoreContentsEntry} from '../../core/bindings/CoreContentsEntry';
import {quickFixActionsForDiagnostic} from '../../core/quick-fix-registry';
import type {CoreProjectHost} from '../../core/project-host';
import {useDialogsContext} from '../../dialogs/context';
import {
	canOpenStorySource,
	openStorySourceDialog
} from '../../dialogs/story-source-dialog';
import {Passage, Story} from '../../store/stories';
import {StoryEditMode} from './workspace-state';
import {StoryTextPanel} from './story-text-panel';

export interface StoryWorkspaceShellProps {
	bottomDrawerOpen: boolean;
	graphPanel: React.ReactNode;
	leftDockCollapsed: boolean;
	mode: StoryEditMode;
	onChangeBottomDrawerOpen: (value: boolean) => void;
	onChangeLeftDockCollapsed: (value: boolean) => void;
	onChangeRightDockCollapsed: (value: boolean) => void;
	onSelectPassage: (passage: Passage) => void;
	rightDockCollapsed: boolean;
	selectedPassageId?: string;
	story: Story;
}

type NavigatorTab = 'passages' | 'contents';

function navigatorStorageKey(storyId: string) {
	return `twine-story-edit-navigator-${storyId}`;
}

function readNavigatorTab(storyId: string): NavigatorTab {
	try {
		const value = window.localStorage.getItem(navigatorStorageKey(storyId));

		return value === 'contents' ? 'contents' : 'passages';
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

const DockHeader: React.FC<{
	children: React.ReactNode;
	collapsed: boolean;
	label: string;
	onChangeCollapsed: (value: boolean) => void;
	side: 'left' | 'right';
}> = props => {
	const {children, collapsed, label, onChangeCollapsed, side} = props;
	const {t} = useTranslation();
	const collapseIcon =
		side === 'left' ? <IconChevronLeft /> : <IconChevronRight />;
	const expandIcon =
		side === 'left' ? <IconChevronRight /> : <IconChevronLeft />;

	return (
		<header className="story-edit-dock-header">
			{!collapsed && <h2>{children}</h2>}
			<IconButton
				icon={collapsed ? expandIcon : collapseIcon}
				iconOnly
				label={t(
					collapsed
						? 'routes.storyEdit.workspace.expandDock'
						: 'routes.storyEdit.workspace.collapseDock',
					{dock: label}
				)}
				onClick={() => onChangeCollapsed(!collapsed)}
			/>
		</header>
	);
};

const PassageNavigator: React.FC<{
	index: CoreStoryIndex;
	onSelectPassage: (passage: Passage) => void;
	selectedPassageId?: string;
	story: Story;
}> = props => {
	const {index, onSelectPassage, selectedPassageId, story} = props;
	const {t} = useTranslation();
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
		<ol className="story-edit-passage-list">
			{story.passages.map(passage => (
				<li key={passage.id}>
					<button
						aria-current={passage.id === selectedPassageId ? 'true' : undefined}
						className={classNames('story-edit-passage-list-item', {
							selected: passage.id === selectedPassageId
						})}
						onClick={() => onSelectPassage(passage)}
						type="button"
					>
						<TagGrid tags={passage.tags} tagColors={story.tagColors} />
						<span className="story-edit-passage-list-name">
							<VisibleWhitespace value={passage.name} />
						</span>
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
				</li>
			))}
		</ol>
	);
};

const NavigatorTabs: React.FC<{
	activeTab: NavigatorTab;
	onChange: (tab: NavigatorTab) => void;
}> = ({activeTab, onChange}) => {
	const {t} = useTranslation();
	const tabs: {label: string; value: NavigatorTab}[] = [
		{label: t('routes.storyEdit.workspace.passages'), value: 'passages'},
		{label: t('routes.storyEdit.workspace.contents'), value: 'contents'}
	];

	return (
		<div className="story-edit-navigator-tabs" role="tablist">
			{tabs.map(tab => (
				<button
					aria-selected={activeTab === tab.value}
					key={tab.value}
					onClick={() => onChange(tab.value)}
					role="tab"
					type="button"
				>
					{tab.label}
				</button>
			))}
		</div>
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
							<span
								className={`cn__ricon story-edit-contents-kind ${entry.core.kind}`}
							>
								{entry.core.kind}
							</span>
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

const Inspector: React.FC<{
	assets: AssetManagerViewModel;
	diagnostics: DiagnosticsViewModel;
	host: CoreProjectHost;
	index: CoreStoryIndex;
	onSelectPassage: (passage: Passage) => void;
	selection: WorkbenchSelection;
	story: Story;
}> = props => {
	const {assets, diagnostics, host, index, onSelectPassage, selection, story} =
		props;
	const {passage} = selection;
	const {t} = useTranslation();
	const symbolsByName = React.useMemo(() => {
		const result = new Map<string, number>();

		for (const symbol of index.symbols) {
			result.set(symbol.name, (result.get(symbol.name) ?? 0) + 1);
		}

		return Array.from(result).slice(0, 8);
	}, [index.symbols]);

	return (
		<div className="story-edit-inspector">
			<section>
				<h3>{t('common.story')}</h3>
				<dl>
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
				</dl>
			</section>
			{passage && (
				<section>
					<h3>{t('common.passage')}</h3>
					<dl>
						<dt>{t('routes.storyEdit.workspace.words')}</dt>
						<dd>{selection.wordCount}</dd>
						<dt>{t('routes.storyEdit.workspace.links')}</dt>
						<dd>{selection.links.length}</dd>
						<dt>{t('common.tags')}</dt>
						<dd>{passage.tags.length || t('colors.none')}</dd>
					</dl>
				</section>
			)}
			{index.tagEntries.length > 0 && (
				<section>
					<h3>{t('common.tags')}</h3>
					<ul className="story-edit-index-list">
						{index.tagEntries.slice(0, 8).map(tag => (
							<li key={tag.name}>
								<span
									className="story-edit-tag-swatch"
									style={{backgroundColor: tag.color ?? 'transparent'}}
								/>
								<span>{tag.name}</span>
								<strong>{tag.count}</strong>
							</li>
						))}
					</ul>
				</section>
			)}
			{symbolsByName.length > 0 && (
				<section>
					<h3>{t('routes.storyEdit.workspace.variables')}</h3>
					<ul className="story-edit-index-list">
						{symbolsByName.map(([name, count]) => (
							<li key={name}>
								<span>{name}</span>
								<strong>{count}</strong>
							</li>
						))}
					</ul>
				</section>
			)}
			{assets.entries.length > 0 && (
				<section>
					<h3>{t('routes.storyEdit.workspace.assets')}</h3>
					<ul className="story-edit-index-list">
						{assets.entries.slice(0, 8).map(asset => (
							<li key={asset.id}>
								<span>{asset.path}</span>
								<strong>{asset.referenceCount}</strong>
							</li>
						))}
					</ul>
				</section>
			)}
			{diagnostics.items.length > 0 && (
				<section>
					<h3>{t('routes.storyEdit.workspace.diagnostics')}</h3>
					<div className="story-edit-diagnostic-list dg">
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
										'dg__row',
										'story-edit-diagnostic',
										item.severity,
										{
											'is-on': selection.sourceId === item.core.sourceId
										}
									)}
									key={item.id}
								>
									<span
										className={`dg__sev ${
											item.severity === 'error'
												? 'err'
												: item.severity === 'warning'
													? 'warn'
													: 'info'
										}`}
									>
										!
									</span>
									<div className="dg__rtext">
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
										<div className="dg__rloc">{item.location}</div>
									</div>
									{actions.length > 0 && (
										<div className="story-edit-diagnostic-fixes">
											{actions.map(action => (
												<button
													disabled={!action.enabled}
													key={action.command}
													onClick={action.apply}
													type="button"
												>
													{action.title}
												</button>
											))}
										</div>
									)}
								</div>
							);
						})}
					</div>
				</section>
			)}
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
	const {links} = selection;

	if (!open) {
		return null;
	}

	return (
		<section
			aria-label={t('routes.storyEdit.workspace.bottomDrawer')}
			className="story-edit-bottom-drawer"
		>
			<header>
				<h2>{t('routes.storyEdit.workspace.bottomDrawer')}</h2>
				<IconButton
					icon={<IconChevronDown />}
					iconOnly
					label={t('routes.storyEdit.workspace.closeBottomDrawer')}
					onClick={() => onChangeOpen(false)}
				/>
			</header>
			<div className="story-edit-bottom-drawer-content">
				{links.length > 0 ? (
					<ul>
						{links.map(link => {
							const linkedPassage = story.passages.find(
								passage => passage.name === link
							);

							return (
								<li key={link}>
									{linkedPassage ? (
										<button
											className="story-edit-link-chip"
											onClick={() => onSelectPassage(linkedPassage)}
											type="button"
										>
											{link}
										</button>
									) : (
										<span className="story-edit-link-chip missing">{link}</span>
									)}
								</li>
							);
						})}
					</ul>
				) : (
					<p>{t('routes.storyEdit.workspace.noLinks')}</p>
				)}
			</div>
		</section>
	);
};

export const StoryWorkspaceShell: React.FC<
	StoryWorkspaceShellProps
> = props => {
	const {
		bottomDrawerOpen,
		graphPanel,
		leftDockCollapsed,
		mode,
		onChangeBottomDrawerOpen,
		onChangeLeftDockCollapsed,
		onChangeRightDockCollapsed,
		onSelectPassage,
		rightDockCollapsed,
		selectedPassageId,
		story
	} = props;
	const coreProjectHost = useCoreProjectHost();
	const index = React.useMemo(
		() => coreProjectHost.queryStoryIndex(story.id),
		[coreProjectHost, story]
	);
	const contents = React.useMemo(() => contentsViewModel(index), [index]);
	const diagnostics = React.useMemo(
		() => diagnosticsViewModel(index, story),
		[index, story]
	);
	const assets = React.useMemo(() => assetManagerViewModel(index), [index]);
	const selection = React.useMemo(
		() => workbenchSelection(story, index, selectedPassageId),
		[index, selectedPassageId, story]
	);
	const passage = selection.passage;
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
			<aside
				aria-label={t('routes.storyEdit.workspace.leftDock')}
				className="story-edit-dock story-edit-left-dock"
			>
				<DockHeader
					collapsed={leftDockCollapsed}
					label={t('routes.storyEdit.workspace.leftDock')}
					onChangeCollapsed={onChangeLeftDockCollapsed}
					side="left"
				>
					{navigatorTab === 'contents'
						? t('routes.storyEdit.workspace.contents')
						: t('routes.storyEdit.workspace.passages')}
				</DockHeader>
				{!leftDockCollapsed && (
					<>
						<NavigatorTabs
							activeTab={navigatorTab}
							onChange={setNavigatorTab}
						/>
						{navigatorTab === 'passages' ? (
							<PassageNavigator
								index={index}
								onSelectPassage={onSelectPassage}
								selectedPassageId={passage?.id}
								story={story}
							/>
						) : (
							<ContentsNavigator
								contents={contents}
								onOpenSource={handleOpenContentsSource}
								onSelectPassage={onSelectPassage}
								story={story}
							/>
						)}
					</>
				)}
			</aside>
			{showGraph && graphPanel}
			{showText && (
				<div className="story-edit-text-layer">
					<StoryTextPanel
						onSelectPassage={onSelectPassage}
						selectedPassageId={passage?.id}
						story={story}
					/>
				</div>
			)}
			<aside
				aria-label={t('routes.storyEdit.workspace.rightDock')}
				className="story-edit-dock story-edit-right-dock"
			>
				<DockHeader
					collapsed={rightDockCollapsed}
					label={t('routes.storyEdit.workspace.rightDock')}
					onChangeCollapsed={onChangeRightDockCollapsed}
					side="right"
				>
					{t('routes.storyEdit.workspace.inspector')}
				</DockHeader>
				{!rightDockCollapsed && (
					<Inspector
						assets={assets}
						diagnostics={diagnostics}
						host={coreProjectHost}
						index={index}
						onSelectPassage={onSelectPassage}
						selection={selection}
						story={story}
					/>
				)}
			</aside>
			<BottomDrawer
				onChangeOpen={onChangeBottomDrawerOpen}
				onSelectPassage={onSelectPassage}
				open={bottomDrawerOpen}
				selection={selection}
				story={story}
			/>
		</div>
	);
};
