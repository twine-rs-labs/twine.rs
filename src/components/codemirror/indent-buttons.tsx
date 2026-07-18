import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconIndentDecrease, IconIndentIncrease} from '@tabler/icons-react';
import {IconButton} from '../control/icon-button';
import type {SourceEditorHandle} from '../control/source-editor';

export interface IndentButtonsProps {
	editor?: SourceEditorHandle;
}

export const IndentButtons: React.FC<IndentButtonsProps> = props => {
	const {editor} = props;
	const {t} = useTranslation();

	function execCommand(command: 'indentLess' | 'indentMore') {
		editor?.runCommand(command);
		editor?.focus();
	}

	return (
		<>
			<IconButton
				disabled={!editor}
				icon={<IconIndentIncrease />}
				label={t('components.indentButtons.indent')}
				onClick={() => execCommand('indentMore')}
			/>
			<IconButton
				disabled={!editor}
				icon={<IconIndentDecrease />}
				label={t('components.indentButtons.unindent')}
				onClick={() => execCommand('indentLess')}
			/>
		</>
	);
};
