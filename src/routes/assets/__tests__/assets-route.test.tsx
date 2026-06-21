import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import {MemoryRouter, Route} from 'react-router-dom';
import {
	FakeStateProvider,
	fakePassage,
	fakeStory,
	StoryInspector
} from '../../../test-util';
import {AssetsRoute} from '../assets-route';

function assetStory() {
	const story = {
		...fakeStory(0),
		id: 'story-id',
		name: 'Asset Castle',
		selected: true
	};
	const start = fakePassage({
		id: 'start',
		name: 'Start',
		selected: true,
		story: story.id,
		text: 'Portrait: <img src="assets/cover.png">'
	});

	story.passages = [start];
	story.startPassage = start.id;
	return {start, story};
}

function renderComponent() {
	const {story} = assetStory();
	const result = render(
		<FakeStateProvider stories={[story]}>
			<MemoryRouter initialEntries={[`/stories/${story.id}/assets`]}>
				<Route path="/stories/:storyId/assets">
					<AssetsRoute />
					<StoryInspector id={story.id} />
				</Route>
			</MemoryRouter>
		</FakeStateProvider>
	);

	return {result, story};
}

describe('<AssetsRoute>', () => {
	it('shows the reference-backed inventory and preview actions', () => {
		renderComponent();

		expect(screen.getByLabelText('Search assets')).toBeInTheDocument();
		expect(screen.getAllByText('assets/cover.png').length).toBeGreaterThan(0);
		expect(
			screen.getByText('<img src="assets/cover.png" alt="">')
		).toBeInTheDocument();
		expect(
			screen.getByRole('button', {name: 'Find Usages'})
		).toBeInTheDocument();
	});

	it('inserts the selected asset snippet through the core host', async () => {
		const {result} = renderComponent();

		fireEvent.click(screen.getByRole('button', {name: 'Insert into Passage'}));

		await waitFor(() =>
			expect(
				result.container.querySelector('[data-id="start"]')
			).toHaveTextContent('<img src="assets/cover.png" alt="">')
		);
	});
});
