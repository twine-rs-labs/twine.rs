import * as React from 'react';
import useThunkReducer from 'react-hook-thunk-reducer';
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

export const StoriesContext = React.createContext<StoriesContextProps>({
	dispatch: () => {},
	stories: []
});

StoriesContext.displayName = 'Stories';

export const useStoriesContext = () => React.useContext(StoriesContext);

function queueStorySaveStatus(status: StorySaveStatus) {
	Promise.resolve().then(() => publishStorySaveStatus(status));
}

export const StoriesContextProvider: React.FC = props => {
	const {stories: storiesPersistence} = usePersistence();
	const {formats} = useStoryFormatsContext();
	const {reportError} = useStoreErrorReporter();
	const persistedReducer: React.Reducer<StoriesState, StoriesAction> =
		React.useMemo(
			() => (state, action) => {
				const newState = reducer(state, action);

				try {
					const persistence = storiesPersistence.saveMiddleware(
						newState,
						action,
						formats
					);

					if (typeof persistence === 'object') {
						void persistence.completion
							.then(() => {
								if (persistence.persisted) {
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
