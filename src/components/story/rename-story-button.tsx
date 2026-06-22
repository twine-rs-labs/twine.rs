import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton, PromptIconButton} from '../design-system';
import {storyFileName} from '../../electron/shared';
import {Story} from '../../store/stories';

// This is here because it's used in two places--the story list and the story
// info dialog.

const DisabledRenameStoryButton: React.FC = () => {
	const {t} = useTranslation();

	return <IconButton disabled icon="writing" label={t('common.rename')} />;
};

interface EnabledRenameStoryButtonProps {
	existingStories: Story[];
	onRename: (value: string) => void;
	story: Story;
}

const EnabledRenameStoryButton: React.FC<
	EnabledRenameStoryButtonProps
> = props => {
	const {existingStories, onRename, story} = props;
	const [newName, setNewName] = React.useState(story.name);
	const {t} = useTranslation();

	React.useEffect(() => setNewName(story.name), [story]);

	function validate(name: string) {
		if (name.trim() === '') {
			return {
				message: t('components.renameStoryButton.emptyName'),
				valid: false
			};
		}

		if (
			existingStories.some(
				s =>
					s.id !== story.id &&
					storyFileName(s) === storyFileName({...story, name})
			)
		) {
			return {
				message: t('components.renameStoryButton.nameAlreadyUsed'),
				valid: false
			};
		}

		return {valid: true};
	}

	return (
		<PromptIconButton
			cancelLabel={t('common.cancel')}
			confirmLabel={t('common.save')}
			icon="writing"
			label={t('common.rename')}
			onCancel={() => setNewName(story.name)}
			onChange={setNewName}
			onSubmit={onRename}
			prompt={t('common.renamePrompt', {name: story.name})}
			validate={validate}
			value={newName}
		/>
	);
};

export interface RenameStoryButtonProps extends Omit<
	EnabledRenameStoryButtonProps,
	'story'
> {
	story?: Story;
}

export const RenameStoryButton: React.FC<RenameStoryButtonProps> = props => {
	if (props.story) {
		return (
			<EnabledRenameStoryButton {...(props as EnabledRenameStoryButtonProps)} />
		);
	}

	return <DisabledRenameStoryButton />;
};
