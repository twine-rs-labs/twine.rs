import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {DialogCard} from '../components/container/dialog-card';
import {CardContent} from '../components/container/card';
import {DialogComponentProps} from './dialogs.types';
import {storyTags, useStoriesContext} from '../store/stories';
import {setPref, usePrefsContext} from '../store/prefs';
import {Color} from '../util/color';
import {TagEditor} from '../components/tag/tag-editor';
import {renameStoryTagCommand, useCoreProjectHost} from '../core';

export type StoryTagsDialogProps = DialogComponentProps;

export const StoryTagsDialog: React.FC<StoryTagsDialogProps> = props => {
	const {stories} = useStoriesContext();
	const {dispatch: prefsDispatch, prefs} = usePrefsContext();
	const coreProjectHost = useCoreProjectHost();
	const {t} = useTranslation();

	const tags = storyTags(stories);

	function handleChangeColor(tagName: string, color: Color) {
		prefsDispatch(
			setPref('storyTagColors', {...prefs.storyTagColors, [tagName]: color})
		);
	}

	function handleChangeTagName(tagName: string, newName: string) {
		coreProjectHost.applyStoryCommand(
			renameStoryTagCommand(tagName, newName),
			t('undoChange.renameTag')
		);
	}

	return (
		<DialogCard
			className="story-tags-dialog"
			fixedSize
			headerLabel={t('dialogs.storyTags.title')}
			{...props}
		>
			<CardContent>
				{tags.length > 0 ? (
					tags.map(tag => (
						<TagEditor
							allTags={tags}
							color={prefs.storyTagColors[tag]}
							key={tag}
							name={tag}
							onChangeColor={color => handleChangeColor(tag, color)}
							onChangeName={newName => handleChangeTagName(tag, newName)}
						/>
					))
				) : (
					<p>{t('dialogs.storyTags.noTags')}</p>
				)}
			</CardContent>
		</DialogCard>
	);
};
