import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../components/design-system';
import {
	StoryStylesheetDialog,
	useDialogsContext,
	type DialogsContextProps
} from '../../../dialogs';
import {Story} from '../../../store/stories';

export interface StylesheetButtonProps {
	dialogsDispatch?: DialogsContextProps['dispatch'];
	story: Story;
}

export const StylesheetButton: React.FC<StylesheetButtonProps> = props => {
	const {dialogsDispatch, story} = props;
	const {dispatch: contextDispatch} = useDialogsContext();
	const dispatch = dialogsDispatch ?? contextDispatch;
	const {t} = useTranslation();

	return (
		<IconButton
			icon="hash"
			label={t('routes.storyEdit.toolbar.stylesheet')}
			onClick={() =>
				dispatch({
					type: 'addDialog',
					component: StoryStylesheetDialog,
					props: {storyId: story.id}
				})
			}
		/>
	);
};
