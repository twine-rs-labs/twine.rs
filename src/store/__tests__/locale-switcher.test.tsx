import * as React from 'react';
import {render} from '@testing-library/react';
import {i18n} from '../../util/i18n';
import {LocaleSwitcher} from '../locale-switcher';
import {usePrefsContext} from '../prefs';

jest.mock('../../util/i18n', () => ({
	i18n: {changeLanguage: jest.fn()}
}));
jest.mock('../prefs/prefs-context');

describe('<LocaleSwitcher>', () => {
	it.each([
		['en-GB', 'en-us'],
		['fr-CA', 'fr'],
		['de', 'de']
	])('loads supported locale %s as %s', (preference, expected) => {
		(usePrefsContext as jest.Mock).mockReturnValue({
			prefs: {locale: preference}
		});

		render(<LocaleSwitcher />);

		expect(i18n.changeLanguage).toHaveBeenCalledWith(expected);
	});
});
