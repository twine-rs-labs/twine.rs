import {
	RendererQuitQuiescence,
	rendererQuitQuiescence
} from '../../../util/renderer-quit-quiescence';

export type PersistenceQuitState =
	{phase: 'open'} | {nonce: string; phase: 'draining' | 'prepared'};

interface PersistenceDrainGeneration {
	cancel: () => void;
	cancelled: Promise<void>;
	failures: unknown[];
	nonce: string;
	observed: Set<Promise<void>>;
	pending: Set<Promise<void>>;
}

const persistenceDrainCancelled = Symbol('persistence drain cancelled');

/**
 * Renderer-owned persistence barrier used only during application shutdown.
 * Normal edits register their completion promise without crossing IPC.
 */
export class PersistenceQuitCoordinator {
	private readonly pending = new Set<Promise<void>>();
	private currentState: PersistenceQuitState = {phase: 'open'};
	private generation?: PersistenceDrainGeneration;

	constructor(
		private readonly quiescence: RendererQuitQuiescence = rendererQuitQuiescence
	) {}

	get state(): PersistenceQuitState {
		return this.currentState;
	}

	allowsPersistenceMutation() {
		return (
			this.currentState.phase === 'open' ||
			this.quiescence.admittedDispatchActive
		);
	}

	cancel(nonce: string) {
		if (
			this.currentState.phase !== 'open' &&
			this.currentState.nonce === nonce
		) {
			const generation = this.generation;

			this.currentState = {phase: 'open'};
			this.generation = undefined;
			generation?.cancel();
			this.quiescence.cancel();
			return true;
		}

		return false;
	}

	async prepare(nonce: string) {
		if (!nonce) {
			throw new Error('A persistence quit nonce is required.');
		}
		if (this.currentState.phase !== 'open') {
			if (
				this.currentState.nonce === nonce &&
				this.currentState.phase === 'prepared'
			) {
				return;
			}
			throw new Error('Renderer persistence is already preparing to quit.');
		}

		this.currentState = {nonce, phase: 'draining'};
		let cancel = () => {};
		const generation: PersistenceDrainGeneration = {
			cancel,
			cancelled: new Promise<void>(resolve => {
				cancel = resolve;
			}),
			failures: [],
			nonce,
			observed: new Set(),
			pending: new Set()
		};

		generation.cancel = cancel;
		this.generation = generation;
		for (const completion of this.pending) {
			this.observeForDrain(completion, generation);
		}

		while (this.isCurrentGeneration(generation)) {
			await this.quiescence.drain();
			const result = await Promise.race([
				Promise.all([...generation.pending]).then(() => undefined),
				generation.cancelled.then(() => persistenceDrainCancelled)
			]);

			if (result === persistenceDrainCancelled) {
				throw new Error('Renderer persistence quit preparation was cancelled.');
			}

			if (generation.failures.length > 0) {
				throw generation.failures[0];
			}
			if (!this.quiescence.hasPendingWork && generation.pending.size === 0) {
				break;
			}
		}

		if (
			this.currentState.phase !== 'draining' ||
			this.currentState.nonce !== nonce
		) {
			throw new Error('Renderer persistence quit preparation was cancelled.');
		}
		this.currentState = {nonce, phase: 'prepared'};
	}

	track<T>(completion: Promise<T>): Promise<T> {
		if (this.currentState.phase === 'prepared') {
			throw new Error('Persistence is frozen while the application exits.');
		}

		const tracked = Promise.resolve(completion).then(() => undefined);

		this.pending.add(tracked);
		if (this.generation && this.currentState.phase === 'draining') {
			this.observeForDrain(tracked, this.generation);
		}
		void tracked.then(
			() => this.pending.delete(tracked),
			() => this.pending.delete(tracked)
		);
		return completion;
	}

	private isCurrentGeneration(generation: PersistenceDrainGeneration) {
		return (
			this.generation === generation &&
			this.currentState.phase === 'draining' &&
			this.currentState.nonce === generation.nonce
		);
	}

	private observeForDrain(
		completion: Promise<void>,
		generation: PersistenceDrainGeneration
	) {
		if (generation.observed.has(completion)) {
			return;
		}

		generation.observed.add(completion);
		const observed = completion
			.then(
				() => undefined,
				error => {
					generation.failures.push(error);
				}
			)
			.finally(() => generation.pending.delete(observed));
		generation.pending.add(observed);
	}
}

export const persistenceQuitCoordinator = new PersistenceQuitCoordinator();

export function trackPersistence<T>(completion: Promise<T>) {
	return persistenceQuitCoordinator.track(completion);
}
