import {storyFileName} from '../electron/shared';
import {Story} from './stories';

export interface MergeProjectStoriesOptions {
	preserveExistingIdentity?: boolean;
	preserveExistingText?: boolean;
}

function storyWithExistingIdentity(story: Story, existing: Story): Story {
	return {
		...story,
		id: existing.id,
		passages: story.passages.map(passage => ({
			...passage,
			story: existing.id
		}))
	};
}

function mergeStory(
	existing: Story | undefined,
	incoming: Story,
	options: MergeProjectStoriesOptions
) {
	if (!existing) {
		return incoming;
	}

	const identifiedIncoming = storyWithExistingIdentity(incoming, existing);

	if (options.preserveExistingIdentity === false) {
		return incoming;
	}

	if (!options.preserveExistingText) {
		return identifiedIncoming;
	}

	const existingPassages = new Map(
		existing.passages.map(passage => [passage.id, passage])
	);

	return {
		...identifiedIncoming,
		passages: identifiedIncoming.passages.map(passage => {
			const existingPassage = existingPassages.get(passage.id);

			return existingPassage?.text
				? {...passage, text: existingPassage.text}
				: passage;
		}),
		script: existing.script || identifiedIncoming.script,
		stylesheet: existing.stylesheet || identifiedIncoming.stylesheet
	};
}

export function mergeProjectStories(
	current: Story[],
	incoming: Story[],
	options: MergeProjectStoriesOptions = {}
) {
	const currentByFileName = new Map(
		current.map(story => [storyFileName(story), story])
	);
	const incomingFileNames = new Set(
		incoming.map(story => storyFileName(story))
	);
	const mergedIncoming = incoming.map(story =>
		mergeStory(currentByFileName.get(storyFileName(story)), story, options)
	);

	return [
		...current.filter(story => !incomingFileNames.has(storyFileName(story))),
		...mergedIncoming
	];
}

export function projectStoryIdsForCurrentStories(
	current: Story[],
	incoming: Story[],
	options: Pick<MergeProjectStoriesOptions, 'preserveExistingIdentity'> = {}
) {
	if (options.preserveExistingIdentity === false) {
		return incoming.map(story => story.id);
	}

	const currentByFileName = new Map(
		current.map(story => [storyFileName(story), story])
	);

	return incoming.map(
		story => currentByFileName.get(storyFileName(story))?.id ?? story.id
	);
}
