import {fireEvent, render, screen} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import type {CoreSessionStatus} from '../../../core/bindings/CoreSessionStatus';
import {
	CoreProjectHost,
	CoreProjectHostContext
} from '../../../core/project-host';
import {UndoRedoButtons} from '../undo-redo-buttons';

function testHost() {
	let status: CoreSessionStatus = {
		canRedo: false,
		canUndo: false,
		dirty: false,
		redoKind: null,
		revision: 1,
		undoKind: null
	};
	const listeners = new Set<(status: CoreSessionStatus) => void>();
	const publish = (next: CoreSessionStatus) => {
		status = next;
		listeners.forEach(listener => listener(status));
	};
	const host = {
		redo: jest.fn(async () => {
			publish({
				...status,
				canRedo: false,
				canUndo: true,
				redoKind: null,
				undoKind: 'renameStory'
			});
			return undefined;
		}),
		sessionStatus: () => status,
		subscribeToStatus: (listener: (status: CoreSessionStatus) => void) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		undo: jest.fn(async () => {
			publish({
				...status,
				canRedo: true,
				canUndo: false,
				redoKind: 'renameStory',
				undoKind: null
			});
			return undefined;
		})
	} as unknown as CoreProjectHost;

	return {
		host,
		record() {
			publish({
				...status,
				canUndo: true,
				dirty: true,
				undoKind: 'renameStory'
			});
		}
	};
}

describe('<UndoRedoButtons>', () => {
	function renderComponent() {
		const control = testHost();
		const result = render(
			<CoreProjectHostContext.Provider value={control.host}>
				<UndoRedoButtons storyId="story" />
				<button onClick={control.record}>record</button>
			</CoreProjectHostContext.Provider>
		);

		return {...result, ...control};
	}

	it('enables undo from Rust session status and invokes the host', async () => {
		const {host} = renderComponent();

		fireEvent.click(screen.getByText('record'));
		const button = screen.getByRole('button', {name: 'common.undoChange'});

		expect(button).toBeEnabled();
		fireEvent.click(button);
		expect(host.undo).toHaveBeenCalledTimes(1);
	});

	it('disables undo if Rust has no history', () => {
		renderComponent();
		expect(screen.getByRole('button', {name: 'common.undo'})).toBeDisabled();
	});

	it('enables redo after undo and invokes the host', async () => {
		const {host} = renderComponent();

		fireEvent.click(screen.getByText('record'));
		fireEvent.click(screen.getByRole('button', {name: 'common.undoChange'}));
		const redo = await screen.findByRole('button', {name: 'common.redoChange'});

		expect(redo).toBeEnabled();
		fireEvent.click(redo);
		expect(host.redo).toHaveBeenCalledTimes(1);
	});

	it('is accessible', async () => {
		const {container} = renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
