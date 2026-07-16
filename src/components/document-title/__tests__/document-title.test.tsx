import * as React from 'react';
import {act, render} from '@testing-library/react';
import {DocumentTitle} from '../document-title';

describe('<DocumentTitle>', () => {
	it('sets a branded document title', () => {
		const previousTitle = document.title;
		const {unmount} = render(<DocumentTitle title="mock-title" />);

		expect(document.title).toBe('mock-title - Twine RS');
		unmount();
		expect(document.title).toBe(previousTitle);
	});

	it('does not duplicate the app title', () => {
		render(<DocumentTitle title="Twine RS" />);
		expect(document.title).toBe('Twine RS');
	});

	it('retains the delayed Electron title update and cancels it on cleanup', () => {
		jest.useFakeTimers();
		const userAgent = jest
			.spyOn(window.navigator, 'userAgent', 'get')
			.mockReturnValue('Electron/41.10.2');
		const previousTitle = document.title;
		const {unmount} = render(<DocumentTitle title="Electron title" />);

		expect(document.title).toBe('Electron title - Twine RS');
		document.title = 'stale Electron title';
		act(() => jest.runOnlyPendingTimers());
		expect(document.title).toBe('Electron title - Twine RS');

		unmount();
		expect(document.title).toBe(previousTitle);
		userAgent.mockRestore();
		jest.useRealTimers();
	});
});
