import * as React from 'react';

export interface ThunkDispatch<State, Action> {
	<Result>(thunk: Thunk<State, Action, Result>): Result;
	(action: Action): void;
	(action: Action | Thunk<State, Action>): void;
}

export type Thunk<State, Action, Result = void> = (
	dispatch: ThunkDispatch<State, Action>,
	getState: () => State
) => Result;

export default function useThunkReducer<State, Action, InitialArg = State>(
	reducer: React.Reducer<State, Action>,
	initialArg: InitialArg,
	initializer?: (initialArg: InitialArg) => State
): [State, ThunkDispatch<State, Action>] {
	const [state, setState] = React.useState<State>(() =>
		initializer ? initializer(initialArg) : (initialArg as unknown as State)
	);
	const stateRef = React.useRef(state);

	const dispatch = React.useCallback(
		(action: Action | Thunk<State, Action, unknown>) => {
			if (typeof action === 'function') {
				return (action as Thunk<State, Action, unknown>)(
					dispatch,
					() => stateRef.current
				);
			}

			const nextState = reducer(stateRef.current, action);
			stateRef.current = nextState;
			setState(nextState);
		},
		[reducer]
	) as ThunkDispatch<State, Action>;

	return [state, dispatch];
}
