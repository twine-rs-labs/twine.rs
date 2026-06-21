import {render, waitFor} from '@testing-library/react';
import {createHashHistory} from 'history';
import * as React from 'react';
import {HashRouter, Route} from 'react-router-dom';
import {StoriesContext} from '../../../store/stories';
import {usePublishing} from '../../../store/use-publishing';
import {fakeStory} from '../../../test-util';
import {StoryPlayRoute} from '../story-play-route';

jest.mock('../../../store/use-publishing');

describe('<StoryPlayRoute>', () => {
	const usePublishingMock = usePublishing as jest.Mock;

	function renderComponent(route: string) {
		const history = createHashHistory();
		const story = {...fakeStory(), id: '123'};

		history.push(route);
		return render(
			<StoriesContext.Provider value={{dispatch: jest.fn(), stories: [story]}}>
				<HashRouter>
					<Route path="/stories/:storyId/play">
						<StoryPlayRoute />
					</Route>
				</HashRouter>
			</StoriesContext.Provider>
		);
	}

	it('replaces the DOM with a playable version of the story in :storyId', async () => {
		const publishStory = jest.fn(
			jest.fn(() => Promise.resolve('mock-published-story'))
		);

		usePublishingMock.mockReturnValue({publishStory});
		renderComponent('/stories/123/play');
		await waitFor(() =>
			expect(document.body.textContent).toBe('mock-published-story')
		);
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
