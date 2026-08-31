import {
	act,
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
	ProjectScopedCoreProjectHost,
	StoreCoreProjectHost
} from '../../../test-util/core-project-host-runtime';
import {
	markProjectStoryHydration,
	projectStoryHydration
} from '../../../store/project-hydration';
import {saveProjectMetadata} from '../../../store/project-metadata';
import {StoriesContext} from '../../../store/stories';
import {fakePassage, fakeStory, waitForMockPromises} from '../../../test-util';
import {workbenchBufferCoordinator} from '../../../util/workbench-buffer-coordinator';
import {StoryWorkspaceShell} from '../story-workspace-shell';
import {StoryEditMode} from '../workspace-state';

jest.mock('../editor-dock', () => ({
	EditorDock: ({
		onClose,
		onLocalBufferChange,
		windows
	}: {
		onClose?: (spec: any) => void;
		onLocalBufferChange?: () => void;
		windows: any[];
	}) => (
		<div data-testid="editor-dock">
			{onLocalBufferChange && (
				<button onClick={onLocalBufferChange}>
					simulate-local-buffer-change
				</button>
			)}
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
		strictMode?: boolean;
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

	const tree = (
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
	const rendered = render(
		context?.strictMode ? <React.StrictMode>{tree}</React.StrictMode> : tree
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
		unmount: rendered.unmount,
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

	it('finds standard passage-link references and reveals the exact source passage', async () => {
		const {next, onOpenEditorWindow, onSelectPassage, start} =
			await renderComponent('text', {selectedPassageId: 'next'});

		fireEvent.click(
			screen.getByRole('button', {
				name: 'routes.storyEdit.workspace.findReferences'
			})
		);
		expect(
			await screen.findByRole('dialog', {
				name: 'components.passageReferences.title'
			})
		).toBeInTheDocument();
		expect(
			await screen.findByRole('heading', {name: start.name})
		).toBeVisible();

		fireEvent.click(
			screen.getByRole('button', {
				name: 'components.passageReferences.revealInSource'
			})
		);
		await waitFor(() => expect(onSelectPassage).toHaveBeenCalledWith(start));
		expect(onOpenEditorWindow).toHaveBeenCalledWith({
			kind: 'passage',
			passageId: start.id
		});
		expect(
			screen.queryByRole('dialog', {
				name: 'components.passageReferences.title'
			})
		).not.toBeInTheDocument();
		expect(next.name).toBe('Next');
	});

	it('invalidates visible references as soon as a local editor changes', async () => {
		await renderComponent('text', {selectedPassageId: 'next'});

		fireEvent.click(
			screen.getByRole('button', {
				name: 'routes.storyEdit.workspace.findReferences'
			})
		);
		expect(
			await screen.findByRole('dialog', {
				name: 'components.passageReferences.title'
			})
		).toBeInTheDocument();

		fireEvent.click(
			screen.getByRole('button', {name: 'simulate-local-buffer-change'})
		);
		expect(
			screen.queryByRole('dialog', {
				name: 'components.passageReferences.title'
			})
		).not.toBeInTheDocument();
	});

	it('does not reveal a reference while an editor is composing', async () => {
		const {onSelectPassage, story} = await renderComponent('text', {
			selectedPassageId: 'next'
		});
		fireEvent.click(
			screen.getByRole('button', {
				name: 'routes.storyEdit.workspace.findReferences'
			})
		);
		expect(
			await screen.findByRole('button', {
				name: 'components.passageReferences.revealInSource'
			})
		).toBeInTheDocument();
		const unregister = workbenchBufferCoordinator.register({
			bufferId: 'composing-reveal-source',
			flush: jest.fn(),
			hasPendingChanges: () => true,
			isComposing: () => true,
			revision: () => 1,
			storyId: story.id
		});

		try {
			fireEvent.click(
				screen.getByRole('button', {
					name: 'components.passageReferences.revealInSource'
				})
			);
			expect(
				await screen.findByText('components.passageReferences.revealFailed')
			).toBeInTheDocument();
			expect(onSelectPassage).not.toHaveBeenCalled();
		} finally {
			unregister();
		}
	});

	it('goes to a passage definition only when the exact name is unique', async () => {
		const {next, onSelectPassage} = await renderComponent('text');

		fireEvent.click(
			screen.getByRole('button', {
				name: /Next.*routes\.storyEdit\.workspace\.goToDefinition/
			})
		);
		await waitFor(() => expect(onSelectPassage).toHaveBeenCalledWith(next));
	});

	it('reports ambiguous definitions without selecting a passage', async () => {
		const {onSelectPassage} = await renderComponent('text', undefined, {
			configureStory: story => {
				story.passages.push(
					fakePassage({
						id: 'next-duplicate',
						name: 'Next',
						story: story.id,
						text: ''
					})
				);
			}
		});

		fireEvent.click(
			screen.getByRole('button', {
				name: /Next.*routes\.storyEdit\.workspace\.goToDefinition/
			})
		);
		expect(
			await screen.findByText('routes.storyEdit.workspace.definitionAmbiguous')
		).toBeInTheDocument();
		expect(onSelectPassage).not.toHaveBeenCalled();
	});

	it('drops a late definition result after the workspace unmounts', async () => {
		let resolveDefinition!: (value: {
			location: {
				passageId: string;
				passageName: string;
				provenance: {
					capabilityRevision: number;
					formatName: null;
					formatVersion: null;
					providerIdentifier: string;
				};
				resultKey: string;
				revision: number;
				span: {encoding: 'utf16-code-units'; end: number; start: number};
				storyId: string;
			};
			type: 'unique';
		}) => void;
		const queryDefinition = jest
			.spyOn(StoreCoreProjectHost.prototype, 'queryDefinitionAsync')
			.mockImplementation(
				() =>
					new Promise(resolve => {
						resolveDefinition = resolve;
					})
			);
		const {next, onSelectPassage, story, unmount} =
			await renderComponent('text');

		fireEvent.click(
			screen.getByRole('button', {
				name: /Next.*routes\.storyEdit\.workspace\.goToDefinition/
			})
		);
		await waitFor(() => expect(queryDefinition).toHaveBeenCalledTimes(1));
		unmount();
		await act(async () => {
			resolveDefinition({
				location: {
					passageId: next.id,
					passageName: next.name,
					provenance: {
						capabilityRevision: 1,
						formatName: null,
						formatVersion: null,
						providerIdentifier: 'twine-core.passage-index'
					},
					resultKey: 'late-definition',
					revision: 1,
					span: {encoding: 'utf16-code-units', end: 0, start: 0},
					storyId: story.id
				},
				type: 'unique'
			});
		});

		expect(onSelectPassage).not.toHaveBeenCalled();
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

	it('does not begin native full hydration before replacement admission drains', async () => {
		let releaseReservation!: (lease: symbol) => void;
		const reservation = new Promise<symbol>(resolve => {
			releaseReservation = resolve;
		});
		jest
			.spyOn(
				ProjectScopedCoreProjectHost.prototype,
				'acquireProjectReplacement'
			)
			.mockReturnValue(reservation);
		const hydrateProjectFolder = jest.fn(async () => ({
			passageTextLoaded: true,
			rootPath: '/native/ordered-project.twine.rs',
			stories: [],
			storyIds: []
		}));
		(window as any).twineElectron = {hydrateProjectFolder};
		const {story} = await renderComponent('graph', undefined, {
			deferWorkspaceQueries: true,
			configureStory: currentStory => {
				saveProjectMetadata(currentStory.id, {
					rootPath: '/native/ordered-project.twine.rs',
					status: 'file-backed',
					storageKind: 'electron-project-folder'
				});
				markProjectStoryHydration(currentStory.id, {
					passageTextLoaded: false,
					rootPath: '/native/ordered-project.twine.rs'
				});
			}
		});
		await Promise.resolve();
		expect(hydrateProjectFolder).not.toHaveBeenCalled();
		releaseReservation(Symbol('replacement'));
		await waitFor(() =>
			expect(hydrateProjectFolder).toHaveBeenCalledWith(
				'/native/ordered-project.twine.rs',
				[story.id]
			)
		);
	});

	it('does not begin native streamed hydration before replacement admission drains', async () => {
		let releaseReservation!: (lease: symbol) => void;
		jest
			.spyOn(
				ProjectScopedCoreProjectHost.prototype,
				'acquireProjectReplacement'
			)
			.mockReturnValue(
				new Promise<symbol>(resolve => (releaseReservation = resolve))
			);
		const beginProjectFolderHydration = jest.fn(async () => ({
			hydrationId: 'stream',
			passageTextLoaded: true,
			rootPath: '/native/ordered-stream.twine.rs',
			stories: []
		}));
		(window as any).twineElectron = {
			beginProjectFolderHydration,
			finishProjectFolderHydration: jest.fn(async () => {}),
			readProjectFolderHydrationChunk: jest.fn(async () => ({
				done: true,
				nextCursor: 0,
				passages: []
			}))
		};
		const {story} = await renderComponent('graph', undefined, {
			deferWorkspaceQueries: true,
			configureStory: currentStory => {
				saveProjectMetadata(currentStory.id, {
					rootPath: '/native/ordered-stream.twine.rs',
					status: 'file-backed',
					storageKind: 'electron-project-folder'
				});
				markProjectStoryHydration(currentStory.id, {
					passageTextLoaded: false,
					rootPath: '/native/ordered-stream.twine.rs'
				});
			}
		});
		await Promise.resolve();
		expect(beginProjectFolderHydration).not.toHaveBeenCalled();
		releaseReservation(Symbol('stream-replacement'));
		await waitFor(() =>
			expect(beginProjectFolderHydration).toHaveBeenCalledWith(
				'/native/ordered-stream.twine.rs',
				[story.id]
			)
		);
	});

	it('retains one deferred native stream across a pre-Core effect replay', async () => {
		const source = storyWithLinkedPassages().story;
		let releaseBegin!: (result: any) => void;
		const beginCore = jest
			.spyOn(StoreCoreProjectHost.prototype, 'beginHydratedProject')
			.mockResolvedValue();
		const finishCore = jest
			.spyOn(StoreCoreProjectHost.prototype, 'finishHydratedProject')
			.mockResolvedValue();
		jest
			.spyOn(StoreCoreProjectHost.prototype, 'appendHydratedProjectPassages')
			.mockResolvedValue();
		const finishLease = jest.fn(async () => undefined);
		const beginNative = jest.fn(
			() => new Promise(resolve => (releaseBegin = resolve))
		);
		(window as any).twineElectron = {
			beginProjectFolderHydration: beginNative,
			finishProjectFolderHydration: finishLease,
			readProjectFolderHydrationChunk: jest.fn(async () => ({
				done: true,
				nextCursor: source.passages.length,
				passages: source.passages.map(passage => ({
					passage,
					storyId: source.id
				}))
			}))
		};
		const {story} = await renderComponent('graph', undefined, {
			deferWorkspaceQueries: true,
			strictMode: true,
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
		await waitFor(() => expect(beginNative).toHaveBeenCalledTimes(1));
		releaseBegin({
			hydrationId: 'deferred-lease',
			passageCount: source.passages.length,
			rootPath: '/native/project.twine.rs',
			stories: [{...source, passages: []}],
			storyIds: [source.id]
		});
		await waitFor(() => expect(finishCore).toHaveBeenCalledTimes(1));
		expect(beginCore).toHaveBeenCalledTimes(1);
		expect(finishLease).toHaveBeenCalledWith('deferred-lease');
		expect(projectStoryHydration(story.id)?.passageTextLoaded).toBe(true);
	});

	it('closes a deferred native lease on unmount before Core hydration begins', async () => {
		let releaseBegin!: (result: any) => void;
		const beginCore = jest.spyOn(
			StoreCoreProjectHost.prototype,
			'beginHydratedProject'
		);
		const finishLease = jest.fn(async () => undefined);
		const beginNative = jest.fn(
			() => new Promise(resolve => (releaseBegin = resolve))
		);
		(window as any).twineElectron = {
			beginProjectFolderHydration: beginNative,
			finishProjectFolderHydration: finishLease,
			readProjectFolderHydrationChunk: jest.fn()
		};
		const {story, unmount} = await renderComponent('graph', undefined, {
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
		await waitFor(() => expect(beginNative).toHaveBeenCalledTimes(1));
		unmount();
		releaseBegin({
			hydrationId: 'unmounted-lease',
			passageCount: 0,
			rootPath: '/native/project.twine.rs',
			stories: [],
			storyIds: [story.id]
		});
		await waitFor(() =>
			expect(finishLease).toHaveBeenCalledWith('unmounted-lease')
		);
		expect(beginCore).not.toHaveBeenCalled();
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

	it('aborts a partial core bootstrap and finishes its native lease after a read or append failure', async () => {
		const source = storyWithLinkedPassages().story;
		const abort = jest
			.spyOn(ProjectScopedCoreProjectHost.prototype, 'abortHydratedProject')
			.mockResolvedValue();
		jest
			.spyOn(StoreCoreProjectHost.prototype, 'beginHydratedProject')
			.mockResolvedValue();
		const append = jest
			.spyOn(StoreCoreProjectHost.prototype, 'appendHydratedProjectPassages')
			.mockResolvedValueOnce()
			.mockRejectedValueOnce(new Error('append failed'));
		const finishLease = jest.fn(async () => undefined);
		let read = 0;
		(window as any).twineElectron = {
			beginProjectFolderHydration: jest.fn(async () => ({
				hydrationId: 'failed-lease',
				passageCount: source.passages.length,
				rootPath: '/native/project.twine.rs',
				stories: [{...source, passages: []}],
				storyIds: [source.id]
			})),
			finishProjectFolderHydration: finishLease,
			hydrateProjectFolder: jest.fn(),
			readProjectFolderHydrationChunk: jest.fn(async () => {
				const passage = source.passages[read++];
				return {
					done: read === source.passages.length,
					nextCursor: read,
					passages: [{passage, storyId: source.id}]
				};
			})
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
		await waitFor(() => expect(finishLease).toHaveBeenCalled());
		expect(append.mock.calls.length).toBeGreaterThanOrEqual(2);
		expect(abort).toHaveBeenCalled();
		expect(finishLease).toHaveBeenCalledWith('failed-lease');
	});

	it('aborts a superseded stream without merging or routing a late chunk', async () => {
		const source = storyWithLinkedPassages().story;
		let releaseRead!: (chunk: any) => void;
		const append = jest.spyOn(
			StoreCoreProjectHost.prototype,
			'appendHydratedProjectPassages'
		);
		jest
			.spyOn(StoreCoreProjectHost.prototype, 'beginHydratedProject')
			.mockResolvedValue();
		const abort = jest
			.spyOn(ProjectScopedCoreProjectHost.prototype, 'abortHydratedProject')
			.mockResolvedValue();
		const finishLease = jest.fn(async () => undefined);
		(window as any).twineElectron = {
			beginProjectFolderHydration: jest.fn(async () => ({
				hydrationId: 'superseded-lease',
				passageCount: source.passages.length,
				rootPath: '/native/project.twine.rs',
				stories: [{...source, passages: []}],
				storyIds: [source.id]
			})),
			finishProjectFolderHydration: finishLease,
			hydrateProjectFolder: jest.fn(),
			readProjectFolderHydrationChunk: jest.fn(
				() => new Promise(resolve => (releaseRead = resolve))
			)
		};
		const {story, unmount} = await renderComponent('graph', undefined, {
			deferWorkspaceQueries: true,
			configureStory: currentStory => {
				source.id = currentStory.id;
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
		await waitFor(() =>
			expect(
				(window as any).twineElectron.readProjectFolderHydrationChunk
			).toHaveBeenCalled()
		);
		unmount();
		await waitFor(() =>
			expect(abort).toHaveBeenCalledWith(story.id, expect.any(Symbol))
		);
		releaseRead({
			done: true,
			nextCursor: 1,
			passages: [{passage: source.passages[0], storyId: story.id}]
		});
		await waitFor(() =>
			expect(finishLease).toHaveBeenCalledWith('superseded-lease')
		);
		expect(append).not.toHaveBeenCalled();
		expect(projectStoryHydration(story.id)?.passageTextLoaded).toBe(false);
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

	it('tests the first live asset usage through the shared workbench action', async () => {
		const onTestPassage = jest.fn();
		const {start} = await renderComponent('text', {onTestPassage});

		fireEvent.click(
			within(
				screen.getByRole('complementary', {
					name: 'routes.storyEdit.workspace.leftDock'
				})
			).getByRole('tab', {name: 'routes.storyEdit.workspace.assets'})
		);
		fireEvent.click(
			await screen.findByRole('button', {name: 'Test First Usage'})
		);

		expect(onTestPassage).toHaveBeenCalledWith(start);
	});

	it('shows pending state on matching workbench test actions', async () => {
		const onTestPassage = jest.fn();
		const {start} = await renderComponent('text', {
			onTestPassage,
			testPassagePending: true,
			testPassagePendingId: 'start'
		});
		const inspectorActions = await screen.findAllByRole('button', {
			name: 'routes.storyEdit.toolbar.testFromHere'
		});

		for (const action of inspectorActions) {
			expect(action).toBeDisabled();
			expect(action).toHaveAttribute('aria-busy', 'true');
		}

		fireEvent.click(
			within(
				screen.getByRole('complementary', {
					name: 'routes.storyEdit.workspace.leftDock'
				})
			).getByRole('tab', {name: 'routes.storyEdit.workspace.assets'})
		);
		const assetAction = await screen.findByRole('button', {
			name: 'Test First Usage'
		});

		expect(assetAction).toBeDisabled();
		expect(assetAction).toHaveAttribute('aria-busy', 'true');
		expect(onTestPassage).not.toHaveBeenCalled();
		expect(start.id).toBe('start');
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
				screen.getAllByRole('button', {
					name: 'routes.storyEdit.workspace.revealInGraph'
				})
			).toHaveLength(2)
		);
		fireEvent.click(
			screen.getAllByRole('button', {
				name: 'routes.storyEdit.workspace.revealInGraph'
			})[1]
		);

		expect(onRevealPassageInGraph).toHaveBeenCalledWith(start);
	});
});
