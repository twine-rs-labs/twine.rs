import classNames from 'classnames';
import * as React from 'react';
import {
	DraggableCore as ReactDraggableCore,
	DraggableCoreProps,
	DraggableData,
	DraggableEvent
} from 'react-draggable';
import {
	Badge,
	Button,
	IconButton,
	PassageNode,
	Select,
	SegmentedControl,
	TablerIcon
} from '../../components/design-system';
import {
	emptyGraphProjection,
	movePassagesCommand,
	saveGeneratedLayoutCommand,
	setStorySnapToGridCommand,
	setStoryZoomCommand,
	useCoreProjectHost
} from '../../core';
import {materializeStoryFromSession} from '../../core/materialize-story';
import {setPref, usePrefsContext} from '../../store/prefs';
import type {GraphCardSizePreference} from '../../store/prefs';
import type {CoreGraphLayoutState} from '../../core/bindings/CoreGraphLayoutState';
import type {CoreGraphNode} from '../../core/bindings/CoreGraphNode';
import type {CoreGraphProjection} from '../../core/bindings/CoreGraphProjection';
import type {CoreLinkLayerOptions} from '../../core/bindings/CoreLinkLayerOptions';
import type {CoreRect} from '../../core/bindings/CoreRect';
import type {PatchBatch} from '../../core/bindings/PatchBatch';
import {Passage, Story} from '../../store/stories';
import type {StoryWithDocuments} from '../../store/stories';
import {
	emptyFormatReferenceParser,
	useFormatReferenceParser
} from '../../store/use-format-reference-parser';
import {Point, Rect, rectFromPoints, rectsIntersect} from '../../util/geometry';
import {markPerformanceAfterPaint} from '../../util/performance';
import {
	graphSnapGridSize,
	graphSnapMajorGridSize,
	snapToGraphGrid
} from './graph-grid';
import type {
	StoryGraphDensity,
	StoryGraphLayerOptions,
	StoryGraphOrientation,
	StoryGraphTool,
	StoryGraphWorkspaceOptions,
	StoryGraphWorkspaceView
} from './workspace-state';
import {
	formatReferenceEdges,
	type StoryGraphEdge
} from './format-reference-edges';

function keyedElementRef<ElementType extends HTMLElement>(
	refs: Map<string, React.RefObject<ElementType | null>>,
	key: string
) {
	let ref = refs.get(key);

	if (!ref) {
		ref = React.createRef<ElementType>();
		refs.set(key, ref);
	}

	return ref;
}

const DraggableCore: React.FC<Partial<DraggableCoreProps>> = props =>
	React.createElement(ReactDraggableCore, props);

export interface StoryGraphPanelProps {
	graphOptions?: StoryGraphWorkspaceOptions;
	graphView?: StoryGraphWorkspaceView;
	onCreate: (point: Point, size?: {height: number; width: number}) => void;
	onDeselect: (passage: Passage) => void;
	onEdit: (passage: Passage) => void;
	onEditPassages: (passages: Passage[]) => void;
	onGraphOptionsChange?: React.Dispatch<
		React.SetStateAction<StoryGraphWorkspaceOptions>
	>;
	onGraphViewChange?: React.Dispatch<
		React.SetStateAction<StoryGraphWorkspaceView | undefined>
	>;
	onSelect: (passage: Passage, exclusive: boolean) => void;
	onSelectIds: (passageIds: string[], additive: boolean) => void;
	onTestPassage?: (passage: Passage) => void;
	revealPassageId?: string;
	revealRequestKey?: number;
	selectedPassageId?: string;
	story: Story;
	testPassagePending?: boolean;
	testPassagePendingId?: string;
}

/**
 * The graph viewport is a single transformed "world" layer. Pan changes
 * `x`/`y`; zoom changes `k` while keeping the world point under the cursor
 * pinned. There is no scrolling — see docs/product/workbench.md.
 */
type GraphView = StoryGraphWorkspaceView;
type GraphDensity = StoryGraphDensity;
type GraphOrientation = StoryGraphOrientation;
type GraphTool = StoryGraphTool;
type GraphSizePreset = GraphCardSizePreference;
type ResizeCorner = 'bottom-left' | 'bottom-right' | 'top-left';

const graphSizePresets: Record<
	GraphSizePreset,
	{height: number; label: string; width: number}
> = {
	twine: {height: 100, label: 'Twine 100 x 100', width: 100},
	small: {height: 92, label: 'Small', width: 150},
	narrow: {height: 132, label: 'Narrow', width: 150},
	medium: {height: 110, label: 'Medium', width: 184},
	large: {height: 148, label: 'Large', width: 240},
	tall: {height: 190, label: 'Tall', width: 184},
	wide: {height: 110, label: 'Wide', width: 292}
};

const graphSizePresetEntries = Object.entries(graphSizePresets) as Array<
	[GraphSizePreset, (typeof graphSizePresets)[GraphSizePreset]]
>;

interface DragState {
	ids: string[];
	left: number;
	startLeft: number;
	startTop: number;
	top: number;
}

interface ResizeState {
	currentHeight: number;
	currentWidth: number;
	height: number;
	ids: string[];
	startLeft: number;
	startTop: number;
	width: number;
}

interface MarqueeState {
	additive: boolean;
	pointerId?: number;
	rect: Rect;
	startLeft: number;
	startTop: number;
}

interface ViewportState {
	height: number;
	left: number;
	top: number;
	width: number;
}

interface GraphContextMenuState {
	left: number;
	passageIds: string[];
	point?: Point;
	top: number;
}

interface AsyncProjectionState {
	projection: CoreGraphProjection;
	storyId: string;
}

interface AsyncReferenceStoryState {
	story: StoryWithDocuments;
	storyId: string;
}

interface MinimapTransform {
	scale: number;
	x: number;
	y: number;
}

const minimapSize = {height: 120, width: 170};
const largeStoryPassageCount = 500;
const maxExcerptNodes = 160;
const exposeEdgeRouteDebug = process.env.NODE_ENV === 'test';
const graphInteractiveSelector =
	'.story-edit-graph-node, .story-edit-graph-toolbar, .story-edit-graph-status, .story-edit-graph-minimap, .story-edit-graph-card-tools';
const resizeSnapActivationDistance = 18;
const graphResizeMinimum = 40;
const graphProjectionTileSize = 600;
const graphProjectionOverscan = 1200;
const graphProjectionTextRefreshDelayMs = 250;
const graphMinZoom = 0.2;
const graphMaxZoom = 2.4;
const graphButtonZoomFactor = 1.18;
const graphDragActivationDistance = 5;
const graphInitialView: GraphView = {k: 1, x: 80, y: 60};
const graphFitPadding = 96;
const noFocusedPassageIds: string[] = [];

function passageRect(passage: Passage): CoreRect {
	return {
		height: passage.height,
		left: passage.left,
		top: passage.top,
		width: passage.width
	};
}

function validRect(rect: CoreRect) {
	return (
		Object.values(rect).every(Number.isFinite) &&
		rect.height > 0 &&
		rect.width > 0
	);
}

function sameRect(a: CoreRect | undefined, b: CoreRect) {
	return (
		!!a &&
		a.height === b.height &&
		a.left === b.left &&
		a.top === b.top &&
		a.width === b.width
	);
}

function dragDistance(drag: DragState) {
	return Math.hypot(drag.left - drag.startLeft, drag.top - drag.startTop);
}

function unionRects(rects: CoreRect[]): CoreRect | null {
	const validRects = rects.filter(validRect);

	if (validRects.length === 0) {
		return null;
	}

	const left = Math.min(...validRects.map(rect => rect.left));
	const top = Math.min(...validRects.map(rect => rect.top));
	const right = Math.max(...validRects.map(rect => rect.left + rect.width));
	const bottom = Math.max(...validRects.map(rect => rect.top + rect.height));

	return {
		height: bottom - top,
		left,
		top,
		width: right - left
	};
}

function storyPassageBounds(
	passages: Passage[],
	optimisticBounds: Record<string, CoreRect> = {}
) {
	return unionRects(
		passages.map(
			passage => optimisticBounds[passage.id] ?? passageRect(passage)
		)
	);
}

function bufferedViewport(rect: CoreRect): CoreRect {
	const left = Math.max(
		0,
		Math.floor(
			(rect.left - graphProjectionOverscan) / graphProjectionTileSize
		) * graphProjectionTileSize
	);
	const top = Math.max(
		0,
		Math.floor((rect.top - graphProjectionOverscan) / graphProjectionTileSize) *
			graphProjectionTileSize
	);
	const right =
		Math.ceil(
			(rect.left + rect.width + graphProjectionOverscan) /
				graphProjectionTileSize
		) * graphProjectionTileSize;
	const bottom =
		Math.ceil(
			(rect.top + rect.height + graphProjectionOverscan) /
				graphProjectionTileSize
		) * graphProjectionTileSize;

	return {
		height: Math.max(1, bottom - top),
		left,
		top,
		width: Math.max(1, right - left)
	};
}

function bufferedViewportKey(rect: CoreRect) {
	const buffered = bufferedViewport(rect);

	return `${buffered.left}:${buffered.top}:${buffered.width}:${buffered.height}`;
}

function displayRect(
	rect: CoreRect,
	orientation: GraphOrientation,
	bounds: CoreRect | null
): CoreRect {
	if (!bounds) {
		return rect;
	}

	const localLeft = rect.left - bounds.left;
	const localTop = rect.top - bounds.top;
	const localRight = localLeft + rect.width;
	const localBottom = localTop + rect.height;

	switch (orientation) {
		case 'down':
			return {
				height: rect.width,
				left: bounds.left + localTop,
				top: bounds.top + localLeft,
				width: rect.height
			};
		case 'left':
			return {
				height: rect.height,
				left: bounds.left + (bounds.width - localRight),
				top: rect.top,
				width: rect.width
			};
		case 'up':
			return {
				height: rect.width,
				left: bounds.left + (bounds.height - localBottom),
				top: bounds.top + (bounds.width - localRight),
				width: rect.height
			};
		default:
			return rect;
	}
}

function displayPointToLogical(
	point: Point,
	orientation: GraphOrientation,
	bounds: CoreRect | null
): Point {
	if (!bounds) {
		return point;
	}

	const localLeft = point.left - bounds.left;
	const localTop = point.top - bounds.top;

	switch (orientation) {
		case 'down':
			return {
				left: bounds.left + localTop,
				top: bounds.top + localLeft
			};
		case 'left':
			return {
				left: bounds.left + (bounds.width - localLeft),
				top: point.top
			};
		case 'up':
			return {
				left: bounds.left + (bounds.width - localTop),
				top: bounds.top + (bounds.height - localLeft)
			};
		default:
			return point;
	}
}

function orientedBounds(
	bounds: CoreRect | null,
	orientation: GraphOrientation
): CoreRect | null {
	if (!bounds) {
		return bounds;
	}

	return orientation === 'down' || orientation === 'up'
		? {...bounds, height: bounds.width, width: bounds.height}
		: bounds;
}

function selectedPresetForSize(
	width: number,
	height: number
): GraphSizePreset | undefined {
	const entry = graphSizePresetEntries.find(
		([, preset]) => preset.width === width && preset.height === height
	);

	return entry?.[0];
}

function displaySizeLimits() {
	return {height: graphResizeMinimum, width: graphResizeMinimum};
}

function displaySizeForLogicalSize(
	size: {height: number; width: number},
	orientation: GraphOrientation
) {
	return orientation === 'down' || orientation === 'up'
		? {height: size.width, width: size.height}
		: size;
}

function logicalSizeFromDisplaySize(
	size: {height: number; width: number},
	orientation: GraphOrientation
) {
	return orientation === 'down' || orientation === 'up'
		? {height: size.width, width: size.height}
		: size;
}

function freeResizeDisplaySize(
	size: {height: number; width: number},
	orientation: GraphOrientation
) {
	return displaySizeForLogicalSize(
		logicalSizeFromDisplaySize(
			{
				height: Math.round(size.height),
				width: Math.round(size.width)
			},
			orientation
		),
		orientation
	);
}

function displayDeltaToLogical(
	deltaLeft: number,
	deltaTop: number,
	orientation: GraphOrientation
) {
	switch (orientation) {
		case 'down':
			return {left: deltaTop, top: deltaLeft};
		case 'left':
			return {left: -deltaLeft, top: deltaTop};
		case 'up':
			return {left: -deltaTop, top: -deltaLeft};
		default:
			return {left: deltaLeft, top: deltaTop};
	}
}

function resizeCorner(orientation: GraphOrientation): ResizeCorner {
	switch (orientation) {
		case 'left':
			return 'bottom-left';
		case 'up':
			return 'top-left';
		default:
			return 'bottom-right';
	}
}

function resizeHandleIcon(corner: ResizeCorner) {
	return corner === 'bottom-left' ? 'arrows-diagonal' : 'arrows-diagonal-2';
}

function defaultGraphDensity(story: Story): GraphDensity {
	return story.passages.length > largeStoryPassageCount
		? 'structure'
		: 'excerpt';
}

function initialGraphView(
	storyZoom: number,
	workspaceView: StoryGraphWorkspaceView | undefined
): GraphView {
	return {
		k: clampZoom(workspaceView?.k ?? (storyZoom || graphInitialView.k)),
		x: workspaceView?.x ?? graphInitialView.x,
		y: workspaceView?.y ?? graphInitialView.y
	};
}

function graphLayers(
	options: StoryGraphWorkspaceOptions | undefined
): StoryGraphLayerOptions {
	return {
		broken: options?.layers?.broken ?? true,
		references: options?.layers?.references ?? true,
		resolved: options?.layers?.resolved ?? true,
		selfLinks: options?.layers?.selfLinks ?? true
	};
}

function coreGraphLayers(layers: StoryGraphLayerOptions): CoreLinkLayerOptions {
	return {
		broken: layers.broken,
		resolved: layers.resolved,
		selfLinks: layers.selfLinks
	};
}

function sameGraphView(left: GraphView, right: GraphView) {
	return left.k === right.k && left.x === right.x && left.y === right.y;
}

function sameGraphLayers(
	left: StoryGraphLayerOptions,
	right: StoryGraphLayerOptions
) {
	return (
		left.broken === right.broken &&
		left.references === right.references &&
		left.resolved === right.resolved &&
		left.selfLinks === right.selfLinks
	);
}

function resizeOffset(
	resize: ResizeState | undefined,
	orientation: GraphOrientation
) {
	if (!resize) {
		return {left: 0, top: 0};
	}

	const widthDelta = resize.currentWidth - resize.width;
	const heightDelta = resize.currentHeight - resize.height;

	switch (orientation) {
		case 'left':
			return {left: -widthDelta, top: 0};
		case 'up':
			return {left: -widthDelta, top: -heightDelta};
		default:
			return {left: 0, top: 0};
	}
}

function center(rect: CoreRect) {
	return {
		left: rect.left + rect.width / 2,
		top: rect.top + rect.height / 2
	};
}

function clampZoom(zoom: number) {
	return Math.max(graphMinZoom, Math.min(graphMaxZoom, zoom));
}

function roundedZoom(zoom: number) {
	return Math.round(zoom * 100) / 100;
}

// Continuous, frame-perfect zoom factor so the wheel never overshoots and the
// next event has no animation to fight (the old useZoomTransition jank).
function wheelZoom(currentZoom: number, deltaY: number) {
	return clampZoom(currentZoom * Math.exp(-deltaY * 0.0016));
}

function horizontalEdgeCurve(source: CoreRect, target: CoreRect) {
	const sourceCenter = center(source);
	const targetCenter = center(target);
	const direction = targetCenter.left >= sourceCenter.left ? 1 : -1;
	const x = direction > 0 ? source.left + source.width : source.left;
	const y = sourceCenter.top;
	const tx = direction > 0 ? target.left : target.left + target.width;
	const ty = targetCenter.top;
	const bend = Math.max(Math.abs(tx - x) * 0.45, 70);

	return {
		c1x: x + direction * bend,
		c1y: y,
		c2x: tx - direction * bend,
		c2y: ty,
		tx,
		ty,
		x,
		y
	};
}

function verticalEdgeCurve(source: CoreRect, target: CoreRect) {
	const sourceCenter = center(source);
	const targetCenter = center(target);
	const direction = targetCenter.top >= sourceCenter.top ? 1 : -1;
	const x = sourceCenter.left;
	const y = direction > 0 ? source.top + source.height : source.top;
	const tx = targetCenter.left;
	const ty = direction > 0 ? target.top : target.top + target.height;
	const bend = Math.max(Math.abs(ty - y) * 0.45, 70);

	return {
		c1x: x,
		c1y: y + direction * bend,
		c2x: tx,
		c2y: ty - direction * bend,
		tx,
		ty,
		x,
		y
	};
}

function edgeCurve(edge: StoryGraphEdge, nodeById: Map<string, CoreGraphNode>) {
	const source = nodeById.get(edge.sourceId)?.bounds ?? edge.sourceBounds;
	const sourceRight = source.left + source.width;
	const sourceMiddle = source.top + source.height / 2;

	if (edge.kind === 'selfLink') {
		const top = source.top + 18;
		const right = sourceRight + 42;
		const bottom = source.top + source.height - 18;

		return {
			c1x: right,
			c1y: top,
			c2x: right,
			c2y: bottom,
			tx: sourceRight - 14,
			ty: bottom,
			x: sourceRight - 14,
			y: top
		};
	}

	if (!edge.targetId || !edge.targetBounds) {
		const targetLeft = sourceRight + 92;
		const targetTop = Math.max(source.top - 34, 14);

		return {
			c1x: sourceRight + 52,
			c1y: sourceMiddle,
			c2x: targetLeft - 20,
			c2y: targetTop,
			tx: targetLeft,
			ty: targetTop,
			x: sourceRight,
			y: sourceMiddle
		};
	}

	const target = nodeById.get(edge.targetId)?.bounds ?? edge.targetBounds;
	const delta = {
		left: center(target).left - center(source).left,
		top: center(target).top - center(source).top
	};

	return Math.abs(delta.left) >= Math.abs(delta.top)
		? horizontalEdgeCurve(source, target)
		: verticalEdgeCurve(source, target);
}

function edgeRouteDebug(
	edges: StoryGraphEdge[],
	nodeById: Map<string, CoreGraphNode>
) {
	return edges
		.map(edge => {
			const curve = edgeCurve(edge, nodeById);
			const target = edge.targetId ?? edge.targetName;

			return `${edge.sourceId}->${target}:${Math.round(curve.x)},${Math.round(
				curve.y
			)}>${Math.round(curve.tx)},${Math.round(curve.ty)}`;
		})
		.join('|');
}

function drawArrow(
	context: CanvasRenderingContext2D,
	fromX: number,
	fromY: number,
	toX: number,
	toY: number
) {
	const angle = Math.atan2(toY - fromY, toX - fromX);
	const size = 8;

	context.beginPath();
	context.moveTo(toX, toY);
	context.lineTo(
		toX - size * Math.cos(angle - Math.PI / 6),
		toY - size * Math.sin(angle - Math.PI / 6)
	);
	context.lineTo(
		toX - size * Math.cos(angle + Math.PI / 6),
		toY - size * Math.sin(angle + Math.PI / 6)
	);
	context.closePath();
	context.fill();
}

interface GraphEdgesCanvasProps {
	drawBounds: CoreRect;
	edges: StoryGraphEdge[];
	nodeById: Map<string, CoreGraphNode>;
	selectedNodeIds: Set<string>;
	visibleZoom: number;
}

const GraphEdgesCanvas: React.FC<GraphEdgesCanvasProps> = ({
	drawBounds,
	edges,
	nodeById,
	selectedNodeIds,
	visibleZoom
}) => {
	const canvasRef = React.useRef<HTMLCanvasElement>(null);
	const connectedEdgeCount = React.useMemo(
		() =>
			edges.filter(
				edge =>
					selectedNodeIds.has(edge.sourceId) ||
					(!!edge.targetId && selectedNodeIds.has(edge.targetId))
			).length,
		[edges, selectedNodeIds]
	);
	const edgeKinds = React.useMemo(
		() => Array.from(new Set(edges.map(edge => edge.kind))).join(' '),
		[edges]
	);
	const edgeRoutes = React.useMemo(
		() => (exposeEdgeRouteDebug ? edgeRouteDebug(edges, nodeById) : undefined),
		[edges, nodeById]
	);

	React.useEffect(() => {
		const canvas = canvasRef.current;

		if (!canvas) {
			return;
		}

		const pixelRatio = window.devicePixelRatio || 1;
		const backingScale = pixelRatio * Math.max(visibleZoom, 0.1);

		// The whole graph canvas is scaled by visibleZoom. Size this backing store
		// in final screen pixels so huge zoomed-out stories don't hit canvas limits.
		canvas.width = Math.max(1, Math.ceil(drawBounds.width * backingScale));
		canvas.height = Math.max(1, Math.ceil(drawBounds.height * backingScale));

		const context = canvas.getContext('2d');

		if (!context) {
			return;
		}

		context.setTransform(backingScale, 0, 0, backingScale, 0, 0);
		context.clearRect(0, 0, drawBounds.width, drawBounds.height);
		context.translate(-drawBounds.left, -drawBounds.top);
		context.lineCap = 'round';
		context.lineJoin = 'round';
		context.lineWidth = 2;

		const styles = getComputedStyle(canvas);
		const colors = {
			broken:
				styles.getPropertyValue('--sem-error').trim() || 'rgb(214, 85, 74)',
			reference:
				styles.getPropertyValue('--tx-4').trim() || 'rgb(140, 145, 155)',
			resolved:
				styles.getPropertyValue('--sem-link').trim() || 'rgb(92, 151, 255)',
			selected:
				styles.getPropertyValue('--focus-ring').trim() || 'rgb(80, 184, 118)',
			selfLink:
				styles.getPropertyValue('--sem-generated').trim() || 'rgb(92, 180, 220)'
		};
		const hasSelection = selectedNodeIds.size > 0;

		for (const edge of edges) {
			const curve = edgeCurve(edge, nodeById);
			const connected =
				selectedNodeIds.has(edge.sourceId) ||
				(!!edge.targetId && selectedNodeIds.has(edge.targetId));
			const color = connected
				? colors.selected
				: (colors[edge.kind] ?? colors.resolved);

			context.globalAlpha = hasSelection && !connected ? 0.35 : 1;
			context.lineWidth = connected ? 3.5 : 2;
			context.strokeStyle = color;
			context.fillStyle = color;
			context.setLineDash(
				edge.kind === 'broken'
					? [6, 5]
					: edge.kind === 'reference'
						? [2, 5]
						: []
			);
			context.beginPath();
			context.moveTo(curve.x, curve.y);
			context.bezierCurveTo(
				curve.c1x,
				curve.c1y,
				curve.c2x,
				curve.c2y,
				curve.tx,
				curve.ty
			);
			context.stroke();
			context.setLineDash([]);
			drawArrow(context, curve.c2x, curve.c2y, curve.tx, curve.ty);
		}
		context.globalAlpha = 1;
	}, [
		drawBounds.height,
		drawBounds.left,
		drawBounds.top,
		drawBounds.width,
		edges,
		nodeById,
		selectedNodeIds,
		visibleZoom
	]);

	return (
		<canvas
			aria-hidden
			className="story-edit-graph-edges"
			data-connected-edge-count={connectedEdgeCount}
			data-edge-count={edges.length}
			data-edge-kinds={edgeKinds}
			data-edge-routes={edgeRoutes}
			data-selected-node-count={selectedNodeIds.size}
			data-testid="story-graph-edges-canvas"
			ref={canvasRef}
			style={{
				height: drawBounds.height,
				left: drawBounds.left,
				top: drawBounds.top,
				width: drawBounds.width
			}}
		/>
	);
};

const GraphMinimapCanvas: React.FC<{
	logicalBounds: CoreRect | null;
	minimap: MinimapTransform;
	optimisticBounds: Record<string, CoreRect>;
	orientation: GraphOrientation;
	selectedNodeIds: Set<string>;
	story: Story;
}> = ({
	logicalBounds,
	minimap,
	optimisticBounds,
	orientation,
	selectedNodeIds,
	story
}) => {
	const canvasRef = React.useRef<HTMLCanvasElement>(null);

	React.useEffect(() => {
		const canvas = canvasRef.current;

		if (!canvas) {
			return;
		}

		const width = canvas.clientWidth;
		const height = canvas.clientHeight;

		if (width < 1 || height < 1) {
			return;
		}

		const pixelRatio = window.devicePixelRatio || 1;
		canvas.width = Math.ceil(width * pixelRatio);
		canvas.height = Math.ceil(height * pixelRatio);
		const context = canvas.getContext('2d');

		if (!context) {
			return;
		}

		context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
		context.clearRect(0, 0, width, height);
		const styles = getComputedStyle(canvas);
		const nodeColor = styles.getPropertyValue('--tx-3').trim() || '#94a3b8';
		const selectedColor =
			styles.getPropertyValue('--sel-line').trim() || '#5c97ff';
		context.fillStyle = nodeColor;
		context.globalAlpha = 0.7;

		for (const passage of story.passages) {
			const bounds = optimisticBounds[passage.id] ?? passageRect(passage);

			if (!validRect(bounds)) {
				continue;
			}

			const display = displayRect(bounds, orientation, logicalBounds);
			context.fillRect(
				display.left * minimap.scale + minimap.x,
				display.top * minimap.scale + minimap.y,
				Math.max(4, display.width * minimap.scale),
				Math.max(3, display.height * minimap.scale)
			);
		}

		if (selectedNodeIds.size > 0) {
			context.fillStyle = selectedColor;
			context.globalAlpha = 1;

			for (const passage of story.passages) {
				if (!selectedNodeIds.has(passage.id)) {
					continue;
				}

				const bounds = optimisticBounds[passage.id] ?? passageRect(passage);

				if (!validRect(bounds)) {
					continue;
				}

				const display = displayRect(bounds, orientation, logicalBounds);
				context.fillRect(
					display.left * minimap.scale + minimap.x,
					display.top * minimap.scale + minimap.y,
					Math.max(4, display.width * minimap.scale),
					Math.max(3, display.height * minimap.scale)
				);
			}
		}
	}, [
		logicalBounds,
		minimap,
		optimisticBounds,
		orientation,
		selectedNodeIds,
		story
	]);

	return (
		<canvas
			aria-hidden
			className="story-edit-graph-minimap__canvas"
			ref={canvasRef}
		/>
	);
};

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
		left: snapToGraphGrid(bounds.left),
		top: snapToGraphGrid(bounds.top)
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

export function graphProjectionChangeForPatchBatch(
	batch: PatchBatch,
	storyId: string
): 'deferred' | 'immediate' | undefined {
	let deferred = false;

	for (const patch of batch.patches) {
		if (patch.type === 'projectSnapshotReplaced') {
			return 'immediate';
		}

		if (!('story_id' in patch) || patch.story_id !== storyId) {
			continue;
		}

		switch (patch.type) {
			case 'layoutSaved':
			case 'passageCreated':
			case 'passageDeleted':
			case 'startPassageChanged':
				return 'immediate';

			case 'passageUpdated':
				if (
					patch.changes.layout !== null ||
					patch.changes.name !== null ||
					patch.changes.tags !== null
				) {
					return 'immediate';
				}
				deferred ||= patch.changes.text !== null;
				break;

			default:
				break;
		}
	}

	return deferred ? 'deferred' : undefined;
}

function interactionBounds(
	node: CoreGraphNode,
	drag: DragState | undefined,
	resize: ResizeState | undefined,
	orientation: GraphOrientation,
	snapToGrid: boolean,
	visibleZoom: number
): CoreRect {
	const isDragging = drag?.ids.includes(node.id) ?? false;
	const offset = drag?.ids.includes(node.id)
		? {
				left: (drag.left - drag.startLeft) / visibleZoom,
				top: (drag.top - drag.startTop) / visibleZoom
			}
		: {left: 0, top: 0};
	const activeResize = resize?.ids.includes(node.id) ? resize : undefined;
	const resizeAnchorOffset = resizeOffset(activeResize, orientation);

	const bounds = {
		height: activeResize ? activeResize.currentHeight : node.bounds.height,
		left: node.bounds.left + offset.left + resizeAnchorOffset.left,
		top: node.bounds.top + offset.top + resizeAnchorOffset.top,
		width: activeResize ? activeResize.currentWidth : node.bounds.width
	};

	if (!isDragging || !snapToGrid) {
		return bounds;
	}

	return {
		...bounds,
		left: snapToGraphGrid(bounds.left),
		top: snapToGraphGrid(bounds.top)
	};
}

function minimapTransform(bounds: CoreRect | null): MinimapTransform {
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
	const draggableNodeRefs = React.useRef(
		new Map<string, React.RefObject<HTMLDivElement | null>>()
	);
	const resizeHandleRefs = React.useRef(
		new Map<string, React.RefObject<HTMLButtonElement | null>>()
	);
	const {
		graphOptions,
		graphView,
		onCreate,
		onDeselect,
		onEdit,
		onEditPassages,
		onGraphOptionsChange,
		onGraphViewChange,
		onSelect,
		onSelectIds,
		onTestPassage,
		revealPassageId,
		revealRequestKey,
		selectedPassageId,
		story,
		testPassagePending = false,
		testPassagePendingId
	} = props;
	const host = useCoreProjectHost();
	const storyRef = React.useRef(story);

	storyRef.current = story;
	const passageCount = story.passages.length;
	const storyZoomSeed = React.useRef({storyId: story.id, zoom: story.zoom});

	if (storyZoomSeed.current.storyId !== story.id) {
		storyZoomSeed.current = {storyId: story.id, zoom: story.zoom};
	}

	// The whole graph (grid + edges + nodes) rides one transformed world layer.
	// `view.k` is the live, un-animated zoom; `visibleZoom` aliases it so the
	// projection / edge / resize math below stays unchanged.
	const [view, setView] = React.useState<GraphView>(() =>
		initialGraphView(storyZoomSeed.current.zoom, graphView)
	);
	const visibleZoom = view.k;
	const panningViewRef = React.useRef<GraphView | undefined>(undefined);
	const viewRef = React.useRef(view);
	const renderedView = panningViewRef.current ?? view;
	viewRef.current = renderedView;
	const persistZoomFrame = React.useRef<number | undefined>(undefined);
	const persistGraphViewFrame = React.useRef<number | undefined>(undefined);
	const {dispatch: prefsDispatch, prefs} = usePrefsContext();
	const [density, setDensity] = React.useState<GraphDensity>(
		() => graphOptions?.density ?? defaultGraphDensity(story)
	);
	const orientation: GraphOrientation = graphOptions?.orientation ?? 'right';
	const defaultSize = prefs.graphDefaultCardSize;
	const [focusSelection, setFocusSelection] = React.useState(
		graphOptions?.focusSelection ?? false
	);
	const [layers, setLayers] = React.useState<StoryGraphLayerOptions>(() =>
		graphLayers(graphOptions)
	);
	const [drag, setDrag] = React.useState<DragState>();
	const dragRef = React.useRef<DragState | undefined>(undefined);
	const [marquee, setMarquee] = React.useState<MarqueeState>();
	const [contextMenu, setContextMenu] = React.useState<GraphContextMenuState>();
	const [optimisticMoveBounds, setOptimisticMoveBounds] = React.useState<
		Record<string, CoreRect>
	>({});
	const [resize, setResize] = React.useState<ResizeState>();
	const [shiftSelecting, setShiftSelecting] = React.useState(false);
	const [tool, setTool] = React.useState<GraphTool>(
		graphOptions?.tool ?? 'select'
	);
	const [spaceDown, setSpaceDown] = React.useState(false);
	const spaceDownRef = React.useRef(false);
	const [viewport, setViewport] = React.useState<ViewportState>({
		height: 1,
		left: 0,
		top: 0,
		width: 1
	});
	const viewportRef = React.useRef<HTMLDivElement>(null);
	const gridRef = React.useRef<HTMLDivElement>(null);
	const canvasRef = React.useRef<HTMLDivElement>(null);
	const minimapRef = React.useRef<HTMLDivElement>(null);
	const viewportFrame = React.useRef<number | undefined>(undefined);
	const lastAutoCenteredSelection = React.useRef<string | undefined>(undefined);
	const lastRevealRequestKey = React.useRef<number | undefined>(undefined);
	const optimisticSelectedIds = React.useRef<Set<string> | undefined>(
		undefined
	);
	const selectionHandledOnPointerDown = React.useRef<string | undefined>(
		undefined
	);
	const [optimisticSelectionKey, setOptimisticSelectionKey] =
		React.useState('');
	const [asyncProjection, setAsyncProjection] =
		React.useState<AsyncProjectionState>();
	const [asyncReferenceStory, setAsyncReferenceStory] =
		React.useState<AsyncReferenceStoryState>();
	const [graphProjectionRevision, setGraphProjectionRevision] =
		React.useState(0);
	const deferredGraphProjectionRefresh = React.useRef<number | undefined>(
		undefined
	);
	const panRef = React.useRef<
		| {
				left: number;
				moved: boolean;
				currentLeft: number;
				currentTop: number;
				pointerId?: number;
				startLeft: number;
				startTop: number;
				top: number;
				x: number;
				y: number;
		  }
		| undefined
	>(undefined);
	const minimapDragRef = React.useRef<number | undefined>(undefined);
	const recentlyDragged = React.useRef(false);
	const panning = tool === 'pan' || spaceDown;
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
	const passagesById = React.useMemo(
		() => new Map(story.passages.map(passage => [passage.id, passage])),
		[story.passages]
	);
	const selectedPassage = selectedPassageId
		? passagesById.get(selectedPassageId)
		: undefined;
	const selectedPassages = React.useMemo(
		() =>
			selectedPassageIds
				.map(id => passagesById.get(id))
				.filter((passage): passage is Passage => !!passage),
		[passagesById, selectedPassageIds]
	);
	const soloSelectedPassage =
		selectedPassages.length === 1 ? selectedPassages[0] : undefined;
	const defaultSizePreset = graphSizePresets[defaultSize];
	const currentSizePreset = selectedPassages[0]
		? selectedPresetForSize(
				selectedPassages[0].width,
				selectedPassages[0].height
			)
		: defaultSize;
	const currentSizeLabel = currentSizePreset
		? graphSizePresets[currentSizePreset].label
		: 'Custom';
	const defaultCardSize = {
		height: defaultSizePreset.height,
		width: defaultSizePreset.width
	};
	const referenceParser = useFormatReferenceParser(
		story.storyFormat,
		story.storyFormatVersion
	);
	const formatReferencesAvailable =
		referenceParser !== emptyFormatReferenceParser;
	const measuredViewport =
		viewport.height > 1 && viewport.width > 1 ? viewport : null;
	const projectionViewportKey = measuredViewport
		? bufferedViewportKey(measuredViewport)
		: `initial:${viewport.left}:${viewport.top}:${viewport.width}:${viewport.height}`;
	const projectionViewport = React.useMemo(() => {
		const source = measuredViewport ?? viewport;

		return measuredViewport ? bufferedViewport(source) : source;
	}, [projectionViewportKey]);
	const queryViewport =
		focusSelection || orientation !== 'right' || formatReferencesAvailable
			? null
			: projectionViewport;
	const focusPassageIds = focusSelection
		? selectedPassageIds
		: noFocusedPassageIds;
	const projectionQuery = React.useMemo(
		() => ({
			focus:
				focusPassageIds.length > 0
					? {
							direction: 'both' as const,
							passageIds: focusPassageIds,
							radius: 1
						}
					: null,
			layers: coreGraphLayers(layers),
			viewport: queryViewport
		}),
		[focusPassageIds, layers, queryViewport]
	);
	const projectionQueryKey = React.useMemo(
		() => JSON.stringify(projectionQuery),
		[projectionQuery]
	);
	const projection =
		asyncProjection?.storyId === story.id
			? asyncProjection.projection
			: emptyGraphProjection();

	React.useEffect(() => {
		let active = true;

		if (!formatReferencesAvailable) {
			setAsyncReferenceStory(undefined);
			return;
		}

		void materializeStoryFromSession(host, storyRef.current)
			.then(materialized => {
				if (active) {
					setAsyncReferenceStory({story: materialized, storyId: story.id});
				}
			})
			.catch(error => {
				if (active) {
					console.warn('Could not load story-format graph references.', error);
					setAsyncReferenceStory(undefined);
				}
			});

		return () => {
			active = false;
		};
	}, [
		formatReferencesAvailable,
		graphProjectionRevision,
		host,
		passageCount,
		referenceParser,
		story.id
	]);

	React.useEffect(() => {
		const unsubscribe = host.subscribeToPatches(batch => {
			const change = graphProjectionChangeForPatchBatch(batch, story.id);

			if (!change) {
				return;
			}
			if (deferredGraphProjectionRefresh.current !== undefined) {
				window.clearTimeout(deferredGraphProjectionRefresh.current);
				deferredGraphProjectionRefresh.current = undefined;
			}
			if (change === 'immediate') {
				setGraphProjectionRevision(revision => revision + 1);
				return;
			}

			deferredGraphProjectionRefresh.current = window.setTimeout(() => {
				deferredGraphProjectionRefresh.current = undefined;
				setGraphProjectionRevision(revision => revision + 1);
			}, graphProjectionTextRefreshDelayMs);
		});

		return () => {
			unsubscribe();
			if (deferredGraphProjectionRefresh.current !== undefined) {
				window.clearTimeout(deferredGraphProjectionRefresh.current);
				deferredGraphProjectionRefresh.current = undefined;
			}
		};
	}, [host, story.id]);

	React.useEffect(() => {
		let active = true;

		void host
			.queryGraphProjectionAsync(story.id, projectionQuery)
			.then(projection => {
				if (active) {
					setAsyncProjection({projection, storyId: story.id});
				}
			});

		return () => {
			active = false;
		};
	}, [
		graphProjectionRevision,
		host,
		projectionQuery,
		projectionQueryKey,
		story.id
	]);

	React.useEffect(() => {
		if (projection.nodes.length > 0 || projection.bounds) {
			markPerformanceAfterPaint('graph-visible');
		}
	}, [projection.bounds, projection.nodes.length]);
	const projectedNodeById = React.useMemo(
		() => new Map(projection.nodes.map(node => [node.id, node])),
		[projection.nodes]
	);
	const persistedStoryBounds = React.useMemo(
		() => storyPassageBounds(story.passages),
		[story.passages]
	);
	const logicalNodeById = React.useMemo(() => {
		if (Object.keys(optimisticMoveBounds).length === 0) {
			return projectedNodeById;
		}

		return new Map(
			projection.nodes.map(node => [
				node.id,
				optimisticMoveBounds[node.id]
					? {...node, bounds: optimisticMoveBounds[node.id]}
					: node
			])
		);
	}, [optimisticMoveBounds, projectedNodeById, projection.nodes]);
	const logicalGraphBounds = React.useMemo(() => {
		if (Object.keys(optimisticMoveBounds).length === 0) {
			return persistedStoryBounds ?? projection.bounds;
		}

		return (
			storyPassageBounds(story.passages, optimisticMoveBounds) ??
			projection.bounds
		);
	}, [
		optimisticMoveBounds,
		persistedStoryBounds,
		projection.bounds,
		story.passages
	]);
	const displayBounds = React.useMemo(
		() => orientedBounds(logicalGraphBounds, orientation),
		[logicalGraphBounds, orientation]
	);
	const displayNodes = React.useMemo(
		() =>
			projection.nodes.map(node => ({
				...node,
				bounds: displayRect(
					logicalNodeById.get(node.id)?.bounds ?? node.bounds,
					orientation,
					logicalGraphBounds
				)
			})),
		[logicalGraphBounds, logicalNodeById, orientation, projection.nodes]
	);
	React.useEffect(() => {
		const visibleIds = new Set(displayNodes.map(node => node.id));

		for (const refs of [draggableNodeRefs.current, resizeHandleRefs.current]) {
			for (const id of refs.keys()) {
				if (!visibleIds.has(id)) {
					refs.delete(id);
				}
			}
		}
	}, [displayNodes]);
	const displayNodeById = React.useMemo(
		() => new Map(displayNodes.map(node => [node.id, node])),
		[displayNodes]
	);
	const referenceEdges = React.useMemo(
		() =>
			layers.references &&
			asyncReferenceStory?.storyId === story.id &&
			formatReferencesAvailable
				? formatReferenceEdges(
						asyncReferenceStory.story,
						projection,
						referenceParser
					)
				: [],
		[
			asyncReferenceStory,
			formatReferencesAvailable,
			layers.references,
			projection,
			referenceParser,
			story.id
		]
	);
	const displayEdges = React.useMemo(
		() =>
			[...projection.edges, ...referenceEdges].map(edge => ({
				...edge,
				sourceBounds: displayRect(
					edge.sourceBounds,
					orientation,
					logicalGraphBounds
				),
				targetBounds: edge.targetBounds
					? displayRect(edge.targetBounds, orientation, logicalGraphBounds)
					: edge.targetBounds
			})),
		[logicalGraphBounds, orientation, projection.edges, referenceEdges]
	);
	const liveNodeById = React.useMemo(() => {
		if (!drag && !resize) {
			return displayNodeById;
		}

		return new Map(
			displayNodes.map(node => [
				node.id,
				{
					...node,
					bounds: interactionBounds(
						node,
						drag,
						resize,
						orientation,
						story.snapToGrid,
						visibleZoom
					)
				}
			])
		);
	}, [
		displayNodeById,
		displayNodes,
		drag,
		orientation,
		resize,
		story.snapToGrid,
		visibleZoom
	]);
	const displaySelectedIdSet = React.useMemo(() => {
		if (!marquee) {
			return selectedIdSet;
		}

		const next = marquee.additive ? new Set(selectedIdSet) : new Set<string>();

		for (const node of displayNodes) {
			const bounds = interactionBounds(
				node,
				drag,
				resize,
				orientation,
				story.snapToGrid,
				visibleZoom
			);

			if (rectsIntersect(marquee.rect, bounds)) {
				next.add(node.id);
			}
		}

		return next;
	}, [
		displayNodes,
		drag,
		marquee,
		orientation,
		resize,
		selectedIdSet,
		story.snapToGrid,
		visibleZoom
	]);
	const edgeDrawViewportKey = queryViewport
		? projectionViewportKey
		: bufferedViewportKey(viewport);
	const edgeDrawBounds = React.useMemo(() => {
		if (queryViewport) {
			return queryViewport;
		}

		return bufferedViewport(viewport);
	}, [edgeDrawViewportKey, queryViewport]);
	const minimap = React.useMemo(
		() => minimapTransform(displayBounds),
		[displayBounds]
	);
	const showSaveLayoutAction =
		projection.layoutState !== 'generated' ||
		prefs.graphGeneratedLayoutSavePrompt;
	const renderedDensity =
		density === 'excerpt' && displayNodes.length > maxExcerptNodes
			? 'names'
			: density;

	// The logical (world-space) rectangle currently visible. Derived purely
	// from the transform: world point at the viewport's top-left is (-x/k,-y/k)
	// and the visible size is clientSize / k. No scroll positions involved.
	const readViewport = React.useCallback(() => {
		const element = viewportRef.current;

		if (!element || element.clientWidth < 1 || element.clientHeight < 1) {
			// Not laid out yet — keep the bounded initial viewport so the first
			// projection query stays centered on the content origin.
			return;
		}

		const {k, x, y} = viewRef.current;
		const next = {
			height: element.clientHeight / k,
			left: -x / k,
			top: -y / k,
			width: element.clientWidth / k
		};

		setViewport(current => {
			if (
				current.height === next.height &&
				current.left === next.left &&
				current.top === next.top &&
				current.width === next.width
			) {
				return current;
			}

			return next;
		});
	}, []);

	// Persist the live zoom back to the story (debounced) so it survives a
	// reload, without round-tripping every wheel tick through the core.
	const persistZoom = React.useCallback(
		(k: number) => {
			if (persistZoomFrame.current !== undefined) {
				window.clearTimeout(persistZoomFrame.current);
			}

			persistZoomFrame.current = window.setTimeout(() => {
				persistZoomFrame.current = undefined;
				const rounded = roundedZoom(k);

				if (rounded !== roundedZoom(story.zoom)) {
					host.applyStoryCommand(setStoryZoomCommand(story.id, rounded));
				}
			}, 400);
		},
		[host, story.id, story.zoom]
	);

	// Zoom toward a point given in viewport-local pixels, keeping the world
	// point under it pinned. This is the cursor-anchored zoom formula.
	const zoomToPoint = React.useCallback(
		(localX: number, localY: number, nextK: number) => {
			setView(current => {
				const k = clampZoom(nextK);

				if (k === current.k) {
					return current;
				}

				const worldX = (localX - current.x) / current.k;
				const worldY = (localY - current.y) / current.k;

				persistZoom(k);

				return {k, x: localX - worldX * k, y: localY - worldY * k};
			});
		},
		[persistZoom]
	);

	const zoomAtViewportCenter = React.useCallback(
		(factor: number) => {
			const element = viewportRef.current;

			if (!element) {
				return;
			}

			const rect = element.getBoundingClientRect();

			zoomToPoint(rect.width / 2, rect.height / 2, viewRef.current.k * factor);
		},
		[zoomToPoint]
	);

	const updateViewport = React.useCallback(() => {
		if (viewportFrame.current !== undefined) {
			return;
		}

		viewportFrame.current = window.requestAnimationFrame(() => {
			viewportFrame.current = undefined;
			readViewport();
		});
	}, [readViewport]);

	React.useEffect(() => {
		readViewport();
		window.addEventListener('resize', updateViewport);

		return () => {
			window.removeEventListener('resize', updateViewport);

			if (viewportFrame.current !== undefined) {
				window.cancelAnimationFrame(viewportFrame.current);
				viewportFrame.current = undefined;
			}
		};
	}, [readViewport, updateViewport]);

	React.useEffect(() => {
		const nextView = initialGraphView(storyZoomSeed.current.zoom, graphView);

		setView(current => (sameGraphView(current, nextView) ? current : nextView));
	}, [graphView, story.id]);

	React.useEffect(() => {
		const nextDensity =
			graphOptions?.density ??
			(passageCount > largeStoryPassageCount ? 'structure' : 'excerpt');
		const nextFocusSelection = graphOptions?.focusSelection ?? false;
		const nextLayers = graphLayers(graphOptions);
		const nextTool = graphOptions?.tool ?? 'select';

		setDensity(current => (current === nextDensity ? current : nextDensity));
		setFocusSelection(current =>
			current === nextFocusSelection ? current : nextFocusSelection
		);
		setLayers(current =>
			sameGraphLayers(current, nextLayers) ? current : nextLayers
		);
		setTool(current => (current === nextTool ? current : nextTool));
	}, [graphOptions, passageCount]);

	React.useEffect(() => {
		onGraphOptionsChange?.({
			density,
			focusSelection,
			layers,
			orientation,
			tool
		});
	}, [
		density,
		focusSelection,
		layers,
		onGraphOptionsChange,
		orientation,
		tool
	]);

	const scheduleGraphViewPersistence = React.useCallback(() => {
		if (!onGraphViewChange) {
			return;
		}

		if (persistGraphViewFrame.current !== undefined) {
			window.clearTimeout(persistGraphViewFrame.current);
		}

		persistGraphViewFrame.current = window.setTimeout(() => {
			persistGraphViewFrame.current = undefined;
			onGraphViewChange(viewRef.current);
		}, 400);
	}, [onGraphViewChange]);

	React.useEffect(() => {
		scheduleGraphViewPersistence();
	}, [scheduleGraphViewPersistence, view]);

	// The logical viewport (used for projection tiling + minimap) is a pure
	// function of the transform, so recompute it whenever the view changes.
	React.useEffect(() => {
		readViewport();
	}, [readViewport, view]);

	React.useEffect(
		() => () => {
			if (persistZoomFrame.current !== undefined) {
				window.clearTimeout(persistZoomFrame.current);
			}

			if (persistGraphViewFrame.current !== undefined) {
				window.clearTimeout(persistGraphViewFrame.current);
			}

			onGraphViewChange?.(viewRef.current);
		},
		[onGraphViewChange]
	);

	React.useEffect(() => {
		optimisticSelectedIds.current = undefined;
		setOptimisticSelectionKey('');
	}, [persistedSelectionKey]);

	React.useEffect(() => {
		if (Object.keys(optimisticMoveBounds).length === 0) {
			return;
		}

		setOptimisticMoveBounds(current => {
			let changed = false;
			const next: Record<string, CoreRect> = {};

			for (const [id, bounds] of Object.entries(current)) {
				if (!passagesById.has(id)) {
					changed = true;
					continue;
				}

				if (sameRect(projectedNodeById.get(id)?.bounds, bounds)) {
					changed = true;
					continue;
				}

				next[id] = bounds;
			}

			return changed ? next : current;
		});
	}, [optimisticMoveBounds, passagesById, projectedNodeById]);

	React.useEffect(() => {
		dragRef.current = undefined;
		setDrag(undefined);
		setOptimisticMoveBounds(current =>
			Object.keys(current).length === 0 ? current : {}
		);
	}, [story.id]);

	React.useEffect(() => {
		function isTyping(target: EventTarget | null) {
			const element = target as HTMLElement | null;

			return (
				!!element &&
				(/^(input|textarea|select)$/i.test(element.tagName) ||
					element.isContentEditable)
			);
		}

		function handleKeyDown(event: KeyboardEvent) {
			if (event.key === 'Shift') {
				setShiftSelecting(true);
			}

			if (event.key === 'Escape') {
				setContextMenu(undefined);
			}

			if (isTyping(event.target) || event.metaKey || event.ctrlKey) {
				return;
			}

			if (event.code === 'Space' && !spaceDownRef.current) {
				spaceDownRef.current = true;
				setSpaceDown(true);
				event.preventDefault();
			} else if (event.key === 'v' || event.key === 'V') {
				setTool('select');
			} else if (event.key === 'h' || event.key === 'H') {
				setTool('pan');
			} else if (event.key === '+' || event.key === '=') {
				zoomAtViewportCenter(graphButtonZoomFactor);
			} else if (event.key === '-' || event.key === '_') {
				zoomAtViewportCenter(1 / graphButtonZoomFactor);
			} else if (event.key === '0') {
				fitToContent();
			}
		}

		function handleKeyUp(event: KeyboardEvent) {
			if (event.key === 'Shift') {
				setShiftSelecting(false);
			}

			if (event.code === 'Space') {
				spaceDownRef.current = false;
				setSpaceDown(false);
			}
		}

		window.addEventListener('keydown', handleKeyDown);
		window.addEventListener('keyup', handleKeyUp);

		return () => {
			window.removeEventListener('keydown', handleKeyDown);
			window.removeEventListener('keyup', handleKeyUp);
		};
	}, [zoomAtViewportCenter]);

	React.useEffect(() => {
		if (!contextMenu) {
			return;
		}

		function closeContextMenu() {
			setContextMenu(undefined);
		}

		window.addEventListener('click', closeContextMenu);
		window.addEventListener('scroll', closeContextMenu, true);

		return () => {
			window.removeEventListener('click', closeContextMenu);
			window.removeEventListener('scroll', closeContextMenu, true);
		};
	}, [contextMenu]);

	// Selection has NO side effect on the viewport (this was the old "jumps up
	// and to the right" jiggle). The view only moves on an EXPLICIT reveal
	// request (Reveal in graph / fuzzy finder), which re-anchors the transform
	// directly — never a scroll side-effect.
	React.useEffect(() => {
		const element = viewportRef.current;
		const node = selectedPassageId
			? displayNodeById.get(selectedPassageId)
			: undefined;
		const fallbackBounds =
			selectedPassage &&
			orientation === 'right' &&
			validRect(passageRect(selectedPassage))
				? passageRect(selectedPassage)
				: undefined;
		const bounds = node?.bounds ?? fallbackBounds;
		const forceReveal =
			revealPassageId === selectedPassageId &&
			revealRequestKey !== undefined &&
			lastRevealRequestKey.current !== revealRequestKey;

		if (!forceReveal || !element || !bounds) {
			return;
		}

		lastRevealRequestKey.current = revealRequestKey;
		lastAutoCenteredSelection.current = selectedPassageId;

		const centerPoint = center(bounds);

		setView(current => ({
			...current,
			x: element.clientWidth / 2 - centerPoint.left * current.k,
			y: element.clientHeight / 2 - centerPoint.top * current.k
		}));
	}, [
		displayNodeById,
		orientation,
		revealPassageId,
		revealRequestKey,
		selectedPassage,
		selectedPassageId
	]);

	function canvasPointFromEvent(event: {clientX: number; clientY: number}) {
		if (!canvasRef.current) {
			return undefined;
		}

		const bounds = canvasRef.current.getBoundingClientRect();

		return {
			left: Math.max((event.clientX - bounds.left) / visibleZoom, 0),
			top: Math.max((event.clientY - bounds.top) / visibleZoom, 0)
		};
	}

	function pointFromEvent(
		event: React.MouseEvent<HTMLElement>
	): Point | undefined {
		if ((event.target as HTMLElement).closest(graphInteractiveSelector)) {
			return undefined;
		}

		return canvasPointFromEvent(event);
	}

	// Fit the whole graph into the viewport by setting x/y/k directly. This is
	// the only "framing" action besides explicit reveal — never a scroll.
	function fitToContent() {
		const element = viewportRef.current;

		if (
			!element ||
			!displayBounds ||
			displayBounds.width <= 0 ||
			displayBounds.height <= 0
		) {
			return;
		}

		const rect = element.getBoundingClientRect();
		const k = clampZoom(
			Math.min(
				(rect.width - graphFitPadding * 2) / displayBounds.width,
				(rect.height - graphFitPadding * 2) / displayBounds.height
			)
		);

		setView({
			k,
			x: (rect.width - displayBounds.width * k) / 2 - displayBounds.left * k,
			y: (rect.height - displayBounds.height * k) / 2 - displayBounds.top * k
		});
		persistZoom(k);
	}

	function handleCreateAtEvent(event: React.MouseEvent<HTMLDivElement>) {
		if (contextMenu) {
			return;
		}

		const point = pointFromEvent(event);

		if (point) {
			onCreate(
				displayPointToLogical(point, orientation, logicalGraphBounds),
				defaultCardSize
			);
		}
	}

	function handleContextMenu(event: React.MouseEvent<HTMLDivElement>) {
		const target = event.target as HTMLElement;
		const nodeElement = target.closest<HTMLElement>('[data-passage-id]');
		const nodeId = nodeElement?.dataset.passageId;

		if (nodeId && passagesById.has(nodeId)) {
			event.preventDefault();
			setContextMenu({
				left: event.clientX,
				passageIds:
					selectedIdSet.has(nodeId) && selectedIdSet.size > 1
						? Array.from(selectedIdSet)
						: [nodeId],
				top: event.clientY
			});
			return;
		}

		const point = pointFromEvent(event);

		if (point && !panRef.current?.moved) {
			event.preventDefault();
			setContextMenu({
				left: event.clientX,
				passageIds: [],
				point: displayPointToLogical(point, orientation, logicalGraphBounds),
				top: event.clientY
			});
		}
	}

	function handleViewportPointerDown(
		event: React.PointerEvent<HTMLDivElement>
	) {
		setContextMenu(undefined);
		const wantPan =
			tool === 'pan' || spaceDownRef.current || event.button === 1;

		if (
			![0, 1].includes(event.button) ||
			(!wantPan &&
				(event.target as HTMLElement).closest(graphInteractiveSelector))
		) {
			return;
		}

		const element = viewportRef.current;

		if (!element) {
			return;
		}

		const pointerId =
			typeof event.pointerId === 'number' ? event.pointerId : undefined;

		if (wantPan) {
			const startView = viewRef.current;

			panningViewRef.current = startView;
			panRef.current = {
				currentLeft: startView.x,
				currentTop: startView.y,
				left: startView.x,
				moved: false,
				pointerId,
				startLeft: startView.x,
				startTop: startView.y,
				top: startView.y,
				x: event.clientX,
				y: event.clientY
			};
			if (pointerId !== undefined) {
				element.setPointerCapture(pointerId);
			}
			element.classList.add('story-edit-graph-viewport--panning');
			event.preventDefault();
			return;
		}

		// Plain left-drag on empty canvas = marquee select.
		const start = canvasPointFromEvent(event);

		if (!start) {
			return;
		}

		setMarquee({
			additive: event.shiftKey || event.metaKey || event.ctrlKey,
			pointerId,
			rect: rectFromPoints(start, start),
			startLeft: start.left,
			startTop: start.top
		});
		if (pointerId !== undefined) {
			element.setPointerCapture(pointerId);
		}
		event.preventDefault();
	}

	function handleViewportPointerMove(
		event: React.PointerEvent<HTMLDivElement>
	) {
		const pointerId = event.pointerId;

		if (
			marquee &&
			(marquee.pointerId === undefined || marquee.pointerId === pointerId)
		) {
			const point = canvasPointFromEvent(event);

			if (point) {
				setMarquee(current =>
					current && current.pointerId === pointerId
						? {
								...current,
								rect: rectFromPoints(
									{left: current.startLeft, top: current.startTop},
									point
								)
							}
						: current
				);
			}

			event.preventDefault();
			return;
		}

		const pan = panRef.current;

		if (!pan) {
			return;
		}

		// Pan = move the world layer 1:1 with the pointer. No scrolling.
		const nextX = pan.left + (event.clientX - pan.x);
		const nextY = pan.top + (event.clientY - pan.y);

		pan.moved =
			Math.abs(nextX - pan.startLeft) > 3 || Math.abs(nextY - pan.startTop) > 3;
		pan.currentLeft = nextX;
		pan.currentTop = nextY;
		const nextView = {...viewRef.current, x: nextX, y: nextY};

		panningViewRef.current = nextView;
		viewRef.current = nextView;
		if (canvasRef.current) {
			canvasRef.current.style.transform = `translate(${nextX}px, ${nextY}px) scale(${nextView.k})`;
		}
		if (gridRef.current) {
			gridRef.current.style.backgroundPosition = `${
				nextX - (graphSnapGridSize * nextView.k) / 2
			}px ${nextY - (graphSnapGridSize * nextView.k) / 2}px, ${
				nextX - (graphSnapMajorGridSize * nextView.k) / 2
			}px ${nextY - (graphSnapMajorGridSize * nextView.k) / 2}px`;
		}
		scheduleGraphViewPersistence();
		event.preventDefault();
	}

	function stopPanning(event: React.PointerEvent<HTMLDivElement>) {
		const element = viewportRef.current;

		if (
			element &&
			marquee &&
			(marquee.pointerId === undefined || marquee.pointerId === event.pointerId)
		) {
			if (marquee.pointerId !== undefined) {
				element.releasePointerCapture(marquee.pointerId);
			}
			commitMarqueeSelection(marquee);
			setMarquee(undefined);
			event.preventDefault();
			return;
		}

		const pan = panRef.current;

		if (
			element &&
			pan &&
			(pan.pointerId === undefined || pan.pointerId === event.pointerId)
		) {
			if (pan.pointerId !== undefined) {
				element.releasePointerCapture(pan.pointerId);
			}
			element.classList.remove('story-edit-graph-viewport--panning');
			const nextView = {
				...viewRef.current,
				x: pan.currentLeft,
				y: pan.currentTop
			};

			panningViewRef.current = undefined;
			viewRef.current = nextView;
			setView(nextView);
		}

		panningViewRef.current = undefined;
		panRef.current = undefined;
	}

	function handleViewportWheel(event: React.WheelEvent<HTMLDivElement>) {
		setContextMenu(undefined);

		const element = viewportRef.current;

		if (!element) {
			return;
		}

		event.preventDefault();

		const bounds = element.getBoundingClientRect();

		// Shift + wheel pans horizontally (trackpads send deltaX too).
		if (event.shiftKey && !event.ctrlKey && !event.metaKey) {
			const delta = event.deltaX || event.deltaY;

			setView(current => ({...current, x: current.x - delta}));
			return;
		}

		if (event.deltaY === 0) {
			return;
		}

		// Cursor-anchored, continuous zoom — no animation for the next event to
		// fight, and the world point under the pointer stays pinned.
		zoomToPoint(
			event.clientX - bounds.left,
			event.clientY - bounds.top,
			wheelZoom(viewRef.current.k, event.deltaY)
		);
	}

	function idsInMarqueeRect(rect: Rect) {
		return displayNodes.flatMap(node => {
			const bounds = interactionBounds(
				node,
				drag,
				resize,
				orientation,
				story.snapToGrid,
				visibleZoom
			);

			return rectsIntersect(rect, bounds) ? [node.id] : [];
		});
	}

	function commitMarqueeSelection(selection: MarqueeState) {
		if (selection.rect.width < 2 && selection.rect.height < 2) {
			return;
		}

		const ids = idsInMarqueeRect(selection.rect);
		const next = selection.additive
			? new Set(selectedIdSet)
			: new Set<string>();

		for (const id of ids) {
			next.add(id);
		}

		updateOptimisticSelection(next);
		onSelectIds(Array.from(next), selection.additive);
	}

	function centerViewportOnMinimapPoint(clientX: number, clientY: number) {
		const viewportElement = viewportRef.current;
		const minimapElement = minimapRef.current;

		if (!viewportElement || !minimapElement || !displayBounds) {
			return;
		}

		const rect = minimapElement.getBoundingClientRect();
		const localLeft = Math.max(0, Math.min(clientX - rect.left, rect.width));
		const localTop = Math.max(0, Math.min(clientY - rect.top, rect.height));
		const logicalLeft = (localLeft - minimap.x) / minimap.scale;
		const logicalTop = (localTop - minimap.y) / minimap.scale;

		// Center the viewport on the clicked world point by re-anchoring the
		// transform — no scrolling.
		setView(current => ({
			...current,
			x: viewportElement.clientWidth / 2 - logicalLeft * current.k,
			y: viewportElement.clientHeight / 2 - logicalTop * current.k
		}));
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
		const passage = passagesById.get(node.id);

		if (!passage) {
			return undefined;
		}

		lastAutoCenteredSelection.current = node.id;
		const next = nextSelectionIds(event, passage);

		updateOptimisticSelection(next);
		return next;
	}

	function handleDragStart(
		node: CoreGraphNode,
		event: DraggableEvent,
		data: DraggableData
	) {
		if (tool === 'pan' || spaceDownRef.current) {
			return false;
		}

		const passage = passagesById.get(node.id);

		if (!passage) {
			return;
		}

		const selectedForDrag =
			optimisticSelectedIds.current ?? handleNodePress(node, event);

		const ids =
			selectedForDrag?.has(passage.id) && selectedForDrag.size > 0
				? Array.from(selectedForDrag)
				: [node.id];

		const nextDrag = {
			ids,
			left: data.x,
			startLeft: data.x,
			startTop: data.y,
			top: data.y
		};

		dragRef.current = nextDrag;
		setDrag(undefined);
	}

	function handleDrag(data: DraggableData) {
		const current = dragRef.current;

		if (!current) {
			return;
		}

		const next = {...current, left: data.x, top: data.y};

		dragRef.current = next;

		if (dragDistance(next) < graphDragActivationDistance) {
			setDrag(undefined);
			return;
		}

		document.body.classList.add('dragging-passages');
		setDrag(next);
	}

	function handleDragStop(_event: DraggableEvent, data: DraggableData) {
		document.body.classList.remove('dragging-passages');

		const current = dragRef.current
			? {...dragRef.current, left: data.x, top: data.y}
			: undefined;

		dragRef.current = undefined;
		setDrag(undefined);

		if (!current) {
			return;
		}

		const screenDeltaLeft = current.left - current.startLeft;
		const screenDeltaTop = current.top - current.startTop;
		const moved = Math.hypot(screenDeltaLeft, screenDeltaTop);

		if (moved >= graphDragActivationDistance) {
			const displayDeltaLeft = screenDeltaLeft / visibleZoom;
			const displayDeltaTop = screenDeltaTop / visibleZoom;
			const {left: deltaLeft, top: deltaTop} = displayDeltaToLogical(
				displayDeltaLeft,
				displayDeltaTop,
				orientation
			);

			if (Math.abs(deltaLeft) >= 1 || Math.abs(deltaTop) >= 1) {
				const moves = current.ids
					.map(id => logicalNodeById.get(id))
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
					setOptimisticMoveBounds(currentBounds => ({
						...currentBounds,
						...Object.fromEntries(
							moves.map(move => [move.passageId, move.bounds])
						)
					}));
					host.applyStoryCommand(movePassagesCommand(story.id, moves));
				}
			}
		}

		recentlyDragged.current = true;
		window.setTimeout(() => {
			recentlyDragged.current = false;
		}, 0);
	}

	function applySizeToSelection(size: {height: number; width: number}) {
		if (selectedPassages.length === 0) {
			return;
		}

		host.applyStoryCommand(
			movePassagesCommand(
				story.id,
				selectedPassages.map(passage => ({
					bounds: {
						...passageRect(passage),
						height: size.height,
						width: size.width
					},
					passageId: passage.id
				}))
			)
		);
	}

	function handleDefaultSizeChange(value: string) {
		const preset = value as GraphSizePreset;

		prefsDispatch(setPref('graphDefaultCardSize', preset));
	}

	function handleApplyDefaultSize() {
		applySizeToSelection(graphSizePresets[defaultSize]);
	}

	function handleResizeStart(node: CoreGraphNode, data: DraggableData) {
		if (tool === 'pan' || spaceDownRef.current) {
			return false;
		}

		const ids =
			selectedIdSet.has(node.id) && selectedIdSet.size > 0
				? Array.from(selectedIdSet)
				: [node.id];
		const bounds = displayNodeById.get(node.id)?.bounds ?? node.bounds;

		setResize({
			currentHeight: bounds.height,
			currentWidth: bounds.width,
			height: bounds.height,
			ids,
			startLeft: data.x,
			startTop: data.y,
			width: bounds.width
		});
	}

	function handleResize(data: DraggableData) {
		setResize(current => {
			if (!current) {
				return current;
			}

			const minimum = displaySizeLimits();
			const corner = resizeCorner(orientation);
			const widthDelta =
				(corner === 'bottom-left' || corner === 'top-left'
					? current.startLeft - data.x
					: data.x - current.startLeft) / visibleZoom;
			const heightDelta =
				(corner === 'top-left'
					? current.startTop - data.y
					: data.y - current.startTop) / visibleZoom;

			if (Math.hypot(widthDelta, heightDelta) < resizeSnapActivationDistance) {
				return {
					...current,
					currentHeight: current.height,
					currentWidth: current.width
				};
			}

			const displaySize = freeResizeDisplaySize(
				{
					height: Math.max(minimum.height, current.height + heightDelta),
					width: Math.max(minimum.width, current.width + widthDelta)
				},
				orientation
			);

			return {
				...current,
				currentHeight: displaySize.height,
				currentWidth: displaySize.width
			};
		});
	}

	function handleResizeStop() {
		setResize(current => {
			if (!current) {
				return undefined;
			}

			const size = logicalSizeFromDisplaySize(
				{
					height: current.currentHeight,
					width: current.currentWidth
				},
				orientation
			);
			const moves = current.ids
				.map(id => passagesById.get(id))
				.filter((passage): passage is Passage => !!passage)
				.filter(
					passage =>
						passage.height !== size.height || passage.width !== size.width
				)
				.map(passage => {
					return {
						bounds: {
							...passageRect(passage),
							height: size.height,
							width: size.width
						},
						passageId: passage.id
					};
				});

			if (moves.length > 0) {
				setOptimisticMoveBounds(currentBounds => ({
					...currentBounds,
					...Object.fromEntries(
						moves.map(move => [move.passageId, move.bounds])
					)
				}));
				host.applyStoryCommand(movePassagesCommand(story.id, moves));
			}

			return undefined;
		});
	}

	function handleNodeClick(node: CoreGraphNode, event: React.MouseEvent) {
		const passage = passagesById.get(node.id);

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
		if (event.button !== 0 || tool === 'pan' || spaceDownRef.current) {
			return;
		}

		selectionHandledOnPointerDown.current = node.id;
		handleNodePress(node, event as unknown as React.MouseEvent);
	}

	function handleNodeDoubleClick(node: CoreGraphNode) {
		const passage = passagesById.get(node.id);

		if (passage) {
			lastAutoCenteredSelection.current = node.id;
			onEdit(passage);
		}
	}

	function contextMenuPassages() {
		return (
			contextMenu?.passageIds
				.map(id => passagesById.get(id))
				.filter((passage): passage is Passage => !!passage) ?? []
		);
	}

	function handleContextEdit() {
		const passages = contextMenuPassages();

		if (passages.length === 1) {
			onEdit(passages[0]);
		} else if (passages.length > 1) {
			onEditPassages(passages);
		}

		setContextMenu(undefined);
	}

	function handleContextCreate() {
		if (contextMenu?.point) {
			onCreate(contextMenu.point, defaultCardSize);
		}

		setContextMenu(undefined);
	}

	function handleContextTest() {
		const passage = contextMenuPassages()[0];

		if (passage) {
			onTestPassage?.(passage);
		}

		setContextMenu(undefined);
	}

	function nodeDisplayBounds(node: CoreGraphNode) {
		return interactionBounds(
			node,
			drag,
			resize,
			orientation,
			story.snapToGrid,
			visibleZoom
		);
	}

	function nodeSizeClass(bounds: CoreRect) {
		return classNames(
			(bounds.height < 106 || bounds.width < 164) &&
				'story-edit-graph-node--compact',
			(bounds.height < 86 || bounds.width < 128) &&
				'story-edit-graph-node--tiny'
		);
	}

	const graphLayerStyle = {
		'--story-edit-snap-grid-size': `${graphSnapGridSize}px`,
		'--story-edit-snap-major-grid-size': `${graphSnapMajorGridSize}px`
	} as React.CSSProperties;

	return (
		<section
			className={classNames(
				'story-edit-graph-layer',
				story.snapToGrid
					? 'story-edit-graph-layer--snap-on'
					: 'story-edit-graph-layer--snap-off'
			)}
			aria-label="Story graph"
			style={graphLayerStyle}
		>
			<div
				className={classNames(
					'story-edit-graph-viewport',
					panning && 'story-edit-graph-viewport--pan-tool',
					shiftSelecting && 'story-edit-graph-viewport--selecting-mode',
					marquee && 'story-edit-graph-viewport--marqueeing'
				)}
				onContextMenu={handleContextMenu}
				onDoubleClick={handleCreateAtEvent}
				onPointerDown={handleViewportPointerDown}
				onPointerMove={handleViewportPointerMove}
				onPointerUp={stopPanning}
				onPointerCancel={stopPanning}
				onWheel={handleViewportWheel}
				ref={viewportRef}
			>
				{/* Grid drawn in screen space but positioned/scaled to track the
				    world transform, so the dots ARE the snap targets and move 1:1
				    with pan/zoom (offset half a cell so a snapped corner lands on a
				    dot). */}
				<div
					aria-hidden
					className="story-edit-graph-grid"
					ref={gridRef}
					style={{
						backgroundPosition: `${
							renderedView.x - (graphSnapGridSize * renderedView.k) / 2
						}px ${
							renderedView.y - (graphSnapGridSize * renderedView.k) / 2
						}px, ${
							renderedView.x - (graphSnapMajorGridSize * renderedView.k) / 2
						}px ${
							renderedView.y - (graphSnapMajorGridSize * renderedView.k) / 2
						}px`,
						backgroundSize: `${graphSnapGridSize * renderedView.k}px ${
							graphSnapGridSize * renderedView.k
						}px, ${graphSnapMajorGridSize * renderedView.k}px ${
							graphSnapMajorGridSize * renderedView.k
						}px`
					}}
				/>
				<div
					className="story-edit-graph-canvas"
					ref={canvasRef}
					style={{
						transform: `translate(${renderedView.x}px, ${renderedView.y}px) scale(${renderedView.k})`,
						transformOrigin: '0 0'
					}}
				>
					<GraphEdgesCanvas
						drawBounds={edgeDrawBounds}
						edges={displayEdges}
						nodeById={liveNodeById}
						selectedNodeIds={displaySelectedIdSet}
						visibleZoom={visibleZoom}
					/>
					{marquee && (
						<div
							aria-hidden
							className="story-edit-graph-marquee"
							style={{
								height: marquee.rect.height,
								left: marquee.rect.left,
								top: marquee.rect.top,
								width: marquee.rect.width
							}}
						/>
					)}
					<div className="story-edit-graph-nodes">
						{displayNodes.map(node => {
							const draggableNodeRef = keyedElementRef(
								draggableNodeRefs.current,
								node.id
							);
							const resizeHandleRef = keyedElementRef(
								resizeHandleRefs.current,
								node.id
							);
							const passage = passagesById.get(node.id);
							const bounds = nodeDisplayBounds(node);
							const resizeHandleCorner = resizeCorner(orientation);
							const tagColors = node.tags.map(
								tag => story.tagColors[tag] ?? 'blue'
							);
							const accent = tagColors[0];

							if (!passage) {
								return null;
							}

							return (
								<DraggableCore
									cancel=".story-edit-graph-node__resize"
									disabled={panning}
									key={node.id}
									nodeRef={draggableNodeRef}
									onDrag={(event, data) => handleDrag(data)}
									onStart={(event, data) => handleDragStart(node, event, data)}
									onStop={handleDragStop}
								>
									<div
										className={classNames(
											'story-edit-graph-node',
											nodeSizeClass(bounds)
										)}
										data-layout-source={node.layoutSource}
										data-passage-id={node.id}
										data-selected={displaySelectedIdSet.has(node.id)}
										onPointerDown={event => handleNodePointerDown(node, event)}
										ref={draggableNodeRef}
										style={{
											height: bounds.height,
											left: bounds.left,
											top: bounds.top,
											width: bounds.width
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
												renderedDensity === 'excerpt' ? node.excerpt : undefined
											}
											links={node.outgoingCount}
											onClick={event => handleNodeClick(node, event)}
											onDoubleClick={() => handleNodeDoubleClick(node)}
											selected={displaySelectedIdSet.has(node.id)}
											start={node.isStart}
											style={{
												height: bounds.height,
												width: bounds.width
											}}
											tagColors={story.tagColors}
											tagDisplay={prefs.passageTagDisplay}
											tags={renderedDensity === 'structure' ? [] : node.tags}
											title={node.name}
										/>
										{selectedIdSet.has(node.id) && (
											<DraggableCore
												disabled={panning}
												nodeRef={resizeHandleRef}
												onDrag={(event, data) => handleResize(data)}
												onStart={(event, data) => handleResizeStart(node, data)}
												onStop={handleResizeStop}
											>
												<button
													aria-label={`Resize ${node.name}`}
													className={classNames(
														'story-edit-graph-node__resize',
														`story-edit-graph-node__resize--${resizeHandleCorner}`
													)}
													onClick={event => event.stopPropagation()}
													onDoubleClick={event => event.stopPropagation()}
													onPointerDown={event => {
														if (tool !== 'pan' && !spaceDownRef.current) {
															event.stopPropagation();
														}
													}}
													ref={resizeHandleRef}
													type="button"
												>
													<TablerIcon
														icon={resizeHandleIcon(resizeHandleCorner)}
													/>
												</button>
											</DraggableCore>
										)}
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
						active={tool === 'select'}
						icon="pointer"
						label="Select tool (V)"
						onClick={() => setTool('select')}
						size="sm"
					/>
					<IconButton
						active={tool === 'pan'}
						icon="hand-grab"
						label="Pan tool (H, or hold Space)"
						onClick={() => setTool('pan')}
						size="sm"
					/>
				</div>
				<div className="story-edit-graph-toolbar-group">
					{onTestPassage && (
						<Button
							disabled={!soloSelectedPassage || testPassagePending}
							icon="tool"
							loading={
								!!soloSelectedPassage &&
								testPassagePendingId === soloSelectedPassage.id
							}
							onClick={() =>
								soloSelectedPassage && onTestPassage(soloSelectedPassage)
							}
							size="sm"
							variant="primary"
						>
							Test From Here
						</Button>
					)}
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
					{formatReferencesAvailable && (
						<IconButton
							active={layers.references}
							icon="braces"
							label="Story format references"
							onClick={() =>
								setLayers(current => ({
									...current,
									references: !current.references
								}))
							}
							size="sm"
						/>
					)}
					<IconButton
						active={focusSelection}
						disabled={selectedPassageIds.length === 0}
						icon="focus-2"
						label="Focus selected passages"
						onClick={() => setFocusSelection(value => !value)}
						size="sm"
						tooltipPosition="bottom"
					/>
					<IconButton
						active={story.snapToGrid}
						icon="grid-dots"
						label="Snap to grid"
						onClick={() =>
							host.applyStoryCommand(
								setStorySnapToGridCommand(story.id, !story.snapToGrid)
							)
						}
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
				<div className="story-edit-graph-toolbar-group story-edit-graph-toolbar-group--size">
					<Select
						ariaLabel="Default card size"
						onChange={handleDefaultSizeChange}
						options={graphSizePresetEntries.map(([value, preset]) => ({
							label: preset.label,
							value
						}))}
						size="sm"
						value={defaultSize}
					/>
					<Button
						disabled={selectedPassages.length === 0}
						icon="resize"
						onClick={handleApplyDefaultSize}
						size="sm"
						variant="ghost"
					>
						Apply
					</Button>
					<span className="story-edit-graph-toolbar-hint">
						{selectedPassages.length > 1
							? `${selectedPassages.length} selected`
							: currentSizeLabel}
					</span>
				</div>
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
				{showSaveLayoutAction && (
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
				)}
			</div>
			<div
				className="story-edit-graph-zoom"
				onContextMenu={event => event.stopPropagation()}
				onDoubleClick={event => event.stopPropagation()}
				onPointerDown={event => event.stopPropagation()}
			>
				<IconButton
					icon="minus"
					label="Zoom out"
					onClick={() => zoomAtViewportCenter(1 / graphButtonZoomFactor)}
					size="sm"
				/>
				<span className="story-edit-graph-zoom-value">
					{Math.round(view.k * 100)}%
				</span>
				<IconButton
					icon="plus"
					label="Zoom in"
					onClick={() => zoomAtViewportCenter(graphButtonZoomFactor)}
					size="sm"
				/>
				<span className="story-edit-graph-zoom-sep" />
				<IconButton
					icon="maximize"
					label="Fit graph to window (0)"
					onClick={fitToContent}
					size="sm"
				/>
			</div>
			{displayBounds && (
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
						<GraphMinimapCanvas
							logicalBounds={logicalGraphBounds}
							minimap={minimap}
							optimisticBounds={optimisticMoveBounds}
							orientation={orientation}
							selectedNodeIds={displaySelectedIdSet}
							story={story}
						/>
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
			{contextMenu && (
				<div
					className="story-edit-graph-context-menu"
					onClick={event => event.stopPropagation()}
					onContextMenu={event => event.preventDefault()}
					style={{
						left: contextMenu.left,
						top: contextMenu.top
					}}
				>
					{contextMenu.passageIds.length > 0 ? (
						<>
							<button onClick={handleContextEdit} type="button">
								<TablerIcon icon="edit" />
								<span>
									{contextMenu.passageIds.length > 1
										? `Edit ${contextMenu.passageIds.length} passages`
										: 'Edit passage'}
								</span>
							</button>
							{contextMenu.passageIds.length === 1 && onTestPassage && (
								<button
									aria-busy={
										testPassagePendingId === contextMenu.passageIds[0] ||
										undefined
									}
									disabled={testPassagePending}
									onClick={handleContextTest}
									type="button"
								>
									{testPassagePendingId === contextMenu.passageIds[0] ? (
										<span className="tw-btn__spin" aria-hidden />
									) : (
										<TablerIcon icon="tool" />
									)}
									<span>Test From Here</span>
								</button>
							)}
						</>
					) : (
						<>
							<button onClick={handleContextCreate} type="button">
								<TablerIcon icon="plus" />
								<span>New passage here</span>
							</button>
							<button
								onClick={() => {
									fitToContent();
									setContextMenu(undefined);
								}}
								type="button"
							>
								<TablerIcon icon="maximize" />
								<span>Fit graph to window</span>
							</button>
							<button
								onClick={() => {
									host.applyStoryCommand(
										setStorySnapToGridCommand(story.id, !story.snapToGrid)
									);
									setContextMenu(undefined);
								}}
								type="button"
							>
								<TablerIcon icon={story.snapToGrid ? 'check' : 'grid-dots'} />
								<span>Snap to grid</span>
							</button>
						</>
					)}
				</div>
			)}
		</section>
	);
};
