import {initLocales, i18n} from '../locales';
import {loadPrefs} from '../prefs';

jest.unmock('i18next');
jest.mock('../prefs');

describe('main-process locale resources', () => {
	beforeEach(() => {
		jest.spyOn(console, 'log').mockReturnValue();
		jest.spyOn(console, 'warn').mockReturnValue();
		(loadPrefs as jest.Mock).mockResolvedValue({locale: 'en-us'});
	});

	it('translates nested Electron keys from the bundled default locale', async () => {
		await initLocales();

		expect(i18n.t('electron.backupsDirectoryName')).toBe('Backups');
		expect(i18n.t('electron.storiesDirectoryName')).toBe('Stories');
	});
});
