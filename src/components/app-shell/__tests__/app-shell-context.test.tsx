import {render} from '@testing-library/react';
import * as React from 'react';
import {AppShellContext, useAppCommandContribution} from '../app-shell-context';

const Contribution: React.FC<{label: string}> = ({label}) => {
	useAppCommandContribution('story-edit.test', [
		{group: 'Toolbar', id: 'story-edit.test', label, run: jest.fn()}
	]);
	return null;
};

describe('useAppCommandContribution', () => {
	it('refreshes live commands and unregisters them on route disposal', () => {
		const refresh = jest.fn();
		const unregister = jest.fn();
		const registerCommandContribution = jest.fn(() => ({refresh, unregister}));
		const {rerender, unmount} = render(
			<AppShellContext.Provider
				value={{
					inShell: true,
					registerCommandContribution,
					setDock: jest.fn(),
					setToolbar: jest.fn()
				}}
			>
				<Contribution label="First" />
			</AppShellContext.Provider>
		);

		rerender(
			<AppShellContext.Provider
				value={{
					inShell: true,
					registerCommandContribution,
					setDock: jest.fn(),
					setToolbar: jest.fn()
				}}
			>
				<Contribution label="Second" />
			</AppShellContext.Provider>
		);
		expect(refresh).toHaveBeenLastCalledWith([
			expect.objectContaining({label: 'Second'})
		]);
		unmount();
		expect(unregister).toHaveBeenCalledTimes(1);
	});
});
