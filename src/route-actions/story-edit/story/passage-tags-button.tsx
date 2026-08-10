import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../components/design-system';

export interface PassageTagsButtonProps {
	onOpenWorkbenchPanel?: (id: 'passage-tags') => void;
}

export const PassageTagsButton: React.FC<PassageTagsButtonProps> = props => {
	const {onOpenWorkbenchPanel} = props;
	const {t} = useTranslation();

	return (
		<IconButton
			icon="tags"
			label={t('routes.storyEdit.toolbar.passageTags')}
			onClick={() => onOpenWorkbenchPanel?.('passage-tags')}
		/>
	);
};
