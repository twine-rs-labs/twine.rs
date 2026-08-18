import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {MemoryRouter} from 'react-router';
import {
	FakeStateProvider,
	FakeStateProviderProps,
	LocationInspector
} from '../../test-util';
import {AppActions} from '../app-actions';

describe('<AppActions>', () => {
	function renderComponent(contexts?: FakeStateProviderProps, route = '/') {
		return render(
			<MemoryRouter initialEntries={[route]}>
				<FakeStateProvider {...contexts}>
					<AppActions />
				</FakeStateProvider>
				<LocationInspector />
			</MemoryRouter>
		);
	}

	it('navigates to the Settings route instead of opening the legacy preferences dialog', async () => {
		renderComponent();
		fireEvent.click(
			screen.getByRole('button', {name: 'routeActions.app.preferences'})
		);

		await waitFor(() =>
			expect(screen.getByTestId('location')).toHaveAttribute(
				'data-pathname',
				'/settings'
			)
		);
		expect(
			screen.queryByText('dialogs.appPrefs.title')
		).not.toBeInTheDocument();
	});

	it('disables the preferences action on the Settings route', () => {
		renderComponent(undefined, '/settings');

		expect(
			screen.getByRole('button', {name: 'routeActions.app.preferences'})
		).toBeDisabled();
	});

	it('displays a button that shows the about dialog', () => {
		renderComponent();
		expect(
			screen.queryByText('dialogs.aboutTwine.twineRsTitle')
		).not.toBeInTheDocument();
		fireEvent.click(
			screen.getByRole('button', {name: 'routeActions.app.aboutTwineRs'})
		);
		expect(
			screen.getByText('dialogs.aboutTwine.twineRsTitle')
		).toBeInTheDocument();
	});

	it('navigates to the Story Formats route instead of opening the legacy dialog', async () => {
		renderComponent();
		fireEvent.click(
			screen.getByRole('button', {name: 'routeActions.app.storyFormats'})
		);

		await waitFor(() =>
			expect(screen.getByTestId('location')).toHaveAttribute(
				'data-pathname',
				'/formats'
			)
		);
		expect(
			screen.queryByText('dialogs.storyFormats.title')
		).not.toBeInTheDocument();
	});

	it('disables the story formats action on the Story Formats route', () => {
		renderComponent(undefined, '/formats');

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
			['https://github.com/twine-rs-labs/twine.rs/issues/new', '_blank']
		]);
	});

	it('is accessible', async () => {
		const {container} = renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
