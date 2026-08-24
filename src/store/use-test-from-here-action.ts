import * as React from 'react';
import type {CoreAssetReference} from '../core/bindings/CoreAssetReference';
import {reportStoryLaunchError} from './report-story-launch-error';
import type {Passage, Story} from './stories';
import {useStoryLaunch} from './use-story-launch';

interface PendingTestFromHereOperation {
	ownerGeneration: number;
	passageId: string;
	storyId: string;
}

export interface TestFromHereAction {
	pending: boolean;
	pendingPassageId?: string;
	run: (passageId: string) => void;
}

export function firstLiveAssetUsagePassage(
	story: Story,
	references: readonly Pick<CoreAssetReference, 'passageId'>[]
): Passage | undefined {
	for (const reference of references) {
		if (!reference.passageId) {
			continue;
		}

		const passage = story.passages.find(
			candidate => candidate.id === reference.passageId
		);

		if (passage) {
			return passage;
		}
	}

	return undefined;
}

export function useTestFromHereAction(
	story: Story | undefined
): TestFromHereAction {
	const {testStory} = useStoryLaunch();
	const storyRef = React.useRef(story);
	const ownerStoryIdRef = React.useRef(story?.id);
	const ownerGenerationRef = React.useRef(0);
	const operationRef = React.useRef<PendingTestFromHereOperation | undefined>(
		undefined
	);
	const mountedRef = React.useRef(true);
	const [pendingOperation, setPendingOperation] = React.useState<
		PendingTestFromHereOperation | undefined
	>(undefined);

	storyRef.current = story;

	if (ownerStoryIdRef.current !== story?.id) {
		ownerStoryIdRef.current = story?.id;
		ownerGenerationRef.current += 1;
		operationRef.current = undefined;
	}

	React.useEffect(() => {
		mountedRef.current = true;

		return () => {
			mountedRef.current = false;
			operationRef.current = undefined;
		};
	}, []);

	const run = React.useCallback(
		(passageId: string) => {
			const currentStory = storyRef.current;

			if (
				!currentStory ||
				!currentStory.passages.some(passage => passage.id === passageId) ||
				operationRef.current
			) {
				return;
			}

			const operation = {
				ownerGeneration: ownerGenerationRef.current,
				passageId,
				storyId: currentStory.id
			};

			operationRef.current = operation;
			setPendingOperation(operation);

			// Calling testStory in this stack is required in browser mode so it can
			// reserve a preview tab while the originating click still has user
			// activation. Do not defer this call through an effect or microtask.
			let launch: Promise<void>;

			try {
				launch = Promise.resolve(testStory(currentStory.id, passageId));
			} catch (error) {
				if (operationRef.current === operation && mountedRef.current) {
					operationRef.current = undefined;
					setPendingOperation(undefined);
				}
				reportStoryLaunchError(error);
				return;
			}

			void launch.then(
				() => {
					if (operationRef.current === operation && mountedRef.current) {
						operationRef.current = undefined;
						setPendingOperation(undefined);
					}
				},
				error => {
					if (operationRef.current === operation && mountedRef.current) {
						operationRef.current = undefined;
						setPendingOperation(undefined);
					}
					reportStoryLaunchError(error);
				}
			);
		},
		[testStory]
	);
	const currentPendingOperation =
		pendingOperation &&
		pendingOperation.storyId === story?.id &&
		pendingOperation.ownerGeneration === ownerGenerationRef.current
			? pendingOperation
			: undefined;

	return React.useMemo(
		() => ({
			pending: !!currentPendingOperation,
			pendingPassageId: currentPendingOperation?.passageId,
			run
		}),
		[currentPendingOperation, run]
	);
}
