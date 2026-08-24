import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import {HashRouter, Route, Routes} from 'react-router';
import {CoreProjectHostProvider} from '../../../core';
import {StoriesContext} from '../../../store/stories';
import {usePublishing} from '../../../store/use-publishing';
import {fakeStory} from '../../../test-util';
import {browserRuntimeLogCopy, StoryPreviewRoute} from '../story-preview-route';

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
		const buildStoryPreviewPackage = jest.fn(
			async (_storyId: string, target: string) => ({
				admission: {kind: 'none'},
				build: {
					html:
						target === 'proof' ? 'mock-proofed-story' : 'mock-published-story'
				},
				summary: undefined
			})
		);

		usePublishingMock.mockReturnValue({buildStoryPreviewPackage});
		return {buildStoryPreviewPackage};
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
			const {buildStoryPreviewPackage} = mockPublishing();

			renderComponent(route);
			await waitFor(() =>
				expect(
					screen.getByTitle(expectedTitle).getAttribute('srcdoc')
				).toContain('mock-published-story')
			);
			expect(screen.getByText(expectedLabel)).toBeInTheDocument();
			expect(buildStoryPreviewPackage).toHaveBeenCalledWith(
				'123',
				target,
				target === 'test' ? {formatOptions: 'debug', startId: undefined} : {}
			);
		}
	);

	it('keeps Test From Here on the canonical route with an explicit start passage', async () => {
		const {buildStoryPreviewPackage} = mockPublishing();

		renderComponent('/stories/123/preview?target=test&passage=456');
		await waitFor(() =>
			expect(buildStoryPreviewPackage).toHaveBeenCalledWith('123', 'test', {
				formatOptions: 'debug',
				startId: '456',
				startMode: 'afterStartup'
			})
		);
	});

	it('returns Test From Start to the story start instead of the requested passage', async () => {
		const {buildStoryPreviewPackage} = mockPublishing();

		renderComponent('/stories/123/preview?target=test&passage=456');
		await waitFor(() => expect(buildStoryPreviewPackage).toHaveBeenCalled());
		fireEvent.click(screen.getByRole('button', {name: 'Test From Start'}));

		await waitFor(() =>
			expect(window.location.hash).toBe('#/stories/123/preview?target=test')
		);
	});

	it('uses proofing format query parameters on the same route', async () => {
		const {buildStoryPreviewPackage} = mockPublishing();

		renderComponent(
			'/stories/123/preview?target=proof&proofingFormatName=Paperthin&proofingFormatVersion=1.0.0'
		);
		await waitFor(() =>
			expect(buildStoryPreviewPackage).toHaveBeenCalledWith('123', 'proof', {
				proofingFormat: {name: 'Paperthin', version: '1.0.0'}
			})
		);
		expect(screen.getByText('Proof')).toBeInTheDocument();
	});

	it('shows publishing failures in the shared preview surface', async () => {
		usePublishingMock.mockReturnValue({
			buildStoryPreviewPackage: jest.fn(async () => {
				throw new Error('mock-error-message');
			})
		});

		renderComponent('/stories/123/preview?target=test');
		await waitFor(() =>
			expect(document.body.textContent).toContain('mock-error-message')
		);
	});
});

describe('browserRuntimeLogCopy', () => {
	it('uses supported clipboard writes and propagates rejection', async () => {
		const writeText = jest.fn().mockRejectedValue(new Error('denied'));
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: {writeText}
		});

		const copy = browserRuntimeLogCopy();
		await expect(copy?.('runtime log')).rejects.toThrow('denied');
		expect(writeText).toHaveBeenCalledWith('runtime log');
	});

	it('is unavailable when clipboard writeText is unsupported', () => {
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: undefined
		});
		expect(browserRuntimeLogCopy()).toBeUndefined();
	});
});
