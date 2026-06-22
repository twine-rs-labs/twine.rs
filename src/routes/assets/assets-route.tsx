import * as React from 'react';
import classNames from 'classnames';
import {useHistory, useParams} from 'react-router-dom';
import {
	Badge,
	Button,
	IconButton,
	Input,
	Select,
	TablerIcon
} from '../../components/design-system';
import type {TwineElectronWindow} from '../../electron/shared';
import {
	assetManagerViewModel,
	copyAssetSnippetCommand,
	deleteAssetCommand,
	importAssetCommand,
	insertAssetSnippetCommand,
	replaceAssetCommand,
	replaceKnownAssetInventoryForStory,
	renameAssetCommand,
	revealAssetCommand,
	useCoreProjectHost,
	validateAssetReferencesCommand
} from '../../core';
import type {CoreAssetInventoryEntry, PatchBatch} from '../../core';
import type {CoreAssetReference} from '../../core/bindings/CoreAssetReference';
import type {AssetManagerViewModelEntry} from '../../core/view-models';
import {
	Passage,
	selectPassage,
	Story,
	useStoriesContext
} from '../../store/stories';
import {useStoryLaunch} from '../../store/use-story-launch';
import {usePrefsContext} from '../../store/prefs';
import {loadProjectMetadata} from '../../store/project-metadata';
import './assets-route.css';

type AssetSort = 'Name' | 'References' | 'Size' | 'Type';
type AssetView = 'grid' | 'table';
type AssetInventoryState = 'fallback' | 'loading' | 'live' | 'error';

function storyForId(stories: Story[], storyId: string | undefined) {
	return stories.find(story => story.id === storyId);
}

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

function bytesLabel(bytes: number | null) {
	if (bytes === null) {
		return 'Unknown';
	}

	if (bytes < 1024) {
		return `${bytes} B`;
	}

	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}

	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function modifiedLabel(value: string | null) {
	if (!value) {
		return 'Unknown';
	}

	return new Intl.DateTimeFormat(undefined, {
		dateStyle: 'medium',
		timeStyle: 'short'
	}).format(new Date(value));
}

function dimensionLabel(asset: AssetManagerViewModelEntry) {
	if (asset.width && asset.height) {
		return `${asset.width}x${asset.height}`;
	}

	return asset.inventory.durationMs
		? `${asset.inventory.durationMs} ms`
		: 'n/a';
}

function assetIcon(asset: AssetManagerViewModelEntry) {
	if (asset.missing) {
		return 'photo-off';
	}

	if (asset.kind === 'audio') {
		return 'music';
	}

	if (asset.kind === 'video') {
		return 'movie';
	}

	if (asset.kind === 'image') {
		return 'photo';
	}

	return 'file';
}

function folderForPath(path: string) {
	const parts = path.split('/').filter(Boolean);

	return parts.length > 1 ? parts.slice(0, -1).join('/') : 'assets';
}

function folderEntries(assets: AssetManagerViewModelEntry[]) {
	const counts = new Map<string, number>();

	for (const asset of assets) {
		const folder = folderForPath(asset.path);

		counts.set(folder, (counts.get(folder) ?? 0) + 1);
	}

	return Array.from(counts.entries()).sort(([left], [right]) =>
		left.localeCompare(right)
	);
}

function matchesFolder(asset: AssetManagerViewModelEntry, folder: string) {
	if (folder === 'All Assets') {
		return true;
	}

	if (folder === 'Missing') {
		return asset.missing;
	}

	if (folder === 'Unused') {
		return asset.unused;
	}

	return folderForPath(asset.path) === folder;
}

function matchesQuery(asset: AssetManagerViewModelEntry, query: string) {
	const normalized = query.trim().toLowerCase();

	if (!normalized) {
		return true;
	}

	return [
		asset.path,
		asset.kind,
		asset.snippet.text,
		asset.sourceNames.join(' ')
	].some(value => value.toLowerCase().includes(normalized));
}

function firstUsagePassage(story: Story, asset: AssetManagerViewModelEntry) {
	return asset.firstReference?.passageId
		? story.passages.find(
				passage => passage.id === asset.firstReference?.passageId
			)
		: undefined;
}

function passageForAssetReference(story: Story, reference: CoreAssetReference) {
	return reference.passageId
		? story.passages.find(passage => passage.id === reference.passageId)
		: undefined;
}

function sourceTarget(story: Story, passage?: Passage) {
	const query = new URLSearchParams({mode: 'text'});

	if (passage) {
		query.set('passage', passage.id);
	}

	return `/stories/${story.id}?${query.toString()}`;
}

function assetSourceLabel(asset: AssetManagerViewModelEntry) {
	if (asset.exists === true) {
		return asset.referenceCount > 0 ? 'File + references' : 'File only';
	}

	if (asset.exists === false) {
		return 'Missing file';
	}

	return 'Reference only';
}

function assetStatusLabel(asset: AssetManagerViewModelEntry) {
	if (asset.missing) {
		return 'Missing';
	}

	if (asset.unused) {
		return 'Unused';
	}

	return 'Referenced';
}

export const AssetsRoute: React.FC = () => {
	const {storyId} = useParams<{storyId: string}>();
	const {dispatch, stories} = useStoriesContext();
	const {prefs} = usePrefsContext();
	const {testStory} = useStoryLaunch();
	const history = useHistory();
	const coreProjectHost = useCoreProjectHost();
	const story = storyForId(stories, storyId);
	const [folder, setFolder] = React.useState('All Assets');
	const [query, setQuery] = React.useState('');
	const [sort, setSort] = React.useState<AssetSort>('Name');
	const [view, setView] = React.useState<AssetView>('grid');
	const [selectedPath, setSelectedPath] = React.useState<string>();
	const [importPath, setImportPath] = React.useState('');
	const [importingAsset, setImportingAsset] = React.useState(false);
	const [assetError, setAssetError] = React.useState<string>();
	const [assetEdit, setAssetEdit] = React.useState<
		| {
				mode: 'rename' | 'replace';
				path: string;
				value: string;
		  }
		| undefined
	>();
	const [projectAssets, setProjectAssets] = React.useState<
		CoreAssetInventoryEntry[]
	>([]);
	const [inventoryState, setInventoryState] =
		React.useState<AssetInventoryState>('fallback');
	const [patchVersion, setPatchVersion] = React.useState(0);
	const projectMetadata = React.useMemo(
		() => (story ? loadProjectMetadata(story.id) : undefined),
		[story]
	);
	const projectRoot = projectMetadata?.rootPath;
	const twineElectron = (window as TwineElectronWindow).twineElectron;

	React.useEffect(
		() =>
			coreProjectHost.subscribeToPatches(batch => {
				handlePatchSideEffects(batch);
				setPatchVersion(version => version + 1);
			}),
		[coreProjectHost]
	);

	const refreshProjectAssets = React.useCallback(async () => {
		if (!projectRoot || !twineElectron?.listProjectAssets) {
			setProjectAssets([]);
			setInventoryState('fallback');
			return;
		}

		setInventoryState('loading');

		try {
			const inventory = await twineElectron.listProjectAssets(projectRoot);

			if (story) {
				replaceKnownAssetInventoryForStory(story.id, inventory);
			}
			setProjectAssets(inventory);
			setInventoryState('live');
			setAssetError(undefined);
		} catch (error) {
			setProjectAssets([]);
			setInventoryState('error');
			setAssetError((error as Error).message);
		}
	}, [projectRoot, story, twineElectron]);

	React.useEffect(() => {
		void refreshProjectAssets();
	}, [refreshProjectAssets]);

	const index = React.useMemo(
		() => (story ? coreProjectHost.queryStoryIndex(story.id) : undefined),
		[coreProjectHost, patchVersion, projectAssets, story]
	);
	const assets = React.useMemo(
		() => (index ? assetManagerViewModel(index) : undefined),
		[index]
	);
	const folderList = React.useMemo(
		() => (assets ? folderEntries(assets.entries) : []),
		[assets]
	);
	const visibleAssets = React.useMemo(() => {
		const entries = assets?.entries ?? [];
		const filtered = entries.filter(
			asset => matchesFolder(asset, folder) && matchesQuery(asset, query)
		);

		return [...filtered].sort((left, right) => {
			switch (sort) {
				case 'References':
					return right.referenceCount - left.referenceCount;
				case 'Size':
					return (right.sizeBytes ?? -1) - (left.sizeBytes ?? -1);
				case 'Type':
					return (
						left.kind.localeCompare(right.kind) ||
						left.path.localeCompare(right.path)
					);
				default:
					return left.path.localeCompare(right.path);
			}
		});
	}, [assets, folder, query, sort]);
	const selectedAsset =
		visibleAssets.find(asset => asset.path === selectedPath) ??
		visibleAssets[0];
	const firstUsage =
		story && selectedAsset
			? firstUsagePassage(story, selectedAsset)
			: undefined;

	React.useEffect(() => {
		if (selectedAsset && selectedAsset.path !== selectedPath) {
			setSelectedPath(selectedAsset.path);
		}
	}, [selectedAsset, selectedPath]);

	async function importAsset() {
		if (!story) {
			return;
		}

		const sourcePath = importPath.trim();

		if (sourcePath) {
			setAssetError(undefined);
			setImportingAsset(true);

			try {
				const copied =
					projectRoot && twineElectron?.copyAssetToProject
						? await twineElectron.copyAssetToProject(projectRoot, sourcePath)
						: undefined;

				coreProjectHost.applyStoryCommand(
					importAssetCommand(story.id, copied?.sourcePath ?? sourcePath, {
						targetPath: copied?.targetPath
					})
				);
				setImportPath('');
				await refreshProjectAssets();
			} catch (error) {
				setAssetError((error as Error).message);
			} finally {
				setImportingAsset(false);
			}
		}
	}

	async function chooseAsset() {
		if (!story) {
			return;
		}

		const twineElectron = (window as TwineElectronWindow).twineElectron;

		if (!twineElectron?.chooseAssetFile) {
			importAsset();
			return;
		}

		setAssetError(undefined);
		setImportingAsset(true);

		try {
			const sourcePath = await twineElectron.chooseAssetFile(
				prefs.defaultAssetFolder || importPath || undefined
			);

			if (sourcePath) {
				const copied =
					projectMetadata?.rootPath && twineElectron.copyAssetToProject
						? await twineElectron.copyAssetToProject(
								projectMetadata.rootPath,
								sourcePath
							)
						: undefined;

				coreProjectHost.applyStoryCommand(
					importAssetCommand(story.id, copied?.sourcePath ?? sourcePath, {
						targetPath: copied?.targetPath
					})
				);
				setImportPath('');
				await refreshProjectAssets();
			}
		} catch (error) {
			setAssetError((error as Error).message);
		} finally {
			setImportingAsset(false);
		}
	}

	function copySnippet(asset: AssetManagerViewModelEntry) {
		if (!story) {
			return;
		}

		coreProjectHost.applyStoryCommand(
			copyAssetSnippetCommand(story.id, asset.path, asset.snippet.text)
		);
	}

	function insertSnippet(asset: AssetManagerViewModelEntry) {
		if (!story) {
			return;
		}

		const target = firstUsagePassage(story, asset) ?? story.passages[0];

		if (!target) {
			return;
		}

		coreProjectHost.applyStoryCommand(
			insertAssetSnippetCommand(
				story.id,
				asset.path,
				target.id,
				target.text.length,
				{
					passageId: target.id,
					snippet: asset.snippet.text
				}
			)
		);
		dispatch(selectPassage(story, target, true));
	}

	function revealUsage(asset: AssetManagerViewModelEntry) {
		if (!story) {
			return;
		}

		const target = firstUsagePassage(story, asset);

		if (target) {
			dispatch(selectPassage(story, target, true));
		}

		history.push(sourceTarget(story, target));
	}

	function revealReference(reference: CoreAssetReference) {
		if (!story) {
			return;
		}

		const target = passageForAssetReference(story, reference);

		if (target) {
			dispatch(selectPassage(story, target, true));
		}

		history.push(sourceTarget(story, target));
	}

	function testFirstUsage(asset: AssetManagerViewModelEntry) {
		if (!story) {
			return;
		}

		const target = firstUsagePassage(story, asset);

		if (target) {
			void testStory(story.id, target.id);
		}
	}

	async function applyAssetEdit(event: React.FormEvent) {
		event.preventDefault();

		if (!story || !assetEdit) {
			return;
		}

		const value = assetEdit.value.trim();

		if (!value) {
			return;
		}

		setAssetError(undefined);

		try {
			if (assetEdit.mode === 'rename' && value !== assetEdit.path) {
				const renamed =
					projectRoot && twineElectron?.renameProjectAsset
						? await twineElectron.renameProjectAsset(
								projectRoot,
								assetEdit.path,
								value
							)
						: undefined;

				coreProjectHost.applyStoryCommand(
					renameAssetCommand(
						story.id,
						assetEdit.path,
						renamed?.targetPath ?? value
					)
				);
				setSelectedPath(renamed?.targetPath ?? value);
			}

			if (assetEdit.mode === 'replace') {
				const replaced =
					projectRoot && twineElectron?.replaceProjectAsset
						? await twineElectron.replaceProjectAsset(
								projectRoot,
								assetEdit.path,
								value
							)
						: undefined;

				coreProjectHost.applyStoryCommand(
					replaceAssetCommand(
						story.id,
						assetEdit.path,
						replaced?.sourcePath ?? value
					)
				);
			}

			setAssetEdit(undefined);
			await refreshProjectAssets();
		} catch (error) {
			setAssetError((error as Error).message);
		}
	}

	async function deleteAsset(asset: AssetManagerViewModelEntry) {
		if (!story) {
			return;
		}

		setAssetError(undefined);

		try {
			if (projectRoot && twineElectron?.deleteProjectAsset) {
				await twineElectron.deleteProjectAsset(projectRoot, asset.path);
			}

			coreProjectHost.applyStoryCommand(
				deleteAssetCommand(story.id, asset.path, true)
			);
			setSelectedPath(undefined);
			await refreshProjectAssets();
		} catch (error) {
			setAssetError((error as Error).message);
		}
	}

	async function validateReferences() {
		if (!story) {
			return;
		}

		await refreshProjectAssets();
		coreProjectHost.applyStoryCommand(validateAssetReferencesCommand(story.id));
	}

	function revealAsset(asset: AssetManagerViewModelEntry) {
		if (!story) {
			return;
		}

		if (projectRoot && twineElectron?.revealPath) {
			twineElectron.revealPath(
				`${projectRoot.replace(/[\\/]+$/, '')}/${asset.path}`
			);
			return;
		}

		coreProjectHost.applyStoryCommand(revealAssetCommand(story.id, asset.path));
	}

	if (!story || !assets) {
		return (
			<div className="assets-route__empty">
				<TablerIcon icon="photo" />
				<span>No story is open.</span>
			</div>
		);
	}

	return (
		<div className="assets-route">
			<aside className="assets-route__folders" aria-label="Asset folders">
				<div className="assets-route__filter-label">Folders</div>
				<button
					aria-current={folder === 'All Assets'}
					className="assets-route__folder"
					onClick={() => setFolder('All Assets')}
					type="button"
				>
					<TablerIcon icon="folder-open" />
					<span>All Assets</span>
					<span className="assets-route__count">{assets.entries.length}</span>
				</button>
				{folderList.map(([candidate, count]) => (
					<button
						aria-current={folder === candidate}
						className="assets-route__folder assets-route__folder--nested"
						key={candidate}
						onClick={() => setFolder(candidate)}
						type="button"
					>
						<TablerIcon icon="folder" />
						<span>{candidate}</span>
						<span className="assets-route__count">{count}</span>
					</button>
				))}
				<div className="assets-route__filter-label">Issues</div>
				<button
					aria-current={folder === 'Missing'}
					className="assets-route__folder assets-route__folder--issue"
					onClick={() => setFolder('Missing')}
					type="button"
				>
					<TablerIcon icon="photo-off" />
					<span>Missing</span>
					<span className="assets-route__count">
						{assets.entries.filter(asset => asset.missing).length}
					</span>
				</button>
				<button
					aria-current={folder === 'Unused'}
					className="assets-route__folder assets-route__folder--issue"
					onClick={() => setFolder('Unused')}
					type="button"
				>
					<TablerIcon icon="circle-off" />
					<span>Unused</span>
					<span className="assets-route__count">
						{assets.entries.filter(asset => asset.unused).length}
					</span>
				</button>
			</aside>
			<main className="assets-route__main" aria-label="Assets">
				<div className="assets-route__topbar">
					<Input
						aria-label="Asset path"
						icon="folder"
						onChange={event => setImportPath(event.target.value)}
						placeholder="Path to import"
						value={importPath}
					/>
					<Button
						disabled={importPath.trim() === ''}
						icon="upload"
						loading={importingAsset}
						onClick={importAsset}
						size="sm"
						variant="primary"
					>
						Import Asset
					</Button>
					<Button
						icon="folder-open"
						loading={importingAsset}
						onClick={chooseAsset}
						size="sm"
					>
						Choose Asset
					</Button>
					<Button
						icon="search-off"
						onClick={() => setFolder('Unused')}
						size="sm"
						variant="ghost"
					>
						Find Unused
					</Button>
					<div className="assets-route__inventory-status">
						<Badge
							dot
							tone={
								inventoryState === 'live'
									? 'saved'
									: inventoryState === 'error'
										? 'error'
										: inventoryState === 'loading'
											? 'neutral'
											: 'warn'
							}
						>
							{inventoryState === 'live'
								? 'Live folder'
								: inventoryState === 'loading'
									? 'Scanning'
									: inventoryState === 'error'
										? 'Scan failed'
										: 'Reference fallback'}
						</Badge>
						<span>{projectAssets.length} files</span>
						<span>{assets.referenceCount} refs</span>
					</div>
				</div>
				{assetError && (
					<div className="assets-route__error">
						<TablerIcon icon="alert-octagon" />
						<span>{assetError}</span>
					</div>
				)}
				<div className="assets-route__toolbar">
					<Input
						aria-label="Search assets"
						block
						icon="search"
						onChange={event => setQuery(event.target.value)}
						placeholder="Search assets"
						value={query}
					/>
					<Select
						ariaLabel="Sort assets"
						onChange={value => setSort(value as AssetSort)}
						options={['Name', 'Type', 'Size', 'References']}
						size="sm"
						value={sort}
					/>
					<IconButton
						active={view === 'grid'}
						icon="layout-grid"
						label="Grid view"
						onClick={() => setView('grid')}
						size="sm"
						solid
					/>
					<IconButton
						active={view === 'table'}
						icon="list"
						label="Table view"
						onClick={() => setView('table')}
						size="sm"
						solid
					/>
				</div>
				<div
					className={classNames('assets-route__items', {
						'assets-route__items--table': view === 'table'
					})}
				>
					{visibleAssets.length === 0 ? (
						<div className="assets-route__list-empty">
							No assets match this filter.
						</div>
					) : (
						visibleAssets.map(asset => (
							<button
								aria-current={asset.path === selectedAsset?.path}
								className={classNames('assets-route__card', {
									'assets-route__card--missing': asset.missing,
									'assets-route__card--unused': asset.unused
								})}
								key={asset.path}
								onClick={() => setSelectedPath(asset.path)}
								type="button"
							>
								<span className="assets-route__thumb">
									{asset.thumbnailUrl ? (
										<img alt="" src={asset.thumbnailUrl} />
									) : (
										<TablerIcon icon={assetIcon(asset)} />
									)}
								</span>
								<span className="assets-route__card-caption">
									<b>{asset.path}</b>
									<span>
										{asset.kind} · {bytesLabel(asset.sizeBytes)}
									</span>
								</span>
								<span className="assets-route__card-meta">
									<span>{assetStatusLabel(asset)}</span>
									<span>{asset.referenceCount} refs</span>
								</span>
							</button>
						))
					)}
				</div>
			</main>
			<aside className="assets-route__preview" aria-label="Asset preview">
				{selectedAsset ? (
					<>
						<div
							className={classNames('assets-route__preview-media', {
								'assets-route__preview-media--missing': selectedAsset.missing
							})}
						>
							{selectedAsset.thumbnailUrl ? (
								<img alt="" src={selectedAsset.thumbnailUrl} />
							) : (
								<TablerIcon icon={assetIcon(selectedAsset)} />
							)}
						</div>
						<div className="assets-route__preview-body">
							<div className="assets-route__preview-name">
								{selectedAsset.path}
							</div>
							<div className="assets-route__preview-path">
								{selectedAsset.inventory.normalizedPath}
							</div>
							<div className="assets-route__badges">
								{selectedAsset.missing && (
									<Badge icon="photo-off" tone="error">
										File not found
									</Badge>
								)}
								{selectedAsset.unused && !selectedAsset.missing && (
									<Badge icon="circle-off" tone="warn">
										Unused
									</Badge>
								)}
								<Badge
									dot
									tone={
										selectedAsset.exists === true
											? 'saved'
											: selectedAsset.exists === false
												? 'error'
												: 'warn'
									}
								>
									{assetSourceLabel(selectedAsset)}
								</Badge>
								<Badge dot tone={selectedAsset.publish.copy ? 'saved' : 'warn'}>
									{selectedAsset.publish.copy ? 'Publish' : 'Do not publish'}
								</Badge>
							</div>
							<div className="assets-route__section-title">Details</div>
							<div className="assets-route__field">
								<span>Type</span>
								<b>{selectedAsset.kind}</b>
							</div>
							<div className="assets-route__field">
								<span>Dimensions</span>
								<b>{dimensionLabel(selectedAsset)}</b>
							</div>
							<div className="assets-route__field">
								<span>Size</span>
								<b>{bytesLabel(selectedAsset.sizeBytes)}</b>
							</div>
							<div className="assets-route__field">
								<span>Modified</span>
								<b>{modifiedLabel(selectedAsset.inventory.modifiedAt)}</b>
							</div>
							<div className="assets-route__field">
								<span>References</span>
								<b>{selectedAsset.referenceCount}</b>
							</div>
							<div className="assets-route__field">
								<span>Publish Rule</span>
								<b>{selectedAsset.publish.reason}</b>
							</div>
							<div className="assets-route__section-title">Insert Snippet</div>
							<div className="assets-route__snippet">
								{selectedAsset.snippet.text}
							</div>
							<div className="assets-route__section-title">
								Used In ({selectedAsset.referenceCount})
							</div>
							{selectedAsset.references.length > 0 ? (
								selectedAsset.references.slice(0, 6).map(reference => (
									<button
										className="assets-route__usage"
										key={`${reference.sourceId}:${reference.start}:${reference.path}`}
										onClick={() => revealReference(reference)}
										type="button"
									>
										<TablerIcon icon="file-text" />
										<span>{reference.sourceName}</span>
										<span>
											{reference.line}:{reference.start}
										</span>
									</button>
								))
							) : (
								<div className="assets-route__muted">
									No passages reference this asset.
								</div>
							)}
							<div className="assets-route__actions">
								<Button
									block
									icon="clipboard"
									onClick={() => copySnippet(selectedAsset)}
									size="sm"
									variant="primary"
								>
									Copy Snippet
								</Button>
								<Button
									block
									icon="arrow-bar-to-down"
									onClick={() => insertSnippet(selectedAsset)}
									size="sm"
								>
									Insert into Passage
								</Button>
								<Button
									block
									icon="link"
									onClick={() => revealUsage(selectedAsset)}
									size="sm"
									variant="ghost"
								>
									Find Usages
								</Button>
								<Button
									block
									disabled={!firstUsage}
									icon="tool"
									onClick={() => testFirstUsage(selectedAsset)}
									size="sm"
									variant="primary"
								>
									Test First Usage
								</Button>
								<Button
									block
									icon="folder-open"
									onClick={() => revealAsset(selectedAsset)}
									size="sm"
									variant="ghost"
								>
									Reveal in Folder
								</Button>
								<Button
									block
									icon="edit"
									onClick={() =>
										setAssetEdit({
											mode: 'rename',
											path: selectedAsset.path,
											value: selectedAsset.path
										})
									}
									size="sm"
									variant="ghost"
								>
									Rename
								</Button>
								<Button
									block
									icon="refresh"
									onClick={() =>
										setAssetEdit({
											mode: 'replace',
											path: selectedAsset.path,
											value: ''
										})
									}
									size="sm"
									variant="ghost"
								>
									Replace File
								</Button>
								<Button
									block
									icon="trash"
									onClick={() => deleteAsset(selectedAsset)}
									size="sm"
									variant="danger"
								>
									Delete
								</Button>
								<Button
									block
									icon="refresh"
									onClick={validateReferences}
									size="sm"
									variant="ghost"
								>
									Validate References
								</Button>
							</div>
							{assetEdit && (
								<form className="assets-route__edit" onSubmit={applyAssetEdit}>
									<Input
										autoFocus
										aria-label={
											assetEdit.mode === 'rename'
												? 'New asset path'
												: 'Replacement file path'
										}
										block
										icon={assetEdit.mode === 'rename' ? 'edit' : 'refresh'}
										onChange={event => {
											const {value} = event.target;

											setAssetEdit(current =>
												current ? {...current, value} : current
											);
										}}
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
							{firstUsage && (
								<div className="assets-route__muted">
									First usage: {firstUsage.name}
								</div>
							)}
						</div>
					</>
				) : (
					<div className="assets-route__empty-detail">Select an asset.</div>
				)}
			</aside>
		</div>
	);
};
