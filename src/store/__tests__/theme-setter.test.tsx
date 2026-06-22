import * as React from 'react';
import {ThemeSetter} from '../theme-setter';
import {render} from '@testing-library/react';
import {useComputedTheme} from '../prefs/use-computed-theme';
import {PrefsContext} from '../prefs';
import {fakePrefs} from '../../test-util';

jest.mock('../prefs/use-computed-theme');

describe('<ThemeSetter>', () => {
	const useComputedThemeMock = useComputedTheme as jest.Mock;

	it("sets the body tag's dataset-app-theme property based on the computed theme", () => {
		useComputedThemeMock.mockReturnValue('light');
		render(
			<PrefsContext.Provider
				value={{
					dispatch: jest.fn(),
					prefs: fakePrefs({highContrast: true, reducedMotion: true})
				}}
			>
				<ThemeSetter />
			</PrefsContext.Provider>
		);
		expect(document.body.dataset.appTheme).toBe('light');
		expect(document.body.dataset.highContrast).toBe('true');
		expect(document.body.dataset.reducedMotion).toBe('true');
		expect(
			document.documentElement.style.getPropertyValue('color-scheme')
		).toBe('light');
		useComputedThemeMock.mockReturnValue('dark');
		render(
			<PrefsContext.Provider
				value={{
					dispatch: jest.fn(),
					prefs: fakePrefs({highContrast: false, reducedMotion: false})
				}}
			>
				<ThemeSetter />
			</PrefsContext.Provider>
		);
		expect(document.body.dataset.appTheme).toBe('dark');
		expect(document.body.dataset.highContrast).toBe('false');
		expect(document.body.dataset.reducedMotion).toBe('false');
		expect(
			document.documentElement.style.getPropertyValue('color-scheme')
		).toBe('dark');
	});
});
