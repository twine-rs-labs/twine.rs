import * as React from 'react';
import {useHotkeys} from 'react-hotkeys-hook';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../components/design-system';
import {deletePassagesCommand, useCoreProjectHost} from '../../../core';
import {Passage, Story} from '../../../store/stories';

export interface DeletePassagesButtonProps {
	passages: Passage[];
	story: Story;
}

export const DeletePassagesButton: React.FC<
	DeletePassagesButtonProps
> = props => {
	const {passages, story} = props;
	const coreProjectHost = useCoreProjectHost();
	const {t} = useTranslation();
	const disabled = React.useMemo(() => {
		if (passages.length === 0) {
			return true;
		}

		return passages.some(passage => story.startPassage === passage.id);
	}, [passages, story.startPassage]);
	const handleClick = React.useCallback(() => {
		if (disabled) {
			return;
		}

		coreProjectHost.applyStoryCommand(
			deletePassagesCommand(
				story.id,
				passages.map(passage => passage.id)
			),
			passages.length > 1
				? 'undoChange.deletePassages'
				: 'undoChange.deletePassage'
		);
	}, [coreProjectHost, disabled, passages, story.id]);

	useHotkeys('Backspace,Delete', handleClick, [handleClick]);

	return (
		<IconButton
			disabled={disabled}
			icon="trash"
			label={
				!disabled && passages.length > 1
					? t('common.deleteCount', {count: passages.length})
					: t('common.delete')
			}
			onClick={handleClick}
		/>
	);
};
