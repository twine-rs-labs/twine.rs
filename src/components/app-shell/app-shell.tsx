import * as React from 'react';
import classNames from 'classnames';
import {useNavigate, useLocation} from 'react-router';
import twineMarkUrl from '../../assets/twine-mark.svg';
import {
	diagnosticDismissalsChangedEvent,
	diagnosticIdentity,
	type DiagnosticDismissalsChangedDetail,
	loadDismissedDiagnosticIds,
	useCoreProjectHost
} from '../../core';
import type {CoreDiagnostic} from '../../core/bindings/CoreDiagnostic';
import type {CoreDiagnosticsSummary} from '../../core/bindings/CoreDiagnosticsSummary';
import {storyFileName} from '../../electron/shared';
import {useStorySaveStatus} from '../../store/persistence/save-status';
import {usePrefsContext} from '../../store/prefs';
import {loadProjectMetadata} from '../../store/project-metadata';
import {useProjectStoryHydration} from '../../store/project-hydration';
import {Story, useStoriesContext} from '../../store/stories';
import {usePublishing} from '../../store/use-publishing';
import {useStoryLaunch} from '../../store/use-story-launch';
import {saveHtml, saveTwee} from '../../util/save-file';
import {storyToTwee} from '../../util/twee';
import {
	markPerformance,
	recordPerformanceHarnessEvent
} from '../../util/performance';
import {
	Badge,
	Button,
	IconButton,
	SegmentedControl,
	TablerIcon
} from '../design-system';
import {AppCommand} from './command-registry';
import {
	AppShellContext,
	ShellDockRegistration,
	ShellToolbarRegistration
} from './app-shell-context';
import {CommandPalette} from './command-palette';
import {
	commandIdForKeyboardEvent,
	shortcutLabel,
	ShortcutCommandId
} from './keyboard-shortcuts';
import './app-shell.css';

type BuildState = {
	error?: string;
	kind: 'idle' | 'busy' | 'done' | 'error';
	label: string;
};

type DiagnosticsLoadState =
	| {kind: 'unloaded'}
	| {
			kind: 'loading';
			dismissalsVersion: number;
			patchVersion: number;
			storyId: string;
	  }
	| {
			dismissalsVersion: number;
			kind: 'loaded';
			patchVersion: number;
			storyId: string;
			summary: CoreDiagnosticsSummary;
	  }
	| {
			dismissalsVersion: number;
			kind: 'error';
			message: string;
			patchVersion: number;
			storyId: string;
	  };

const diagnosticsRefreshDebounceMs = 300;

interface StoryOpenProgress {
	detail: string;
	progress: number;
}

interface RouteMode {
	icon: string;
	label: string;
}

function currentStoryId(pathname?: string) {
	const match = (pathname ?? '').match(/^\/stories\/([^/]+)/);

	return match ? decodeURIComponent(match[1]) : undefined;
}

function routeHasSegment(pathname: string | undefined, segment: string) {
	return (pathname ?? '').split('/').includes(segment);
}

function routeMode(pathname?: string): RouteMode {
	const safePathname = pathname ?? '';

	if (safePathname.startsWith('/new-project')) {
		return {icon: 'folder-plus', label: 'New Project'};
	}

	if (safePathname.startsWith('/formats')) {
		return {icon: 'puzzle', label: 'Formats'};
	}

	if (safePathname.startsWith('/settings')) {
		return {icon: 'settings', label: 'Settings'};
	}

	if (routeHasSegment(pathname, 'play')) {
		return {icon: 'player-play', label: 'Play'};
	}

	if (routeHasSegment(pathname, 'proof')) {
		return {icon: 'eyeglass', label: 'Proof'};
	}

	if (routeHasSegment(pathname, 'test')) {
		return {icon: 'tool', label: 'Test'};
	}

	if (routeHasSegment(pathname, 'build')) {
		return {icon: 'package-export', label: 'Build'};
	}

	if (routeHasSegment(pathname, 'contents')) {
		return {icon: 'list-tree', label: 'Contents'};
	}

	if (routeHasSegment(pathname, 'diagnostics')) {
		return {icon: 'alert-triangle', label: 'Diagnostics'};
	}

	if (routeHasSegment(pathname, 'assets')) {
		return {icon: 'photo', label: 'Assets'};
	}

	if (safePathname.startsWith('/stories/')) {
		return {icon: 'layout-columns', label: 'Edit'};
	}

	return {icon: 'files', label: 'Library'};
}

function storySelectionLabel(story: Story | undefined) {
	if (!story) {
		return 'No story selected';
	}

	const selectedPassages = story.passages.filter(passage => passage.selected);

	if (selectedPassages.length === 1) {
		return selectedPassages[0].name;
	}

	if (selectedPassages.length > 1) {
		return `${selectedPassages.length} passages selected`;
	}

	return story.name;
}

function breadcrumbs(
	pathname: string | undefined,
	story: Story | undefined,
	mode: RouteMode
) {
	const safePathname = pathname ?? '';

	if (safePathname === '/') {
		return ['Stories'];
	}

	if (safePathname.startsWith('/new-project')) {
		return ['Stories', mode.label];
	}

	if (safePathname.startsWith('/formats')) {
		return ['Story Formats'];
	}

	if (safePathname.startsWith('/settings')) {
		return ['Settings'];
	}

	if (story) {
		return ['Stories', story.name, mode.label];
	}

	return [mode.label];
}

export const AppShell: React.FC<React.PropsWithChildren> = ({children}) => {
	const navigate = useNavigate();
	const location = useLocation();
	const pathname = location.pathname ?? '';
	const {stories} = useStoriesContext();
	const {prefs} = usePrefsContext();
	const coreProjectHost = useCoreProjectHost();
	const {materializeStory, publishStory} = usePublishing();
	const {playStory, proofStory, testStory} = useStoryLaunch();
	const [paletteOpen, setPaletteOpen] = React.useState(false);
	const [drawerOpen, setDrawerOpen] = React.useState(false);
	const [toolbar, setToolbar] = React.useState<ShellToolbarRegistration>();
	const [dock, setDock] = React.useState<ShellDockRegistration>();
	const [activeToolbarTab, setActiveToolbarTab] = React.useState('');
	const [dirty, setDirty] = React.useState(() => coreProjectHost.isDirty());
	const [patchVersion, setPatchVersion] = React.useState(0);
	const [dismissalsVersion, setDismissalsVersion] = React.useState(0);
	const [diagnostics, setDiagnostics] = React.useState<CoreDiagnostic[]>([]);
	const [diagnosticsLoadState, setDiagnosticsLoadState] =
		React.useState<DiagnosticsLoadState>({kind: 'unloaded'});
	const diagnosticsRequestVersion = React.useRef(0);
	const diagnosticsPatchVersion = React.useRef(patchVersion);
	const diagnosticsRefreshPending = React.useRef(false);
	const diagnosticsRefreshTimer = React.useRef<number | undefined>(undefined);
	const latestDiagnosticsPatchVersion = React.useRef(patchVersion);
	const lastDiagnosticsImmediateRefreshKey = React.useRef<string | undefined>(
		undefined
	);
	const lastDiagnosticsRefreshHost = React.useRef(coreProjectHost);
	const lastDiagnosticsRefreshPatchVersion = React.useRef(patchVersion);
	const [diagnosticsRefreshPatchVersion, setDiagnosticsRefreshPatchVersion] =
		React.useState(patchVersion);
	const [wordCount, setWordCount] = React.useState(0);
	const storySaveStatus = useStorySaveStatus();
	const [buildState, setBuildState] = React.useState<BuildState>({
		kind: 'idle',
		label: 'Ready'
	});
	const storyId = currentStoryId(pathname);
	const selectedStory = stories.find(story => story.selected);
	const routedStory = storyId
		? stories.find(story => story.id === storyId)
		: undefined;
	const currentStory = storyId ? routedStory : selectedStory;
	const diagnosticsStoryId = currentStory?.id;
	const diagnosticsStoryIdRef = React.useRef(diagnosticsStoryId);
	diagnosticsStoryIdRef.current = diagnosticsStoryId;
	latestDiagnosticsPatchVersion.current = patchVersion;
	const currentDiagnosticsLoadState: DiagnosticsLoadState =
		diagnosticsLoadState.kind === 'unloaded' ||
		(diagnosticsLoadState.storyId === diagnosticsStoryId &&
			diagnosticsLoadState.dismissalsVersion === dismissalsVersion &&
			diagnosticsLoadState.patchVersion === patchVersion)
			? diagnosticsLoadState
			: {kind: 'unloaded'};
	const currentStoryHydration = useProjectStoryHydration(currentStory?.id);
	const currentProjectMetadata = React.useMemo(
		() => (currentStory ? loadProjectMetadata(currentStory.id) : undefined),
		[currentStory]
	);
	const mode = routeMode(pathname);
	const routeTabs = React.useMemo(
		() => Object.keys(toolbar?.tabs ?? {}),
		[toolbar]
	);
	const dismissedDiagnosticIds = React.useMemo(
		() =>
			currentStory
				? loadDismissedDiagnosticIds(currentStory.id)
				: new Set<string>(),
		[currentStory?.id, dismissalsVersion]
	);
	const activeDiagnostics = React.useMemo(
		() =>
			diagnostics.filter(
				diagnostic =>
					!dismissedDiagnosticIds.has(diagnosticIdentity(diagnostic))
			),
		[diagnostics, dismissedDiagnosticIds]
	);
	const diagnosticSummary =
		currentDiagnosticsLoadState.kind === 'loaded'
			? currentDiagnosticsLoadState.summary
			: undefined;
	const diagnosticCount = diagnosticSummary?.diagnosticCount ?? 0;
	const dismissedDiagnosticCount = diagnosticSummary?.dismissedCount ?? 0;
	const dismissedPreviewDiagnosticCount =
		diagnostics.length - activeDiagnostics.length;
	const crumbLabels = breadcrumbs(pathname, currentStory, mode);
	const storyOpenProgress = React.useMemo<StoryOpenProgress | undefined>(() => {
		if (
			storyId &&
			currentStory &&
			currentProjectMetadata?.storageKind === 'electron-project-folder' &&
			currentProjectMetadata.status === 'file-backed' &&
			currentStoryHydration?.passageTextLoaded === false
		) {
			return {
				detail: 'Loading passage text',
				progress: 46
			};
		}

		return undefined;
	}, [
		currentProjectMetadata?.status,
		currentProjectMetadata?.storageKind,
		currentStory,
		currentStoryHydration?.passageTextLoaded,
		storyId
	]);

	React.useEffect(() => {
		let active = true;

		setWordCount(0);
		if (currentStory) {
			void coreProjectHost
				.queryStoryWordCountAsync(currentStory.id)
				.then(count => active && setWordCount(count));
		}

		return () => {
			active = false;
		};
	}, [coreProjectHost, currentStory?.id, patchVersion]);

	React.useEffect(() => {
		diagnosticsRequestVersion.current += 1;
		setDiagnostics([]);
		setDiagnosticsLoadState({kind: 'unloaded'});

		return () => {
			diagnosticsRequestVersion.current += 1;
		};
	}, [diagnosticsStoryId]);

	React.useEffect(() => {
		if (
			diagnosticsRefreshPending.current &&
			(!drawerOpen || !diagnosticsStoryId)
		) {
			if (diagnosticsRefreshTimer.current !== undefined) {
				window.clearTimeout(diagnosticsRefreshTimer.current);
				diagnosticsRefreshTimer.current = undefined;
			}
			diagnosticsRefreshPending.current = false;
			diagnosticsRequestVersion.current += 1;
			setDiagnostics([]);
			setDiagnosticsLoadState({kind: 'unloaded'});
			return;
		}

		if (diagnosticsPatchVersion.current === patchVersion) {
			return;
		}

		diagnosticsPatchVersion.current = patchVersion;
		diagnosticsRequestVersion.current += 1;
		setDiagnostics([]);
		if (!drawerOpen || !diagnosticsStoryId) {
			setDiagnosticsLoadState({kind: 'unloaded'});
			return;
		}

		setDiagnosticsLoadState({
			dismissalsVersion,
			kind: 'loading',
			patchVersion,
			storyId: diagnosticsStoryId
		});
		diagnosticsRefreshPending.current = true;
		const timeout = window.setTimeout(() => {
			if (diagnosticsRefreshTimer.current === timeout) {
				diagnosticsRefreshTimer.current = undefined;
			}
			setDiagnosticsRefreshPatchVersion(patchVersion);
		}, diagnosticsRefreshDebounceMs);
		diagnosticsRefreshTimer.current = timeout;

		return () => {
			if (diagnosticsRefreshTimer.current === timeout) {
				window.clearTimeout(timeout);
				diagnosticsRefreshTimer.current = undefined;
			}
		};
	}, [diagnosticsStoryId, dismissalsVersion, drawerOpen, patchVersion]);

	React.useEffect(() => {
		const immediateRefreshKey = `${drawerOpen}:${diagnosticsStoryId ?? ''}:${dismissalsVersion}`;
		const immediateRefreshRequested =
			lastDiagnosticsImmediateRefreshKey.current !== immediateRefreshKey ||
			lastDiagnosticsRefreshHost.current !== coreProjectHost;
		const patchRefreshRequested =
			lastDiagnosticsRefreshPatchVersion.current !==
			diagnosticsRefreshPatchVersion;

		lastDiagnosticsImmediateRefreshKey.current = immediateRefreshKey;
		lastDiagnosticsRefreshHost.current = coreProjectHost;
		lastDiagnosticsRefreshPatchVersion.current = diagnosticsRefreshPatchVersion;

		if (!diagnosticsStoryId || !drawerOpen) {
			return;
		}
		if (
			!immediateRefreshRequested &&
			(!patchRefreshRequested ||
				diagnosticsRefreshPatchVersion !==
					latestDiagnosticsPatchVersion.current)
		) {
			return;
		}

		if (diagnosticsRefreshTimer.current !== undefined) {
			window.clearTimeout(diagnosticsRefreshTimer.current);
			diagnosticsRefreshTimer.current = undefined;
		}

		const requestVersion = ++diagnosticsRequestVersion.current;
		diagnosticsRefreshPending.current = false;
		const requestOwner = {
			dismissalsVersion,
			patchVersion: latestDiagnosticsPatchVersion.current,
			storyId: diagnosticsStoryId
		};

		setDiagnostics([]);
		setDiagnosticsLoadState({kind: 'loading', ...requestOwner});
		void Promise.all([
			coreProjectHost.queryDiagnosticsSummaryAsync(diagnosticsStoryId, {
				dismissedIds: Array.from(dismissedDiagnosticIds).sort()
			}),
			coreProjectHost.queryDiagnosticsPageAsync(diagnosticsStoryId, {
				cursor: null,
				limit: 8,
				severity: null
			})
		])
			.then(([summary, page]) => {
				if (diagnosticsRequestVersion.current === requestVersion) {
					setDiagnostics(page.diagnostics);
					setDiagnosticsLoadState({
						kind: 'loaded',
						summary,
						...requestOwner
					});
				}
			})
			.catch(error => {
				if (diagnosticsRequestVersion.current === requestVersion) {
					setDiagnosticsLoadState({
						kind: 'error',
						message: error instanceof Error ? error.message : String(error),
						...requestOwner
					});
				}
			});
	}, [
		coreProjectHost,
		diagnosticsRefreshPatchVersion,
		diagnosticsStoryId,
		dismissalsVersion,
		dismissedDiagnosticIds,
		drawerOpen
	]);
	const saveStatus =
		storySaveStatus.kind === 'error'
			? {
					icon: 'alert-octagon',
					label: 'Save error',
					title: storySaveStatus.error.message,
					tone: 'error'
				}
			: dirty
				? {
						icon: 'database-import',
						label: 'Saving',
						title: undefined,
						tone: 'dirty'
					}
				: {
						icon: 'database',
						label: 'Saved',
						title: undefined,
						tone: 'success'
					};

	React.useEffect(() => {
		if (routeTabs.length === 0) {
			setActiveToolbarTab('');
			return;
		}

		setActiveToolbarTab(tab => (routeTabs.includes(tab) ? tab : routeTabs[0]));
	}, [routeTabs]);

	React.useEffect(() => {
		setDirty(coreProjectHost.isDirty());

		return coreProjectHost.subscribeToPatches(batch => {
			for (const patch of batch.patches) {
				if (patch.type === 'dirtyStateChanged') {
					setDirty(patch.dirty);
				}
			}
			setPatchVersion(version => version + 1);
		});
	}, [coreProjectHost, stories]);

	React.useEffect(() => {
		function handleDismissalsChanged(event: Event) {
			const detail = (event as CustomEvent<DiagnosticDismissalsChangedDetail>)
				.detail;

			if (detail?.storyId && detail.storyId !== diagnosticsStoryIdRef.current) {
				return;
			}
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
		if (
			storySaveStatus.kind === 'saved' &&
			storySaveStatus.sessionId &&
			storySaveStatus.revision !== undefined
		) {
			recordPerformanceHarnessEvent('save-acknowledgement-start', {
				revision: storySaveStatus.revision,
				sessionId: storySaveStatus.sessionId
			});
			void Promise.resolve(
				coreProjectHost.acknowledgeSaved(
					storySaveStatus.sessionId,
					storySaveStatus.revision
				)
			)
				.then(() =>
					recordPerformanceHarnessEvent('save-acknowledgement-complete', {
						revision: storySaveStatus.revision,
						sessionId: storySaveStatus.sessionId
					})
				)
				.catch(error =>
					recordPerformanceHarnessEvent('save-acknowledgement-failed', {
						error: (error as Error).message,
						revision: storySaveStatus.revision,
						sessionId: storySaveStatus.sessionId
					})
				);
		}
	}, [coreProjectHost, storySaveStatus]);

	React.useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
				event.preventDefault();
				setPaletteOpen(open => !open);
			}
		}

		window.addEventListener('keydown', handleKeyDown);

		return () => window.removeEventListener('keydown', handleKeyDown);
	}, []);

	const shellContext = React.useMemo(
		() => ({
			inShell: true,
			setDock,
			setToolbar
		}),
		[]
	);

	const runBuildAction = React.useCallback(
		async (label: string, action: () => Promise<void> | void) => {
			setBuildState({kind: 'busy', label});

			try {
				await action();
				setBuildState({kind: 'done', label});
			} catch (error) {
				setBuildState({
					error: (error as Error).message,
					kind: 'error',
					label
				});
			}
		},
		[]
	);

	const runPlay = React.useCallback(
		() =>
			currentStory && runBuildAction('Play', () => playStory(currentStory.id)),
		[currentStory, playStory, runBuildAction]
	);
	const runProof = React.useCallback(
		() =>
			currentStory &&
			runBuildAction('Proof', () => proofStory(currentStory.id)),
		[currentStory, proofStory, runBuildAction]
	);
	const runTest = React.useCallback(
		() =>
			currentStory && runBuildAction('Test', () => testStory(currentStory.id)),
		[currentStory, runBuildAction, testStory]
	);
	const runExportHtml = React.useCallback(
		() =>
			currentStory &&
			runBuildAction('Export HTML', async () => {
				saveHtml(
					await publishStory(currentStory.id, {buildTarget: 'publish'}),
					storyFileName(currentStory)
				);
			}),
		[currentStory, publishStory, runBuildAction]
	);
	const runExportTwee = React.useCallback(
		() =>
			currentStory &&
			runBuildAction('Export Twee', async () => {
				const completeStory = await materializeStory(currentStory.id);
				saveTwee(
					storyToTwee(completeStory),
					storyFileName(currentStory, '.twee')
				);
			}),
		[currentStory, materializeStory, runBuildAction]
	);

	const commands = React.useMemo<AppCommand[]>(() => {
		const shortcut = (id: ShortcutCommandId) =>
			shortcutLabel(id, prefs.keybindingPreset);
		const allCommands: AppCommand[] = [
			{
				group: 'Navigation',
				icon: 'files',
				id: 'nav.library',
				label: 'Story Library',
				run: () => navigate('/'),
				shortcut: shortcut('nav.library')
			},
			{
				group: 'Navigation',
				icon: 'puzzle',
				id: 'nav.formats',
				label: 'Story Formats',
				run: () => navigate('/formats')
			},
			{
				group: 'Navigation',
				icon: 'settings',
				id: 'nav.settings',
				label: 'Settings',
				run: () => navigate('/settings'),
				shortcut: shortcut('nav.settings')
			},
			{
				group: 'Navigation',
				icon: 'folder-plus',
				id: 'nav.new-project',
				label: 'New Project',
				run: () => navigate('/new-project'),
				shortcut: shortcut('nav.new-project')
			},
			{
				disabled: !currentStory,
				group: 'Navigation',
				icon: 'layout-columns',
				id: 'nav.current-story',
				label: currentStory ? `Edit ${currentStory.name}` : 'Edit Story',
				run: () => currentStory && navigate(`/stories/${currentStory.id}`),
				shortcut: shortcut('nav.current-story')
			},
			{
				disabled: !currentStory,
				group: 'Build',
				icon: 'package-export',
				id: 'build.screen',
				label: 'Build & Export',
				run: () =>
					currentStory && navigate(`/stories/${currentStory.id}/build`),
				shortcut: shortcut('build.screen')
			},
			{
				disabled: !currentStory,
				group: 'Navigation',
				icon: 'list-tree',
				id: 'nav.contents',
				label: 'Contents',
				run: () => {
					if (currentStory) {
						markPerformance('contents-navigation-start');
						navigate(`/stories/${currentStory.id}/contents`);
					}
				}
			},
			{
				disabled: !currentStory,
				group: 'Navigation',
				icon: 'alert-triangle',
				id: 'nav.diagnostics',
				label: 'Diagnostics',
				run: () =>
					currentStory && navigate(`/stories/${currentStory.id}/diagnostics`)
			},
			{
				disabled: !currentStory,
				group: 'Navigation',
				icon: 'photo',
				id: 'nav.assets',
				label: 'Assets',
				run: () =>
					currentStory && navigate(`/stories/${currentStory.id}/assets`)
			},
			{
				disabled: !currentStory,
				group: 'Build',
				icon: 'tool',
				id: 'build.test',
				label: 'Test Story',
				run: runTest,
				shortcut: shortcut('build.test')
			},
			{
				disabled: !currentStory,
				group: 'Build',
				icon: 'player-play',
				id: 'build.play',
				label: 'Play Story',
				run: runPlay,
				shortcut: shortcut('build.play')
			},
			{
				disabled: !currentStory,
				group: 'Build',
				icon: 'eyeglass',
				id: 'build.proof',
				label: 'Proof Story',
				run: runProof
			},
			{
				disabled: !currentStory,
				group: 'Build',
				icon: 'file-text',
				id: 'build.export-html',
				label: 'Export HTML',
				run: runExportHtml
			},
			{
				disabled: !currentStory,
				group: 'Build',
				icon: 'file-code',
				id: 'build.export-twee',
				label: 'Export Twee',
				run: runExportTwee
			},
			...routeTabs.map(tab => ({
				group: 'Toolbar' as const,
				icon: tab === activeToolbarTab ? 'circle-check' : 'circle-dashed',
				id: `toolbar.${tab}`,
				label: `${tab} Actions`,
				run: () => setActiveToolbarTab(tab)
			})),
			...stories.map(story => ({
				group: 'Story' as const,
				icon: story.id === currentStory?.id ? 'circle-check' : 'file-text',
				id: `story.${story.id}`,
				keywords: [story.name],
				label: story.name,
				run: () => navigate(`/stories/${story.id}`)
			}))
		];

		return allCommands;
	}, [
		activeToolbarTab,
		currentStory,
		navigate,
		prefs.keybindingPreset,
		routeTabs,
		runExportHtml,
		runExportTwee,
		runPlay,
		runProof,
		runTest,
		stories
	]);

	React.useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			const commandId = commandIdForKeyboardEvent(
				event,
				prefs.keybindingPreset
			);

			if (!commandId) {
				return;
			}

			const command = commands.find(command => command.id === commandId);

			if (!command || command.disabled) {
				return;
			}

			event.preventDefault();
			void Promise.resolve(command.run());
		}

		window.addEventListener('keydown', handleKeyDown);

		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [commands, prefs.keybindingPreset]);

	const buildBadgeTone =
		buildState.kind === 'error'
			? 'error'
			: buildState.kind === 'busy'
				? 'build'
				: 'success';
	const diagnosticStatus = (() => {
		if (currentDiagnosticsLoadState.kind === 'unloaded') {
			return {
				icon: 'circle-dashed',
				label: 'Diagnostics not checked',
				tone: 'neutral'
			};
		}

		if (currentDiagnosticsLoadState.kind === 'loading') {
			return {
				icon: 'loader-2',
				label: 'Checking diagnostics',
				tone: 'neutral'
			};
		}

		if (currentDiagnosticsLoadState.kind === 'error') {
			return {
				icon: 'alert-octagon',
				label: 'Diagnostics unavailable',
				tone: 'error'
			};
		}

		const label = `${diagnosticCount} diagnostic${diagnosticCount === 1 ? '' : 's'}`;

		if (currentDiagnosticsLoadState.summary.errorCount > 0) {
			return {icon: 'alert-octagon', label, tone: 'error'};
		}

		if (currentDiagnosticsLoadState.summary.warningCount > 0) {
			return {icon: 'alert-triangle', label, tone: 'warn'};
		}

		if (diagnosticCount > 0) {
			return {icon: 'info-circle', label, tone: 'neutral'};
		}

		return {icon: 'circle-check', label, tone: 'success'};
	})();
	const diagnosticsDrawerContent = (() => {
		if (currentDiagnosticsLoadState.kind === 'unloaded') {
			return (
				<div className="app-shell__drawer-empty">
					Diagnostics have not been checked for{' '}
					{currentStory?.name ?? 'this workspace'}.
				</div>
			);
		}

		if (currentDiagnosticsLoadState.kind === 'loading') {
			return (
				<div className="app-shell__drawer-empty">
					Checking diagnostics for {currentStory?.name ?? 'this workspace'}…
				</div>
			);
		}

		if (currentDiagnosticsLoadState.kind === 'error') {
			return (
				<div className="app-shell__drawer-empty" role="alert">
					Diagnostics unavailable: {currentDiagnosticsLoadState.message}
				</div>
			);
		}

		if (diagnosticCount === 0) {
			return (
				<div className="app-shell__drawer-empty">
					No active diagnostics for {currentStory?.name ?? 'this workspace'}
					{dismissedDiagnosticCount > 0
						? ` (${dismissedDiagnosticCount} dismissed)`
						: ''}
				</div>
			);
		}

		if (activeDiagnostics.length === 0) {
			return (
				<div className="app-shell__drawer-empty">
					No diagnostics are available in this preview
					{dismissedPreviewDiagnosticCount > 0
						? ` (${dismissedPreviewDiagnosticCount} previewed diagnostics dismissed)`
						: ''}
					. Open Diagnostics to browse the full list.
				</div>
			);
		}

		return activeDiagnostics.slice(0, 8).map(diagnostic => (
			<div
				className={classNames(
					'app-shell__diag',
					`app-shell__diag--${diagnostic.severity}`
				)}
				key={`${diagnostic.code}-${diagnostic.sourceId}-${diagnostic.start}`}
			>
				<Badge
					icon={
						diagnostic.severity === 'error'
							? 'alert-octagon'
							: diagnostic.severity === 'warning'
								? 'alert-triangle'
								: 'info-circle'
					}
					tone={
						diagnostic.severity === 'error'
							? 'error'
							: diagnostic.severity === 'warning'
								? 'warn'
								: 'neutral'
					}
				>
					{diagnostic.code}
				</Badge>
				<span>{diagnostic.message}</span>
			</div>
		));
	})();

	return (
		<AppShellContext.Provider value={shellContext}>
			<div
				className={classNames(
					'app-shell',
					mode.label === 'Edit' && 'app-shell--story-edit'
				)}
				data-testid="app-shell"
			>
				<div className="app-shell__top">
					<header className="app-shell__bar">
						<div className="app-shell__brand" aria-label="twine.rs">
							<img
								className="app-shell__brand-mark"
								src={twineMarkUrl}
								alt=""
							/>
							<b className="app-shell__brand-text">
								twine<span>.rs</span>
							</b>
						</div>
						<nav className="app-shell__crumbs" aria-label="Breadcrumbs">
							{crumbLabels.map((crumb, index) => (
								<React.Fragment key={`${crumb}-${index}`}>
									{index > 0 && <TablerIcon icon="chevron-right" />}
									<span>{crumb}</span>
								</React.Fragment>
							))}
						</nav>
						<div className="app-shell__route-tabs">
							{routeTabs.length > 0 && (
								<SegmentedControl
									onChange={setActiveToolbarTab}
									options={routeTabs}
									size="sm"
									value={activeToolbarTab}
								/>
							)}
						</div>
						<div className="app-shell__bar-actions">
							{toolbar?.pinnedControls}
							{toolbar?.helpUrl && (
								<IconButton
									icon="info-circle"
									label="Help"
									onClick={() => window.open(toolbar.helpUrl, '_blank')}
									size="sm"
								/>
							)}
							<Button
								icon="command"
								onClick={() => setPaletteOpen(true)}
								size="sm"
								variant="ghost"
							>
								Command
							</Button>
						</div>
					</header>
					{toolbar && activeToolbarTab && (
						<div className="app-shell__actions">
							<div className="app-shell__actions-scroll">
								{toolbar.tabs[activeToolbarTab]}
							</div>
						</div>
					)}
				</div>
				<nav className="app-shell__rail" aria-label="Workspace">
					<button
						aria-current={pathname === '/' ? 'page' : undefined}
						className="app-shell__rail-button"
						onClick={() => navigate('/')}
						title="Stories"
						type="button"
					>
						<TablerIcon icon="files" />
					</button>
					<button
						aria-current={
							pathname.startsWith('/stories/') &&
							!routeHasSegment(pathname, 'play') &&
							!routeHasSegment(pathname, 'proof') &&
							!routeHasSegment(pathname, 'test') &&
							!routeHasSegment(pathname, 'build') &&
							!routeHasSegment(pathname, 'contents') &&
							!routeHasSegment(pathname, 'diagnostics') &&
							!routeHasSegment(pathname, 'assets')
								? 'page'
								: undefined
						}
						className="app-shell__rail-button"
						disabled={!currentStory}
						onClick={() =>
							currentStory && navigate(`/stories/${currentStory.id}`)
						}
						title="Workbench"
						type="button"
					>
						<TablerIcon icon="layout-columns" />
					</button>
					<button
						aria-current={
							routeHasSegment(pathname, 'contents') ? 'page' : undefined
						}
						className="app-shell__rail-button"
						disabled={!currentStory}
						onClick={() => {
							if (currentStory) {
								markPerformance('contents-navigation-start');
								navigate(`/stories/${currentStory.id}/contents`);
							}
						}}
						title="Contents"
						type="button"
					>
						<TablerIcon icon="list-tree" />
					</button>
					<button
						aria-current={
							routeHasSegment(pathname, 'assets') ? 'page' : undefined
						}
						className="app-shell__rail-button"
						disabled={!currentStory}
						onClick={() =>
							currentStory && navigate(`/stories/${currentStory.id}/assets`)
						}
						title="Assets"
						type="button"
					>
						<TablerIcon icon="photo" />
					</button>
					<button
						className="app-shell__rail-button"
						disabled={!currentStory}
						onClick={runPlay}
						title="Play"
						type="button"
					>
						<TablerIcon icon="player-play" />
					</button>
					<button
						aria-current={
							routeHasSegment(pathname, 'build') ? 'page' : undefined
						}
						className="app-shell__rail-button"
						disabled={!currentStory}
						onClick={() =>
							currentStory && navigate(`/stories/${currentStory.id}/build`)
						}
						title="Build & Export"
						type="button"
					>
						<TablerIcon icon="package-export" />
					</button>
					<button
						aria-current={
							routeHasSegment(pathname, 'diagnostics') ? 'page' : undefined
						}
						className="app-shell__rail-button"
						disabled={!currentStory}
						onClick={() =>
							currentStory &&
							navigate(`/stories/${currentStory.id}/diagnostics`)
						}
						title="Diagnostics"
						type="button"
					>
						<TablerIcon
							icon={
								currentDiagnosticsLoadState.kind === 'loaded' &&
								diagnosticCount > 0
									? diagnosticStatus.icon
									: 'bug'
							}
						/>
						{currentDiagnosticsLoadState.kind === 'loaded' &&
							diagnosticCount > 0 && (
								<span className="app-shell__rail-count">{diagnosticCount}</span>
							)}
					</button>
					<button
						aria-current={pathname.startsWith('/formats') ? 'page' : undefined}
						className="app-shell__rail-button"
						onClick={() => navigate('/formats')}
						title="Story Formats"
						type="button"
					>
						<TablerIcon icon="puzzle" />
					</button>
					<button
						aria-current={pathname.startsWith('/settings') ? 'page' : undefined}
						className="app-shell__rail-button"
						onClick={() => navigate('/settings')}
						title="Settings"
						type="button"
					>
						<TablerIcon icon="settings" />
					</button>
					<button
						aria-current={
							pathname.startsWith('/new-project') ? 'page' : undefined
						}
						className="app-shell__rail-button"
						onClick={() => navigate('/new-project')}
						title="New Project"
						type="button"
					>
						<TablerIcon icon="folder-plus" />
					</button>
				</nav>
				<main className="app-shell__center">
					<div className="app-shell__route">{children}</div>
				</main>
				{storyOpenProgress && (
					<div
						aria-label="Opening story"
						aria-valuemax={100}
						aria-valuemin={0}
						aria-valuenow={storyOpenProgress.progress}
						className="app-shell__open-progress"
						role="progressbar"
					>
						<div className="app-shell__open-progress-copy">
							<span>Opening story</span>
							<b>{storyOpenProgress.detail}</b>
						</div>
						<div className="app-shell__open-progress-track">
							<span style={{width: `${storyOpenProgress.progress}%`}} />
						</div>
					</div>
				)}
				{dock && (
					<aside className="app-shell__dock" aria-label={dock.label}>
						{dock.content}
					</aside>
				)}
				{drawerOpen && (
					<aside className="app-shell__drawer" aria-label="Diagnostics">
						<header className="app-shell__drawer-head">
							<div>
								<TablerIcon icon="alert-triangle" />
								<span>Diagnostics</span>
							</div>
							<IconButton
								icon="x"
								label="Close diagnostics"
								onClick={() => setDrawerOpen(false)}
								size="sm"
							/>
						</header>
						<div className="app-shell__drawer-body">
							{diagnosticsDrawerContent}
						</div>
					</aside>
				)}
				<footer className="app-shell__status" aria-live="polite">
					<span className="app-shell__status-item app-shell__status-mode">
						<TablerIcon icon={mode.icon} />
						{mode.label}
					</span>
					<button
						className={classNames(
							'app-shell__status-item',
							'app-shell__status-button',
							'app-shell__story-status',
							storyOpenProgress && 'app-shell__story-status--loading'
						)}
						disabled={!currentStory}
						onClick={() =>
							currentStory && navigate(`/stories/${currentStory.id}`)
						}
						title={
							currentStory
								? `Open ${storySelectionLabel(currentStory)}`
								: 'No story selected'
						}
						type="button"
					>
						<TablerIcon icon="focus-2" />
						<span>
							{storyOpenProgress?.detail ?? storySelectionLabel(currentStory)}
						</span>
						{storyOpenProgress && (
							<span aria-hidden className="app-shell__story-status-progress">
								<span style={{width: `${storyOpenProgress.progress}%`}} />
							</span>
						)}
					</button>
					<span
						className={classNames(
							'app-shell__status-item',
							'app-shell__status-save',
							`app-shell__status-save--${saveStatus.tone}`
						)}
						title={saveStatus.title}
					>
						<TablerIcon icon={saveStatus.icon} />
						{saveStatus.label}
					</span>
					<button
						className={classNames(
							'app-shell__status-item',
							'app-shell__status-button',
							'app-shell__status-diagnostics',
							`app-shell__status-diagnostics--${diagnosticStatus.tone}`
						)}
						onClick={() => setDrawerOpen(open => !open)}
						title={
							currentDiagnosticsLoadState.kind === 'error'
								? currentDiagnosticsLoadState.message
								: currentDiagnosticsLoadState.kind === 'loaded' &&
									  dismissedDiagnosticCount > 0
									? `${dismissedDiagnosticCount} dismissed diagnostic${
											dismissedDiagnosticCount === 1 ? '' : 's'
										}`
									: undefined
						}
						type="button"
					>
						<TablerIcon icon={diagnosticStatus.icon} />
						{diagnosticStatus.label}
					</button>
					<span className="app-shell__status-spacer" />
					<span className="app-shell__status-item app-shell__status-words">
						{wordCount} words
					</span>
					<Badge dot tone={buildBadgeTone} title={buildState.error}>
						{buildState.label}
					</Badge>
				</footer>
				<CommandPalette
					commands={commands}
					onClose={() => setPaletteOpen(false)}
					open={paletteOpen}
				/>
			</div>
		</AppShellContext.Provider>
	);
};
