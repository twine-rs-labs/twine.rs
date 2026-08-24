import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../components/design-system';
import {Passage} from '../../../store/stories';

export interface TestPassageButtonProps {
	onTestPassage?: (passage: Passage) => void;
	passage?: Passage;
	pending?: boolean;
	pendingPassageId?: string;
}

export const TestPassageButton: React.FC<TestPassageButtonProps> = props => {
	const {onTestPassage, passage, pending = false, pendingPassageId} = props;
	const {t} = useTranslation();

	return (
		<IconButton
			disabled={!onTestPassage || !passage || pending}
			icon="tool"
			label={t('routes.storyEdit.toolbar.testFromHere')}
			loading={!!passage && pendingPassageId === passage.id}
			onClick={() => passage && onTestPassage?.(passage)}
		/>
	);
};
