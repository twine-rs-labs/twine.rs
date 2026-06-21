import type {CoreGraphDirection} from './bindings/CoreGraphDirection';
import type {CoreGraphEdge} from './bindings/CoreGraphEdge';
import type {CoreGraphEdgeKind} from './bindings/CoreGraphEdgeKind';
import type {CoreGraphFocus} from './bindings/CoreGraphFocus';
import type {CoreGraphLayoutState} from './bindings/CoreGraphLayoutState';
import type {CoreGraphNode} from './bindings/CoreGraphNode';
import type {CoreGraphProjection} from './bindings/CoreGraphProjection';
import type {CoreGraphProjectionOptions} from './bindings/CoreGraphProjectionOptions';
import type {CoreLinkLayerOptions} from './bindings/CoreLinkLayerOptions';
import type {CoreRect} from './bindings/CoreRect';
import type {PassageMove} from './bindings/PassageMove';
import type {Passage, Story} from '../store/stories';
import {boundingRect, rectsIntersect} from '../util/geometry';
import {parseLinks} from '../util/parse-links';

export type GraphProjectionQuery = Partial<
	Omit<CoreGraphProjectionOptions, 'layers'>
> & {
	layers?: Partial<CoreLinkLayerOptions>;
};

interface LinkEdge {
	kind: CoreGraphEdgeKind;
	sourceId: string;
	targetId: string | null;
	targetName: string;
}

interface LayoutEntry {
	bounds: CoreRect;
	source: 'saved' | 'generated';
}

interface GraphIndex {
	backlinks: Map<string, string[]>;
	nodes: Map<string, CoreGraphNode>;
	outgoing: Map<string, LinkEdge[]>;
	stats: CoreGraphProjection['stats'];
	storyOrder: string[];
	storyRank: Map<string, number>;
}

interface LayoutSnapshot {
	bounds: CoreRect | null;
	entries: Map<string, LayoutEntry>;
	state: CoreGraphLayoutState;
}

const defaultLayers: CoreLinkLayerOptions = {
	broken: true,
	resolved: true,
	selfLinks: true
};

const defaultOptions: CoreGraphProjectionOptions = {
	focus: null,
	layers: defaultLayers,
	viewport: null
};

const generatedLayout = {
	cardHeight: 110,
	cardWidth: 184,
	columnGap: 240,
	componentGap: 260,
	originLeft: 0,
	originTop: 0,
	rowGap: 160
};

const viewportOverscan = 256;

function normalizeOptions(
	options: GraphProjectionQuery = {}
): CoreGraphProjectionOptions {
	return {
		...defaultOptions,
		...options,
		layers: {...defaultLayers, ...options.layers}
	};
}

function safeBounds(passage: Passage): CoreRect | undefined {
	const bounds = {
		height: passage.height,
		left: passage.left,
		top: passage.top,
		width: passage.width
	};

	return Object.values(bounds).every(Number.isFinite) &&
		bounds.width > 0 &&
		bounds.height > 0
		? bounds
		: undefined;
}

function includesLayer(layers: CoreLinkLayerOptions, kind: CoreGraphEdgeKind) {
	return kind === 'resolved'
		? layers.resolved
		: kind === 'broken'
			? layers.broken
			: layers.selfLinks;
}

function expandRect(rect: CoreRect, amount: number): CoreRect {
	return {
		height: rect.height + amount * 2,
		left: rect.left - amount,
		top: rect.top - amount,
		width: rect.width + amount * 2
	};
}

function graphBounds(bounds: CoreRect[]) {
	return bounds.length > 0 ? boundingRect(bounds) : null;
}

function neighbors(
	index: GraphIndex,
	id: string,
	direction: CoreGraphDirection
) {
	const result = new Set<string>();

	if (direction === 'outgoing' || direction === 'both') {
		for (const edge of index.outgoing.get(id) ?? []) {
			if (edge.targetId && edge.targetId !== id) {
				result.add(edge.targetId);
			}
		}
	}

	if (direction === 'incoming' || direction === 'both') {
		for (const sourceId of index.backlinks.get(id) ?? []) {
			if (sourceId !== id) {
				result.add(sourceId);
			}
		}
	}

	return Array.from(result).sort(
		(left, right) =>
			(index.storyRank.get(left) ?? Number.MAX_SAFE_INTEGER) -
			(index.storyRank.get(right) ?? Number.MAX_SAFE_INTEGER)
	);
}

function neighborhood(index: GraphIndex, focus: CoreGraphFocus) {
	const result = new Set<string>();
	const queue: Array<{depth: number; id: string}> = [];

	for (const id of focus.passageIds) {
		if (index.nodes.has(id) && !result.has(id)) {
			result.add(id);
			queue.push({depth: 0, id});
		}
	}

	while (queue.length > 0) {
		const {depth, id} = queue.shift()!;

		if (depth >= focus.radius) {
			continue;
		}

		for (const neighbor of neighbors(index, id, focus.direction)) {
			if (!result.has(neighbor)) {
				result.add(neighbor);
				queue.push({depth: depth + 1, id: neighbor});
			}
		}
	}

	return result;
}

function buildGraphIndex(story: Story): GraphIndex {
	const passageByName = new Map(
		story.passages.map(passage => [passage.name, passage])
	);
	const storyOrder = story.passages.map(passage => passage.id);
	const storyRank = new Map(storyOrder.map((id, index) => [id, index]));
	const nodes = new Map<string, CoreGraphNode>();
	const backlinks = new Map<string, string[]>();
	const outgoing = new Map<string, LinkEdge[]>();
	const stats: CoreGraphProjection['stats'] = {
		brokenLinks: 0,
		emptyPassages: story.passages.filter(passage => passage.text.trim() === '')
			.length,
		links: 0,
		orphanPassages: 0,
		passages: story.passages.length,
		resolvedLinks: 0,
		selfLinks: 0,
		taggedPassages: story.passages.filter(passage => passage.tags.length > 0)
			.length,
		unreachablePassages: 0
	};

	for (const passage of story.passages) {
		nodes.set(passage.id, {
			bounds: safeBounds(passage) ?? {
				height: generatedLayout.cardHeight,
				left: 0,
				top: 0,
				width: generatedLayout.cardWidth
			},
			brokenLinkCount: 0,
			id: passage.id,
			incomingCount: 0,
			isEmpty: passage.text.trim() === '',
			isOrphan: false,
			isStart: passage.id === story.startPassage,
			isUnreachable: false,
			layoutSource: 'saved',
			name: passage.name,
			outgoingCount: 0,
			selfLinkCount: 0,
			tags: passage.tags
		});
	}

	function record(edge: LinkEdge) {
		outgoing.set(edge.sourceId, [...(outgoing.get(edge.sourceId) ?? []), edge]);

		const source = nodes.get(edge.sourceId);

		if (source) {
			source.outgoingCount++;
		}
	}

	for (const passage of story.passages) {
		for (const targetName of parseLinks(passage.text, true)) {
			stats.links++;

			if (targetName === passage.name) {
				stats.selfLinks++;
				nodes.get(passage.id)!.selfLinkCount++;
				record({
					kind: 'selfLink',
					sourceId: passage.id,
					targetId: passage.id,
					targetName
				});
				continue;
			}

			const target = passageByName.get(targetName);

			if (target) {
				stats.resolvedLinks++;
				nodes.get(target.id)!.incomingCount++;
				backlinks.set(target.id, [...(backlinks.get(target.id) ?? []), passage.id]);
				record({
					kind: 'resolved',
					sourceId: passage.id,
					targetId: target.id,
					targetName
				});
			} else {
				stats.brokenLinks++;
				nodes.get(passage.id)!.brokenLinkCount++;
				record({
					kind: 'broken',
					sourceId: passage.id,
					targetId: null,
					targetName
				});
			}
		}
	}

	const reachable = reachableIds(story, {
		backlinks,
		nodes,
		outgoing,
		stats,
		storyOrder,
		storyRank
	});

	for (const node of nodes.values()) {
		node.isOrphan = node.id !== story.startPassage && node.incomingCount === 0;
		node.isUnreachable = !reachable.has(node.id);

		if (node.isOrphan) {
			stats.orphanPassages++;
		}

		if (node.isUnreachable) {
			stats.unreachablePassages++;
		}
	}

	return {backlinks, nodes, outgoing, stats, storyOrder, storyRank};
}

function reachableIds(story: Story, index: GraphIndex) {
	const reachable = new Set<string>();
	const firstId = story.passages[0]?.id;
	const startId = index.nodes.has(story.startPassage)
		? story.startPassage
		: firstId;
	const queue = startId ? [startId] : [];

	while (queue.length > 0) {
		const id = queue.shift()!;

		if (reachable.has(id)) {
			continue;
		}

		reachable.add(id);

		for (const neighbor of neighbors(index, id, 'outgoing')) {
			queue.push(neighbor);
		}
	}

	return reachable;
}

function layoutComponents(index: GraphIndex) {
	const components: Array<Array<{id: string; level: number}>> = [];
	const visited = new Set<string>();

	for (const seed of index.storyOrder) {
		if (visited.has(seed)) {
			continue;
		}

		const component: Array<{id: string; level: number}> = [];
		const queue = [{id: seed, level: 0}];

		visited.add(seed);

		while (queue.length > 0) {
			const {id, level} = queue.shift()!;

			component.push({id, level});

			for (const neighbor of neighbors(index, id, 'outgoing')) {
				if (!visited.has(neighbor)) {
					visited.add(neighbor);
					queue.push({id: neighbor, level: level + 1});
				}
			}
		}

		components.push(component);
	}

	return components;
}

function generateLayout(index: GraphIndex) {
	const result = new Map<string, CoreRect>();
	let componentTop = generatedLayout.originTop;

	for (const component of layoutComponents(index)) {
		const levels = new Map<number, string[]>();

		for (const {id, level} of component) {
			levels.set(level, [...(levels.get(level) ?? []), id]);
		}

		const sortedLevels = Array.from(levels).sort(
			([left], [right]) => left - right
		);
		const maxRows = Math.max(
			1,
			...Array.from(levels.values()).map(ids => ids.length)
		);

		for (const [level, ids] of sortedLevels) {
			ids.sort(
				(left, right) =>
					(index.storyRank.get(left) ?? Number.MAX_SAFE_INTEGER) -
					(index.storyRank.get(right) ?? Number.MAX_SAFE_INTEGER)
			);

			ids.forEach((id, row) => {
				result.set(id, {
					height: generatedLayout.cardHeight,
					left:
						generatedLayout.originLeft +
						level * (generatedLayout.cardWidth + generatedLayout.columnGap),
					top:
						componentTop +
						row * (generatedLayout.cardHeight + generatedLayout.rowGap),
					width: generatedLayout.cardWidth
				});
			});
		}

		componentTop +=
			maxRows * (generatedLayout.cardHeight + generatedLayout.rowGap) +
			generatedLayout.componentGap;
	}

	return result;
}

function layoutSnapshot(story: Story, index: GraphIndex): LayoutSnapshot {
	const generated = generateLayout(index);
	const entries = new Map<string, LayoutEntry>();
	let generatedCount = 0;
	let savedCount = 0;

	for (const passage of story.passages) {
		const saved = safeBounds(passage);

		if (saved) {
			savedCount++;
			entries.set(passage.id, {bounds: saved, source: 'saved'});
			continue;
		}

		const generatedBounds = generated.get(passage.id);

		if (generatedBounds) {
			generatedCount++;
			entries.set(passage.id, {
				bounds: generatedBounds,
				source: 'generated'
			});
		}
	}

	const state: CoreGraphLayoutState =
		savedCount === 0 && generatedCount === 0
			? 'missing'
			: savedCount === 0
				? 'generated'
				: generatedCount === 0 && savedCount === story.passages.length
					? 'saved'
					: generatedCount === 0
						? 'partial'
						: 'mixed';

	return {
		bounds: graphBounds(Array.from(entries.values()).map(entry => entry.bounds)),
		entries,
		state
	};
}

function projectEdges(
	index: GraphIndex,
	layout: LayoutSnapshot,
	visibleIds: Set<string>,
	focusedIds: Set<string> | undefined,
	layers: CoreLinkLayerOptions
) {
	const result: CoreGraphEdge[] = [];
	const seen = new Set<string>();
	const sourceIds = new Set<string>();

	for (const visibleId of visibleIds) {
		sourceIds.add(visibleId);

		for (const sourceId of index.backlinks.get(visibleId) ?? []) {
			sourceIds.add(sourceId);
		}
	}

	const sortedSourceIds = Array.from(sourceIds).sort(
		(left, right) =>
			(index.storyRank.get(left) ?? Number.MAX_SAFE_INTEGER) -
			(index.storyRank.get(right) ?? Number.MAX_SAFE_INTEGER)
	);

	for (const sourceId of sortedSourceIds) {
		if (focusedIds && !focusedIds.has(sourceId)) {
			continue;
		}

		const sourceLayout = layout.entries.get(sourceId);

		if (!sourceLayout) {
			continue;
		}

		for (const edge of index.outgoing.get(sourceId) ?? []) {
			if (!includesLayer(layers, edge.kind)) {
				continue;
			}

			if (focusedIds && edge.targetId && !focusedIds.has(edge.targetId)) {
				continue;
			}

			if (
				!visibleIds.has(sourceId) &&
				!(edge.targetId && visibleIds.has(edge.targetId))
			) {
				continue;
			}

			const key = `${edge.sourceId}:${edge.targetId ?? ''}:${edge.targetName}`;

			if (seen.has(key)) {
				continue;
			}

			seen.add(key);
			result.push({
				kind: edge.kind,
				sourceBounds: sourceLayout.bounds,
				sourceId: edge.sourceId,
				targetBounds: edge.targetId
					? layout.entries.get(edge.targetId)?.bounds ?? null
					: null,
				targetId: edge.targetId,
				targetName: edge.targetName
			});
		}
	}

	return result;
}

export function storyToCoreGraphProjection(
	story: Story,
	query: GraphProjectionQuery = {}
): CoreGraphProjection {
	const options = normalizeOptions(query);
	const index = buildGraphIndex(story);
	const layout = layoutSnapshot(story, index);
	const focusedIds =
		options.focus && options.focus.passageIds.length > 0
			? neighborhood(index, options.focus)
			: undefined;
	const viewport = options.viewport
		? expandRect(options.viewport, viewportOverscan)
		: undefined;
	const visibleIds = new Set<string>();
	const nodes: CoreGraphNode[] = [];

	for (const id of index.storyOrder) {
		const entry = layout.entries.get(id);

		if (!entry) {
			continue;
		}

		if (viewport && !rectsIntersect(viewport, entry.bounds)) {
			continue;
		}

		if (focusedIds && !focusedIds.has(id)) {
			continue;
		}

		const node = index.nodes.get(id);

		if (!node) {
			continue;
		}

		visibleIds.add(id);
		nodes.push({
			...node,
			bounds: entry.bounds,
			layoutSource: entry.source
		});
	}

	return {
		bounds: layout.bounds,
		edges: projectEdges(
			index,
			layout,
			visibleIds,
			focusedIds,
			options.layers
		),
		layoutState: layout.state,
		nodes,
		stats: index.stats
	};
}

export function saveGeneratedGraphLayout(story: Story) {
	const projection = storyToCoreGraphProjection(story);
	const moves: PassageMove[] = projection.nodes
		.filter(node => node.layoutSource === 'generated')
		.map(node => ({bounds: node.bounds, passageId: node.id}));

	return {
		moves,
		projection:
			moves.length > 0
				? {
						...projection,
						layoutState: 'saved' as const,
						nodes: projection.nodes.map(node => ({
							...node,
							layoutSource: 'saved' as const
						}))
					}
				: projection
	};
}
