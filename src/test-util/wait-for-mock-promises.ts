import {act} from '@testing-library/react';

interface MockResult {
	type: 'incomplete' | 'return' | 'throw';
	value: unknown;
}

interface MockWithResults {
	mock: {
		results: MockResult[];
	};
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
	return (
		typeof value === 'object' &&
		value !== null &&
		'then' in value &&
		typeof value.then === 'function'
	);
}

/**
 * Waits for every promise the mock has returned at the synchronization point.
 */
export async function waitForMockPromises(mock: MockWithResults) {
	const results = mock.mock.results.slice();

	await act(async () => {
		await Promise.all(
			results.flatMap(result =>
				result.type === 'return' && isPromiseLike(result.value)
					? [result.value]
					: []
			)
		);
	});
}
