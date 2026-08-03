import {PersistenceQuitCoordinator} from '../persistence-quit-coordinator';
import {RendererQuitQuiescence} from '../../../../util/renderer-quit-quiescence';

function deferred() {
	let reject: (error: Error) => void = () => {};
	let resolve: () => void = () => {};
	const promise = new Promise<void>((resolvePromise, rejectPromise) => {
		reject = rejectPromise;
		resolve = resolvePromise;
	});

	return {promise, reject, resolve};
}

describe('PersistenceQuitCoordinator', () => {
	it('drains work registered synchronously and while a drain is waiting', async () => {
		const coordinator = new PersistenceQuitCoordinator(
			new RendererQuitQuiescence()
		);
		const first = deferred();
		const second = deferred();
		const prepared = jest.fn();

		coordinator.track(first.promise);
		const preparation = coordinator.prepare('quit-1').then(prepared);
		coordinator.track(second.promise);

		expect(coordinator.state).toEqual({nonce: 'quit-1', phase: 'draining'});
		first.resolve();
		await Promise.resolve();
		expect(prepared).not.toHaveBeenCalled();
		second.resolve();
		await preparation;
		expect(coordinator.state).toEqual({nonce: 'quit-1', phase: 'prepared'});
	});

	it('remains frozen after a failed drain until the matching cancellation', async () => {
		const coordinator = new PersistenceQuitCoordinator(
			new RendererQuitQuiescence()
		);
		const pending = deferred();

		coordinator.track(pending.promise);
		const preparation = coordinator.prepare('quit-1');
		pending.reject(new Error('disk full'));

		await expect(preparation).rejects.toThrow('disk full');
		expect(coordinator.allowsPersistenceMutation()).toBe(false);
		expect(coordinator.cancel('stale-quit')).toBe(false);
		expect(coordinator.allowsPersistenceMutation()).toBe(false);
		expect(coordinator.cancel('quit-1')).toBe(true);
		expect(coordinator.state).toEqual({phase: 'open'});
	});

	it('supports a later quit after cancellation and rejects new prepared work', async () => {
		const coordinator = new PersistenceQuitCoordinator(
			new RendererQuitQuiescence()
		);

		await coordinator.prepare('quit-1');
		expect(() => coordinator.track(Promise.resolve())).toThrow(
			'Persistence is frozen'
		);
		coordinator.cancel('quit-1');
		await coordinator.prepare('quit-2');
		expect(coordinator.state).toEqual({nonce: 'quit-2', phase: 'prepared'});
	});

	it('includes participants registered while persistence is draining', async () => {
		const quiescence = new RendererQuitQuiescence();
		const coordinator = new PersistenceQuitCoordinator(quiescence);
		const persistence = deferred();
		const lateFlush = deferred();
		const lateWorkflow = deferred();
		const closeAdmission = jest.fn();
		const freezeAdmission = jest.fn();
		const prepared = jest.fn();

		coordinator.track(persistence.promise);
		const preparation = coordinator.prepare('quit-1').then(prepared);
		await Promise.resolve();
		quiescence.registerBuffer({
			closeAdmission,
			flush: () => lateFlush.promise,
			reopenAdmission: jest.fn()
		});
		quiescence.registerWorkflow({
			drain: () => lateWorkflow.promise,
			freezeAdmission,
			reopenAdmission: jest.fn()
		});

		expect(closeAdmission).toHaveBeenCalledTimes(1);
		expect(freezeAdmission).toHaveBeenCalledTimes(1);
		persistence.resolve();
		await Promise.resolve();
		expect(prepared).not.toHaveBeenCalled();
		lateFlush.resolve();
		await Promise.resolve();
		expect(prepared).not.toHaveBeenCalled();
		lateWorkflow.resolve();
		await preparation;
		expect(prepared).toHaveBeenCalledTimes(1);
	});

	it('surfaces a late quiescence failure that settles during persistence', async () => {
		const quiescence = new RendererQuitQuiescence();
		const coordinator = new PersistenceQuitCoordinator(quiescence);
		const persistence = deferred();
		const lateFailure = new Error('late workflow failed');

		coordinator.track(persistence.promise);
		const preparation = coordinator.prepare('quit-1');
		await Promise.resolve();
		quiescence.registerWorkflow({
			drain: () => Promise.reject(lateFailure),
			freezeAdmission: jest.fn(),
			reopenAdmission: jest.fn()
		});
		await Promise.resolve();
		persistence.resolve();

		await expect(preparation).rejects.toBe(lateFailure);
		expect(coordinator.cancel('quit-1')).toBe(true);
	});
});
