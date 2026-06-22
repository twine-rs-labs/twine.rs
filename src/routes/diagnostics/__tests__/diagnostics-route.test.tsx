import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import {MemoryRouter, Route} from 'react-router-dom';
import {
	FakeStateProvider,
	fakePassage,
	fakeStory,
	StoryInspector
} from '../../../test-util';
import {DiagnosticsRoute} from '../diagnostics-route';

const mockTestStory = jest.fn();

jest.mock('../../../store/use-story-launch', () => ({
	useStoryLaunch: () => ({
		testStory: mockTestStory
	})
}));

function diagnosticStory() {
	const story = {
		...fakeStory(0),
		id: 'story-id',
		name: 'Diagnostic Castle',
		selected: true
	};
	const start = fakePassage({
		id: 'start',
		name: 'Start',
		selected: true,
		story: story.id,
		text: 'Go to [[Missing]].'
	});
	const isolated = fakePassage({
		id: 'isolated',
		name: 'Isolated',
		selected: false,
		story: story.id,
		text: 'No one links here.'
	});

	story.passages = [start, isolated];
	story.startPassage = start.id;
	return {isolated, start, story};
}

function renderComponent() {
	const {story} = diagnosticStory();
	const result = render(
		<FakeStateProvider stories={[story]}>
			<MemoryRouter initialEntries={[`/stories/${story.id}/diagnostics`]}>
				<Route path="/stories/:storyId/diagnostics">
					<DiagnosticsRoute />
					<StoryInspector id={story.id} />
				</Route>
			</MemoryRouter>
		</FakeStateProvider>
	);

	return {result, story};
}

describe('<DiagnosticsRoute>', () => {
	beforeEach(() => {
		window.localStorage.clear();
		mockTestStory.mockReset();
	});

	it('groups diagnostics and exposes source/graph reveal actions', () => {
		renderComponent();

		expect(screen.getByLabelText('Filter diagnostics')).toBeInTheDocument();
		expect(screen.getAllByText('broken-link').length).toBeGreaterThan(0);
		expect(
			screen.getAllByText(/Broken link to "Missing"/).length
		).toBeGreaterThan(0);
		expect(screen.getAllByText('unreachable-passage').length).toBeGreaterThan(
			0
		);
		expect(screen.getAllByText(/story-format macros/).length).toBeGreaterThan(
			0
		);
		expect(screen.getAllByText('warning').length).toBeGreaterThan(0);
		expect(
			screen.getByRole('button', {name: 'Reveal Source'})
		).toBeInTheDocument();
		expect(
			screen.getByRole('button', {name: 'Reveal Graph'})
		).toBeInTheDocument();
	});

	it('dismisses and restores a specific validation diagnostic', async () => {
		renderComponent();

		expect(screen.getAllByText('broken-link').length).toBeGreaterThan(0);

		fireEvent.click(screen.getByRole('button', {name: 'Dismiss Diagnostic'}));

		await waitFor(() =>
			expect(screen.queryByText('broken-link')).not.toBeInTheDocument()
		);
		expect(screen.getAllByText('unreachable-passage').length).toBeGreaterThan(
			0
		);

		fireEvent.click(screen.getByRole('button', {name: /Dismissed/}));

		expect(screen.getAllByText('broken-link').length).toBeGreaterThan(0);
		expect(
			screen.getByRole('button', {name: 'Restore Diagnostic'})
		).toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', {name: 'Restore Diagnostic'}));

		await waitFor(() =>
			expect(screen.queryByText('broken-link')).not.toBeInTheDocument()
		);

		fireEvent.click(screen.getByRole('button', {name: /Active/}));

		expect(screen.getAllByText('broken-link').length).toBeGreaterThan(0);
	});

	it('runs executable quick fixes through the core host', async () => {
		const {result} = renderComponent();

		fireEvent.click(screen.getByRole('button', {name: 'Create "Missing"'}));

		await waitFor(() =>
			expect(
				result.container.querySelector('[data-name="Missing"]')
			).toBeTruthy()
		);
	});

	it('tests the passage attached to the selected diagnostic', () => {
		const {story} = renderComponent();

		fireEvent.click(screen.getByRole('button', {name: 'Test From Here'}));

		expect(mockTestStory).toHaveBeenCalledWith(story.id, story.passages[0].id);
	});
});
