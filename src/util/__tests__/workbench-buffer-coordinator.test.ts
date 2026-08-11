import {WorkbenchBufferCoordinator} from '../workbench-buffer-coordinator';

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});

	return {promise, reject, resolve};
}

describe('WorkbenchBufferCoordinator', () => {
	it('flushes only buffers for the requested story', async () => {
		const coordinator = new WorkbenchBufferCoordinator();
		const firstFlush = jest.fn();
		const secondFlush = jest.fn();

		coordinator.register({
			bufferId: 'passage:first',
			flush: firstFlush,
			hasPendingChanges: () => false,
			revision: () => 0,
			storyId: 'first'
		});
		coordinator.register({
			bufferId: 'passage:second',
			flush: secondFlush,
			hasPendingChanges: () => false,
			revision: () => 0,
			storyId: 'second'
		});

		await coordinator.flushStory('first');

		expect(firstFlush).toHaveBeenCalledTimes(1);
		expect(secondFlush).not.toHaveBeenCalled();
	});

	it('flushes again when an edit arrives during a pending commit', async () => {
		const coordinator = new WorkbenchBufferCoordinator();
		const firstCommit = deferred<void>();
		let pending = true;
		let revision = 1;
		const flush = jest
			.fn<Promise<void>, []>()
			.mockImplementationOnce(async () => {
				pending = false;
				await firstCommit.promise;
			})
			.mockImplementationOnce(async () => {
				pending = false;
			});

		coordinator.register({
			bufferId: 'passage:first',
			flush,
			hasPendingChanges: () => pending,
			revision: () => revision,
			storyId: 'first'
		});

		const completion = coordinator.flushStory('first');

		await Promise.resolve();
		revision++;
		pending = true;
		firstCommit.resolve();
		await completion;

		expect(flush).toHaveBeenCalledTimes(2);
	});

	it('retains failed buffers and succeeds when a later flush is retried', async () => {
		const coordinator = new WorkbenchBufferCoordinator();
		const error = new Error('save failed');
		let pending = true;
		const flush = jest
			.fn<Promise<void>, []>()
			.mockRejectedValueOnce(error)
			.mockImplementationOnce(async () => {
				pending = false;
			});

		coordinator.register({
			bufferId: 'script',
			flush,
			hasPendingChanges: () => pending,
			revision: () => 1,
			storyId: 'first'
		});

		await expect(coordinator.flushAll()).rejects.toBe(error);
		await expect(coordinator.flushAll()).resolves.toBeUndefined();
		expect(flush).toHaveBeenCalledTimes(2);
	});

	it('reports pending changes only for the requested story', () => {
		const coordinator = new WorkbenchBufferCoordinator();

		coordinator.register({
			bufferId: 'passage:first',
			flush: jest.fn(),
			hasPendingChanges: () => true,
			revision: () => 1,
			storyId: 'first'
		});
		coordinator.register({
			bufferId: 'passage:second',
			flush: jest.fn(),
			hasPendingChanges: () => false,
			revision: () => 0,
			storyId: 'second'
		});

		expect(coordinator.hasPendingChanges()).toBe(true);
		expect(coordinator.hasPendingChanges('first')).toBe(true);
		expect(coordinator.hasPendingChanges('second')).toBe(false);
	});
});
