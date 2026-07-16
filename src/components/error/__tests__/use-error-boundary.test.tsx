import {fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import {useErrorBoundary} from '../use-error-boundary';

const BadComponent = () => {
	throw new Error('mock-error');
};

describe('useErrorBoundary', () => {
	it('reports errors, renders fallback UI, and resets by retrying children', () => {
		const onCaughtError = jest.fn();
		const onDidCatch = jest.fn();

		const Harness = () => {
			const [shouldThrow, setShouldThrow] = React.useState(true);
			const {ErrorBoundary, didCatch, error, reset} = useErrorBoundary({
				onDidCatch
			});

			if (didCatch) {
				return (
					<>
						<span>{error?.message}</span>
						<button
							onClick={() => {
								setShouldThrow(false);
								reset();
							}}
						>
							Retry
						</button>
					</>
				);
			}

			return (
				<ErrorBoundary>
					{shouldThrow ? <BadComponent /> : <span>recovered</span>}
				</ErrorBoundary>
			);
		};

		render(<Harness />, {onCaughtError});
		expect(screen.getByText('mock-error')).toBeInTheDocument();
		expect(onDidCatch).toHaveBeenCalledWith(
			expect.objectContaining({message: 'mock-error'}),
			expect.objectContaining({componentStack: expect.any(String)})
		);
		expect(onCaughtError).toHaveBeenCalledWith(
			expect.objectContaining({message: 'mock-error'}),
			expect.objectContaining({componentStack: expect.any(String)})
		);

		fireEvent.click(screen.getByRole('button', {name: 'Retry'}));
		expect(screen.getByText('recovered')).toBeInTheDocument();
	});
});
