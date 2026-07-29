import {WasmCoreWorkerClient, wasmQueryKey} from '../wasm/twine-wasm-client';
import type {
	WasmWorkerMetricBase,
	WasmWorkerRequest,
	WasmWorkerSuccess
} from '../wasm/twine-wasm-protocol';
import {
	performanceEventSnapshot,
	resetRendererPerformance
} from '../../util/performance';

type TestableWasmCoreWorkerClient = {
	send(request: WasmWorkerRequest): Promise<WasmWorkerSuccess>;
};

const workerMetrics: WasmWorkerMetricBase = {
	computeFinishedAtEpochMs: 0,
	computeMs: 0,
	computeStartedAtEpochMs: 0,
	payloadBytes: 0,
	requestBytes: 0,
	responseBytes: 0,
	workerReceivedAt: 0,
	workerReceivedAtEpochMs: 0,
	workerRespondedAt: 0,
	workerRespondedAtEpochMs: 0
};

function successfulResponse(request: WasmWorkerRequest): WasmWorkerSuccess {
	switch (request.kind) {
		case 'acknowledgeSaved':
			return {
				id: request.id,
				kind: request.kind,
				metrics: workerMetrics,
				ok: true,
				result: {
					batch: {
						label: 'Acknowledge saved',
						patches: [],
						transactionId: 1n
					},
					revision: request.revision,
					status: {
						canRedo: false,
						canUndo: false,
						dirty: false,
						redoKind: null,
						revision: request.revision,
						undoKind: null
					}
				}
			} as WasmWorkerSuccess;
		case 'queryDocumentPage':
			return {
				id: request.id,
				kind: request.kind,
				metrics: workerMetrics,
				ok: true,
				result: {
					documents: [
						{
							kind: 'passage',
							passageId: `${request.sessionId}-${request.options.cursor}`,
							text: 'document body '.repeat(512)
						}
					],
					nextCursor: null,
					revision: request.revision,
					storyId: request.storyId,
					totalCount: 101
				}
			} as WasmWorkerSuccess;
		case 'queryStoryWordCount':
			return {
				id: request.id,
				kind: request.kind,
				metrics: workerMetrics,
				ok: true,
				result: request.sessionId === 'session-a' ? 17 : 29
			} as WasmWorkerSuccess;
		default:
			throw new Error(`Unexpected request in test: ${request.kind}`);
	}
}

describe('WasmCoreWorkerClient', () => {
	it('uses stable cache keys for semantically identical query objects', () => {
		expect(wasmQueryKey('story', {b: 2, a: 1})).toBe(
			wasmQueryKey('story', {a: 1, b: 2})
		);
	});

	it('stays disabled under Jest so tests use deterministic JS fallback', () => {
		const client = new WasmCoreWorkerClient();

		expect(client.enabled).toBe(false);
		expect(client.mode).toBe('unavailable');
		expect(client.performanceDiagnostics()).toEqual({
			cachedPayloadBytes: 0,
			graphCacheEntryCount: 0,
			indexCacheEntryCount: 0,
			lastGraphEntryCount: 0,
			wasmMemoryBytes: 0,
			pendingRequestCount: 0,
			readModelCacheEntryCount: 0,
			readModel: undefined,
			readySessionCount: 0,
			sessionQueueCount: 0
		});
	});

	it('does not retain document enumeration pages in the client cache', async () => {
		const client = new WasmCoreWorkerClient();
		const send = jest.fn(async (request: WasmWorkerRequest) =>
			successfulResponse(request)
		);
		const performanceWindow = window as Window & {
			twinePerformanceNative?: object;
		};

		(client as unknown as TestableWasmCoreWorkerClient).send = send;
		performanceWindow.twinePerformanceNative = {};
		resetRendererPerformance();

		try {
			for (const [sessionId, storyId] of [
				['session-a', 'story-a'],
				['session-b', 'story-b']
			]) {
				await client.queryStoryWordCount(sessionId, storyId, 1);
				await client.queryStoryWordCount(sessionId, storyId, 1);

				for (let index = 0; index < 101; index++) {
					await client.queryDocumentPage(
						sessionId,
						storyId,
						{cursor: `cursor-${index}`, limit: 500},
						1
					);
				}

				await client.acknowledgeSaved(sessionId, 1);
				await client.queryStoryWordCount(sessionId, storyId, 1);

				for (let index = 0; index < 101; index++) {
					await client.queryDocumentPage(
						sessionId,
						storyId,
						{cursor: `cursor-${index}`, limit: 500},
						1
					);
				}
			}

			const diagnostics = client.performanceDiagnostics();
			const requests = send.mock.calls.map(([request]) => request);
			const readEvents = performanceEventSnapshot().filter(
				event => event.name === 'core-read-model-query'
			);
			const documentEvents = readEvents.filter(
				event => event.detail?.kind === 'queryDocumentPage'
			);
			const wordCountEvents = readEvents.filter(
				event => event.detail?.kind === 'queryStoryWordCount'
			);

			expect(
				requests.filter(request => request.kind === 'queryDocumentPage')
			).toHaveLength(404);
			expect(
				requests.filter(request => request.kind === 'queryStoryWordCount')
			).toHaveLength(2);
			expect(
				requests.filter(request => request.kind === 'acknowledgeSaved')
			).toHaveLength(2);
			expect(diagnostics.readModelCacheEntryCount).toBe(2);
			expect(diagnostics.cachedPayloadBytes).toBe(8);
			expect(documentEvents).toHaveLength(404);
			expect(
				documentEvents.every(event => event.detail?.cacheState === 'worker')
			).toBe(true);
			expect(
				wordCountEvents.filter(event => event.detail?.cacheState === 'client')
			).toHaveLength(4);
		} finally {
			resetRendererPerformance();
			delete performanceWindow.twinePerformanceNative;
		}
	});
});
