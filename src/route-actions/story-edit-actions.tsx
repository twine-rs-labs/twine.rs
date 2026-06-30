import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {useAppShellContext} from '../components/app-shell';
import {IconButton, SegmentedControl} from '../components/design-system';
import {useDialogsContext} from '../dialogs';
import {Passage, Story} from '../store/stories';
import {Point} from '../util/geometry';
import {StoryEditMode} from '../routes/story-edit/workspace-state';
import {AppActions} from './app-actions';
import {BuildActions} from './build-actions';
import {PassageActions} from './story-edit/passage/passage-actions';
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
	rightDockCollapsed?: boolean;
	story: Story;
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
		rightDockCollapsed = false,
		story
	} = props;
	const {t} = useTranslation();
	const appShell = useAppShellContext();
	const {dispatch: dialogsDispatch} = useDialogsContext();
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
		() => ({
			[t('common.passage')]: (
				<PassageActions
					getCenter={getCenter}
					onEditPassages={onEditPassages}
					onOpenFuzzyFinder={onOpenFuzzyFinder}
					story={story}
				/>
			),
			[t('common.story')]: (
				<StoryActions dialogsDispatch={dialogsDispatch} story={story} />
			),
			[t('common.build')]: <BuildActions story={story} />,
			[t('common.appName')]: <AppActions dialogsDispatch={dialogsDispatch} />
		}),
		[dialogsDispatch, getCenter, onEditPassages, onOpenFuzzyFinder, story, t]
	);

	React.useEffect(() => {
		if (!appShell.inShell) {
			return;
		}

		appShell.setToolbar({
			helpUrl: 'https://twinery.org/2guide',
			pinnedControls,
			tabs
		});

		return () => appShell.setToolbar(undefined);
	}, [appShell, pinnedControls, tabs]);

	return null;
};
