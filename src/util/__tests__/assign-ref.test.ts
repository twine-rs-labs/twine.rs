import * as React from 'react';
import {assignRef} from '../assign-ref';

describe('assignRef', () => {
	it('returns callback ref cleanup functions', () => {
		const cleanup = jest.fn();
		const ref: React.RefCallback<HTMLDivElement> = jest.fn(() => cleanup);
		const element = document.createElement('div');

		expect(assignRef(ref, element)).toBe(cleanup);
		expect(ref).toHaveBeenCalledWith(element);
	});

	it('assigns object refs and returns no cleanup', () => {
		const ref = React.createRef<HTMLDivElement>();
		const element = document.createElement('div');

		expect(assignRef(ref, element)).toBeUndefined();
		expect(ref.current).toBe(element);
		expect(assignRef(ref, null)).toBeUndefined();
		expect(ref.current).toBeNull();
	});
});
