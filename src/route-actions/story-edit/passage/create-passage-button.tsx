import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../components/design-system';
import {createUntitledPassageCommand, useCoreProjectHost} from '../../../core';
import {Story} from '../../../store/stories';
import {Point} from '../../../util/geometry';

export interface CreatePassageButtonProps {
	getCenter: () => Point;
	story: Story;
}

export const CreatePassageButton: React.FC<
	CreatePassageButtonProps
> = props => {
	const {getCenter, story} = props;
	const coreProjectHost = useCoreProjectHost();
	const handleClick = React.useCallback(() => {
		const {left, top} = getCenter();

		coreProjectHost.applyStoryCommand(
			createUntitledPassageCommand(story, left, top),
			'undoChange.newPassage'
		);
	}, [coreProjectHost, getCenter, story]);
	const {t} = useTranslation();

	return (
		<IconButton icon="plus" label={t('common.new')} onClick={handleClick} />
	);
};
