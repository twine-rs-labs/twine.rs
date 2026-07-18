import type {CoreGraphEdge} from '../../core/bindings/CoreGraphEdge';
import type {CoreGraphProjection} from '../../core/bindings/CoreGraphProjection';
import type {StoryWithDocuments} from '../../store/stories';

export type StoryGraphEdge = Omit<CoreGraphEdge, 'kind'> & {
	kind: CoreGraphEdge['kind'] | 'reference';
};

/**
 * Converts story-format-defined passage references into graph edges.
 *
 * Format references intentionally differ from ordinary Twine links: only
 * references to existing passages are drawn, and they never count as broken
 * links or affect reachability.
 */
export function formatReferenceEdges(
	story: StoryWithDocuments,
	projection: CoreGraphProjection,
	parsePassageText: (text: string) => string[]
): StoryGraphEdge[] {
	const passagesByName = new Map(
		story.passages.map(passage => [passage.name, passage])
	);
	const nodesById = new Map(projection.nodes.map(node => [node.id, node]));
	const edges: StoryGraphEdge[] = [];

	for (const source of story.passages) {
		const sourceNode = nodesById.get(source.id);

		if (!sourceNode) {
			continue;
		}

		let targetNames: string[];

		try {
			targetNames = parsePassageText(source.text);
		} catch (error) {
			console.warn(
				`Story format reference parser failed for passage "${source.name}".`,
				error
			);
			continue;
		}

		for (const targetName of new Set(targetNames)) {
			const target = passagesByName.get(targetName);
			const targetNode = target ? nodesById.get(target.id) : undefined;

			if (!target || !targetNode) {
				continue;
			}

			edges.push({
				kind: 'reference',
				sourceBounds: sourceNode.bounds,
				sourceId: source.id,
				targetBounds: targetNode.bounds,
				targetId: target.id,
				targetName
			});
		}
	}

	return edges;
}
