import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../components/design-system';
import type {CoreHistoryKind} from '../../core/bindings/CoreHistoryKind';
import {useCoreProjectSession} from '../../core';

export interface UndoRedoButtonsProps {
	storyId?: string;
}

const historyTranslation: Record<CoreHistoryKind, string> = {
	batch: 'changeStoryDetails',
	createStory: 'changeStoryDetails',
	deleteAsset: 'changeStoryDetails',
	deletePassage: 'deletePassage',
	deleteStory: 'changeStoryDetails',
	editPassage: 'editPassage',
	externalChanges: 'externalChanges',
	importAsset: 'changeStoryDetails',
	insertAsset: 'editPassage',
	movePassage: 'movePassage',
	newPassage: 'newPassage',
	renameAsset: 'changeStoryDetails',
	renamePassage: 'renamePassage',
	renameStory: 'renameStory',
	renameTag: 'renameTag',
	replaceAsset: 'changeStoryDetails',
	saveLayout: 'movePassage',
	setStartPassage: 'changeStoryDetails',
	storyDetails: 'changeStoryDetails'
};

function isEditableTarget(target: EventTarget | null) {
	return (
		target instanceof HTMLElement &&
		(target.isContentEditable ||
			['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
	);
}

export const UndoRedoButtons: React.FC<UndoRedoButtonsProps> = ({storyId}) => {
	const host = useCoreProjectSession(storyId);
	const [status, setStatus] = React.useState(() => host.sessionStatus());
	const {t} = useTranslation();
	const undoLabel = status.undoKind
		? t('common.undoChange', {
				change: t(`undoChange.${historyTranslation[status.undoKind]}`, {
					defaultValue: status.undoKind
				})
			})
		: t('common.undo');
	const redoLabel = status.redoKind
		? t('common.redoChange', {
				change: t(`undoChange.${historyTranslation[status.redoKind]}`, {
					defaultValue: status.redoKind
				})
			})
		: t('common.redo');

	React.useEffect(() => host.subscribeToStatus(setStatus), [host]);

	React.useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			const key = event.key.toLowerCase();
			const redoRequested =
				(event.shiftKey && key === 'z') || (event.ctrlKey && key === 'y');
			const undoRequested = key === 'z' && !event.shiftKey;

			if (
				!(event.metaKey || event.ctrlKey) ||
				(!undoRequested && !redoRequested) ||
				isEditableTarget(event.target)
			) {
				return;
			}

			if (redoRequested ? status.canRedo : status.canUndo) {
				event.preventDefault();
				void (redoRequested ? host.redo() : host.undo());
			}
		}

		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [host, status.canRedo, status.canUndo]);

	return (
		<>
			<IconButton
				disabled={!status.canUndo}
				icon="arrow-back"
				label={undoLabel}
				onClick={() => void host.undo()}
			/>
			<IconButton
				disabled={!status.canRedo}
				icon="arrow-forward"
				label={redoLabel}
				onClick={() => void host.redo()}
			/>
		</>
	);
};
