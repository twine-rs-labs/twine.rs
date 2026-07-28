import * as React from 'react';
import {useNavigate} from 'react-router';
import type {
	NativeStoryPreviewCommandResult,
	NativeStoryPreviewOwnerCommand,
	TwineElectronWindow
} from '../electron/shared';
import {useCoreProjectHost} from '../core/project-host';
import {usePrefsContext} from '../store/prefs';
import {useComputedTheme} from '../store/prefs/use-computed-theme';
import {useStoriesContext} from '../store/stories';
import {useNativeStoryPreviewPreparation} from '../store/use-story-launch';

const maxPreviewCommandErrorLength = 4096;

function previewCommandErrorMessage(error: unknown) {
	const message =
		error instanceof Error ? error.message : 'The preview command failed.';

	return message.slice(0, maxPreviewCommandErrorLength);
}

function revealUrl(
	storyId: string,
	mode: 'graph' | 'text',
	passageId: string | undefined
) {
	const query = new URLSearchParams({mode});

	if (passageId) {
		query.set('passage', passageId);
	}

	return `/stories/${encodeURIComponent(storyId)}?${query.toString()}`;
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
		if (!bridge?.onStoryPreviewCommand) {
			return;
		}

		const handleCommand = async (request: NativeStoryPreviewOwnerCommand) => {
			const active = current.current;
			const story = active.stories.find(
				candidate => candidate.id === request.storyId
			);
			const passage = request.passageId
				? story?.passages.find(candidate => candidate.id === request.passageId)
				: undefined;
			const resultBase = {
				command: request.command.type,
				generation: request.command.generation
			} as const;
			let result: NativeStoryPreviewCommandResult;

			try {
				if (!story) {
					throw new Error('The story no longer exists in the owning editor.');
				}
				if (request.passageId && !passage) {
					throw new Error(
						'The requested passage no longer exists in the story.'
					);
				}

				if (
					request.command.type === 'revealGraph' ||
					request.command.type === 'revealSource'
				) {
					active.navigate(
						revealUrl(
							story.id,
							request.command.type === 'revealGraph' ? 'graph' : 'text',
							passage?.id
						)
					);
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

					await active.bridge.replaceStoryPreview(
						request.sessionId,
						request.command.generation,
						prepared.request,
						prepared.projectRoot
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

			await active.bridge
				?.reportStoryPreviewCommandResult(request.sessionId, result)
				.catch(error => {
					console.warn('Could not report story preview command result.', error);
				});
		};

		return bridge.onStoryPreviewCommand(command => {
			void handleCommand(command);
		});
	}, [bridge]);

	return null;
};
