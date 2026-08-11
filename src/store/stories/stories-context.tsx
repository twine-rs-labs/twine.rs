import * as React from 'react';
import useThunkReducer from '../../util/use-thunk-reducer';
import {usePersistence} from '../persistence/use-persistence';
import {reducer} from './reducer';
import {
	StoriesContextProps,
	StoriesAction,
	StoriesState
} from './stories.types';
import {useStoryFormatsContext} from '../story-formats';
import {useStoreErrorReporter} from '../use-store-error-reporter';
import {
	publishStorySaveStatus,
	StorySaveStatus
} from '../persistence/save-status';
import {recordPerformanceHarnessEvent} from '../../util/performance';
import {
	bindPersistenceCompletion,
	rejectPersistenceCompletion
} from '../persistence/completion';

export const StoriesContext = React.createContext<StoriesContextProps>({
	dispatch: () => {},
	stories: []
});

StoriesContext.displayName = 'Stories';

export const useStoriesContext = () => React.useContext(StoriesContext);

function queueStorySaveStatus(status: StorySaveStatus) {
	Promise.resolve().then(() => publishStorySaveStatus(status));
}

export const StoriesContextProvider: React.FC<
	React.PropsWithChildren
> = props => {
	const {stories: storiesPersistence} = usePersistence();
	const {formats} = useStoryFormatsContext();
	const {reportError} = useStoreErrorReporter();
	const persistedReducer: React.Reducer<StoriesState, StoriesAction> =
		React.useMemo(
			() => (state, action) => {
				if (storiesPersistence.canReduceAction?.(action) === false) {
					if (
						action.type === 'applyCorePatchBatch' &&
						action.persistenceToken
					) {
						rejectPersistenceCompletion(
							action.persistenceToken,
							new Error('Project persistence is currently unavailable.')
						);
					}
					return state;
				}
				const reducerStarted = performance.now();
				const newState = reducer(state, action);
				const reducedAt = performance.now();

				try {
					const persistence = storiesPersistence.saveMiddleware(
						newState,
						action,
						formats
					);
					if (
						action.type === 'applyCorePatchBatch' &&
						action.persistenceToken
					) {
						bindPersistenceCompletion(action.persistenceToken, persistence);
					}
					recordPerformanceHarnessEvent('stories-dispatch-stages', {
						action: action.type,
						persistenceSetupMs: performance.now() - reducedAt,
						reducerMs: reducedAt - reducerStarted,
						totalMs: performance.now() - reducerStarted
					});

					if (typeof persistence === 'object') {
						void persistence.completion
							.then(() => {
								if (persistence.persisted) {
									recordPerformanceHarnessEvent('persistence-save-notified', {
										revision:
											action.type === 'applyCorePatchBatch'
												? action.revision
												: undefined,
										sessionId:
											action.type === 'applyCorePatchBatch'
												? action.sessionId
												: undefined
									});
									queueStorySaveStatus({
										kind: 'saved',
										revision:
											action.type === 'applyCorePatchBatch'
												? action.revision
												: undefined,
										savedAt: Date.now(),
										sessionId:
											action.type === 'applyCorePatchBatch'
												? action.sessionId
												: undefined
									});
								}
							})
							.catch(error => {
								recordPerformanceHarnessEvent(
									'persistence-notification-failed',
									{
										error: (error as Error).message,
										revision:
											action.type === 'applyCorePatchBatch'
												? action.revision
												: undefined,
										sessionId:
											action.type === 'applyCorePatchBatch'
												? action.sessionId
												: undefined
									}
								);
								queueStorySaveStatus({
									error: error as Error,
									kind: 'error',
									revision:
										action.type === 'applyCorePatchBatch'
											? action.revision
											: undefined,
									sessionId:
										action.type === 'applyCorePatchBatch'
											? action.sessionId
											: undefined
								});
								reportError(error as Error, 'store.errors.cantPersistStories');
							});
					} else if (persistence) {
						queueStorySaveStatus({kind: 'saved', savedAt: Date.now()});
					}
				} catch (error) {
					if (
						action.type === 'applyCorePatchBatch' &&
						action.persistenceToken
					) {
						rejectPersistenceCompletion(action.persistenceToken, error);
					}
					queueStorySaveStatus({kind: 'error', error: error as Error});
					reportError(error as Error, 'store.errors.cantPersistStories');
				}

				return newState;
			},
			[formats, reportError, storiesPersistence]
		);
	const [stories, dispatch] = useThunkReducer(persistedReducer, []);

	return (
		<StoriesContext.Provider value={{dispatch, stories}}>
			{props.children}
		</StoriesContext.Provider>
	);
};
