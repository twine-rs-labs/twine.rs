import {PassageWithText, Story} from './stories.types';

export const defaultPassageName = 'Untitled Passage';
export const defaultStoryName = 'Untitled Story';

export const passageDefaults = (): Omit<PassageWithText, 'id' | 'story'> => ({
	height: 100,
	highlighted: false,
	left: 0,
	name: defaultPassageName,
	selected: false,
	tags: [],
	text: '',
	top: 0,
	width: 100
});

export const storyDefaults = (): Omit<Story, 'id'> => ({
	ifid: '',
	lastUpdate: new Date(),
	passages: [],
	name: defaultStoryName,
	script: '',
	selected: false,
	snapToGrid: true,
	startPassage: '',
	storyFormat: '',
	storyFormatVersion: '',
	stylesheet: '',
	tags: [],
	tagColors: {},
	zoom: 1
});
