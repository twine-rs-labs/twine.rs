import {defaults} from '../defaults';

describe('preference defaults', () => {
	it.each([
		['en-GB', 'en-us'],
		['fr-CA', 'fr'],
		['pt-PT', 'pt-pt']
	])('maps the system locale %s to supported locale %s', (system, expected) => {
		jest.spyOn(window.navigator, 'language', 'get').mockReturnValue(system);

		expect(defaults().locale).toBe(expected);
	});
});
