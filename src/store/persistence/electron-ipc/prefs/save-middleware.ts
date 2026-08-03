import {PrefsAction, PrefsState} from '../../../prefs';
import {saveJson} from '../save-json';

/**
 * A middleware function to save changes to disk. This should be called
 * *after* the main reducer runs.
 */
export function saveMiddleware(state: PrefsState, action: PrefsAction) {
	if (isPersistenceAffectingAction(action)) {
		return saveJson('prefs.json', state);
	}
}

export function isPersistenceAffectingAction(action: PrefsAction) {
	return action.type === 'repair' || action.type === 'update';
}
