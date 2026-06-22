import * as React from 'react';
import {RenamePassageButton} from '../../../components/passage/rename-passage-button';
import {renamePassageCommand, useCoreProjectHost} from '../../../core';
import type {DialogsContextProps} from '../../../dialogs';
import {Passage, Story} from '../../../store/stories';
import {Point} from '../../../util/geometry';
import {CreatePassageButton} from './create-passage-button';
import {DeletePassagesButton} from './delete-passages-button';
import {EditPassagesButton} from './edit-passages-buttons';
import {GoToPassageButton} from './go-to-passage-button';
import {SelectAllPassagesButton} from './select-all-passages-button';
import {DeselectAllPassagesButton} from './deselect-all-passages-button';
import {StartAtPassageButton} from './start-at-passage-button';
import {TestPassageButton} from './test-passage-button';

export interface PassageActionsProps {
	dialogsDispatch?: DialogsContextProps['dispatch'];
	getCenter: () => Point;
	onOpenFuzzyFinder: () => void;
	story: Story;
}

export const PassageActions: React.FC<PassageActionsProps> = props => {
	const {dialogsDispatch, getCenter, onOpenFuzzyFinder, story} = props;
	const coreProjectHost = useCoreProjectHost();
	const selectedPassages = React.useMemo(
		() => story.passages.filter(passage => passage.selected),
		[story.passages]
	);
	const soloSelectedPassage = React.useMemo(
		() => (selectedPassages.length === 1 ? selectedPassages[0] : undefined),
		[selectedPassages]
	);

	function handleRename(name: string, passage?: Passage) {
		if (!passage) {
			throw new Error('Passage is unset');
		}

		// Don't create newly linked passages here because the update action will
		// try to recreate the passage as it's been renamed--it sees new links in
		// existing passages, updates them, but does not see that the passage name
		// has been updated since that hasn't happened yet.

		coreProjectHost.applyStoryCommand(
			renamePassageCommand(story.id, passage.id, name, false)
		);
	}

	return (
		<div className="route-action-group">
			<CreatePassageButton getCenter={getCenter} story={story} />
			<EditPassagesButton
				dialogsDispatch={dialogsDispatch}
				passages={selectedPassages}
				story={story}
			/>
			<RenamePassageButton
				onRename={name => handleRename(name, soloSelectedPassage)}
				passage={soloSelectedPassage}
				story={story}
			/>
			<DeletePassagesButton passages={selectedPassages} story={story} />
			<TestPassageButton passage={soloSelectedPassage} story={story} />
			<StartAtPassageButton passage={soloSelectedPassage} story={story} />
			<GoToPassageButton onOpenFuzzyFinder={onOpenFuzzyFinder} />
			<SelectAllPassagesButton story={story} />
			<DeselectAllPassagesButton
				story={story}
				selectedPassages={selectedPassages}
			/>
		</div>
	);
};
