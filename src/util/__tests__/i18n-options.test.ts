import {browserI18nBaseUrl, browserI18nOptions} from '../i18n-options';

describe('i18n initialization options', () => {
	it('configures retry limits on i18next rather than its HTTP backend', () => {
		const options = browserI18nOptions('./', true);

		expect(options.maxRetries).toBe(1);
		expect(options.backend).not.toHaveProperty('maxRetries');
	});

	it('loads locale files using canonical region casing', () => {
		const options = browserI18nOptions(
			'file:///Applications/Twine%20RS/',
			false
		);

		expect(options.backend.loadPath(['en-us'])).toBe(
			'file:///Applications/Twine%20RS/locales/en-US.json'
		);
	});

	it('uses an absolute HTTP locale base without changing the path', () => {
		const options = browserI18nOptions('https://example.com/twine/', false);

		expect(options.backend.loadPath(['pt-br'])).toBe(
			'https://example.com/twine/locales/pt-BR.json'
		);
	});

	it.each([
		[
			'file:///Applications/Twine%20RS/renderer/index.html',
			'file:///Applications/Twine%20RS/renderer/'
		],
		['https://example.com/twine/index.html', 'https://example.com/twine/']
	])(
		'resolves a relative base against the page URL %s',
		(pageUrl, expected) => {
			expect(browserI18nBaseUrl('./', pageUrl)).toBe(expected);
		}
	);
});
