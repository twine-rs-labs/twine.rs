import {render, screen, waitFor} from '@testing-library/react';
import {createHashHistory} from 'history';
import * as React from 'react';
import {HashRouter, Route} from 'react-router-dom';
import {StoriesContext} from '../../../store/stories';
import {usePublishing} from '../../../store/use-publishing';
import {fakeStory} from '../../../test-util';
import {StoryProofRoute} from '../story-proof-route';

jest.mock('../../../store/use-publishing');

describe('<StoryProofRoute>', () => {
	const usePublishingMock = usePublishing as jest.Mock;

	function renderComponent(route: string) {
		const history = createHashHistory();
		const story = {...fakeStory(), id: '123'};

		history.push(route);
		return render(
			<StoriesContext.Provider value={{dispatch: jest.fn(), stories: [story]}}>
				<HashRouter>
					<Route path="/stories/:storyId/proof">
						<StoryProofRoute />
					</Route>
				</HashRouter>
			</StoriesContext.Provider>
		);
	}

	it('renders a proofing version of the story in an app-owned preview frame', async () => {
		const proofStory = jest.fn(
			jest.fn(() => Promise.resolve('mock-proofed-story'))
		);

		usePublishingMock.mockReturnValue({proofStory});
		renderComponent('/stories/123/proof');
		await waitFor(() =>
			expect(
				screen.getByTitle('Story proofing preview').getAttribute('srcdoc')
			).toContain('mock-proofed-story')
		);
		expect(screen.getByText('Proof')).toBeInTheDocument();
		expect(proofStory.mock.calls).toEqual([['123']]);
	});

	it('shows an error message if publishing fails', async () => {
		const proofStory = jest.fn(
			jest.fn(() => Promise.reject(new Error('mock-error-message')))
		);

		usePublishingMock.mockReturnValue({proofStory});
		renderComponent('/stories/123/proof');
		await waitFor(() =>
			expect(document.body.textContent).toContain('mock-error-message')
		);
	});

	it('uses proofing format query params when present', async () => {
		const proofStory = jest.fn(
			jest.fn(() => Promise.resolve('mock-proofed-story'))
		);

		usePublishingMock.mockReturnValue({proofStory});
		renderComponent(
			'/stories/123/proof?proofingFormatName=Paperthin&proofingFormatVersion=1.0.0'
		);
		await waitFor(() =>
			expect(proofStory).toHaveBeenCalledWith('123', {
				name: 'Paperthin',
				version: '1.0.0'
			})
		);
	});
});
