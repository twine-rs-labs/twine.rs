import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import {CommandPalette} from '../command-palette';
import type {AppCommand} from '../command-registry';

function command(overrides: Partial<AppCommand> = {}): AppCommand {
	return {
		contextKey: 'initial',
		group: 'Toolbar',
		id: 'story-edit.action',
		label: 'Action',
		run: jest.fn(),
		...overrides
	};
}

describe('<CommandPalette>', () => {
	it('revalidates a rendered command against its current context before execution', () => {
		const run = jest.fn();
		let current = command({contextKey: 'initial', run});
		const {rerender} = render(
			<CommandPalette
				commands={[current]}
				onClose={jest.fn()}
				open
				resolveCommand={id => (id === current.id ? current : undefined)}
			/>
		);

		current = command({contextKey: 'changed', run});
		rerender(
			<CommandPalette
				commands={[command({contextKey: 'initial', run})]}
				onClose={jest.fn()}
				open
				resolveCommand={id => (id === current.id ? current : undefined)}
			/>
		);
		fireEvent.keyDown(screen.getByLabelText('Command'), {key: 'Enter'});

		expect(run).not.toHaveBeenCalled();
	});

	it('renders disabled reasons', () => {
		render(
			<CommandPalette
				commands={[
					command({disabled: true, disabledReason: 'Select a passage'})
				]}
				onClose={jest.fn()}
				open
				resolveCommand={() => undefined}
			/>
		);
		expect(screen.getByText('Select a passage')).toBeInTheDocument();
	});

	it('traps palette focus and restores it when the modal closes', async () => {
		const trigger = document.createElement('button');
		document.body.append(trigger);
		trigger.focus();
		const {rerender} = render(
			<CommandPalette
				commands={[command()]}
				onClose={jest.fn()}
				open
				resolveCommand={() => command()}
			/>
		);

		await waitFor(() => expect(screen.getByLabelText('Command')).toHaveFocus());
		rerender(
			<CommandPalette
				commands={[command()]}
				onClose={jest.fn()}
				open={false}
				resolveCommand={() => command()}
			/>
		);
		await waitFor(() => expect(trigger).toHaveFocus());
		trigger.remove();
	});

	it('does not overwrite focus moved into a dialog launched by a command', async () => {
		const trigger = document.createElement('button');
		const successor = document.createElement('input');
		let restoreFocus: (() => void) | undefined;
		document.body.append(trigger, successor);
		trigger.focus();
		const SuccessorHarness = () => {
			const [open, setOpen] = React.useState(true);
			const current = command({
				run: context => {
					restoreFocus = context?.restoreFocus;
					successor.focus();
				}
			});

			return (
				<CommandPalette
					commands={[current]}
					onClose={() => setOpen(false)}
					open={open}
					resolveCommand={() => current}
				/>
			);
		};

		render(<SuccessorHarness />);
		const input = await screen.findByLabelText('Command');
		await waitFor(() => expect(input).toHaveFocus());
		fireEvent.keyDown(input, {key: 'Enter'});
		await waitFor(() => expect(successor).toHaveFocus());
		expect(trigger).not.toHaveFocus();
		restoreFocus?.();
		expect(trigger).toHaveFocus();
		trigger.remove();
		successor.remove();
	});
});
