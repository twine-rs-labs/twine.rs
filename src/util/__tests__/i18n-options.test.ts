import {browserI18nOptions} from '../i18n-options';

describe('i18n initialization options', () => {
	it('configures retry limits on i18next rather than its HTTP backend', () => {
		const options = browserI18nOptions('./', true);

		expect(options.maxRetries).toBe(1);
		expect(options.backend).not.toHaveProperty('maxRetries');
	});

	it('loads locale files using canonical region casing', () => {
		const options = browserI18nOptions('./', false);

		expect(options.backend.loadPath(['en-us'])).toBe('./locales/en-US.json');
	});
});
