import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton, SegmentedControl} from '../../../components/design-system';
import {RouteToolbar} from '../../../components/route-toolbar';
import {AppActions, BuildActions} from '../../../route-actions';
import {Story} from '../../../store/stories';
import {Point} from '../../../util/geometry';
import {StoryEditMode} from '../workspace-state';
import {PassageActions} from './passage/passage-actions';
import {StoryActions} from './story/story-actions';
import {UndoRedoButtons} from './undo-redo-buttons';
import {ZoomButtons} from './zoom-buttons';

export interface StoryEditToolbarProps {
	bottomDrawerOpen?: boolean;
	getCenter: () => Point;
	leftDockCollapsed?: boolean;
	mode?: StoryEditMode;
	onChangeBottomDrawerOpen?: (value: boolean) => void;
	onChangeLeftDockCollapsed?: (value: boolean) => void;
	onChangeMode?: (mode: StoryEditMode) => void;
	onChangeRightDockCollapsed?: (value: boolean) => void;
	onOpenFuzzyFinder: () => void;
	rightDockCollapsed?: boolean;
	story: Story;
}

export const StoryEditToolbar: React.FC<StoryEditToolbarProps> = props => {
	const {
		bottomDrawerOpen = false,
		getCenter,
		leftDockCollapsed = false,
		mode = 'graph',
		onChangeBottomDrawerOpen,
		onChangeLeftDockCollapsed,
		onChangeMode,
		onChangeRightDockCollapsed,
		onOpenFuzzyFinder,
		rightDockCollapsed = false,
		story
	} = props;
	const {t} = useTranslation();
	const modeButtons: {
		icon: string;
		label: string;
		mode: StoryEditMode;
	}[] = [
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
	];

	return (
		<RouteToolbar
			pinnedControls={
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
					{mode !== 'text' && <ZoomButtons story={story} />}
					<UndoRedoButtons />
				</>
			}
			tabs={{
				[t('common.passage')]: (
					<PassageActions
						getCenter={getCenter}
						onOpenFuzzyFinder={onOpenFuzzyFinder}
						story={story}
					/>
				),
				[t('common.story')]: <StoryActions story={story} />,
				[t('common.build')]: <BuildActions story={story} />,
				[t('common.appName')]: <AppActions />
			}}
		/>
	);
};
