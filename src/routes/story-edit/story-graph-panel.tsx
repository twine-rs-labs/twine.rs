import classNames from 'classnames';
import * as React from 'react';
import {DraggableCore, DraggableData, DraggableEvent} from 'react-draggable';
import {
	Badge,
	Button,
	IconButton,
	PassageNode,
	SegmentedControl,
	TablerIcon
} from '../../components/design-system';
import {
	movePassagesCommand,
	saveGeneratedLayoutCommand,
	useCoreProjectHost
} from '../../core';
import type {CoreGraphEdge} from '../../core/bindings/CoreGraphEdge';
import type {CoreGraphLayoutState} from '../../core/bindings/CoreGraphLayoutState';
import type {CoreGraphNode} from '../../core/bindings/CoreGraphNode';
import type {CoreLinkLayerOptions} from '../../core/bindings/CoreLinkLayerOptions';
import type {CoreRect} from '../../core/bindings/CoreRect';
import {Passage, Story} from '../../store/stories';
import {Point, rectsIntersect} from '../../util/geometry';

export interface StoryGraphPanelProps {
	onCreate: (point: Point) => void;
	onDeselect: (passage: Passage) => void;
	onEdit: (passage: Passage) => void;
	onSelect: (passage: Passage, exclusive: boolean) => void;
	selectedPassageId?: string;
	story: Story;
	visibleZoom: number;
	zoom: number;
}

type GraphDensity = 'structure' | 'names' | 'excerpt';

interface DragState {
	ids: string[];
	left: number;
	startLeft: number;
	startTop: number;
	top: number;
}

interface ViewportState {
	height: number;
	left: number;
	top: number;
	width: number;
}

const minimapSize = {height: 120, width: 170};
const nodeVisualSize = {height: 110, width: 184};
const canvasPad = 900;

function excerpt(text: string) {
	const compact = text.replace(/\s+/g, ' ').trim();

	return compact.length > 160 ? `${compact.slice(0, 157)}...` : compact;
}

function passageForNode(story: Story, node: CoreGraphNode) {
	return story.passages.find(passage => passage.id === node.id);
}

function visualRect(rect: CoreRect): CoreRect {
	return {
		...rect,
		height: Math.max(rect.height, nodeVisualSize.height),
		width: Math.max(rect.width, nodeVisualSize.width)
	};
}

function passageRect(passage: Passage): CoreRect {
	return {
		height: passage.height,
		left: passage.left,
		top: passage.top,
		width: passage.width
	};
}

function edgePath(edge: CoreGraphEdge, nodeById: Map<string, CoreGraphNode>) {
	const source = visualRect(
		nodeById.get(edge.sourceId)?.bounds ?? edge.sourceBounds
	);
	const sourceRight = source.left + source.width;
	const sourceMiddle = source.top + source.height / 2;

	if (edge.kind === 'selfLink') {
		const top = source.top + 18;
		const right = sourceRight + 42;
		const bottom = source.top + source.height - 18;

		return `M ${sourceRight - 14} ${top} C ${right} ${top} ${right} ${bottom} ${sourceRight - 14} ${bottom}`;
	}

	if (!edge.targetId || !edge.targetBounds) {
		const targetLeft = sourceRight + 92;
		const targetTop = Math.max(source.top - 34, 14);

		return `M ${sourceRight} ${sourceMiddle} C ${sourceRight + 52} ${sourceMiddle} ${targetLeft - 20} ${targetTop} ${targetLeft} ${targetTop}`;
	}

	const target = visualRect(
		nodeById.get(edge.targetId)?.bounds ?? edge.targetBounds
	);
	const targetLeft = target.left;
	const targetMiddle = target.top + target.height / 2;
	const bend = Math.max(Math.abs(targetLeft - sourceRight) * 0.45, 70);

	return `M ${sourceRight} ${sourceMiddle} C ${sourceRight + bend} ${sourceMiddle} ${targetLeft - bend} ${targetMiddle} ${targetLeft} ${targetMiddle}`;
}

function layoutBadgeTone(state: CoreGraphLayoutState) {
	return state === 'saved'
		? 'saved'
		: state === 'generated'
			? 'generated'
			: state === 'missing'
				? 'error'
				: 'dirty';
}

function nodeTone(node: CoreGraphNode) {
	if (node.isUnreachable) {
		return 'story-edit-graph-node--unreachable';
	}

	if (node.isOrphan) {
		return 'story-edit-graph-node--orphan';
	}

	if (node.isEmpty) {
		return 'story-edit-graph-node--empty';
	}

	return undefined;
}

function snapBounds(story: Story, bounds: CoreRect): CoreRect {
	if (!story.snapToGrid) {
		return bounds;
	}

	return {
		...bounds,
		left: Math.round(bounds.left / 25) * 25,
		top: Math.round(bounds.top / 25) * 25
	};
}

function eventHasModifier(event: DraggableEvent | React.MouseEvent) {
	return (
		'shiftKey' in event && (event.shiftKey || event.ctrlKey || event.metaKey)
	);
}

function selectedIdKey(ids: string[]) {
	return ids.join('\u0000');
}

function minimapTransform(bounds: CoreRect | null) {
	if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
		return {scale: 1, x: 0, y: 0};
	}

	const scale = Math.min(
		minimapSize.width / Math.max(bounds.width, 1),
		minimapSize.height / Math.max(bounds.height, 1)
	);

	return {
		scale,
		x: -bounds.left * scale,
		y: -bounds.top * scale
	};
}

export const StoryGraphPanel: React.FC<StoryGraphPanelProps> = props => {
	const {
		onCreate,
		onDeselect,
		onEdit,
		onSelect,
		selectedPassageId,
		story,
		visibleZoom,
		zoom
	} = props;
	const host = useCoreProjectHost();
	const [density, setDensity] = React.useState<GraphDensity>('excerpt');
	const [focusSelection, setFocusSelection] = React.useState(false);
	const [layers, setLayers] = React.useState<CoreLinkLayerOptions>({
		broken: true,
		resolved: true,
		selfLinks: true
	});
	const [drag, setDrag] = React.useState<DragState>();
	const [viewport, setViewport] = React.useState<ViewportState>({
		height: 1,
		left: 0,
		top: 0,
		width: 1
	});
	const viewportRef = React.useRef<HTMLDivElement>(null);
	const canvasRef = React.useRef<HTMLDivElement>(null);
	const minimapRef = React.useRef<HTMLDivElement>(null);
	const lastAutoCenteredSelection = React.useRef<string>();
	const optimisticSelectedIds = React.useRef<Set<string>>();
	const selectionHandledOnPointerDown = React.useRef<string>();
	const [optimisticSelectionKey, setOptimisticSelectionKey] =
		React.useState('');
	const panRef = React.useRef<{
		left: number;
		moved: boolean;
		pointerId: number;
		startLeft: number;
		startTop: number;
		top: number;
		x: number;
		y: number;
	}>();
	const minimapDragRef = React.useRef<number>();
	const recentlyDragged = React.useRef(false);
	const selectedPassageIds = React.useMemo(() => {
		const selectedIds = story.passages
			.filter(passage => passage.selected)
			.map(passage => passage.id);

		return selectedIds.length > 0
			? selectedIds
			: selectedPassageId
				? [selectedPassageId]
				: [];
	}, [selectedPassageId, story.passages]);
	const persistedSelectionKey = React.useMemo(
		() => selectedIdKey(selectedPassageIds),
		[selectedPassageIds]
	);
	const selectedIdSet = React.useMemo(
		() => optimisticSelectedIds.current ?? new Set(selectedPassageIds),
		[optimisticSelectionKey, persistedSelectionKey, selectedPassageIds]
	);
	const selectedPassage = selectedPassageId
		? story.passages.find(passage => passage.id === selectedPassageId)
		: undefined;
	const measuredViewport =
		viewport.height > 1 && viewport.width > 1 ? viewport : null;
	const selectedPassageInViewport =
		!selectedPassage ||
		!measuredViewport ||
		rectsIntersect(visualRect(passageRect(selectedPassage)), measuredViewport);
	const queryViewport =
		focusSelection || !selectedPassageInViewport ? null : measuredViewport;
	const projection = React.useMemo(
		() =>
			host.queryGraphProjection(story.id, {
				focus:
					focusSelection && selectedPassageIds.length > 0
						? {
								direction: 'both',
								passageIds: selectedPassageIds,
								radius: 1
							}
						: null,
				layers,
				viewport: queryViewport
			}),
		[
			focusSelection,
			host,
			layers,
			queryViewport,
			selectedPassageIds,
			story.id,
			story
		]
	);
	const nodeById = React.useMemo(
		() => new Map(projection.nodes.map(node => [node.id, node])),
		[projection.nodes]
	);
	const liveNodeById = React.useMemo(() => {
		if (!drag) {
			return nodeById;
		}

		const deltaLeft = (drag.left - drag.startLeft) / visibleZoom;
		const deltaTop = (drag.top - drag.startTop) / visibleZoom;
		const dragIds = new Set(drag.ids);

		return new Map(
			projection.nodes.map(node => [
				node.id,
				dragIds.has(node.id)
					? {
							...node,
							bounds: {
								...node.bounds,
								left: node.bounds.left + deltaLeft,
								top: node.bounds.top + deltaTop
							}
						}
					: node
			])
		);
	}, [drag, nodeById, projection.nodes, visibleZoom]);
	const canvasSize = React.useMemo(() => {
		const bounds = projection.bounds;

		return {
			height: Math.max(
				viewport.height,
				(bounds ? bounds.top + bounds.height : 0) + canvasPad / visibleZoom
			),
			width: Math.max(
				viewport.width,
				(bounds ? bounds.left + bounds.width : 0) + canvasPad / visibleZoom
			)
		};
	}, [projection.bounds, viewport.height, viewport.width, visibleZoom]);
	const minimap = React.useMemo(
		() => minimapTransform(projection.bounds),
		[projection.bounds]
	);

	const updateViewport = React.useCallback(() => {
		const element = viewportRef.current;

		if (!element) {
			return;
		}

		setViewport({
			height: element.clientHeight / visibleZoom,
			left: element.scrollLeft / visibleZoom,
			top: element.scrollTop / visibleZoom,
			width: element.clientWidth / visibleZoom
		});
	}, [visibleZoom]);

	React.useEffect(() => {
		updateViewport();
		window.addEventListener('resize', updateViewport);

		return () => window.removeEventListener('resize', updateViewport);
	}, [updateViewport]);

	React.useEffect(() => {
		const element = viewportRef.current;

		if (!element) {
			return;
		}

		element.addEventListener('scroll', updateViewport, {passive: true});

		return () => element.removeEventListener('scroll', updateViewport);
	}, [updateViewport]);

	React.useEffect(() => {
		optimisticSelectedIds.current = undefined;
		setOptimisticSelectionKey('');
	}, [persistedSelectionKey]);

	React.useEffect(() => {
		const element = viewportRef.current;
		const node = selectedPassageId
			? nodeById.get(selectedPassageId)
			: undefined;

		if (!selectedPassageId) {
			lastAutoCenteredSelection.current = undefined;
			return;
		}

		if (
			!element ||
			!node ||
			lastAutoCenteredSelection.current === selectedPassageId
		) {
			return;
		}

		lastAutoCenteredSelection.current = selectedPassageId;

		const bounds = visualRect(node.bounds);
		const left =
			(bounds.left + bounds.width / 2) * visibleZoom - element.clientWidth / 2;
		const top =
			(bounds.top + bounds.height / 2) * visibleZoom - element.clientHeight / 2;

		if (typeof element.scrollTo === 'function') {
			element.scrollTo({
				left: Math.max(left, 0),
				top: Math.max(top, 0)
			});
		} else {
			element.scrollLeft = Math.max(left, 0);
			element.scrollTop = Math.max(top, 0);
		}
	}, [nodeById, selectedPassageId, visibleZoom]);

	function pointFromEvent(
		event: React.MouseEvent<HTMLElement>
	): Point | undefined {
		if (
			!canvasRef.current ||
			(event.target as HTMLElement).closest(
				'.story-edit-graph-node, .story-edit-graph-toolbar, .story-edit-graph-status, .story-edit-graph-minimap'
			)
		) {
			return undefined;
		}

		const bounds = canvasRef.current.getBoundingClientRect();

		return {
			left: Math.max((event.clientX - bounds.left) / visibleZoom, 0),
			top: Math.max((event.clientY - bounds.top) / visibleZoom, 0)
		};
	}

	function handleCreateAtEvent(event: React.MouseEvent<HTMLDivElement>) {
		const point = pointFromEvent(event);

		if (point) {
			onCreate(point);
		}
	}

	function handleContextMenu(event: React.MouseEvent<HTMLDivElement>) {
		const point = pointFromEvent(event);

		if (point && !panRef.current?.moved) {
			event.preventDefault();
			onCreate(point);
		}
	}

	function handleViewportPointerDown(
		event: React.PointerEvent<HTMLDivElement>
	) {
		if (
			event.button !== 2 ||
			(event.target as HTMLElement).closest(
				'.story-edit-graph-node, .story-edit-graph-toolbar, .story-edit-graph-status, .story-edit-graph-minimap'
			)
		) {
			return;
		}

		const element = viewportRef.current;

		if (!element) {
			return;
		}

		panRef.current = {
			left: element.scrollLeft,
			moved: false,
			pointerId: event.pointerId,
			startLeft: element.scrollLeft,
			startTop: element.scrollTop,
			top: element.scrollTop,
			x: event.clientX,
			y: event.clientY
		};
		element.setPointerCapture(event.pointerId);
		element.classList.add('story-edit-graph-viewport--panning');
		event.preventDefault();
	}

	function handleViewportPointerMove(
		event: React.PointerEvent<HTMLDivElement>
	) {
		const pan = panRef.current;
		const element = viewportRef.current;

		if (!pan || !element) {
			return;
		}

		element.scrollLeft = pan.left + (pan.x - event.clientX);
		element.scrollTop = pan.top + (pan.y - event.clientY);
		pan.moved =
			Math.abs(element.scrollLeft - pan.startLeft) > 3 ||
			Math.abs(element.scrollTop - pan.startTop) > 3;
		event.preventDefault();
	}

	function stopPanning(event: React.PointerEvent<HTMLDivElement>) {
		const element = viewportRef.current;

		if (element && panRef.current?.pointerId === event.pointerId) {
			element.releasePointerCapture(event.pointerId);
			element.classList.remove('story-edit-graph-viewport--panning');
		}

		panRef.current = undefined;
	}

	function centerViewportOnMinimapPoint(clientX: number, clientY: number) {
		const viewportElement = viewportRef.current;
		const minimapElement = minimapRef.current;

		if (!viewportElement || !minimapElement || !projection.bounds) {
			return;
		}

		const rect = minimapElement.getBoundingClientRect();
		const localLeft = Math.max(0, Math.min(clientX - rect.left, rect.width));
		const localTop = Math.max(0, Math.min(clientY - rect.top, rect.height));
		const logicalLeft = (localLeft - minimap.x) / minimap.scale;
		const logicalTop = (localTop - minimap.y) / minimap.scale;
		const nextLeft = (logicalLeft - viewport.width / 2) * visibleZoom;
		const nextTop = (logicalTop - viewport.height / 2) * visibleZoom;

		viewportElement.scrollLeft = Math.max(0, nextLeft);
		viewportElement.scrollTop = Math.max(0, nextTop);
		updateViewport();
	}

	function handleMinimapPointerDown(event: React.PointerEvent<HTMLDivElement>) {
		if (event.button !== 0) {
			return;
		}

		minimapDragRef.current = event.pointerId;
		event.currentTarget.setPointerCapture(event.pointerId);
		centerViewportOnMinimapPoint(event.clientX, event.clientY);
		event.preventDefault();
		event.stopPropagation();
	}

	function handleMinimapPointerMove(event: React.PointerEvent<HTMLDivElement>) {
		if (minimapDragRef.current !== event.pointerId) {
			return;
		}

		centerViewportOnMinimapPoint(event.clientX, event.clientY);
		event.preventDefault();
		event.stopPropagation();
	}

	function stopMinimapDrag(event: React.PointerEvent<HTMLDivElement>) {
		if (minimapDragRef.current !== event.pointerId) {
			return;
		}

		event.currentTarget.releasePointerCapture(event.pointerId);
		minimapDragRef.current = undefined;
		event.preventDefault();
		event.stopPropagation();
	}

	function updateOptimisticSelection(ids: Set<string>) {
		optimisticSelectedIds.current = ids;
		setOptimisticSelectionKey(selectedIdKey(Array.from(ids).sort()));
	}

	function nextSelectionIds(
		event: DraggableEvent | React.MouseEvent,
		passage: Passage
	) {
		const current = new Set(
			optimisticSelectedIds.current ?? selectedPassageIds
		);

		if (eventHasModifier(event)) {
			if (current.has(passage.id)) {
				current.delete(passage.id);
				onDeselect(passage);
			} else {
				current.add(passage.id);
				onSelect(passage, false);
			}
		} else {
			current.clear();
			current.add(passage.id);
			onSelect(passage, true);
		}

		return current;
	}

	function handleNodePress(
		node: CoreGraphNode,
		event: DraggableEvent | React.MouseEvent
	) {
		const passage = passageForNode(story, node);

		if (!passage) {
			return undefined;
		}

		const next = nextSelectionIds(event, passage);

		updateOptimisticSelection(next);
		return next;
	}

	function handleDragStart(
		node: CoreGraphNode,
		event: DraggableEvent,
		data: DraggableData
	) {
		const passage = passageForNode(story, node);

		if (!passage) {
			return;
		}

		const selectedForDrag =
			optimisticSelectedIds.current ?? handleNodePress(node, event);

		document.body.classList.add('dragging-passages');

		const ids =
			selectedForDrag?.has(passage.id) && selectedForDrag.size > 0
				? Array.from(selectedForDrag)
				: [node.id];

		setDrag({
			ids,
			left: data.x,
			startLeft: data.x,
			startTop: data.y,
			top: data.y
		});
	}

	function handleDrag(data: DraggableData) {
		setDrag(current =>
			current ? {...current, left: data.x, top: data.y} : current
		);
	}

	function handleDragStop() {
		document.body.classList.remove('dragging-passages');
		setDrag(current => {
			if (!current) {
				return undefined;
			}

			const deltaLeft = (current.left - current.startLeft) / zoom;
			const deltaTop = (current.top - current.startTop) / zoom;

			if (Math.abs(deltaLeft) >= 1 || Math.abs(deltaTop) >= 1) {
				const moves = current.ids
					.map(id => nodeById.get(id))
					.filter((node): node is CoreGraphNode => !!node)
					.map(node => ({
						bounds: snapBounds(story, {
							...node.bounds,
							left: Math.max(node.bounds.left + deltaLeft, 0),
							top: Math.max(node.bounds.top + deltaTop, 0)
						}),
						passageId: node.id
					}));

				if (moves.length > 0) {
					host.applyStoryCommand(movePassagesCommand(story.id, moves));
				}
			}

			recentlyDragged.current = true;
			window.setTimeout(() => {
				recentlyDragged.current = false;
			}, 0);
			return undefined;
		});
	}

	function handleNodeClick(node: CoreGraphNode, event: React.MouseEvent) {
		const passage = passageForNode(story, node);

		if (!passage || recentlyDragged.current) {
			return;
		}

		if (selectionHandledOnPointerDown.current === node.id) {
			selectionHandledOnPointerDown.current = undefined;
			return;
		}

		handleNodePress(node, event);
	}

	function handleNodePointerDown(
		node: CoreGraphNode,
		event: React.PointerEvent<HTMLDivElement>
	) {
		if (event.button !== 0) {
			return;
		}

		selectionHandledOnPointerDown.current = node.id;
		handleNodePress(node, event as unknown as React.MouseEvent);
	}

	function handleNodeDoubleClick(node: CoreGraphNode) {
		const passage = passageForNode(story, node);

		if (passage) {
			onEdit(passage);
		}
	}

	function nodeDragOffset(node: CoreGraphNode) {
		return drag?.ids.includes(node.id)
			? {
					left: (drag.left - drag.startLeft) / visibleZoom,
					top: (drag.top - drag.startTop) / visibleZoom
				}
			: {left: 0, top: 0};
	}

	return (
		<section className="story-edit-graph-layer" aria-label="Story graph">
			<div
				className="story-edit-graph-viewport"
				onContextMenu={handleContextMenu}
				onDoubleClick={handleCreateAtEvent}
				onPointerDown={handleViewportPointerDown}
				onPointerMove={handleViewportPointerMove}
				onPointerUp={stopPanning}
				onPointerCancel={stopPanning}
				ref={viewportRef}
			>
				<div
					className="story-edit-graph-canvas"
					ref={canvasRef}
					style={{
						height: canvasSize.height,
						transform: `scale(${visibleZoom})`,
						width: canvasSize.width
					}}
				>
					<svg
						aria-hidden
						className="story-edit-graph-edges"
						height={canvasSize.height}
						width={canvasSize.width}
					>
						<defs>
							<marker
								id="story-edit-graph-arrow"
								markerHeight="8"
								markerWidth="8"
								orient="auto"
								refX="8"
								refY="4"
								viewBox="0 0 8 8"
							>
								<path d="M 0 0 L 8 4 L 0 8 z" />
							</marker>
						</defs>
						{projection.edges.map((edge, index) => (
							<path
								className={`story-edit-graph-edge story-edit-graph-edge--${edge.kind}`}
								d={edgePath(edge, liveNodeById)}
								data-kind={edge.kind}
								key={`${edge.sourceId}:${edge.targetId ?? 'broken'}:${edge.targetName}:${index}`}
								markerEnd="url(#story-edit-graph-arrow)"
							/>
						))}
					</svg>
					<div className="story-edit-graph-nodes">
						{projection.nodes.map(node => {
							const passage = passageForNode(story, node);
							const offset = nodeDragOffset(node);
							const tagColors = node.tags.map(
								tag => story.tagColors[tag] ?? 'blue'
							);
							const accent = tagColors[0];

							if (!passage) {
								return null;
							}

							return (
								<DraggableCore
									key={node.id}
									onDrag={(event, data) => handleDrag(data)}
									onStart={(event, data) => handleDragStart(node, event, data)}
									onStop={handleDragStop}
								>
									<div
										className="story-edit-graph-node"
										data-layout-source={node.layoutSource}
										data-passage-id={node.id}
										data-selected={selectedIdSet.has(node.id)}
										onPointerDown={event => handleNodePointerDown(node, event)}
										style={{
											left: node.bounds.left + offset.left,
											top: node.bounds.top + offset.top
										}}
									>
										<PassageNode
											accent={accent}
											broken={node.brokenLinkCount}
											className={classNames(
												nodeTone(node),
												drag?.ids.includes(node.id) &&
													'story-edit-graph-node--dragging',
												node.layoutSource === 'generated' &&
													'story-edit-graph-node--generated'
											)}
											excerpt={
												density === 'excerpt'
													? excerpt(passage.text)
													: undefined
											}
											links={node.outgoingCount}
											onClick={event => handleNodeClick(node, event)}
											onDoubleClick={() => handleNodeDoubleClick(node)}
											selected={selectedIdSet.has(node.id)}
											start={node.isStart}
											tags={density === 'structure' ? [] : tagColors}
											title={node.name}
										/>
									</div>
								</DraggableCore>
							);
						})}
					</div>
				</div>
			</div>
			<div
				className="story-edit-graph-toolbar"
				onContextMenu={event => event.stopPropagation()}
				onDoubleClick={event => event.stopPropagation()}
				onPointerDown={event => event.stopPropagation()}
			>
				<div className="story-edit-graph-toolbar-group">
					<IconButton
						active={layers.resolved}
						icon="link"
						label="Resolved links"
						onClick={() =>
							setLayers(current => ({
								...current,
								resolved: !current.resolved
							}))
						}
						size="sm"
					/>
					<IconButton
						active={layers.broken}
						icon="unlink"
						label="Broken links"
						onClick={() =>
							setLayers(current => ({...current, broken: !current.broken}))
						}
						size="sm"
					/>
					<IconButton
						active={layers.selfLinks}
						icon="refresh"
						label="Self links"
						onClick={() =>
							setLayers(current => ({
								...current,
								selfLinks: !current.selfLinks
							}))
						}
						size="sm"
					/>
					<IconButton
						active={focusSelection}
						disabled={selectedPassageIds.length === 0}
						icon="focus-2"
						label="Focus selected passages"
						onClick={() => setFocusSelection(value => !value)}
						size="sm"
						tooltipPosition="bottom"
					/>
				</div>
				<SegmentedControl
					onChange={value => setDensity(value as GraphDensity)}
					options={[
						{icon: 'binary-tree', label: 'Structure', value: 'structure'},
						{icon: 'file-text', label: 'Names', value: 'names'},
						{icon: 'writing', label: 'Excerpt', value: 'excerpt'}
					]}
					size="sm"
					value={density}
				/>
			</div>
			<div className="story-edit-graph-status">
				<Badge mono tone={layoutBadgeTone(projection.layoutState)}>
					{projection.layoutState}
				</Badge>
				<span>
					<TablerIcon icon="files" />
					{projection.stats.passages}
				</span>
				<span>
					<TablerIcon icon="link" />
					{projection.stats.resolvedLinks}
				</span>
				{projection.stats.brokenLinks > 0 && (
					<span className="story-edit-graph-status-broken">
						<TablerIcon icon="unlink" />
						{projection.stats.brokenLinks}
					</span>
				)}
				<Button
					icon="download"
					onClick={() =>
						host.applyStoryCommand(saveGeneratedLayoutCommand(story.id))
					}
					size="sm"
					variant="ghost"
				>
					Save Layout
				</Button>
			</div>
			{projection.bounds && (
				<div
					aria-hidden
					className="story-edit-graph-minimap"
					onContextMenu={event => event.stopPropagation()}
					onDoubleClick={event => event.stopPropagation()}
					onPointerCancel={stopMinimapDrag}
					onPointerDown={handleMinimapPointerDown}
					onPointerMove={handleMinimapPointerMove}
					onPointerUp={stopMinimapDrag}
					ref={minimapRef}
				>
					<div className="story-edit-graph-minimap__surface">
						{projection.nodes.map(node => (
							<span
								className={classNames(
									'story-edit-graph-minimap__node',
									node.id === selectedPassageId &&
										'story-edit-graph-minimap__node--selected'
								)}
								key={node.id}
								style={{
									height: Math.max(3, node.bounds.height * minimap.scale),
									left: node.bounds.left * minimap.scale + minimap.x,
									top: node.bounds.top * minimap.scale + minimap.y,
									width: Math.max(4, node.bounds.width * minimap.scale)
								}}
							/>
						))}
						<span
							className="story-edit-graph-minimap__viewport"
							style={{
								height: viewport.height * minimap.scale,
								left: viewport.left * minimap.scale + minimap.x,
								top: viewport.top * minimap.scale + minimap.y,
								width: viewport.width * minimap.scale
							}}
						/>
					</div>
				</div>
			)}
		</section>
	);
};
