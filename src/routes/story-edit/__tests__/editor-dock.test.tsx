import {fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import {emptyStoryIndex} from '../../../core';
import {fakeStory} from '../../../test-util';
import {EditorDock} from '../editor-dock';
import {editorWindowId, EditorWindowSpec} from '../editor-window-spec';

jest.mock('../editor-window', () => ({
	EditorWindow: ({
		active,
		onDragEnd,
		onDragStart,
		spec
	}: {
		active: boolean;
		onDragEnd?: (event: React.DragEvent<HTMLDivElement>) => void;
		onDragStart?: (event: React.DragEvent<HTMLDivElement>) => void;
		spec: EditorWindowSpec;
	}) => (
		<div
			className={active ? 'is-active' : undefined}
			data-testid={`editor-window-${editorWindowId(spec)}`}
			draggable={!!onDragStart}
			onDragEnd={onDragEnd}
			onDragStart={onDragStart}
		/>
	)
}));

function renderDock(props?: Partial<React.ComponentProps<typeof EditorDock>>) {
	const story = fakeStory(2);

	story.passages[0].id = 'start';
	story.passages[1].id = 'next';

	return render(
		<EditorDock
			activeId="passage:start"
			index={emptyStoryIndex(story.id)}
			layout="tile"
			onChangeLayout={jest.fn()}
			onClose={jest.fn()}
			onFocus={jest.fn()}
			onOpen={jest.fn()}
			onReorder={jest.fn()}
			selections={new Map()}
			story={story}
			windows={[
				{kind: 'passage', passageId: 'start'},
				{kind: 'passage', passageId: 'next'}
			]}
			{...props}
		/>
	);
}

describe('<EditorDock>', () => {
	it('clears drag styling when a drag ends outside a drop target', () => {
		renderDock();

		const firstWindow = screen.getByTestId('editor-window-passage:start');
		const firstCell = firstWindow.closest('.story-edit-editor-dock-cell')!;
		const dataTransfer = {effectAllowed: '', setData: jest.fn()};

		fireEvent.dragStart(firstWindow, {dataTransfer});
		expect(firstCell).toHaveClass('is-dragging');

		fireEvent.dragEnd(firstWindow);
		expect(firstCell).not.toHaveClass('is-dragging');
	});

	it('exposes a persisted tile/stack layout control', () => {
		const onChangeLayout = jest.fn();
		const {container} = renderDock({layout: 'stack', onChangeLayout});

		expect(container.querySelector('.story-edit-editor-dock-grid')).toHaveStyle(
			{
				gridTemplateColumns: 'repeat(1, minmax(0, 1fr))'
			}
		);

		fireEvent.click(
			screen.getByRole('tab', {
				name: 'routes.storyEdit.workspace.tileEditors'
			})
		);

		expect(onChangeLayout).toHaveBeenCalledWith('tile');
	});
});
