import {Story} from './stories.types';

export function passageWithId(
	stories: Story[],
	storyId: string,
	passageId: string
) {
	const story = storyWithId(stories, storyId);
	const result = story.passages.find(p => p.id === passageId);

	if (result) {
		return result;
	}

	throw new Error(
		`There is no passage with ID "${passageId}" in a story with ID "${storyId}".`
	);
}

export function passageWithName(
	stories: Story[],
	storyId: string,
	passageName: string
) {
	const story = storyWithId(stories, storyId);
	const result = story.passages.find(p => p.name === passageName);

	if (result) {
		return result;
	}

	throw new Error(
		`There is no passage with name "${passageName}" in a story with ID "${storyId}".`
	);
}

export function storyPassageTags(story: Story) {
	return Array.from(
		story.passages.reduce((result, passage) => {
			passage.tags && passage.tags.forEach(tag => result.add(tag));
			return result;
		}, new Set<string>())
	).sort();
}

export function storyTags(stories: Story[]) {
	return Array.from(
		stories.reduce((result, story) => {
			story.tags && story.tags.forEach(tag => result.add(tag));
			return result;
		}, new Set<string>())
	).sort();
}

export function storyWithId(stories: Story[], storyId: string) {
	const result = stories.find(s => s.id === storyId);

	if (result) {
		return result;
	}

	throw new Error(`There is no story with ID "${storyId}".`);
}

export function storyWithName(stories: Story[], name: string) {
	const result = stories.find(s => s.name === name);

	if (result) {
		return result;
	}

	throw new Error(`There is no story with name "${name}".`);
}
