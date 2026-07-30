// Listens to changes in the locale preference and changes i18n's language
// accordingly.

import * as React from 'react';
import {usePrefsContext} from './prefs';
import {i18n} from '../util/i18n';
import {closestAppLocale} from '../util/locales';

export const LocaleSwitcher: React.FC = () => {
	const {prefs} = usePrefsContext();
	const locale = closestAppLocale(prefs.locale);

	React.useEffect(() => {
		i18n.changeLanguage(locale);
	}, [locale]);

	return null;
};
