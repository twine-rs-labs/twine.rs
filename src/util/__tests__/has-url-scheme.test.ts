import {hasUrlScheme} from '../has-url-scheme';

describe('hasUrlScheme', () => {
	it.each([
		'https://example.com/image.svg',
		'data:image/svg+xml,%3Csvg%3E',
		'file:///tmp/image.svg',
		'mailto:person@example.com',
		'custom+extension.1:value',
		'C:/images/image.svg'
	])('recognizes a URL scheme in %s', value => {
		expect(hasUrlScheme(value)).toBe(true);
	});

	it.each([
		'images/image.svg',
		'./images/image.svg',
		'//example.com/image.svg',
		'1invalid:value',
		'C:\\images\\image.svg'
	])('does not recognize a URL scheme in %s', value => {
		expect(hasUrlScheme(value)).toBe(false);
	});
});
