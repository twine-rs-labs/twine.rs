import type {Story} from '../store/stories';

const bootstrapStories = new Map<string, Story>();
const storyMaterializers = new Map<string, () => Promise<Story>>();

export function registerBootstrapStories(stories: Story[]) {
	for (const story of stories) {
		bootstrapStories.set(story.id, story);
	}
}

export function bootstrapStory(storyId: string) {
	return bootstrapStories.get(storyId);
}

export function metadataStory(story: Story): Story {
	return {
		...story,
		passages: story.passages.map(passage => ({...passage, text: ''}))
	};
}

export function clearBootstrapStories() {
	bootstrapStories.clear();
}

export function registerStoryMaterializer(
	storyId: string,
	materialize: () => Promise<Story>
) {
	storyMaterializers.set(storyId, materialize);
}

export function unregisterStoryMaterializer(storyId: string) {
	storyMaterializers.delete(storyId);
}

export async function materializeRegisteredStory(story: Story) {
	return (await storyMaterializers.get(story.id)?.()) ?? story;
}
