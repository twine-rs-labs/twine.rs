import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton, PromptIconButton} from '../design-system';
import {Passage, Story} from '../../store/stories';

const DisabledRenamePassageButton: React.FC = () => {
	const {t} = useTranslation();

	return <IconButton disabled icon="writing" label={t('common.rename')} />;
};

export interface EnabledRenamePassageButtonProps {
	onRename: (value: string) => void;
	passage: Passage;
	story: Story;
}

export const EnabledRenamePassageButton: React.FC<
	EnabledRenamePassageButtonProps
> = props => {
	const {onRename, passage, story} = props;
	const [newName, setNewName] = React.useState(passage.name);
	const {t} = useTranslation();

	React.useEffect(() => setNewName(passage.name), [passage]);

	function validate(name: string) {
		if (name.trim() === '') {
			return {
				message: t('components.renamePassageButton.emptyName'),
				valid: false
			};
		}

		if (story.passages.some(p => p.id !== passage.id && p.name === name)) {
			return {
				message: t('components.renamePassageButton.nameAlreadyUsed'),
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
			onCancel={() => setNewName(passage.name)}
			onChange={setNewName}
			onSubmit={onRename}
			prompt={t('common.renamePrompt', {name: passage.name})}
			validate={validate}
			value={newName}
		/>
	);
};

export interface RenamePassageButtonProps extends Omit<
	EnabledRenamePassageButtonProps,
	'passage'
> {
	disabled?: boolean;
	passage?: Passage;
}

export const RenamePassageButton: React.FC<
	RenamePassageButtonProps
> = props => {
	if (!props.disabled && props.passage) {
		return (
			<EnabledRenamePassageButton
				{...(props as EnabledRenamePassageButtonProps)}
			/>
		);
	}

	return <DisabledRenamePassageButton />;
};
