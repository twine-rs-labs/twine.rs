import * as React from 'react';
import {useNavigate} from 'react-router';
import type {
	NativeStoryPreviewOwnerCommand,
	NativeStoryPreviewOwnerCommandCancellation,
	NativeStoryPreviewOwnerCommandResult,
	TwineElectronWindow
} from '../electron/shared';
import {useCoreProjectHost} from '../core/project-host-public';
import {usePrefsContext} from '../store/prefs';
import {useComputedTheme} from '../store/prefs/use-computed-theme';
import {useStoriesContext} from '../store/stories';
import {useNativeStoryPreviewPreparation} from '../store/use-story-launch';
import {
	finalizeStoryEditReveal,
	registerStoryEditReveal,
	rejectStoryEditReveal,
	storyEditRevealUrl
} from './story-edit-reveal';

const maxPreviewCommandErrorLength = 4096;

function previewCommandErrorMessage(error: unknown) {
	const message =
		error instanceof Error ? error.message : 'The preview command failed.';

	return message.slice(0, maxPreviewCommandErrorLength);
}

function uniquePassage(
	story: {passages: Array<{id: string}>},
	passageId: string
) {
	const matches = story.passages.filter(passage => passage.id === passageId);
	return matches.length === 1 ? matches[0] : undefined;
}

function usePreviewMetadataRevisionSync(
	coreProjectHost: ReturnType<typeof useCoreProjectHost>,
	stories: ReturnType<typeof useStoriesContext>['stories']
) {
	const subscribe = React.useCallback(
		(listener: () => void) =>
			coreProjectHost.subscribeToStatus(() => listener()),
		[coreProjectHost]
	);
	const revisionSnapshot = React.useCallback(
		() =>
			JSON.stringify(
				stories.map(story => [
					story.id,
					coreProjectHost.sessionStatus(story.id).revision
				])
			),
		[coreProjectHost, stories]
	);

	React.useSyncExternalStore(subscribe, revisionSnapshot, revisionSnapshot);
}

/**
 * Executes managed-preview commands in the owning application renderer, where
 * the current project session and router already live. The preview window never
 * receives a store, project capability, or navigation primitive.
 */
export const StoryPreviewOwnerController: React.FC = () => {
	const bridge = (window as TwineElectronWindow).twineElectron;
	const navigate = useNavigate();
	const {prefs} = usePrefsContext();
	const computedTheme = useComputedTheme();
	const {stories} = useStoriesContext();
	const coreProjectHost = useCoreProjectHost();

	usePreviewMetadataRevisionSync(coreProjectHost, stories);
	const preparePreview = useNativeStoryPreviewPreparation();
	const current = React.useRef({bridge, navigate, preparePreview, stories});
	const revealQueue = React.useRef(Promise.resolve());
	const cancelledReveals = React.useRef(
		new Map<string, NativeStoryPreviewOwnerCommandCancellation>()
	);
	const activeReveals = React.useRef(
		new Map<string, NativeStoryPreviewOwnerCommand>()
	);

	current.current = {bridge, navigate, preparePreview, stories};

	React.useEffect(() => {
		if (!bridge?.updateStoryPreviewAppearance) {
			return;
		}

		void bridge
			.updateStoryPreviewAppearance({
				highContrast: prefs.highContrast,
				reducedMotion: prefs.reducedMotion,
				theme: computedTheme
			})
			.catch(error => {
				console.warn('Could not update story preview appearance.', error);
			});
	}, [bridge, computedTheme, prefs.highContrast, prefs.reducedMotion]);

	React.useEffect(() => {
		if (!bridge?.onStoryPreviewCommandCancellation) return;
		return bridge.onStoryPreviewCommandCancellation(cancellation => {
			if (
				!cancellation.dispatchId ||
				!cancellation.sessionId ||
				!cancellation.command ||
				!cancellation.requestId
			)
				return;
			cancelledReveals.current.set(cancellation.dispatchId, cancellation);
			const active = activeReveals.current.get(cancellation.dispatchId);
			if (
				active &&
				active.sessionId === cancellation.sessionId &&
				active.command.type === cancellation.command &&
				active.command.generation === cancellation.generation &&
				active.command.requestId === cancellation.requestId
			) {
				rejectStoryEditReveal(
					cancellation.dispatchId,
					new Error(cancellation.message)
				);
			}
		});
	}, [bridge]);

	React.useEffect(() => {
		if (!bridge?.onStoryPreviewCommand) {
			return;
		}

		const handleCommand = async (request: NativeStoryPreviewOwnerCommand) => {
			const cancellation = () => {
				const cancelled = cancelledReveals.current.get(request.dispatchId);

				return cancelled &&
					cancelled.sessionId === request.sessionId &&
					cancelled.command === request.command.type &&
					cancelled.generation === request.command.generation &&
					cancelled.requestId === request.command.requestId
					? new Error(cancelled.message)
					: undefined;
			};
			const active = current.current;
			const story = active.stories.find(
				candidate => candidate.id === request.storyId
			);
			const passage =
				story && request.passageId
					? uniquePassage(story, request.passageId)
					: undefined;
			const resultBase = {
				command: request.command.type,
				dispatchId: request.dispatchId,
				generation: request.command.generation,
				requestId: request.command.requestId
			} as const;
			let result: NativeStoryPreviewOwnerCommandResult;

			try {
				if (cancellation()) throw cancellation();
				if (!story) {
					throw new Error('The story no longer exists in the owning editor.');
				}
				if (request.passageId && !passage) {
					throw new Error(
						'The requested passage no longer exists uniquely in the story.'
					);
				}

				if (
					request.command.type === 'revealGraph' ||
					request.command.type === 'revealSource'
				) {
					if (!passage) {
						throw new Error(
							'This preview generation has no passage to reveal.'
						);
					}
					if (cancellation()) throw cancellation();
					const completionDeadline =
						await active.bridge?.reportStoryPreviewCommandResult(
							request.sessionId,
							{
								command: request.command.type,
								dispatchId: request.dispatchId,
								generation: request.command.generation,
								requestId: request.command.requestId,
								status: 'accepted'
							}
						);
					if (cancellation() || !completionDeadline)
						throw (
							cancellation() ??
							new Error('The preview reveal acceptance was not acknowledged.')
						);
					activeReveals.current.set(request.dispatchId, request);
					const applied = registerStoryEditReveal(
						request.dispatchId,
						completionDeadline
					);
					try {
						if (cancellation()) throw cancellation();
						active.navigate(
							storyEditRevealUrl(
								story.id,
								request.command.type === 'revealGraph' ? 'graph' : 'text',
								passage.id,
								request.dispatchId
							)
						);
						await applied;
						if (cancellation()) throw cancellation();
					} catch (error) {
						rejectStoryEditReveal(
							request.dispatchId,
							error instanceof Error
								? error
								: new Error('The preview reveal request failed.')
						);
						await applied.catch(() => undefined);
						throw error;
					}
				} else {
					if (!passage) {
						throw new Error(
							'This preview generation has no launch passage to test.'
						);
					}
					if (!active.bridge?.replaceStoryPreview) {
						throw new Error('Managed preview replacement is unavailable.');
					}

					const prepared = await active.preparePreview(story.id, 'test', {
						startPassageId: passage.id
					});
					if (cancellation()) throw cancellation();

					await active.bridge.replaceStoryPreview(
						request.sessionId,
						request.command.generation,
						prepared.request,
						prepared.projectRoot,
						request.dispatchId
					);
				}

				result = {...resultBase, status: 'success'};
			} catch (error) {
				result = {
					...resultBase,
					message: previewCommandErrorMessage(error),
					operation: 'command',
					status: 'error'
				};
			}

			try {
				await active.bridge?.reportStoryPreviewCommandResult(
					request.sessionId,
					result
				);
				if (
					result.status === 'success' &&
					(request.command.type === 'revealGraph' ||
						request.command.type === 'revealSource')
				) {
					// Keep the route transaction live through the main-process terminal
					// acknowledgement. A late cancellation/rejection can still compensate
					// an already-applied route until this exact point.
					finalizeStoryEditReveal(request.dispatchId);
				}
			} catch (reportError) {
				if (
					request.command.type === 'revealGraph' ||
					request.command.type === 'revealSource'
				) {
					rejectStoryEditReveal(
						request.dispatchId,
						reportError instanceof Error
							? reportError
							: new Error('The preview reveal result was not acknowledged.')
					);
				}
				console.warn(
					'Could not report story preview command result.',
					reportError
				);
			}
			cancelledReveals.current.delete(request.dispatchId);
			activeReveals.current.delete(request.dispatchId);
		};

		return bridge.onStoryPreviewCommand(command => {
			if (
				command.command.type === 'revealGraph' ||
				command.command.type === 'revealSource'
			) {
				const queued = revealQueue.current.then(
					() => handleCommand(command),
					() => handleCommand(command)
				);
				revealQueue.current = queued.then(
					() => undefined,
					() => undefined
				);
				return;
			}
			void handleCommand(command);
		});
	}, [bridge]);

	return null;
};
