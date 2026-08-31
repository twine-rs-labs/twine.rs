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

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(resolvePromise => {
		resolve = resolvePromise;
	});

	return {promise, resolve};
}

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
		case 'finishProjectBootstrap':
			return {
				id: request.id,
				kind: request.kind,
				metrics: workerMetrics,
				ok: true,
				result: {
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
		case 'queryPassageDocument':
			return {
				id: request.id,
				kind: request.kind,
				metrics: workerMetrics,
				ok: true,
				result: {
					passageId: request.passageId,
					revision: request.revision,
					storyId: request.storyId,
					text: 'passage body '.repeat(512)
				}
			} as WasmWorkerSuccess;
		case 'querySourceDocument':
			return {
				id: request.id,
				kind: request.kind,
				metrics: workerMetrics,
				ok: true,
				result: {
					kind: request.sourceKind,
					revision: request.revision,
					storyId: request.storyId,
					text: `${request.sourceKind} body `.repeat(512)
				}
			} as WasmWorkerSuccess;
		case 'queryPassageReferencesPage':
			return {
				id: request.id,
				kind: request.kind,
				metrics: workerMetrics,
				ok: true,
				result: {
					coverage: 'standard-links-only',
					nextCursor: null,
					passageId: request.passageId,
					references: [],
					revision: request.revision,
					storyId: request.storyId,
					totalCount: 0
				}
			} as WasmWorkerSuccess;
		case 'queryDefinition':
			return {
				id: request.id,
				kind: request.kind,
				metrics: workerMetrics,
				ok: true,
				result: {type: 'not_found'}
			} as WasmWorkerSuccess;
		case 'queryStoryWordCount':
			return {
				id: request.id,
				kind: request.kind,
				metrics: workerMetrics,
				ok: true,
				result: request.sessionId === 'session-a' ? 17 : 29
			} as WasmWorkerSuccess;
		case 'queryDiagnosticsSummary':
			return {
				id: request.id,
				kind: request.kind,
				metrics: workerMetrics,
				ok: true,
				result: {
					diagnosticCount: Math.max(0, 3 - request.options.dismissedIds.length),
					dismissedCount: request.options.dismissedIds.length,
					errorCount: request.options.dismissedIds.length > 0 ? 0 : 1,
					infoCount: 1,
					revision: request.revision,
					storyId: request.storyId,
					warningCount: 1
				}
			} as WasmWorkerSuccess;
		case 'queryRefactorPlanDetail':
			return {
				id: request.id,
				kind: request.kind,
				metrics: workerMetrics,
				ok: true,
				result: {
					page: {changes: [], nextCursor: null},
					type: 'page'
				}
			} as WasmWorkerSuccess;
		case 'applyRefactorPlan':
			return {
				id: request.id,
				kind: request.kind,
				metrics: workerMetrics,
				ok: true,
				result: {
					failure: {code: 'buffer-changed', message: 'Buffer changed.'},
					revision: request.revision,
					type: 'failure'
				}
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
			wasmMemoryBytes: undefined,
			pendingRequestCount: 0,
			readModelCacheEntryCount: 0,
			readModel: undefined,
			readySessionCount: 0,
			sessionQueueCount: 0,
			workerJsHeapUsedBytes: undefined,
			workerMemoryObservation: undefined
		});
	});

	it('routes reference and definition queries through typed worker requests', async () => {
		const client = new WasmCoreWorkerClient();
		const send = jest.fn(async (request: WasmWorkerRequest) =>
			successfulResponse(request)
		);
		(client as unknown as TestableWasmCoreWorkerClient).send = send;

		await expect(
			client.queryPassageReferencesPage(
				'session-a',
				'story-a',
				'passage-a',
				{cursor: null, limit: 50},
				7
			)
		).resolves.toEqual(
			expect.objectContaining({
				passageId: 'passage-a',
				revision: 7,
				storyId: 'story-a'
			})
		);
		await expect(
			client.queryDefinition(
				'session-a',
				{
					expectedRevision: 7,
					name: 'Start',
					storyId: 'story-a',
					symbolKind: 'passage'
				},
				7
			)
		).resolves.toEqual({type: 'not_found'});
		expect(send).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				kind: 'queryPassageReferencesPage',
				passageId: 'passage-a',
				storyId: 'story-a'
			})
		);
		expect(send).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				kind: 'queryDefinition',
				query: expect.objectContaining({expectedRevision: 7, name: 'Start'})
			})
		);
	});

	it('retains one response WASM tuple without requiring worker performance.memory', () => {
		const client = new WasmCoreWorkerClient();
		const record = (
			client as unknown as {
				recordMetric(
					response: WasmWorkerSuccess,
					requestedAt: number,
					requestedAtEpochMs: number
				): void;
			}
		).recordMetric.bind(client);
		const response = (metrics: WasmWorkerMetricBase) =>
			({
				id: 1,
				kind: 'status',
				metrics,
				ok: true,
				result: {
					canRedo: false,
					canUndo: false,
					dirty: false,
					redoKind: null,
					revision: 1,
					undoKind: null
				}
			}) as WasmWorkerSuccess;

		record(
			response({
				...workerMetrics,
				wasmMemoryBytes: 200,
				workerJsHeapUsedBytes: 100
			}),
			0,
			0
		);
		expect(client.performanceDiagnostics().workerMemoryObservation).toEqual({
			wasmMemoryBytes: 200,
			workerJsHeapUsedBytes: 100,
			workerRespondedAtEpochMs: 0
		});

		// A later response is valid when it has a fresh WASM timestamp even if
		// Chromium omitted the worker-only non-standard heap field.
		record(response({...workerMetrics, wasmMemoryBytes: 300}), 0, 0);
		expect(client.performanceDiagnostics().workerMemoryObservation).toEqual({
			wasmMemoryBytes: 300,
			workerJsHeapUsedBytes: undefined,
			workerRespondedAtEpochMs: 0
		});
	});

	it('reports an apply response metric once before settling only the opted-in request', async () => {
		const client = new WasmCoreWorkerClient();
		const postMessage = jest.fn();
		(client as unknown as {disabledReason: undefined}).disabledReason =
			undefined;
		(client as unknown as {worker: {postMessage: typeof postMessage}}).worker =
			{
				postMessage
			};
		const onWorkerMetric = jest.fn();
		let settled = false;
		const apply = client
			.applyRefactorPlan(
				'session-a',
				{
					expectedProjectRevision: 4,
					planId: 'plan-1',
					selection: {type: 'all'}
				},
				3,
				4,
				{onWorkerMetric}
			)
			.then(result => {
				settled = true;
				return result;
			});

		await Promise.resolve();
		const request = postMessage.mock.calls[0][0] as WasmWorkerRequest;
		const response = successfulResponse(request) as WasmWorkerSuccess;
		response.metrics = {
			...workerMetrics,
			wasmMemoryBytes: 456,
			workerRespondedAtEpochMs: 123
		};
		(
			client as unknown as {
				handleResponse(response: WasmWorkerSuccess): void;
			}
		).handleResponse(response);

		expect(onWorkerMetric).toHaveBeenCalledTimes(1);
		expect(onWorkerMetric).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: 'applyRefactorPlan',
				wasmMemoryBytes: 456,
				workerRespondedAtEpochMs: 123
			})
		);
		expect(settled).toBe(false);
		await apply;
		expect(settled).toBe(true);

		const normalApply = client.applyRefactorPlan(
			'session-a',
			{
				expectedProjectRevision: 4,
				planId: 'plan-2',
				selection: {type: 'all'}
			},
			3,
			4
		);
		await Promise.resolve();
		expect(
			[
				...(
					client as unknown as {pending: Map<number, unknown>}
				).pending.values()
			][0]
		).toEqual(expect.not.objectContaining({onWorkerMetric: expect.anything()}));
		const normalRequest = postMessage.mock.calls[1][0] as WasmWorkerRequest;
		(
			client as unknown as {
				handleResponse(response: WasmWorkerSuccess): void;
			}
		).handleResponse(successfulResponse(normalRequest));
		await normalApply;
		expect(onWorkerMetric).toHaveBeenCalledTimes(1);
	});

	it('does not clear read-model diagnostics for metric-only worker responses', () => {
		const client = new WasmCoreWorkerClient();
		const record = (
			client as unknown as {
				recordMetric(
					response: WasmWorkerSuccess,
					requestedAt: number,
					requestedAtEpochMs: number
				): void;
			}
		).recordMetric.bind(client);
		const response = (metrics: WasmWorkerMetricBase) =>
			({
				id: 1,
				kind: 'status',
				metrics,
				ok: true,
				result: {
					canRedo: false,
					canUndo: false,
					dirty: false,
					redoKind: null,
					revision: 1,
					undoKind: null
				}
			}) as WasmWorkerSuccess;
		const readModel = {
			analysisCacheSourceCount: 0,
			backlinkCacheBytes: 0,
			backlinkCacheEntryCount: 0,
			backlinkCacheHitCount: 0,
			backlinkScanCount: 0,
			backlinkScannedSourceCount: 0,
			fingerprintEntryCount: 0,
			graphCacheStoryCount: 0,
			historyBytes: 0,
			parsedSourceCount: 0,
			passageCount: 0,
			projectDocumentBytes: 0,
			refactorPlanningTaskBytes: 0,
			refactorPlanningTaskCount: 0,
			refactorPlanStoreBytes: 0,
			refactorPlanStoreEntryCount: 0,
			refactorPlanStoreFingerprint: 'empty',
			readModelCacheStoryCount: 0,
			readModelFullBuildCount: 0,
			readModelIncrementalUpdateCount: 0,
			readModelLastTouchedSourceCount: 0,
			redoEntryCount: 0,
			undoEntryCount: 0
		};
		record(response({...workerMetrics, readModel}), 0, 0);
		record(response(workerMetrics), 0, 0);
		expect(client.performanceDiagnostics().readModel).toEqual(readModel);
	});

	it('gates and releases the protocol-mediated worker JS probe', async () => {
		const client = new WasmCoreWorkerClient();
		const send = jest.fn(async (request: WasmWorkerRequest) => {
			if (request.kind !== 'performanceProbeWorkerJs') {
				throw new Error(`Unexpected request: ${request.kind}`);
			}

			return {
				id: request.id,
				kind: 'performanceProbeWorkerJs',
				metrics: {
					...workerMetrics,
					wasmMemoryBytes: 64,
					workerJsHeapUsedBytes: request.action === 'retain' ? 1024 : 32
				},
				ok: true,
				result:
					request.action === 'retain'
						? {allocatedBytes: request.bytes ?? 0, retained: true}
						: {allocatedBytes: 0, retained: false}
			} as WasmWorkerSuccess;
		});

		(client as unknown as TestableWasmCoreWorkerClient).send = send;
		await expect(client.performanceProbeWorkerJs('retain')).rejects.toThrow(
			'TWINE_PERF'
		);

		(
			window as Window & {twinePerformanceNative?: object}
		).twinePerformanceNative = {};
		try {
			await expect(
				client.performanceProbeWorkerJs('retain', 2048)
			).resolves.toEqual({allocatedBytes: 2048, retained: true});
			await expect(client.performanceProbeWorkerJs('release')).resolves.toEqual(
				{
					allocatedBytes: 0,
					retained: false
				}
			);
			expect(
				send.mock.calls.map(
					([request]) =>
						(
							request as Extract<
								WasmWorkerRequest,
								{kind: 'performanceProbeWorkerJs'}
							>
						).action
				)
			).toEqual(['retain', 'release']);
		} finally {
			delete (window as Window & {twinePerformanceNative?: object})
				.twinePerformanceNative;
		}
	});

	it('forwards only plan identity, selection, and trusted runtime state', async () => {
		const client = new WasmCoreWorkerClient();
		const send = jest.fn(async (request: WasmWorkerRequest) =>
			successfulResponse(request)
		);
		(client as unknown as TestableWasmCoreWorkerClient).send = send;
		const cursor = {
			planDigest: 'digest',
			planId: 'plan-1',
			position: 0
		};

		await expect(
			client.queryRefactorPlanDetail('session-a', cursor, 4)
		).resolves.toEqual({
			page: {changes: [], nextCursor: null},
			type: 'page'
		});
		await expect(
			client.applyRefactorPlan(
				'session-a',
				{
					expectedProjectRevision: 4,
					planId: 'plan-1',
					selection: {type: 'all'}
				},
				1,
				4
			)
		).resolves.toMatchObject({
			failure: {code: 'buffer-changed'},
			revision: 4,
			type: 'failure'
		});
		expect(send.mock.calls.map(([request]) => request.kind)).toEqual([
			'queryRefactorPlanDetail',
			'applyRefactorPlan'
		]);
		expect(send.mock.calls[1][0]).not.toHaveProperty('changes');
		expect(send.mock.calls[1][0]).not.toHaveProperty('runtime');
	});

	it('rejects a one-byte-over UTF-8 rename request before posting to the worker', async () => {
		const client = new WasmCoreWorkerClient();
		const send = jest.fn();
		(client as unknown as TestableWasmCoreWorkerClient).send = send;

		await expect(
			client.beginPassageRenamePlan(
				'session-a',
				{afterName: '😀'.repeat(16_383) + 'abc', passageId: 'p', storyId: 's'},
				1,
				1
			)
		).resolves.toMatchObject({
			failure: {code: 'plan-too-large'},
			type: 'failure'
		});
		expect(send).not.toHaveBeenCalled();
	});

	it('posts a UTF-8 request at the exact planner string limit', async () => {
		const client = new WasmCoreWorkerClient();
		const send = jest.fn(
			async (request: WasmWorkerRequest) =>
				({
					id: request.id,
					kind: 'beginPassageRenamePlan',
					metrics: workerMetrics,
					ok: true,
					result: {task: {taskId: 'task-1'}, type: 'begun'}
				}) as WasmWorkerSuccess
		);
		(client as unknown as TestableWasmCoreWorkerClient).send = send;

		await expect(
			client.beginPassageRenamePlan(
				'session-a',
				{afterName: '😀'.repeat(16_383) + 'ab', passageId: 'p', storyId: 's'},
				1,
				1
			)
		).resolves.toMatchObject({type: 'begun'});
		expect(send).toHaveBeenCalledTimes(1);
	});

	it('posts project-replace planner lifecycle requests without executable edits', async () => {
		const client = new WasmCoreWorkerClient();
		const send = jest.fn(async (request: WasmWorkerRequest) => {
			const result =
				request.kind === 'beginProjectReplacePlan'
					? {task: {taskId: 'replace-task'}, type: 'begun'}
					: request.kind === 'continueProjectReplacePlan'
						? {
								progress: {scannedPassageCount: 128, totalPassageCount: 256},
								task: {taskId: 'replace-task'},
								type: 'pending'
							}
						: {cancelled: true};
			return {
				id: request.id,
				kind: request.kind,
				metrics: workerMetrics,
				ok: true,
				result
			} as WasmWorkerSuccess;
		});
		(client as unknown as TestableWasmCoreWorkerClient).send = send;
		const request = {
			includePassageNames: false,
			includePassageText: true,
			includeScript: true,
			includeStylesheet: false,
			matchCase: true,
			query: 'before',
			replacement: 'after',
			storyId: 'story',
			useRegexes: false
		};
		const task = {taskId: 'replace-task'};

		await expect(
			client.beginProjectReplacePlan('session-a', request, 2, 4)
		).resolves.toMatchObject({type: 'begun'});
		await expect(
			client.continueProjectReplacePlan('session-a', task)
		).resolves.toMatchObject({type: 'pending'});
		await expect(
			client.cancelProjectReplacePlan('session-a', task)
		).resolves.toBe(true);
		expect(send.mock.calls.map(([posted]) => posted.kind)).toEqual([
			'beginProjectReplacePlan',
			'continueProjectReplacePlan',
			'cancelProjectReplacePlan'
		]);
		expect(send.mock.calls[0][0]).not.toHaveProperty('changes');
	});

	it('retains only the latest diagnostics summary dismissal-set cache entry', async () => {
		const client = new WasmCoreWorkerClient();
		const send = jest.fn(async (request: WasmWorkerRequest) =>
			successfulResponse(request)
		);

		(client as unknown as TestableWasmCoreWorkerClient).send = send;

		await expect(
			client.queryDiagnosticsSummary(
				'session-a',
				'story-a',
				{dismissedIds: []},
				1
			)
		).resolves.toMatchObject({diagnosticCount: 3, dismissedCount: 0});
		await client.queryDiagnosticsSummary(
			'session-a',
			'story-a',
			{dismissedIds: []},
			1
		);
		const latestDismissedIds = Array.from(
			{length: 24},
			(_value, index) => `dismissed-${index}`
		);

		for (let count = 2; count <= latestDismissedIds.length; count += 1) {
			await client.queryDiagnosticsSummary(
				'session-a',
				'story-a',
				{dismissedIds: latestDismissedIds.slice(0, count)},
				1
			);
		}

		expect(client.performanceDiagnostics().readModelCacheEntryCount).toBe(1);
		const queryCount = send.mock.calls.length;
		await client.queryDiagnosticsSummary(
			'session-a',
			'story-a',
			{dismissedIds: latestDismissedIds},
			1
		);
		expect(send).toHaveBeenCalledTimes(queryCount);
		await expect(
			client.queryDiagnosticsSummary(
				'session-b',
				'story-b',
				{dismissedIds: []},
				1
			)
		).resolves.toMatchObject({diagnosticCount: 3, dismissedCount: 0});

		expect(client.performanceDiagnostics().readModelCacheEntryCount).toBe(2);
	});

	it('retains summary cache ownership when a query waits for a mutation', async () => {
		const client = new WasmCoreWorkerClient();
		const mutationResponse = deferred<WasmWorkerSuccess>();
		let mutationRequest: WasmWorkerRequest | undefined;
		const send = jest.fn(async (request: WasmWorkerRequest) => {
			if (request.kind === 'finishProjectBootstrap') {
				mutationRequest = request;
				return mutationResponse.promise;
			}

			return successfulResponse(request);
		});

		(client as unknown as TestableWasmCoreWorkerClient).send = send;
		const mutation = client.finishProjectBootstrap('session-a', 2);
		const queuedSummary = client.queryDiagnosticsSummary(
			'session-a',
			'story-a',
			{dismissedIds: []},
			2
		);

		await Promise.resolve();
		expect(mutationRequest).toBeDefined();
		mutationResponse.resolve(successfulResponse(mutationRequest!));
		await mutation;
		await queuedSummary;
		await client.queryDiagnosticsSummary(
			'session-a',
			'story-a',
			{dismissedIds: ['dismissed']},
			2
		);

		expect(client.performanceDiagnostics().readModelCacheEntryCount).toBe(1);
	});

	it('does not retain full-source documents in the client cache', async () => {
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

				for (let index = 0; index < 40; index++) {
					await client.queryPassageDocument(
						sessionId,
						storyId,
						`passage-${index}`,
						1
					);
				}
				await client.queryPassageDocument(sessionId, storyId, 'passage-0', 1);
				await client.querySourceDocument(sessionId, storyId, 'script', 1);
				await client.querySourceDocument(sessionId, storyId, 'stylesheet', 1);

				await client.acknowledgeSaved(sessionId, 1);
				await client.queryStoryWordCount(sessionId, storyId, 1);
				await client.queryPassageDocument(sessionId, storyId, 'passage-0', 1);
				await client.querySourceDocument(sessionId, storyId, 'script', 1);
				await client.querySourceDocument(sessionId, storyId, 'stylesheet', 1);

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
			const passageDocumentEvents = readEvents.filter(
				event => event.detail?.kind === 'queryPassageDocument'
			);
			const sourceDocumentEvents = readEvents.filter(
				event => event.detail?.kind === 'querySourceDocument'
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
				requests.filter(request => request.kind === 'queryPassageDocument')
			).toHaveLength(84);
			expect(
				requests.filter(request => request.kind === 'querySourceDocument')
			).toHaveLength(8);
			expect(
				requests.filter(request => request.kind === 'acknowledgeSaved')
			).toHaveLength(2);
			expect(diagnostics.readModelCacheEntryCount).toBe(2);
			expect(diagnostics.cachedPayloadBytes).toBe(8);
			expect(documentEvents).toHaveLength(404);
			expect(
				documentEvents.every(event => event.detail?.cacheState === 'worker')
			).toBe(true);
			expect(passageDocumentEvents).toHaveLength(84);
			expect(
				passageDocumentEvents.every(
					event => event.detail?.cacheState === 'worker'
				)
			).toBe(true);
			expect(sourceDocumentEvents).toHaveLength(8);
			expect(
				sourceDocumentEvents.every(
					event => event.detail?.cacheState === 'worker'
				)
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
