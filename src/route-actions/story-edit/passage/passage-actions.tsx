import * as React from 'react';
import {RenamePassageButton} from '../../../components/passage/rename-passage-button';
import {PassageRenameReview} from '../../../components/passage/passage-rename-review';
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
import {usePassageRenameReview} from './use-passage-rename-review';

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
	const [renameReview, setRenameReview] = React.useState<
		| {
				afterName: string;
				passage: Passage;
				passageId: string;
				storyId: string;
		  }
		| undefined
	>();
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
	const handleReviewApplied = React.useCallback(() => {
		setRenameReview(undefined);
		restoreRenameFocus();
	}, [restoreRenameFocus]);
	const reviewController = usePassageRenameReview(
		renameReview,
		handleReviewApplied
	);
	const closeRenameReview = React.useCallback(() => {
		reviewController.closeBoundary();
		setRenameReview(undefined);
		restoreRenameFocus();
	}, [restoreRenameFocus, reviewController.closeBoundary]);

	React.useEffect(() => {
		if (
			renameReview &&
			(renameReview.storyId !== story.id ||
				renameReview.passage.id !== soloSelectedPassage?.id ||
				!story.passages.some(passage => passage.id === renameReview.passage.id))
		) {
			reviewController.closeBoundary();
			setRenameReview(undefined);
		}
	}, [
		renameReview,
		reviewController.closeBoundary,
		soloSelectedPassage?.id,
		story.id,
		story.passages
	]);

	function handleRename(name: string, passage?: Passage) {
		if (!passage) {
			throw new Error('Passage is unset');
		}

		setRenameReview({
			afterName: name,
			passage,
			passageId: passage.id,
			storyId: story.id
		});
	}

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
					onRename={name => handleRename(name, soloSelectedPassage)}
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
			{renameReview?.storyId === story.id && (
				<PassageRenameReview
					afterName={renameReview.afterName}
					applying={reviewController.applying}
					cursor={reviewController.cursor}
					error={reviewController.error}
					onApply={reviewController.handleApply}
					onClose={closeRenameReview}
					onNextPage={reviewController.handleNextPage}
					onPreviousPage={reviewController.handlePreviousPage}
					onRetry={reviewController.handleRetry}
					page={reviewController.page}
					passage={renameReview.passage}
					progress={reviewController.progress}
					showPreviousPage={reviewController.showPreviousPage}
					story={story}
					summary={reviewController.summary}
				/>
			)}
		</div>
	);
};
