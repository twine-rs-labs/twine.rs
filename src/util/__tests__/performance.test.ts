import {
	markPerformance,
	measurePerformance,
	performanceSnapshot
} from '../performance';

describe('performance utilities', () => {
	let originalPerformance: Performance;
	let entries: Array<{
		duration: number;
		entryType: string;
		name: string;
		startTime: number;
	}>;

	beforeEach(() => {
		originalPerformance = window.performance;
		entries = [];
		Object.defineProperty(window, 'performance', {
			configurable: true,
			value: {
				getEntries: jest.fn(() => entries),
				mark: jest.fn((name: string) =>
					entries.push({
						duration: 0,
						entryType: 'mark',
						name,
						startTime: entries.length
					})
				),
				measure: jest.fn((name: string) =>
					entries.push({
						duration: 1,
						entryType: 'measure',
						name,
						startTime: entries.length
					})
				)
			}
		});
	});

	afterEach(() => {
		Object.defineProperty(window, 'performance', {
			configurable: true,
			value: originalPerformance
		});
	});

	it('exports twine performance marks and measures as JSON-friendly entries', () => {
		markPerformance('open-start');
		markPerformance('shell-visible');
		measurePerformance('open-to-shell', 'open-start', 'shell-visible');

		expect(performanceSnapshot()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({name: 'open-start', type: 'mark'}),
				expect.objectContaining({name: 'shell-visible', type: 'mark'}),
				expect.objectContaining({name: 'open-to-shell', type: 'measure'})
			])
		);
	});
});
