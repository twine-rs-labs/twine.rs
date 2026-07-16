import {createPopper, Modifier, Placement, State} from '@popperjs/core';
import {act, renderHook} from '@testing-library/react';
import {usePopper, UsePopperOptions} from '../use-popper';

jest.mock('@popperjs/core', () => ({createPopper: jest.fn()}));

const createPopperMock = createPopper as jest.MockedFunction<
	typeof createPopper
>;

describe('usePopper', () => {
	it('adapts Popper styles and attributes and destroys its instance', () => {
		const reference = document.createElement('button');
		const popper = document.createElement('div');
		const arrow = document.createElement('div');
		const destroy = jest.fn();
		const forceUpdate = jest.fn();
		const setOptions = jest.fn(() => Promise.resolve({}));
		const update = jest.fn(() => Promise.resolve({}));
		let options: UsePopperOptions | undefined;
		createPopperMock.mockImplementation((reference, popper, nextOptions) => {
			options = nextOptions;
			return {destroy, forceUpdate, setOptions, update} as any;
		});
		const hookOptions: UsePopperOptions = {
			modifiers: [{name: 'arrow', options: {element: arrow}}, {name: 'flip'}],
			placement: 'bottom',
			strategy: 'fixed'
		};
		const {rerender, result, unmount} = renderHook(() =>
			usePopper(reference, popper, hookOptions)
		);
		rerender();
		expect(createPopperMock).toHaveBeenCalledTimes(1);
		const updateState = options?.modifiers?.find(
			modifier => modifier.name === 'updateState'
		) as Modifier<'updateState', Record<string, never>>;

		act(() => {
			updateState.fn({
				state: {
					attributes: {popper: {'data-popper-placement': 'bottom'}},
					elements: {arrow, popper, reference},
					styles: {
						arrow: {left: '2px'},
						popper: {position: 'fixed', transform: 'translate(1px, 2px)'}
					}
				} as unknown as State
			} as any);
		});

		expect(result.current.styles.popper).toEqual({
			position: 'fixed',
			transform: 'translate(1px, 2px)'
		});
		expect(result.current.styles.arrow).toEqual({left: '2px'});
		expect(result.current.attributes.popper).toEqual({
			'data-popper-placement': 'bottom'
		});
		expect(options?.modifiers?.map(modifier => modifier.name)).toEqual([
			'arrow',
			'flip',
			'applyStyles',
			'updateState'
		]);

		unmount();
		expect(destroy).toHaveBeenCalledTimes(1);
	});

	it('does not recreate or update for omitted options', () => {
		const reference = document.createElement('button');
		const popper = document.createElement('div');
		const destroy = jest.fn();
		const setOptions = jest.fn(() => Promise.resolve({}));
		createPopperMock.mockReturnValue({destroy, setOptions} as any);
		const {rerender, unmount} = renderHook(
			({renderCount}) => {
				void renderCount;
				return usePopper(reference, popper);
			},
			{initialProps: {renderCount: 0}}
		);

		rerender({renderCount: 1});

		expect(createPopperMock).toHaveBeenCalledTimes(1);
		expect(setOptions).not.toHaveBeenCalled();
		unmount();
		expect(destroy).toHaveBeenCalledTimes(1);
	});

	it('does not update for semantically equivalent inline options', () => {
		const reference = document.createElement('button');
		const popper = document.createElement('div');
		const setOptions = jest.fn(() => Promise.resolve({}));
		createPopperMock.mockReturnValue({
			destroy: jest.fn(),
			setOptions
		} as any);
		const {rerender} = renderHook(
			({renderCount}) => {
				void renderCount;
				return usePopper(reference, popper, {
					modifiers: [{name: 'flip'}],
					placement: 'bottom',
					strategy: 'fixed'
				});
			},
			{initialProps: {renderCount: 0}}
		);

		rerender({renderCount: 1});

		expect(createPopperMock).toHaveBeenCalledTimes(1);
		expect(setOptions).not.toHaveBeenCalled();
	});

	it('updates the existing instance when options change', () => {
		const reference = document.createElement('button');
		const popper = document.createElement('div');
		const destroy = jest.fn();
		const setOptions = jest.fn(() => Promise.resolve({}));
		createPopperMock.mockReturnValue({destroy, setOptions} as any);
		const {rerender, unmount} = renderHook(
			({placement}: {placement: Placement}) =>
				usePopper(reference, popper, {
					modifiers: [{name: 'flip'}],
					placement,
					strategy: 'fixed'
				}),
			{initialProps: {placement: 'bottom'}}
		);

		rerender({placement: 'top'});

		expect(createPopperMock).toHaveBeenCalledTimes(1);
		expect(setOptions).toHaveBeenCalledTimes(1);
		expect(setOptions).toHaveBeenCalledWith(
			expect.objectContaining({placement: 'top'})
		);
		unmount();
		expect(destroy).toHaveBeenCalledTimes(1);
	});
});
