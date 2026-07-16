import * as React from 'react';
import {useLocation, useParams} from 'react-router';

export const StoryEditRoute: React.FC = () => {
	const location = useLocation();
	const {storyId} = useParams<'storyId'>();

	return (
		<div
			data-testid="mock-story-edit-route"
			data-search={location.search}
			data-story-id={storyId}
		/>
	);
};
