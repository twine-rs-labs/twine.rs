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

	it('requires both the registered buffer identity and revision to match a snapshot', () => {
		const coordinator = new WorkbenchBufferCoordinator();
		let revision = 1;
		const first = {
			bufferId: 'passage:start',
			flush: jest.fn(),
			hasPendingChanges: () => false,
			revision: () => revision,
			storyId: 'first'
		};
		const unregister = coordinator.register(first);
		const snapshot = coordinator.captureSnapshot('first', 'passage:start');

		expect(
			coordinator.isSnapshotCurrent('first', 'passage:start', snapshot)
		).toBe(true);
		unregister();
		coordinator.register({...first, revision: () => revision});
		expect(
			coordinator.isSnapshotCurrent('first', 'passage:start', snapshot)
		).toBe(false);
		expect(coordinator.isSnapshotRevisionCurrent(snapshot)).toBe(true);
		revision++;
		expect(coordinator.isSnapshotRevisionCurrent(snapshot)).toBe(false);
	});

	it('closes admission, captures stable buffers, and reopens on release', async () => {
		const coordinator = new WorkbenchBufferCoordinator();
		const closeAdmission = jest.fn();
		const reopenAdmission = jest.fn();
		coordinator.register({
			bufferId: 'passage:start',
			closeAdmission,
			flush: jest.fn(),
			hasPendingChanges: () => false,
			reopenAdmission,
			revision: () => 4,
			storyId: 'first'
		});

		const barrier = await coordinator.acquireStoryMutationBarrier('first');
		expect(closeAdmission).toHaveBeenCalledTimes(1);
		expect([...barrier.snapshots.values()][0]?.revision).toBe(4);
		expect(barrier.preconditions).toEqual([
			expect.objectContaining({
				bufferId: 'passage:start',
				generation: 4
			})
		]);
		barrier.release();
		expect(reopenAdmission).toHaveBeenCalledTimes(1);
	});

	it('retains duplicate editors for one source as distinct registrations', async () => {
		const coordinator = new WorkbenchBufferCoordinator();
		for (const revision of [3, 8]) {
			coordinator.register({
				bufferId: 'passage:start',
				closeAdmission: jest.fn(),
				flush: jest.fn(),
				hasPendingChanges: () => false,
				reopenAdmission: jest.fn(),
				revision: () => revision,
				storyId: 'first'
			});
		}

		const barrier = await coordinator.acquireStoryMutationBarrier('first');
		expect(barrier.snapshots.size).toBe(2);
		expect(barrier.preconditions.map(value => value.bufferId)).toEqual([
			'passage:start',
			'passage:start'
		]);
		expect(
			new Set(barrier.preconditions.map(value => value.registrationId)).size
		).toBe(2);
		barrier.release();
	});

	it('delivers a receipt to every current duplicate but not an unmounted registration', async () => {
		const coordinator = new WorkbenchBufferCoordinator();
		const first = jest.fn(() => true);
		const second = jest.fn(() => true);
		const unregister = coordinator.register({
			applyRefactorTextEdits: first,
			bufferId: 'passage:start',
			flush: jest.fn(),
			hasPendingChanges: () => false,
			revision: () => 1,
			storyId: 'first',
			sourceId: 'start',
			sourceKind: 'passage'
		});
		coordinator.register({
			applyRefactorTextEdits: second,
			bufferId: 'passage:start',
			flush: jest.fn(),
			hasPendingChanges: () => false,
			revision: () => 1,
			storyId: 'first',
			sourceId: 'start',
			sourceKind: 'passage'
		});
		const barrier = await coordinator.acquireStoryMutationBarrier('first');
		unregister();
		barrier.deliverTextEdits(
			{sourceId: 'start', sourceKind: 'passage', storyId: 'first'},
			[{end: 2, expectedText: 'a', replacementText: 'b', start: 1}]
		);
		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledWith([
			{end: 2, expectedText: 'a', replacementText: 'b', start: 1}
		]);
		barrier.release();
	});

	it('routes duplicate passage IDs by canonical story and source identity', async () => {
		const coordinator = new WorkbenchBufferCoordinator();
		const firstStory = jest.fn(() => true);
		const duplicateInFirstStory = jest.fn(() => true);
		const wrongStory = jest.fn(() => true);
		for (const applyRefactorTextEdits of [firstStory, duplicateInFirstStory]) {
			coordinator.register({
				applyRefactorTextEdits,
				bufferId: 'passage:start',
				flush: jest.fn(),
				hasPendingChanges: () => false,
				revision: () => 1,
				storyId: 'first',
				sourceId: 'start',
				sourceKind: 'passage'
			});
		}
		coordinator.register({
			applyRefactorTextEdits: wrongStory,
			bufferId: 'passage:start',
			flush: jest.fn(),
			hasPendingChanges: () => false,
			revision: () => 1,
			storyId: 'second',
			sourceId: 'start',
			sourceKind: 'passage'
		});
		const barrier = await coordinator.acquireStoriesMutationBarrier([
			'first',
			'second'
		]);
		expect(
			barrier.deliverTextEdits(
				{sourceId: 'start', sourceKind: 'passage', storyId: 'first'},
				[{end: 2, expectedText: 'a', replacementText: 'b', start: 1}]
			)
		).toBe('delivered');
		expect(firstStory).toHaveBeenCalledTimes(1);
		expect(duplicateInFirstStory).toHaveBeenCalledTimes(1);
		expect(wrongStory).not.toHaveBeenCalled();
		barrier.release();
	});

	it('closes and flushes a registration added during barrier acquisition', async () => {
		const coordinator = new WorkbenchBufferCoordinator();
		const firstFlush = deferred<void>();
		coordinator.register({
			bufferId: 'passage:first',
			closeAdmission: jest.fn(),
			flush: () => firstFlush.promise,
			hasPendingChanges: () => false,
			reopenAdmission: jest.fn(),
			revision: () => 1,
			storyId: 'first'
		});
		const pendingBarrier = coordinator.acquireStoryMutationBarrier('first');
		await Promise.resolve();
		const secondClose = jest.fn();
		const secondFlush = jest.fn();
		coordinator.register({
			bufferId: 'passage:second',
			closeAdmission: secondClose,
			flush: secondFlush,
			hasPendingChanges: () => false,
			reopenAdmission: jest.fn(),
			revision: () => 2,
			storyId: 'first'
		});
		firstFlush.resolve();

		const barrier = await pendingBarrier;
		expect(secondClose).toHaveBeenCalledTimes(1);
		expect(secondFlush).toHaveBeenCalledTimes(1);
		expect(barrier.snapshots.size).toBe(2);
		barrier.release();
	});

	it('does not reopen an editor that unregisters while its flush is pending', async () => {
		const coordinator = new WorkbenchBufferCoordinator();
		const flush = deferred<void>();
		const reopenAdmission = jest.fn();
		const unregister = coordinator.register({
			bufferId: 'passage:start',
			closeAdmission: jest.fn(),
			flush: () => flush.promise,
			hasPendingChanges: () => false,
			reopenAdmission,
			revision: () => 1,
			storyId: 'first'
		});
		const pendingBarrier = coordinator.acquireStoryMutationBarrier('first');
		await Promise.resolve();
		unregister();
		flush.resolve();

		const barrier = await pendingBarrier;
		expect(barrier.snapshots.size).toBe(0);
		barrier.release();
		expect(reopenAdmission).not.toHaveBeenCalled();
	});

	it('reopens admission after a failed flush and permits a retry', async () => {
		const coordinator = new WorkbenchBufferCoordinator();
		const reopenAdmission = jest.fn();
		const flush = jest
			.fn<Promise<void>, []>()
			.mockRejectedValueOnce(new Error('composition active'))
			.mockResolvedValue(undefined);
		coordinator.register({
			bufferId: 'passage:start',
			closeAdmission: jest.fn(),
			flush,
			hasPendingChanges: () => false,
			reopenAdmission,
			revision: () => 1,
			storyId: 'first'
		});

		await expect(
			coordinator.acquireStoryMutationBarrier('first')
		).rejects.toThrow('composition active');
		expect(reopenAdmission).toHaveBeenCalledTimes(1);
		const barrier = await coordinator.acquireStoryMutationBarrier('first');
		barrier.release();
		expect(reopenAdmission).toHaveBeenCalledTimes(2);
	});

	it('rejects a composing duplicate before flushing and reopens both admissions', async () => {
		const coordinator = new WorkbenchBufferCoordinator();
		const flush = jest.fn();
		const reopen = jest.fn();
		for (const composing of [false, true]) {
			coordinator.register({
				bufferId: 'passage:start',
				closeAdmission: jest.fn(),
				flush,
				hasPendingChanges: () => false,
				isComposing: () => composing,
				reopenAdmission: reopen,
				revision: () => 1,
				storyId: 'first'
			});
		}

		await expect(
			coordinator.acquireStoryMutationBarrier('first')
		).rejects.toMatchObject({
			code: 'buffer-composing'
		});
		expect(flush).not.toHaveBeenCalled();
		expect(reopen).toHaveBeenCalledTimes(2);
	});

	it('serializes barriers for the same story until release', async () => {
		const coordinator = new WorkbenchBufferCoordinator();
		coordinator.register({
			bufferId: 'passage:start',
			closeAdmission: jest.fn(),
			flush: jest.fn(),
			hasPendingChanges: () => false,
			reopenAdmission: jest.fn(),
			revision: () => 1,
			storyId: 'first'
		});
		const first = await coordinator.acquireStoryMutationBarrier('first');
		let secondResolved = false;
		const secondPromise = coordinator
			.acquireStoryMutationBarrier('first')
			.then(barrier => {
				secondResolved = true;
				return barrier;
			});
		await Promise.resolve();
		expect(secondResolved).toBe(false);
		first.release();
		const second = await secondPromise;
		expect(secondResolved).toBe(true);
		second.release();
	});
});
