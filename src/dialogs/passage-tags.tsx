import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {DialogCard} from '../components/container/dialog-card';
import {CardContent} from '../components/container/card';
import {DialogComponentProps} from './dialogs.types';
import {storyWithId} from '../store/stories';
import {useUndoableStoriesContext} from '../store/undoable-stories';
import {Color} from '../util/color';
import {TagEditor} from '../components/tag/tag-editor';
import {
	renamePassageTagCommand,
	setStoryTagColorCommand,
	useCoreProjectHost
} from '../core';
import './passage-tags.css';

export interface PassageTagsDialogProps extends DialogComponentProps {
	storyId: string;
}

export const PassageTagsDialog: React.FC<PassageTagsDialogProps> = props => {
	const {storyId, ...other} = props;
	const {stories} = useUndoableStoriesContext();
	const {t} = useTranslation();

	const story = storyWithId(stories, storyId);
	const coreProjectHost = useCoreProjectHost();
	const tags = React.useMemo(
		() => coreProjectHost.queryStoryIndex(story.id).tagEntries,
		[coreProjectHost, story]
	);
	const tagNames = React.useMemo(() => tags.map(tag => tag.name), [tags]);

	function handleChangeColor(tagName: string, color: Color) {
		coreProjectHost.applyStoryCommand(
			setStoryTagColorCommand(
				story.id,
				tagName,
				color === 'none' ? null : color
			),
			t('undoChange.changeTagColor')
		);
	}

	function handleChangeTagName(tagName: string, newName: string) {
		coreProjectHost.applyStoryCommand(
			renamePassageTagCommand(story.id, tagName, newName),
			t('undoChange.renameTag')
		);
	}

	return (
		<DialogCard
			className="passage-tags-dialog"
			fixedSize
			headerLabel={t('dialogs.passageTags.title')}
			{...other}
		>
			<CardContent>
				{tags.length > 0 ? (
					tags.map(tag => (
						<div className="passage-tag-entry" key={tag.name}>
							<TagEditor
								allTags={tagNames}
								color={story.tagColors[tag.name]}
								name={tag.name}
								onChangeColor={color => handleChangeColor(tag.name, color)}
								onChangeName={newName => handleChangeTagName(tag.name, newName)}
							/>
							<span className="passage-tag-count">
								{t('dialogs.passageTags.count', {count: tag.count})}
							</span>
						</div>
					))
				) : (
					<p>{t('dialogs.passageTags.noTags')}</p>
				)}
			</CardContent>
		</DialogCard>
	);
};
