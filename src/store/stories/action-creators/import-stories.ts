import {Thunk} from '../../../util/use-thunk-reducer';
import {
	CreateStoryAction,
	StoriesState,
	Story,
	UpdateStoryAction
} from '../stories.types';
import {storyFileName} from '../../../electron/shared';

/**
 * Imports stories, overwriting any stories with the same name.
 */
export function importStories(
	toImport: Story[],
	existingStories: Story[]
): Thunk<StoriesState, CreateStoryAction | UpdateStoryAction> {
	toImport.forEach(importStory => {
		if (
			toImport.some(
				otherStory =>
					otherStory !== importStory &&
					storyFileName(otherStory) === storyFileName(importStory)
			)
		) {
			throw new Error(
				`Stories to import cannot have the same name: "${importStory.name}"`
			);
		}
	});

	return dispatch => {
		toImport.forEach(importStory => {
			const props: Partial<Story> = {...importStory};
			const existingStory = existingStories.find(
				s => storyFileName(s) === storyFileName(importStory)
			);

			// Do an update so that if something goes awry, we won't have deleted the
			// story. We need to update passage props so that their parent story ID is
			// set properly.

			if (existingStory) {
				delete props.id;

				if (props.passages) {
					props.passages = props.passages.map(passage => ({
						...passage,
						story: existingStory.id
					}));
				}

				dispatch({props, type: 'updateStory', storyId: existingStory.id});
			} else {
				dispatch({props, type: 'createStory'});
			}
		});
	};
}
