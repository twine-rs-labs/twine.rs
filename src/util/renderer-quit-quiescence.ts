export interface BufferedRendererMutation {
	closeAdmission(): void;
	flush(): Promise<unknown> | unknown;
	reopenAdmission(): void;
}

export interface RendererMutationWorkflow {
	drain(): Promise<void>;
	freezeAdmission(): void;
	reopenAdmission(): void;
}

interface DrainGeneration {
	cancel: () => void;
	cancelled: Promise<void>;
	failures: unknown[];
	flushedBuffers: Set<BufferedRendererMutation>;
	frozenWorkflows: Set<RendererMutationWorkflow>;
	pending: Set<Promise<void>>;
}

const drainCancelled = Symbol('renderer quit quiescence cancelled');

/** Coordinates renderer mutation owners without coupling them to Electron. */
export class RendererQuitQuiescence {
	private admittedDispatchDepth = 0;
	private buffers = new Set<BufferedRendererMutation>();
	private flushAdmissionDepth = 0;
	private generation?: DrainGeneration;
	private workflows = new Set<RendererMutationWorkflow>();

	get admittedDispatchActive() {
		return this.admittedDispatchDepth > 0;
	}

	get flushAdmissionActive() {
		return this.flushAdmissionDepth > 0;
	}

	get isDraining() {
		return !!this.generation;
	}

	get hasPendingWork() {
		return (
			(this.generation?.pending.size ?? 0) > 0 ||
			(this.generation?.failures.length ?? 0) > 0
		);
	}

	cancel() {
		const generation = this.generation;

		if (!generation) {
			return;
		}

		this.generation = undefined;
		generation.cancel();
		for (const buffer of this.buffers) {
			buffer.reopenAdmission();
		}
		for (const workflow of this.workflows) {
			workflow.reopenAdmission();
		}
	}

	async drain() {
		const generation = this.generation ?? this.beginDrain();

		while (this.generation === generation) {
			const pending = [...generation.pending];

			if (pending.length === 0) {
				if (generation.failures.length > 0) {
					throw generation.failures[0];
				}
				return;
			}

			const result = await Promise.race([
				Promise.all(pending).then(() => undefined),
				generation.cancelled.then(() => drainCancelled)
			]);

			if (result === drainCancelled || this.generation !== generation) {
				throw new Error('Renderer mutation quiescence was cancelled.');
			}
		}

		throw new Error('Renderer mutation quiescence was cancelled.');
	}

	registerBuffer(buffer: BufferedRendererMutation) {
		this.buffers.add(buffer);
		if (this.generation) {
			this.closeAndFlushBuffer(buffer, this.generation);
		}

		return () => {
			this.buffers.delete(buffer);
		};
	}

	registerWorkflow(workflow: RendererMutationWorkflow) {
		this.workflows.add(workflow);
		if (this.generation) {
			this.freezeAndDrainWorkflow(workflow, this.generation);
		}

		return () => {
			this.workflows.delete(workflow);
		};
	}

	runAdmittedDispatch<T>(callback: () => T): T {
		this.admittedDispatchDepth++;
		try {
			return callback();
		} finally {
			this.admittedDispatchDepth--;
		}
	}

	private beginDrain() {
		let cancel = () => {};
		const generation: DrainGeneration = {
			cancel,
			cancelled: new Promise<void>(resolve => {
				cancel = resolve;
			}),
			failures: [],
			flushedBuffers: new Set(),
			frozenWorkflows: new Set(),
			pending: new Set()
		};

		generation.cancel = cancel;
		this.generation = generation;

		const buffers = [...this.buffers];

		for (const buffer of buffers) {
			generation.flushedBuffers.add(buffer);
			this.captureFailure(generation, () => buffer.closeAdmission());
		}
		for (const buffer of buffers) {
			this.flushBuffer(buffer, generation);
		}

		const workflows = [...this.workflows];

		for (const workflow of workflows) {
			generation.frozenWorkflows.add(workflow);
			this.captureFailure(generation, () => workflow.freezeAdmission());
		}
		for (const workflow of workflows) {
			this.drainWorkflow(workflow, generation);
		}

		return generation;
	}

	private captureFailure(generation: DrainGeneration, callback: () => void) {
		try {
			callback();
		} catch (error) {
			generation.failures.push(error);
		}
	}

	private closeAndFlushBuffer(
		buffer: BufferedRendererMutation,
		generation: DrainGeneration
	) {
		if (generation.flushedBuffers.has(buffer)) {
			return;
		}

		generation.flushedBuffers.add(buffer);
		this.captureFailure(generation, () => buffer.closeAdmission());
		this.flushBuffer(buffer, generation);
	}

	private flushBuffer(
		buffer: BufferedRendererMutation,
		generation: DrainGeneration
	) {
		this.flushAdmissionDepth++;
		try {
			this.track(generation, buffer.flush());
		} catch (error) {
			generation.failures.push(error);
		} finally {
			this.flushAdmissionDepth--;
		}
	}

	private freezeAndDrainWorkflow(
		workflow: RendererMutationWorkflow,
		generation: DrainGeneration
	) {
		if (generation.frozenWorkflows.has(workflow)) {
			return;
		}

		generation.frozenWorkflows.add(workflow);
		this.captureFailure(generation, () => workflow.freezeAdmission());
		this.drainWorkflow(workflow, generation);
	}

	private drainWorkflow(
		workflow: RendererMutationWorkflow,
		generation: DrainGeneration
	) {
		try {
			this.track(generation, workflow.drain());
		} catch (error) {
			generation.failures.push(error);
		}
	}

	private track(
		generation: DrainGeneration,
		completion: Promise<unknown> | unknown
	) {
		const tracked = Promise.resolve(completion)
			.then(
				() => undefined,
				error => {
					generation.failures.push(error);
				}
			)
			.finally(() => generation.pending.delete(tracked));
		generation.pending.add(tracked);
	}
}

export const rendererQuitQuiescence = new RendererQuitQuiescence();
