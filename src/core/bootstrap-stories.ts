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

export function bootstrapStory(storyId: string) {
	return bootstrapStories.get(storyId);
}

export function metadataStory(story: StoryWithDocuments): Story {
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

	throw new Error(
		`No passage document source is registered for story ${story.id}.`
	);
}
