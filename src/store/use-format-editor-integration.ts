import * as React from 'react';
import {getAppInfo} from '../util/app-info';
import {resolveStoryFormatEditorIntegration} from '../util/story-format';
import {formatEditorExtensionsDisabled, usePrefsContext} from './prefs';
import {loadFormatProperties, useStoryFormatsContext} from './story-formats';

/**
 * Resolves and, when necessary, loads the exact installed format selected by a
 * story. Missing formats fail closed instead of throwing.
 */
export function useFormatEditorIntegration(
	formatName: string,
	formatVersion: string
) {
	const {dispatch, formats} = useStoryFormatsContext();
	const {prefs} = usePrefsContext();
	const format = formats.find(
		candidate =>
			candidate.name === formatName && candidate.version === formatVersion
	);
	const disabled = formatEditorExtensionsDisabled(
		prefs,
		formatName,
		formatVersion
	);

	React.useEffect(() => {
		if (format?.loadState === 'unloaded' && !disabled) {
			dispatch(loadFormatProperties(format));
		}
	}, [disabled, dispatch, format]);

	return React.useMemo(
		() =>
			resolveStoryFormatEditorIntegration(format, {
				disabled,
				twineVersion: getAppInfo().twineCompatibilityVersion
			}),
		[disabled, format]
	);
}
