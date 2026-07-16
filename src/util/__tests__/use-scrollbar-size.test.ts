import {act, renderHook} from '@testing-library/react';
import {useScrollbarSize} from '../use-scrollbar-size';

describe('useScrollbarSize', () => {
	afterEach(() => {
		jest.restoreAllMocks();
		jest.useRealTimers();
	});

	it('measures scrollbars and debounces resize measurements', () => {
		jest.useFakeTimers();
		let offset = 20;
		let client = 15;
		jest
			.spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
			.mockImplementation(() => offset);
		jest
			.spyOn(HTMLElement.prototype, 'offsetWidth', 'get')
			.mockImplementation(() => offset);
		jest
			.spyOn(HTMLElement.prototype, 'clientHeight', 'get')
			.mockImplementation(() => client);
		jest
			.spyOn(HTMLElement.prototype, 'clientWidth', 'get')
			.mockImplementation(() => client);

		const {result, unmount} = renderHook(() => useScrollbarSize(50));

		expect(result.current).toEqual({height: 5, width: 5});
		offset = 30;
		client = 10;
		act(() => {
			window.dispatchEvent(new Event('resize'));
			window.dispatchEvent(new Event('resize'));
			jest.advanceTimersByTime(49);
		});
		expect(result.current).toEqual({height: 5, width: 5});
		act(() => jest.advanceTimersByTime(1));
		expect(result.current).toEqual({height: 20, width: 20});

		unmount();
		expect(
			document.querySelector('[aria-hidden="true"][style*="overflow"]')
		).toBeNull();
	});
});
