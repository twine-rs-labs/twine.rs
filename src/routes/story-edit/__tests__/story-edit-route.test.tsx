import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
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

const TestStoryEditRoute: React.FC<{
	initialEntry?: (story: Story) => string;
}> = ({initialEntry}) => {
	const {stories} = useStoriesContext();

	return (
		<Router
			history={createMemoryHistory({
				initialEntries: [
					initialEntry?.(stories[0]) ?? `/stories/${stories[0].id}`
				]
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
	beforeEach(() => {
		window.localStorage.clear();
	});

	async function renderComponent(
		story: Story,
		contexts?: FakeStateProviderProps,
		initialEntry?: (story: Story) => string
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
				<TestStoryEditRoute initialEntry={initialEntry} />
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
		expect(Helmet.peek().title).toBe(`${story.name} - Twine RS`);
	});

	it('redirects to the story list if the story ID no longer exists', async () => {
		await renderComponent(fakeStory(), undefined, () => '/stories/missing');

		await waitFor(() =>
			expect(
				screen.queryByTestId('story-inspector-default')
			).not.toBeInTheDocument()
		);
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

	it('edits graph passages in the workspace instead of opening the legacy passage dialog', async () => {
		const story = fakeStory(1);

		story.passages[0].left = 125;
		story.passages[0].top = 125;
		window.localStorage.setItem(
			'twine-story-edit-workspace',
			JSON.stringify({mode: 'graph'})
		);
		const {container, unmount} = await renderComponent(story);
		let graphNode: HTMLElement | null = null;

		await waitFor(
			() => {
				graphNode = container.querySelector(
					`[data-passage-id="${story.passages[0].id}"] .tw-node`
				);
				expect(graphNode).toBeTruthy();
			},
			{timeout: 4000}
		);

		fireEvent.doubleClick(graphNode!);

		await waitFor(
			() =>
				expect(
					container.querySelector('.story-edit-editor-window')
				).toBeTruthy(),
			{timeout: 4000}
		);
		expect(container.querySelector('.passage-edit-stack')).toBeNull();

		await waitFor(() =>
			expect(
				JSON.parse(
					window.localStorage.getItem(
						`twine-story-edit-workspace-${story.id}`
					) ?? '{}'
				)
			).toEqual(
				expect.objectContaining({
					activeWindowId: `passage:${story.passages[0].id}`,
					editorWindows: [{kind: 'passage', passageId: story.passages[0].id}],
					mode: 'split'
				})
			)
		);

		unmount();

		await renderComponent(story);
		expect(
			await screen.findByTestId(`story-editor-window-${story.passages[0].id}`)
		).toBeInTheDocument();
	});

	it('restores persisted editor windows and prunes stale passage windows', async () => {
		const story = fakeStory(2);

		story.passages[0].id = 'start';
		story.passages[0].name = 'Start';
		story.passages[1].id = 'next';
		story.passages[1].name = 'Next';
		story.startPassage = 'start';
		story.stylesheet = 'tw-story { color: red; }';
		window.localStorage.setItem(
			`twine-story-edit-workspace-${story.id}`,
			JSON.stringify({
				activeWindowId: 'stylesheet',
				editorWindows: [
					{kind: 'passage', passageId: 'start'},
					{kind: 'stylesheet'},
					{kind: 'passage', passageId: 'deleted'}
				],
				mode: 'split'
			})
		);

		const {container} = await renderComponent(story);

		expect(
			await screen.findByTestId('story-editor-window-start')
		).toBeInTheDocument();
		expect(
			screen.getByTestId(`story-editor-window-${story.id}:stylesheet`)
		).toBeInTheDocument();
		expect(
			container.querySelector('#story-editor-window-deleted')
		).not.toBeInTheDocument();
		expect(
			container.querySelector(
				`.story-edit-editor-window.is-active #story-editor-window-${story.id}\\:stylesheet`
			)
		).toBeInTheDocument();
	});

	it('returns to graph mode after closing the last editor from split mode', async () => {
		const story = fakeStory(1);

		story.passages[0].left = 125;
		story.passages[0].top = 125;
		window.localStorage.setItem(
			'twine-story-edit-workspace',
			JSON.stringify({mode: 'graph'})
		);
		const {container} = await renderComponent(story);
		let graphNode: HTMLElement | null = null;

		await waitFor(
			() => {
				graphNode = container.querySelector(
					`[data-passage-id="${story.passages[0].id}"] .tw-node`
				);
				expect(graphNode).toBeTruthy();
			},
			{timeout: 4000}
		);

		fireEvent.doubleClick(graphNode!);

		await waitFor(
			() =>
				expect(
					container.querySelector('.story-edit-editor-window')
				).toBeTruthy(),
			{timeout: 4000}
		);

		fireEvent.click(
			container.querySelector(
				'.story-edit-editor-window [aria-label^="common.close"]'
			)!
		);

		await waitFor(() =>
			expect(container.querySelector('.story-edit-text-layer')).toBeNull()
		);
		expect(screen.getByLabelText('Story graph')).toBeInTheDocument();
	});

	it('opens the Go To Passage finder from text mode above the workspace', async () => {
		const story = fakeStory(1);

		story.passages[0].name = 'Start';
		story.passages[0].text = 'Opening text.';
		const {container} = await renderComponent(story);

		fireEvent.click(
			await screen.findByRole('tab', {
				name: 'routes.storyEdit.workspace.textMode'
			})
		);
		fireEvent.click(
			screen.getByRole('button', {name: 'routes.storyEdit.toolbar.goTo'})
		);

		expect(
			screen.getByLabelText('components.passageFuzzyFinder.prompt')
		).toBeInTheDocument();
		expect(
			container.querySelector('.story-edit-workspace > .fuzzy-finder')
		).toBeTruthy();
	});

	it('opens story find and replace from shell toolbar story actions', async () => {
		await renderComponent(fakeStory());

		fireEvent.click(await screen.findByRole('tab', {name: 'common.story'}));
		fireEvent.click(
			screen.getByRole('button', {
				name: 'routes.storyEdit.toolbar.findAndReplace'
			})
		);

		expect(screen.getByText('dialogs.storySearch.title')).toBeInTheDocument();
	});

	it('opens the stylesheet editor for a stylesheet source route target', async () => {
		const story = fakeStory(1);

		story.stylesheet = '.hero { background: url("assets/bg.png"); }';

		await renderComponent(
			story,
			undefined,
			story => `/stories/${story.id}?mode=text&source=stylesheet`
		);

		expect(
			await screen.findByTestId(`story-editor-window-${story.id}:stylesheet`)
		).toBeInTheDocument();
		expect(
			screen.getByLabelText('routes.storyEdit.toolbar.stylesheet')
		).toBeInTheDocument();
	});

	it('opens story search for variable source route queries', async () => {
		const story = fakeStory(1);

		story.passages[0].text = 'Set $score here.';

		await renderComponent(
			story,
			undefined,
			story => `/stories/${story.id}?mode=text&q=%24score&scope=variable`
		);

		expect(screen.getByText('dialogs.storySearch.title')).toBeInTheDocument();
	});

	it('opens story details from shell toolbar story actions', async () => {
		await renderComponent(fakeStory());

		fireEvent.click(await screen.findByRole('tab', {name: 'common.story'}));
		fireEvent.click(screen.getByRole('button', {name: 'common.details'}));

		expect(
			screen.getByLabelText('dialogs.storyDetails.snapToGrid')
		).toBeInTheDocument();
	});

	it('is accessible', async () => {
		const {container} = await renderComponent(fakeStory());

		expect(await axe(container)).toHaveNoViolations();
	});
});
