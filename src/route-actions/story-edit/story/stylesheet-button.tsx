import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../components/design-system';

export interface StylesheetButtonProps {
	onOpenEditorWindow?: () => void;
}

export const StylesheetButton: React.FC<StylesheetButtonProps> = props => {
	const {onOpenEditorWindow} = props;
	const {t} = useTranslation();

	return (
		<IconButton
			icon="hash"
			label={t('routes.storyEdit.toolbar.stylesheet')}
			onClick={onOpenEditorWindow}
		/>
	);
};
