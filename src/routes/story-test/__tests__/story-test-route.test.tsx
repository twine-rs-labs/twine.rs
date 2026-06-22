import {render, screen, waitFor} from '@testing-library/react';
import {createHashHistory} from 'history';
import * as React from 'react';
import {HashRouter, Route} from 'react-router-dom';
import {StoriesContext} from '../../../store/stories';
import {usePublishing} from '../../../store/use-publishing';
import {fakeStory} from '../../../test-util';
import {StoryTestRoute} from '../story-test-route';

jest.mock('../../../store/use-publishing');

describe('<StoryTestRoute>', () => {
	const usePublishingMock = usePublishing as jest.Mock;

	function renderComponent(route: string) {
		const history = createHashHistory();
		const story = {...fakeStory(), id: '123'};

		history.push(route);
		return render(
			<StoriesContext.Provider value={{dispatch: jest.fn(), stories: [story]}}>
				<HashRouter>
					<Route path="/stories/:storyId/test" exact>
						<StoryTestRoute />
					</Route>
					<Route path="/stories/:storyId/test/:passageId" exact>
						<StoryTestRoute />
					</Route>
				</HashRouter>
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
			['123', {buildTarget: 'test', formatOptions: 'debug', startId: '456'}]
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
