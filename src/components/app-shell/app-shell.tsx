import * as React from 'react';
import classNames from 'classnames';
import {useHistory, useLocation} from 'react-router-dom';
import {markSavedCommand, useCoreProjectHost} from '../../core';
import {storyFileName} from '../../electron/shared';
import {Story, useStoriesContext} from '../../store/stories';
import {usePublishing} from '../../store/use-publishing';
import {useStoryLaunch} from '../../store/use-story-launch';
import {saveHtml, saveTwee} from '../../util/save-file';
import {storyToTwee} from '../../util/twee';
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
	ShellToolbarRegistration
} from './app-shell-context';
import {CommandPalette} from './command-palette';
import './app-shell.css';

type BuildState = {
	error?: string;
	kind: 'idle' | 'busy' | 'done' | 'error';
	label: string;
};

interface RouteMode {
	icon: string;
	label: string;
}

function currentStoryId(pathname: string) {
	const match = pathname.match(/^\/stories\/([^/]+)/);

	return match ? decodeURIComponent(match[1]) : undefined;
}

function routeMode(pathname: string): RouteMode {
	if (pathname.startsWith('/new-project')) {
		return {icon: 'folder-plus', label: 'New Project'};
	}

	if (pathname.includes('/play')) {
		return {icon: 'player-play', label: 'Play'};
	}

	if (pathname.includes('/proof')) {
		return {icon: 'eyeglass', label: 'Proof'};
	}

	if (pathname.includes('/test')) {
		return {icon: 'tool', label: 'Test'};
	}

	if (pathname.startsWith('/stories/')) {
		return {icon: 'layout-columns', label: 'Edit'};
	}

	return {icon: 'files', label: 'Library'};
}

function storyWordCount(story: Story | undefined) {
	if (!story) {
		return 0;
	}

	return story.passages.reduce((count, passage) => {
		const text = passage.text.trim();

		return count + (text ? text.split(/\s+/).length : 0);
	}, 0);
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
	pathname: string,
	story: Story | undefined,
	mode: RouteMode
) {
	if (pathname === '/') {
		return ['Stories'];
	}

	if (pathname.startsWith('/new-project')) {
		return ['Stories', mode.label];
	}

	if (story) {
		return ['Stories', story.name, mode.label];
	}

	return [mode.label];
}

export const AppShell: React.FC = ({children}) => {
	const history = useHistory();
	const location = useLocation();
	const {stories} = useStoriesContext();
	const coreProjectHost = useCoreProjectHost();
	const {publishStory} = usePublishing();
	const {playStory, proofStory, testStory} = useStoryLaunch();
	const [paletteOpen, setPaletteOpen] = React.useState(false);
	const [drawerOpen, setDrawerOpen] = React.useState(false);
	const [toolbar, setToolbar] = React.useState<ShellToolbarRegistration>();
	const [activeToolbarTab, setActiveToolbarTab] = React.useState('');
	const [dirty, setDirty] = React.useState(() => coreProjectHost.isDirty());
	const [patchVersion, setPatchVersion] = React.useState(0);
	const markSavedQueued = React.useRef(false);
	const [buildState, setBuildState] = React.useState<BuildState>({
		kind: 'idle',
		label: 'Ready'
	});
	const storyId = currentStoryId(location.pathname);
	const selectedStory = stories.find(story => story.selected);
	const currentStory =
		stories.find(story => story.id === storyId) ?? selectedStory;
	const mode = routeMode(location.pathname);
	const routeTabs = React.useMemo(
		() => Object.keys(toolbar?.tabs ?? {}),
		[toolbar]
	);
	const storyIndex = React.useMemo(
		() =>
			currentStory ? coreProjectHost.queryStoryIndex(currentStory.id) : undefined,
		[coreProjectHost, currentStory, patchVersion]
	);
	const diagnosticCount = storyIndex?.diagnostics.length ?? 0;
	const wordCount = storyWordCount(currentStory);
	const crumbLabels = breadcrumbs(location.pathname, currentStory, mode);

	React.useEffect(() => {
		if (routeTabs.length === 0) {
			setActiveToolbarTab('');
			return;
		}

		setActiveToolbarTab(tab => (routeTabs.includes(tab) ? tab : routeTabs[0]));
	}, [routeTabs]);

	React.useEffect(() => {
		function queueMarkSaved() {
			if (markSavedQueued.current) {
				return;
			}

			markSavedQueued.current = true;
			Promise.resolve().then(() => {
				markSavedQueued.current = false;
				coreProjectHost.applyStoryCommand(markSavedCommand());
			});
		}

		const currentDirty = coreProjectHost.isDirty();

		setDirty(currentDirty);

		if (currentDirty) {
			queueMarkSaved();
		}

		return coreProjectHost.subscribeToPatches(batch => {
			let sawStoryIndexPatch = false;

			for (const patch of batch.patches) {
				if (patch.type === 'dirtyStateChanged') {
					setDirty(patch.dirty);

					if (patch.dirty) {
						queueMarkSaved();
					}
				} else if (patch.type === 'storyIndexUpdated') {
					sawStoryIndexPatch = true;
				}
			}

			if (sawStoryIndexPatch) {
				setPatchVersion(version => version + 1);
			}
		});
	}, [coreProjectHost, stories]);

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
			currentStory &&
			runBuildAction('Play', () => playStory(currentStory.id)),
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
			currentStory &&
			runBuildAction('Test', () => testStory(currentStory.id)),
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
			runBuildAction('Export Twee', () => {
				saveTwee(storyToTwee(currentStory), storyFileName(currentStory, '.twee'));
			}),
		[currentStory, runBuildAction]
	);

	const commands = React.useMemo<AppCommand[]>(() => {
		const allCommands: AppCommand[] = [
			{
				group: 'Navigation',
				icon: 'files',
				id: 'nav.library',
				label: 'Story Library',
				run: () => history.push('/'),
				shortcut: 'G L'
			},
			{
				group: 'Navigation',
				icon: 'folder-plus',
				id: 'nav.new-project',
				label: 'New Project',
				run: () => history.push('/new-project')
			},
			{
				disabled: !currentStory,
				group: 'Navigation',
				icon: 'layout-columns',
				id: 'nav.current-story',
				label: currentStory ? `Edit ${currentStory.name}` : 'Edit Story',
				run: () => currentStory && history.push(`/stories/${currentStory.id}`)
			},
			{
				disabled: !currentStory,
				group: 'Build',
				icon: 'tool',
				id: 'build.test',
				label: 'Test Story',
				run: runTest
			},
			{
				disabled: !currentStory,
				group: 'Build',
				icon: 'player-play',
				id: 'build.play',
				label: 'Play Story',
				run: runPlay
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
				run: () => history.push(`/stories/${story.id}`)
			}))
		];

		return allCommands;
	}, [
		activeToolbarTab,
		currentStory,
		history,
		routeTabs,
		runExportHtml,
		runExportTwee,
		runPlay,
		runProof,
		runTest,
		stories
	]);

	const buildBadgeTone =
		buildState.kind === 'error'
			? 'error'
			: buildState.kind === 'busy'
				? 'build'
				: 'saved';

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
						<div className="app-shell__brand" aria-label="Twine">
							<span className="app-shell__brand-mark">
								<TablerIcon icon="writing" />
							</span>
							<span className="app-shell__brand-text">Twine</span>
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
						aria-current={location.pathname === '/' ? 'page' : undefined}
						className="app-shell__rail-button"
						onClick={() => history.push('/')}
						title="Stories"
						type="button"
					>
						<TablerIcon icon="files" />
					</button>
					<button
						aria-current={
							location.pathname.startsWith('/stories/') ? 'page' : undefined
						}
						className="app-shell__rail-button"
						disabled={!currentStory}
						onClick={() =>
							currentStory && history.push(`/stories/${currentStory.id}`)
						}
						title="Workbench"
						type="button"
					>
						<TablerIcon icon="layout-columns" />
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
						className="app-shell__rail-button"
						disabled={!currentStory}
						onClick={() => setDrawerOpen(open => !open)}
						title="Diagnostics"
						type="button"
					>
						<TablerIcon icon={diagnosticCount > 0 ? 'alert-triangle' : 'bug'} />
						{diagnosticCount > 0 && (
							<span className="app-shell__rail-count">{diagnosticCount}</span>
						)}
					</button>
					<button
						aria-current={
							location.pathname.startsWith('/new-project') ? 'page' : undefined
						}
						className="app-shell__rail-button"
						onClick={() => history.push('/new-project')}
						title="New Project"
						type="button"
					>
						<TablerIcon icon="folder-plus" />
					</button>
				</nav>
				<main className="app-shell__center">
					<div className="app-shell__route">{children}</div>
				</main>
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
							{storyIndex && storyIndex.diagnostics.length > 0 ? (
								storyIndex.diagnostics.slice(0, 8).map(diagnostic => (
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
													: 'alert-triangle'
											}
											tone={
												diagnostic.severity === 'error' ? 'error' : 'warn'
											}
										>
											{diagnostic.code}
										</Badge>
										<span>{diagnostic.message}</span>
									</div>
								))
							) : (
								<div className="app-shell__drawer-empty">
									No diagnostics for {currentStory?.name ?? 'this workspace'}
								</div>
							)}
						</div>
					</aside>
				)}
				<footer className="app-shell__status" aria-live="polite">
					<span className="app-shell__status-item">
						<TablerIcon icon={mode.icon} />
						{mode.label}
					</span>
					<span className="app-shell__status-item">
						<TablerIcon icon="focus-2" />
						{storySelectionLabel(currentStory)}
					</span>
					<span className="app-shell__status-item">
						<TablerIcon icon={dirty ? 'database-import' : 'database'} />
						{dirty ? 'Saving' : 'Saved'}
					</span>
					<button
						className="app-shell__status-item app-shell__status-button"
						onClick={() => setDrawerOpen(open => !open)}
						type="button"
					>
						<TablerIcon
							icon={diagnosticCount > 0 ? 'alert-triangle' : 'circle-check'}
						/>
						{diagnosticCount} diagnostics
					</button>
					<span className="app-shell__status-spacer" />
					<span className="app-shell__status-item">{wordCount} words</span>
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
