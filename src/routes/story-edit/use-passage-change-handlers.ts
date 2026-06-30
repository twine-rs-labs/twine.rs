import * as React from 'react';
import {
	createUntitledPassageCommand,
	movePassagesCommand,
	useCoreProjectHost
} from '../../core';
import {
	deselectPassage,
	Passage,
	selectPassage,
	selectPassagesById,
	selectPassagesInRect,
	Story,
	useStoriesContext
} from '../../store/stories';
import {Point, Rect} from '../../util/geometry';
import {snapToGraphGrid} from './graph-grid';

export function usePassageChangeHandlers(story: Story) {
	const selectedPassages = React.useMemo(
		() => story.passages.filter(passage => passage.selected),
		[story.passages]
	);
	const {dispatch: storiesDispatch} = useStoriesContext();
	const coreProjectHost = useCoreProjectHost();

	const handleDeselectPassage = React.useCallback(
		(passage: Passage) => storiesDispatch(deselectPassage(story, passage)),
		[story, storiesDispatch]
	);

	const handleCreatePassage = React.useCallback(
		(point: Point, size?: {height: number; width: number}) =>
			coreProjectHost.applyStoryCommand(
				createUntitledPassageCommand(story, point.left, point.top, size),
				'undoChange.newPassage'
			),
		[coreProjectHost, story]
	);

	const handleDragPassages = React.useCallback(
		(change: Point) => {
			// Ignore tiny drags--they're probably caused by the user moving their
			// mouse slightly during double-clicking.

			if (Math.abs(change.left) < 1 && Math.abs(change.top) < 1) {
				return;
			}

			coreProjectHost.applyStoryCommand(
				movePassagesCommand(
					story.id,
					selectedPassages.map(passage => {
						let left = Math.max(passage.left + change.left / story.zoom, 0);
						let top = Math.max(passage.top + change.top / story.zoom, 0);

						if (story.snapToGrid) {
							left = snapToGraphGrid(left);
							top = snapToGraphGrid(top);
						}

						return {
							bounds: {
								height: passage.height,
								left,
								top,
								width: passage.width
							},
							passageId: passage.id
						};
					})
				),
				selectedPassages.length > 1
					? 'undoChange.movePassages'
					: 'undoChange.movePassages'
			);
		},
		[coreProjectHost, selectedPassages, story]
	);

	const handleSelectPassage = React.useCallback(
		(passage: Passage, exclusive: boolean) =>
			storiesDispatch(selectPassage(story, passage, exclusive)),
		[story, storiesDispatch]
	);

	const handleSelectPassageIds = React.useCallback(
		(passageIds: string[], additive: boolean) => {
			storiesDispatch(
				selectPassagesById(
					story,
					passageIds,
					additive ? selectedPassages.map(passage => passage.id) : []
				)
			);
		},
		[selectedPassages, story, storiesDispatch]
	);

	const handleSelectRect = React.useCallback(
		(rect: Rect, additive: boolean) => {
			// The rect we receive is in screen coordinates--we need to convert to
			// logical ones.
			const logicalRect: Rect = {
				height: rect.height / story.zoom,
				left: rect.left / story.zoom,
				top: rect.top / story.zoom,
				width: rect.width / story.zoom
			};

			// This should not be undoable.
			storiesDispatch(
				selectPassagesInRect(
					story,
					logicalRect,
					additive ? selectedPassages.map(passage => passage.id) : []
				)
			);
		},
		[selectedPassages, story, storiesDispatch]
	);

	return {
		handleCreatePassage,
		handleDeselectPassage,
		handleDragPassages,
		handleSelectPassage,
		handleSelectPassageIds,
		handleSelectRect
	};
}
