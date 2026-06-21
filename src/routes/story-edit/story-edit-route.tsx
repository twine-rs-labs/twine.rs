import * as React from 'react';
import {useParams} from 'react-router-dom';
import {MainContent} from '../../components/container/main-content';
import {DocumentTitle} from '../../components/document-title/document-title';
import {DialogsContextProvider} from '../../dialogs';
import {usePrefsContext} from '../../store/prefs';
import {Passage, selectPassage, storyWithId} from '../../store/stories';
import {
	UndoableStoriesContextProvider,
	useUndoableStoriesContext
} from '../../store/undoable-stories';
import {MarqueeablePassageMap} from './marqueeable-passage-map';
import {PassageFuzzyFinder} from './passage-fuzzy-finder';
import {StoryEditToolbar} from './toolbar';
import {useInitialPassageCreation} from './use-initial-passage-creation';
import {usePassageChangeHandlers} from './use-passage-change-handlers';
import {useViewCenter} from './use-view-center';
import {useZoomShortcuts} from './use-zoom-shortcuts';
import {useZoomTransition} from './use-zoom-transition';
import {StoryWorkspaceShell} from './story-workspace-shell';
import {
	useStoryEditScrollMemory,
	useStoryEditWorkspace
} from './workspace-state';
import './story-edit-route.css';

export const InnerStoryEditRoute: React.FC = () => {
	const {storyId} = useParams<{storyId: string}>();
	const {prefs} = usePrefsContext();
	const {dispatch, stories} = useUndoableStoriesContext();
	const story = storyWithId(stories, storyId);
	const [fuzzyFinderOpen, setFuzzyFinderOpen] = React.useState(false);
	const mainContent = React.useRef<HTMLDivElement>(null);
	const workspace = useStoryEditWorkspace(story);
	const {getCenter, setCenter} = useViewCenter(story, mainContent);
	const {
		handleDeselectPassage,
		handleDragPassages,
		handleSelectPassage,
		handleSelectRect
	} = usePassageChangeHandlers(story);
	const visibleZoom = useZoomTransition(story.zoom, mainContent.current);

	useZoomShortcuts(story);
	useInitialPassageCreation(story, getCenter);
	useStoryEditScrollMemory(story.id, workspace.mode, mainContent);

	const handleChoosePassage = React.useCallback(
		(passage: Passage) => {
			workspace.setSelectedPassageId(passage.id);
			dispatch(selectPassage(story, passage, true));
		},
		[dispatch, story, workspace]
	);

	const handleEditPassage = React.useCallback(
		(passage: Passage) => {
			handleChoosePassage(passage);

			if (workspace.mode === 'graph') {
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

	return (
		<div className="story-edit-route">
			<DocumentTitle title={story.name} />
			<StoryEditToolbar
				bottomDrawerOpen={workspace.bottomDrawerOpen}
				getCenter={getCenter}
				leftDockCollapsed={workspace.leftDockCollapsed}
				mode={workspace.mode}
				onChangeBottomDrawerOpen={workspace.setBottomDrawerOpen}
				onChangeLeftDockCollapsed={workspace.setLeftDockCollapsed}
				onChangeMode={workspace.setMode}
				onChangeRightDockCollapsed={workspace.setRightDockCollapsed}
				onOpenFuzzyFinder={() => setFuzzyFinderOpen(true)}
				rightDockCollapsed={workspace.rightDockCollapsed}
				story={story}
			/>
			<MainContent
				grabbable={workspace.mode !== 'text'}
				padded={false}
				ref={mainContent}
			>
				<StoryWorkspaceShell
					bottomDrawerOpen={workspace.bottomDrawerOpen}
					graphPanel={
						<>
							<MarqueeablePassageMap
								container={mainContent}
								formatName={story.storyFormat}
								formatVersion={story.storyFormatVersion}
								onDeselect={handleDeselectPassage}
								onDrag={handleDragPassages}
								onEdit={handleEditPassage}
								onSelect={handleSelectPassageInMap}
								onSelectRect={handleSelectRect}
								passages={story.passages}
								startPassageId={story.startPassage}
								tagColors={story.tagColors}
								tagDisplay={prefs.passageTagDisplay}
								visibleZoom={visibleZoom}
								zoom={story.zoom}
							/>
							<PassageFuzzyFinder
								onClose={() => setFuzzyFinderOpen(false)}
								onOpen={() => setFuzzyFinderOpen(true)}
								open={fuzzyFinderOpen}
								setCenter={setCenter}
								story={story}
							/>
						</>
					}
					leftDockCollapsed={workspace.leftDockCollapsed}
					mode={workspace.mode}
					onChangeBottomDrawerOpen={workspace.setBottomDrawerOpen}
					onChangeLeftDockCollapsed={workspace.setLeftDockCollapsed}
					onChangeRightDockCollapsed={workspace.setRightDockCollapsed}
					onSelectPassage={handleChoosePassage}
					rightDockCollapsed={workspace.rightDockCollapsed}
					selectedPassageId={workspace.selectedPassageId}
					story={story}
				/>
			</MainContent>
		</div>
	);
};

// This is a separate component so that the inner one can use
// `useDialogsContext()` and `useUndoableStoriesContext()` inside it.

export const StoryEditRoute: React.FC = () => (
	<UndoableStoriesContextProvider>
		<DialogsContextProvider>
			<InnerStoryEditRoute />
		</DialogsContextProvider>
	</UndoableStoriesContextProvider>
);
