import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import {StoreCoreProjectHost} from '../../../core/project-host';
import {StoriesContext} from '../../../store/stories';
import {UndoableStoriesContext} from '../../../store/undoable-stories';
import {fakePassage, fakeStory} from '../../../test-util';
import {StoryGraphPanel} from '../story-graph-panel';

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
	configure?: (context: ReturnType<typeof graphStory>) => void
) {
	const {next, start, story} = graphStory(generatedLayout);

	configure?.({next, start, story});

	const onCreate = jest.fn();
	const onDeselect = jest.fn();
	const onEdit = jest.fn();
	const onSelect = jest.fn();
	const onTestPassage = jest.fn();
	const storiesDispatch = jest.fn();
	const undoableDispatch = jest.fn();
	const result = render(
		<StoriesContext.Provider
			value={{dispatch: storiesDispatch, stories: [story]}}
		>
			<UndoableStoriesContext.Provider
				value={{
					dispatch: undoableDispatch,
					isUndoable: true,
					stories: [story]
				}}
			>
				<StoryGraphPanel
					onCreate={onCreate}
					onDeselect={onDeselect}
					onEdit={onEdit}
					onSelect={onSelect}
					onTestPassage={onTestPassage}
					selectedPassageId={start.id}
					story={story}
					visibleZoom={1}
					zoom={1}
				/>
			</UndoableStoriesContext.Provider>
		</StoriesContext.Provider>
	);

	return {
		next,
		onCreate,
		onDeselect,
		onEdit,
		onSelect,
		onTestPassage,
		result,
		start,
		storiesDispatch,
		story,
		undoableDispatch
	};
}

function nodeButton(container: HTMLElement, passageId: string) {
	return container.querySelector(
		`[data-passage-id="${passageId}"] .tw-node`
	) as HTMLElement;
}

describe('<StoryGraphPanel>', () => {
	afterEach(() => {
		window.localStorage.clear();
		jest.restoreAllMocks();
	});

	it('renders passage nodes and projected link edges', () => {
		const {result} = renderComponent();

		expect(nodeButton(result.container, 'start')).toHaveTextContent('Start');
		expect(
			screen.getByRole('button', {name: 'Resize Start'})
		).toBeInTheDocument();
		expect(nodeButton(result.container, 'next')).toHaveTextContent('Next');
		expect(screen.getByText('saved')).toBeInTheDocument();
		expect(
			screen.getByTestId('story-graph-edges-canvas')
		).toHaveAttribute('data-edge-kinds', expect.stringContaining('resolved'));
		expect(screen.getByTestId('story-graph-edges-canvas')).toHaveAttribute(
			'data-edge-kinds',
			expect.stringContaining('broken')
		);
	});

	it('updates link layers from graph toolbar buttons', () => {
		renderComponent();

		fireEvent.click(screen.getByRole('button', {name: 'Broken links'}));

		expect(screen.getByTestId('story-graph-edges-canvas')).toHaveAttribute(
			'data-edge-kinds',
			expect.stringContaining('resolved')
		);
		expect(screen.getByTestId('story-graph-edges-canvas')).not.toHaveAttribute(
			'data-edge-kinds',
			expect.stringContaining('broken')
		);
	});

	it('tests the selected passage from the graph toolbar', () => {
		const {onTestPassage, start} = renderComponent();

		fireEvent.click(screen.getByRole('button', {name: 'Test From Here'}));

		expect(onTestPassage).toHaveBeenCalledWith(start);
	});

	it('passes the measured viewport into graph projection queries', async () => {
		const widthSpy = jest
			.spyOn(HTMLElement.prototype, 'clientWidth', 'get')
			.mockReturnValue(320);
		const heightSpy = jest
			.spyOn(HTMLElement.prototype, 'clientHeight', 'get')
			.mockReturnValue(240);
		const querySpy = jest.spyOn(
			StoreCoreProjectHost.prototype,
			'queryGraphProjection'
		);
		const {story} = renderComponent();

		await waitFor(() =>
			expect(querySpy).toHaveBeenCalledWith(
				story.id,
				expect.objectContaining({
					viewport: expect.objectContaining({
						height: 240,
						left: 0,
						top: 0,
						width: 320
					})
				})
			)
		);

		widthSpy.mockRestore();
		heightSpy.mockRestore();
	});

	it('focuses every selected passage when graph focus is enabled', async () => {
		const querySpy = jest.spyOn(
			StoreCoreProjectHost.prototype,
			'queryGraphProjection'
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
		const minimap = result.container.querySelector(
			'.story-edit-graph-minimap'
		) as HTMLElement;
		const viewport = result.container.querySelector(
			'.story-edit-graph-viewport'
		) as HTMLElement;

		await waitFor(() => expect(minimap).toBeTruthy());
		fireEvent.pointerDown(
			minimap,
			new PointerEvent('pointerdown', {
				button: 0,
				clientX: 20,
				clientY: 60,
				pointerId: 8
			})
		);
		expect(viewport.scrollLeft).toBe(0);

		fireEvent.pointerMove(
			minimap,
			new PointerEvent('pointermove', {
				button: 0,
				clientX: 160,
				clientY: 60,
				pointerId: 8
			})
		);

		expect(viewport.scrollLeft).toBeGreaterThan(0);

		widthSpy.mockRestore();
		heightSpy.mockRestore();
		rectSpy.mockRestore();
	});

	it('pans the graph viewport by dragging empty graph space', () => {
		const {result} = renderComponent();
		const viewport = result.container.querySelector(
			'.story-edit-graph-viewport'
		) as HTMLElement;
		const startLeft = viewport.scrollLeft;
		const startTop = viewport.scrollTop;

		fireEvent.pointerDown(
			viewport,
			new PointerEvent('pointerdown', {
				button: 0,
				clientX: 120,
				clientY: 110,
				pointerId: 9
			})
		);
		fireEvent.pointerMove(
			viewport,
			new PointerEvent('pointermove', {
				button: 0,
				clientX: 70,
				clientY: 80,
				pointerId: 9
			})
		);

		expect(viewport.scrollLeft).toBe(startLeft + 50);
		expect(viewport.scrollTop).toBe(startTop + 30);
	});

	it('shows pointer-down selection feedback and additive selection immediately', () => {
		const {next, onSelect, result, start} = renderComponent();
		const startNode = result.container.querySelector(
			'[data-passage-id="start"]'
		) as HTMLElement;
		const nextNode = result.container.querySelector(
			'[data-passage-id="next"]'
		) as HTMLElement;

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

	it('selects, edits, and creates passages from graph interactions', () => {
		const {next, onCreate, onEdit, onSelect, result} = renderComponent();
		const nextNode = nodeButton(result.container, 'next');

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
			expect.objectContaining({height: 110, width: 184})
		);
	});

	it('applies the default card size to every selected passage', () => {
		const {story, undoableDispatch} = renderComponent(false, ({next, start}) => {
			start.selected = true;
			next.selected = true;
		});

		fireEvent.change(screen.getByLabelText('Default card size'), {
			target: {value: 'wide'}
		});
		fireEvent.click(screen.getByRole('button', {name: 'Apply'}));

		expect(screen.getByText('2 selected')).toBeInTheDocument();
		expect(undoableDispatch).toHaveBeenCalledWith(
			{
				passageUpdates: {
					next: expect.objectContaining({
						height: 110,
						left: 160,
						top: 0,
						width: 292
					}),
					start: expect.objectContaining({
						height: 110,
						left: 0,
						top: 0,
						width: 292
					})
				},
				storyId: story.id,
				type: 'updatePassages'
			},
			'undoChange.movePassage'
		);
	});

	it('rotates the graph view without changing story layout data', () => {
		const querySpy = jest.spyOn(
			StoreCoreProjectHost.prototype,
			'queryGraphProjection'
		);
		const {story, undoableDispatch} = renderComponent();

		fireEvent.click(
			screen.getByRole('button', {name: 'Rotate view: Left to Right'})
		);

		expect(screen.getByText('Top to Bottom')).toBeInTheDocument();
		expect(undoableDispatch).not.toHaveBeenCalled();
		expect(querySpy).toHaveBeenLastCalledWith(
			story.id,
			expect.objectContaining({viewport: null})
		);
	});

	it('saves generated layout through the core project host', () => {
		const {story, undoableDispatch} = renderComponent(true);

		fireEvent.click(screen.getByRole('button', {name: /Save Layout/}));

		expect(undoableDispatch).toHaveBeenCalledWith(
			{
				passageUpdates: {
					next: expect.objectContaining({
						height: 110,
						left: 424,
						top: 0,
						width: 184
					}),
					start: expect.objectContaining({
						height: 110,
						left: 0,
						top: 0,
						width: 184
					})
				},
				storyId: story.id,
				type: 'updatePassages'
			},
			'undoChange.movePassage'
		);
	});
});
