import {fireEvent, render, screen} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {UndoRedoButtons, UndoRedoButtonsProps} from '../undo-redo-buttons';

describe('<UndoRedoButtons>', () => {
	function renderComponent(props?: Partial<UndoRedoButtonsProps>) {
		const mockEditor = {
			runCommand: jest.fn(),
			focus: jest.fn(),
			getSnapshot: () => ({canRedo: false, canUndo: false})
		};

		return render(
			<UndoRedoButtons editor={mockEditor as any} watch={''} {...props} />
		);
	}

	it('sends an undo command and focuses the editor when the undo button is clicked', () => {
		const editor = {
			runCommand: jest.fn(),
			focus: jest.fn(),
			getSnapshot: () => ({canRedo: true, canUndo: true})
		};

		renderComponent({editor: editor as any});
		fireEvent.click(screen.getByText('common.undo'));
		expect(editor.runCommand.mock.calls).toEqual([['undo']]);
		expect(editor.focus).toHaveBeenCalledTimes(1);
	});

	it('sends a redo command and focuses the editor when the redo button is clicked', () => {
		const editor = {
			runCommand: jest.fn(),
			focus: jest.fn(),
			getSnapshot: () => ({canRedo: true, canUndo: true})
		};

		renderComponent({editor: editor as any});
		fireEvent.click(screen.getByText('common.redo'));
		expect(editor.runCommand.mock.calls).toEqual([['redo']]);
		expect(editor.focus).toHaveBeenCalledTimes(1);
	});

	it('disables both buttons if the disabled prop is set', () => {
		const editor = {
			runCommand: jest.fn(),
			focus: jest.fn(),
			getSnapshot: () => ({canRedo: true, canUndo: true})
		};

		renderComponent({editor: editor as any});
		expect(screen.getByText('common.undo')).not.toBeDisabled();
		expect(screen.getByText('common.redo')).not.toBeDisabled();
	});

	it('disables both buttons if the editor prop is not defined', () => {
		renderComponent({editor: undefined});
		expect(screen.getByText('common.undo')).toBeDisabled();
		expect(screen.getByText('common.redo')).toBeDisabled();
	});

	it('disables the undo button if there is no undo history in the editor', () => {
		const editor = {
			getSnapshot: () => ({canRedo: true, canUndo: false})
		};

		renderComponent({editor: editor as any});
		expect(screen.getByText('common.undo')).toBeDisabled();
	});

	it('disables the redo button if there is no redo history in the editor', () => {
		const editor = {
			getSnapshot: () => ({canRedo: false, canUndo: true})
		};

		renderComponent({editor: editor as any});
		expect(screen.getByText('common.redo')).toBeDisabled();
	});

	it('is accessible', async () => {
		const {container} = renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
