import {PrefsAction, PrefsState} from './prefs.types';
import {defaults} from './defaults';
import {formatWithNameAndVersion, newestFormatNamed} from '../story-formats';
import {closestAppLocale} from '../../util/locales';

function repairStoryFormatEditorPreferences(
	value: PrefsState['storyFormatEditorPreferences'],
	fallback: PrefsState['storyFormatEditorPreferences']
) {
	const defaultDialect = fallback['harlowe-3.3.9'];
	const result: PrefsState['storyFormatEditorPreferences'] = {};

	for (const [dialect, preferences] of Object.entries(value)) {
		if (!preferences || typeof preferences !== 'object') {
			continue;
		}

		result[dialect] = {
			codeUsesCodeFont:
				typeof preferences.codeUsesCodeFont === 'boolean'
					? preferences.codeUsesCodeFont
					: defaultDialect.codeUsesCodeFont,
			codingTooltips:
				typeof preferences.codingTooltips === 'boolean'
					? preferences.codingTooltips
					: defaultDialect.codingTooltips,
			completionsForKeywords:
				typeof preferences.completionsForKeywords === 'boolean'
					? preferences.completionsForKeywords
					: defaultDialect.completionsForKeywords,
			completionsForMacros:
				typeof preferences.completionsForMacros === 'boolean'
					? preferences.completionsForMacros
					: defaultDialect.completionsForMacros
		};
	}

	result['harlowe-3.3.9'] = {
		...defaultDialect,
		...result['harlowe-3.3.9']
	};
	return result;
}

const validPreferenceValues: Partial<Record<keyof PrefsState, string[]>> = {
	cloudSaveIntegration: ['off', 'manual'],
	codeEditorTheme: [
		'twine',
		'one-dark',
		'solarized-light',
		'solarized-dark',
		'high-contrast'
	],
	editorFocusPreference: ['restore', 'passage-start', 'none'],
	graphDefaultCardSize: [
		'twine',
		'small',
		'narrow',
		'medium',
		'large',
		'tall',
		'wide'
	],
	hostingPublishIntegration: ['off', 'manual'],
	keybindingPreset: ['default', 'emacs', 'vim'],
	passageTagDisplay: ['color', 'name'],
	preferredStoryEditMode: ['auto', 'text', 'graph', 'split'],
	revisionControlIntegration: ['off', 'manual'],
	shareLinkMode: ['off', 'local-file', 'published-url'],
	storyFormatListFilter: ['current', 'all', 'user'],
	storyListSort: ['date', 'name']
};

export const reducer: React.Reducer<PrefsState, PrefsAction> = (
	state,
	action
) => {
	switch (action.type) {
		case 'init': {
			const initializedState = {...state, ...action.state};

			return {
				...initializedState,
				locale: closestAppLocale(initializedState.locale)
			};
		}

		case 'repair': {
			const defs = defaults();

			// Type check values.

			const changes: Partial<PrefsState> = Object.entries(defs).reduce(
				(result, [key, value]) => {
					const prefKey = key as keyof PrefsState;

					if (
						(typeof value === 'number' && !Number.isFinite(state[prefKey])) ||
						typeof value !== typeof state[prefKey]
					) {
						console.info(
							`Repairing preference "${key}" by setting it to ${value}, ` +
								`was ${state[prefKey]} (bad type)`
						);
						return {...result, [prefKey]: value};
					}

					// If an enumerated preference has drifted to an invalid value, then
					// replace it with the default.

					const validValues = validPreferenceValues[prefKey];

					if (validValues && !validValues.includes(state[prefKey] as string)) {
						console.info(
							`Repairing preference "${key}" by setting it to ${value}, was ${state[prefKey]} (not a valid value)`
						);
						return {...result, [prefKey]: value};
					}

					return result;
				},
				{}
			);

			if (typeof state.locale === 'string') {
				const repairedLocale = closestAppLocale(state.locale);

				if (repairedLocale !== state.locale) {
					console.info(
						`Repairing locale preference by setting it to ${repairedLocale}, was ${state.locale}`
					);
					changes.locale = repairedLocale;
				}
			}

			// If the proofing or story format don't match an existing format, repair
			// them to the most recent version with the same name. If none exist with
			// that name, repair to the default.

			const {proofingFormat, storyFormat} = state;
			const {allFormats} = action;
			const repairedEditorPreferences = repairStoryFormatEditorPreferences(
				state.storyFormatEditorPreferences &&
					typeof state.storyFormatEditorPreferences === 'object'
					? state.storyFormatEditorPreferences
					: defs.storyFormatEditorPreferences,
				defs.storyFormatEditorPreferences
			);

			if (
				JSON.stringify(repairedEditorPreferences) !==
				JSON.stringify(state.storyFormatEditorPreferences)
			) {
				changes.storyFormatEditorPreferences = repairedEditorPreferences;
			}

			try {
				formatWithNameAndVersion(
					allFormats,
					proofingFormat.name,
					proofingFormat.version
				);
			} catch {
				const format = newestFormatNamed(allFormats, proofingFormat.name);

				if (format) {
					console.info(
						`Repairing proofing format preference (version doesn't exist) by setting to ${format.name} ${format.version}, was ${proofingFormat.name} ${proofingFormat.version}`
					);
					changes.proofingFormat = {name: format.name, version: format.version};
				} else {
					console.info(
						`Repairing proofing format preference (format doesn't exist at all) by setting to default ${defs.proofingFormat.name} ${defs.proofingFormat.version}, was ${proofingFormat.name} ${proofingFormat.version}`
					);
					changes.proofingFormat = {
						name: defs.proofingFormat.name,
						version: defs.proofingFormat.version
					};
				}
			}

			try {
				formatWithNameAndVersion(
					allFormats,
					storyFormat.name,
					storyFormat.version
				);
			} catch {
				const format = newestFormatNamed(allFormats, storyFormat.name);

				if (format) {
					console.info(
						`Repairing story format preference (version doesn't exist) by setting to ${format.name} ${format.version}, was ${storyFormat.name} ${storyFormat.version}`
					);
					changes.storyFormat = {name: format.name, version: format.version};
				} else {
					console.info(
						`Repairing story format preference (format doesn't exist at all) by setting to default ${defs.storyFormat.name} ${defs.storyFormat.version}, was ${storyFormat.name} ${proofingFormat.version}`
					);
					changes.storyFormat = {
						name: defs.storyFormat.name,
						version: defs.storyFormat.version
					};
				}
			}

			return {...state, ...changes};
		}

		case 'update': {
			return {
				...state,
				[action.name]:
					action.name === 'locale'
						? closestAppLocale(action.value)
						: action.value
			};
		}
	}
};
