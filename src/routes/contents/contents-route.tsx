import * as React from 'react';
import classNames from 'classnames';
import {useHistory, useParams} from 'react-router-dom';
import {
	Badge,
	Button,
	Input,
	Select,
	TablerIcon,
	Tag
} from '../../components/design-system';
import {
	contentsViewModel,
	replaceKnownAssetInventoryForStory,
	setStartPassageCommand,
	storyShellIndex,
	useKnownAssetInventoryForStory,
	useCoreProjectHost,
	workbenchSelection
} from '../../core';
import type {ContentsViewModelEntry} from '../../core/view-models';
import type {CoreContentsEntryKind} from '../../core/bindings/CoreContentsEntryKind';
import {fileUrlForPath} from '../../core/asset-paths';
import type {TwineElectronWindow} from '../../electron/shared';
import {
	Passage,
	selectPassage,
	Story,
	useStoriesContext
} from '../../store/stories';
import {
	defaultProjectFolderRoot,
	loadProjectMetadata,
	saveProjectMetadata
} from '../../store/project-metadata';
import {useProjectStoryHydration} from '../../store/project-hydration';
import {useStoryLaunch} from '../../store/use-story-launch';
import {
	markPerformanceAfterPaint,
	scheduleIdleWork
} from '../../util/performance';
import './contents-route.css';

type ContentsFilter =
	| 'all'
	| 'asset'
	| 'diagnostics'
	| 'entryPoint'
	| 'group'
	| 'metadata'
	| 'passage'
	| 'problems'
	| 'script'
	| 'stylesheet'
	| 'tag'
	| 'variable';

type ContentsSort = 'Group' | 'Issues' | 'Name';
type ContentsRenderItem =
	| {entry: ContentsViewModelEntry; id: string; kind: 'entry'}
	| {group: string; id: string; kind: 'group'};

const virtualGroupHeight = 34;
const virtualRowHeight = 47;
const virtualOverscan = 8;
const deferIndexPassageThreshold = 500;
const virtualFallbackHeight = 800;

const typeFilters: Array<{
	id: ContentsFilter;
	icon: string;
	label: string;
}> = [
	{id: 'all', icon: 'list-tree', label: 'All'},
	{id: 'passage', icon: 'file-text', label: 'Passages'},
	{id: 'tag', icon: 'tags', label: 'Tags'},
	{id: 'variable', icon: 'variable', label: 'Variables'},
	{id: 'asset', icon: 'photo', label: 'Assets'},
	{id: 'script', icon: 'braces', label: 'Scripts'},
	{id: 'stylesheet', icon: 'hash', label: 'Styles'},
	{id: 'group', icon: 'folders', label: 'Groups'},
	{id: 'diagnostics', icon: 'alert-triangle', label: 'Diagnostics'},
	{id: 'metadata', icon: 'info-circle', label: 'Metadata'}
];

const problemFilters: Array<{
	id: ContentsFilter;
	icon: string;
	label: string;
}> = [
	{id: 'problems', icon: 'alert-triangle', label: 'All Problems'},
	{id: 'entryPoint', icon: 'rocket', label: 'Entry Points'}
];

function storyForId(stories: Story[], storyId: string | undefined) {
	return stories.find(story => story.id === storyId);
}

function kindIcon(kind: CoreContentsEntryKind) {
	switch (kind) {
		case 'asset':
			return 'photo';
		case 'brokenLink':
			return 'unlink';
		case 'diagnostic':
			return 'alert-triangle';
		case 'entryPoint':
			return 'rocket';
		case 'group':
			return 'folders';
		case 'metadata':
			return 'info-circle';
		case 'orphan':
			return 'arrows-split';
		case 'passage':
			return 'file-text';
		case 'script':
			return 'braces';
		case 'stylesheet':
			return 'hash';
		case 'tag':
			return 'tags';
		case 'variable':
			return 'variable';
	}
}

function kindLabel(kind: CoreContentsEntryKind) {
	switch (kind) {
		case 'brokenLink':
			return 'Broken link';
		case 'entryPoint':
			return 'Entry point';
		default:
			return kind;
	}
}

function assetPreviewUrl(entry: ContentsViewModelEntry, projectRoot?: string) {
	const previewUrl = entry.asset?.thumbnailUrl ?? entry.asset?.previewUrl;

	if (previewUrl) {
		return previewUrl;
	}

	if (
		!projectRoot ||
		entry.asset?.missing ||
		entry.asset?.exists === false ||
		!entry.asset?.path ||
		!/^assets\//i.test(entry.asset.path)
	) {
		return null;
	}

	return fileUrlForPath(
		`${projectRoot.replace(/[\\/]+$/, '')}/${entry.asset.path}`
	);
}

function EntryVisual({
	entry,
	projectRoot
}: {
	entry: ContentsViewModelEntry;
	projectRoot?: string;
}) {
	const previewUrl = assetPreviewUrl(entry, projectRoot);
	const [failed, setFailed] = React.useState(false);

	React.useEffect(() => setFailed(false), [entry.id, previewUrl]);

	if (
		entry.core.kind === 'asset' &&
		previewUrl &&
		entry.asset?.kind === 'image' &&
		!failed
	) {
		return (
			<span className="contents-route__row-thumb">
				<img
					alt=""
					loading="lazy"
					onError={() => setFailed(true)}
					src={previewUrl}
				/>
			</span>
		);
	}

	return (
		<TablerIcon
			className="contents-route__row-icon"
			icon={kindIcon(entry.core.kind)}
		/>
	);
}

function AssetPreview({
	entry,
	projectRoot
}: {
	entry: ContentsViewModelEntry;
	projectRoot?: string;
}) {
	const previewUrl = assetPreviewUrl(entry, projectRoot);
	const [failed, setFailed] = React.useState(false);

	React.useEffect(() => setFailed(false), [entry.id, previewUrl]);

	if (entry.core.kind !== 'asset') {
		return null;
	}

	if (entry.asset?.missing || failed) {
		return (
			<div className="contents-route__asset-preview contents-route__asset-preview--missing">
				<TablerIcon icon="photo-off" />
			</div>
		);
	}

	if (previewUrl && entry.asset?.kind === 'image') {
		return (
			<div className="contents-route__asset-preview">
				<img
					alt=""
					loading="lazy"
					onError={() => setFailed(true)}
					src={previewUrl}
				/>
			</div>
		);
	}

	if (previewUrl && entry.asset?.kind === 'audio') {
		return (
			<div className="contents-route__asset-preview contents-route__asset-preview--media">
				<TablerIcon icon="music" />
				<audio controls src={previewUrl} />
			</div>
		);
	}

	if (previewUrl && entry.asset?.kind === 'video') {
		return (
			<div className="contents-route__asset-preview">
				<video controls preload="metadata" src={previewUrl} />
			</div>
		);
	}

	return (
		<div className="contents-route__asset-preview contents-route__asset-preview--media">
			<TablerIcon icon={kindIcon(entry.core.kind)} />
			<span>{entry.asset?.kind ?? 'asset'}</span>
		</div>
	);
}

function entryMatchesFilter(
	entry: ContentsViewModelEntry,
	filter: ContentsFilter
) {
	switch (filter) {
		case 'all':
			return true;
		case 'diagnostics':
			return (
				entry.core.kind === 'brokenLink' ||
				entry.core.kind === 'diagnostic' ||
				entry.core.kind === 'orphan'
			);
		case 'problems':
			return !!entry.severity;
		default:
			return entry.core.kind === filter;
	}
}

function entryMatchesQuery(entry: ContentsViewModelEntry, query: string) {
	const normalized = query.trim().toLowerCase();

	if (!normalized) {
		return true;
	}

	return [
		entry.group,
		entry.label,
		entry.meta,
		entry.core.detail,
		entry.core.kind,
		entry.core.sourceId
	]
		.filter(Boolean)
		.some(value => value!.toLowerCase().includes(normalized));
}

function severityTone(severity: ContentsViewModelEntry['severity']) {
	if (severity === 'error') {
		return 'error';
	}

	if (severity === 'warning') {
		return 'warn';
	}

	return 'link';
}

function passageForEntry(story: Story, entry: ContentsViewModelEntry) {
	return entry.core.passageId
		? story.passages.find(passage => passage.id === entry.core.passageId)
		: undefined;
}

function sourceTarget(story: Story, mode: 'graph' | 'text', passage?: Passage) {
	const query = new URLSearchParams({mode});

	if (passage) {
		query.set('passage', passage.id);
	}

	return `/stories/${story.id}?${query.toString()}`;
}

const DetailField: React.FC<{
	label: string;
	value: React.ReactNode;
}> = ({label, value}) => (
	<div className="contents-route__field">
		<span>{label}</span>
		<b>{value}</b>
	</div>
);

export const ContentsRoute: React.FC = () => {
	const {storyId} = useParams<{storyId: string}>();
	const {dispatch, stories} = useStoriesContext();
	const history = useHistory();
	const {testStory} = useStoryLaunch();
	const coreProjectHost = useCoreProjectHost();
	const story = storyForId(stories, storyId);
	const [filter, setFilter] = React.useState<ContentsFilter>('all');
	const [query, setQuery] = React.useState('');
	const [sort, setSort] = React.useState<ContentsSort>('Group');
	const [selectedId, setSelectedId] = React.useState<string>();
	const [patchVersion, setPatchVersion] = React.useState(0);
	const [inferredProjectRoot, setInferredProjectRoot] =
		React.useState<string>();
	const knownAssets = useKnownAssetInventoryForStory(story?.id);
	const hydration = useProjectStoryHydration(story?.id);
	const projectMetadata = React.useMemo(
		() => (story ? loadProjectMetadata(story.id) : undefined),
		[story]
	);
	const projectRoot = projectMetadata?.rootPath ?? inferredProjectRoot;
	const twineElectron = (window as TwineElectronWindow).twineElectron;
	const isFileBackedStory =
		(projectMetadata?.storageKind === 'electron-project-folder' &&
			projectMetadata.status === 'file-backed') ||
		!!inferredProjectRoot;
	const passageTextLoaded =
		!isFileBackedStory || hydration?.passageTextLoaded !== false;
	const shellIndex = React.useMemo(
		() => (story ? storyShellIndex(story, knownAssets) : undefined),
		[knownAssets, story]
	);
	const [fullIndex, setFullIndex] =
		React.useState<typeof shellIndex>(undefined);

	React.useEffect(
		() =>
			coreProjectHost.subscribeToPatches(() =>
				setPatchVersion(version => version + 1)
			),
		[coreProjectHost]
	);

	React.useEffect(() => {
		if (projectMetadata?.rootPath) {
			setInferredProjectRoot(undefined);
			return;
		}

		if (
			!story ||
			!twineElectron?.getStoryLibraryFolder ||
			(!twineElectron.projectSessionSnapshot &&
				!twineElectron.listProjectAssets)
		) {
			setInferredProjectRoot(undefined);
			return;
		}

		let canceled = false;

		async function inferProjectRoot() {
			if (!story || !twineElectron?.getStoryLibraryFolder) {
				return;
			}

			try {
				const storyLibraryFolder = await twineElectron.getStoryLibraryFolder();
				const rootPath = defaultProjectFolderRoot(
					storyLibraryFolder,
					story.name
				);
				const snapshot = twineElectron.projectSessionSnapshot
					? await twineElectron.projectSessionSnapshot(rootPath, [story.id])
					: undefined;
				const inventory =
					snapshot?.assets ??
					(twineElectron.listProjectAssets
						? await twineElectron.listProjectAssets(rootPath)
						: []);

				if (canceled || inventory.length === 0) {
					return;
				}

				saveProjectMetadata(story.id, {
					rootPath,
					status: 'file-backed',
					storageKind: 'electron-project-folder'
				});
				replaceKnownAssetInventoryForStory(story.id, inventory);
				setInferredProjectRoot(rootPath);
			} catch {
				if (!canceled) {
					setInferredProjectRoot(undefined);
				}
			}
		}

		void inferProjectRoot();

		return () => {
			canceled = true;
		};
	}, [projectMetadata?.rootPath, story, twineElectron]);

	React.useEffect(() => {
		let active = true;

		if (!story || !passageTextLoaded) {
			setFullIndex(undefined);
			return () => {
				active = false;
			};
		}

		setFullIndex(undefined);

		if (coreProjectHost.runtimeMode() !== 'wasm-worker') {
			if (story.passages.length <= deferIndexPassageThreshold) {
				setFullIndex(coreProjectHost.queryStoryIndex(story.id));
				return () => {
					active = false;
				};
			}

			const cancelIdleWork = scheduleIdleWork(() => {
				if (active) {
					setFullIndex(coreProjectHost.queryStoryIndex(story.id));
				}
			});

			return () => {
				active = false;
				cancelIdleWork();
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
	const contents = React.useMemo(
		() => (index ? contentsViewModel(index) : undefined),
		[index]
	);
	const filterCounts = React.useMemo(() => {
		const counts = new Map<ContentsFilter, number>();
		const entries = contents?.entries ?? [];

		counts.set('all', entries.length);

		for (const entry of entries) {
			const previous = counts.get(entry.core.kind as ContentsFilter) ?? 0;

			counts.set(entry.core.kind as ContentsFilter, previous + 1);

			if (
				entry.core.kind === 'brokenLink' ||
				entry.core.kind === 'diagnostic' ||
				entry.core.kind === 'orphan'
			) {
				counts.set('diagnostics', (counts.get('diagnostics') ?? 0) + 1);
			}

			if (entry.severity) {
				counts.set('problems', (counts.get('problems') ?? 0) + 1);
			}
		}

		return counts;
	}, [contents]);
	const visibleEntries = React.useMemo(() => {
		const entries = contents?.entries ?? [];
		const filtered = entries.filter(
			entry =>
				entryMatchesFilter(entry, filter) && entryMatchesQuery(entry, query)
		);

		return [...filtered].sort((left, right) => {
			if (sort === 'Issues') {
				const issueDelta = Number(!!right.severity) - Number(!!left.severity);

				if (issueDelta !== 0) {
					return issueDelta;
				}
			}

			if (sort === 'Name') {
				return left.label.localeCompare(right.label);
			}

			return (
				left.group.localeCompare(right.group) ||
				left.label.localeCompare(right.label)
			);
		});
	}, [contents, filter, query, sort]);
	const items = React.useMemo(
		() => renderItems(visibleEntries),
		[visibleEntries]
	);
	const virtualContents = useVirtualContents(items);
	const selectedEntry =
		visibleEntries.find(entry => entry.id === selectedId) ??
		visibleEntries.find(
			entry =>
				entry.core.passageId && entry.core.passageId === story?.startPassage
		) ??
		visibleEntries[0];
	const selectedPassage =
		story && selectedEntry ? passageForEntry(story, selectedEntry) : undefined;
	const selectedFacts =
		story && index && selectedPassage
			? workbenchSelection(story, index, selectedPassage.id)
			: undefined;

	React.useEffect(() => {
		if (selectedEntry && selectedEntry.id !== selectedId) {
			setSelectedId(selectedEntry.id);
		}
	}, [selectedEntry, selectedId]);

	React.useEffect(() => {
		if (contents) {
			markPerformanceAfterPaint('contents-visible');
		}
	}, [contents]);

	function openEntry(
		entry: ContentsViewModelEntry | undefined,
		mode: 'graph' | 'text'
	) {
		if (!story || !entry) {
			return;
		}

		const passage = passageForEntry(story, entry);

		if (passage) {
			dispatch(selectPassage(story, passage, true));
		}

		history.push(sourceTarget(story, mode, passage));
	}

	function markStart() {
		if (story && selectedPassage) {
			coreProjectHost.applyStoryCommand(
				setStartPassageCommand(story.id, selectedPassage.id)
			);
		}
	}

	function testSelectedPassage() {
		if (story && selectedPassage) {
			void testStory(story.id, selectedPassage.id);
		}
	}

	if (!story || !contents || !index) {
		return (
			<div className="contents-route__empty">
				<TablerIcon icon="list-tree" />
				<span>No story is open.</span>
			</div>
		);
	}

	return (
		<div className="contents-route">
			<aside className="contents-route__types" aria-label="Contents filters">
				<div className="contents-route__filter-label">Browse</div>
				{typeFilters.map(candidate => (
					<button
						aria-current={candidate.id === filter}
						className="contents-route__type"
						key={candidate.id}
						onClick={() => setFilter(candidate.id)}
						type="button"
					>
						<TablerIcon icon={candidate.icon} />
						<span>{candidate.label}</span>
						<span className="contents-route__count">
							{filterCounts.get(candidate.id) ?? 0}
						</span>
					</button>
				))}
				<div className="contents-route__filter-label">Problems</div>
				{problemFilters.map(candidate => (
					<button
						aria-current={candidate.id === filter}
						className="contents-route__type contents-route__type--problem"
						key={candidate.id}
						onClick={() => setFilter(candidate.id)}
						type="button"
					>
						<TablerIcon icon={candidate.icon} />
						<span>{candidate.label}</span>
						<span className="contents-route__count">
							{filterCounts.get(candidate.id) ?? 0}
						</span>
					</button>
				))}
			</aside>
			<main className="contents-route__main" aria-label="Contents">
				<div className="contents-route__toolbar">
					<Input
						aria-label="Filter contents"
						block
						icon="search"
						kbd="Cmd P"
						onChange={event => setQuery(event.target.value)}
						placeholder="Filter contents"
						value={query}
					/>
					<Select
						ariaLabel="Sort contents"
						onChange={value => setSort(value as ContentsSort)}
						options={['Group', 'Name', 'Issues']}
						size="sm"
						value={sort}
					/>
					<span className="contents-route__toolbar-stat">
						{visibleEntries.length} of {contents.totalCount}
					</span>
				</div>
				<div className="contents-route__list" ref={virtualContents.listRef}>
					{visibleEntries.length === 0 ? (
						<div className="contents-route__list-empty">
							No contents match this filter.
						</div>
					) : (
						<div
							className="contents-route__virtual-space"
							style={{height: virtualContents.totalHeight}}
						>
							{virtualContents.visibleItems.map((item, index) => {
								const absoluteIndex = virtualContents.visibleStart + index;
								const position = virtualContents.positions[absoluteIndex];

								if (item.kind === 'group') {
									return (
										<div
											className="contents-route__group contents-route__virtual-item"
											key={item.id}
											style={{top: position.top}}
										>
											<TablerIcon icon="folder" />
											{item.group}
										</div>
									);
								}

								const {entry} = item;

								return (
									<button
										aria-current={entry.id === selectedEntry?.id}
										className={classNames(
											'contents-route__row',
											'contents-route__virtual-item',
											{
												'contents-route__row--problem': !!entry.severity
											}
										)}
										key={entry.id}
										onClick={() => setSelectedId(entry.id)}
										style={{top: position.top}}
										type="button"
									>
										<EntryVisual entry={entry} projectRoot={projectRoot} />
										<span className="contents-route__row-name">
											<b>{entry.label}</b>
											<span>{kindLabel(entry.core.kind)}</span>
										</span>
										<span className="contents-route__row-stats">
											{entry.core.count > 1 && (
												<span>{entry.core.count} refs</span>
											)}
											{entry.meta && <span>{entry.meta}</span>}
											{entry.severity && (
												<Badge tone={severityTone(entry.severity)}>
													{entry.severity}
												</Badge>
											)}
										</span>
										<TablerIcon icon="chevron-right" />
									</button>
								);
							})}
						</div>
					)}
				</div>
			</main>
			<aside className="contents-route__inspector" aria-label="Content details">
				{selectedEntry ? (
					<>
						<header className="contents-route__inspector-head">
							<div className="contents-route__inspector-title">
								{selectedEntry.label}
							</div>
							<div className="contents-route__inspector-path">
								{selectedEntry.core.sourceId ?? selectedEntry.core.id}
							</div>
							<div className="contents-route__badges">
								<Badge icon={kindIcon(selectedEntry.core.kind)} mono>
									{kindLabel(selectedEntry.core.kind)}
								</Badge>
								{selectedEntry.severity && (
									<Badge
										icon={
											selectedEntry.severity === 'error'
												? 'alert-octagon'
												: 'alert-triangle'
										}
										tone={severityTone(selectedEntry.severity)}
									>
										{selectedEntry.severity}
									</Badge>
								)}
								{selectedPassage?.id === story.startPassage && (
									<Badge dot tone="saved">
										Start
									</Badge>
								)}
							</div>
						</header>
						<AssetPreview entry={selectedEntry} projectRoot={projectRoot} />
						<section className="contents-route__section">
							<div className="contents-route__section-title">Metadata</div>
							<DetailField label="Group" value={selectedEntry.group} />
							<DetailField
								label="Type"
								value={kindLabel(selectedEntry.core.kind)}
							/>
							<DetailField label="Count" value={selectedEntry.core.count} />
							<DetailField
								label="Detail"
								value={selectedEntry.meta ?? 'None'}
							/>
							<DetailField
								label="Source"
								value={selectedEntry.core.sourceId ?? 'Project index'}
							/>
							{selectedEntry.asset && (
								<>
									<DetailField
										label="Size"
										value={
											selectedEntry.asset.sizeBytes === null
												? 'Unknown'
												: `${selectedEntry.asset.sizeBytes} B`
										}
									/>
									<DetailField
										label="References"
										value={selectedEntry.asset.referenceCount}
									/>
								</>
							)}
						</section>
						{selectedPassage && selectedFacts && (
							<section className="contents-route__section">
								<div className="contents-route__section-title">Passage</div>
								<DetailField label="Words" value={selectedFacts.wordCount} />
								<DetailField
									label="Outgoing links"
									value={selectedFacts.linkFacts.length}
								/>
								<DetailField
									label="Backlinks"
									value={selectedFacts.backlinks.length}
								/>
								<DetailField
									label="Assets"
									value={selectedFacts.assetReferences.length}
								/>
								<DetailField
									label="Diagnostics"
									value={selectedFacts.diagnostics.length}
								/>
								{selectedPassage.tags.length > 0 && (
									<div className="contents-route__tag-row">
										{selectedPassage.tags.map(tag => (
											<Tag color={story.tagColors[tag] ?? 'blue'} key={tag}>
												{tag}
											</Tag>
										))}
									</div>
								)}
							</section>
						)}
						<div className="contents-route__actions">
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
								icon="file-text"
								onClick={() => openEntry(selectedEntry, 'text')}
								size="sm"
							>
								Reveal in Source
							</Button>
							<Button
								block
								disabled={!selectedPassage}
								icon="binary-tree"
								onClick={() => openEntry(selectedEntry, 'graph')}
								size="sm"
							>
								Reveal in Graph
							</Button>
							<Button
								block
								disabled={!selectedPassage}
								icon="rocket"
								onClick={markStart}
								size="sm"
								variant="ghost"
							>
								Mark as Start
							</Button>
						</div>
					</>
				) : (
					<div className="contents-route__empty-detail">
						Select an indexed item.
					</div>
				)}
			</aside>
		</div>
	);
};

function renderItems(entries: ContentsViewModelEntry[]) {
	const items: ContentsRenderItem[] = [];
	let lastGroup: string | undefined;

	for (const entry of entries) {
		if (entry.group !== lastGroup) {
			lastGroup = entry.group;
			items.push({
				group: entry.group,
				id: `group:${items.length}:${entry.group}`,
				kind: 'group'
			});
		}

		items.push({entry, id: entry.id, kind: 'entry'});
	}

	return items;
}

function itemHeight(item: ContentsRenderItem) {
	return item.kind === 'group' ? virtualGroupHeight : virtualRowHeight;
}

function useVirtualContents(items: ContentsRenderItem[]) {
	const listRef = React.useRef<HTMLDivElement>(null);
	const [viewport, setViewport] = React.useState({
		height: virtualFallbackHeight,
		top: 0
	});
	const positions = React.useMemo(() => {
		const result: Array<{height: number; top: number}> = [];
		let top = 0;

		for (const item of items) {
			const height = itemHeight(item);

			result.push({height, top});
			top += height;
		}

		return {items: result, totalHeight: top};
	}, [items]);

	React.useEffect(() => {
		const element = listRef.current;

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

	const visibleRange = React.useMemo(() => {
		const startY = Math.max(
			viewport.top - virtualRowHeight * virtualOverscan,
			0
		);
		const endY =
			viewport.top + viewport.height + virtualRowHeight * virtualOverscan;
		let start = 0;
		let end = items.length;

		for (let index = 0; index < positions.items.length; index++) {
			const position = positions.items[index];

			if (position.top + position.height >= startY) {
				start = index;
				break;
			}
		}

		for (let index = start; index < positions.items.length; index++) {
			if (positions.items[index].top > endY) {
				end = index + 1;
				break;
			}
		}

		return {end, start};
	}, [items.length, positions.items, viewport.height, viewport.top]);

	return {
		listRef,
		positions: positions.items,
		totalHeight: positions.totalHeight,
		visibleItems: items.slice(visibleRange.start, visibleRange.end),
		visibleStart: visibleRange.start
	};
}
