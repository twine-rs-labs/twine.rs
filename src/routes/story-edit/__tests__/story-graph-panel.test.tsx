import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import {StoreCoreProjectHost} from '../../../core/project-host';
import {defaults as prefsDefaults} from '../../../store/prefs/defaults';
import {PrefsContext, PrefsState} from '../../../store/prefs';
import {reducer as prefsReducer} from '../../../store/prefs/reducer';
import {StoriesContext} from '../../../store/stories';
import {fakePassage, fakeStory} from '../../../test-util';
import {StoryGraphPanel} from '../story-graph-panel';
import type {
	StoryGraphWorkspaceOptions,
	StoryGraphWorkspaceView
} from '../workspace-state';

function graphStory(generatedLayout = false) {
	const story = fakeStory(0);
	const invalidLayout = generatedLayout
		? {height: 0, left: Number.NaN, top: Number.NaN, width: 0}
		: {};
	const start = fakePassage({
		height: 100,
		id: 'start',
		left: 0,
		name: 'Start',
		selected: false,
		story: story.id,
		tags: ['scene'],
		text: 'Go to [[Next]] and [[Missing]]',
		top: 0,
		width: 100,
		...invalidLayout
	});
	const next = fakePassage({
		height: 100,
		id: 'next',
		left: 160,
		name: 'Next',
		selected: false,
		story: story.id,
		text: '',
		top: 0,
		width: 100,
		...invalidLayout
	});

	story.passages = [start, next];
	story.startPassage = start.id;
	story.tagColors = {scene: 'red'};
	story.zoom = 1;
	return {next, start, story};
}

function renderComponent(
	generatedLayout = false,
	configure?: (context: ReturnType<typeof graphStory>) => void,
	options: {
		controlledSelection?: boolean;
		selectedPassageId?: string;
		visibleZoom?: number;
		zoom?: number;
		prefs?: Partial<PrefsState>;
		graphOptions?: StoryGraphWorkspaceOptions;
		graphView?: StoryGraphWorkspaceView;
		onGraphOptionsChange?: jest.Mock;
		onGraphViewChange?: jest.Mock;
	} = {}
) {
	const {next, start, story} = graphStory(generatedLayout);

	configure?.({next, start, story});
	story.zoom = options.zoom ?? story.zoom;

	const onCreate = jest.fn();
	const onDeselect = jest.fn();
	const onEdit = jest.fn();
	const onEditPassages = jest.fn();
	const onSelect = jest.fn();
	const onSelectIds = jest.fn();
	const onTestPassage = jest.fn();
	const storiesDispatch = jest.fn();
	const initialSelectedPassageId = options.selectedPassageId ?? start.id;
	const TestProviders: React.FC = ({children}) => {
		const [prefs, prefsDispatch] = React.useReducer(prefsReducer, {
			...prefsDefaults(),
			...options.prefs
		});

		return (
			<PrefsContext.Provider value={{dispatch: prefsDispatch, prefs}}>
				<StoriesContext.Provider
					value={{dispatch: storiesDispatch, stories: [story]}}
				>
					{children}
				</StoriesContext.Provider>
			</PrefsContext.Provider>
		);
	};
	const TestComponent: React.FC = () => {
		const [selectedPassageId, setSelectedPassageId] = React.useState(
			initialSelectedPassageId
		);

		return (
			<TestProviders>
				<StoryGraphPanel
					graphOptions={options.graphOptions}
					graphView={options.graphView}
					onCreate={onCreate}
					onDeselect={onDeselect}
					onEdit={onEdit}
					onEditPassages={onEditPassages}
					onGraphOptionsChange={options.onGraphOptionsChange}
					onGraphViewChange={options.onGraphViewChange}
					onSelect={(passage, solo) => {
						onSelect(passage, solo);

						if (options.controlledSelection) {
							setSelectedPassageId(passage.id);
						}
					}}
					onSelectIds={onSelectIds}
					onTestPassage={onTestPassage}
					selectedPassageId={
						options.controlledSelection
							? selectedPassageId
							: initialSelectedPassageId
					}
					story={story}
				/>
			</TestProviders>
		);
	};
	const result = render(<TestComponent />);

	return {
		next,
		onCreate,
		onDeselect,
		onEdit,
		onEditPassages,
		onSelect,
		onSelectIds,
		onTestPassage,
		result,
		start,
		storiesDispatch,
		story
	};
}

function nodeButton(container: HTMLElement, passageId: string) {
	return container.querySelector(
		`[data-passage-id="${passageId}"] .tw-node`
	) as HTMLElement;
}

// Reads the single world transform (translate(x,y) scale(k)) the graph rides.
function worldView(container: HTMLElement): {k: number; x: number; y: number} {
	const canvas = container.querySelector(
		'.story-edit-graph-canvas'
	) as HTMLElement;
	const match = (canvas?.style.transform ?? '').match(
		/translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\s*\)\s*scale\(\s*([\d.]+)\s*\)/
	);

	if (!match) {
		return {k: NaN, x: NaN, y: NaN};
	}

	return {k: Number(match[3]), x: Number(match[1]), y: Number(match[2])};
}

async function waitForNode(
	container: HTMLElement,
	passageId: string
): Promise<HTMLElement> {
	await waitFor(() => {
		expect(
			container.querySelector(`[data-passage-id="${passageId}"]`)
		).toBeTruthy();
	});

	return container.querySelector(
		`[data-passage-id="${passageId}"]`
	) as HTMLElement;
}

async function waitForNodeButton(
	container: HTMLElement,
	passageId: string
): Promise<HTMLElement> {
	await waitFor(() => {
		expect(nodeButton(container, passageId)).toBeTruthy();
	});

	return nodeButton(container, passageId);
}

describe('<StoryGraphPanel>', () => {
	let applyStoryCommandSpy: jest.SpyInstance;

	beforeEach(() => {
		applyStoryCommandSpy = jest
			.spyOn(StoreCoreProjectHost.prototype, 'applyStoryCommand')
			.mockImplementation(async () => undefined);
	});

	afterEach(() => {
		window.localStorage.clear();
		jest.restoreAllMocks();
	});

	it('renders passage nodes and projected link edges', async () => {
		const {result} = renderComponent();

		expect(
			await waitForNodeButton(result.container, 'start')
		).toHaveTextContent('Start');
		expect(
			await screen.findByRole('button', {name: 'Resize Start'})
		).toBeInTheDocument();
		expect(nodeButton(result.container, 'next')).toHaveTextContent('Next');
		expect(screen.getByText('saved')).toBeInTheDocument();
		await waitFor(() =>
			expect(screen.getByTestId('story-graph-edges-canvas')).toHaveAttribute(
				'data-edge-kinds',
				expect.stringContaining('resolved')
			)
		);
		expect(screen.getByTestId('story-graph-edges-canvas')).toHaveAttribute(
			'data-edge-kinds',
			expect.stringContaining('broken')
		);
		expect(screen.getByTestId('story-graph-edges-canvas')).toHaveAttribute(
			'data-selected-node-count',
			'1'
		);
		expect(screen.getByTestId('story-graph-edges-canvas')).toHaveAttribute(
			'data-connected-edge-count',
			'2'
		);
	});

	it('renders passage tag names when the tag display preference asks for names', async () => {
		const {result} = renderComponent(false, undefined, {
			prefs: {passageTagDisplay: 'name'}
		});
		const startNode = await waitForNodeButton(result.container, 'start');

		expect(startNode.querySelector('.tw-node__tag-name')).toHaveTextContent(
			'scene'
		);
	});

	it('anchors link edges to the actual passage card bounds', async () => {
		renderComponent(false, ({next, start}) => {
			start.height = 92;
			start.width = 150;
			next.height = 148;
			next.left = 210;
			next.width = 240;
		});

		await waitFor(() =>
			expect(screen.getByTestId('story-graph-edges-canvas')).toHaveAttribute(
				'data-edge-routes',
				expect.stringContaining('start->next:150,46>210,74')
			)
		);
	});

	it('updates link layers from graph toolbar buttons', async () => {
		renderComponent();

		fireEvent.click(screen.getByRole('button', {name: 'Broken links'}));

		await waitFor(() =>
			expect(screen.getByTestId('story-graph-edges-canvas')).toHaveAttribute(
				'data-edge-kinds',
				expect.stringContaining('resolved')
			)
		);
		expect(screen.getByTestId('story-graph-edges-canvas')).not.toHaveAttribute(
			'data-edge-kinds',
			expect.stringContaining('broken')
		);
	});

	it('keeps the current projection visible while the next Rust query is pending', async () => {
		const {result} = renderComponent();

		const startButton = await waitForNodeButton(result.container, 'start');

		expect(startButton).toHaveTextContent('Start');

		jest
			.spyOn(StoreCoreProjectHost.prototype, 'queryGraphProjectionAsync')
			.mockImplementation(() => new Promise(() => {}));

		fireEvent.click(screen.getByRole('button', {name: 'Broken links'}));

		expect(nodeButton(result.container, 'start')).toHaveTextContent('Start');
	});

	it('tests the selected passage from the graph toolbar', () => {
		const {onTestPassage, start} = renderComponent();

		fireEvent.click(screen.getByRole('button', {name: 'Test From Here'}));

		expect(onTestPassage).toHaveBeenCalledWith(start);
	});

	it('passes a buffered measured viewport into graph projection queries', async () => {
		const widthSpy = jest
			.spyOn(HTMLElement.prototype, 'clientWidth', 'get')
			.mockReturnValue(320);
		const heightSpy = jest
			.spyOn(HTMLElement.prototype, 'clientHeight', 'get')
			.mockReturnValue(240);
		const querySpy = jest.spyOn(
			StoreCoreProjectHost.prototype,
			'queryGraphProjectionAsync'
		);
		const {story} = renderComponent();

		await waitFor(() =>
			expect(querySpy).toHaveBeenCalledWith(
				story.id,
				expect.objectContaining({
					viewport: expect.objectContaining({
						height: 1800,
						left: 0,
						top: 0,
						width: 1800
					})
				})
			)
		);

		widthSpy.mockRestore();
		heightSpy.mockRestore();
	});

	it('keeps graph projection viewport-bounded when the selected passage is offscreen', async () => {
		const widthSpy = jest
			.spyOn(HTMLElement.prototype, 'clientWidth', 'get')
			.mockReturnValue(320);
		const heightSpy = jest
			.spyOn(HTMLElement.prototype, 'clientHeight', 'get')
			.mockReturnValue(240);
		const querySpy = jest.spyOn(
			StoreCoreProjectHost.prototype,
			'queryGraphProjectionAsync'
		);
		const {story} = renderComponent(
			false,
			({next}) => {
				next.left = 5600;
				next.top = 4200;
			},
			{selectedPassageId: 'next'}
		);

		await waitFor(() =>
			expect(querySpy).toHaveBeenCalledWith(
				story.id,
				expect.objectContaining({
					viewport: expect.objectContaining({
						height: 1800,
						left: 0,
						top: 0,
						width: 1800
					})
				})
			)
		);

		const viewportQueries = querySpy.mock.calls.flatMap(([storyId, query]) =>
			storyId === story.id && query ? [query.viewport] : []
		);

		expect(viewportQueries).not.toContain(null);

		widthSpy.mockRestore();
		heightSpy.mockRestore();
	});

	it('rides a single translate+scale world transform with origin 0 0', async () => {
		const {result} = renderComponent();

		await waitForNode(result.container, 'start');

		// The world layer is moved/zoomed by one transform; there is no scroll
		// extent and the transform origin is the world origin.
		const canvas = result.container.querySelector(
			'.story-edit-graph-canvas'
		) as HTMLElement;

		expect(canvas.style.transformOrigin).toBe('0 0');
		expect(worldView(result.container)).toEqual({k: 1, x: 80, y: 60});
	});

	it('restores graph workspace view, tool, layers, focus, and density', async () => {
		const querySpy = jest.spyOn(
			StoreCoreProjectHost.prototype,
			'queryGraphProjectionAsync'
		);
		const {result, start, story} = renderComponent(
			false,
			({start}) => {
				start.selected = true;
			},
			{
				graphOptions: {
					density: 'structure',
					focusSelection: true,
					layers: {broken: false, resolved: true, selfLinks: false},
					orientation: 'right',
					tool: 'pan'
				},
				graphView: {k: 1.4, x: -140, y: 90},
				zoom: 1.4
			}
		);

		await waitForNode(result.container, 'start');

		expect(worldView(result.container)).toEqual({k: 1.4, x: -140, y: 90});
		expect(
			screen.getByRole('button', {name: 'Pan tool (H, or hold Space)'})
		).toHaveAttribute('aria-pressed', 'true');
		expect(
			screen.getByRole('button', {name: 'Select tool (V)'})
		).not.toHaveAttribute('aria-pressed', 'true');
		expect(
			screen.getByRole('button', {name: 'Broken links'})
		).not.toHaveAttribute('aria-pressed', 'true');
		expect(
			screen.getByRole('button', {name: 'Self links'})
		).not.toHaveAttribute('aria-pressed', 'true');
		expect(screen.getByRole('tab', {name: /Structure/})).toHaveAttribute(
			'aria-selected',
			'true'
		);
		await waitFor(() =>
			expect(querySpy).toHaveBeenCalledWith(
				story.id,
				expect.objectContaining({
					focus: expect.objectContaining({
						passageIds: [start.id]
					}),
					layers: expect.objectContaining({
						broken: false,
						resolved: true,
						selfLinks: false
					}),
					viewport: null
				})
			)
		);
	});

	it('uses a bounded initial graph projection before viewport measurement', () => {
		const querySpy = jest.spyOn(
			StoreCoreProjectHost.prototype,
			'queryGraphProjectionAsync'
		);
		const {story} = renderComponent();

		expect(querySpy).toHaveBeenCalledWith(
			story.id,
			expect.objectContaining({
				viewport: expect.objectContaining({
					height: 1,
					left: 0,
					top: 0,
					width: 1
				})
			})
		);
	});

	it('keeps the edge canvas backing store bounded at low zoom', async () => {
		const widthSpy = jest
			.spyOn(HTMLElement.prototype, 'clientWidth', 'get')
			.mockReturnValue(1200);
		const heightSpy = jest
			.spyOn(HTMLElement.prototype, 'clientHeight', 'get')
			.mockReturnValue(800);
		const devicePixelRatio = Object.getOwnPropertyDescriptor(
			window,
			'devicePixelRatio'
		);

		Object.defineProperty(window, 'devicePixelRatio', {
			configurable: true,
			value: 1
		});

		try {
			renderComponent(false, undefined, {visibleZoom: 0.3, zoom: 0.3});

			const canvas = screen.getByTestId(
				'story-graph-edges-canvas'
			) as HTMLCanvasElement;

			await waitFor(() =>
				expect(parseFloat(canvas.style.width)).toBeGreaterThan(5000)
			);

			const cssWidth = parseFloat(canvas.style.width);

			expect(cssWidth).toBeCloseTo(5400, 0);
			expect(canvas.width).toBe(Math.ceil(cssWidth * 0.3));
			expect(canvas.width).toBeLessThan(cssWidth);
		} finally {
			if (devicePixelRatio) {
				Object.defineProperty(window, 'devicePixelRatio', devicePixelRatio);
			}

			widthSpy.mockRestore();
			heightSpy.mockRestore();
		}
	});

	it('focuses every selected passage when graph focus is enabled', async () => {
		const querySpy = jest.spyOn(
			StoreCoreProjectHost.prototype,
			'queryGraphProjectionAsync'
		);
		const {start, story} = renderComponent(false, ({next, start}) => {
			start.selected = true;
			next.selected = true;
		});

		fireEvent.click(
			screen.getByRole('button', {name: 'Focus selected passages'})
		);

		await waitFor(() =>
			expect(querySpy).toHaveBeenCalledWith(
				story.id,
				expect.objectContaining({
					focus: expect.objectContaining({
						direction: 'both',
						passageIds: [start.id, 'next'],
						radius: 1
					}),
					viewport: null
				})
			)
		);
	});

	it('pans the graph viewport from the minimap preview', async () => {
		const widthSpy = jest
			.spyOn(HTMLElement.prototype, 'clientWidth', 'get')
			.mockReturnValue(320);
		const heightSpy = jest
			.spyOn(HTMLElement.prototype, 'clientHeight', 'get')
			.mockReturnValue(240);
		const rectSpy = jest
			.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
			.mockReturnValue({
				bottom: 120,
				height: 120,
				left: 0,
				right: 170,
				toJSON: () => ({}),
				top: 0,
				width: 170,
				x: 0,
				y: 0
			});
		const {result} = renderComponent();
		let minimap: HTMLElement | null = null;

		await waitFor(() => {
			minimap = result.container.querySelector('.story-edit-graph-minimap');
			expect(minimap).toBeTruthy();
		});

		const before = worldView(result.container);

		fireEvent.pointerDown(
			minimap!,
			new PointerEvent('pointerdown', {
				button: 0,
				clientX: 20,
				clientY: 60,
				pointerId: 8
			})
		);
		fireEvent.pointerMove(
			minimap!,
			new PointerEvent('pointermove', {
				button: 0,
				clientX: 160,
				clientY: 60,
				pointerId: 8
			})
		);

		// Clicking the minimap re-anchors the world transform (no scrolling).
		const after = worldView(result.container);

		expect(after.x).not.toBe(before.x);
		expect(Number.isFinite(after.x)).toBe(true);

		widthSpy.mockRestore();
		heightSpy.mockRestore();
		rectSpy.mockRestore();
	});

	it('pans the world transform with a middle-button drag', () => {
		const {result} = renderComponent();
		const viewport = result.container.querySelector(
			'.story-edit-graph-viewport'
		) as HTMLElement;
		const start = worldView(result.container);

		// Middle-button (or Space / pan tool) pans; a plain left-drag marquees.
		fireEvent.pointerDown(
			viewport,
			new PointerEvent('pointerdown', {
				button: 1,
				clientX: 120,
				clientY: 110,
				pointerId: 9
			})
		);
		expect(viewport).toHaveClass('story-edit-graph-viewport--panning');
		fireEvent.pointerMove(
			viewport,
			new PointerEvent('pointermove', {
				button: 1,
				clientX: 70,
				clientY: 80,
				pointerId: 9
			})
		);

		// Pan moves the world 1:1 with the pointer: clientX 120→70 = -50.
		const after = worldView(result.container);

		expect(after.x).toBe(start.x - 50);
		expect(after.y).toBe(start.y - 30);
	});

	it('persists graph workspace view through the debounced callback', async () => {
		const onGraphViewChange = jest.fn();
		const {result} = renderComponent(false, undefined, {onGraphViewChange});
		const viewport = result.container.querySelector(
			'.story-edit-graph-viewport'
		) as HTMLElement;
		const start = worldView(result.container);

		fireEvent.pointerDown(
			viewport,
			new PointerEvent('pointerdown', {
				button: 1,
				clientX: 120,
				clientY: 110,
				pointerId: 9
			})
		);
		fireEvent.pointerMove(
			viewport,
			new PointerEvent('pointermove', {
				button: 1,
				clientX: 70,
				clientY: 80,
				pointerId: 9
			})
		);

		await waitFor(() =>
			expect(onGraphViewChange).toHaveBeenCalledWith({
				k: start.k,
				x: start.x - 50,
				y: start.y - 30
			})
		);
	});

	it('persists graph workspace options when toolbar state changes', async () => {
		const onGraphOptionsChange = jest.fn();

		renderComponent(false, undefined, {onGraphOptionsChange});
		onGraphOptionsChange.mockClear();

		fireEvent.click(
			screen.getByRole('button', {name: 'Pan tool (H, or hold Space)'})
		);
		fireEvent.click(screen.getByRole('button', {name: 'Broken links'}));
		fireEvent.click(screen.getByRole('tab', {name: /Names/}));

		await waitFor(() =>
			expect(onGraphOptionsChange).toHaveBeenCalledWith(
				expect.objectContaining({
					density: 'names',
					layers: expect.objectContaining({broken: false}),
					tool: 'pan'
				})
			)
		);
	});

	it('shows pointer-down selection feedback and additive selection immediately', async () => {
		const {next, onSelect, result, start} = renderComponent();
		const startNode = await waitForNode(result.container, 'start');
		const nextNode = await waitForNode(result.container, 'next');

		fireEvent.pointerDown(
			startNode,
			new PointerEvent('pointerdown', {
				button: 0,
				pointerId: 12
			})
		);

		expect(startNode).toHaveAttribute('data-selected', 'true');
		expect(onSelect).toHaveBeenCalledWith(start, true);

		fireEvent.pointerDown(
			nextNode,
			new PointerEvent('pointerdown', {
				button: 0,
				pointerId: 13,
				shiftKey: true
			})
		);

		expect(startNode).toHaveAttribute('data-selected', 'true');
		expect(nextNode).toHaveAttribute('data-selected', 'true');
		expect(onSelect).toHaveBeenCalledWith(next, false);
	});

	it('does not move the world transform when graph node selection updates state', async () => {
		const {next, onSelect, result} = renderComponent(false, undefined, {
			controlledSelection: true
		});
		const nextNode = await waitForNode(result.container, 'next');
		const before = worldView(result.container);

		fireEvent.pointerDown(
			nextNode,
			new PointerEvent('pointerdown', {
				button: 0,
				pointerId: 15
			})
		);

		await waitFor(() => expect(onSelect).toHaveBeenCalledWith(next, true));
		await new Promise(resolve => window.setTimeout(resolve, 0));

		// Selection has no side effect on the viewport (no jump/jiggle).
		expect(worldView(result.container)).toEqual(before);
	});

	it('selects groups with a shift-drag marquee over the graph', async () => {
		const {onSelectIds, result} = renderComponent();
		const viewport = result.container.querySelector(
			'.story-edit-graph-viewport'
		) as HTMLElement;
		const startNode = await waitForNode(result.container, 'start');
		const nextNode = await waitForNode(result.container, 'next');

		fireEvent.keyDown(window, {key: 'Shift'});
		expect(viewport).toHaveClass('story-edit-graph-viewport--selecting-mode');

		fireEvent.pointerDown(
			viewport,
			new PointerEvent('pointerdown', {
				button: 0,
				clientX: 0,
				clientY: 0,
				pointerId: 14,
				shiftKey: true
			})
		);
		fireEvent.pointerMove(
			viewport,
			new PointerEvent('pointermove', {
				button: 0,
				clientX: 270,
				clientY: 120,
				pointerId: 14,
				shiftKey: true
			})
		);

		expect(startNode).toHaveAttribute('data-selected', 'true');
		expect(nextNode).toHaveAttribute('data-selected', 'true');

		fireEvent.pointerUp(
			viewport,
			new PointerEvent('pointerup', {
				button: 0,
				clientX: 270,
				clientY: 120,
				pointerId: 14,
				shiftKey: true
			})
		);
		fireEvent.keyUp(window, {key: 'Shift'});

		expect(onSelectIds).toHaveBeenCalledWith(
			expect.arrayContaining(['start', 'next']),
			true
		);
	});

	it('selects, edits, and creates passages from graph interactions', async () => {
		const {next, onCreate, onEdit, onSelect, result} = renderComponent();
		const nextNode = await waitForNodeButton(result.container, 'next');

		fireEvent.click(nextNode);
		expect(onSelect).toHaveBeenCalledWith(next, true);

		fireEvent.doubleClick(nextNode);
		expect(onEdit).toHaveBeenCalledWith(next);

		fireEvent.doubleClick(
			result.container.querySelector('.story-edit-graph-viewport')!,
			{clientX: 220, clientY: 180}
		);
		expect(onCreate).toHaveBeenCalledWith(
			{left: 220, top: 180},
			expect.objectContaining({height: 100, width: 100})
		);
	});

	it('does not create passages from right-click when the preference is disabled', () => {
		const {onCreate, result} = renderComponent(false, undefined, {
			prefs: {graphRightClickCreatePassage: false}
		});
		const viewport = result.container.querySelector(
			'.story-edit-graph-viewport'
		) as HTMLElement;

		fireEvent.contextMenu(viewport, {clientX: 220, clientY: 180});

		expect(onCreate).not.toHaveBeenCalled();
	});

	it('snaps dragged graph passages to the visible graph grid', async () => {
		const {result, story} = renderComponent(false, ({start, story}) => {
			start.left = 0;
			start.top = 0;
			story.snapToGrid = true;
		});
		const startNode = await waitForNode(result.container, 'start');

		fireEvent.mouseDown(startNode, {button: 0, clientX: 0, clientY: 0});
		fireEvent.mouseMove(document, {clientX: 17, clientY: 18});

		await waitFor(() => {
			expect(startNode.style.left).toBe('25px');
			expect(startNode.style.top).toBe('25px');
		});

		fireEvent.mouseUp(document, {clientX: 17, clientY: 18});

		await waitFor(() =>
			expect(applyStoryCommandSpy).toHaveBeenCalledWith({
				moves: [
					{
						bounds: expect.objectContaining({
							left: 25,
							top: 25
						}),
						passageId: 'start'
					}
				],
				story_id: story.id,
				type: 'movePassages'
			})
		);
	});

	it('does not snap graph passages before drag activation', async () => {
		const {result} = renderComponent(false, ({start, story}) => {
			start.left = 12;
			start.top = 13;
			story.snapToGrid = true;
		});
		const startNode = await waitForNode(result.container, 'start');

		fireEvent.mouseDown(startNode, {button: 0, clientX: 0, clientY: 0});
		fireEvent.mouseMove(document, {clientX: 2, clientY: 2});

		expect(startNode.style.left).toBe('12px');
		expect(startNode.style.top).toBe('13px');

		fireEvent.mouseUp(document, {clientX: 2, clientY: 2});

		expect(applyStoryCommandSpy).not.toHaveBeenCalledWith(
			expect.objectContaining({type: 'movePassages'})
		);
	});

	it('shows and toggles the story snap grid state from the graph toolbar', () => {
		const {result, story} = renderComponent(false, ({story}) => {
			story.snapToGrid = true;
		});
		const graphLayer = result.container.querySelector(
			'.story-edit-graph-layer'
		) as HTMLElement;

		expect(graphLayer).toHaveClass('story-edit-graph-layer--snap-on');
		expect(
			graphLayer.style.getPropertyValue('--story-edit-snap-grid-size')
		).toBe('25px');
		expect(
			graphLayer.style.getPropertyValue('--story-edit-snap-major-grid-size')
		).toBe('125px');

		fireEvent.click(screen.getByRole('button', {name: 'Snap to grid'}));

		expect(applyStoryCommandSpy).toHaveBeenCalledWith({
			enabled: false,
			story_id: story.id,
			type: 'setStorySnapToGrid'
		});
	});

	it('saves dragged graph passages using the live zoom', async () => {
		const {result, story} = renderComponent(
			false,
			({start}) => {
				start.left = 0;
				start.top = 0;
			},
			{zoom: 0.5}
		);
		const startNode = await waitForNode(result.container, 'start');

		fireEvent.mouseDown(startNode, {button: 0, clientX: 0, clientY: 0});
		fireEvent.mouseMove(document, {clientX: 26, clientY: 0});
		fireEvent.mouseUp(document, {clientX: 26, clientY: 0});

		await waitFor(() => expect(startNode.style.left).toBe('52px'));
		expect(startNode.style.top).toBe('0px');

		await waitFor(() =>
			expect(applyStoryCommandSpy).toHaveBeenCalledWith({
				moves: [
					{
						bounds: expect.objectContaining({
							left: 52,
							top: 0
						}),
						passageId: 'start'
					}
				],
				story_id: story.id,
				type: 'movePassages'
			})
		);
	});

	it('zooms the world toward the cursor on the wheel without scrolling', () => {
		const {result} = renderComponent();
		const viewport = result.container.querySelector(
			'.story-edit-graph-viewport'
		) as HTMLElement;
		const before = worldView(result.container);

		fireEvent.wheel(viewport, {clientX: 120, clientY: 100, deltaY: -100});

		// Continuous zoom in increases scale; the move is anchored, not scrolled.
		const after = worldView(result.container);

		expect(after.k).toBeGreaterThan(before.k);
		expect(viewport.scrollLeft).toBe(0);
		expect(viewport.scrollTop).toBe(0);
	});

	it('keeps the live zoom when the story prop refreshes before graph view persistence', () => {
		const {story} = graphStory();
		const storedGraphView = {k: 1, x: 80, y: 60};
		const onCreate = jest.fn();
		const onDeselect = jest.fn();
		const onEdit = jest.fn();
		const onEditPassages = jest.fn();
		const onSelect = jest.fn();
		const onSelectIds = jest.fn();
		const TestComponent: React.FC = () => {
			const [currentStory, setCurrentStory] = React.useState(story);

			return (
				<PrefsContext.Provider
					value={{dispatch: jest.fn(), prefs: prefsDefaults()}}
				>
					<StoriesContext.Provider
						value={{dispatch: jest.fn(), stories: [currentStory]}}
					>
						<>
							<button
								onClick={() =>
									setCurrentStory(current => ({
										...current,
										script: `${current.script} `
									}))
								}
								type="button"
							>
								Refresh story
							</button>
							<StoryGraphPanel
								graphView={storedGraphView}
								onCreate={onCreate}
								onDeselect={onDeselect}
								onEdit={onEdit}
								onEditPassages={onEditPassages}
								onSelect={onSelect}
								onSelectIds={onSelectIds}
								selectedPassageId="start"
								story={currentStory}
							/>
						</>
					</StoriesContext.Provider>
				</PrefsContext.Provider>
			);
		};
		const result = render(<TestComponent />);

		fireEvent.click(screen.getByRole('button', {name: 'Zoom in'}));
		const zoomed = worldView(result.container);

		expect(zoomed.k).toBeGreaterThan(1);

		fireEvent.click(screen.getByRole('button', {name: 'Refresh story'}));

		expect(worldView(result.container)).toEqual(zoomed);
	});

	it('persists the zoom level back to the core after a wheel zoom (debounced)', async () => {
		const {result, story} = renderComponent();
		const viewport = result.container.querySelector(
			'.story-edit-graph-viewport'
		) as HTMLElement;

		fireEvent.wheel(viewport, {clientX: 120, clientY: 100, deltaY: -100});

		await waitFor(() =>
			expect(applyStoryCommandSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					story_id: story.id,
					type: 'setStoryZoom',
					zoom: expect.any(Number)
				})
			)
		);

		const zoomCall = applyStoryCommandSpy.mock.calls.find(
			([command]) => command.type === 'setStoryZoom'
		);

		expect(zoomCall?.[0].zoom).toBeGreaterThan(1);
	});

	it('edits selected passages from the graph context menu', async () => {
		const {next, onEditPassages, result, start} = renderComponent(
			false,
			context => {
				context.start.selected = true;
				context.next.selected = true;
			}
		);
		const nextNode = await waitForNodeButton(result.container, 'next');

		fireEvent.contextMenu(nextNode, {clientX: 200, clientY: 160});
		fireEvent.click(screen.getByRole('button', {name: 'Edit 2 passages'}));

		expect(onEditPassages).toHaveBeenCalledWith([start, next]);
	});

	it('applies the default card size to every selected passage', async () => {
		const {story} = renderComponent(false, ({next, start}) => {
			start.selected = true;
			next.selected = true;
		});

		fireEvent.change(screen.getByLabelText('Default card size'), {
			target: {value: 'wide'}
		});
		await waitFor(() =>
			expect(screen.getByLabelText('Default card size')).toHaveValue('wide')
		);
		fireEvent.click(screen.getByRole('button', {name: 'Apply'}));

		expect(screen.getByText('2 selected')).toBeInTheDocument();
		expect(applyStoryCommandSpy).toHaveBeenCalledWith({
			moves: [
				{
					bounds: expect.objectContaining({
						height: 110,
						left: 0,
						top: 0,
						width: 292
					}),
					passageId: 'start'
				},
				{
					bounds: expect.objectContaining({
						height: 110,
						left: 160,
						top: 0,
						width: 292
					}),
					passageId: 'next'
				}
			],
			story_id: story.id,
			type: 'movePassages'
		});
	});

	it('resizes graph passages continuously from the handle', async () => {
		const {story} = renderComponent();
		const resizeHandle = await screen.findByRole('button', {
			name: 'Resize Start'
		});

		fireEvent.mouseDown(resizeHandle, {button: 0, clientX: 200, clientY: 160});
		fireEvent.mouseMove(document, {clientX: 430, clientY: 162});
		fireEvent.mouseUp(document, {clientX: 430, clientY: 162});

		await waitFor(() =>
			expect(applyStoryCommandSpy).toHaveBeenCalledWith({
				moves: [
					{
						bounds: expect.objectContaining({
							height: 102,
							left: 0,
							top: 0,
							width: 330
						}),
						passageId: 'start'
					}
				],
				story_id: story.id,
				type: 'movePassages'
			})
		);
	});

	it('does not render graph orientation controls', () => {
		const {storiesDispatch} = renderComponent();

		expect(
			screen.queryByRole('button', {name: /Rotate view/})
		).not.toBeInTheDocument();
		expect(screen.queryByText('Left to Right')).not.toBeInTheDocument();
		expect(screen.queryByText('Top to Bottom')).not.toBeInTheDocument();
		expect(applyStoryCommandSpy).not.toHaveBeenCalled();
		expect(storiesDispatch).not.toHaveBeenCalled();
	});

	it('saves generated layout through the core project host', () => {
		const {story} = renderComponent(true);

		fireEvent.click(screen.getByRole('button', {name: /Save Layout/}));

		expect(applyStoryCommandSpy).toHaveBeenCalledWith({
			story_id: story.id,
			type: 'saveGeneratedLayout'
		});
	});
});
