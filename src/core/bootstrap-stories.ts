import type {
	Passage,
	PassageWithText,
	Story,
	StoryWithDocuments
} from '../store/stories';

const bootstrapStories = new Map<string, StoryWithDocuments>();
const storyMaterializers = new Map<string, () => Promise<StoryWithDocuments>>();

export function registerBootstrapStories(stories: StoryWithDocuments[]) {
	for (const story of stories) {
		bootstrapStories.set(story.id, story);
	}
}

/** Registers an explicit document transport and returns its metadata-only model. */
export function registerStoryDocuments(story: StoryWithDocuments): Story {
	registerBootstrapStories([story]);
	return metadataStory(story);
}

export function bootstrapStory(storyId: string) {
	return bootstrapStories.get(storyId);
}

export function releaseBootstrapStory(storyId: string) {
	bootstrapStories.delete(storyId);
}

export function bootstrapStoryPerformanceDiagnostics() {
	let passageCount = 0;
	let textBytes = 0;

	for (const story of bootstrapStories.values()) {
		passageCount += story.passages.length;
		for (const passage of story.passages) {
			textBytes += passage.text.length * 2;
		}
	}

	return {
		passageCount,
		storyCount: bootstrapStories.size,
		textBytes
	};
}

export function metadataStory(story: Story): Story {
	return {
		...story,
		passages: story.passages.map(passage => {
			const metadata = {...passage} as Partial<PassageWithText>;

			delete metadata.text;
			return metadata as Passage;
		})
	};
}

export function clearBootstrapStories() {
	bootstrapStories.clear();
}

export function registerStoryMaterializer(
	storyId: string,
	materialize: () => Promise<StoryWithDocuments>
) {
	storyMaterializers.set(storyId, materialize);
}

export function unregisterStoryMaterializer(storyId: string) {
	storyMaterializers.delete(storyId);
}

function storyHasDocuments(story: Story): story is StoryWithDocuments {
	return story.passages.every(
		passage =>
			'text' in passage &&
			typeof (passage as Partial<PassageWithText>).text === 'string'
	);
}

export async function materializeRegisteredStory(
	story: Story
): Promise<StoryWithDocuments> {
	const materialized = await storyMaterializers.get(story.id)?.();

	if (materialized) {
		return materialized;
	}

	const bootstrap = bootstrapStories.get(story.id);

	if (bootstrap) {
		return bootstrap;
	}

	// Explicit transport values (imports, tests, and compatibility callers) may
	// already own every document even though the retained React model does not.
	if (storyHasDocuments(story)) {
		return story;
	}

	throw new Error(
		`No passage document source is registered for story ${story.id}.`
	);
}
