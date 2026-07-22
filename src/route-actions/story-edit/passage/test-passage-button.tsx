import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../components/design-system';
import {Passage, Story} from '../../../store/stories';
import {useStoryLaunch} from '../../../store/use-story-launch';
import {reportStoryLaunchError} from '../../../store/report-story-launch-error';

export interface TestPassageButtonProps {
	passage?: Passage;
	story: Story;
}

export const TestPassageButton: React.FC<TestPassageButtonProps> = props => {
	const {passage, story} = props;
	const {testStory} = useStoryLaunch();
	const {t} = useTranslation();

	return (
		<IconButton
			disabled={!passage}
			icon="tool"
			label={t('routes.storyEdit.toolbar.testFromHere')}
			onClick={() =>
				Promise.resolve(testStory(story.id, passage?.id)).catch(
					reportStoryLaunchError
				)
			}
		/>
	);
};
