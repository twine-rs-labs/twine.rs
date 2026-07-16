import {render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import {HashRouter} from 'react-router';
import {CoreProjectHostProvider} from '../../../core';
import {StoriesContext} from '../../../store/stories';
import {usePublishing} from '../../../store/use-publishing';
import {fakeStory, TestRoute} from '../../../test-util';
import {StoryPlayRoute} from '../story-play-route';

jest.mock('../../../store/use-publishing');

describe('<StoryPlayRoute>', () => {
	const usePublishingMock = usePublishing as jest.Mock;

	function renderComponent(route: string) {
		const story = {...fakeStory(), id: '123'};

		window.location.hash = route;
		return render(
			<StoriesContext.Provider value={{dispatch: jest.fn(), stories: [story]}}>
				<CoreProjectHostProvider>
					<HashRouter>
						<TestRoute path="/stories/:storyId/play">
							<StoryPlayRoute />
						</TestRoute>
					</HashRouter>
				</CoreProjectHostProvider>
			</StoriesContext.Provider>
		);
	}

	it('renders a playable version of the story in an app-owned preview frame', async () => {
		const publishStory = jest.fn(
			jest.fn(() => Promise.resolve('mock-published-story'))
		);

		usePublishingMock.mockReturnValue({publishStory});
		renderComponent('/stories/123/play');
		await waitFor(() =>
			expect(
				screen.getByTitle('Story preview').getAttribute('srcdoc')
			).toContain('mock-published-story')
		);
		expect(screen.getByText('Play')).toBeInTheDocument();
		expect(screen.getByRole('button', {name: 'Source'})).toBeInTheDocument();
		expect(publishStory.mock.calls).toEqual([['123', {buildTarget: 'play'}]]);
	});

	it('shows an error message if publishing fails', async () => {
		const publishStory = jest.fn(
			jest.fn(() => Promise.reject(new Error('mock-error-message')))
		);

		usePublishingMock.mockReturnValue({publishStory});
		renderComponent('/stories/123/play');
		await waitFor(() =>
			expect(document.body.textContent).toContain('mock-error-message')
		);
	});
});
