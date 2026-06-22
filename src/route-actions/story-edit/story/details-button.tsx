import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../components/design-system';
import {
	StoryDetailsDialog,
	useDialogsContext,
	type DialogsContextProps
} from '../../../dialogs';
import {Story} from '../../../store/stories';

export interface DetailsButtonProps {
	dialogsDispatch?: DialogsContextProps['dispatch'];
	story: Story;
}

export const DetailsButton: React.FC<DetailsButtonProps> = props => {
	const {dialogsDispatch, story} = props;
	const {dispatch: contextDispatch} = useDialogsContext();
	const dispatch = dialogsDispatch ?? contextDispatch;
	const {t} = useTranslation();

	return (
		<IconButton
			icon="info-circle"
			label={t('common.details')}
			onClick={() =>
				dispatch({
					type: 'addDialog',
					component: StoryDetailsDialog,
					props: {storyId: story.id}
				})
			}
		/>
	);
};
