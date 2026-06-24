import {v4 as uuid} from '@lukeed/uuid';
import classNames from 'classnames';
import * as React from 'react';
import {useHistory, useLocation} from 'react-router-dom';
import {
	Badge,
	Button,
	Checkbox,
	Input,
	Panel,
	SegmentedControl,
	Select,
	TablerIcon
} from '../../components/design-system';
import {storyFileName} from '../../electron/shared';
import {defaults as prefsDefaults, usePrefsContext} from '../../store/prefs';
import {
	createStory,
	importStories as importStoriesAction,
	passageDefaults,
	storyDefaults,
	Story,
	useStoriesContext
} from '../../store/stories';
import type {
	NativeProjectImportSource,
	TwineElectronWindow
} from '../../electron/shared';
import {saveProjectMetadata} from '../../store/project-metadata';
import {
	mergeProjectStories,
	projectStoryIdsForCurrentStories
} from '../../store/merge-project-stories';
import {markProjectStoryHydration} from '../../store/project-hydration';
import {
	formatWithNameAndVersion,
	StoryFormat,
	useStoryFormatsContext
} from '../../store/story-formats';
import {useStoriesRepair} from '../../store/use-stories-repair';
import {repairStory} from '../../store/stories/reducer/repair/repair-story';
import {importStoriesAsync as importStoriesFromHtml} from '../../util/import';
import {
	markPerformance,
	measurePerformance,
	scheduleIdleWork
} from '../../util/performance';
import {storyFromTwee} from '../../util/twee';
import {StoryEditMode} from '../story-edit/workspace-state';
import './new-project-route.css';

type NewProjectTab = 'create' | 'import';
type SourceLayout = 'single' | 'multi';

interface ImportQueue {
	fileName: string;
	preparedImport?: NativeProjectImportSource;
	stories: Story[];
	selectedIds: string[];
}

interface ImportProgress {
	detail: string;
	progress: number;
}

function formatKey(name: string, version: string) {
	return `${name}@${version}`;
}

function parseFormatKey(key: string) {
	const [name, ...versionParts] = key.split('@');

	return {
		name,
		version: versionParts.join('@')
	};
}

function workspaceStorageKey(storyId: string) {
	return `twine-story-edit-workspace-${storyId}`;
}

function projectSlug(name: string) {
	const slug = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');

	return slug || 'untitled-story';
}

function projectFolder(name: string, parent?: string) {
	return `${
		parent || '~/Documents/Twine RS/Stories'
	}/${projectSlug(name)}.twine.rs`;
}

function projectPreviewFiles(sourceLayout: SourceLayout, graphLayout: boolean) {
	const passagePath =
		sourceLayout === 'multi' ? ['passages/', 'start.twee'] : ['story.twee'];
	const files = [
		{depth: 0, icon: 'folder-open', label: 'project/', status: 'new'},
		{depth: 1, icon: 'settings', label: 'twine.toml', status: 'new'},
		...(sourceLayout === 'multi'
			? [
					{depth: 1, icon: 'folder', label: passagePath[0], status: 'new'},
					{depth: 2, icon: 'file-text', label: passagePath[1], status: 'new'}
				]
			: [{depth: 1, icon: 'file-text', label: passagePath[0], status: 'new'}]),
		{depth: 1, icon: 'folder', label: 'scripts/', status: 'new'},
		{depth: 2, icon: 'braces', label: 'story.js', status: 'new'},
		{depth: 1, icon: 'folder', label: 'styles/', status: 'new'},
		{depth: 2, icon: 'file-code', label: 'story.css', status: 'new'},
		{depth: 1, icon: 'folder', label: 'assets/', status: 'empty'},
		...(graphLayout
			? [
					{depth: 1, icon: 'folder', label: '.twine/', status: 'optional'},
					{
						depth: 2,
						icon: 'binary-tree',
						label: 'graph.json',
						status: 'optional'
					}
				]
			: [{depth: 1, icon: 'folder', label: '.twine/', status: 'optional'}])
	];

	return files;
}

async function readFile(file: File) {
	if ('text' in file) {
		return file.text();
	}

	return new Promise<string>((resolve, reject) => {
		const reader = new FileReader();

		reader.onerror = () => reject(reader.error);
		reader.onload = () => resolve(String(reader.result ?? ''));
		reader.readAsText(file);
	});
}

function parseAfterIdle<T>(parse: () => T) {
	return new Promise<T>((resolve, reject) =>
		scheduleIdleWork(() => {
			try {
				resolve(parse());
			} catch (error) {
				reject(error);
			}
		})
	);
}

function waitForPaint() {
	return new Promise<void>(resolve => {
		if (typeof window.requestAnimationFrame === 'function') {
			window.requestAnimationFrame(() => resolve());
		} else {
			window.setTimeout(resolve, 0);
		}
	});
}

function desktopBridge() {
	return (window as TwineElectronWindow).twineElectron;
}

function nativeFilePath(file: File) {
	const twineElectron = desktopBridge();

	try {
		const path = twineElectron?.filePathForFile?.(file);

		if (path?.trim()) {
			return path;
		}
	} catch {
		// Fall back to Electron versions that exposed File.path directly.
	}

	const legacyPath = (file as File & {path?: string}).path;

	return legacyPath?.trim() ? legacyPath : undefined;
}

function canPrepareNativeImport(file: File) {
	return /\.(html?|zip)$/i.test(file.name);
}

function safeRepairFormat(
	formats: StoryFormat[],
	preferredFormat: {name: string; version: string}
) {
	for (const candidate of [preferredFormat, prefsDefaults().storyFormat]) {
		try {
			return formatWithNameAndVersion(
				formats,
				candidate.name,
				candidate.version
			);
		} catch {
			// Try the next known-safe format.
		}
	}

	return undefined;
}

async function parseImportFile(file: File) {
	const twineElectron = desktopBridge();
	const sourcePath = nativeFilePath(file);

	if (sourcePath && canPrepareNativeImport(file)) {
		if (twineElectron?.prepareProjectImport) {
			const preparedImport =
				await twineElectron.prepareProjectImport(sourcePath);

			try {
				return {
					preparedImport,
					stories: await importStoriesFromHtml(preparedImport.htmlSource)
				};
			} catch (error) {
				await twineElectron.discardProjectImport?.(preparedImport.id);
				throw error;
			}
		}
	}

	if (/\.zip$/i.test(file.name)) {
		throw new Error('Zip import requires the desktop app file bridge.');
	}

	const source = await readFile(file);

	return {
		preparedImport: undefined,
		stories: /\.html?$/i.test(file.name)
			? await importStoriesFromHtml(source)
			: await parseAfterIdle(() => [storyFromTwee(source)])
	};
}

async function persistNativeProjectFolder(
	story: Story,
	preferredParent?: string
) {
	const twineElectron = desktopBridge();

	if (!twineElectron?.createProjectFolder) {
		saveProjectMetadata(story.id, {
			status: 'local-only',
			storageKind: 'web-local'
		});
		return undefined;
	}

	const result = await twineElectron.createProjectFolder(
		story,
		preferredParent
	);

	saveProjectMetadata(story.id, {
		rootPath: result.rootPath,
		status: 'file-backed',
		storageKind: 'electron-project-folder'
	});
	markProjectStoryHydration(story.id, {
		passageTextLoaded: result.passageTextLoaded !== false,
		rootPath: result.rootPath
	});

	return result;
}

export const NewProjectRoute: React.FC = () => {
	const history = useHistory();
	const location = useLocation();
	const repairStories = useStoriesRepair();
	const {prefs} = usePrefsContext();
	const {formats} = useStoryFormatsContext();
	const {dispatch, stories} = useStoriesContext();
	const pathname = location.pathname ?? '';
	const [tab, setTab] = React.useState<NewProjectTab>(
		pathname.endsWith('/import') ? 'import' : 'create'
	);
	const [projectName, setProjectName] = React.useState('Untitled Story');
	const [startPassageName, setStartPassageName] = React.useState('Start');
	const [format, setFormat] = React.useState(
		formatKey(prefs.storyFormat.name, prefs.storyFormat.version)
	);
	const [sourceLayout, setSourceLayout] =
		React.useState<SourceLayout>('single');
	const [initialMode, setInitialMode] = React.useState<StoryEditMode>('graph');
	const [graphLayout, setGraphLayout] = React.useState(true);
	const [storyLibraryFolder, setStoryLibraryFolder] = React.useState('');
	const [error, setError] = React.useState<string>();
	const [importQueue, setImportQueue] = React.useState<ImportQueue>();
	const [importing, setImporting] = React.useState(false);
	const [importProgress, setImportProgress] = React.useState<ImportProgress>();
	const [importError, setImportError] = React.useState<string>();
	const [draggingImport, setDraggingImport] = React.useState(false);
	const fileInput = React.useRef<HTMLInputElement>(null);
	const preparedImportIds = React.useRef(new Set<string>());
	const storiesRef = React.useRef(stories);
	const formatOptions = React.useMemo(
		() =>
			formats.map(format => ({
				label: `${format.name} ${format.version}`,
				value: formatKey(format.name, format.version)
			})),
		[formats]
	);
	const selectedFormat = React.useMemo(() => parseFormatKey(format), [format]);
	const previewFiles = React.useMemo(
		() => projectPreviewFiles(sourceLayout, graphLayout),
		[graphLayout, sourceLayout]
	);
	const projectParent = prefs.defaultProjectFolder || storyLibraryFolder;

	React.useEffect(() => {
		storiesRef.current = stories;
	}, [stories]);

	React.useEffect(() => {
		let cancelled = false;

		desktopBridge()
			?.getStoryLibraryFolder?.()
			.then(path => {
				if (!cancelled) {
					setStoryLibraryFolder(path);
				}
			})
			.catch(() => undefined);

		return () => {
			cancelled = true;
		};
	}, []);

	React.useEffect(() => {
		const nextTab = pathname.endsWith('/import') ? 'import' : 'create';

		setTab(nextTab);
	}, [pathname]);

	React.useEffect(
		() => () => {
			for (const importId of preparedImportIds.current) {
				void desktopBridge()?.discardProjectImport?.(importId);
			}

			preparedImportIds.current.clear();
		},
		[]
	);

	async function discardPreparedImports() {
		const importIds = [...preparedImportIds.current];

		preparedImportIds.current.clear();

		await Promise.all(
			importIds.map(importId =>
				desktopBridge()?.discardProjectImport?.(importId)
			)
		);
	}

	function trackPreparedImport(preparedImport?: NativeProjectImportSource) {
		if (preparedImport) {
			preparedImportIds.current.add(preparedImport.id);
		}
	}

	function handleChangeTab(value: string) {
		const nextTab = value as NewProjectTab;

		setTab(nextTab);
		history.replace(
			nextTab === 'import' ? '/new-project/import' : '/new-project'
		);
	}

	async function handleCreate(event: React.FormEvent) {
		event.preventDefault();
		setError(undefined);

		const storyName = projectName.trim();
		const storyId = uuid();
		const passageName = startPassageName.trim() || 'Start';
		const passageId = uuid();
		const defaults = passageDefaults();

		try {
			if (storyName === '') {
				throw new Error('Story name cannot be empty');
			}

			if (
				stories.some(
					story => story.name.toLowerCase() === storyName.toLowerCase()
				)
			) {
				throw new Error(`There is already a story named "${storyName}"`);
			}

			const story: Story = {
				...storyDefaults(),
				id: storyId,
				ifid: uuid().toUpperCase(),
				lastUpdate: new Date(),
				name: storyName,
				passages: [
					{
						...defaults,
						height: graphLayout ? 140 : defaults.height,
						id: passageId,
						left: graphLayout ? 96 : defaults.left,
						name: passageName,
						selected: true,
						story: storyId,
						text:
							sourceLayout === 'multi'
								? `[[${passageName} Notes]]`
								: defaults.text,
						top: graphLayout ? 88 : defaults.top,
						width: graphLayout ? 180 : defaults.width
					}
				],
				selected: true,
				startPassage: passageId,
				storyFormat: selectedFormat.name,
				storyFormatVersion: selectedFormat.version
			};

			await persistNativeProjectFolder(
				story,
				prefs.defaultProjectFolder || undefined
			);

			dispatch(
				createStory(stories, prefs, {
					...story
				})
			);

			window.localStorage.setItem(
				workspaceStorageKey(storyId),
				JSON.stringify({mode: initialMode, selectedPassageId: passageId})
			);
			history.push(`/stories/${storyId}`);
		} catch (error) {
			setError((error as Error).message);
		}
	}

	async function handleImportFile(file: File | undefined) {
		if (!file) {
			return;
		}

		setImportError(undefined);
		setImportQueue(undefined);
		setImporting(true);
		setImportProgress({detail: 'Reading source file', progress: 28});

		try {
			await discardPreparedImports();

			setImportProgress({detail: 'Parsing story data', progress: 54});
			const {preparedImport, stories: importedStories} =
				await parseImportFile(file);

			trackPreparedImport(preparedImport);
			setImportProgress({detail: 'Preparing import review', progress: 86});

			setImportQueue({
				fileName: file.name,
				preparedImport,
				selectedIds: importedStories
					.filter(story => !willReplaceExisting(story))
					.map(story => story.id),
				stories: importedStories
			});
		} catch (error) {
			setImportError((error as Error).message);
		} finally {
			setImporting(false);
			setImportProgress(undefined);
		}
	}

	async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
		try {
			await handleImportFile(event.target.files?.[0]);
		} finally {
			event.target.value = '';
		}
	}

	function willReplaceExisting(story: Story) {
		return stories.some(
			existing => storyFileName(existing) === storyFileName(story)
		);
	}

	function setImportSelected(story: Story, selected: boolean) {
		setImportQueue(current => {
			if (!current) {
				return current;
			}

			return {
				...current,
				selectedIds: selected
					? Array.from(new Set([...current.selectedIds, story.id]))
					: current.selectedIds.filter(id => id !== story.id)
			};
		});
	}

	function storyWithImportIdentity(story: Story) {
		const existingStory = stories.find(
			existing => storyFileName(existing) === storyFileName(story)
		);

		if (!existingStory) {
			return story;
		}

		return {
			...story,
			id: existingStory.id,
			passages: story.passages.map(passage => ({
				...passage,
				story: existingStory.id
			}))
		};
	}

	async function handleImport() {
		if (!importQueue) {
			return;
		}

		const selectedStories = importQueue.stories.filter(story =>
			importQueue.selectedIds.includes(story.id)
		);

		if (selectedStories.length === 0) {
			return;
		}

		try {
			const identityStories = selectedStories.map(storyWithImportIdentity);
			const defaultRepairFormat = safeRepairFormat(formats, prefs.storyFormat);
			const storiesToImport = defaultRepairFormat
				? identityStories.map(story =>
						repairStory(story, identityStories, formats, defaultRepairFormat)
					)
				: identityStories;

			setImporting(true);
			setImportProgress({detail: 'Writing project folders', progress: 62});
			const projectResults = await Promise.all(
				storiesToImport.map(story =>
					persistNativeProjectFolder(
						story,
						prefs.defaultProjectFolder || undefined
					)
				)
			);
			const preparedImport = importQueue.preparedImport;

			if (preparedImport) {
				setImportProgress({detail: 'Copying project assets', progress: 82});
				await Promise.all(
					projectResults.flatMap(result =>
						result
							? [
									desktopBridge()?.copyProjectImportAssets?.(
										preparedImport.id,
										result.rootPath
									)
								]
							: []
					)
				);
				await desktopBridge()?.discardProjectImport?.(preparedImport.id);
				preparedImportIds.current.delete(preparedImport.id);
			}

			dispatch(importStoriesAction(storiesToImport, stories));
			repairStories();
			history.push('/');
		} catch (error) {
			setImportError((error as Error).message);
		} finally {
			setImporting(false);
			setImportProgress(undefined);
		}
	}

	function rememberNativeProjectStories(
		rootPath: string,
		projectStories: Story[],
		storeStoryIds: string[],
		passageTextLoaded: boolean
	) {
		for (const [index, story] of projectStories.entries()) {
			const storyId = storeStoryIds[index] ?? story.id;

			saveProjectMetadata(storyId, {
				rootPath,
				status: 'file-backed',
				storageKind: 'electron-project-folder'
			});
			markProjectStoryHydration(storyId, {
				passageTextLoaded,
				rootPath
			});
		}
	}

	function handleImportDragOver(event: React.DragEvent) {
		event.preventDefault();
		event.dataTransfer.dropEffect = 'copy';
		setDraggingImport(true);
	}

	function handleImportDragLeave(event: React.DragEvent) {
		if (
			event.relatedTarget instanceof Node &&
			event.currentTarget.contains(event.relatedTarget)
		) {
			return;
		}

		setDraggingImport(false);
	}

	async function handleImportDrop(event: React.DragEvent) {
		event.preventDefault();
		setDraggingImport(false);

		await handleImportFile(event.dataTransfer.files[0]);
	}

	async function handleOpenProjectFolder() {
		setImportError(undefined);
		setImportQueue(undefined);
		setImporting(true);
		setImportProgress({detail: 'Opening project folder', progress: 42});
		markPerformance('open-start');

		try {
			await waitForPaint();
			await discardPreparedImports();

			const result = await desktopBridge()?.openProjectFolder?.({
				loadPassageText: false
			});

			if (!result?.stories.length) {
				return;
			}

			setImportProgress({detail: 'Preparing story shell', progress: 76});
			const storeStoryIds = projectStoryIdsForCurrentStories(
				storiesRef.current,
				result.stories,
				{preserveExistingIdentity: false}
			);

			rememberNativeProjectStories(
				result.rootPath,
				result.stories,
				storeStoryIds,
				result.passageTextLoaded !== false
			);
			const shellStories = mergeProjectStories(
				storiesRef.current,
				result.stories,
				{preserveExistingIdentity: false}
			);

			storiesRef.current = shellStories;
			dispatch({
				state: shellStories,
				type: 'init'
			});
			repairStories();
			markPerformance('shell-visible');
			measurePerformance('open-to-shell', 'open-start', 'shell-visible');
			history.push('/');

			if (result.passageTextLoaded) {
				markPerformance('all-passages-ready');
				measurePerformance(
					'open-to-hydrated',
					'open-start',
					'all-passages-ready'
				);
			}
		} catch (error) {
			setImportError((error as Error).message);
		} finally {
			setImporting(false);
			setImportProgress(undefined);
		}
	}

	return (
		<div className="new-project-route">
			<header className="new-project-route__head">
				<div>
					<h1>New Project</h1>
					<p>{tab === 'create' ? 'Create' : 'Import'}</p>
				</div>
				<div className="new-project-route__tabs">
					<SegmentedControl
						onChange={handleChangeTab}
						options={[
							{icon: 'plus', label: 'Create', value: 'create'},
							{icon: 'file-import', label: 'Import', value: 'import'}
						]}
						value={tab}
					/>
				</div>
			</header>
			<div
				className={classNames(
					'new-project-route__grid',
					tab === 'import' && 'new-project-route__grid--import'
				)}
			>
				{tab === 'create' ? (
					<>
						<form className="new-project-route__form" onSubmit={handleCreate}>
							<Panel icon="folder-plus" title="Project" pad>
								<div className="new-project-route__fields">
									<Input
										autoFocus
										block
										icon="writing"
										label="Project name"
										onChange={event => setProjectName(event.target.value)}
										value={projectName}
									/>
									<Input
										block
										icon="folder"
										label="Project folder"
										mono
										readOnly
										value={projectFolder(projectName, projectParent)}
									/>
									<Input
										block
										icon="rocket"
										label="Start passage"
										onChange={event => setStartPassageName(event.target.value)}
										value={startPassageName}
									/>
									<label className="new-project-route__field-label">
										<span>Story format</span>
										<Select
											block
											onChange={setFormat}
											options={formatOptions}
											value={format}
										/>
									</label>
									<div className="new-project-route__format-summary">
										<Badge icon="puzzle" tone="neutral">
											{selectedFormat.name}
										</Badge>
										<Badge mono tone="generated">
											{selectedFormat.version}
										</Badge>
									</div>
								</div>
							</Panel>
							<Panel icon="layout-columns" title="Workspace" pad>
								<div className="new-project-route__fields">
									<label className="new-project-route__field-label">
										<span>Source layout</span>
										<SegmentedControl
											onChange={value => setSourceLayout(value as SourceLayout)}
											options={[
												{icon: 'file-text', label: 'Single', value: 'single'},
												{icon: 'files', label: 'Multi', value: 'multi'}
											]}
											value={sourceLayout}
										/>
									</label>
									<label className="new-project-route__field-label">
										<span>Initial mode</span>
										<SegmentedControl
											onChange={value => setInitialMode(value as StoryEditMode)}
											options={[
												{icon: 'file-text', label: 'Text', value: 'text'},
												{icon: 'binary-tree', label: 'Graph', value: 'graph'},
												{icon: 'layout-columns', label: 'Split', value: 'split'}
											]}
											value={initialMode}
										/>
									</label>
									<Checkbox
										checked={graphLayout}
										label="Create graph layout"
										onChange={setGraphLayout}
									/>
								</div>
							</Panel>
							{error && (
								<Badge icon="alert-octagon" tone="error">
									{error}
								</Badge>
							)}
							<div className="new-project-route__actions">
								<Button icon="arrow-back-up" onClick={() => history.push('/')}>
									Cancel
								</Button>
								<Button icon="plus" type="submit" variant="primary">
									Create Project
								</Button>
							</div>
						</form>
						<Panel
							className="new-project-route__preview"
							icon="folder-check"
							title="Files"
							pad
						>
							<div className="new-project-route__preview-path">
								{projectFolder(projectName, projectParent)}
							</div>
							<ol className="new-project-route__file-tree">
								{previewFiles.map((file, index) => (
									<li
										className={`new-project-route__file new-project-route__file--${file.status}`}
										key={`${file.label}-${index}`}
										style={{'--depth': file.depth} as React.CSSProperties}
									>
										<TablerIcon icon={file.icon} />
										<span>{file.label}</span>
										{file.status !== 'new' && (
											<Badge mono tone="neutral">
												{file.status}
											</Badge>
										)}
									</li>
								))}
							</ol>
						</Panel>
					</>
				) : (
					<div
						className="new-project-route__import"
						onDragLeave={handleImportDragLeave}
						onDragOver={handleImportDragOver}
						onDrop={handleImportDrop}
					>
						<Panel icon="file-import" title="Import Source" pad>
							<div
								className={classNames(
									'new-project-route__dropzone',
									draggingImport && 'new-project-route__dropzone--dragging'
								)}
							>
								<input
									accept=".html,.htm,.twee,.tw,.zip"
									aria-label="Source file"
									onChange={handleFileChange}
									ref={fileInput}
									type="file"
								/>
								<TablerIcon icon="file-import" />
								<Button
									icon="folder-open"
									loading={importing}
									onClick={() => fileInput.current?.click()}
									variant="primary"
								>
									Choose File
								</Button>
								<Button
									icon="folder"
									loading={importing}
									onClick={handleOpenProjectFolder}
								>
									Open Project Folder
								</Button>
								<span>.html, .twee, .tw, .zip</span>
							</div>
							{importProgress && (
								<div
									aria-label="Opening story"
									aria-valuemax={100}
									aria-valuemin={0}
									aria-valuenow={importProgress.progress}
									className="new-project-route__progress"
									role="progressbar"
								>
									<div className="new-project-route__progress-copy">
										<span>Opening story</span>
										<b>{importProgress.detail}</b>
									</div>
									<div className="new-project-route__progress-track">
										<span style={{width: `${importProgress.progress}%`}} />
									</div>
								</div>
							)}
							{importError && (
								<Badge icon="alert-octagon" tone="error">
									{importError}
								</Badge>
							)}
						</Panel>
						<Panel
							count={importQueue?.stories.length ?? 0}
							icon="list-details"
							title="Review"
						>
							{!importQueue ? (
								<div className="new-project-route__review-empty">
									<TablerIcon icon="file-import" />
								</div>
							) : importQueue.stories.length === 0 ? (
								<div className="new-project-route__review-empty">
									<TablerIcon icon="photo-off" />
									<p>No stories found in {importQueue.fileName}</p>
								</div>
							) : (
								<div className="new-project-route__review">
									<table>
										<thead>
											<tr>
												<th aria-label="Selected" />
												<th>Project</th>
												<th>Format</th>
												<th>Passages</th>
												<th>Status</th>
											</tr>
										</thead>
										<tbody>
											{importQueue.stories.map(story => (
												<tr key={story.id}>
													<td>
														<Checkbox
															checked={importQueue.selectedIds.includes(
																story.id
															)}
															onChange={selected =>
																setImportSelected(story, selected)
															}
														/>
													</td>
													<td>
														<div className="new-project-route__project-name">
															{story.name}
														</div>
														<div className="new-project-route__project-meta">
															{storyFileName(story)}
														</div>
													</td>
													<td>
														{story.storyFormat} {story.storyFormatVersion}
													</td>
													<td>{story.passages.length}</td>
													<td>
														{willReplaceExisting(story) ? (
															<Badge icon="refresh" tone="warn">
																Replace
															</Badge>
														) : (
															<Badge icon="plus" tone="saved">
																New
															</Badge>
														)}
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							)}
						</Panel>
						<div className="new-project-route__actions">
							<Button icon="arrow-back-up" onClick={() => history.push('/')}>
								Cancel
							</Button>
							<Button
								disabled={
									!importQueue ||
									importQueue.stories.length === 0 ||
									importQueue.selectedIds.length === 0
								}
								icon="file-import"
								loading={importing}
								onClick={handleImport}
								variant="primary"
							>
								Run Import
							</Button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
};
