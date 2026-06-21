import {act, render, screen} from '@testing-library/react';
import {createMemoryHistory} from 'history';
import {axe} from 'jest-axe';
import * as React from 'react';
import {Helmet} from 'react-helmet';
import {Route, Router} from 'react-router-dom';
import {AppShell} from '../../../components/app-shell';
import {Story, useStoriesContext} from '../../../store/stories';
import {
	fakeLoadedStoryFormat,
	FakeStateProvider,
	FakeStateProviderProps,
	fakeStory,
	StoryInspector
} from '../../../test-util';
import {InnerStoryEditRoute} from '../story-edit-route';
import {useZoomShortcuts} from '../use-zoom-shortcuts';

jest.mock('../use-zoom-shortcuts');

const TestStoryEditRoute: React.FC = () => {
	const {stories} = useStoriesContext();

	return (
		<Router
			history={createMemoryHistory({
				initialEntries: [`/stories/${stories[0].id}`]
			})}
		>
			<AppShell>
				<Route path="/stories/:storyId">
					<InnerStoryEditRoute />
					<StoryInspector />
				</Route>
			</AppShell>
		</Router>
	);
};

describe('<StoryEditRoute>', () => {
	const useZoomShortcutsMock = useZoomShortcuts as jest.Mock;

	async function renderComponent(
		story: Story,
		contexts?: FakeStateProviderProps
	) {
		const format = fakeLoadedStoryFormat();

		format.name = story.storyFormat;
		format.version = story.storyFormatVersion;

		jest.useFakeTimers();

		const result = render(
			<FakeStateProvider
				{...contexts}
				stories={[story]}
				storyFormats={[format]}
			>
				<TestStoryEditRoute />
			</FakeStateProvider>
		);

		act(() => {
			jest.runAllTimers();
		});

		jest.useRealTimers();

		// Need this because of <PromptButton>
		await act(async () => Promise.resolve());
		return result;
	}

	it('sets the document title to the story name', async () => {
		const story = fakeStory();

		await renderComponent(story);
		expect(Helmet.peek().title).toBe(story.name);
	});

	it('registers story edit actions in the app shell', async () => {
		await renderComponent(fakeStory());
		expect(
			await screen.findByRole('tab', {
				name: 'routes.storyEdit.workspace.textMode'
			})
		).toBeInTheDocument();
		expect(
			screen.getByRole('tab', {name: 'common.passage'})
		).toBeInTheDocument();
	});

	it('displays a story graph panel', async () => {
		await renderComponent(fakeStory());
		expect(screen.getByLabelText('Story graph')).toBeInTheDocument();
	});

	it('sets up zoom keyboard shortcuts', async () => {
		await renderComponent(fakeStory());
		expect(useZoomShortcutsMock).toBeCalled();
	});

	it('is accessible', async () => {
		const {container} = await renderComponent(fakeStory());

		expect(await axe(container)).toHaveNoViolations();
	});
});
