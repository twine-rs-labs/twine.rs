import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {
	useAppCommandContribution,
	useAppShellContext
} from '../components/app-shell';
import {IconButton, SegmentedControl} from '../components/design-system';
import {PassageRenamePrompt} from '../components/passage/rename-passage-button';
import {PassageRenameReview} from '../components/passage/passage-rename-review';
import {useCoreProjectHost} from '../core';
import {DialogsContextProvider} from '../dialogs';
import {twineRsDocumentationUrl} from '../electron/shared';
import {Passage, Story} from '../store/stories';
import {Point} from '../util/geometry';
import {StoryEditMode} from '../routes/story-edit/workspace-state';
import {AppActions} from './app-actions';
import {BuildActions} from './build-actions';
import {PassageActions} from './story-edit/passage/passage-actions';
import {usePassageRenameReview} from './story-edit/passage/use-passage-rename-review';
import {StoryActions} from './story-edit/story/story-actions';
import {UndoRedoButtons} from './story-edit/undo-redo-buttons';
import {ZoomButtons} from './story-edit/zoom-buttons';

export interface StoryEditActionsProps {
	bottomDrawerOpen?: boolean;
	getCenter: () => Point;
	leftDockCollapsed?: boolean;
	mode?: StoryEditMode;
	onChangeBottomDrawerOpen?: (value: boolean) => void;
	onChangeLeftDockCollapsed?: (value: boolean) => void;
	onChangeMode?: (mode: StoryEditMode) => void;
	onChangeRightDockCollapsed?: (value: boolean) => void;
	onEditPassages: (passages: Passage[]) => void;
	onOpenFuzzyFinder: () => void;
	onOpenEditorWindow?: (kind: 'script' | 'stylesheet') => void;
	onOpenWorkbenchPanel?: (
		id: 'find-replace' | 'story-details' | 'passage-tags'
	) => void;
	onTestPassage?: (passage: Passage) => void;
	rightDockCollapsed?: boolean;
	story: Story;
	testPassagePending?: boolean;
	testPassagePendingId?: string;
}

export const StoryEditActions: React.FC<StoryEditActionsProps> = props => {
	const {
		bottomDrawerOpen = false,
		getCenter,
		leftDockCollapsed = false,
		mode = 'graph',
		onChangeBottomDrawerOpen,
		onChangeLeftDockCollapsed,
		onChangeMode,
		onChangeRightDockCollapsed,
		onEditPassages,
		onOpenFuzzyFinder,
		onOpenEditorWindow,
		onOpenWorkbenchPanel,
		onTestPassage,
		rightDockCollapsed = false,
		story,
		testPassagePending = false,
		testPassagePendingId
	} = props;
	const {t} = useTranslation();
	const appShell = useAppShellContext();
	const coreProjectHost = useCoreProjectHost();
	const [renamePromptPassageId, setRenamePromptPassageId] = React.useState<
		string | undefined
	>();
	const [renameReview, setRenameReview] = React.useState<
		| {
				afterName: string;
				passage: Passage;
				passageId: string;
				storyId: string;
		  }
		| undefined
	>();
	const renameFocusRestore = React.useRef<(() => void) | undefined>(undefined);
	const selectedPassages = React.useMemo(
		() => story.passages.filter(passage => passage.selected),
		[story.passages]
	);
	const soloSelectedPassage = React.useMemo(
		() => (selectedPassages.length === 1 ? selectedPassages[0] : undefined),
		[selectedPassages]
	);
	const renamePromptPassage = React.useMemo(
		() => story.passages.find(passage => passage.id === renamePromptPassageId),
		[renamePromptPassageId, story.passages]
	);
	const restoreRenameFocus = React.useCallback(() => {
		const restore = renameFocusRestore.current;
		renameFocusRestore.current = undefined;
		restore?.();
	}, []);
	const handleReviewApplied = React.useCallback(() => {
		setRenameReview(undefined);
		restoreRenameFocus();
	}, [restoreRenameFocus]);
	const reviewController = usePassageRenameReview(
		renameReview,
		handleReviewApplied
	);
	const closeRenameReview = React.useCallback(() => {
		reviewController.closeBoundary();
		setRenameReview(undefined);
		restoreRenameFocus();
	}, [restoreRenameFocus, reviewController.closeBoundary]);
	const beginRenameReview = React.useCallback(
		(name: string, passage: Passage, restoreFocus?: () => void) => {
			if (restoreFocus) renameFocusRestore.current = restoreFocus;
			setRenamePromptPassageId(undefined);
			setRenameReview({
				afterName: name,
				passage,
				passageId: passage.id,
				storyId: story.id
			});
		},
		[story.id]
	);

	React.useEffect(() => {
		if (
			(renamePromptPassageId !== undefined &&
				renamePromptPassageId !== soloSelectedPassage?.id) ||
			(renameReview &&
				(renameReview.storyId !== story.id ||
					renameReview.passage.id !== soloSelectedPassage?.id ||
					!story.passages.some(
						passage => passage.id === renameReview.passage.id
					)))
		) {
			setRenamePromptPassageId(undefined);
			if (renameReview) reviewController.closeBoundary();
			setRenameReview(undefined);
			renameFocusRestore.current = undefined;
		}
	}, [
		renamePromptPassageId,
		renameReview,
		reviewController.closeBoundary,
		soloSelectedPassage,
		story.id,
		story.passages
	]);

	useAppCommandContribution('story-edit.passage-commands', [
		{
			contextKey: `${story.id}:${soloSelectedPassage?.id ?? 'none'}:${coreProjectHost.sessionStatus(story.id).revision}`,
			disabled: !soloSelectedPassage,
			disabledReason: soloSelectedPassage
				? undefined
				: 'Select exactly one passage to rename',
			group: 'Toolbar',
			icon: 'pencil',
			id: 'story-edit.rename-active-passage',
			label: 'Rename Active Passage',
			priority: 20,
			run: context => {
				if (soloSelectedPassage) {
					renameFocusRestore.current = context?.restoreFocus;
					setRenamePromptPassageId(soloSelectedPassage.id);
				}
			}
		}
	]);
	const modeButtons = React.useMemo<
		{
			icon: string;
			label: string;
			mode: StoryEditMode;
		}[]
	>(
		() => [
			{
				icon: 'file-text',
				label: t('routes.storyEdit.workspace.textMode'),
				mode: 'text'
			},
			{
				icon: 'binary-tree',
				label: t('routes.storyEdit.workspace.graphMode'),
				mode: 'graph'
			},
			{
				icon: 'layout-columns',
				label: t('routes.storyEdit.workspace.splitMode'),
				mode: 'split'
			}
		],
		[t]
	);
	const pinnedControls = React.useMemo(
		() => (
			<>
				<div
					aria-label={t('routes.storyEdit.workspace.modeControls')}
					className="story-edit-mode-controls"
					role="group"
				>
					<SegmentedControl
						onChange={value => onChangeMode?.(value as StoryEditMode)}
						options={modeButtons.map(button => ({
							icon: button.icon,
							label: button.label,
							value: button.mode
						}))}
						size="sm"
						value={mode}
					/>
				</div>
				<div className="story-edit-dock-controls">
					<IconButton
						icon={
							leftDockCollapsed
								? 'layout-sidebar-left-expand'
								: 'layout-sidebar-left-collapse'
						}
						label={t(
							leftDockCollapsed
								? 'routes.storyEdit.workspace.expandLeftDock'
								: 'routes.storyEdit.workspace.collapseLeftDock'
						)}
						onClick={() => onChangeLeftDockCollapsed?.(!leftDockCollapsed)}
					/>
					<IconButton
						icon={
							bottomDrawerOpen
								? 'layout-bottombar-collapse'
								: 'layout-bottombar-expand'
						}
						label={t(
							bottomDrawerOpen
								? 'routes.storyEdit.workspace.closeBottomDrawer'
								: 'routes.storyEdit.workspace.openBottomDrawer'
						)}
						onClick={() => onChangeBottomDrawerOpen?.(!bottomDrawerOpen)}
					/>
					<IconButton
						icon={
							rightDockCollapsed
								? 'layout-sidebar-right-expand'
								: 'layout-sidebar-right-collapse'
						}
						label={t(
							rightDockCollapsed
								? 'routes.storyEdit.workspace.expandRightDock'
								: 'routes.storyEdit.workspace.collapseRightDock'
						)}
						onClick={() => onChangeRightDockCollapsed?.(!rightDockCollapsed)}
					/>
				</div>
				<div
					className={classNames(
						'story-edit-zoom-slot',
						mode === 'text' && 'story-edit-zoom-slot--empty'
					)}
				>
					{mode !== 'text' && <ZoomButtons story={story} />}
				</div>
				<UndoRedoButtons storyId={story.id} />
			</>
		),
		[
			bottomDrawerOpen,
			leftDockCollapsed,
			mode,
			modeButtons,
			onChangeBottomDrawerOpen,
			onChangeLeftDockCollapsed,
			onChangeMode,
			onChangeRightDockCollapsed,
			rightDockCollapsed,
			story,
			t
		]
	);
	const tabs = React.useMemo(
		() => [
			{
				content: (
					<PassageActions
						getCenter={getCenter}
						onEditPassages={onEditPassages}
						onOpenFuzzyFinder={onOpenFuzzyFinder}
						onRenamePassage={beginRenameReview}
						onTestPassage={onTestPassage}
						story={story}
						testPassagePending={testPassagePending}
						testPassagePendingId={testPassagePendingId}
					/>
				),
				id: 'passage',
				label: t('common.passage')
			},
			{
				content: (
					<StoryActions
						onOpenEditorWindow={onOpenEditorWindow}
						onOpenWorkbenchPanel={onOpenWorkbenchPanel}
						story={story}
					/>
				),
				id: 'story',
				label: t('common.story')
			},
			{
				content: <BuildActions story={story} />,
				id: 'build',
				label: t('common.build')
			},
			// App-owned dialogs deliberately keep their own local dialog host. The
			// story workbench no longer provides a dialog surface for project editing.
			{
				content: (
					<DialogsContextProvider>
						<AppActions />
					</DialogsContextProvider>
				),
				id: 'app',
				label: t('common.appName')
			}
		],
		[
			beginRenameReview,
			getCenter,
			onEditPassages,
			onOpenEditorWindow,
			onOpenFuzzyFinder,
			onOpenWorkbenchPanel,
			onTestPassage,
			story,
			testPassagePending,
			testPassagePendingId,
			t
		]
	);

	React.useEffect(() => {
		if (!appShell.inShell) {
			return;
		}

		appShell.setToolbar({
			helpUrl: twineRsDocumentationUrl,
			pinnedControls,
			tabs
		});

		return () => appShell.setToolbar(undefined);
	}, [appShell, pinnedControls, tabs]);

	return (
		<>
			{renamePromptPassage && (
				<PassageRenamePrompt
					onCancel={() => {
						setRenamePromptPassageId(undefined);
						restoreRenameFocus();
					}}
					onRename={name => beginRenameReview(name, renamePromptPassage)}
					open
					passage={renamePromptPassage}
					story={story}
				/>
			)}
			{renameReview?.storyId === story.id && (
				<PassageRenameReview
					afterName={renameReview.afterName}
					applying={reviewController.applying}
					cursor={reviewController.cursor}
					error={reviewController.error}
					onApply={reviewController.handleApply}
					onClose={closeRenameReview}
					onNextPage={reviewController.handleNextPage}
					onPreviousPage={reviewController.handlePreviousPage}
					onRetry={reviewController.handleRetry}
					page={reviewController.page}
					passage={renameReview.passage}
					progress={reviewController.progress}
					showPreviousPage={reviewController.showPreviousPage}
					story={story}
					summary={reviewController.summary}
				/>
			)}
		</>
	);
};
