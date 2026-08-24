import * as React from 'react';
import {RenamePassageButton} from '../../../components/passage/rename-passage-button';
import {renamePassageCommand, useCoreProjectHost} from '../../../core';
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
	getCenter: () => Point;
	onEditPassages: (passages: Passage[]) => void;
	onOpenFuzzyFinder: () => void;
	onTestPassage?: (passage: Passage) => void;
	story: Story;
	testPassagePending?: boolean;
	testPassagePendingId?: string;
}

export const PassageActions: React.FC<PassageActionsProps> = props => {
	const {
		getCenter,
		onEditPassages,
		onOpenFuzzyFinder,
		onTestPassage,
		story,
		testPassagePending,
		testPassagePendingId
	} = props;
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

		coreProjectHost.applyStoryCommand(
			renamePassageCommand(story.id, passage.id, name, true)
		);
	}

	return (
		<div className="route-action-group">
			<CreatePassageButton getCenter={getCenter} story={story} />
			<EditPassagesButton
				onEditPassages={onEditPassages}
				passages={selectedPassages}
				story={story}
			/>
			<RenamePassageButton
				onRename={name => handleRename(name, soloSelectedPassage)}
				passage={soloSelectedPassage}
				story={story}
			/>
			<DeletePassagesButton passages={selectedPassages} story={story} />
			<TestPassageButton
				onTestPassage={onTestPassage}
				passage={soloSelectedPassage}
				pending={testPassagePending}
				pendingPassageId={testPassagePendingId}
			/>
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
