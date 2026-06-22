import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {
	Badge,
	Button,
	IconButton,
	Input,
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
	diagnosticDismissalsChangedEvent,
	diagnosticIdentity,
	diagnosticsViewModel,
	importAssetCommand,
	insertAssetSnippetCommand,
	loadDismissedDiagnosticIds,
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
	onRevealPassageInGraph: (passage: Passage) => void;
	onSelectPassage: (passage: Passage) => void;
	onTestPassage?: (passage: Passage) => void;
	overlay?: React.ReactNode;
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
	onTestPassage?: (passage: Passage) => void;
	selection: WorkbenchSelection;
	story: Story;
}> = ({assets, host, onSelectPassage, onTestPassage, selection, story}) => {
	const selectedPassage = selection.passage;
	const [importPath, setImportPath] = React.useState('');
	const [assetEdit, setAssetEdit] = React.useState<
		| {
				mode: 'rename' | 'replace';
				path: string;
				value: string;
		  }
		| undefined
	>();

	function importAsset() {
		const sourcePath = importPath.trim();

		if (sourcePath) {
			host.applyStoryCommand(importAssetCommand(story.id, sourcePath));
			setImportPath('');
		}
	}

	function startRenameAsset(path: string) {
		setAssetEdit({mode: 'rename', path, value: path});
	}

	function startReplaceAsset(path: string) {
		setAssetEdit({mode: 'replace', path, value: ''});
	}

	function applyAssetEdit(event: React.FormEvent) {
		event.preventDefault();

		if (!assetEdit) {
			return;
		}

		const value = assetEdit.value.trim();

		if (!value) {
			return;
		}

		if (assetEdit.mode === 'rename' && value !== assetEdit.path) {
			host.applyStoryCommand(
				renameAssetCommand(story.id, assetEdit.path, value)
			);
		}

		if (assetEdit.mode === 'replace') {
			host.applyStoryCommand(
				replaceAssetCommand(story.id, assetEdit.path, value)
			);
		}

		setAssetEdit(undefined);
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
				<Input
					aria-label="Asset path"
					className="story-edit-asset-path-input"
					icon="folder"
					onChange={event => setImportPath(event.target.value)}
					placeholder="Asset path"
					value={importPath}
				/>
				<Button
					disabled={importPath.trim() === ''}
					icon="file-import"
					onClick={importAsset}
					size="sm"
				>
					Import Asset
				</Button>
				<Button
					icon="refresh"
					onClick={() =>
						host.applyStoryCommand(validateAssetReferencesCommand(story.id))
					}
					size="sm"
					variant="ghost"
				>
					Validate
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
									<Button
										icon="edit"
										onClick={() => startRenameAsset(asset.path)}
										size="sm"
										variant="ghost"
									>
										Rename
									</Button>
									<Button
										icon="refresh"
										onClick={() => startReplaceAsset(asset.path)}
										size="sm"
										variant="ghost"
									>
										Replace
									</Button>
									<Button
										icon="trash"
										onClick={() =>
											host.applyStoryCommand(
												deleteAssetCommand(story.id, asset.path, true)
											)
										}
										size="sm"
										variant="danger"
									>
										Delete
									</Button>
									<Button
										icon="folder-open"
										onClick={() =>
											host.applyStoryCommand(
												revealAssetCommand(story.id, asset.path)
											)
										}
										size="sm"
										variant="ghost"
									>
										Reveal
									</Button>
								</div>
								{assetEdit?.path === asset.path && (
									<form
										className="story-edit-asset-edit"
										onSubmit={applyAssetEdit}
									>
										<Input
											autoFocus
											aria-label={
												assetEdit.mode === 'rename'
													? 'New asset path'
													: 'Replacement file path'
											}
											block
											icon={assetEdit.mode === 'rename' ? 'edit' : 'refresh'}
											onChange={event =>
												setAssetEdit(current =>
													current
														? {...current, value: event.target.value}
														: current
												)
											}
											placeholder={
												assetEdit.mode === 'rename'
													? 'New asset path'
													: 'Replacement file path'
											}
											value={assetEdit.value}
										/>
										<Button
											icon="check"
											size="sm"
											type="submit"
											variant="primary"
										>
											Apply
										</Button>
										<Button
											icon="x"
											onClick={() => setAssetEdit(undefined)}
											size="sm"
											variant="ghost"
										>
											Cancel
										</Button>
									</form>
								)}
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

		for (const symbol of index.symbols) {
			result.set(symbol.name, (result.get(symbol.name) ?? 0) + 1);
		}

		return Array.from(result).slice(0, 8);
	}, [index.symbols]);

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
		bottomDrawerOpen,
		graphPanel,
		leftDockCollapsed,
		mode,
		onChangeBottomDrawerOpen,
		onChangeLeftDockCollapsed,
		onChangeRightDockCollapsed,
		onRevealPassageInGraph,
		onSelectPassage,
		onTestPassage,
		overlay,
		rightDockCollapsed,
		selectedPassageId,
		story
	} = props;
	const coreProjectHost = useCoreProjectHost();
	const [patchVersion, setPatchVersion] = React.useState(0);
	const [dismissalsVersion, setDismissalsVersion] = React.useState(0);

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

	const index = React.useMemo(
		() => coreProjectHost.queryStoryIndex(story.id),
		[coreProjectHost, patchVersion, story]
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
					<StoryTextPanel
						index={activeIndex}
							onRevealPassageInGraph={onRevealPassageInGraph}
							onSelectPassage={onSelectPassage}
							onTestPassage={onTestPassage}
							selectedPassageId={passage?.id}
						selection={selection}
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
