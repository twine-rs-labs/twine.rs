import {initLocales} from '../locales';
import i18next from 'i18next';
import {loadPrefs} from '../prefs';

jest.mock('i18next');
jest.mock('../prefs');

describe('initLocales()', () => {
	const initMock = i18next.init as jest.Mock;
	const changeLanguageMock = i18next.changeLanguage as jest.Mock;
	const loadPrefsMock = loadPrefs as jest.Mock;

	beforeEach(() => {
		jest.spyOn(console, 'log').mockReturnValue();
	});

	it('awaits initialization and the user-preferred language change', async () => {
		let resolveInit!: () => void;
		let resolveLanguageChange!: () => void;
		let settled = false;

		initMock.mockReturnValue(
			new Promise<void>(resolve => (resolveInit = () => resolve()))
		);
		loadPrefsMock.mockResolvedValue({locale: 'mock-locale'});
		changeLanguageMock.mockReturnValue(
			new Promise<void>(resolve => (resolveLanguageChange = () => resolve()))
		);
		const initialization = initLocales().then(() => (settled = true));

		await Promise.resolve();
		expect(loadPrefsMock).not.toHaveBeenCalled();
		expect(settled).toBe(false);

		resolveInit();
		await Promise.resolve();
		await Promise.resolve();
		expect(changeLanguageMock.mock.calls).toEqual([['mock-locale']]);
		expect(settled).toBe(false);

		resolveLanguageChange();
		await initialization;
		expect(settled).toBe(true);
	});

	it('does not throw an error if loading user preferences fails', async () => {
		jest.spyOn(console, 'warn').mockReturnValue();
		initMock.mockResolvedValue(undefined);
		loadPrefsMock.mockRejectedValue(new Error());

		await expect(initLocales()).resolves.toBeUndefined();
		expect(changeLanguageMock).not.toHaveBeenCalled();
	});
});
