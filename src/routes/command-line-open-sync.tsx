import * as React from 'react';
import {useNavigate} from 'react-router';
import type {NativeCommandLineOpenResult} from '../electron/shared';
import {useProjectLibraryService} from '../store/project-library-service';
import {
	markPerformance,
	measurePerformance,
	recordPerformanceHarnessEvent
} from '../util/performance';

export const CommandLineOpenSync: React.FC = () => {
	const navigate = useNavigate();
	const projectLibrary = useProjectLibraryService();
	const consumePromiseRef = React.useRef<Promise<void> | undefined>(undefined);
	const initialConsumeRequestedRef = React.useRef(false);
	const mountedRef = React.useRef(false);
	const navigateRef = React.useRef(navigate);
	const rerunRequestedRef = React.useRef(false);

	React.useLayoutEffect(() => {
		navigateRef.current = navigate;
	}, [navigate]);

	React.useEffect(() => {
		if (!projectLibrary.canConsumeCommandLineOpenRequests()) {
			return;
		}
		mountedRef.current = true;

		function applyResult(result: NativeCommandLineOpenResult) {
			for (const project of result.openedProjects) {
				recordPerformanceHarnessEvent('native-project-shell-loaded', {
					...project.loadPerformanceTimings,
					graphLayoutLoaded: project.graphLayoutLoaded,
					passageTextLoaded: project.passageTextLoaded,
					rootPath: project.rootPath,
					storySourcesLoaded: project.storySourcesLoaded,
					storyCount: project.stories.length
				});
			}
			const dispatchStarted = performance.now();
			const {stories: mergedStories, storyIds: openedStoryIds} =
				projectLibrary.admitOpenedProjects(result.openedProjects);

			if (openedStoryIds.length > 0) {
				recordPerformanceHarnessEvent('renderer-project-shell-dispatched', {
					durationMs: performance.now() - dispatchStarted,
					passageCount: mergedStories.reduce(
						(total, story) => total + story.passages.length,
						0
					)
				});
				markPerformance('shell-visible');
				measurePerformance('open-to-shell', 'open-start', 'shell-visible');
				navigateRef.current(`/stories/${openedStoryIds[0]}`);

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
		}

		function consumeQueuedRequests() {
			rerunRequestedRef.current = true;

			if (consumePromiseRef.current) {
				return;
			}

			consumePromiseRef.current = (async () => {
				while (mountedRef.current && rerunRequestedRef.current) {
					rerunRequestedRef.current = false;
					markPerformance('open-start');

					try {
						const result =
							await projectLibrary.consumeCommandLineOpenRequests();

						if (mountedRef.current) {
							applyResult(result);
						}
					} catch (reason) {
						if (mountedRef.current) {
							console.warn(
								'Could not consume command-line open requests:',
								reason
							);
						}
					}
				}
			})().finally(() => {
				consumePromiseRef.current = undefined;

				if (mountedRef.current && rerunRequestedRef.current) {
					consumeQueuedRequests();
				}
			});
		}

		const unsubscribe = projectLibrary.onCommandLineOpenRequest(
			consumeQueuedRequests
		);

		if (!initialConsumeRequestedRef.current) {
			initialConsumeRequestedRef.current = true;
			consumeQueuedRequests();
		}

		return () => {
			mountedRef.current = false;
			unsubscribe?.();
		};
	}, [projectLibrary]);

	return null;
};
