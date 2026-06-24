import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {Badge, Button, TablerIcon} from '../../components/design-system';
import type {CoreStoryIndex, WorkbenchSelection} from '../../core';
import {Passage, Story} from '../../store/stories';
import {EditorWindow} from './editor-window';
import {EditorWindowSpec, editorWindowId} from './editor-window-spec';

export interface EditorDockProps {
	activeId?: string;
	compact?: boolean;
	index: CoreStoryIndex;
	onClose: (spec: EditorWindowSpec) => void;
	onFocus: (id: string) => void;
	onOpen: (spec: EditorWindowSpec) => void;
	onReorder: (from: number, to: number) => void;
	onRevealPassageInGraph?: (passage: Passage) => void;
	onSelectPassage?: (passage: Passage) => void;
	onTestPassage?: (passage: Passage) => void;
	revealRequests?: Map<string, {key: number; position?: number}>;
	searchRequests?: Map<string, {key: number; query?: string}>;
	selectedPassageId?: string;
	selections: Map<string, WorkbenchSelection>;
	story: Story;
	windows: EditorWindowSpec[];
}

// Tile in a 2-D grid when the dock has full width; stack vertically in the
// narrow Split column (width is the scarce axis there). Same component, space
// aware — see WORKBENCH_INTEGRATION.md.
function columnsForCount(count: number, compact: boolean) {
	if (compact) {
		return 1;
	}

	if (count <= 1) {
		return 1;
	}

	return count <= 4 ? 2 : 3;
}

export const EditorDock: React.FC<EditorDockProps> = props => {
	const {
		activeId,
		compact,
		index,
		onClose,
		onFocus,
		onOpen,
		onReorder,
		onRevealPassageInGraph,
		onSelectPassage,
		onTestPassage,
		revealRequests,
		searchRequests,
		selectedPassageId,
		selections,
		story
	} = props;
	const {t} = useTranslation();
	const [openMenu, setOpenMenu] = React.useState(false);
	const [dragIndex, setDragIndex] = React.useState<number>();
	const [overIndex, setOverIndex] = React.useState<number>();
	const windows = props.windows;
	const selectedPassage = selectedPassageId
		? story.passages.find(passage => passage.id === selectedPassageId)
		: undefined;
	const issueCount = index.diagnostics.length;

	const columns = columnsForCount(windows.length, !!compact);

	return (
		<div
			className={classNames('story-edit-editor-dock', {
				'is-compact': compact
			})}
		>
			{/* Story-level chrome — ONCE, never repeated per window. */}
			<div className="story-edit-editor-dock-chrome">
				<div className="story-edit-editor-dock-open">
					<Button
						icon="plus"
						iconRight="chevron-down"
						onClick={() => setOpenMenu(open => !open)}
						size="sm"
						variant="ghost"
					>
						{t('routes.storyEdit.workspace.openEditor')}
					</Button>
					{openMenu && (
						<div
							className="story-edit-editor-dock-open-menu"
							onMouseLeave={() => setOpenMenu(false)}
						>
							<button
								disabled={!selectedPassage}
								onClick={() => {
									if (selectedPassage) {
										onOpen({kind: 'passage', passageId: selectedPassage.id});
									}

									setOpenMenu(false);
								}}
								type="button"
							>
								<TablerIcon icon="file-text" />
								{selectedPassage
									? selectedPassage.name
									: t('routes.storyEdit.workspace.noPassages')}
							</button>
							<button
								onClick={() => {
									onOpen({kind: 'script'});
									setOpenMenu(false);
								}}
								type="button"
							>
								<TablerIcon icon="braces" />
								{t('routes.storyEdit.toolbar.javaScript')}
							</button>
							<button
								onClick={() => {
									onOpen({kind: 'stylesheet'});
									setOpenMenu(false);
								}}
								type="button"
							>
								<TablerIcon icon="file-code" />
								{t('routes.storyEdit.toolbar.stylesheet')}
							</button>
						</div>
					)}
				</div>
				<span className="story-edit-editor-dock-chrome-sp" />
				<Badge mono tone="neutral">
					{story.storyFormat} {story.storyFormatVersion}
				</Badge>
				{issueCount > 0 && (
					<Badge icon="alert-octagon" tone="error">
						{t('routes.storyEdit.workspace.issueCount', {count: issueCount})}
					</Badge>
				)}
			</div>

			{windows.length === 0 ? (
				<div className="story-edit-editor-dock-empty">
					<TablerIcon icon="windows" />
					<p>{t('routes.storyEdit.workspace.noEditorsOpen')}</p>
					<span>{t('routes.storyEdit.workspace.noEditorsOpenHint')}</span>
				</div>
			) : (
				<div
					className="story-edit-editor-dock-grid"
					style={{
						gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`
					}}
				>
					{windows.map((spec, index_) => {
						const id = editorWindowId(spec);
						// A lone tile on the final row spans the full width so the grid
						// never ends ragged.
						const orphan =
							columns > 1 &&
							index_ === windows.length - 1 &&
							windows.length % columns === 1;

						return (
							<div
								className={classNames('story-edit-editor-dock-cell', {
									'is-dragging': dragIndex === index_,
									'is-over':
										overIndex === index_ &&
										dragIndex !== undefined &&
										dragIndex !== index_
								})}
								key={id}
								onDragOver={event => {
									if (dragIndex !== undefined) {
										event.preventDefault();
										setOverIndex(index_);
									}
								}}
								onDrop={event => {
									event.preventDefault();

									if (dragIndex !== undefined && dragIndex !== index_) {
										onReorder(dragIndex, index_);
									}

									setDragIndex(undefined);
									setOverIndex(undefined);
								}}
								style={orphan ? {gridColumn: '1 / -1'} : undefined}
							>
								<EditorWindow
									active={id === activeId}
									index={index}
									onClose={() => onClose(spec)}
									onDragStart={event => {
										setDragIndex(index_);
										event.dataTransfer.effectAllowed = 'move';
										event.dataTransfer.setData('text/plain', String(index_));
									}}
									onFocus={() => onFocus(id)}
									onRevealPassageInGraph={onRevealPassageInGraph}
									onSelectPassage={onSelectPassage}
									onTestPassage={onTestPassage}
									revealRequest={revealRequests?.get(id)}
									searchRequest={searchRequests?.get(id)}
									selection={selections.get(id)}
									spec={spec}
									story={story}
								/>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
};
