import {NativeProjectDeltaQueue} from '../native-project-delta-queue';

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(next => {
		resolve = next;
	});

	return {promise, resolve};
}

describe('NativeProjectDeltaQueue', () => {
	it('serializes deltas for the same root and deduplicates IDs', async () => {
		const first = deferred<'continue'>();
		const processed: string[] = [];
		const queue = new NativeProjectDeltaQueue(async delta => {
			processed.push(delta.id);
			return delta.id === 'a' ? first.promise : 'continue';
		}, jest.fn());

		queue.enqueue({id: 'a', rootPath: '/one'});
		queue.enqueue({id: 'a', rootPath: '/one'});
		queue.enqueue({id: 'b', rootPath: '/one'});
		await Promise.resolve();
		expect(processed).toEqual(['a']);

		first.resolve('continue');
		await first.promise;
		await Promise.resolve();
		expect(processed).toEqual(['a', 'b']);
	});

	it('processes different roots independently', async () => {
		const first = deferred<'continue'>();
		const processed: string[] = [];
		const queue = new NativeProjectDeltaQueue(async delta => {
			processed.push(delta.id);
			return delta.id === 'a' ? first.promise : 'continue';
		}, jest.fn());

		queue.enqueue({id: 'a', rootPath: '/one'});
		queue.enqueue({id: 'b', rootPath: '/two'});
		await Promise.resolve();
		expect(processed).toEqual(['a', 'b']);

		first.resolve('continue');
	});

	it('pauses a root for review and resumes queued work', async () => {
		const processed: string[] = [];
		const queue = new NativeProjectDeltaQueue(async delta => {
			processed.push(delta.id);
			return delta.id === 'a' ? 'pause' : 'continue';
		}, jest.fn());

		queue.enqueue({id: 'a', rootPath: '/one'});
		queue.enqueue({id: 'b', rootPath: '/one'});
		await Promise.resolve();
		await Promise.resolve();
		expect(processed).toEqual(['a']);

		queue.resume('/one');
		await Promise.resolve();
		await Promise.resolve();
		expect(processed).toEqual(['a', 'b']);
	});

	it('pauses and reports processing failures', async () => {
		const error = new Error('failed');
		const onError = jest.fn();
		const queue = new NativeProjectDeltaQueue(async () => {
			throw error;
		}, onError);
		const delta = {id: 'a', rootPath: '/one'};

		queue.enqueue(delta);
		await Promise.resolve();
		await Promise.resolve();
		expect(onError).toHaveBeenCalledWith(error, delta);
	});
});
