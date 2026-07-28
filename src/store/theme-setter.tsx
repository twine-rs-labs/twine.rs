import * as React from 'react';
import {applyDocumentAppearance} from './apply-document-appearance';
import {usePrefsContext} from './prefs';
import {useComputedTheme} from './prefs/use-computed-theme';

export function ThemeSetter() {
	const computedTheme = useComputedTheme();
	const {prefs} = usePrefsContext();

	React.useEffect(() => {
		applyDocumentAppearance({
			highContrast: prefs.highContrast,
			reducedMotion: prefs.reducedMotion,
			theme: computedTheme
		});
	}, [computedTheme, prefs.highContrast, prefs.reducedMotion]);

	return null;
}
