import {fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import {MemoryRouter, Route} from 'react-router-dom';
import {
	FakeStateProvider,
	fakePassage,
	fakeStory,
	StoryInspector
} from '../../../test-util';
import {ContentsRoute} from '../contents-route';

const mockTestStory = jest.fn();

jest.mock('../../../store/use-story-launch', () => ({
	useStoryLaunch: () => ({
		testStory: mockTestStory
	})
}));

function indexedStory() {
	const story = {
		...fakeStory(0),
		id: 'story-id',
		name: 'Indexed Castle',
		selected: true
	};
	const start = fakePassage({
		id: 'start',
		name: 'Start',
		selected: true,
		story: story.id,
		tags: ['intro'],
		text: 'Set $score. [[Missing]] <img src="assets/cover.png">'
	});
	const end = fakePassage({
		id: 'end',
		name: 'End',
		selected: false,
		story: story.id,
		text: 'Done'
	});

	story.passages = [start, end];
	story.startPassage = start.id;
	story.tagColors = {intro: 'green'};
	return {end, start, story};
}

function renderComponent() {
	const {story} = indexedStory();

	render(
		<FakeStateProvider stories={[story]}>
			<MemoryRouter initialEntries={[`/stories/${story.id}/contents`]}>
				<Route path="/stories/:storyId/contents">
					<ContentsRoute />
					<StoryInspector id={story.id} />
				</Route>
			</MemoryRouter>
		</FakeStateProvider>
	);

	return {story};
}

describe('<ContentsRoute>', () => {
	beforeEach(() => {
		mockTestStory.mockReset();
	});

	it('surfaces indexed passages, variables, assets, and diagnostic groups', () => {
		renderComponent();

		expect(screen.getByLabelText('Filter contents')).toBeInTheDocument();
		expect(screen.getByText('Indexed Castle')).toBeInTheDocument();
		expect(screen.getAllByText('Start').length).toBeGreaterThan(0);
		expect(screen.getByText('$score')).toBeInTheDocument();
		expect(screen.getAllByText('assets/cover.png').length).toBeGreaterThan(0);
		expect(screen.getAllByText('Diagnostics').length).toBeGreaterThan(0);
	});

	it('filters the contents list by asset type', () => {
		renderComponent();

		fireEvent.click(screen.getByRole('button', {name: /Assets/}));

		expect(screen.getAllByText('assets/cover.png').length).toBeGreaterThan(0);
		expect(screen.queryByText('$score')).not.toBeInTheDocument();
	});

	it('tests the selected indexed passage from the inspector', () => {
		const {story} = renderComponent();

		fireEvent.click(screen.getByRole('button', {name: 'Test From Here'}));

		expect(mockTestStory).toHaveBeenCalledWith(story.id, story.passages[0].id);
	});
});
