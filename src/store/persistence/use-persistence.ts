import * as React from 'react';
import {useElectronIpcPersistence} from './electron-ipc/use-electron-ipc-persistence';
import {useLocalStoragePersistence} from './local-storage/use-local-storage-persistence';
import {isElectronRenderer} from '../../util/is-electron';
import {StoriesAction, StoriesState} from '../stories';
import {StoryFormatsAction, StoryFormatsState} from '../story-formats';
import {PrefsAction, PrefsState} from '../prefs';

export interface PersistenceHooks {
	prefs: {
		canReduceAction?: (action: PrefsAction) => boolean;
		load: () => Promise<Partial<PrefsState>>;
		saveMiddleware: (
			state: PrefsState,
			action: PrefsAction
		) => void | Promise<void>;
	};
	stories: {
		canReduceAction?: (action: StoriesAction) => boolean;
		load: () => Promise<StoriesState>;
		saveMiddleware: (
			state: StoriesState,
			action: StoriesAction,
			formats: StoryFormatsState
		) => boolean | StoryPersistenceResult;
	};
	storyFormats: {
		canReduceAction?: (action: StoryFormatsAction) => boolean;
		load: () => Promise<StoryFormatsState>;
		saveMiddleware: (
			state: StoryFormatsState,
			action: StoryFormatsAction
		) => void | Promise<void>;
	};
}

export interface StoryPersistenceResult {
	completion: Promise<void>;
	persisted: boolean;
}

export function usePersistence(): PersistenceHooks {
	const electronIpcPersistence = useElectronIpcPersistence();
	const localStoragePersistence = useLocalStoragePersistence();

	return React.useMemo(
		() =>
			isElectronRenderer() ? electronIpcPersistence : localStoragePersistence,
		[electronIpcPersistence, localStoragePersistence]
	);
}
