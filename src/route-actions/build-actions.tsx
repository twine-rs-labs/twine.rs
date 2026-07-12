import * as React from 'react';
import {useTranslation} from 'react-i18next/';
import {Badge, Button} from '../components/design-system';
import {storyFileName} from '../electron/shared';
import {materializeStoryFromSession, useCoreProjectHost} from '../core';
import {Story} from '../store/stories';
import {usePublishing} from '../store/use-publishing';
import {useStoryLaunch} from '../store/use-story-launch';
import {saveHtml, saveTwee} from '../util/save-file';
import {storyToTwee} from '../util/twee';

export interface BuildActionsProps {
	story?: Story;
}

type BusyAction = 'test' | 'play' | 'proof' | 'publish' | 'twee';

export const BuildActions: React.FC<BuildActionsProps> = ({story}) => {
	const coreProjectHost = useCoreProjectHost();
	const {publishStory} = usePublishing();
	const {playStory, proofStory, testStory} = useStoryLaunch();
	const {t} = useTranslation();
	const [busyAction, setBusyAction] = React.useState<BusyAction>();
	const [error, setError] = React.useState<string>();

	const run = React.useCallback(
		async (actionName: BusyAction, action: () => Promise<void> | void) => {
			if (!story) {
				return;
			}

			setBusyAction(actionName);
			setError(undefined);

			try {
				await action();
			} catch (error) {
				setError((error as Error).message);
			} finally {
				setBusyAction(undefined);
			}
		},
		[story]
	);

	return (
		<div className="route-action-group">
			<Button
				disabled={!story}
				icon="tool"
				loading={busyAction === 'test'}
				onClick={() => run('test', () => story && testStory(story.id))}
				size="sm"
			>
				{t('routeActions.build.test')}
			</Button>
			<Button
				disabled={!story}
				icon="player-play"
				loading={busyAction === 'play'}
				onClick={() => run('play', () => story && playStory(story.id))}
				size="sm"
			>
				{t('routeActions.build.play')}
			</Button>
			<Button
				disabled={!story}
				icon="eyeglass"
				loading={busyAction === 'proof'}
				onClick={() => run('proof', () => story && proofStory(story.id))}
				size="sm"
			>
				{t('routeActions.build.proof')}
			</Button>
			<Button
				disabled={!story}
				icon="file-text"
				loading={busyAction === 'publish'}
				onClick={() =>
					run('publish', async () => {
						if (!story) {
							return;
						}

						saveHtml(
							await publishStory(story.id, {buildTarget: 'publish'}),
							storyFileName(story)
						);
					})
				}
				size="sm"
			>
				{t('routeActions.build.publishToFile')}
			</Button>
			<Button
				disabled={!story}
				icon="file-code"
				loading={busyAction === 'twee'}
					onClick={() =>
					run('twee', async () => {
						if (story) {
							const completeStory = await materializeStoryFromSession(
								coreProjectHost,
								story
							);

							saveTwee(
								storyToTwee(completeStory),
								storyFileName(story, '.twee')
							);
						}
					})
				}
				size="sm"
			>
				{t('routeActions.build.exportAsTwee')}
			</Button>
			{error && (
				<Badge icon="alert-octagon" tone="error" title={error}>
					{error}
				</Badge>
			)}
		</div>
	);
};
