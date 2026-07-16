import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {useLocation, useNavigate} from 'react-router';
import {IconButton} from '../components/design-system';
import {
	AboutTwineDialog,
	useDialogsContext,
	type DialogsContextProps
} from '../dialogs';

export interface AppActionsProps {
	dialogsDispatch?: DialogsContextProps['dispatch'];
}

export const AppActions: React.FC<AppActionsProps> = props => {
	const {dispatch: contextDispatch} = useDialogsContext();
	const dispatch = props.dialogsDispatch ?? contextDispatch;
	const location = useLocation();
	const navigate = useNavigate();
	const {t} = useTranslation();

	return (
		<div className="route-action-group">
			<IconButton
				disabled={location.pathname === '/settings'}
				icon="settings"
				label={t('routeActions.app.preferences')}
				onClick={() => navigate('/settings')}
			/>
			<IconButton
				disabled={location.pathname === '/formats'}
				icon="file-code"
				label={t('routeActions.app.storyFormats')}
				onClick={() => navigate('/formats')}
			/>
			<IconButton
				icon="award"
				label={t('routeActions.app.aboutApp')}
				onClick={() =>
					dispatch({type: 'addDialog', component: AboutTwineDialog})
				}
			/>
			<IconButton
				icon="bug"
				label={t('routeActions.app.reportBug')}
				onClick={() => window.open('https://twinery.org/2bugs', '_blank')}
			/>
		</div>
	);
};
