import * as React from 'react';
import {Story} from '../../store/stories';
import {Point} from '../../util/geometry';

export function useViewCenter(
	story: Story,
	elementRef: React.RefObject<HTMLElement | null>
) {
	const getCenter = React.useCallback(() => {
		if (!elementRef.current) {
			throw new Error(
				'Asked for the center of an element, but it does not exist in the DOM yet'
			);
		}

		return {
			left:
				(elementRef.current.scrollLeft + elementRef.current.clientWidth / 2) /
				story.zoom,
			top:
				(elementRef.current.scrollTop + elementRef.current.clientHeight / 2) /
				story.zoom
		};
	}, [elementRef, story.zoom]);

	const setCenter = React.useCallback(
		({left, top}: Point) => {
			if (!elementRef.current) {
				throw new Error(
					'Asked to set the center of an element, but it does not exist in the DOM yet'
				);
			}

			const {height, width} = elementRef.current.getBoundingClientRect();
			const scroll = {
				left: (left - width / story.zoom / 2) * story.zoom,
				top: (top - height / story.zoom / 2) * story.zoom
			};

			elementRef.current.scrollTo(scroll);
		},
		[elementRef, story.zoom]
	);

	return {getCenter, setCenter};
}
