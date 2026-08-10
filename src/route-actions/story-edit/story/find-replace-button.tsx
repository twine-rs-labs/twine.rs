import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../components/design-system';

export interface FindReplaceButtonProps {
	onOpenWorkbenchPanel?: (id: 'find-replace') => void;
}

export const FindReplaceButton: React.FC<FindReplaceButtonProps> = props => {
	const {onOpenWorkbenchPanel} = props;
	const {t} = useTranslation();

	return (
		<IconButton
			icon="search"
			label={t('routes.storyEdit.toolbar.findAndReplace')}
			onClick={() => onOpenWorkbenchPanel?.('find-replace')}
		/>
	);
};
