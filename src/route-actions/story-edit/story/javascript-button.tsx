import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../components/design-system';

export interface JavaScriptButtonProps {
	onOpenEditorWindow?: () => void;
}

export const JavaScriptButton: React.FC<JavaScriptButtonProps> = props => {
	const {onOpenEditorWindow} = props;
	const {t} = useTranslation();

	return (
		<IconButton
			icon="braces"
			label={t('routes.storyEdit.toolbar.javaScript')}
			onClick={onOpenEditorWindow}
		/>
	);
};
