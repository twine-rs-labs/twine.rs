import * as React from 'react';
import {useLocation} from 'react-router';

export const LocationInspector: React.FC = () => {
	const location = useLocation();

	return (
		<output
			data-testid="location"
			data-pathname={location.pathname}
			data-search={location.search}
		/>
	);
};
