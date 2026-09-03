import * as React from 'react';
import {RenamePassageButton} from '../../../components/passage/rename-passage-button';
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
	onRenamePassage: (
		name: string,
		passage: Passage,
		restoreFocus: () => void
	) => void;
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
		onRenamePassage,
		onTestPassage,
		story,
		testPassagePending,
		testPassagePendingId
	} = props;
	const renameTriggerRef = React.useRef<HTMLSpanElement>(null);
	const selectedPassages = React.useMemo(
		() => story.passages.filter(passage => passage.selected),
		[story.passages]
	);
	const soloSelectedPassage = React.useMemo(
		() => (selectedPassages.length === 1 ? selectedPassages[0] : undefined),
		[selectedPassages]
	);
	const restoreRenameFocus = React.useCallback(() => {
		window.requestAnimationFrame(() =>
			renameTriggerRef.current?.querySelector('button')?.focus()
		);
	}, []);

	return (
		<div className="route-action-group">
			<CreatePassageButton getCenter={getCenter} story={story} />
			<EditPassagesButton
				onEditPassages={onEditPassages}
				passages={selectedPassages}
				story={story}
			/>
			<span ref={renameTriggerRef}>
				<RenamePassageButton
					onRename={name => {
						if (!soloSelectedPassage) throw new Error('Passage is unset');
						onRenamePassage(name, soloSelectedPassage, restoreRenameFocus);
					}}
					passage={soloSelectedPassage}
					story={story}
				/>
			</span>
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
