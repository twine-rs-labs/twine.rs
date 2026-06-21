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
	it('groups diagnostics and exposes source/graph reveal actions', () => {
		renderComponent();

		expect(screen.getByLabelText('Filter diagnostics')).toBeInTheDocument();
		expect(screen.getAllByText('broken-link').length).toBeGreaterThan(0);
		expect(
			screen.getAllByText(/Broken link to "Missing"/).length
		).toBeGreaterThan(0);
		expect(screen.getByText('unreachable-passage')).toBeInTheDocument();
		expect(
			screen.getByRole('button', {name: 'Reveal Source'})
		).toBeInTheDocument();
		expect(
			screen.getByRole('button', {name: 'Reveal Graph'})
		).toBeInTheDocument();
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
});
