import * as React from 'react';

interface ErrorRenderProps {
	error: Error;
}

interface BoundaryWrapperProps extends React.PropsWithChildren {
	render?: () => React.ReactNode;
	renderError?: (props: ErrorRenderProps) => React.ReactNode;
}

interface ClassErrorBoundaryProps extends BoundaryWrapperProps {
	onDidCatch: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ClassErrorBoundaryState {
	didCatch: boolean;
	error: Error | null;
}

class ClassErrorBoundary extends React.PureComponent<
	ClassErrorBoundaryProps,
	ClassErrorBoundaryState
> {
	state: ClassErrorBoundaryState = {didCatch: false, error: null};

	static getDerivedStateFromError(error: Error): ClassErrorBoundaryState {
		return {didCatch: true, error};
	}

	componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
		this.props.onDidCatch(error, errorInfo);
	}

	render() {
		const {children, render, renderError} = this.props;
		const {didCatch, error} = this.state;

		if (didCatch) {
			return error && renderError ? renderError({error}) : null;
		}

		return render ? render() : children;
	}
}

interface ErrorBoundaryState {
	didCatch: boolean;
	error: Error | null;
}

type ErrorBoundaryAction = {error: Error; type: 'catch'} | {type: 'reset'};

function errorBoundaryReducer(
	state: ErrorBoundaryState,
	action: ErrorBoundaryAction
): ErrorBoundaryState {
	if (action.type === 'catch') {
		return {didCatch: true, error: action.error};
	}

	return {didCatch: false, error: null};
}

export interface UseErrorBoundaryOptions {
	onDidCatch?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

/**
 * Locally owns a class error boundary and exposes the previous hook contract.
 * Reset replaces the class component type so retrying remounts its children.
 */
export function useErrorBoundary(options?: UseErrorBoundaryOptions) {
	const [state, dispatch] = React.useReducer(errorBoundaryReducer, {
		didCatch: false,
		error: null
	});
	const optionsRef = React.useRef(options);
	const boundaryRef =
		React.useRef<React.ComponentType<BoundaryWrapperProps> | null>(null);
	optionsRef.current = options;

	const createBoundary = React.useCallback(() => {
		const Boundary: React.FC<BoundaryWrapperProps> = props => (
			<ClassErrorBoundary
				{...props}
				onDidCatch={(error, errorInfo) => {
					dispatch({error, type: 'catch'});
					optionsRef.current?.onDidCatch?.(error, errorInfo);
				}}
			/>
		);

		Boundary.displayName = 'LocalErrorBoundary';
		return Boundary;
	}, []);

	if (!boundaryRef.current) {
		boundaryRef.current = createBoundary();
	}

	const reset = React.useCallback(() => {
		boundaryRef.current = createBoundary();
		dispatch({type: 'reset'});
	}, [createBoundary]);

	return {
		ErrorBoundary: boundaryRef.current,
		didCatch: state.didCatch,
		error: state.error,
		reset
	};
}
