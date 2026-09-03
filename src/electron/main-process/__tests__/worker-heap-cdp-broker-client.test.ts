import {
	sampleWorkerHeapCdpFromBroker,
	workerHeapCdpCommandTimeoutMs
} from '../worker-heap-cdp-broker-client';

describe('sampleWorkerHeapCdpFromBroker', () => {
	const originalFetch = global.fetch;
	const originalUrl = process.env.TWINE_PERF_WORKER_HEAP_BROKER_URL;
	const originalToken = process.env.TWINE_PERF_WORKER_HEAP_BROKER_TOKEN;

	afterEach(() => {
		global.fetch = originalFetch;
		if (originalUrl === undefined)
			delete process.env.TWINE_PERF_WORKER_HEAP_BROKER_URL;
		else process.env.TWINE_PERF_WORKER_HEAP_BROKER_URL = originalUrl;
		if (originalToken === undefined)
			delete process.env.TWINE_PERF_WORKER_HEAP_BROKER_TOKEN;
		else process.env.TWINE_PERF_WORKER_HEAP_BROKER_TOKEN = originalToken;
	});

	it('uses only the configured loopback endpoint and bearer token', async () => {
		process.env.TWINE_PERF_WORKER_HEAP_BROKER_URL =
			'http://127.0.0.1:4567/worker-heap';
		process.env.TWINE_PERF_WORKER_HEAP_BROKER_TOKEN = 'a'.repeat(64);
		global.fetch = jest.fn(async () => ({
			json: async () => ({
				sampledAtEpochMs: 1,
				targetId: 'worker',
				targetUrl: 'file:///worker.js',
				totalSize: 2,
				usedSize: 1
			}),
			ok: true,
			status: 200
		})) as unknown as typeof fetch;

		await expect(sampleWorkerHeapCdpFromBroker()).resolves.toMatchObject({
			targetId: 'worker',
			usedSize: 1
		});
		expect(global.fetch).toHaveBeenCalledWith(
			'http://127.0.0.1:4567/worker-heap',
			expect.objectContaining({
				headers: {authorization: `Bearer ${'a'.repeat(64)}`},
				method: 'POST'
			})
		);
	});

	it('rejects non-loopback configuration and bounds a hung broker request', async () => {
		process.env.TWINE_PERF_WORKER_HEAP_BROKER_URL =
			'http://localhost:4567/worker-heap';
		process.env.TWINE_PERF_WORKER_HEAP_BROKER_TOKEN = 'a'.repeat(64);
		await expect(sampleWorkerHeapCdpFromBroker()).rejects.toThrow('127.0.0.1');

		jest.useFakeTimers();
		process.env.TWINE_PERF_WORKER_HEAP_BROKER_URL =
			'http://127.0.0.1:4567/worker-heap';
		global.fetch = jest.fn(
			(_url: string, init?: RequestInit) =>
				new Promise((_resolve, reject) =>
					init?.signal?.addEventListener('abort', () =>
						reject(new DOMException('aborted', 'AbortError'))
					)
				)
		) as typeof fetch;
		try {
			const sampled = sampleWorkerHeapCdpFromBroker();
			const rejection = expect(sampled).rejects.toThrow('timed out');
			await jest.advanceTimersByTimeAsync(workerHeapCdpCommandTimeoutMs);
			await rejection;
		} finally {
			jest.useRealTimers();
		}
	});
});
