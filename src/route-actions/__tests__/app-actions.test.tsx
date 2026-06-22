import {fireEvent, render, screen} from '@testing-library/react';
import {createMemoryHistory, MemoryHistory} from 'history';
import {axe} from 'jest-axe';
import * as React from 'react';
import {Router} from 'react-router-dom';
import {FakeStateProvider, FakeStateProviderProps} from '../../test-util';
import {AppActions} from '../app-actions';

describe('<AppActions>', () => {
	function renderComponent(
		contexts?: FakeStateProviderProps,
		history?: MemoryHistory
	) {
		return render(
			<Router history={history ?? createMemoryHistory()}>
				<FakeStateProvider {...contexts}>
					<AppActions />
				</FakeStateProvider>
			</Router>
		);
	}

	it('navigates to the Settings route instead of opening the legacy preferences dialog', () => {
		const history = createMemoryHistory({initialEntries: ['/']});

		renderComponent(undefined, history);
		fireEvent.click(
			screen.getByRole('button', {name: 'routeActions.app.preferences'})
		);

		expect(history.location.pathname).toBe('/settings');
		expect(
			screen.queryByText('dialogs.appPrefs.title')
		).not.toBeInTheDocument();
	});

	it('disables the preferences action on the Settings route', () => {
		renderComponent(
			undefined,
			createMemoryHistory({initialEntries: ['/settings']})
		);

		expect(
			screen.getByRole('button', {name: 'routeActions.app.preferences'})
		).toBeDisabled();
	});

	it('displays a button that shows the about dialog', () => {
		renderComponent();
		expect(
			screen.queryByText('dialogs.aboutTwine.title')
		).not.toBeInTheDocument();
		fireEvent.click(
			screen.getByRole('button', {name: 'routeActions.app.aboutApp'})
		);
		expect(screen.getByText('dialogs.aboutTwine.title')).toBeInTheDocument();
	});

	it('navigates to the Story Formats route instead of opening the legacy dialog', () => {
		const history = createMemoryHistory({initialEntries: ['/']});

		renderComponent(undefined, history);
		fireEvent.click(
			screen.getByRole('button', {name: 'routeActions.app.storyFormats'})
		);

		expect(history.location.pathname).toBe('/formats');
		expect(
			screen.queryByText('dialogs.storyFormats.title')
		).not.toBeInTheDocument();
	});

	it('disables the story formats action on the Story Formats route', () => {
		renderComponent(
			undefined,
			createMemoryHistory({initialEntries: ['/formats']})
		);

		expect(
			screen.getByRole('button', {name: 'routeActions.app.storyFormats'})
		).toBeDisabled();
	});

	it('displays a button that allows users to report bugs', () => {
		const openSpy = jest
			.spyOn(window, 'open')
			.mockReturnValue(undefined as any);

		renderComponent();
		expect(openSpy).not.toHaveBeenCalled();
		fireEvent.click(
			screen.getByRole('button', {name: 'routeActions.app.reportBug'})
		);
		expect(openSpy.mock.calls).toEqual([
			['https://twinery.org/2bugs', '_blank']
		]);
	});

	it('is accessible', async () => {
		const {container} = renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
