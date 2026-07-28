import * as React from 'react';
import useThunkReducer from '../util/use-thunk-reducer';
import {fakeLoadedStoryFormat} from '.';
import {
	CoreProjectHost,
	CoreProjectHostContext,
	CoreProjectHostProvider
} from '../core/project-host';
import {DialogsContextProvider} from '../dialogs';
import {PrefsContext, PrefsState} from '../store/prefs';
import {reducer as prefsReducer} from '../store/prefs/reducer';
import {StoriesAction, StoriesContext, StoriesState} from '../store/stories';
import {reducer as storiesReducer} from '../store/stories/reducer';
import {StoryFormatsContext, StoryFormatsState} from '../store/story-formats';
import {reducer as storyFormatsReducer} from '../store/story-formats/reducer';
import {fakePrefs, fakeStory} from './fakes';

export interface FakeStateProviderProps {
	children?: React.ReactNode;
	coreProjectHost?: CoreProjectHost;
	prefs?: Partial<PrefsState>;
	stories?: StoriesState;
	storiesDispatchObserver?: (action: StoriesAction) => void;
	storyFormats?: StoryFormatsState;
}

export const FakeStateProvider: React.FC<FakeStateProviderProps> = props => {
	const format = fakeLoadedStoryFormat();
	const story = fakeStory();

	story.storyFormat = format.name;
	story.storyFormatVersion = format.version;

	const [prefsState, prefsDispatch] = React.useReducer(prefsReducer, {
		...fakePrefs(),
		...props.prefs
	});
	const observedStoriesReducer = React.useCallback(
		(state: StoriesState, action: StoriesAction) => {
			props.storiesDispatchObserver?.(action);
			return storiesReducer(state, action);
		},
		[props.storiesDispatchObserver]
	);
	const [storiesState, storiesDispatch] = useThunkReducer(
		observedStoriesReducer,
		props.stories ?? [story]
	);
	const [storyFormatsState, storyFormatsDispatch] = useThunkReducer(
		storyFormatsReducer,
		props.storyFormats ?? [format]
	);
	const children = props.coreProjectHost ? (
		<CoreProjectHostContext.Provider value={props.coreProjectHost}>
			<DialogsContextProvider>{props.children}</DialogsContextProvider>
		</CoreProjectHostContext.Provider>
	) : (
		<CoreProjectHostProvider>
			<DialogsContextProvider>{props.children}</DialogsContextProvider>
		</CoreProjectHostProvider>
	);

	return (
		<PrefsContext.Provider value={{dispatch: prefsDispatch, prefs: prefsState}}>
			<StoryFormatsContext.Provider
				value={{dispatch: storyFormatsDispatch, formats: storyFormatsState}}
			>
				<StoriesContext.Provider
					value={{dispatch: storiesDispatch, stories: storiesState}}
				>
					{children}
				</StoriesContext.Provider>
			</StoryFormatsContext.Provider>
		</PrefsContext.Provider>
	);
};
