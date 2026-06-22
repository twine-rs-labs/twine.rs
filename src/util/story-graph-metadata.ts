import type {Passage, Story} from '../store/stories';

export const TWINE_RS_STORY_DATA_KEY = 'twine.rs';
export const TWINE_RS_STORY_GRAPH_HTML_ATTRIBUTE = 'data-twine-rs-story-graph';

export interface StoryGraphPassageMetadata {
	bounds: {
		height: number;
		left: number;
		top: number;
		width: number;
	};
	id: string;
	name: string;
	tags: string[];
}

export interface TwineRsStoryGraphMetadata {
	compatibility: {
		passagePositions: 'mirrored-to-standard-metadata';
		precedence: 'storydata-over-passage-position-metadata';
	};
	graph: {
		annotations: Record<string, unknown>;
		groups: Record<string, unknown>;
		metadata: Record<string, unknown>;
		passages: Record<string, StoryGraphPassageMetadata>;
		savedLayouts: Record<string, unknown>;
	};
	kind: 'storyGraph';
	schema: 'twine.rs/story-graph/v1';
	storyId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function sortedPassages(story: Story) {
	return story.passages
		.slice()
		.sort(
			(left, right) =>
				left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
		);
}

export function storyGraphMetadata(story: Story): TwineRsStoryGraphMetadata {
	const passages: Record<string, StoryGraphPassageMetadata> = {};

	for (const passage of sortedPassages(story)) {
		passages[passage.id] = {
			bounds: {
				height: passage.height,
				left: passage.left,
				top: passage.top,
				width: passage.width
			},
			id: passage.id,
			name: passage.name,
			tags: passage.tags
		};
	}

	return {
		compatibility: {
			passagePositions: 'mirrored-to-standard-metadata',
			precedence: 'storydata-over-passage-position-metadata'
		},
		graph: {
			annotations: {},
			groups: {},
			metadata: {},
			passages,
			savedLayouts: {}
		},
		kind: 'storyGraph',
		schema: 'twine.rs/story-graph/v1',
		storyId: story.id
	};
}

export function addStoryGraphToStoryData<T extends Record<string, unknown>>(
	storyData: T,
	story: Story
) {
	return {
		...storyData,
		[TWINE_RS_STORY_DATA_KEY]: {
			...(isRecord(storyData[TWINE_RS_STORY_DATA_KEY])
				? storyData[TWINE_RS_STORY_DATA_KEY]
				: {}),
			storyGraph: storyGraphMetadata(story)
		}
	};
}

export function storyGraphFromStoryData(
	storyData: unknown
): unknown | undefined {
	if (!isRecord(storyData)) {
		return undefined;
	}

	const twineRs = storyData[TWINE_RS_STORY_DATA_KEY];

	if (isRecord(twineRs) && twineRs.storyGraph) {
		return twineRs.storyGraph;
	}

	// Compatibility with early experiments and third-party prototypes.
	return storyData.storyGraph;
}

function passageLayoutEntries(metadata: unknown) {
	if (!isRecord(metadata)) {
		return [];
	}

	if (
		(metadata.schema === 'twine.rs/story-graph' ||
			metadata.schema === 'twine.rs/story-graph/v1') &&
		Array.isArray(metadata.layout)
	) {
		return metadata.layout;
	}

	const graph = metadata.graph;

	if (!isRecord(graph)) {
		return [];
	}

	const passages = graph.passages;

	if (Array.isArray(passages)) {
		return passages;
	}

	if (isRecord(passages)) {
		return Object.values(passages);
	}

	return [];
}

function passageBounds(entry: unknown) {
	if (!isRecord(entry)) {
		return undefined;
	}

	const bounds = isRecord(entry.bounds) ? entry.bounds : entry;
	const left = bounds.left;
	const top = bounds.top;
	const width = bounds.width;
	const height = bounds.height;

	if (
		finiteNumber(left) &&
		finiteNumber(top) &&
		finiteNumber(width) &&
		finiteNumber(height)
	) {
		return {height, left, top, width};
	}

	return undefined;
}

function passageMatchesMetadataEntry(passage: Passage, entry: unknown) {
	if (!isRecord(entry)) {
		return false;
	}

	return (
		entry.id === passage.id ||
		entry.passageId === passage.id ||
		entry.name === passage.name
	);
}

export function applyStoryGraphMetadataToStory(
	story: Story,
	metadata: unknown
) {
	const entries = passageLayoutEntries(metadata);

	for (const entry of entries) {
		const bounds = passageBounds(entry);

		if (!bounds) {
			continue;
		}

		const passage = story.passages.find(candidate =>
			passageMatchesMetadataEntry(candidate, entry)
		);

		if (passage) {
			passage.left = bounds.left;
			passage.top = bounds.top;
			passage.width = bounds.width;
			passage.height = bounds.height;
		}
	}
}

export function parseStoryGraphHtmlAttribute(value: string | null) {
	if (!value) {
		return undefined;
	}

	try {
		return JSON.parse(value);
	} catch (error) {
		console.warn(`Couldn't parse twine.rs StoryData graph metadata: ${value}`);
		return undefined;
	}
}
