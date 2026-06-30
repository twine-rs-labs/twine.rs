import {render, screen, waitFor, within} from '@testing-library/react';
import * as React from 'react';
import {MemoryRouter} from 'react-router-dom';
import {DialogsContext} from '../../../dialogs/context';
import {StorySearchDialog} from '../../../dialogs/story-search';
import {markProjectStoryHydration} from '../../../store/project-hydration';
import {saveProjectMetadata} from '../../../store/project-metadata';
import {StoriesContext} from '../../../store/stories';
import {fakePassage, fakeStory} from '../../../test-util';
import {StoryWorkspaceShell} from '../story-workspace-shell';
import {StoryEditMode} from '../workspace-state';

jest.mock('../editor-dock', () => ({
	EditorDock: ({
		onClose,
		windows
	}: {
		onClose?: (spec: any) => void;
		windows: any[];
	}) => (
		<div data-testid="editor-dock">
			{windows.map(spec => {
				const id =
					spec.kind === 'passage' ? `passage:${spec.passageId}` : spec.kind;

				return (
					<div
						data-selected-passage-id={
							spec.kind === 'passage' ? spec.passageId : undefined
						}
						data-testid="editor-window"
						data-window-id={id}
						key={id}
					>
						{onClose && (
							<button onClick={() => onClose(spec)}>close-{id}</button>
						)}
					</div>
				);
			})}
		</div>
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
		configureStory?: (
			story: ReturnType<typeof storyWithLinkedPassages>['story']
		) => void;
		dialogsDispatch?: jest.Mock;
		storyDispatch?: jest.Mock;
	}
) {
	const {next, start, story} = storyWithLinkedPassages();
	const onSelectPassage = jest.fn();
	const onRevealPassageInGraph = jest.fn();
	const onOpenEditorWindow = jest.fn();
	const dialogsDispatch = context?.dialogsDispatch ?? jest.fn();
	const storyDispatch = context?.storyDispatch ?? jest.fn();

	context?.configureStory?.(story);

	render(
		<MemoryRouter>
			<DialogsContext.Provider value={{dialogs: [], dispatch: dialogsDispatch}}>
				<StoriesContext.Provider
					value={{
						dispatch: storyDispatch,
						stories: [story]
					}}
				>
					<StoryWorkspaceShell
						bottomDrawerOpen={false}
						editorDockLayout="tile"
						graphPanel={<div data-testid="graph-panel" />}
						leftDockCollapsed={false}
						mode={mode}
						onChangeBottomDrawerOpen={jest.fn()}
						onChangeEditorDockLayout={jest.fn()}
						onChangeLeftDockCollapsed={jest.fn()}
						onChangeRightDockCollapsed={jest.fn()}
						onOpenEditorWindow={onOpenEditorWindow}
						onRevealPassageInGraph={onRevealPassageInGraph}
						onSelectPassage={onSelectPassage}
						rightDockCollapsed={false}
						selectedPassageId={start.id}
						story={story}
						{...props}
					/>
				</StoriesContext.Provider>
			</DialogsContext.Provider>
		</MemoryRouter>
	);

	return {
		dialogsDispatch,
		next,
		onOpenEditorWindow,
		onRevealPassageInGraph,
		onSelectPassage,
		start,
		story,
		storyDispatch
	};
}

describe('<StoryWorkspaceShell>', () => {
	beforeEach(() => window.localStorage.clear());

	afterEach(() => {
		delete (window as any).twineElectron;
	});

	it('renders only the editor dock in text mode', () => {
		renderComponent('text');

		expect(screen.getByTestId('editor-dock')).toBeInTheDocument();
		expect(screen.queryByTestId('graph-panel')).not.toBeInTheDocument();
	});

	it('renders graph and editor dock in split mode', () => {
		renderComponent('split');

		expect(screen.getByTestId('graph-panel')).toBeInTheDocument();
		expect(screen.getByTestId('editor-dock')).toBeInTheDocument();
	});

	it('renders one editor window for every open buffer', () => {
		const {next, start} = renderComponent('text', {
			editorWindows: [
				{kind: 'passage', passageId: 'start'},
				{kind: 'passage', passageId: 'next'}
			]
		});
		const windows = screen.getAllByTestId('editor-window');

		expect(windows).toHaveLength(2);
		expect(windows[0]).toHaveAttribute('data-selected-passage-id', start.id);
		expect(windows[1]).toHaveAttribute('data-selected-passage-id', next.id);
	});

	it('lets an individual editor window be closed', () => {
		const onCloseEditorWindow = jest.fn();

		renderComponent('text', {
			editorWindows: [
				{kind: 'passage', passageId: 'start'},
				{kind: 'passage', passageId: 'next'}
			],
			onCloseEditorWindow
		});

		screen.getByText('close-passage:start').click();
		expect(onCloseEditorWindow).toHaveBeenCalledWith({
			kind: 'passage',
			passageId: 'start'
		});
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

	it('windows large passage navigator lists to viewport-sized row counts', () => {
		renderComponent('text', undefined, {
			configureStory: story => {
				story.passages = Array.from({length: 1000}, (_, index) =>
					fakePassage({
						id: `passage-${index}`,
						name: `Passage ${index}`,
						story: story.id,
						text: ''
					})
				);
				story.startPassage = story.passages[0].id;
			}
		});

		const list = screen
			.getByRole('complementary', {
				name: 'routes.storyEdit.workspace.leftDock'
			})
			.querySelector('.story-edit-passage-list');

		expect(list).toHaveAttribute('data-total-count', '1000');
		expect(Number(list?.getAttribute('data-visible-count'))).toBeLessThan(80);
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

	it('shows indexed contents and project intelligence in the docks', async () => {
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

		await waitFor(() =>
			expect(screen.getAllByText('$score').length).toBeGreaterThan(0)
		);
		expect(screen.getAllByText('assets/cover.png').length).toBeGreaterThan(0);
		expect(screen.getAllByText('broken-link').length).toBeGreaterThan(0);
	});

	it('hydrates only the opened project-folder story on demand', async () => {
		const hydrateProjectFolder = jest.fn(async () => ({
			passageTextLoaded: true,
			rootPath: '/native/project.twine.rs',
			stories: [],
			storyIds: []
		}));

		(window as any).twineElectron = {hydrateProjectFolder};
		const {story} = renderComponent('graph', undefined, {
			configureStory: currentStory => {
				saveProjectMetadata(currentStory.id, {
					rootPath: '/native/project.twine.rs',
					status: 'file-backed',
					storageKind: 'electron-project-folder'
				});
				markProjectStoryHydration(currentStory.id, {
					passageTextLoaded: false,
					rootPath: '/native/project.twine.rs'
				});
			}
		});

		expect(
			screen.getByRole('progressbar', {name: 'Opening story'})
		).toHaveTextContent('Loading passage text');

		await waitFor(() =>
			expect(hydrateProjectFolder).toHaveBeenCalledWith(
				'/native/project.twine.rs',
				[story.id]
			)
		);
	});

	it('opens indexed story sources from the contents navigator', async () => {
		const {onOpenEditorWindow} = renderComponent('text');

		within(
			screen.getByRole('complementary', {
				name: 'routes.storyEdit.workspace.leftDock'
			})
		)
			.getByRole('tab', {name: 'routes.storyEdit.workspace.contents'})
			.click();

		const leftDock = screen.getByRole('complementary', {
			name: 'routes.storyEdit.workspace.leftDock'
		});

		await waitFor(() =>
			expect(
				within(leftDock).getByRole('button', {name: /Story JavaScript/})
			).toBeInTheDocument()
		);
		within(leftDock)
			.getByRole('button', {name: /Story JavaScript/})
			.click();

		expect(onOpenEditorWindow).toHaveBeenCalledWith({kind: 'script'});
	});

	it('routes variable entries to story search from the contents navigator', async () => {
		const {dialogsDispatch, story} = renderComponent('text');

		within(
			screen.getByRole('complementary', {
				name: 'routes.storyEdit.workspace.leftDock'
			})
		)
			.getByRole('tab', {name: 'routes.storyEdit.workspace.contents'})
			.click();

		const leftDock = screen.getByRole('complementary', {
			name: 'routes.storyEdit.workspace.leftDock'
		});

		await waitFor(() =>
			expect(
				within(leftDock).getByRole('button', {name: /\$score/})
			).toBeInTheDocument()
		);
		within(leftDock)
			.getByRole('button', {name: /\$score/})
			.click();

		expect(dialogsDispatch).toHaveBeenCalledWith({
			type: 'addDialog',
			component: StorySearchDialog,
			props: {
				find: '$score',
				flags: {
					includePassageNames: false,
					matchCase: false,
					useRegexes: false
				},
				replace: '',
				storyId: story.id
			}
		});
	});

	it('routes asset manager insertion through the project host', async () => {
		const {storyDispatch} = renderComponent('text');

		within(
			screen.getByRole('complementary', {
				name: 'routes.storyEdit.workspace.leftDock'
			})
		)
			.getByRole('tab', {name: 'routes.storyEdit.workspace.assets'})
			.click();

		await waitFor(() =>
			expect(screen.getByRole('button', {name: 'Insert'})).toBeInTheDocument()
		);
		screen.getByRole('button', {name: 'Insert'}).click();

		expect(storyDispatch).toHaveBeenCalledWith(
			expect.objectContaining({
				actions: [expect.objectContaining({type: 'updatePassage'})],
				type: 'applyCorePatchBatch'
			})
		);
	});

	it('keeps asset management in the full asset route', () => {
		renderComponent('text');

		within(
			screen.getByRole('complementary', {
				name: 'routes.storyEdit.workspace.leftDock'
			})
		)
			.getByRole('tab', {name: 'routes.storyEdit.workspace.assets'})
			.click();

		expect(
			screen.getByRole('button', {name: 'Asset Manager'})
		).toBeInTheDocument();
		expect(screen.queryByRole('button', {name: 'Import Asset'})).toBeNull();
		expect(screen.queryByRole('button', {name: 'Rename'})).toBeNull();
		expect(screen.queryByRole('button', {name: 'Delete'})).toBeNull();
	});

	it('handles asset snippet copy side effects from host patches', async () => {
		const copyText = jest.fn();

		(window as any).twineElectron = {copyText};
		renderComponent('text');

		within(
			screen.getByRole('complementary', {
				name: 'routes.storyEdit.workspace.leftDock'
			})
		)
			.getByRole('tab', {name: 'routes.storyEdit.workspace.assets'})
			.click();

		await waitFor(() =>
			expect(
				screen.getByRole('button', {name: 'Copy Snippet'})
			).toBeInTheDocument()
		);
		screen.getByRole('button', {name: 'Copy Snippet'}).click();
		expect(copyText).toHaveBeenCalledWith(
			'<img src="assets/cover.png" alt="">'
		);
	});

	it('dispatches executable diagnostic quick fixes', async () => {
		const {story, storyDispatch} = renderComponent('text');

		await waitFor(() =>
			expect(
				screen.getByRole('button', {name: /Create "Missing"/})
			).toBeInTheDocument()
		);
		screen.getByRole('button', {name: /Create "Missing"/}).click();
		expect(storyDispatch).toHaveBeenCalledWith(
			expect.objectContaining({
				actions: [
					{
						type: 'createPassage',
						props: expect.objectContaining({
							name: 'Missing',
							tags: [],
							text: ''
						}),
						storyId: story.id
					}
				],
				type: 'applyCorePatchBatch'
			})
		);
	});

	it('reveals diagnostics in the graph explicitly', async () => {
		const {onRevealPassageInGraph, start} = renderComponent('text');

		await waitFor(() =>
			expect(
				screen.getByRole('button', {
					name: 'routes.storyEdit.workspace.revealInGraph'
				})
			).toBeInTheDocument()
		);
		screen
			.getByRole('button', {
				name: 'routes.storyEdit.workspace.revealInGraph'
			})
			.click();

		expect(onRevealPassageInGraph).toHaveBeenCalledWith(start);
	});
});
