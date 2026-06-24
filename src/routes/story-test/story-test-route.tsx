import * as React from 'react';
import {useHistory, useParams} from 'react-router-dom';
import {useCoreProjectHost} from '../../core';
import type {CoreStoryIndex} from '../../core';
import {usePublishing} from '../../store/use-publishing';
import {useStoriesContext} from '../../store/stories';
import {StoryPreviewFrame} from '../story-preview-frame';
import {
	storyPreviewDebugMetrics,
	storyPreviewPassages
} from '../story-preview-debug';

export const StoryTestRoute: React.FC = () => {
	const [publishError, setPublishError] = React.useState<Error>();
	const [html, setHtml] = React.useState<string>();
	const {passageId, storyId} = useParams<{
		passageId: string;
		storyId: string;
	}>();
	const history = useHistory();
	const {publishStory} = usePublishing();
	const coreProjectHost = useCoreProjectHost();
	const publishStoryRef = React.useRef(publishStory);
	const [index, setIndex] = React.useState<CoreStoryIndex>();
	const {stories} = useStoriesContext();
	const story = stories.find(story => story.id === storyId);
	const storyExists = !!story;
	const startPassage = passageId
		? story?.passages.find(passage => passage.id === passageId)
		: story?.passages.find(passage => passage.id === story.startPassage);
	const passageQuery = React.useCallback(
		(runtimePassageId?: string) => {
			const targetId = runtimePassageId ?? startPassage?.id;

			return targetId ? `&passage=${encodeURIComponent(targetId)}` : '';
		},
		[startPassage?.id]
	);
	React.useEffect(() => {
		let active = true;

		if (!story) {
			setIndex(undefined);
			return () => {
				active = false;
			};
		}

		setIndex(undefined);

		void coreProjectHost.queryStoryIndexAsync(story.id).then(index => {
			if (active) {
				setIndex(index);
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
					buildTarget: 'test',
					formatOptions: 'debug',
					...(passageId
						? {startId: passageId, startMode: 'afterStartup' as const}
						: {startId: undefined})
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
	}, [passageId, storyExists, storyId]);

	return (
		<StoryPreviewFrame
			debugMetrics={storyPreviewDebugMetrics(index)}
			error={publishError}
			html={html}
			missingStoryMessage={`There is no story with ID "${storyId}".`}
			onRevealGraph={runtimePassageId =>
				history.push(
					`/stories/${storyId}?mode=graph${passageQuery(runtimePassageId)}`
				)
			}
			onRevealSource={runtimePassageId =>
				history.push(
					`/stories/${storyId}?mode=text${passageQuery(runtimePassageId)}`
				)
			}
			onTestCurrentPassage={runtimePassageId =>
				history.push(
					`/stories/${storyId}/test/${encodeURIComponent(runtimePassageId)}`
				)
			}
			onTestFromStart={
				startPassage
					? () =>
							history.push(
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
			targetLabel="Test"
			title="Story test preview"
		/>
	);
};
