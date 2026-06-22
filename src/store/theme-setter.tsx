import * as React from 'react';
import {usePrefsContext} from './prefs';
import {useComputedTheme} from './prefs/use-computed-theme';

export function ThemeSetter() {
	const computedTheme = useComputedTheme();
	const {prefs} = usePrefsContext();

	React.useEffect(() => {
		document.body.dataset.appTheme = computedTheme;
		document.body.dataset.highContrast = prefs.highContrast ? 'true' : 'false';
		document.body.dataset.reducedMotion = prefs.reducedMotion
			? 'true'
			: 'false';
		if (computedTheme === 'dark') {
			document.documentElement.style.setProperty('color-scheme', 'dark');
		} else {
			document.documentElement.style.setProperty('color-scheme', 'light');
		}
	}, [computedTheme, prefs.highContrast, prefs.reducedMotion]);

	return null;
}
