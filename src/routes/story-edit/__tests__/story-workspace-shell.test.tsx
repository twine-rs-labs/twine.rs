import {
	fireEvent,
	render,
	screen,
	waitFor,
	within
} from '@testing-library/react';
import * as React from 'react';
import {MemoryRouter} from 'react-router';
import {
	CoreProjectHostProvider,
	StoreCoreProjectHost
} from '../../../core/project-host';
import {markProjectStoryHydration} from '../../../store/project-hydration';
import {saveProjectMetadata} from '../../../store/project-metadata';
import {StoriesContext} from '../../../store/stories';
import {fakePassage, fakeStory, waitForMockPromises} from '../../../test-util';
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

async function renderComponent(
	mode: StoryEditMode,
	props?: Partial<React.ComponentProps<typeof StoryWorkspaceShell>>,
	context?: {
		configureStory?: (
			story: ReturnType<typeof storyWithLinkedPassages>['story']
		) => void;
		deferWorkspaceQueries?: boolean;
		onOpenFindReplace?: jest.Mock;
		storyDispatch?: jest.Mock;
	}
) {
	const queryBacklinks = jest.spyOn(
		StoreCoreProjectHost.prototype,
		'queryBacklinksPageAsync'
	);
	const queryDockModel = jest.spyOn(
		StoreCoreProjectHost.prototype,
		'queryWorkbenchDockModelAsync'
	);
	const queryPassageFacts = jest.spyOn(
		StoreCoreProjectHost.prototype,
		'queryPassageLocalFactsAsync'
	);

	if (context?.deferWorkspaceQueries) {
		queryBacklinks.mockImplementation(() => new Promise<never>(() => {}));
		queryDockModel.mockImplementation(() => new Promise<never>(() => {}));
		queryPassageFacts.mockImplementation(() => new Promise<never>(() => {}));
	}
	const {next, start, story} = storyWithLinkedPassages();
	const onSelectPassage = jest.fn();
	const onRevealPassageInGraph = jest.fn();
	const onOpenEditorWindow = jest.fn();
	const onOpenFindReplace = context?.onOpenFindReplace ?? jest.fn();
	const storyDispatch = context?.storyDispatch ?? jest.fn();

	context?.configureStory?.(story);

	render(
		<MemoryRouter>
			<StoriesContext.Provider
				value={{
					dispatch: storyDispatch,
					stories: [story]
				}}
			>
				<CoreProjectHostProvider>
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
						onOpenFindReplace={onOpenFindReplace}
						onRevealPassageInGraph={onRevealPassageInGraph}
						onSelectPassage={onSelectPassage}
						rightDockCollapsed={false}
						selectedPassageId={start.id}
						story={story}
						{...props}
					/>
				</CoreProjectHostProvider>
			</StoriesContext.Provider>
		</MemoryRouter>
	);

	const waitForQueries = async () => {
		await waitForMockPromises(queryBacklinks);
		await waitForMockPromises(queryDockModel);
		await waitForMockPromises(queryPassageFacts);
	};

	if (!screen.queryByRole('progressbar', {name: 'Opening story'})) {
		await waitForQueries();
	}
	return {
		onOpenFindReplace,
		next,
		onOpenEditorWindow,
		onRevealPassageInGraph,
		onSelectPassage,
		start,
		story,
		storyDispatch,
		waitForQueries
	};
}

describe('<StoryWorkspaceShell>', () => {
	beforeEach(() => window.localStorage.clear());

	afterEach(() => {
		jest.restoreAllMocks();
		delete (window as any).twineElectron;
	});

	it('renders only the editor dock in text mode', async () => {
		await renderComponent('text');

		expect(screen.getByTestId('editor-dock')).toBeInTheDocument();
		expect(screen.queryByTestId('graph-panel')).not.toBeInTheDocument();
	});

	it('renders graph and editor dock in split mode', async () => {
		await renderComponent('split');

		expect(screen.getByTestId('graph-panel')).toBeInTheDocument();
		expect(screen.getByTestId('editor-dock')).toBeInTheDocument();
	});

	it('renders one editor window for every open buffer', async () => {
		const {next, start} = await renderComponent('text', {
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

	it('lets an individual editor window be closed', async () => {
		const onCloseEditorWindow = jest.fn();

		await renderComponent('text', {
			editorWindows: [
				{kind: 'passage', passageId: 'start'},
				{kind: 'passage', passageId: 'next'}
			],
			onCloseEditorWindow
		});

		fireEvent.click(screen.getByText('close-passage:start'));
		expect(onCloseEditorWindow).toHaveBeenCalledWith({
			kind: 'passage',
			passageId: 'start'
		});
	});

	it('keeps dock collapse controls active in graph mode', async () => {
		const onChangeLeftDockCollapsed = jest.fn();
		const onChangeRightDockCollapsed = jest.fn();

		await renderComponent('graph', {
			onChangeLeftDockCollapsed,
			onChangeRightDockCollapsed
		});

		fireEvent.click(
			within(
				screen.getByRole('complementary', {
					name: 'routes.storyEdit.workspace.leftDock'
				})
			).getByRole('button', {
				name: 'routes.storyEdit.workspace.collapseDock'
			})
		);
		fireEvent.click(
			within(
				screen.getByRole('complementary', {
					name: 'routes.storyEdit.workspace.rightDock'
				})
			).getByRole('button', {
				name: 'routes.storyEdit.workspace.collapseDock'
			})
		);

		expect(onChangeLeftDockCollapsed).toHaveBeenCalledWith(true);
		expect(onChangeRightDockCollapsed).toHaveBeenCalledWith(true);
	});

	it('marks the active passage in the navigator', async () => {
		await renderComponent('text');

		expect(
			within(
				screen.getByRole('complementary', {
					name: 'routes.storyEdit.workspace.leftDock'
				})
			).getByRole('button', {name: /Start/})
		).toHaveAttribute('aria-current', 'true');
	});

	it('windows large passage navigator lists to viewport-sized row counts', async () => {
		await renderComponent('text', undefined, {
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

	it('navigates to linked passages from the bottom drawer', async () => {
		const {next, onSelectPassage} = await renderComponent('text', {
			bottomDrawerOpen: true
		});

		const drawer = within(
			screen.getByRole('region', {
				name: 'routes.storyEdit.workspace.bottomDrawer'
			})
		);
		const nextButton = await drawer.findByRole('button', {name: 'Next'});

		fireEvent.click(nextButton);
		expect(onSelectPassage).toHaveBeenCalledWith(next);
		expect(screen.getAllByText('Missing').length).toBeGreaterThan(0);
	});

	it('renders named workbench drawer panels with the bound session context', async () => {
		const onChangeBottomDrawerPanel = jest.fn();

		await renderComponent('text', {
			activeBottomDrawerPanelId: 'runtime',
			bottomDrawerOpen: true,
			bottomDrawerPanels: [
				{
					icon: 'bug',
					id: 'runtime',
					render: context => (
						<div data-testid="runtime-panel">
							{context.story.name}:{context.selection.passage?.name}
						</div>
					),
					title: 'Runtime'
				}
			],
			onChangeBottomDrawerPanel
		});

		expect(screen.getByTestId('runtime-panel')).toHaveTextContent(':Start');
		expect(screen.getByRole('tabpanel')).toHaveAttribute(
			'data-workbench-panel',
			'runtime'
		);
		fireEvent.click(
			screen.getByRole('tab', {
				name: 'routes.storyEdit.workspace.bottomDrawer'
			})
		);
		expect(onChangeBottomDrawerPanel).toHaveBeenCalledWith('links');
	});

	it('appends named inspector extensions without replacing core inspection', async () => {
		await renderComponent('text', {
			inspectorExtensions: [
				{
					id: 'runtime-summary',
					render: context => (
						<div data-testid="runtime-inspector">
							{context.selection.passage?.name}
						</div>
					)
				}
			]
		});

		expect(screen.getByTestId('runtime-inspector')).toHaveTextContent('Start');
		expect(
			document.querySelector('[data-workbench-extension="runtime-summary"]')
		).toBeInTheDocument();
		expect(
			screen.getByText('routes.storyEdit.workspace.variables')
		).toBeInTheDocument();
	});

	it('shows indexed contents and project intelligence in the docks', async () => {
		await renderComponent('text');

		expect(
			screen.getByText('routes.storyEdit.workspace.sourceFiles')
		).toBeInTheDocument();
		expect(
			screen.getByText('routes.storyEdit.workspace.variables')
		).toBeInTheDocument();
		expect(
			screen.getAllByText('routes.storyEdit.workspace.assets').length
		).toBeGreaterThan(0);

		fireEvent.click(
			within(
				screen.getByRole('complementary', {
					name: 'routes.storyEdit.workspace.leftDock'
				})
			).getByRole('tab', {name: 'routes.storyEdit.workspace.contents'})
		);

		await waitFor(() => {
			expect(screen.getAllByText('$score').length).toBeGreaterThan(0);
			expect(screen.getAllByText('assets/cover.png').length).toBeGreaterThan(0);
			expect(screen.getAllByText('broken-link').length).toBeGreaterThan(0);
		});
	});

	it('hydrates only the opened project-folder story on demand', async () => {
		const hydrateProjectFolder = jest.fn(async () => ({
			passageTextLoaded: true,
			rootPath: '/native/project.twine.rs',
			stories: [],
			storyIds: []
		}));

		(window as any).twineElectron = {hydrateProjectFolder};
		const {story} = await renderComponent('graph', undefined, {
			deferWorkspaceQueries: true,
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

	it('streams project-folder passage bodies into the core session', async () => {
		const source = storyWithLinkedPassages().story;
		const begin = jest
			.spyOn(StoreCoreProjectHost.prototype, 'beginHydratedProject')
			.mockResolvedValue();
		const append = jest
			.spyOn(StoreCoreProjectHost.prototype, 'appendHydratedProjectPassages')
			.mockResolvedValue();
		const finish = jest
			.spyOn(StoreCoreProjectHost.prototype, 'finishHydratedProject')
			.mockResolvedValue();
		const finishLease = jest.fn(async () => undefined);
		(window as any).twineElectron = {
			beginProjectFolderHydration: jest.fn(async () => ({
				hydrationId: 'lease-1',
				passageCount: source.passages.length,
				rootPath: '/native/project.twine.rs',
				stories: [{...source, passages: []}],
				storyIds: [source.id]
			})),
			finishProjectFolderHydration: finishLease,
			hydrateProjectFolder: jest.fn(),
			readProjectFolderHydrationChunk: jest.fn(async () => ({
				done: true,
				nextCursor: source.passages.length,
				passages: source.passages.map(passage => ({
					passage,
					storyId: source.id
				}))
			}))
		};
		await renderComponent('graph', undefined, {
			deferWorkspaceQueries: true,
			configureStory: currentStory => {
				source.id = currentStory.id;
				source.passages = source.passages.map(passage => ({
					...passage,
					story: currentStory.id
				}));
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

		await waitFor(() => expect(finish).toHaveBeenCalled());
		expect(begin).toHaveBeenCalledWith(expect.any(String), [
			expect.objectContaining({passages: []})
		]);
		expect(append).toHaveBeenCalledWith(
			expect.any(String),
			expect.arrayContaining([
				expect.objectContaining({text: expect.any(String)})
			])
		);
		expect(finishLease).toHaveBeenCalledWith('lease-1');
	});

	it('opens indexed story sources from the contents navigator', async () => {
		const {onOpenEditorWindow} = await renderComponent('text');

		fireEvent.click(
			within(
				screen.getByRole('complementary', {
					name: 'routes.storyEdit.workspace.leftDock'
				})
			).getByRole('tab', {name: 'routes.storyEdit.workspace.contents'})
		);

		const leftDock = screen.getByRole('complementary', {
			name: 'routes.storyEdit.workspace.leftDock'
		});

		await waitFor(() =>
			expect(
				within(leftDock).getByRole('button', {name: /Story JavaScript/})
			).toBeInTheDocument()
		);
		fireEvent.click(
			within(leftDock).getByRole('button', {name: /Story JavaScript/})
		);

		expect(onOpenEditorWindow).toHaveBeenCalledWith({kind: 'script'});
	});

	it('routes variable entries to the find/replace workbench panel', async () => {
		const {onOpenFindReplace} = await renderComponent('text');

		fireEvent.click(
			within(
				screen.getByRole('complementary', {
					name: 'routes.storyEdit.workspace.leftDock'
				})
			).getByRole('tab', {name: 'routes.storyEdit.workspace.contents'})
		);

		const leftDock = screen.getByRole('complementary', {
			name: 'routes.storyEdit.workspace.leftDock'
		});

		await waitFor(() =>
			expect(
				within(leftDock).getByRole('button', {name: /\$score/})
			).toBeInTheDocument()
		);
		fireEvent.click(within(leftDock).getByRole('button', {name: /\$score/}));

		expect(onOpenFindReplace).toHaveBeenCalledWith('$score', {
			includePassageNames: false
		});
	});

	it('routes asset manager insertion through the project host', async () => {
		const {storyDispatch, waitForQueries} = await renderComponent('text');

		fireEvent.click(
			within(
				screen.getByRole('complementary', {
					name: 'routes.storyEdit.workspace.leftDock'
				})
			).getByRole('tab', {name: 'routes.storyEdit.workspace.assets'})
		);

		await waitFor(() =>
			expect(screen.getByRole('button', {name: 'Insert'})).toBeInTheDocument()
		);
		fireEvent.click(screen.getByRole('button', {name: 'Insert'}));
		await waitForQueries();

		expect(storyDispatch).toHaveBeenCalledWith(
			expect.objectContaining({
				actions: [],
				documentUpdates: [
					expect.objectContaining({
						passageId: 'start',
						type: 'passageText'
					})
				],
				type: 'applyCorePatchBatch'
			})
		);
	});

	it('keeps asset management in the full asset route', async () => {
		await renderComponent('text');

		fireEvent.click(
			within(
				screen.getByRole('complementary', {
					name: 'routes.storyEdit.workspace.leftDock'
				})
			).getByRole('tab', {name: 'routes.storyEdit.workspace.assets'})
		);

		expect(
			await screen.findByRole('button', {name: 'Asset Manager'})
		).toBeInTheDocument();
		expect(screen.queryByRole('button', {name: 'Import Asset'})).toBeNull();
		expect(screen.queryByRole('button', {name: 'Rename'})).toBeNull();
		expect(screen.queryByRole('button', {name: 'Delete'})).toBeNull();
	});

	it('handles asset snippet copy side effects from host patches', async () => {
		const copyText = jest.fn();

		(window as any).twineElectron = {copyText};
		const {waitForQueries} = await renderComponent('text');

		fireEvent.click(
			within(
				screen.getByRole('complementary', {
					name: 'routes.storyEdit.workspace.leftDock'
				})
			).getByRole('tab', {name: 'routes.storyEdit.workspace.assets'})
		);

		await waitFor(() =>
			expect(
				screen.getByRole('button', {name: 'Copy Snippet'})
			).toBeInTheDocument()
		);
		fireEvent.click(screen.getByRole('button', {name: 'Copy Snippet'}));
		await waitForQueries();
		expect(copyText).toHaveBeenCalledWith(
			'<img src="assets/cover.png" alt="">'
		);
	});

	it('dispatches executable diagnostic quick fixes', async () => {
		const {story, storyDispatch, waitForQueries} = await renderComponent(
			'text',
			{
				bottomDrawerOpen: true
			}
		);

		await waitFor(() =>
			expect(
				screen.getByRole('button', {name: /Create "Missing"/})
			).toBeInTheDocument()
		);
		fireEvent.click(screen.getByRole('button', {name: /Create "Missing"/}));
		await waitFor(() =>
			expect(storyDispatch).toHaveBeenCalledWith(
				expect.objectContaining({
					actions: [
						{
							type: 'createPassage',
							props: expect.objectContaining({
								name: 'Missing',
								tags: []
							}),
							storyId: story.id
						}
					],
					documentUpdates: [
						expect.objectContaining({
							storyId: story.id,
							text: '',
							type: 'passageText'
						})
					],
					type: 'applyCorePatchBatch'
				})
			)
		);
		await waitForQueries();
	});

	it('reveals diagnostics in the graph explicitly', async () => {
		const {onRevealPassageInGraph, start} = await renderComponent('text', {
			bottomDrawerOpen: true
		});

		await waitFor(() =>
			expect(
				screen.getByRole('button', {
					name: 'routes.storyEdit.workspace.revealInGraph'
				})
			).toBeInTheDocument()
		);
		fireEvent.click(
			screen.getByRole('button', {
				name: 'routes.storyEdit.workspace.revealInGraph'
			})
		);

		expect(onRevealPassageInGraph).toHaveBeenCalledWith(start);
	});
});
