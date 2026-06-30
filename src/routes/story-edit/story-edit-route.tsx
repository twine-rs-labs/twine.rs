import * as React from 'react';
import {Redirect, useLocation, useParams} from 'react-router-dom';
import {MainContent} from '../../components/container/main-content';
import {DocumentTitle} from '../../components/document-title/document-title';
import {DialogsContextProvider} from '../../dialogs';
import {useDialogsContext} from '../../dialogs/context';
import {StorySearchDialog} from '../../dialogs/story-search';
import {StoryEditActions} from '../../route-actions';
import {
	Passage,
	selectPassage,
	Story,
	useStoriesContext
} from '../../store/stories';
import {useStoryLaunch} from '../../store/use-story-launch';
import {
	EditorWindowSpec,
	editorWindowId,
	editorWindowsEqual
} from './editor-window-spec';
import {PassageFuzzyFinder} from './passage-fuzzy-finder';
import {StoryGraphPanel} from './story-graph-panel';
import {useInitialPassageCreation} from './use-initial-passage-creation';
import {usePassageChangeHandlers} from './use-passage-change-handlers';
import {useViewCenter} from './use-view-center';
import {StoryWorkspaceShell} from './story-workspace-shell';
import {
	useStoryEditScrollMemory,
	useStoryEditWorkspace
} from './workspace-state';
import {
	resolveSourceNavigationTarget,
	sourceNavigationTargetFromQuery,
	type SourceNavigationTarget
} from './source-navigation';
import './story-edit-route.css';

function parsedInteger(value: string | null, minimum: number) {
	if (value === null || !/^\d+$/.test(value)) {
		return undefined;
	}

	return Math.max(minimum, Number(value));
}

function sourceTextForTarget(story: Story, target: SourceNavigationTarget) {
	if (target.kind === 'script') {
		return story.script;
	}

	if (target.kind === 'stylesheet') {
		return story.stylesheet;
	}

	return story.passages.find(passage => passage.id === target.passageId)?.text;
}

function sourcePositionForQuery(
	story: Story,
	target: SourceNavigationTarget,
	offsetValue: string | null,
	lineValue: string | null
) {
	const sourceText = sourceTextForTarget(story, target);

	if (sourceText === undefined) {
		return undefined;
	}

	const offset = parsedInteger(offsetValue, 0);

	if (offset !== undefined) {
		return Math.min(offset, sourceText.length);
	}

	const line = parsedInteger(lineValue, 1);

	if (line === undefined) {
		return undefined;
	}

	let lineStart = 0;

	for (let currentLine = 1; currentLine < line; currentLine++) {
		const nextLineStart = sourceText.indexOf('\n', lineStart);

		if (nextLineStart === -1) {
			return sourceText.length;
		}

		lineStart = nextLineStart + 1;
	}

	return lineStart;
}

const StoryEditRouteForStory: React.FC<{story: Story}> = ({story}) => {
	const location = useLocation();
	const {dispatch: dialogsDispatch} = useDialogsContext();
	const {dispatch} = useStoriesContext();
	const {testStory} = useStoryLaunch();
	const [fuzzyFinderOpen, setFuzzyFinderOpen] = React.useState(false);
	const [graphRevealRequest, setGraphRevealRequest] = React.useState({
		key: 0,
		passageId: ''
	});
	const [revealRequests, setRevealRequests] = React.useState(
		() => new Map<string, {key: number; position?: number}>()
	);
	const [searchRequests, setSearchRequests] = React.useState(
		() => new Map<string, {key: number; query?: string}>()
	);
	const mainContent = React.useRef<HTMLDivElement>(null);
	const workspace = useStoryEditWorkspace(story);
	const {getCenter, setCenter} = useViewCenter(story, mainContent);
	const {
		handleCreatePassage,
		handleDeselectPassage,
		handleSelectPassage,
		handleSelectPassageIds
	} = usePassageChangeHandlers(story);
	const handledRevealQuery = React.useRef('');

	useInitialPassageCreation(story, getCenter);
	useStoryEditScrollMemory(story.id, workspace.mode, mainContent);

	const editorWindowsRef = React.useRef(workspace.editorWindows);
	editorWindowsRef.current = workspace.editorWindows;

	const handleChoosePassage = React.useCallback(
		(passage: Passage) => {
			workspace.setSelectedPassageId(passage.id);
			dispatch(selectPassage(story, passage, true));
		},
		[dispatch, story, workspace]
	);

	// The dock list with the implicit "follow selection" view materialized, so
	// open/close/reorder always operate on a concrete list.
	const materializedWindows = React.useCallback(
		(selectedId = workspace.selectedPassageId): EditorWindowSpec[] => {
			if (editorWindowsRef.current) {
				return editorWindowsRef.current;
			}

			return selectedId ? [{kind: 'passage', passageId: selectedId}] : [];
		},
		[workspace.selectedPassageId]
	);

	const openEditorWindow = React.useCallback(
		(spec: EditorWindowSpec) => {
			workspace.setEditorWindows(current => {
				const list = current ?? materializedWindows();

				return list.some(window_ => editorWindowsEqual(window_, spec))
					? list
					: [...list, spec];
			});
			workspace.setActiveWindowId(editorWindowId(spec));

			if (spec.kind === 'passage') {
				workspace.setSelectedPassageId(spec.passageId);
			}

			if (workspace.mode === 'graph') {
				workspace.setMode('split');
			}
		},
		[materializedWindows, workspace]
	);

	const handleEditPassage = React.useCallback(
		(passage: Passage) => {
			openEditorWindow({kind: 'passage', passageId: passage.id});
		},
		[openEditorWindow]
	);
	const handleEditPassages = React.useCallback(
		(passages: Passage[]) => {
			if (passages.length === 0) {
				return;
			}

			const specs = passages.map(
				(passage): EditorWindowSpec => ({
					kind: 'passage',
					passageId: passage.id
				})
			);

			workspace.setEditorWindows(current => {
				const next = [...(current ?? materializedWindows())];

				for (const spec of specs) {
					if (!next.some(window_ => editorWindowsEqual(window_, spec))) {
						next.push(spec);
					}
				}

				return next;
			});
			workspace.setSelectedPassageId(passages[0].id);
			workspace.setActiveWindowId(editorWindowId(specs[0]));

			if (workspace.mode === 'graph') {
				workspace.setMode('split');
			}
		},
		[materializedWindows, workspace]
	);
	const handleCloseEditorWindow = React.useCallback(
		(spec: EditorWindowSpec) => {
			const id = editorWindowId(spec);
			const next = materializedWindows().filter(
				window_ => !editorWindowsEqual(window_, spec)
			);

			workspace.setEditorWindows(next);
			workspace.setActiveWindowId(current =>
				current === id
					? next.length
						? editorWindowId(next[next.length - 1])
						: undefined
					: current
			);

			if (next.length === 0 && workspace.mode === 'split') {
				workspace.setMode('graph');
			}
		},
		[materializedWindows, workspace]
	);
	const handleFocusEditorWindow = React.useCallback(
		(id: string) => {
			workspace.setActiveWindowId(id);

			if (id.startsWith('passage:')) {
				workspace.setSelectedPassageId(id.slice('passage:'.length));
			}
		},
		[workspace]
	);
	const handleReorderEditorWindows = React.useCallback(
		(from: number, to: number) => {
			const list = [...materializedWindows()];
			const [moved] = list.splice(from, 1);

			if (!moved) {
				return;
			}

			list.splice(to, 0, moved);
			workspace.setEditorWindows(list);
		},
		[materializedWindows, workspace]
	);
	const handleRevealPassageInGraph = React.useCallback(
		(passage: Passage) => {
			handleChoosePassage(passage);
			setGraphRevealRequest(current => ({
				key: current.key + 1,
				passageId: passage.id
			}));

			if (workspace.mode === 'text') {
				workspace.setMode('split');
			}
		},
		[handleChoosePassage, workspace]
	);
	const handleSelectPassageInMap = React.useCallback(
		(passage: Passage, exclusive: boolean) => {
			workspace.setSelectedPassageId(passage.id);
			handleSelectPassage(passage, exclusive);
		},
		[handleSelectPassage, workspace]
	);
	const handleTestPassage = React.useCallback(
		(passage: Passage) => {
			void testStory(story.id, passage.id);
		},
		[story.id, testStory]
	);

	React.useEffect(() => {
		if (!location.search || handledRevealQuery.current === location.search) {
			return;
		}

		const search = new URLSearchParams(location.search);
		const mode = search.get('mode');
		const passageId = search.get('passage');
		const query = search.get('q')?.trim();
		const target =
			sourceNavigationTargetFromQuery(search.get('source')) ??
			(passageId ? ({kind: 'passage', passageId} as const) : undefined);
		const {spec, target: resolvedTarget} = resolveSourceNavigationTarget(
			story,
			target
		);
		const passage =
			resolvedTarget?.kind === 'passage'
				? story.passages.find(
						passage => passage.id === resolvedTarget.passageId
					)
				: undefined;
		const revealPosition = resolvedTarget
			? sourcePositionForQuery(
					story,
					resolvedTarget,
					search.get('offset'),
					search.get('line')
				)
			: undefined;

		handledRevealQuery.current = location.search;

		if (mode === 'text' || mode === 'graph' || mode === 'split') {
			workspace.setMode(mode);
		}

		if (mode === 'graph' && passage) {
			handleChoosePassage(passage);
			setGraphRevealRequest(current => ({
				key: current.key + 1,
				passageId: passage.id
			}));
			return;
		}

		if (spec) {
			openEditorWindow(spec);

			if (passage) {
				handleChoosePassage(passage);
			}

			const windowId = editorWindowId(spec);

			if (revealPosition !== undefined) {
				setRevealRequests(current => {
					const next = new Map(current);
					const previous = current.get(windowId);

					next.set(windowId, {
						key: (previous?.key ?? 0) + 1,
						position: revealPosition
					});
					return next;
				});
			}

			if (query) {
				setSearchRequests(current => {
					const next = new Map(current);
					const previous = current.get(windowId);

					next.set(windowId, {
						key: (previous?.key ?? 0) + 1,
						query
					});
					return next;
				});
			}
			return;
		}

		if (query) {
			dialogsDispatch({
				type: 'addDialog',
				component: StorySearchDialog,
				props: {
					find: query,
					flags: {
						includePassageNames: false,
						matchCase: false,
						useRegexes: false
					},
					replace: '',
					storyId: story.id
				}
			});
		}
	}, [
		dialogsDispatch,
		handleChoosePassage,
		location.search,
		openEditorWindow,
		story,
		workspace
	]);

	return (
		<div className="story-edit-route">
			<DocumentTitle title={story.name} />
			<StoryEditActions
				bottomDrawerOpen={workspace.bottomDrawerOpen}
				getCenter={getCenter}
				leftDockCollapsed={workspace.leftDockCollapsed}
				mode={workspace.mode}
				onChangeBottomDrawerOpen={workspace.setBottomDrawerOpen}
				onChangeLeftDockCollapsed={workspace.setLeftDockCollapsed}
				onChangeMode={workspace.setMode}
				onChangeRightDockCollapsed={workspace.setRightDockCollapsed}
				onEditPassages={handleEditPassages}
				onOpenFuzzyFinder={() => setFuzzyFinderOpen(true)}
				rightDockCollapsed={workspace.rightDockCollapsed}
				story={story}
			/>
			<MainContent grabbable={false} padded={false} ref={mainContent}>
				<StoryWorkspaceShell
					bottomDrawerOpen={workspace.bottomDrawerOpen}
					editorDockLayout={workspace.editorDockLayout}
					graphPanel={
						<StoryGraphPanel
							graphOptions={workspace.graphOptions}
							graphView={workspace.graphView}
							onCreate={handleCreatePassage}
							onGraphOptionsChange={workspace.setGraphOptions}
							onGraphViewChange={workspace.setGraphView}
							onDeselect={handleDeselectPassage}
							onEdit={handleEditPassage}
							onEditPassages={handleEditPassages}
							onSelect={handleSelectPassageInMap}
							onSelectIds={handleSelectPassageIds}
							onTestPassage={handleTestPassage}
							revealPassageId={graphRevealRequest.passageId}
							revealRequestKey={graphRevealRequest.key}
							selectedPassageId={workspace.selectedPassageId}
							story={story}
						/>
					}
					leftDockCollapsed={workspace.leftDockCollapsed}
					mode={workspace.mode}
					activeWindowId={workspace.activeWindowId}
					editorWindows={workspace.editorWindows}
					onChangeBottomDrawerOpen={workspace.setBottomDrawerOpen}
					onChangeEditorDockLayout={workspace.setEditorDockLayout}
					onChangeLeftDockCollapsed={workspace.setLeftDockCollapsed}
					onChangeRightDockCollapsed={workspace.setRightDockCollapsed}
					onCloseEditorWindow={handleCloseEditorWindow}
					onFocusEditorWindow={handleFocusEditorWindow}
					onOpenEditorWindow={openEditorWindow}
					onReorderEditorWindows={handleReorderEditorWindows}
					onRevealPassageInGraph={handleRevealPassageInGraph}
					onSelectPassage={handleChoosePassage}
					onTestPassage={handleTestPassage}
					overlay={
						<PassageFuzzyFinder
							onClose={() => setFuzzyFinderOpen(false)}
							onOpen={() => setFuzzyFinderOpen(true)}
							onRevealPassageInGraph={handleRevealPassageInGraph}
							onTestPassage={handleTestPassage}
							open={fuzzyFinderOpen}
							setCenter={setCenter}
							story={story}
						/>
					}
					revealRequests={revealRequests}
					rightDockCollapsed={workspace.rightDockCollapsed}
					searchRequests={searchRequests}
					selectedPassageId={workspace.selectedPassageId}
					story={story}
				/>
			</MainContent>
		</div>
	);
};

export const InnerStoryEditRoute: React.FC = () => {
	const {storyId} = useParams<{storyId: string}>();
	const {stories} = useStoriesContext();
	const story = stories.find(candidate => candidate.id === storyId);

	return story ? <StoryEditRouteForStory story={story} /> : <Redirect to="/" />;
};

// This is a separate component so that the inner one can use dialog context.

export const StoryEditRoute: React.FC = () => (
	<DialogsContextProvider>
		<InnerStoryEditRoute />
	</DialogsContextProvider>
);
