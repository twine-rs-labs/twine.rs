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
	emptyStoryIndex,
	importAssetCommand,
	insertAssetSnippetCommand,
	replaceAssetCommand,
	replaceKnownAssetInventoryForStory,
	renameAssetCommand,
	revealAssetCommand,
	useCoreProjectHost,
	validateAssetReferencesCommand
} from '../../core';
import type {
	CoreAssetInventoryEntry,
	CoreStoryIndex,
	PatchBatch
} from '../../core';
import type {CoreAssetReference} from '../../core/bindings/CoreAssetReference';
import type {AssetManagerViewModelEntry} from '../../core/view-models';
import {
	fileUrlForPath,
	normalizedAssetPath,
	projectAssetPath
} from '../../core/asset-paths';
import {selectPassage, Story, useStoriesContext} from '../../store/stories';
import {useStoryLaunch} from '../../store/use-story-launch';
import {usePrefsContext} from '../../store/prefs';
import {
	defaultProjectFolderRoot,
	loadProjectMetadata,
	saveProjectMetadata
} from '../../store/project-metadata';
import {markPerformance} from '../../util/performance';
import {
	sourceNavigationTargetFromAssetReference,
	sourceTarget
} from '../story-edit/source-navigation';
import './assets-route.css';

type AssetSort = 'Name' | 'References' | 'Size' | 'Type';
type AssetView = 'grid' | 'table';
type AssetInventoryState = 'fallback' | 'loading' | 'live' | 'error';
type AssetScope = 'All Assets' | 'Missing' | 'Unused' | string;

interface AssetDirectoryNode {
	assets: AssetManagerViewModelEntry[];
	children: AssetDirectoryNode[];
	count: number;
	depth: number;
	name: string;
	path: string;
}

interface AssetDirectoryIndex {
	nodesByPath: Map<string, AssetDirectoryNode>;
	root: AssetDirectoryNode;
}

function storyForId(stories: Story[], storyId: string | undefined) {
	return stories.find(story => story.id === storyId);
}

function assetInventoryKey(asset: CoreAssetInventoryEntry) {
	return normalizedAssetPath(asset.normalizedPath || asset.path);
}

function indexWithProjectAssets(
	storyId: string,
	index: CoreStoryIndex | undefined,
	projectAssets: CoreAssetInventoryEntry[]
) {
	const base = index ?? emptyStoryIndex(storyId);

	if (projectAssets.length === 0) {
		return base;
	}

	const inventoryByPath = new Map(
		projectAssets.map(asset => [assetInventoryKey(asset), asset])
	);

	for (const asset of base.assetInventory) {
		inventoryByPath.set(assetInventoryKey(asset), asset);
	}

	return {
		...base,
		assetInventory: Array.from(inventoryByPath.values())
	};
}

function copyText(text: string) {
	const {twineElectron} = window as TwineElectronWindow;

	if (twineElectron?.copyText) {
		twineElectron.copyText(text);
		return;
	}

	void navigator.clipboard?.writeText(text);
}

function importTargetPathForSource(sourcePath: string) {
	const normalized = sourcePath.replace(/\\/g, '/');

	if (/^assets\//i.test(normalized)) {
		return projectAssetPath(sourcePath);
	}

	const filename = normalized.split('/').filter(Boolean).pop();

	return filename ? `assets/${filename}` : projectAssetPath(sourcePath);
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

function durationLabel(milliseconds: number | null) {
	if (milliseconds === null) {
		return 'n/a';
	}

	if (milliseconds < 1000) {
		return `${milliseconds} ms`;
	}

	const seconds = Math.round(milliseconds / 1000);
	const minutes = Math.floor(seconds / 60);
	const remainder = seconds % 60;

	return minutes > 0
		? `${minutes}:${remainder.toString().padStart(2, '0')}`
		: `${seconds} sec`;
}

function modifiedLabel(value: string | null) {
	if (!value) {
		return 'Unknown';
	}

	const date = /^\d+$/.test(value) ? new Date(Number(value)) : new Date(value);

	if (Number.isNaN(date.getTime())) {
		return 'Unknown';
	}

	return new Intl.DateTimeFormat(undefined, {
		dateStyle: 'medium',
		timeStyle: 'short'
	}).format(date);
}

function dimensionLabel(asset: AssetManagerViewModelEntry) {
	if (asset.width && asset.height) {
		return `${asset.width}x${asset.height}`;
	}

	return durationLabel(asset.inventory.durationMs);
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

	if (asset.kind === 'stylesheet') {
		return 'file-code';
	}

	if (asset.kind === 'script') {
		return 'braces';
	}

	return 'file';
}

function assetKindLabel(asset: AssetManagerViewModelEntry) {
	switch (asset.kind) {
		case 'audio':
			return 'Audio';
		case 'image':
			return 'Image';
		case 'script':
			return 'Script';
		case 'stylesheet':
			return 'Stylesheet';
		case 'video':
			return 'Video';
		default:
			return 'File';
	}
}

function pathParts(path: string) {
	return path.split('/').filter(Boolean);
}

function fileNameForPath(path: string) {
	return pathParts(path).pop() ?? path;
}

function parentPathForPath(path: string) {
	const parts = pathParts(path);

	return parts.length > 1 ? parts.slice(0, -1).join('/') : '';
}

function createDirectoryNode(
	path: string,
	name: string,
	depth: number
): AssetDirectoryNode {
	return {
		assets: [],
		children: [],
		count: 0,
		depth,
		name,
		path
	};
}

function buildAssetDirectoryIndex(
	entries: AssetManagerViewModelEntry[]
): AssetDirectoryIndex {
	const root = createDirectoryNode('', 'Assets', -1);
	const nodesByPath = new Map<string, AssetDirectoryNode>([['', root]]);

	for (const asset of entries) {
		const parts = pathParts(asset.path);
		const directoryParts = parts.slice(0, -1);
		let parent = root;
		let currentPath = '';

		for (const [index, part] of directoryParts.entries()) {
			currentPath = currentPath ? `${currentPath}/${part}` : part;

			let node = nodesByPath.get(currentPath);

			if (!node) {
				node = createDirectoryNode(currentPath, part, index);
				nodesByPath.set(currentPath, node);
				parent.children.push(node);
			}

			parent = node;
		}

		parent.assets.push(asset);
	}

	function finalize(node: AssetDirectoryNode) {
		node.children.sort((left, right) => left.name.localeCompare(right.name));
		node.assets.sort((left, right) => left.path.localeCompare(right.path));
		node.count =
			node.assets.length +
			node.children.reduce((total, child) => total + finalize(child), 0);

		return node.count;
	}

	finalize(root);
	return {nodesByPath, root};
}

function assetIsInDirectory(
	asset: AssetManagerViewModelEntry,
	directory: string
) {
	if (!directory) {
		return true;
	}

	return asset.path.startsWith(`${directory}/`);
}

function issueCount(
	assets: AssetManagerViewModelEntry[],
	issue: 'Missing' | 'Unused'
) {
	return assets.filter(asset =>
		issue === 'Missing' ? asset.missing : asset.unused
	).length;
}

function folderAncestors(path: string) {
	const parts = pathParts(path);

	return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
}

function expandedWithAncestors(expanded: Set<string>, path: string) {
	const next = new Set(expanded);

	for (const ancestor of folderAncestors(path).slice(0, -1)) {
		next.add(ancestor);
	}

	return next;
}

function matchesScope(asset: AssetManagerViewModelEntry, scope: AssetScope) {
	if (scope === 'All Assets') {
		return true;
	}

	if (scope === 'Missing') {
		return asset.missing;
	}

	if (scope === 'Unused') {
		return asset.unused;
	}

	return assetIsInDirectory(asset, scope);
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

function assetSourceLabel(asset: AssetManagerViewModelEntry) {
	if (asset.exists === true) {
		return asset.referenceCount > 0 ? 'File + references' : 'File only';
	}

	if (asset.exists === false) {
		return 'Missing file';
	}

	return 'Reference only';
}

function previewUrlForAsset(
	asset: AssetManagerViewModelEntry,
	projectRoot?: string
) {
	const previewUrl = asset.thumbnailUrl ?? asset.inventory.previewUrl;

	if (previewUrl) {
		return previewUrl;
	}

	if (!projectRoot || asset.missing || asset.exists === false) {
		return null;
	}

	if (!/^assets\//i.test(asset.path)) {
		return null;
	}

	return fileUrlForPath(`${projectRoot.replace(/[\\/]+$/, '')}/${asset.path}`);
}

function isPreviewableAsset(
	asset: AssetManagerViewModelEntry,
	projectRoot?: string
) {
	return (
		!asset.missing &&
		!!previewUrlForAsset(asset, projectRoot) &&
		['audio', 'image', 'video'].includes(asset.kind)
	);
}

const AssetThumbnail: React.FC<{
	asset: AssetManagerViewModelEntry;
	projectRoot?: string;
}> = ({asset, projectRoot}) => {
	const previewUrl = previewUrlForAsset(asset, projectRoot);
	const [failed, setFailed] = React.useState(false);

	React.useEffect(() => setFailed(false), [asset.path, previewUrl]);

	if (asset.missing) {
		return <TablerIcon icon={assetIcon(asset)} />;
	}

	if (previewUrl && asset.kind === 'image' && !failed) {
		return (
			<img
				alt=""
				loading="lazy"
				onError={() => setFailed(true)}
				src={previewUrl}
			/>
		);
	}

	return <TablerIcon icon={assetIcon(asset)} />;
};

const AssetPreviewMedia: React.FC<{
	asset: AssetManagerViewModelEntry;
	projectRoot?: string;
}> = ({asset, projectRoot}) => {
	const previewUrl = previewUrlForAsset(asset, projectRoot);
	const [failed, setFailed] = React.useState(false);

	React.useEffect(() => setFailed(false), [asset.path, previewUrl]);

	if (asset.missing || failed) {
		return <TablerIcon icon={assetIcon(asset)} />;
	}

	if (previewUrl && asset.kind === 'image') {
		return <img alt="" onError={() => setFailed(true)} src={previewUrl} />;
	}

	if (previewUrl && asset.kind === 'audio') {
		return (
			<div className="assets-route__preview-player">
				<TablerIcon icon="music" />
				<audio controls src={previewUrl} />
			</div>
		);
	}

	if (previewUrl && asset.kind === 'video') {
		return <video controls src={previewUrl} />;
	}

	return <TablerIcon icon={assetIcon(asset)} />;
};

const AssetLightbox: React.FC<{
	asset: AssetManagerViewModelEntry;
	onClose: () => void;
	projectRoot?: string;
}> = ({asset, onClose, projectRoot}) => {
	const previewUrl = previewUrlForAsset(asset, projectRoot);

	React.useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			if (event.key === 'Escape') {
				onClose();
			}
		}

		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [onClose]);

	if (!previewUrl) {
		return null;
	}

	return (
		<div
			aria-label={`Preview ${fileNameForPath(asset.path)}`}
			aria-modal="true"
			className="assets-route__lightbox"
			role="dialog"
		>
			<div className="assets-route__lightbox-bar">
				<div className="assets-route__lightbox-title">
					<b>{fileNameForPath(asset.path)}</b>
					<span>{asset.path}</span>
				</div>
				<IconButton icon="x" label="Close preview" onClick={onClose} solid />
			</div>
			<div className="assets-route__lightbox-stage">
				{asset.kind === 'image' && <img alt="" src={previewUrl} />}
				{asset.kind === 'audio' && (
					<div className="assets-route__lightbox-audio">
						<TablerIcon icon="music" />
						<audio autoPlay controls src={previewUrl} />
					</div>
				)}
				{asset.kind === 'video' && <video autoPlay controls src={previewUrl} />}
			</div>
		</div>
	);
};

const AssetFolderTreeNode: React.FC<{
	expandedFolders: Set<string>;
	node: AssetDirectoryNode;
	onSelect: (path: string) => void;
	onToggle: (path: string) => void;
	selectedScope: AssetScope;
}> = ({expandedFolders, node, onSelect, onToggle, selectedScope}) => {
	const expanded = expandedFolders.has(node.path);
	const hasChildren = node.children.length > 0;

	return (
		<>
			<div
				className="assets-route__folder-row"
				style={{'--depth': node.depth} as React.CSSProperties}
			>
				{hasChildren ? (
					<button
						aria-expanded={expanded}
						aria-label={`${expanded ? 'Collapse' : 'Expand'} ${node.path}`}
						className="assets-route__folder-toggle"
						onClick={() => onToggle(node.path)}
						type="button"
					>
						<TablerIcon icon="chevron-right" />
					</button>
				) : (
					<span className="assets-route__folder-toggle-spacer" />
				)}
				<button
					aria-current={selectedScope === node.path}
					className="assets-route__folder assets-route__folder--tree"
					onClick={() => onSelect(node.path)}
					title={node.path}
					type="button"
				>
					<TablerIcon icon={expanded ? 'folder-open' : 'folder'} />
					<span>{node.name}</span>
					<span className="assets-route__count">{node.count}</span>
				</button>
			</div>
			{expanded &&
				node.children.map(child => (
					<AssetFolderTreeNode
						expandedFolders={expandedFolders}
						key={child.path}
						node={child}
						onSelect={onSelect}
						onToggle={onToggle}
						selectedScope={selectedScope}
					/>
				))}
		</>
	);
};

export const AssetsRoute: React.FC = () => {
	const {storyId} = useParams<{storyId: string}>();
	const {dispatch, stories} = useStoriesContext();
	const {prefs} = usePrefsContext();
	const {testStory} = useStoryLaunch();
	const history = useHistory();
	const coreProjectHost = useCoreProjectHost();
	const story = storyForId(stories, storyId);
	const [folder, setFolder] = React.useState<AssetScope>('All Assets');
	const [expandedFolders, setExpandedFolders] = React.useState<Set<string>>(
		() => new Set()
	);
	const [query, setQuery] = React.useState('');
	const [sort, setSort] = React.useState<AssetSort>('Name');
	const [view, setView] = React.useState<AssetView>('grid');
	const [selectedPath, setSelectedPath] = React.useState<string>();
	const [previewAsset, setPreviewAsset] =
		React.useState<AssetManagerViewModelEntry>();
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
	const [index, setIndex] = React.useState<CoreStoryIndex>();
	const [inferredProjectRoot, setInferredProjectRoot] =
		React.useState<string>();
	const projectMetadata = React.useMemo(
		() => (story ? loadProjectMetadata(story.id) : undefined),
		[story]
	);
	const projectRoot = projectMetadata?.rootPath ?? inferredProjectRoot;
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
		if (
			!projectRoot ||
			(!twineElectron?.projectSessionSnapshot &&
				!twineElectron?.listProjectAssets)
		) {
			setProjectAssets([]);
			setInventoryState('fallback');
			return;
		}

		setInventoryState('loading');

		try {
			const snapshot = twineElectron.projectSessionSnapshot
				? await twineElectron.projectSessionSnapshot(
						projectRoot,
						story ? [story.id] : undefined
					)
				: undefined;
			const inventory =
				snapshot?.assets ??
				(await twineElectron.listProjectAssets(projectRoot));

			if (story) {
				replaceKnownAssetInventoryForStory(story.id, inventory);
			}
			setProjectAssets(inventory);
			setInventoryState('live');
			markPerformance('asset-inventory-ready');
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
				setProjectAssets(inventory);
				setInventoryState('live');
				setInferredProjectRoot(rootPath);
				setAssetError(undefined);
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

		if (!story) {
			setIndex(undefined);
			return () => {
				active = false;
			};
		}

		setIndex(undefined);

		void coreProjectHost.queryStoryIndexAsync(story.id).then(index => {
			if (active) {
				setIndex(index);
			}
		});

		return () => {
			active = false;
		};
	}, [coreProjectHost, patchVersion, projectAssets, story]);
	const assets = React.useMemo(
		() =>
			story
				? assetManagerViewModel(
						indexWithProjectAssets(story.id, index, projectAssets)
					)
				: undefined,
		[index, projectAssets, story]
	);
	const directoryIndex = React.useMemo(
		() => buildAssetDirectoryIndex(assets?.entries ?? []),
		[assets]
	);
	const selectedDirectory =
		folder === 'All Assets'
			? directoryIndex.root
			: folder === 'Missing' || folder === 'Unused'
				? undefined
				: directoryIndex.nodesByPath.get(folder);
	const queryActive = query.trim() !== '';
	const visibleDirectories = React.useMemo(
		() =>
			queryActive || folder === 'Missing' || folder === 'Unused'
				? []
				: (selectedDirectory?.children ?? []),
		[folder, queryActive, selectedDirectory]
	);
	const visibleAssets = React.useMemo(() => {
		const entries = assets?.entries ?? [];
		const scoped = entries.filter(asset => matchesScope(asset, folder));
		const filtered =
			queryActive || folder === 'Missing' || folder === 'Unused'
				? scoped.filter(asset => matchesQuery(asset, query))
				: (selectedDirectory?.assets ?? []);

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
	}, [assets, folder, query, queryActive, selectedDirectory, sort]);
	const selectedAsset =
		visibleAssets.find(asset => asset.path === selectedPath) ??
		(folder === 'All Assets' || queryActive || visibleDirectories.length === 0
			? visibleAssets[0]
			: undefined);
	const firstUsage =
		story && selectedAsset
			? firstUsagePassage(story, selectedAsset)
			: undefined;
	const canRevealSelectedAsset = !!selectedAsset?.firstReference;

	React.useEffect(() => {
		if (selectedAsset && selectedAsset.path !== selectedPath) {
			setSelectedPath(selectedAsset.path);
		}

		if (!selectedAsset && selectedPath) {
			setSelectedPath(undefined);
		}
	}, [selectedAsset, selectedPath]);

	function selectFolder(nextFolder: AssetScope) {
		setFolder(nextFolder);
		setSelectedPath(undefined);

		if (
			nextFolder !== 'All Assets' &&
			nextFolder !== 'Missing' &&
			nextFolder !== 'Unused'
		) {
			setExpandedFolders(current => expandedWithAncestors(current, nextFolder));
		}
	}

	function toggleFolder(path: string) {
		setExpandedFolders(current => {
			const next = new Set(current);

			if (next.has(path)) {
				next.delete(path);
			} else {
				next.add(path);
			}

			return next;
		});
	}

	function focusAsset(path: string) {
		const parentPath = parentPathForPath(path);

		selectFolder(parentPath || 'All Assets');
		setExpandedFolders(current =>
			parentPath ? expandedWithAncestors(current, parentPath) : current
		);
		setSelectedPath(path);
	}

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
				const targetPath =
					copied?.targetPath ?? importTargetPathForSource(sourcePath);

				await coreProjectHost.applyStoryCommand(
					importAssetCommand(story.id, copied?.sourcePath ?? sourcePath, {
						targetPath
					}),
					{effectToken: copied?.effectToken}
				);
				setImportPath('');
				focusAsset(targetPath);
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
				const targetPath =
					copied?.targetPath ?? importTargetPathForSource(sourcePath);

				await coreProjectHost.applyStoryCommand(
					importAssetCommand(story.id, copied?.sourcePath ?? sourcePath, {
						targetPath
					}),
					{effectToken: copied?.effectToken}
				);
				setImportPath('');
				focusAsset(targetPath);
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

		const reference = asset.firstReference;
		const target = reference
			? sourceNavigationTargetFromAssetReference(reference)
			: undefined;

		if (!target || !reference) {
			return;
		}

		if (target.kind === 'passage') {
			const passage = story.passages.find(
				passage => passage.id === target.passageId
			);

			if (passage) {
				dispatch(selectPassage(story, passage, true));
			}
		}

		history.push(
			sourceTarget(story, {
				line: reference.line,
				offset: reference.start,
				target
			})
		);
	}

	function revealReference(reference: CoreAssetReference) {
		if (!story) {
			return;
		}

		const target = sourceNavigationTargetFromAssetReference(reference);

		if (!target) {
			return;
		}

		if (target.kind === 'passage') {
			const passage = story.passages.find(
				passage => passage.id === target.passageId
			);

			if (passage) {
				dispatch(selectPassage(story, passage, true));
			}
		}

		history.push(
			sourceTarget(story, {
				line: reference.line,
				offset: reference.start,
				target
			})
		);
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

				await coreProjectHost.applyStoryCommand(
					renameAssetCommand(
						story.id,
						assetEdit.path,
						renamed?.targetPath ?? value
					),
					{effectToken: renamed?.effectToken}
				);
				focusAsset(renamed?.targetPath ?? value);
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

				await coreProjectHost.applyStoryCommand(
					replaceAssetCommand(
						story.id,
						assetEdit.path,
						replaced?.sourcePath ?? value
					),
					{effectToken: replaced?.effectToken}
				);
				focusAsset(assetEdit.path);
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
			const deleted =
				projectRoot && twineElectron?.deleteProjectAsset
					? await twineElectron.deleteProjectAsset(projectRoot, asset.path)
					: undefined;

			await coreProjectHost.applyStoryCommand(
				deleteAssetCommand(story.id, asset.path, true),
				{effectToken: deleted?.effectToken}
			);
			setSelectedPath(undefined);
			selectFolder(parentPathForPath(asset.path) || 'All Assets');
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
					onClick={() => selectFolder('All Assets')}
					type="button"
				>
					<TablerIcon icon="folder-open" />
					<span>All Assets</span>
					<span className="assets-route__count">{assets.entries.length}</span>
				</button>
				{directoryIndex.root.children.map(child => (
					<AssetFolderTreeNode
						expandedFolders={expandedFolders}
						key={child.path}
						node={child}
						onSelect={selectFolder}
						onToggle={toggleFolder}
						selectedScope={folder}
					/>
				))}
				<div className="assets-route__filter-label">Issues</div>
				<button
					aria-current={folder === 'Missing'}
					className="assets-route__folder assets-route__folder--issue"
					onClick={() => selectFolder('Missing')}
					type="button"
				>
					<TablerIcon icon="photo-off" />
					<span>Missing</span>
					<span className="assets-route__count">
						{issueCount(assets.entries, 'Missing')}
					</span>
				</button>
				<button
					aria-current={folder === 'Unused'}
					className="assets-route__folder assets-route__folder--issue"
					onClick={() => selectFolder('Unused')}
					type="button"
				>
					<TablerIcon icon="circle-off" />
					<span>Unused</span>
					<span className="assets-route__count">
						{issueCount(assets.entries, 'Unused')}
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
						onClick={() => selectFolder('Unused')}
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
					{visibleDirectories.length === 0 && visibleAssets.length === 0 ? (
						<div className="assets-route__list-empty">
							No assets match this filter.
						</div>
					) : (
						<>
							{visibleDirectories.map(directory => (
								<button
									aria-label={`Open folder ${directory.path}`}
									className="assets-route__card assets-route__card--folder"
									key={directory.path}
									onClick={() => selectFolder(directory.path)}
									type="button"
								>
									<span className="assets-route__thumb">
										<TablerIcon icon="folder" />
									</span>
									<span className="assets-route__card-caption">
										<b>{directory.name}</b>
										<span>{directory.path}</span>
									</span>
									<span className="assets-route__card-meta">
										<span>Folder</span>
										<span>{directory.count} items</span>
									</span>
								</button>
							))}
							{visibleAssets.map(asset => (
								<button
									aria-current={asset.path === selectedAsset?.path}
									aria-label={`Select asset ${asset.path}`}
									className={classNames('assets-route__card', {
										'assets-route__card--code':
											asset.kind === 'script' || asset.kind === 'stylesheet',
										'assets-route__card--missing': asset.missing,
										'assets-route__card--unused': asset.unused
									})}
									key={asset.path}
									onClick={() => setSelectedPath(asset.path)}
									type="button"
								>
									<span className="assets-route__thumb">
										<AssetThumbnail asset={asset} projectRoot={projectRoot} />
									</span>
									<span className="assets-route__card-caption">
										<b>{fileNameForPath(asset.path)}</b>
										<span>{parentPathForPath(asset.path) || asset.path}</span>
									</span>
									<span className="assets-route__card-meta">
										<span>{assetKindLabel(asset)}</span>
										<span>{asset.referenceCount} refs</span>
									</span>
								</button>
							))}
						</>
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
							<AssetPreviewMedia
								asset={selectedAsset}
								projectRoot={projectRoot}
							/>
						</div>
						<div className="assets-route__preview-body">
							<div className="assets-route__preview-name">
								{fileNameForPath(selectedAsset.path)}
							</div>
							<div className="assets-route__preview-path">
								Path: {selectedAsset.path}
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
								<b>{assetKindLabel(selectedAsset)}</b>
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
									No indexed source references this asset.
								</div>
							)}
							<div className="assets-route__actions">
								<Button
									block
									disabled={!isPreviewableAsset(selectedAsset, projectRoot)}
									icon="arrows-diagonal"
									onClick={() => setPreviewAsset(selectedAsset)}
									size="sm"
									variant="primary"
								>
									Preview
								</Button>
								<Button
									block
									icon="clipboard"
									onClick={() => copySnippet(selectedAsset)}
									size="sm"
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
									disabled={!canRevealSelectedAsset}
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
			{previewAsset && (
				<AssetLightbox
					asset={previewAsset}
					onClose={() => setPreviewAsset(undefined)}
					projectRoot={projectRoot}
				/>
			)}
		</div>
	);
};
