import * as React from 'react';
import {useLocation, useParams} from 'react-router';

export const StoryPreviewRoute: React.FC = () => {
	const {storyId} = useParams<'storyId'>();
	const {search} = useLocation();

	return (
		<div
			data-search={search}
			data-story-id={storyId}
			data-testid="mock-story-preview-route"
		/>
	);
};
