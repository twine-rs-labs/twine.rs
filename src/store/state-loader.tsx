import * as React from 'react';
import {LoadingCurtain} from '../components/loading-curtain';
import {usePersistence} from './persistence/use-persistence';
import {usePrefsContext} from './prefs';
import {useStoriesContext} from './stories';
import {useStoryFormatsContext} from './story-formats';
import {useStoriesRepair} from './use-stories-repair';
import {markPerformance, measurePerformance} from '../util/performance';
import {
	metadataStory,
	registerBootstrapStories
} from '../core/bootstrap-stories';
import type {Story, StoryWithDocuments} from './stories';

function storiesWithDocuments(stories: Story[]): StoryWithDocuments[] {
	if (
		stories.some(story =>
			story.passages.some(
				passage =>
					!('text' in passage) ||
					typeof (passage as {text?: unknown}).text !== 'string'
			)
		)
	) {
		throw new Error('Loaded story state is missing passage documents.');
	}
	return stories as StoryWithDocuments[];
}

async function loadOrDefault<T>(
	name: string,
	load: () => Promise<T>,
	defaultValue: T
): Promise<T> {
	try {
		return await load();
	} catch (error) {
		console.warn(
			`Could not load ${name}; continuing with default state: ${
				(error as Error).message
			}`
		);
		return defaultValue;
	}
}

export const StateLoader: React.FC<React.PropsWithChildren> = ({children}) => {
	const [inited, setInited] = React.useState(false);
	const [prefsRepaired, setPrefsRepaired] = React.useState(false);
	const [formatsRepaired, setFormatsRepaired] = React.useState(false);
	const [storiesRepaired, setStoriesRepaired] = React.useState(false);
	const [passageBodiesSeparated, setPassageBodiesSeparated] =
		React.useState(false);
	const {dispatch: prefsDispatch, prefs: prefsState} = usePrefsContext();
	const {dispatch: storiesDispatch, stories: storiesState = []} =
		useStoriesContext();
	const {dispatch: formatsDispatch, formats: formatsState} =
		useStoryFormatsContext();
	const repairStories = useStoriesRepair();
	const {prefs, stories, storyFormats} = usePersistence();
	const initializationRef = React.useRef<
		| Promise<{
				formatsState: Awaited<ReturnType<typeof storyFormats.load>>;
				prefsState: Awaited<ReturnType<typeof prefs.load>>;
				storiesState: Awaited<ReturnType<typeof stories.load>>;
		  }>
		| undefined
	>(undefined);
	const initializationAppliedRef = React.useRef(false);

	// Done in steps so that the repair action can see the inited state, and then
	// each repair action can see the results of the preceding ones.
	//
	// Repairs must go:
	// formats -> prefs (so it can repair bad format preferences) -> stories

	React.useEffect(() => {
		let canceled = false;

		if (!initializationRef.current) {
			markPerformance('open-start');
			initializationRef.current = (async () => {
				const formatsState = await loadOrDefault(
					'story formats',
					storyFormats.load,
					[]
				);
				const prefsState = await loadOrDefault('preferences', prefs.load, {});
				const storiesState = await loadOrDefault('stories', stories.load, []);

				return {formatsState, prefsState, storiesState};
			})();
		}

		void initializationRef.current.then(
			({formatsState, prefsState, storiesState}) => {
				if (canceled || initializationAppliedRef.current) {
					return;
				}

				initializationAppliedRef.current = true;
				formatsDispatch({type: 'init', state: formatsState});
				prefsDispatch({type: 'init', state: prefsState});
				storiesDispatch({type: 'init', state: storiesState});
				markPerformance('all-passages-ready');
				setInited(true);
			}
		);

		return () => {
			canceled = true;
		};
	}, [
		formatsDispatch,
		prefs,
		prefsDispatch,
		stories,
		storiesDispatch,
		storyFormats
	]);

	React.useEffect(() => {
		if (inited && !formatsRepaired) {
			formatsDispatch({type: 'repair'});
			setFormatsRepaired(true);
		}
	}, [formatsDispatch, formatsRepaired, inited]);

	React.useEffect(() => {
		if (inited && formatsRepaired && !prefsRepaired) {
			prefsDispatch({type: 'repair', allFormats: formatsState});
			setPrefsRepaired(true);
		}
	}, [formatsRepaired, formatsState, inited, prefsDispatch, prefsRepaired]);

	React.useEffect(() => {
		if (inited && formatsRepaired && prefsRepaired && !storiesRepaired) {
			repairStories();
			setStoriesRepaired(true);
		}
	}, [
		formatsDispatch,
		formatsRepaired,
		formatsState,
		inited,
		prefsDispatch,
		prefsRepaired,
		prefsState.storyFormat.name,
		prefsState.storyFormat.version,
		repairStories,
		stories,
		storiesDispatch,
		storiesRepaired
	]);

	React.useEffect(() => {
		if (inited && formatsRepaired && prefsRepaired && storiesRepaired) {
			if (
				!passageBodiesSeparated ||
				storiesState.some(story =>
					story.passages.some(
						passage =>
							'text' in passage &&
							typeof passage.text === 'string' &&
							passage.text.length > 0
					)
				)
			) {
				const completeStories = storiesWithDocuments(storiesState);
				registerBootstrapStories(completeStories);
				storiesDispatch({
					state: completeStories.map(metadataStory),
					type: 'init'
				});
				if (!passageBodiesSeparated) {
					setPassageBodiesSeparated(true);
				}
				return;
			}

			markPerformance('shell-visible');
			measurePerformance('open-to-shell', 'open-start', 'shell-visible');
		}
	}, [
		formatsRepaired,
		inited,
		passageBodiesSeparated,
		prefsRepaired,
		storiesDispatch,
		storiesRepaired,
		storiesState
	]);

	return inited &&
		formatsRepaired &&
		prefsRepaired &&
		storiesRepaired &&
		passageBodiesSeparated ? (
		<>{children}</>
	) : (
		<LoadingCurtain />
	);
};
