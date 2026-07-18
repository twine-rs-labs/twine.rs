import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconArrowBack, IconArrowForward} from '@tabler/icons-react';
import {IconButton} from '../control/icon-button';
import type {SourceEditorHandle} from '../control/source-editor';

export interface UndoRedoButtonsProps {
	/**
	 * Disables both buttons no matter the state of the editor.
	 */
	disabled?: boolean;
	editor?: SourceEditorHandle;
	/**
	 * A change in this prop triggers a render (probably, put the editor value
	 * here). This is necessary because the editor instance itself is mutable, so
	 * we need some way of knowing when to re-check whether undo/redo is availble.
	 */
	watch: string;
}

export const UndoRedoButtons: React.FC<UndoRedoButtonsProps> = props => {
	const {disabled, editor, watch} = props;
	const {t} = useTranslation();
	const [canRedo, setCanRedo] = React.useState(false);
	const [canUndo, setCanUndo] = React.useState(false);

	React.useEffect(() => {
		if (editor) {
			const history = editor.getSnapshot();

			setCanRedo(history.canRedo);
			setCanUndo(history.canUndo);
		} else {
			setCanRedo(false);
			setCanUndo(false);
		}
	}, [editor, watch]);

	function execCommand(command: 'redo' | 'undo') {
		editor?.runCommand(command);
		editor?.focus();
	}

	return (
		<>
			<IconButton
				disabled={disabled || !canUndo}
				icon={<IconArrowBack />}
				label={t('common.undo')}
				onClick={() => execCommand('undo')}
			/>
			<IconButton
				disabled={disabled || !canRedo}
				icon={<IconArrowForward />}
				label={t('common.redo')}
				onClick={() => execCommand('redo')}
			/>
		</>
	);
};
