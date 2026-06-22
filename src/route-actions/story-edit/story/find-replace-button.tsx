import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../components/design-system';
import {
	StorySearchDialog,
	useDialogsContext,
	type DialogsContextProps
} from '../../../dialogs';
import {Story} from '../../../store/stories';

export interface FindReplaceButtonProps {
	dialogsDispatch?: DialogsContextProps['dispatch'];
	story: Story;
}

export const FindReplaceButton: React.FC<FindReplaceButtonProps> = props => {
	const {dialogsDispatch, story} = props;
	const {dispatch: contextDispatch} = useDialogsContext();
	const dispatch = dialogsDispatch ?? contextDispatch;
	const {t} = useTranslation();

	return (
		<IconButton
			icon="search"
			label={t('routes.storyEdit.toolbar.findAndReplace')}
			onClick={() =>
				dispatch({
					type: 'addDialog',
					component: StorySearchDialog,
					props: {
						find: '',
						flags: {
							includePassageNames: true,
							matchCase: false,
							useRegexes: false
						},
						replace: '',
						storyId: story.id
					}
				})
			}
		/>
	);
};
