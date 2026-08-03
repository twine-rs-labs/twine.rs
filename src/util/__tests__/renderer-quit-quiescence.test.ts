import {RendererQuitQuiescence} from '../renderer-quit-quiescence';

function deferred() {
	let reject: (error: Error) => void = () => {};
	let resolve: () => void = () => {};
	const promise = new Promise<void>((resolvePromise, rejectPromise) => {
		reject = rejectPromise;
		resolve = resolvePromise;
	});

	return {promise, reject, resolve};
}

describe('RendererQuitQuiescence', () => {
	it('closes buffers, enqueues flushes, then freezes and drains workflows', async () => {
		const quiescence = new RendererQuitQuiescence();
		const order: string[] = [];
		let finishFlush: () => void = () => {};

		quiescence.registerBuffer({
			closeAdmission: () => order.push('buffer-close'),
			flush: () => {
				order.push(
					quiescence.flushAdmissionActive ? 'buffer-flush-admitted' : 'bad'
				);
				return new Promise<void>(resolve => {
					finishFlush = resolve;
				});
			},
			reopenAdmission: () => order.push('buffer-reopen')
		});
		quiescence.registerWorkflow({
			drain: async () => {
				order.push('workflow-drain');
			},
			freezeAdmission: () => order.push('workflow-freeze'),
			reopenAdmission: () => order.push('workflow-reopen')
		});

		const draining = quiescence.drain();

		expect(order).toEqual([
			'buffer-close',
			'buffer-flush-admitted',
			'workflow-freeze',
			'workflow-drain'
		]);
		finishFlush();
		await draining;
		quiescence.cancel();
		expect(order.slice(-2)).toEqual(['buffer-reopen', 'workflow-reopen']);
	});

	it('exposes admitted dispatch permits only for the callback duration', () => {
		const quiescence = new RendererQuitQuiescence();

		expect(quiescence.admittedDispatchActive).toBe(false);
		quiescence.runAdmittedDispatch(() => {
			expect(quiescence.admittedDispatchActive).toBe(true);
		});
		expect(quiescence.admittedDispatchActive).toBe(false);
	});

	it('immediately admits late participants to the active drain and retains their failures', async () => {
		const quiescence = new RendererQuitQuiescence();
		const initialFlush = deferred();
		const lateWorkflow = deferred();
		const order: string[] = [];
		const lateFailure = new Error('late buffer failed');

		quiescence.registerBuffer({
			closeAdmission: jest.fn(),
			flush: () => initialFlush.promise,
			reopenAdmission: jest.fn()
		});
		const draining = quiescence.drain();

		expect(quiescence.isDraining).toBe(true);
		quiescence.registerBuffer({
			closeAdmission: () => order.push('late-buffer-close'),
			flush: () => {
				order.push('late-buffer-flush');
				return Promise.reject(lateFailure);
			},
			reopenAdmission: jest.fn()
		});
		quiescence.registerWorkflow({
			drain: () => {
				order.push('late-workflow-drain');
				return lateWorkflow.promise;
			},
			freezeAdmission: () => order.push('late-workflow-freeze'),
			reopenAdmission: jest.fn()
		});

		expect(order).toEqual([
			'late-buffer-close',
			'late-buffer-flush',
			'late-workflow-freeze',
			'late-workflow-drain'
		]);
		initialFlush.resolve();
		await Promise.resolve();
		expect(quiescence.hasPendingWork).toBe(true);
		lateWorkflow.resolve();
		await expect(draining).rejects.toBe(lateFailure);
		quiescence.cancel();
	});

	it('does not let cancelled generation callbacks contaminate a retry', async () => {
		const quiescence = new RendererQuitQuiescence();
		const firstFlush = deferred();
		const flush = jest
			.fn<Promise<void>, []>()
			.mockReturnValueOnce(firstFlush.promise)
			.mockResolvedValue(undefined);

		quiescence.registerBuffer({
			closeAdmission: jest.fn(),
			flush,
			reopenAdmission: jest.fn()
		});
		const cancelledDrain = quiescence.drain();

		quiescence.cancel();
		await expect(cancelledDrain).rejects.toThrow('was cancelled');
		await expect(quiescence.drain()).resolves.toBeUndefined();
		firstFlush.reject(new Error('stale failure'));
		await Promise.resolve();
		await expect(quiescence.drain()).resolves.toBeUndefined();
		expect(flush).toHaveBeenCalledTimes(2);
		quiescence.cancel();
	});
});
