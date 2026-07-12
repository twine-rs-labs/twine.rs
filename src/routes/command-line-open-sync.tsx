import * as React from 'react';
import {useHistory} from 'react-router-dom';
import type {TwineElectronWindow} from '../electron/shared';
import {
	mergeProjectStories,
	projectStoryIdsForCurrentStories
} from '../store/merge-project-stories';
import {markProjectStoryHydration} from '../store/project-hydration';
import {saveProjectMetadata} from '../store/project-metadata';
import {useStoriesContext} from '../store/stories';
import {
	markPerformance,
	measurePerformance,
	recordPerformanceHarnessEvent
} from '../util/performance';

export const CommandLineOpenSync: React.FC = () => {
	const consumed = React.useRef(false);
	const history = useHistory();
	const {dispatch, stories} = useStoriesContext();
	const storiesRef = React.useRef(stories);

	React.useEffect(() => {
		storiesRef.current = stories;
	}, [stories]);

	React.useEffect(() => {
		if (consumed.current) {
			return;
		}

		const bridge = (window as TwineElectronWindow).twineElectron;

		if (!bridge?.consumeCommandLineOpenRequests) {
			return;
		}

		let cancelled = false;

		consumed.current = true;
		markPerformance('open-start');
		void bridge.consumeCommandLineOpenRequests().then(result => {
			if (cancelled) {
				return;
			}

			const openedStoryIds: string[] = [];
			let mergedStories = storiesRef.current;

			for (const project of result.openedProjects) {
				recordPerformanceHarnessEvent('native-project-shell-loaded', {
					...project.loadPerformanceTimings,
					graphLayoutLoaded: project.graphLayoutLoaded,
					passageTextLoaded: project.passageTextLoaded,
					rootPath: project.rootPath,
					storySourcesLoaded: project.storySourcesLoaded,
					storyCount: project.stories.length
				});
				const projectStoryIds = projectStoryIdsForCurrentStories(
					mergedStories,
					project.stories,
					{preserveExistingIdentity: false}
				);

				for (const [index, story] of project.stories.entries()) {
					const storyId = projectStoryIds[index] ?? story.id;
					saveProjectMetadata(storyId, {
						rootPath: project.rootPath,
						status: 'file-backed',
						storageKind: 'electron-project-folder'
					});
					markProjectStoryHydration(storyId, {
						passageTextLoaded: project.passageTextLoaded !== false,
						rootPath: project.rootPath
					});
					openedStoryIds.push(storyId);
				}

				mergedStories = mergeProjectStories(mergedStories, project.stories, {
					preserveExistingIdentity: false
				});
			}

			if (openedStoryIds.length > 0) {
				const dispatchStarted = performance.now();
				storiesRef.current = mergedStories;
				dispatch({state: mergedStories, type: 'init'});
				recordPerformanceHarnessEvent('renderer-project-shell-dispatched', {
					durationMs: performance.now() - dispatchStarted,
					passageCount: mergedStories.reduce(
						(total, story) => total + story.passages.length,
						0
					)
				});
				markPerformance('shell-visible');
				measurePerformance('open-to-shell', 'open-start', 'shell-visible');
				history.push(`/stories/${openedStoryIds[0]}`);

				if (
					result.openedProjects.every(
						project => project.passageTextLoaded !== false
					)
				) {
					markPerformance('all-passages-ready');
					measurePerformance(
						'open-to-hydrated',
						'open-start',
						'all-passages-ready'
					);
				}
			}

			for (const path of result.unsupportedPaths) {
				console.warn(`Command-line path is not a project folder: ${path}`);
			}

			for (const error of result.errors) {
				console.warn(
					`Could not open command-line project folder ${error.path}: ${error.message}`
				);
			}
		});

		return () => {
			cancelled = true;
		};
	}, [dispatch, history, stories]);

	return null;
};
