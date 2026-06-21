import {render, screen, within} from '@testing-library/react';
import * as React from 'react';
import {fakePassage, fakeStory} from '../../../test-util';
import {StoryWorkspaceShell} from '../story-workspace-shell';
import {StoryEditMode} from '../workspace-state';

jest.mock('../story-text-panel', () => ({
	StoryTextPanel: ({selectedPassageId}: {selectedPassageId?: string}) => (
		<div
			data-selected-passage-id={selectedPassageId}
			data-testid="text-panel"
		/>
	)
}));

function storyWithLinkedPassages() {
	const story = fakeStory(0);
	const start = fakePassage({
		id: 'start',
		name: 'Start',
		selected: false,
		story: story.id,
		text: 'Go to [[Next]] or [[Missing]].'
	});
	const next = fakePassage({
		id: 'next',
		name: 'Next',
		selected: false,
		story: story.id,
		text: ''
	});

	story.passages = [start, next];
	story.startPassage = start.id;
	return {next, start, story};
}

function renderComponent(
	mode: StoryEditMode,
	props?: Partial<React.ComponentProps<typeof StoryWorkspaceShell>>
) {
	const {next, start, story} = storyWithLinkedPassages();
	const onSelectPassage = jest.fn();

	render(
		<StoryWorkspaceShell
			bottomDrawerOpen={false}
			graphPanel={<div data-testid="graph-panel" />}
			leftDockCollapsed={false}
			mode={mode}
			onChangeBottomDrawerOpen={jest.fn()}
			onChangeLeftDockCollapsed={jest.fn()}
			onChangeRightDockCollapsed={jest.fn()}
			onSelectPassage={onSelectPassage}
			rightDockCollapsed={false}
			selectedPassageId={start.id}
			story={story}
			{...props}
		/>
	);

	return {next, onSelectPassage, start, story};
}

describe('<StoryWorkspaceShell>', () => {
	it('renders only the text panel in text mode', () => {
		renderComponent('text');

		expect(screen.getByTestId('text-panel')).toBeInTheDocument();
		expect(screen.queryByTestId('graph-panel')).not.toBeInTheDocument();
	});

	it('renders graph and text panels in split mode', () => {
		renderComponent('split');

		expect(screen.getByTestId('graph-panel')).toBeInTheDocument();
		expect(screen.getByTestId('text-panel')).toBeInTheDocument();
	});

	it('marks the active passage in the navigator', () => {
		renderComponent('text');

		expect(screen.getByRole('button', {name: /Start/})).toHaveAttribute(
			'aria-current',
			'true'
		);
	});

	it('navigates to linked passages from the bottom drawer', () => {
		const {next, onSelectPassage} = renderComponent('text', {
			bottomDrawerOpen: true
		});

		within(
			screen.getByRole('region', {
				name: 'routes.storyEdit.workspace.bottomDrawer'
			})
		)
			.getByRole('button', {name: 'Next'})
			.click();
		expect(onSelectPassage).toHaveBeenCalledWith(next);
		expect(screen.getByText('Missing')).toBeInTheDocument();
	});
});
