import {v4 as uuid} from '@lukeed/uuid';
import classNames from 'classnames';
import * as React from 'react';
import {useNavigate, useLocation} from 'react-router';
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
	passageDefaults,
	storyDefaults,
	Story,
	StoryWithDocuments,
	useStoriesContext
} from '../../store/stories';
import type {
	NativeProjectImportSource,
	NativeProjectFolderResult,
	NativeProjectReplacementTransaction,
	ProjectSourceLayout
} from '../../electron/shared';
import {loadProjectMetadata} from '../../store/project-metadata';
import {projectStoryHydration} from '../../store/project-hydration';
import {
	ProjectLibraryService,
	useProjectLibraryService
} from '../../store/project-library-service';
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
import {
	assertImportFileSize,
	maxImportSourceBytes,
	maxImportZipBytes
} from '../../util/import-limits';
import {
	type CoreAssetInventoryEntry,
	knownAssetInventoryForStory,
	knownAssetInventoryScanCompleteForStory,
	materializeRegisteredStory,
	registerStoryDocuments,
	replaceKnownAssetInventoryForStory,
	releaseBootstrapStory,
	replaceStoryCommand,
	useCoreProjectHost
} from '../../core';
import {StoryEditMode} from '../story-edit/workspace-state';
import {workbenchBufferCoordinator} from '../../util/workbench-buffer-coordinator';
import './new-project-route.css';

type NewProjectTab = 'create' | 'import';

interface ImportQueue {
	fileName: string;
	preparedImport?: NativeProjectImportSource;
	stories: StoryWithDocuments[];
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

function pathSlug(value: string) {
	let slug = '';

	for (const character of value) {
		if (/^[a-z0-9]$/i.test(character)) {
			slug += character.toLowerCase();
		} else if (!slug.endsWith('-')) {
			slug += '-';
		}

		if (slug.length >= 64) {
			break;
		}
	}

	return slug.replace(/^-+|-+$/g, '') || 'item';
}

function projectSlug(name: string, storyId: string) {
	const slug = pathSlug(name);

	return slug === 'item' || slug === 'untitled' ? pathSlug(storyId) : slug;
}

function projectFolder(name: string, storyId: string, parent?: string) {
	return `${
		parent || '~/Documents/Twine RS/Stories'
	}/${projectSlug(name, storyId)}.twine.rs`;
}

function projectPreviewFiles(
	sourceLayout: ProjectSourceLayout,
	graphLayout: boolean,
	storyName: string,
	startPassageName: string,
	storyId: string
) {
	const storySlug = projectSlug(storyName, storyId);
	const startSlug = pathSlug(startPassageName.trim() || 'Start');
	const files = [
		{
			depth: 0,
			icon: 'folder-open',
			label: `${storySlug}.twine.rs/`,
			status: 'new'
		},
		{depth: 1, icon: 'settings', label: 'twine.toml', status: 'new'},
		...(sourceLayout === 'passage-files'
			? [
					{depth: 1, icon: 'folder', label: 'passages/', status: 'new'},
					{
						depth: 2,
						icon: 'folder',
						label: `${storySlug}/`,
						status: 'new'
					},
					{
						depth: 3,
						icon: 'file-text',
						label: `0001-${startSlug}.twee`,
						status: 'new'
					}
				]
			: [{depth: 1, icon: 'file-text', label: 'story.twee', status: 'new'}]),
		{depth: 1, icon: 'folder', label: 'scripts/', status: 'new'},
		{
			depth: 2,
			icon: 'braces',
			label: `${storySlug}.js`,
			status: 'new'
		},
		{depth: 1, icon: 'folder', label: 'styles/', status: 'new'},
		{
			depth: 2,
			icon: 'file-code',
			label: `${storySlug}.css`,
			status: 'new'
		},
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

async function parseImportFile(
	file: File,
	projectLibrary: ProjectLibraryService
) {
	const sourcePath = projectLibrary.filePathForFile(file);

	assertImportFileSize(
		file.size,
		/\.zip$/i.test(file.name) ? maxImportZipBytes : maxImportSourceBytes
	);

	if (sourcePath && canPrepareNativeImport(file)) {
		if (projectLibrary.isDesktop()) {
			const preparedImport =
				await projectLibrary.prepareProjectImport(sourcePath);

			if (!preparedImport) {
				throw new Error('The desktop project import bridge is unavailable.');
			}

			try {
				return {
					preparedImport,
					stories: await importStoriesFromHtml(preparedImport.htmlSource)
				};
			} catch (error) {
				await projectLibrary.discardProjectImport(preparedImport.id);
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

async function materializeImportReplacement(
	story: Story,
	projectLibrary: ProjectLibraryService
) {
	const metadata = loadProjectMetadata(story.id);

	if (
		metadata?.storageKind === 'electron-project-folder' &&
		metadata.status === 'file-backed' &&
		metadata.rootPath &&
		projectStoryHydration(story.id)?.passageTextLoaded === false
	) {
		const result = await projectLibrary.hydrateProjectFolder(
			metadata.rootPath,
			[story.id]
		);
		const hydrated = result.stories.find(
			candidate => candidate.id === story.id
		);

		if (!hydrated) {
			throw new Error(
				`Project folder hydration did not return story ${story.id}.`
			);
		}
		if (result.passageTextLoaded === false) {
			throw new Error(
				`Project folder hydration did not load passages for story ${story.id}.`
			);
		}
		return hydrated;
	}

	return materializeRegisteredStory(story);
}

export const NewProjectRoute: React.FC = () => {
	const navigate = useNavigate();
	const location = useLocation();
	const repairStories = useStoriesRepair();
	const {prefs} = usePrefsContext();
	const {formats} = useStoryFormatsContext();
	const {stories} = useStoriesContext();
	const coreProjectHost = useCoreProjectHost();
	const projectLibrary = useProjectLibraryService();
	const pathname = location.pathname ?? '';
	const [tab, setTab] = React.useState<NewProjectTab>(
		pathname.endsWith('/import') ? 'import' : 'create'
	);
	const [storyId] = React.useState(() => uuid());
	const [projectName, setProjectName] = React.useState('Untitled Story');
	const [startPassageName, setStartPassageName] = React.useState('Start');
	const [format, setFormat] = React.useState(
		formatKey(prefs.storyFormat.name, prefs.storyFormat.version)
	);
	const [sourceLayout, setSourceLayout] =
		React.useState<ProjectSourceLayout>('passage-files');
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
	const importRunActive = React.useRef(false);
	const preparedImportIds = React.useRef(new Set<string>());
	const routeMounted = React.useRef(true);
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
		() =>
			projectPreviewFiles(
				sourceLayout,
				graphLayout,
				projectName,
				startPassageName,
				storyId
			),
		[graphLayout, projectName, sourceLayout, startPassageName, storyId]
	);
	const projectParent = prefs.defaultProjectFolder || storyLibraryFolder;

	React.useEffect(() => {
		storiesRef.current = stories;
	}, [stories]);

	React.useEffect(() => {
		let cancelled = false;

		projectLibrary
			.getStoryLibraryFolder()
			?.then(path => {
				if (!cancelled) {
					setStoryLibraryFolder(path);
				}
			})
			.catch(() => undefined);

		return () => {
			cancelled = true;
		};
	}, [projectLibrary]);

	React.useEffect(() => {
		// Keep prepared native import handles scoped to this route. The library
		// service owns the native disposal operation. An active import keeps its
		// handle until every filesystem transaction has committed or rolled back.
		routeMounted.current = true;
		return () => {
			routeMounted.current = false;
			if (importRunActive.current) {
				return;
			}
			for (const importId of preparedImportIds.current) {
				void projectLibrary.discardProjectImport(importId);
			}

			preparedImportIds.current.clear();
		};
	}, [projectLibrary]);

	React.useEffect(() => {
		const nextTab = pathname.endsWith('/import') ? 'import' : 'create';

		setTab(nextTab);
	}, [pathname]);

	async function discardPreparedImports() {
		const importIds = [...preparedImportIds.current];

		preparedImportIds.current.clear();

		await Promise.all(
			importIds.map(importId => projectLibrary.discardProjectImport(importId))
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
		navigate(nextTab === 'import' ? '/new-project/import' : '/new-project', {
			replace: true
		});
	}

	async function handleCreate(event: React.FormEvent) {
		event.preventDefault();
		setError(undefined);

		const storyName = projectName.trim();
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

			const story: StoryWithDocuments = {
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
						text: defaults.text,
						top: graphLayout ? 88 : defaults.top,
						width: graphLayout ? 180 : defaults.width
					}
				],
				selected: true,
				startPassage: passageId,
				storyFormat: selectedFormat.name,
				storyFormatVersion: selectedFormat.version
			};

			await projectLibrary.createProject(
				story,
				prefs.defaultProjectFolder || undefined,
				sourceLayout
			);

			window.localStorage.setItem(
				workspaceStorageKey(storyId),
				JSON.stringify({mode: initialMode, selectedPassageId: passageId})
			);
			navigate(`/stories/${storyId}`);
		} catch (error) {
			setError(error instanceof Error ? error.message : String(error));
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
			const {preparedImport, stories: importedStories} = await parseImportFile(
				file,
				projectLibrary
			);

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

	function storyWithImportIdentity(story: StoryWithDocuments) {
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
		if (importRunActive.current || !importQueue) {
			return;
		}

		const selectedStories = importQueue.stories.filter(story =>
			importQueue.selectedIds.includes(story.id)
		);

		if (selectedStories.length === 0) {
			return;
		}

		importRunActive.current = true;
		setImporting(true);
		setImportProgress({detail: 'Preparing replacement stories', progress: 58});
		const registeredReplacementStoryIds: string[] = [];
		const committedReplacementStoryIds = new Set<string>();
		const appliedReplacementStoryIds = new Set<string>();
		const appliedLocalReplacementStoryIds = new Set<string>();
		const createdRoots = new Set<string>();
		const createdRootByStoryId = new Map<string, string>();
		const nativeReplacementTransactions: NativeProjectReplacementTransaction[] =
			[];
		const replacementState = new Map<
			string,
			{
				assets: CoreAssetInventoryEntry[];
				assetScanComplete: boolean;
				hydration: ReturnType<typeof projectStoryHydration>;
				metadata: ReturnType<typeof loadProjectMetadata>;
				replacementStory?: StoryWithDocuments;
				story: StoryWithDocuments;
			}
		>();
		let newDocumentStories: StoryWithDocuments[] = [];
		let newProjectLifecycleStarted = false;
		let newProjectMetadataStarted = false;
		let localReplacementRecoveryPrepared = false;
		let retainLocalReplacementRecovery = false;
		let importCompleted = false;
		const preparedImport = importQueue.preparedImport;

		try {
			await workbenchBufferCoordinator.flushAll();
			const existingStoriesBySelection = selectedStories.map(story =>
				stories.find(
					existing => storyFileName(existing) === storyFileName(story)
				)
			);
			const identityStories = selectedStories.map(storyWithImportIdentity);
			const defaultRepairFormat = safeRepairFormat(formats, prefs.storyFormat);
			const storiesToImport = defaultRepairFormat
				? identityStories.map(story =>
						repairStory(story, identityStories, formats, defaultRepairFormat)
					)
				: identityStories;
			const currentReplacementStories = await Promise.all(
				existingStoriesBySelection.map(existingStory =>
					existingStory
						? materializeImportReplacement(existingStory, projectLibrary)
						: Promise.resolve(undefined)
				)
			);

			for (const currentStory of currentReplacementStories) {
				if (currentStory) {
					// Seed a newly assigned project session from the current library story.
					// The imported story remains a distinct command, so Rust emits the
					// patches that synchronize the retained React metadata.
					registerStoryDocuments(currentStory);
					registeredReplacementStoryIds.push(currentStory.id);
					replacementState.set(currentStory.id, {
						assets: [...knownAssetInventoryForStory(currentStory.id)],
						assetScanComplete: knownAssetInventoryScanCompleteForStory(
							currentStory.id
						),
						hydration: projectStoryHydration(currentStory.id),
						metadata: loadProjectMetadata(currentStory.id),
						story: currentStory
					});
				}
			}

			setImportProgress({detail: 'Writing project folders', progress: 62});
			const projectResults: Array<NativeProjectFolderResult | undefined> =
				Array.from({length: storiesToImport.length});
			const nativeReplacementIndexes = new Set<number>();
			const replacementIndexesByRoot = new Map<string, number[]>();

			for (const [
				index,
				existingStory
			] of existingStoriesBySelection.entries()) {
				if (!existingStory || !currentReplacementStories[index]) {
					continue;
				}
				const metadata = loadProjectMetadata(existingStory.id);

				if (
					metadata?.storageKind === 'electron-project-folder' &&
					metadata.status === 'file-backed' &&
					metadata.rootPath
				) {
					replacementIndexesByRoot.set(metadata.rootPath, [
						...(replacementIndexesByRoot.get(metadata.rootPath) ?? []),
						index
					]);
					nativeReplacementIndexes.add(index);
				}
			}

			for (const [rootPath, indexes] of replacementIndexesByRoot) {
				const replacementByStoryId = new Map(
					indexes.map(index => [
						existingStoriesBySelection[index]!.id,
						storiesToImport[index]
					])
				);
				const currentProjectStories = await Promise.all(
					stories
						.filter(
							story => loadProjectMetadata(story.id)?.rootPath === rootPath
						)
						.map(story => materializeImportReplacement(story, projectLibrary))
				);
				const finalProjectStories = currentProjectStories.map(
					story => replacementByStoryId.get(story.id) ?? story
				);
				const transaction = await projectLibrary.beginProjectReplacement(
					rootPath,
					finalProjectStories,
					preparedImport?.id
				);

				nativeReplacementTransactions.push(transaction);
				for (const index of indexes) {
					projectResults[index] = transaction.project;
				}
			}

			for (const [index, story] of storiesToImport.entries()) {
				if (nativeReplacementIndexes.has(index)) {
					continue;
				}
				const existingStory = existingStoriesBySelection[index];
				const result = await projectLibrary.createProjectFolder(
					story,
					prefs.defaultProjectFolder || undefined,
					undefined,
					{commitProjectState: false}
				);

				if (result) {
					createdRoots.add(result.rootPath);
					createdRootByStoryId.set(
						existingStory?.id ?? story.id,
						result.rootPath
					);
				}
				projectResults[index] = result;
			}

			if (preparedImport) {
				setImportProgress({detail: 'Copying project assets', progress: 82});
				await Promise.all(
					projectResults.flatMap((result, index) =>
						result && !nativeReplacementIndexes.has(index)
							? [
									projectLibrary.copyProjectImportAssets(
										preparedImport.id,
										result.rootPath
									)
								]
							: []
					)
				);
			}

			const replacementAssetInventories = new Map<
				string,
				CoreAssetInventoryEntry[]
			>();

			for (const [index, result] of projectResults.entries()) {
				const existingStory = existingStoriesBySelection[index];

				if (existingStory && result) {
					replacementAssetInventories.set(
						existingStory.id,
						await projectLibrary.listProjectAssets(result.rootPath)
					);
				}
			}
			const localReplacementStories = currentReplacementStories.filter(
				(story, index): story is StoryWithDocuments =>
					!!story &&
					!!existingStoriesBySelection[index] &&
					!projectResults[index]
			);

			if (localReplacementStories.length > 0) {
				projectLibrary.prepareLocalReplacementRecovery(localReplacementStories);
				localReplacementRecoveryPrepared = true;
			}

			for (const [index, result] of projectResults.entries()) {
				const existingStory = existingStoriesBySelection[index];

				if (!existingStory || !result) {
					continue;
				}

				replaceKnownAssetInventoryForStory(
					existingStory.id,
					replacementAssetInventories.get(existingStory.id) ?? []
				);
				// Publishing metadata and hydration can rebind both the Core and native
				// sessions. Do that only after the folder's final asset scan is ready and
				// the current passage documents have a registered transport.
				projectLibrary.commitProjectFolder(existingStory.id, result);
				committedReplacementStoryIds.add(existingStory.id);
				await coreProjectHost.ensureSessionReady(existingStory.id);
			}

			newDocumentStories = [];

			for (const [index, story] of storiesToImport.entries()) {
				const existingStory = existingStoriesBySelection[index];

				if (existingStory) {
					const previous = replacementState.get(existingStory.id);

					if (!projectResults[index]) {
						// A persisted-command rejection can happen after Rust applied the
						// replacement but local storage failed. Record compensation state
						// before awaiting the exact persistence completion.
						if (previous) {
							previous.replacementStory = story;
						}
						appliedReplacementStoryIds.add(existingStory.id);
						appliedLocalReplacementStoryIds.add(existingStory.id);
						await coreProjectHost.applyStoryCommandPersisted(
							replaceStoryCommand(existingStory.id, story)
						);
					} else {
						await coreProjectHost.applyStoryCommand(
							replaceStoryCommand(existingStory.id, story),
							{persistence: 'skip'}
						);
						if (previous) {
							previous.replacementStory = story;
						}
						appliedReplacementStoryIds.add(existingStory.id);
					}
				} else {
					newDocumentStories.push(story);
				}
			}

			if (newDocumentStories.length > 0) {
				// Metadata publication and Rust admission form one lifecycle cohort.
				// Cleanup must cover a failure in either phase, including a partial
				// metadata commit before Core admission begins.
				newProjectMetadataStarted = true;
				for (const story of newDocumentStories) {
					const result = projectResults[storiesToImport.indexOf(story)];

					if (result) {
						projectLibrary.commitProjectFolder(story.id, result);
					} else {
						projectLibrary.commitLocalProject(story.id);
					}
				}
				await projectLibrary.admitProjectStories(newDocumentStories);
				newProjectLifecycleStarted = true;
			}
			repairStories();
			if (localReplacementRecoveryPrepared) {
				projectLibrary.clearLocalReplacementRecovery();
				localReplacementRecoveryPrepared = false;
			}
			if (nativeReplacementTransactions.length > 0) {
				await projectLibrary.commitProjectReplacements(
					nativeReplacementTransactions.map(transaction => transaction.id)
				);
			}
			importCompleted = true;
			if (preparedImport) {
				try {
					await projectLibrary.discardProjectImport(preparedImport.id);
					preparedImportIds.current.delete(preparedImport.id);
				} catch (error) {
					console.warn(
						`Could not discard committed import staging: ${(error as Error).message}`
					);
				}
			}
			navigate('/');
		} catch (error) {
			setImportError((error as Error).message);
		} finally {
			if (!importCompleted) {
				const cleanupErrors: string[] = [];
				const retainedRoots = new Set<string>();
				const failedNativeRollbackStoryIds = new Set<string>();

				if (nativeReplacementTransactions.length > 0) {
					const rollbackResults = await Promise.allSettled(
						nativeReplacementTransactions.map(transaction =>
							projectLibrary.rollbackProjectReplacement(transaction.id)
						)
					);

					for (const [index, result] of rollbackResults.entries()) {
						if (result.status === 'rejected') {
							const transaction = nativeReplacementTransactions[index];

							for (const storyId of transaction.project.storyIds) {
								failedNativeRollbackStoryIds.add(storyId);
							}
							cleanupErrors.push(
								`Could not restore native project replacement ${transaction.project.rootPath}; the affected project remains unavailable until startup recovery completes: ${(result.reason as Error).message}`
							);
						}
					}
				}

				const replacementRollbackStoryIds = new Set(
					[
						...committedReplacementStoryIds,
						...appliedReplacementStoryIds
					].filter(storyId => !failedNativeRollbackStoryIds.has(storyId))
				);
				const committedReplacements = [...replacementRollbackStoryIds]
					.map(storyId => replacementState.get(storyId))
					.filter((value): value is NonNullable<typeof value> => !!value);

				if (committedReplacements.length !== replacementRollbackStoryIds.size) {
					if (
						[...replacementRollbackStoryIds].some(storyId =>
							appliedLocalReplacementStoryIds.has(storyId)
						)
					) {
						retainLocalReplacementRecovery = true;
					}
					for (const storyId of replacementRollbackStoryIds) {
						const rootPath = createdRootByStoryId.get(storyId);

						if (rootPath) retainedRoots.add(rootPath);
					}
					cleanupErrors.push(
						'Could not restore every replaced project because its prior lifecycle state was unavailable.'
					);
				} else if (committedReplacements.length > 0) {
					try {
						await projectLibrary.rollbackProjectReplacements(
							committedReplacements
						);
					} catch (error) {
						if (
							[...replacementRollbackStoryIds].some(storyId =>
								appliedLocalReplacementStoryIds.has(storyId)
							)
						) {
							retainLocalReplacementRecovery = true;
						}
						for (const storyId of replacementRollbackStoryIds) {
							const rootPath = createdRootByStoryId.get(storyId);

							if (rootPath) retainedRoots.add(rootPath);
						}
						cleanupErrors.push(
							`Could not restore replaced projects after the failed import: ${(error as Error).message}`
						);
					}
				}

				if (newProjectLifecycleStarted) {
					try {
						await projectLibrary.rollbackProjectAdmissions(newDocumentStories);
					} catch (error) {
						for (const story of newDocumentStories) {
							const rootPath = createdRootByStoryId.get(story.id);

							if (rootPath) retainedRoots.add(rootPath);
						}
						cleanupErrors.push(
							`Could not retire projects admitted before the import failed: ${(error as Error).message}`
						);
					}
				} else if (newProjectMetadataStarted) {
					projectLibrary.forgetProjectBindings(newDocumentStories);
				}

				for (const [storyId, previous] of replacementState) {
					const rootPath = createdRootByStoryId.get(storyId);

					if (rootPath && previous.metadata?.rootPath === rootPath) {
						retainedRoots.add(rootPath);
					}
				}
				if (
					localReplacementRecoveryPrepared &&
					!retainLocalReplacementRecovery
				) {
					try {
						projectLibrary.clearLocalReplacementRecovery();
						localReplacementRecoveryPrepared = false;
					} catch (error) {
						cleanupErrors.push(
							`Could not clear the local project recovery record: ${(error as Error).message}`
						);
					}
				}
				const removableRoots = [...createdRoots].filter(
					rootPath => !retainedRoots.has(rootPath)
				);

				if (removableRoots.length > 0) {
					const cleanupResults = await Promise.allSettled(
						removableRoots.map(rootPath =>
							projectLibrary.removeProjectFolder(rootPath)
						)
					);

					for (const [index, result] of cleanupResults.entries()) {
						if (result.status === 'rejected') {
							const reason =
								result.reason instanceof Error
									? result.reason.message
									: String(result.reason);

							cleanupErrors.push(
								`Could not remove incomplete project folder "${removableRoots[index]}": ${reason}`
							);
						}
					}
				}
				if (
					localReplacementRecoveryPrepared &&
					retainLocalReplacementRecovery
				) {
					try {
						// Seal immediately before the import UI unlocks. Startup compares
						// each affected project's exact provisional contents independently.
						projectLibrary.sealLocalReplacementRecovery();
					} catch (error) {
						cleanupErrors.push(
							`Could not seal the local project recovery record: ${(error as Error).message}`
						);
					}
				}
				if (cleanupErrors.length > 0) {
					setImportError(current =>
						[current, ...cleanupErrors].filter(Boolean).join('\n')
					);
				}
			}
			for (const storyId of registeredReplacementStoryIds) {
				releaseBootstrapStory(storyId);
			}
			importRunActive.current = false;
			if (
				!routeMounted.current &&
				preparedImport &&
				preparedImportIds.current.has(preparedImport.id)
			) {
				await projectLibrary
					.discardProjectImport(preparedImport.id)
					.catch(() => undefined);
				preparedImportIds.current.delete(preparedImport.id);
			}
			setImporting(false);
			setImportProgress(undefined);
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

			const result = await projectLibrary.openProjectFolder({
				loadPassageText: false
			});

			if (!result?.stories.length) {
				return;
			}

			setImportProgress({detail: 'Preparing story shell', progress: 76});
			const shellStories = await projectLibrary.admitOpenedProject(result);

			storiesRef.current = shellStories;
			repairStories();
			markPerformance('shell-visible');
			measurePerformance('open-to-shell', 'open-start', 'shell-visible');
			navigate('/');

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
										value={projectFolder(projectName, storyId, projectParent)}
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
											onChange={value =>
												setSourceLayout(value as ProjectSourceLayout)
											}
											options={[
												{
													icon: 'files',
													label: 'Multi (Recommended)',
													value: 'passage-files'
												},
												{
													icon: 'file-text',
													label: 'Single',
													value: 'single-twee'
												}
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
								<Button icon="arrow-back-up" onClick={() => navigate('/')}>
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
								{projectFolder(projectName, storyId, projectParent)}
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
															<Badge icon="plus" tone="success">
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
							<Button icon="arrow-back-up" onClick={() => navigate('/')}>
								Cancel
							</Button>
							<Button
								disabled={
									importing ||
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
