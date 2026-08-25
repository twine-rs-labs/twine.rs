import {
	backgroundWindowForE2E,
	shouldFocusOwnerWindow,
	showWindowWhenReady
} from '../window-activation';

jest.mock('../performance-harness', () => ({
	performanceHarnessEnabled: () => process.env.TWINE_PERF === '1'
}));

describe('window activation', () => {
	const previousBackground = process.env.TWINE_E2E_BACKGROUND_WINDOW;
	const previousPerformance = process.env.TWINE_PERF;

	afterEach(() => {
		if (previousBackground === undefined) {
			delete process.env.TWINE_E2E_BACKGROUND_WINDOW;
		} else {
			process.env.TWINE_E2E_BACKGROUND_WINDOW = previousBackground;
		}
		if (previousPerformance === undefined) {
			delete process.env.TWINE_PERF;
		} else {
			process.env.TWINE_PERF = previousPerformance;
		}
	});

	it.each([undefined, '', '0', 'true'])(
		'uses normal activation unless TWINE_E2E_BACKGROUND_WINDOW is exactly 1 (%p)',
		value => {
			delete process.env.TWINE_PERF;
			if (value === undefined) {
				delete process.env.TWINE_E2E_BACKGROUND_WINDOW;
			} else {
				process.env.TWINE_E2E_BACKGROUND_WINDOW = value;
			}
			const window = {show: jest.fn()};

			showWindowWhenReady(window);

			expect(backgroundWindowForE2E()).toBe(false);
			expect(shouldFocusOwnerWindow()).toBe(true);
			expect(window.show).toHaveBeenCalledTimes(1);
		}
	);

	it('preserves normal activation for the lone background flag', () => {
		process.env.TWINE_E2E_BACKGROUND_WINDOW = '1';
		delete process.env.TWINE_PERF;
		const window = {show: jest.fn()};

		showWindowWhenReady(window);

		expect(backgroundWindowForE2E()).toBe(false);
		expect(shouldFocusOwnerWindow()).toBe(true);
		expect(window.show).toHaveBeenCalledTimes(1);
	});

	it('keeps windows hidden and suppresses owner focus for the exact E2E opt-in', () => {
		process.env.TWINE_E2E_BACKGROUND_WINDOW = '1';
		process.env.TWINE_PERF = '1';
		const window = {show: jest.fn()};

		showWindowWhenReady(window);

		expect(backgroundWindowForE2E()).toBe(true);
		expect(shouldFocusOwnerWindow()).toBe(false);
		expect(window.show).not.toHaveBeenCalled();
	});
});
