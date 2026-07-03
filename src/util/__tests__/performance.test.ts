import {
	markPerformance,
	measurePerformance,
	performanceEventSnapshot,
	performanceSnapshot,
	recordPerformanceHarnessEvent,
	resetRendererPerformance
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
				now: jest.fn(() => entries.length),
				clearMarks: jest.fn(() => {
					entries = entries.filter(entry => entry.entryType !== 'mark');
				}),
				clearMeasures: jest.fn(() => {
					entries = entries.filter(entry => entry.entryType !== 'measure');
				}),
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
		delete (window as any).twinePerformanceNative;
		resetRendererPerformance();
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

	it('records harness events only when the perf-only native bridge exists', () => {
		recordPerformanceHarnessEvent('disabled');
		expect(performanceEventSnapshot()).toEqual([]);

		(window as any).twinePerformanceNative = {};
		recordPerformanceHarnessEvent('enabled', {revision: 2});

		expect(performanceEventSnapshot()).toEqual([
			expect.objectContaining({
				detail: {revision: 2},
				epochTime: expect.any(Number),
				name: 'enabled'
			})
		]);
		resetRendererPerformance();
		expect(performanceEventSnapshot()).toEqual([]);
	});
});
