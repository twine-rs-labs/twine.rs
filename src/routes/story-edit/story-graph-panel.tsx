import classNames from 'classnames';
import * as React from 'react';
import {DraggableCore, DraggableData, DraggableEvent} from 'react-draggable';
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
	movePassagesCommand,
	saveGeneratedLayoutCommand,
	useCoreProjectHost
} from '../../core';
import {setPref, usePrefsContext} from '../../store/prefs';
import type {GraphCardSizePreference} from '../../store/prefs';
import type {CoreGraphEdge} from '../../core/bindings/CoreGraphEdge';
import type {CoreGraphLayoutState} from '../../core/bindings/CoreGraphLayoutState';
import type {CoreGraphNode} from '../../core/bindings/CoreGraphNode';
import type {CoreGraphProjection} from '../../core/bindings/CoreGraphProjection';
import type {CoreLinkLayerOptions} from '../../core/bindings/CoreLinkLayerOptions';
import type {CoreRect} from '../../core/bindings/CoreRect';
import {Passage, Story} from '../../store/stories';
import {Point} from '../../util/geometry';
import {markPerformanceAfterPaint} from '../../util/performance';

export interface StoryGraphPanelProps {
	onCreate: (point: Point, size?: {height: number; width: number}) => void;
	onDeselect: (passage: Passage) => void;
	onEdit: (passage: Passage) => void;
	onSelect: (passage: Passage, exclusive: boolean) => void;
	onTestPassage?: (passage: Passage) => void;
	selectedPassageId?: string;
	story: Story;
	visibleZoom: number;
	zoom: number;
}

type GraphDensity = 'structure' | 'names' | 'excerpt';
type GraphOrientation = 'right' | 'down' | 'left' | 'up';
type GraphSizePreset = GraphCardSizePreference;
type ResizeCorner = 'bottom-left' | 'bottom-right' | 'top-left';

const graphSizePresets: Record<
	GraphSizePreset,
	{height: number; label: string; width: number}
> = {
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

interface ViewportState {
	height: number;
	left: number;
	top: number;
	width: number;
}

interface AsyncProjectionState {
	projection: CoreGraphProjection;
	queryKey: string;
	story: Story;
}

const minimapSize = {height: 120, width: 170};
const canvasPad = 900;
const graphSnapGridSize = 26;
const largeStoryPassageCount = 500;
const maxExcerptNodes = 160;
const exposeEdgeRouteDebug = process.env.NODE_ENV === 'test';
const graphInteractiveSelector =
	'.story-edit-graph-node, .story-edit-graph-toolbar, .story-edit-graph-status, .story-edit-graph-minimap, .story-edit-graph-card-tools';
const resizeSnapActivationDistance = 18;
const graphProjectionTileSize = 600;
const graphProjectionOverscan = 1200;

function excerpt(text: string) {
	let compact = '';
	let previousWhitespace = false;
	const textLimit = Math.min(text.length, 260);

	for (let index = 0; index < textLimit && compact.length < 160; index++) {
		const character = text[index];
		const whitespace =
			character === ' ' ||
			character === '\n' ||
			character === '\r' ||
			character === '\t';

		if (whitespace) {
			if (!previousWhitespace && compact.length > 0) {
				compact += ' ';
			}

			previousWhitespace = true;
		} else {
			compact += character;
			previousWhitespace = false;
		}
	}

	const trimmed = compact.trim();

	return text.length > textLimit || trimmed.length > 157
		? `${trimmed.slice(0, 157)}...`
		: trimmed;
}

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

function orientationLabel(orientation: GraphOrientation) {
	switch (orientation) {
		case 'down':
			return 'Top to Bottom';
		case 'left':
			return 'Right to Left';
		case 'up':
			return 'Bottom to Top';
		default:
			return 'Left to Right';
	}
}

function nextOrientation(orientation: GraphOrientation): GraphOrientation {
	switch (orientation) {
		case 'right':
			return 'down';
		case 'down':
			return 'left';
		case 'left':
			return 'up';
		default:
			return 'right';
	}
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

function nearestPresetForSize(size: {height: number; width: number}) {
	return graphSizePresetEntries.reduce<{
		preset: GraphSizePreset;
		score: number;
	}>(
		(best, [preset, dimensions]) => {
			const widthScore = (size.width - dimensions.width) / 48;
			const heightScore = (size.height - dimensions.height) / 48;
			const aspectScore =
				size.height > 0
					? size.width / size.height - dimensions.width / dimensions.height
					: 0;
			const score =
				widthScore * widthScore +
				heightScore * heightScore +
				aspectScore * aspectScore * 0.4;

			return score < best.score ? {preset, score} : best;
		},
		{preset: 'medium', score: Number.POSITIVE_INFINITY}
	).preset;
}

function displaySizeLimits(orientation: GraphOrientation) {
	return orientation === 'down' || orientation === 'up'
		? {height: 110, width: 74}
		: {height: 74, width: 110};
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

function displaySizeForPreset(
	preset: GraphSizePreset,
	orientation: GraphOrientation
) {
	return displaySizeForLogicalSize(graphSizePresets[preset], orientation);
}

function snappedResizeDisplaySize(
	size: {height: number; width: number},
	orientation: GraphOrientation
) {
	return displaySizeForPreset(
		nearestPresetForSize(logicalSizeFromDisplaySize(size, orientation)),
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

function edgeCurve(edge: CoreGraphEdge, nodeById: Map<string, CoreGraphNode>) {
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
	edges: CoreGraphEdge[],
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
	edges: CoreGraphEdge[];
	nodeById: Map<string, CoreGraphNode>;
	visibleZoom: number;
}

const GraphEdgesCanvas: React.FC<GraphEdgesCanvasProps> = ({
	drawBounds,
	edges,
	nodeById,
	visibleZoom
}) => {
	const canvasRef = React.useRef<HTMLCanvasElement>(null);
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
			resolved:
				styles.getPropertyValue('--sem-link').trim() || 'rgb(92, 151, 255)',
			selfLink:
				styles.getPropertyValue('--sem-generated').trim() || 'rgb(92, 180, 220)'
		};

		for (const edge of edges) {
			const curve = edgeCurve(edge, nodeById);
			const color = colors[edge.kind] ?? colors.resolved;

			context.strokeStyle = color;
			context.fillStyle = color;
			context.setLineDash(edge.kind === 'broken' ? [6, 5] : []);
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
	}, [
		drawBounds.height,
		drawBounds.left,
		drawBounds.top,
		drawBounds.width,
		edges,
		nodeById,
		visibleZoom
	]);

	return (
		<canvas
			aria-hidden
			className="story-edit-graph-edges"
			data-edge-count={edges.length}
			data-edge-kinds={edgeKinds}
			data-edge-routes={edgeRoutes}
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

function snapToGraphGrid(value: number) {
	return Math.round(value / graphSnapGridSize) * graphSnapGridSize;
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
		onTestPassage,
		selectedPassageId,
		story,
		visibleZoom,
		zoom
	} = props;
	const host = useCoreProjectHost();
	const {dispatch: prefsDispatch, prefs} = usePrefsContext();
	const [density, setDensity] = React.useState<GraphDensity>(() =>
		defaultGraphDensity(story)
	);
	const [orientation, setOrientation] =
		React.useState<GraphOrientation>('right');
	const defaultSize = prefs.graphDefaultCardSize;
	const [focusSelection, setFocusSelection] = React.useState(false);
	const [layers, setLayers] = React.useState<CoreLinkLayerOptions>({
		broken: true,
		resolved: true,
		selfLinks: true
	});
	const [drag, setDrag] = React.useState<DragState>();
	const [resize, setResize] = React.useState<ResizeState>();
	const [viewport, setViewport] = React.useState<ViewportState>({
		height: 1,
		left: 0,
		top: 0,
		width: 1
	});
	const viewportRef = React.useRef<HTMLDivElement>(null);
	const canvasRef = React.useRef<HTMLDivElement>(null);
	const minimapRef = React.useRef<HTMLDivElement>(null);
	const viewportFrame = React.useRef<number>();
	const lastAutoCenteredSelection = React.useRef<string>();
	const optimisticSelectedIds = React.useRef<Set<string>>();
	const selectionHandledOnPointerDown = React.useRef<string>();
	const [optimisticSelectionKey, setOptimisticSelectionKey] =
		React.useState('');
	const [asyncProjection, setAsyncProjection] =
		React.useState<AsyncProjectionState>();
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
		focusSelection || orientation !== 'right' ? null : projectionViewport;
	const projectionQuery = React.useMemo(
		() => ({
			focus:
				focusSelection && selectedPassageIds.length > 0
					? {
							direction: 'both' as const,
							passageIds: selectedPassageIds,
							radius: 1
						}
					: null,
			layers,
			viewport: queryViewport
		}),
		[focusSelection, layers, queryViewport, selectedPassageIds]
	);
	const projectionQueryKey = React.useMemo(
		() => JSON.stringify(projectionQuery),
		[projectionQuery]
	);
	const projectionSnapshot = React.useMemo(
		() => host.queryGraphProjection(story.id, projectionQuery),
		[host, projectionQuery, projectionQueryKey, story.id, story]
	);
	const projection =
		asyncProjection?.story === story &&
		asyncProjection.queryKey === projectionQueryKey
			? asyncProjection.projection
			: projectionSnapshot;

	React.useEffect(() => {
		if (host.runtimeMode() !== 'wasm-worker') {
			setAsyncProjection(undefined);
			return;
		}

		let active = true;
		const queryKey = projectionQueryKey;

		void host
			.queryGraphProjectionAsync(story.id, projectionQuery)
			.then(projection => {
				if (active) {
					setAsyncProjection({projection, queryKey, story});
				}
			});

		return () => {
			active = false;
		};
	}, [host, projectionQuery, projectionQueryKey, story.id, story]);

	React.useEffect(() => {
		if (projection.nodes.length > 0 || projection.bounds) {
			markPerformanceAfterPaint('graph-visible');
		}
	}, [projection.bounds, projection.nodes.length]);
	const nodeById = React.useMemo(
		() => new Map(projection.nodes.map(node => [node.id, node])),
		[projection.nodes]
	);
	const displayBounds = React.useMemo(
		() => orientedBounds(projection.bounds, orientation),
		[orientation, projection.bounds]
	);
	const displayNodes = React.useMemo(
		() =>
			projection.nodes.map(node => ({
				...node,
				bounds: displayRect(node.bounds, orientation, projection.bounds)
			})),
		[orientation, projection.bounds, projection.nodes]
	);
	const displayNodeById = React.useMemo(
		() => new Map(displayNodes.map(node => [node.id, node])),
		[displayNodes]
	);
	const displayEdges = React.useMemo(
		() =>
			projection.edges.map(edge => ({
				...edge,
				sourceBounds: displayRect(
					edge.sourceBounds,
					orientation,
					projection.bounds
				),
				targetBounds: edge.targetBounds
					? displayRect(edge.targetBounds, orientation, projection.bounds)
					: edge.targetBounds
			})),
		[orientation, projection.bounds, projection.edges]
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
	const canvasSize = React.useMemo(() => {
		const bounds = displayBounds;

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
	}, [displayBounds, viewport.height, viewport.width, visibleZoom]);
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
	const minimapNodes = React.useMemo(
		() =>
			story.passages.flatMap(passage => {
				const bounds = passageRect(passage);

				return validRect(bounds)
					? [
							{
								bounds: displayRect(bounds, orientation, projection.bounds),
								id: passage.id
							}
						]
					: [];
			}),
		[orientation, projection.bounds, story.passages]
	);
	const showSaveLayoutAction =
		projection.layoutState !== 'generated' ||
		prefs.graphGeneratedLayoutSavePrompt;
	const renderedDensity =
		density === 'excerpt' && displayNodes.length > maxExcerptNodes
			? 'names'
			: density;

	const readViewport = React.useCallback(() => {
		const element = viewportRef.current;

		if (!element) {
			return;
		}

		const next = {
			height: element.clientHeight / visibleZoom,
			left: element.scrollLeft / visibleZoom,
			top: element.scrollTop / visibleZoom,
			width: element.clientWidth / visibleZoom
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
	}, [visibleZoom]);

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
		setDensity(defaultGraphDensity(story));
	}, [story.id]);

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
			? displayNodeById.get(selectedPassageId)
			: undefined;
		const fallbackBounds =
			selectedPassage &&
			orientation === 'right' &&
			validRect(passageRect(selectedPassage))
				? passageRect(selectedPassage)
				: undefined;
		const bounds = node?.bounds ?? fallbackBounds;

		if (!selectedPassageId) {
			lastAutoCenteredSelection.current = undefined;
			return;
		}

		if (
			!element ||
			!bounds ||
			lastAutoCenteredSelection.current === selectedPassageId
		) {
			return;
		}

		lastAutoCenteredSelection.current = selectedPassageId;

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
	}, [
		displayNodeById,
		orientation,
		selectedPassage,
		selectedPassageId,
		visibleZoom
	]);

	function pointFromEvent(
		event: React.MouseEvent<HTMLElement>
	): Point | undefined {
		if (
			!canvasRef.current ||
			(event.target as HTMLElement).closest(graphInteractiveSelector)
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
			onCreate(
				displayPointToLogical(point, orientation, projection.bounds),
				defaultCardSize
			);
		}
	}

	function handleContextMenu(event: React.MouseEvent<HTMLDivElement>) {
		const point = pointFromEvent(event);

		if (point && !panRef.current?.moved) {
			event.preventDefault();
			onCreate(
				displayPointToLogical(point, orientation, projection.bounds),
				defaultCardSize
			);
		}
	}

	function handleViewportPointerDown(
		event: React.PointerEvent<HTMLDivElement>
	) {
		if (
			![0, 1, 2].includes(event.button) ||
			(event.target as HTMLElement).closest(graphInteractiveSelector)
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
		if (event.button !== 0) {
			event.preventDefault();
		}
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
		updateViewport();
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

		if (!viewportElement || !minimapElement || !displayBounds) {
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
		const passage = passagesById.get(node.id);

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
		const passage = passagesById.get(node.id);

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

			const displayDeltaLeft = (current.left - current.startLeft) / zoom;
			const displayDeltaTop = (current.top - current.startTop) / zoom;
			const {left: deltaLeft, top: deltaTop} = displayDeltaToLogical(
				displayDeltaLeft,
				displayDeltaTop,
				orientation
			);

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

			const minimum = displaySizeLimits(orientation);
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

			const displaySize = snappedResizeDisplaySize(
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
		if (event.button !== 0) {
			return;
		}

		selectionHandledOnPointerDown.current = node.id;
		handleNodePress(node, event as unknown as React.MouseEvent);
	}

	function handleNodeDoubleClick(node: CoreGraphNode) {
		const passage = passagesById.get(node.id);

		if (passage) {
			onEdit(passage);
		}
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
					<GraphEdgesCanvas
						drawBounds={edgeDrawBounds}
						edges={displayEdges}
						nodeById={liveNodeById}
						visibleZoom={visibleZoom}
					/>
					<div className="story-edit-graph-nodes">
						{displayNodes.map(node => {
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
									key={node.id}
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
										data-selected={selectedIdSet.has(node.id)}
										onPointerDown={event => handleNodePointerDown(node, event)}
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
												renderedDensity === 'excerpt'
													? excerpt(passage.text)
													: undefined
											}
											links={node.outgoingCount}
											onClick={event => handleNodeClick(node, event)}
											onDoubleClick={() => handleNodeDoubleClick(node)}
											selected={selectedIdSet.has(node.id)}
											start={node.isStart}
											style={{
												height: bounds.height,
												width: bounds.width
											}}
											tags={renderedDensity === 'structure' ? [] : tagColors}
											title={node.name}
										/>
										{selectedIdSet.has(node.id) && (
											<DraggableCore
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
													onPointerDown={event => event.stopPropagation()}
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
					{onTestPassage && (
						<Button
							disabled={!soloSelectedPassage}
							icon="tool"
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
				<div className="story-edit-graph-toolbar-group">
					<IconButton
						icon="rotate-clockwise"
						label={`Rotate view: ${orientationLabel(orientation)}`}
						onClick={() => setOrientation(current => nextOrientation(current))}
						size="sm"
						tooltipPosition="bottom"
					/>
					<span className="story-edit-graph-toolbar-hint">
						{orientationLabel(orientation)}
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
						{minimapNodes.map(node => (
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
