import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../components/design-system';
import {Passage, Story} from '../../../store/stories';

export interface EditPassagesButtonProps {
	onEditPassages: (passages: Passage[]) => void;
	passages: Passage[];
	story: Story;
}

export const EditPassagesButton: React.FC<EditPassagesButtonProps> = props => {
	const {onEditPassages, passages} = props;
	const {t} = useTranslation();

	function handleClick() {
		onEditPassages(passages);
	}

	return (
		<IconButton
			disabled={passages.length === 0}
			icon="edit"
			label={
				passages.length > 1
					? t('common.editCount', {count: passages.length})
					: t('common.edit')
			}
			onClick={handleClick}
		/>
	);
};
