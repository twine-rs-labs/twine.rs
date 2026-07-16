import * as React from 'react';
import {useNavigate, useLocation, useParams} from 'react-router';
import {useCoreProjectHost} from '../../core';
import type {CoreStorySummary} from '../../core';
import {usePublishing} from '../../store/use-publishing';
import {useStoriesContext} from '../../store/stories';
import {StoryPreviewFrame} from '../story-preview-frame';
import {
	storyPreviewDebugMetrics,
	storyPreviewPassages
} from '../story-preview-debug';

export const StoryProofRoute: React.FC = () => {
	const [publishError, setPublishError] = React.useState<Error>();
	const [html, setHtml] = React.useState<string>();
	const {storyId = ''} = useParams<'storyId'>();
	const navigate = useNavigate();
	const location = useLocation();
	const {proofStory} = usePublishing();
	const coreProjectHost = useCoreProjectHost();
	const [summary, setSummary] = React.useState<CoreStorySummary>();
	const {stories} = useStoriesContext();
	const story = stories.find(story => story.id === storyId);
	const storyExists = !!story;
	const startPassage = story?.passages.find(
		passage => passage.id === story.startPassage
	);
	const proofingFormat = React.useMemo(() => {
		const params = new URLSearchParams(location.search);
		const name = params.get('proofingFormatName');
		const version = params.get('proofingFormatVersion');

		return name && version ? {name, version} : undefined;
	}, [location.search]);
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
		let active = true;

		async function load() {
			try {
				const proof = proofingFormat
					? await proofStory(storyId, proofingFormat)
					: await proofStory(storyId);

				if (active) {
					setHtml(proof);
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
	}, [proofStory, proofingFormat, storyExists, storyId]);

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
			targetLabel="Proof"
			title="Story proofing preview"
		/>
	);
};
