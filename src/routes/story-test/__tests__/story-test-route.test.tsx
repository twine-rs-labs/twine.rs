import {render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import {HashRouter, Route, Routes} from 'react-router';
import {CoreProjectHostProvider} from '../../../core';
import {StoriesContext} from '../../../store/stories';
import {usePublishing} from '../../../store/use-publishing';
import {fakeStory} from '../../../test-util';
import {StoryTestRoute} from '../story-test-route';

jest.mock('../../../store/use-publishing');

describe('<StoryTestRoute>', () => {
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
								element={<StoryTestRoute />}
								path="/stories/:storyId/test"
							/>
							<Route
								element={<StoryTestRoute />}
								path="/stories/:storyId/test/:passageId"
							/>
						</Routes>
					</HashRouter>
				</CoreProjectHostProvider>
			</StoriesContext.Provider>
		);
	}

	it('renders a testing version of the story in an app-owned preview frame', async () => {
		const publishStory = jest.fn(
			jest.fn(() => Promise.resolve('mock-published-story'))
		);

		usePublishingMock.mockReturnValue({publishStory});
		renderComponent('/stories/123/test');
		await waitFor(() =>
			expect(
				screen.getByTitle('Story test preview').getAttribute('srcdoc')
			).toContain('mock-published-story')
		);
		expect(screen.getByText('Test')).toBeInTheDocument();
		expect(publishStory.mock.calls).toEqual([
			['123', {buildTarget: 'test', formatOptions: 'debug', startId: undefined}]
		]);
	});

	it('renders a testing version of the story in :storyId with a start passage specified by :passageId', async () => {
		const publishStory = jest.fn(
			jest.fn(() => Promise.resolve('mock-published-story'))
		);

		usePublishingMock.mockReturnValue({publishStory});
		renderComponent('/stories/123/test/456');
		await waitFor(() =>
			expect(
				screen.getByTitle('Story test preview').getAttribute('srcdoc')
			).toContain('mock-published-story')
		);
		expect(publishStory.mock.calls).toEqual([
			[
				'123',
				{
					buildTarget: 'test',
					formatOptions: 'debug',
					startId: '456',
					startMode: 'afterStartup'
				}
			]
		]);
	});

	it('shows an error message if publishing fails', async () => {
		const publishStory = jest.fn(
			jest.fn(() => Promise.reject(new Error('mock-error-message')))
		);

		usePublishingMock.mockReturnValue({publishStory});
		renderComponent('/stories/123/test/456');
		await waitFor(() =>
			expect(document.body.textContent).toContain('mock-error-message')
		);
	});
});
