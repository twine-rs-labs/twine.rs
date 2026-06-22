import {IconResize} from '@tabler/icons';
import {Editor} from 'codemirror';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {UndoRedoButtons} from '../../components/codemirror';
import {ButtonBar} from '../../components/container/button-bar';
import {MenuButton} from '../../components/control/menu-button';
import {RenamePassageButton} from '../../components/passage/rename-passage-button';
import {TestPassageButton} from '../../route-actions/story-edit/passage/test-passage-button';
import {
	Passage,
	Story,
	storyPassageTags
} from '../../store/stories';
import {
	setPassageTagsCommand,
	setStoryTagColorCommand,
	updatePassageCommand,
	useCoreProjectHost
} from '../../core';
import {Color, colorString} from '../../util/color';
import {TagCardButton} from '../../components/tag/tag-card-button';

export interface PassageToolbarProps {
	disabled?: boolean;
	editor?: Editor;
	passage: Passage;
	story: Story;
	useCodeMirror: boolean;
}

export const PassageToolbar: React.FC<PassageToolbarProps> = props => {
	const {disabled, editor, passage, story, useCodeMirror} = props;
	const coreProjectHost = useCoreProjectHost();
	const {t} = useTranslation();
	const passageTags = storyPassageTags(story);

	function handleAddTag(name: string) {
		coreProjectHost.applyStoryCommand(
			{
				type: 'batch',
				commands: [
					...(passageTags.includes(name)
						? []
						: [
								setStoryTagColorCommand(
									story.id,
									name,
									colorString(name)
								)
							]),
					setPassageTagsCommand(story.id, passage.id, [
						...passage.tags,
						name
					])
				]
			},
			t('undoChange.addTag')
		);
	}

	function handleChangeTagColor(name: string, color: Color) {
		coreProjectHost.applyStoryCommand(
			setStoryTagColorCommand(story.id, name, color === 'none' ? null : color)
		);
	}

	function handleRemoveTag(name: string) {
		coreProjectHost.applyStoryCommand(
			setPassageTagsCommand(
				story.id,
				passage.id,
				passage.tags.filter(tag => tag !== name)
			),
			t('undoChange.removeTag')
		);
	}

	function handleRename(name: string) {
		coreProjectHost.applyStoryCommand(
			updatePassageCommand(
				story.id,
				passage.id,
				{
					layout: null,
					name,
					tags: null,
					text: null
				},
				false
			)
		);
	}

	function handleSetSize({height, width}: {height: number; width: number}) {
		coreProjectHost.applyStoryCommand(
			updatePassageCommand(story.id, passage.id, {
				layout: {
					height,
					left: passage.left,
					top: passage.top,
					width
				},
				name: null,
				tags: null,
				text: null
			})
		);
	}

	return (
		<ButtonBar>
			{useCodeMirror && (
				<UndoRedoButtons
					disabled={disabled}
					editor={editor}
					watch={passage.text}
				/>
			)}
			<TagCardButton
				allTags={passageTags}
				id={`passage-tag-input-${passage.id}`}
				onAdd={handleAddTag}
				onChangeColor={handleChangeTagColor}
				onRemove={handleRemoveTag}
				tagColors={story.tagColors}
				tags={passage.tags}
			/>
			<MenuButton
				disabled={disabled}
				icon={<IconResize />}
				items={[
					{
						checkable: true,
						checked: passage.height === 100 && passage.width === 100,
						label: t('dialogs.passageEdit.sizeSmall'),
						onClick: () => handleSetSize({height: 100, width: 100})
					},
					{
						checkable: true,
						checked: passage.height === 200 && passage.width === 200,
						label: t('dialogs.passageEdit.sizeLarge'),
						onClick: () => handleSetSize({height: 200, width: 200})
					},
					{
						checkable: true,
						checked: passage.height === 200 && passage.width === 100,
						label: t('dialogs.passageEdit.sizeTall'),
						onClick: () => handleSetSize({height: 200, width: 100})
					},
					{
						checkable: true,
						checked: passage.height === 100 && passage.width === 200,
						label: t('dialogs.passageEdit.sizeWide'),
						onClick: () => handleSetSize({height: 100, width: 200})
					}
				]}
				label={t('dialogs.passageEdit.size')}
			/>
			<RenamePassageButton
				disabled={disabled}
				onRename={handleRename}
				passage={passage}
				story={story}
			/>
			<TestPassageButton passage={passage} story={story} />
		</ButtonBar>
	);
};
