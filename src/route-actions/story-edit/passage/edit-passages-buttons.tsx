import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../components/design-system';
import {
	addPassageEditors,
	useDialogsContext,
	type DialogsContextProps
} from '../../../dialogs';
import {Passage, Story} from '../../../store/stories';

export interface EditPassagesButtonProps {
	dialogsDispatch?: DialogsContextProps['dispatch'];
	passages: Passage[];
	story: Story;
}

export const EditPassagesButton: React.FC<EditPassagesButtonProps> = props => {
	const {dialogsDispatch, passages, story} = props;
	const {dispatch: contextDispatch} = useDialogsContext();
	const dispatch = dialogsDispatch ?? contextDispatch;
	const {t} = useTranslation();

	function handleClick() {
		dispatch(
			addPassageEditors(
				story.id,
				passages.map(({id}) => id)
			)
		);
	}

	return (
		<IconButton
			disabled={passages.length === 0}
			icon="edit"
			label={
				passages.length > 1
					? t('common.editCount', {count: passages.length})
					: t('common.edit')
			}
			onClick={handleClick}
		/>
	);
};
