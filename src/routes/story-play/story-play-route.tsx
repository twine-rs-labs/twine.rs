import * as React from 'react';
import {useNavigate, useParams} from 'react-router';
import {useCoreProjectHost} from '../../core';
import type {CoreStorySummary} from '../../core';
import {usePublishing} from '../../store/use-publishing';
import {useStoriesContext} from '../../store/stories';
import {StoryPreviewFrame} from '../story-preview-frame';
import {
	storyPreviewDebugMetrics,
	storyPreviewPassages
} from '../story-preview-debug';

export const StoryPlayRoute: React.FC = () => {
	const [publishError, setPublishError] = React.useState<Error>();
	const [html, setHtml] = React.useState<string>();
	const {storyId = ''} = useParams<'storyId'>();
	const navigate = useNavigate();
	const {publishStory} = usePublishing();
	const coreProjectHost = useCoreProjectHost();
	const publishStoryRef = React.useRef(publishStory);
	const [summary, setSummary] = React.useState<CoreStorySummary>();
	const {stories} = useStoriesContext();
	const story = stories.find(story => story.id === storyId);
	const storyExists = !!story;
	const startPassage = story?.passages.find(
		passage => passage.id === story.startPassage
	);
	const passageQuery = React.useCallback(
		(passageId?: string) => {
			const targetId = passageId ?? startPassage?.id;

			return targetId ? `&passage=${encodeURIComponent(targetId)}` : '';
		},
		[startPassage?.id]
	);
	React.useEffect(() => {
		let active = true;

		if (!story) {
			setSummary(undefined);
			return () => {
				active = false;
			};
		}

		setSummary(undefined);

		void coreProjectHost.queryStorySummaryAsync(story.id).then(summary => {
			if (active) {
				setSummary(summary);
			}
		});

		return () => {
			active = false;
		};
	}, [coreProjectHost, story]);

	React.useEffect(() => {
		publishStoryRef.current = publishStory;
	}, [publishStory]);

	React.useEffect(() => {
		let active = true;

		async function load() {
			try {
				const published = await publishStoryRef.current(storyId, {
					buildTarget: 'play'
				});

				if (active) {
					setHtml(published);
				}
			} catch (error) {
				if (active) {
					setPublishError(error as Error);
				}
			}
		}

		setHtml(undefined);
		setPublishError(undefined);

		if (storyExists) {
			load();
		}

		return () => {
			active = false;
		};
	}, [storyExists, storyId]);

	return (
		<StoryPreviewFrame
			debugMetrics={storyPreviewDebugMetrics(summary)}
			error={publishError}
			html={html}
			missingStoryMessage={`There is no story with ID "${storyId}".`}
			onRevealGraph={passageId =>
				navigate(`/stories/${storyId}?mode=graph${passageQuery(passageId)}`)
			}
			onRevealSource={passageId =>
				navigate(`/stories/${storyId}?mode=text${passageQuery(passageId)}`)
			}
			onTestCurrentPassage={passageId =>
				navigate(`/stories/${storyId}/test/${encodeURIComponent(passageId)}`)
			}
			onTestFromStart={
				startPassage
					? () =>
							navigate(
								`/stories/${storyId}/test/${encodeURIComponent(
									startPassage.id
								)}`
							)
					: undefined
			}
			passages={storyPreviewPassages(story)}
			startPassageName={startPassage?.name}
			storyExists={storyExists}
			storyName={story?.name}
			targetLabel="Play"
			title="Story preview"
		/>
	);
};
