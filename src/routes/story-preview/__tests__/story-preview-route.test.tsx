import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import {HashRouter, Route, Routes} from 'react-router';
import {CoreProjectHostProvider} from '../../../core';
import {StoriesContext} from '../../../store/stories';
import {usePublishing} from '../../../store/use-publishing';
import {fakeStory} from '../../../test-util';
import {StoryPreviewRoute} from '../story-preview-route';

jest.mock('../../../store/use-publishing');

describe('<StoryPreviewRoute>', () => {
	const usePublishingMock = usePublishing as jest.Mock;

	function renderComponent(route: string) {
		const story = {...fakeStory(), id: '123'};

		window.location.hash = route;
		return render(
			<StoriesContext.Provider value={{dispatch: jest.fn(), stories: [story]}}>
				<CoreProjectHostProvider>
					<HashRouter>
						<Routes>
							<Route
								element={<StoryPreviewRoute />}
								path="/stories/:storyId/preview"
							/>
						</Routes>
					</HashRouter>
				</CoreProjectHostProvider>
			</StoriesContext.Provider>
		);
	}

	function mockPublishing() {
		const proofStory = jest.fn(async () => 'mock-proofed-story');
		const publishStory = jest.fn(async () => 'mock-published-story');

		usePublishingMock.mockReturnValue({proofStory, publishStory});
		return {proofStory, publishStory};
	}

	it.each([
		{
			expectedLabel: 'Play',
			expectedTitle: 'Story preview',
			route: '/stories/123/preview?target=play',
			target: 'play'
		},
		{
			expectedLabel: 'Test',
			expectedTitle: 'Story test preview',
			route: '/stories/123/preview?target=test',
			target: 'test'
		}
	])(
		'renders the $target target through the canonical preview route',
		async ({expectedLabel, expectedTitle, route, target}) => {
			const {publishStory} = mockPublishing();

			renderComponent(route);
			await waitFor(() =>
				expect(
					screen.getByTitle(expectedTitle).getAttribute('srcdoc')
				).toContain('mock-published-story')
			);
			expect(screen.getByText(expectedLabel)).toBeInTheDocument();
			expect(publishStory).toHaveBeenCalledWith(
				'123',
				target === 'test'
					? {buildTarget: 'test', formatOptions: 'debug', startId: undefined}
					: {buildTarget: 'play'}
			);
		}
	);

	it('keeps Test From Here on the canonical route with an explicit start passage', async () => {
		const {publishStory} = mockPublishing();

		renderComponent('/stories/123/preview?target=test&passage=456');
		await waitFor(() =>
			expect(publishStory).toHaveBeenCalledWith('123', {
				buildTarget: 'test',
				formatOptions: 'debug',
				startId: '456',
				startMode: 'afterStartup'
			})
		);
	});

	it('returns Test From Start to the story start instead of the requested passage', async () => {
		const {publishStory} = mockPublishing();

		renderComponent('/stories/123/preview?target=test&passage=456');
		await waitFor(() => expect(publishStory).toHaveBeenCalled());
		fireEvent.click(screen.getByRole('button', {name: 'Test From Start'}));

		await waitFor(() =>
			expect(window.location.hash).toBe('#/stories/123/preview?target=test')
		);
	});

	it('uses proofing format query parameters on the same route', async () => {
		const {proofStory} = mockPublishing();

		renderComponent(
			'/stories/123/preview?target=proof&proofingFormatName=Paperthin&proofingFormatVersion=1.0.0'
		);
		await waitFor(() =>
			expect(proofStory).toHaveBeenCalledWith('123', {
				name: 'Paperthin',
				version: '1.0.0'
			})
		);
		expect(screen.getByText('Proof')).toBeInTheDocument();
	});

	it('shows publishing failures in the shared preview surface', async () => {
		usePublishingMock.mockReturnValue({
			proofStory: jest.fn(),
			publishStory: jest.fn(async () => {
				throw new Error('mock-error-message');
			})
		});

		renderComponent('/stories/123/preview?target=test');
		await waitFor(() =>
			expect(document.body.textContent).toContain('mock-error-message')
		);
	});
});
