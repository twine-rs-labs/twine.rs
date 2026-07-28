import {v4 as uuid} from '@lukeed/uuid';
import {CreateStoryAction, Story, StoryWithDocuments} from '../stories.types';
import {unusedName} from '../../../util/unused-name';

export interface DuplicateStoryAction extends CreateStoryAction {
	props: StoryWithDocuments;
}

/**
 * Creates a duplicate of an existing story.
 */
export function duplicateStory(
	story: StoryWithDocuments,
	stories: Story[]
): DuplicateStoryAction {
	const id = uuid();
	const duplicatedPassages = story.passages.map(passage => ({
		...passage,
		id: uuid(),
		story: id
	}));
	const originalStartPassageIndex = story.passages.findIndex(
		({id}) => id === story.startPassage
	);

	return {
		type: 'createStory',
		props: {
			...story,
			id,
			ifid: uuid(),
			name: unusedName(
				story.name,
				stories.map(story => story.name)
			),
			passages: duplicatedPassages,
			startPassage:
				originalStartPassageIndex >= 0
					? (duplicatedPassages[originalStartPassageIndex]?.id ?? '')
					: ''
		}
	};
}
