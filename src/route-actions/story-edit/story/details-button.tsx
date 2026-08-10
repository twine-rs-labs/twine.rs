import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../components/design-system';

export interface DetailsButtonProps {
	onOpenWorkbenchPanel?: (id: 'story-details') => void;
}

export const DetailsButton: React.FC<DetailsButtonProps> = props => {
	const {onOpenWorkbenchPanel} = props;
	const {t} = useTranslation();

	return (
		<IconButton
			icon="info-circle"
			label={t('common.details')}
			onClick={() => onOpenWorkbenchPanel?.('story-details')}
		/>
	);
};
