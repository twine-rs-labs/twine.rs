import type {StoryPersistenceResult} from './use-persistence';

interface PendingPersistenceCompletion {
	reject: (error: Error) => void;
	resolve: () => void;
}

let tokenSequence = 0;
const pendingCompletions = new Map<string, PendingPersistenceCompletion>();

export function createPersistenceCompletion() {
	const token = `core-persistence-${++tokenSequence}`;
	let reject!: (error: Error) => void;
	let resolve!: () => void;
	const completion = new Promise<void>((resolvePromise, rejectPromise) => {
		reject = rejectPromise;
		resolve = resolvePromise;
	});

	// The exact Core caller attaches its await after dispatch returns. Keep an
	// early synchronous persistence failure from becoming an unhandled rejection.
	void completion.catch(() => undefined);
	pendingCompletions.set(token, {reject, resolve});
	return {completion, token};
}

function pendingCompletion(token: string) {
	const pending = pendingCompletions.get(token);

	if (!pending) {
		throw new Error(`Unknown Core persistence completion token "${token}".`);
	}
	pendingCompletions.delete(token);
	return pending;
}

export function bindPersistenceCompletion(
	token: string,
	persistence: boolean | StoryPersistenceResult
) {
	const pending = pendingCompletion(token);

	if (typeof persistence === 'boolean') {
		if (persistence) {
			pending.resolve();
		} else {
			pending.reject(
				new Error('The Core mutation did not schedule project persistence.')
			);
		}
		return;
	}
	if (!persistence.persisted) {
		pending.reject(
			new Error('The Core mutation did not schedule project persistence.')
		);
		return;
	}
	void persistence.completion.then(pending.resolve, error =>
		pending.reject(error instanceof Error ? error : new Error(String(error)))
	);
}

export function rejectPersistenceCompletion(token: string, error: unknown) {
	pendingCompletion(token).reject(
		error instanceof Error ? error : new Error(String(error))
	);
}
