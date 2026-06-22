import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../components/design-system';
import {
	StoryJavaScriptDialog,
	useDialogsContext,
	type DialogsContextProps
} from '../../../dialogs';
import {Story} from '../../../store/stories';

export interface JavaScriptButtonProps {
	dialogsDispatch?: DialogsContextProps['dispatch'];
	story: Story;
}

export const JavaScriptButton: React.FC<JavaScriptButtonProps> = props => {
	const {dialogsDispatch, story} = props;
	const {dispatch: contextDispatch} = useDialogsContext();
	const dispatch = dialogsDispatch ?? contextDispatch;
	const {t} = useTranslation();

	return (
		<IconButton
			icon="braces"
			label={t('routes.storyEdit.toolbar.javaScript')}
			onClick={() =>
				dispatch({
					type: 'addDialog',
					component: StoryJavaScriptDialog,
					props: {storyId: story.id}
				})
			}
		/>
	);
};
