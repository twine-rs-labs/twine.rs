import {act, render, renderHook, screen} from '@testing-library/react';
import * as React from 'react';
import useThunkReducer, {Thunk, ThunkDispatch} from '../use-thunk-reducer';

interface State {
	count: number;
}

type Action = {amount: number; type: 'add'};

const reducer = (state: State, action: Action): State => ({
	count: state.count + action.amount
});

describe('useThunkReducer', () => {
	it('updates getState synchronously and supports nested thunks', () => {
		const {result} = renderHook(() => useThunkReducer(reducer, {count: 0}));
		const seen: number[] = [];
		const nested: Thunk<State, Action> = (dispatch, getState) => {
			seen.push(getState().count);
			dispatch({amount: 2, type: 'add'});
			seen.push(getState().count);
		};

		act(() => {
			result.current[1]((dispatch, getState) => {
				seen.push(getState().count);
				dispatch({amount: 1, type: 'add'});
				seen.push(getState().count);
				dispatch(nested);
				seen.push(getState().count);
			});
		});

		expect(seen).toEqual([0, 1, 1, 3, 3]);
		expect(result.current[0]).toEqual({count: 3});
	});

	it('uses the initializer exactly once', () => {
		const initializer = jest.fn((count: number) => ({count}));
		const {rerender, result} = renderHook(() =>
			useThunkReducer(reducer, 4, initializer)
		);

		rerender();

		expect(initializer).toHaveBeenCalledTimes(1);
		expect(result.current[0]).toEqual({count: 4});
	});

	it('runs the reducer exactly once per plain action', () => {
		const countedReducer = jest.fn(reducer);
		const {result} = renderHook(() =>
			useThunkReducer(countedReducer, {count: 0})
		);

		act(() => result.current[1]({amount: 1, type: 'add'}));

		expect(countedReducer).toHaveBeenCalledTimes(1);
		expect(result.current[0]).toEqual({count: 1});
	});

	it('returns synchronous thunk values and promises', async () => {
		const {result} = renderHook(() => useThunkReducer(reducer, {count: 0}));
		const promise = Promise.resolve('async result');

		expect(result.current[1](() => 'sync result')).toBe('sync result');
		expect(result.current[1](() => promise)).toBe(promise);
		await expect(promise).resolves.toBe('async result');
	});

	it('commits reducer replacements without losing sequential state', () => {
		const firstReducer = (state: State, action: Action) =>
			reducer(state, action);
		const secondReducer = (state: State, action: Action) => ({
			count: state.count + action.amount * 10
		});
		const {rerender, result} = renderHook(
			({currentReducer}) => useThunkReducer(currentReducer, {count: 0}),
			{initialProps: {currentReducer: firstReducer}}
		);

		act(() => result.current[1]({amount: 1, type: 'add'}));
		rerender({currentReducer: secondReducer});
		const seen: number[] = [];
		act(() => {
			result.current[1]((dispatch, getState) => {
				dispatch({amount: 1, type: 'add'});
				seen.push(getState().count);
				dispatch({amount: 2, type: 'add'});
				seen.push(getState().count);
			});
		});

		expect(seen).toEqual([11, 31]);
		expect(result.current[0]).toEqual({count: 31});
	});

	it('uses a replacement reducer when a child layout effect dispatches', () => {
		const firstReducer = (state: State, action: Action) =>
			reducer(state, action);
		const secondReducer = (state: State, action: Action) => ({
			count: state.count + action.amount * 10
		});
		const DispatchingChild: React.FC<{
			dispatch: ThunkDispatch<State, Action>;
		}> = ({dispatch}) => {
			React.useLayoutEffect(() => {
				dispatch({amount: 1, type: 'add'});
			}, [dispatch]);

			return null;
		};
		const TestComponent: React.FC<{
			currentReducer: React.Reducer<State, Action>;
		}> = ({currentReducer}) => {
			const [state, dispatch] = useThunkReducer(currentReducer, {count: 0});

			return React.createElement(
				React.Fragment,
				null,
				React.createElement('output', null, state.count),
				React.createElement(DispatchingChild, {dispatch})
			);
		};
		const {rerender} = render(
			React.createElement(TestComponent, {currentReducer: firstReducer})
		);

		expect(screen.getByText('1')).toBeInTheDocument();
		rerender(
			React.createElement(TestComponent, {currentReducer: secondReducer})
		);
		expect(screen.getByText('11')).toBeInTheDocument();
	});
});
