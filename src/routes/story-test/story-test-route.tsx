import * as React from 'react';
import {useParams} from 'react-router-dom';
import {replaceDom} from '../../util/replace-dom';
import {usePublishing} from '../../store/use-publishing';
import {ErrorMessage} from '../../components/error';
import {useStoriesContext} from '../../store/stories';

export const StoryTestRoute: React.FC = () => {
	const [publishError, setPublishError] = React.useState<Error>();
	const [inited, setInited] = React.useState(false);
	const {passageId, storyId} = useParams<{
		passageId: string;
		storyId: string;
	}>();
	const {publishStory} = usePublishing();
	const {stories} = useStoriesContext();
	const storyExists = stories.some(story => story.id === storyId);

	React.useEffect(() => {
		async function load() {
			try {
				replaceDom(
					await publishStory(storyId, {
						buildTarget: 'test',
						formatOptions: 'debug',
						startId: passageId
					})
				);
				setInited(true);
			} catch (error) {
				setPublishError(error as Error);
			}
		}

		if (!inited && !publishError && storyExists) {
			load();
		}
	}, [inited, passageId, publishError, publishStory, storyExists, storyId]);

	if (publishError) {
		return <ErrorMessage>{publishError.message}</ErrorMessage>;
	}

	if (!storyExists) {
		return (
			<ErrorMessage>{`There is no story with ID "${storyId}".`}</ErrorMessage>
		);
	}

	return null;
};
