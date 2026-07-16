import * as React from 'react';
import {useParams} from 'react-router';

export const StoryTestRoute: React.FC = () => {
	const {passageId, storyId} = useParams<'passageId' | 'storyId'>();

	return (
		<div
			data-testid="mock-story-test-route"
			data-passage-id={passageId}
			data-story-id={storyId}
		/>
	);
};
