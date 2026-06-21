import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
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
	deleteAssetCommand,
	diagnosticsViewModel,
	importAssetCommand,
	insertAssetSnippetCommand,
	renameAssetCommand,
	replaceAssetCommand,
	revealAssetCommand,
	useCoreProjectHost,
	validateAssetReferencesCommand,
	workbenchSelection
} from '../../core';
import type {
	AssetManagerViewModel,
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
import {Passage, Story} from '../../store/stories';
import {parseLinks} from '../../util/parse-links';
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

type NavigatorTab = 'passages' | 'contents' | 'assets';

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
						<span className="story-edit-passage-file-icon">
							<TablerIcon
								icon={story.startPassage === passage.id ? 'rocket' : 'file-text'}
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
	selection: WorkbenchSelection;
	story: Story;
}> = ({assets, host, onSelectPassage, selection, story}) => {
	const selectedPassage = selection.passage;

	function importAsset() {
		const sourcePath = window.prompt('Import asset path');

		if (sourcePath) {
			host.applyStoryCommand(importAssetCommand(story.id, sourcePath));
		}
	}

	function renameAsset(path: string) {
		const nextPath = window.prompt('Rename asset', path);

		if (nextPath && nextPath !== path) {
			host.applyStoryCommand(renameAssetCommand(story.id, path, nextPath));
		}
	}

	function replaceAsset(path: string) {
		const sourcePath = window.prompt('Replacement file path');

		if (sourcePath) {
			host.applyStoryCommand(replaceAssetCommand(story.id, path, sourcePath));
		}
	}

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

	return (
		<div className="story-edit-asset-manager">
			<div className="story-edit-asset-toolbar">
				<button onClick={importAsset} type="button">
					Import Asset
				</button>
				<button
					onClick={() =>
						host.applyStoryCommand(validateAssetReferencesCommand(story.id))
					}
					type="button"
				>
					Validate
				</button>
				<span>{assets.entries.length} files</span>
				<span>{assets.referenceCount} references</span>
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
									<button
										onClick={() =>
											host.applyStoryCommand(
												copyAssetSnippetCommand(
													story.id,
													asset.path,
													asset.snippet.text
												)
											)
										}
										type="button"
									>
										Copy Snippet
									</button>
									<button
										disabled={!selectedPassage}
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
										type="button"
									>
										Insert
									</button>
									<button
										onClick={() => revealFirstUsage(asset.path)}
										type="button"
									>
										Usages
									</button>
									<button onClick={() => renameAsset(asset.path)} type="button">
										Rename
									</button>
									<button
										onClick={() => replaceAsset(asset.path)}
										type="button"
									>
										Replace
									</button>
									<button
										onClick={() =>
											host.applyStoryCommand(
												deleteAssetCommand(story.id, asset.path, true)
											)
										}
										type="button"
									>
										Delete
									</button>
									<button
										onClick={() =>
											host.applyStoryCommand(
												revealAssetCommand(story.id, asset.path)
											)
										}
										type="button"
									>
										Reveal
									</button>
								</div>
							</li>
						);
					})}
				</ol>
			)}
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

function backlinksForPassage(story: Story, selectedPassage?: Passage) {
	if (!selectedPassage) {
		return [];
	}

	return story.passages.filter(
		passage =>
			passage.id !== selectedPassage.id &&
			parseLinks(passage.text, true).includes(selectedPassage.name)
	);
}

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
	const backlinks = React.useMemo(
		() => backlinksForPassage(story, passage),
		[passage, story]
	);
	const symbolsByName = React.useMemo(() => {
		const result = new Map<string, number>();

		for (const symbol of index.symbols) {
			result.set(symbol.name, (result.get(symbol.name) ?? 0) + 1);
		}

		return Array.from(result).slice(0, 8);
	}, [index.symbols]);

	return (
		<div className="story-edit-inspector">
			<OutlineSection
				count={selection.links.length}
				icon="arrow-up-right"
				title={t('routes.storyEdit.workspace.links')}
			>
				{selection.links.length > 0 ? (
					selection.links.map(link => {
						const linkedPassage = story.passages.find(
							passage => passage.name === link
						);

						return (
							<OutlineItem
								broken={!linkedPassage}
								color={
									linkedPassage ? 'var(--sem-link)' : 'var(--sem-error)'
								}
								key={link}
								label={link}
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
					backlinks.slice(0, 8).map(backlink => (
						<OutlineItem
							color="var(--tx-4)"
							key={backlink.id}
							label={backlink.name}
							onClick={() => onSelectPassage(backlink)}
							sub={t('common.passage')}
						/>
					))
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
									{actions.length > 0 && (
										<div className="story-edit-diagnostic-fixes">
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
	const {links} = selection;

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
			</Panel>
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
	const [patchVersion, setPatchVersion] = React.useState(0);

	React.useEffect(
		() =>
			coreProjectHost.subscribeToPatches(batch => {
				handlePatchSideEffects(batch);
				setPatchVersion(version => version + 1);
			}),
		[coreProjectHost]
	);

	const index = React.useMemo(
		() => coreProjectHost.queryStoryIndex(story.id),
		[coreProjectHost, patchVersion, story]
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
							selection={selection}
							story={story}
						/>
					)}
				</DockPanel>
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
						onSelectPassage={onSelectPassage}
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
		</div>
	);
};
