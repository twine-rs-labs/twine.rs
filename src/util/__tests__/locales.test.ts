import {closestAppLocale, localeFilename} from '../locales';

describe('localeFilename()', () => {
	it('uses canonical region casing', () => {
		expect(localeFilename('en-us')).toBe('en-US.json');
		expect(localeFilename('pt-br')).toBe('pt-BR.json');
		expect(localeFilename('pt-pt')).toBe('pt-PT.json');
		expect(localeFilename('zh-cn')).toBe('zh-CN.json');
	});

	it('preserves an unrecognized locale code', () => {
		expect(localeFilename('not_a_locale')).toBe('not_a_locale.json');
	});
});

describe('closestAppLocale()', () => {
	it('returns an exact match if one exists', () => {
		expect(closestAppLocale('fr')).toBe('fr');
		expect(closestAppLocale('pt-br')).toBe('pt-br');
	});

	it('returns a rough match if one exists', () => {
		expect(closestAppLocale('fr-CA')).toBe('fr');
		expect(closestAppLocale('da-DK')).toBe('da');
	});

	it("returns 'en-us' as a fallback", () =>
		expect(closestAppLocale('martian')).toBe('en-us'));
});
