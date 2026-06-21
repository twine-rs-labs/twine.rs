import {render, screen, within} from '@testing-library/react';
import * as React from 'react';
import {DialogsContext} from '../../../dialogs/context';
import {StoryJavaScriptDialog} from '../../../dialogs/story-javascript';
import {UndoableStoriesContext} from '../../../store/undoable-stories';
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
		tags: ['scene'],
		text: 'Go to [[Next]] or [[Missing]]. Set $score. assets/cover.png'
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
	story.tagColors = {scene: 'red'};
	return {next, start, story};
}

function renderComponent(
	mode: StoryEditMode,
	props?: Partial<React.ComponentProps<typeof StoryWorkspaceShell>>,
	context?: {
		dialogsDispatch?: jest.Mock;
		storyDispatch?: jest.Mock;
	}
) {
	const {next, start, story} = storyWithLinkedPassages();
	const onSelectPassage = jest.fn();
	const dialogsDispatch = context?.dialogsDispatch ?? jest.fn();
	const storyDispatch = context?.storyDispatch ?? jest.fn();

	render(
		<DialogsContext.Provider value={{dialogs: [], dispatch: dialogsDispatch}}>
			<UndoableStoriesContext.Provider
				value={{dispatch: storyDispatch, isUndoable: true, stories: [story]}}
			>
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
			</UndoableStoriesContext.Provider>
		</DialogsContext.Provider>
	);

	return {dialogsDispatch, next, onSelectPassage, start, story, storyDispatch};
}

describe('<StoryWorkspaceShell>', () => {
	beforeEach(() => window.localStorage.clear());

	afterEach(() => {
		delete (window as any).twineElectron;
	});

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

	it('keeps dock collapse controls active in graph mode', () => {
		const onChangeLeftDockCollapsed = jest.fn();
		const onChangeRightDockCollapsed = jest.fn();

		renderComponent('graph', {
			onChangeLeftDockCollapsed,
			onChangeRightDockCollapsed
		});

		within(
			screen.getByRole('complementary', {
				name: 'routes.storyEdit.workspace.leftDock'
			})
		)
			.getByRole('button', {
				name: 'routes.storyEdit.workspace.collapseDock'
			})
			.click();
		within(
			screen.getByRole('complementary', {
				name: 'routes.storyEdit.workspace.rightDock'
			})
		)
			.getByRole('button', {
				name: 'routes.storyEdit.workspace.collapseDock'
			})
			.click();

		expect(onChangeLeftDockCollapsed).toHaveBeenCalledWith(true);
		expect(onChangeRightDockCollapsed).toHaveBeenCalledWith(true);
	});

	it('marks the active passage in the navigator', () => {
		renderComponent('text');

		expect(
			within(
				screen.getByRole('complementary', {
					name: 'routes.storyEdit.workspace.leftDock'
				})
			).getByRole('button', {name: /Start/})
		).toHaveAttribute('aria-current', 'true');
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
		expect(screen.getAllByText('Missing').length).toBeGreaterThan(0);
	});

	it('shows indexed contents and project intelligence in the docks', () => {
		renderComponent('text');

		expect(
			screen.getByText('routes.storyEdit.workspace.sourceFiles')
		).toBeInTheDocument();
		expect(
			screen.getByText('routes.storyEdit.workspace.variables')
		).toBeInTheDocument();
		expect(
			screen.getAllByText('routes.storyEdit.workspace.assets').length
		).toBeGreaterThan(0);

		within(
			screen.getByRole('complementary', {
				name: 'routes.storyEdit.workspace.leftDock'
			})
		)
			.getByRole('tab', {name: 'routes.storyEdit.workspace.contents'})
			.click();

		expect(screen.getAllByText('$score').length).toBeGreaterThan(0);
		expect(screen.getAllByText('assets/cover.png').length).toBeGreaterThan(0);
		expect(screen.getAllByText('broken-link').length).toBeGreaterThan(0);
	});

	it('opens indexed story sources from the contents navigator', () => {
		const {dialogsDispatch} = renderComponent('text');

		within(
			screen.getByRole('complementary', {
				name: 'routes.storyEdit.workspace.leftDock'
			})
		)
			.getByRole('tab', {name: 'routes.storyEdit.workspace.contents'})
			.click();

		within(
			screen.getByRole('complementary', {
				name: 'routes.storyEdit.workspace.leftDock'
			})
		)
			.getByRole('button', {name: /Story JavaScript/})
			.click();

		expect(dialogsDispatch).toHaveBeenCalledWith({
			type: 'addDialog',
			component: StoryJavaScriptDialog,
			props: {storyId: expect.any(String)}
		});
	});

	it('navigates variable and asset entries to their first indexed passage', () => {
		const {onSelectPassage, start} = renderComponent('text');

		within(
			screen.getByRole('complementary', {
				name: 'routes.storyEdit.workspace.leftDock'
			})
		)
			.getByRole('tab', {name: 'routes.storyEdit.workspace.contents'})
			.click();

		within(
			screen.getByRole('complementary', {
				name: 'routes.storyEdit.workspace.leftDock'
			})
		)
			.getByRole('button', {name: /\$score/})
			.click();

		expect(onSelectPassage).toHaveBeenCalledWith(start);
	});

	it('routes asset manager insertion through the project host', () => {
		const {storyDispatch} = renderComponent('text');

		within(
			screen.getByRole('complementary', {
				name: 'routes.storyEdit.workspace.leftDock'
			})
		)
			.getByRole('tab', {name: 'routes.storyEdit.workspace.assets'})
			.click();

		screen.getByRole('button', {name: 'Insert'}).click();

		expect(storyDispatch).toHaveBeenCalledWith(
			expect.any(Function),
			'undoChange.editPassage'
		);
	});

	it('handles asset snippet copy and reveal side effects from host patches', () => {
		const copyText = jest.fn();
		const revealPath = jest.fn();

		(window as any).twineElectron = {copyText, revealPath};
		renderComponent('text');

		within(
			screen.getByRole('complementary', {
				name: 'routes.storyEdit.workspace.leftDock'
			})
		)
			.getByRole('tab', {name: 'routes.storyEdit.workspace.assets'})
			.click();

		screen.getByRole('button', {name: 'Copy Snippet'}).click();
		expect(copyText).toHaveBeenCalledWith(
			'<img src="assets/cover.png" alt="">'
		);

		screen.getByRole('button', {name: 'Reveal'}).click();
		expect(revealPath).toHaveBeenCalledWith('assets/cover.png');
	});

	it('dispatches executable diagnostic quick fixes', () => {
		const {story, storyDispatch} = renderComponent('text');

		screen.getByRole('button', {name: /Create "Missing"/}).click();
		expect(storyDispatch).toHaveBeenCalledWith(
			{
				type: 'createPassage',
				props: {name: 'Missing', tags: [], text: ''},
				storyId: story.id
			},
			'undoChange.newPassage'
		);
	});
});
