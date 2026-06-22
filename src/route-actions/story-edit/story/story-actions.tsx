import * as React from 'react';
import {RenameStoryButton} from '../../../components/story/rename-story-button';
import {renameStoryCommand, useCoreProjectHost} from '../../../core';
import type {DialogsContextProps} from '../../../dialogs';
import {Story, useStoriesContext} from '../../../store/stories';
import {DetailsButton} from './details-button';
import {FindReplaceButton} from './find-replace-button';
import {JavaScriptButton} from './javascript-button';
import {PassageTagsButton} from './passage-tags-button';
import {StylesheetButton} from './stylesheet-button';

export interface StoryActionsProps {
	dialogsDispatch?: DialogsContextProps['dispatch'];
	story: Story;
}

export const StoryActions: React.FC<StoryActionsProps> = props => {
	const {stories} = useStoriesContext();
	const coreProjectHost = useCoreProjectHost();
	const {dialogsDispatch, story} = props;

	return (
		<div className="route-action-group">
			<FindReplaceButton dialogsDispatch={dialogsDispatch} story={story} />
			<RenameStoryButton
				existingStories={stories}
				onRename={name =>
					coreProjectHost.applyStoryCommand(renameStoryCommand(story.id, name))
				}
				story={story}
			/>
			<DetailsButton dialogsDispatch={dialogsDispatch} story={story} />
			<PassageTagsButton dialogsDispatch={dialogsDispatch} story={story} />
			<JavaScriptButton dialogsDispatch={dialogsDispatch} story={story} />
			<StylesheetButton dialogsDispatch={dialogsDispatch} story={story} />
		</div>
	);
};
