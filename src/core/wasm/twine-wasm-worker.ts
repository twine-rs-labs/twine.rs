import type {
	WasmWorkerMetricBase,
	WasmWorkerRequest,
	WasmWorkerResponse
} from './twine-wasm-protocol';
import type {TwineWasmProjectSession as TwineWasmProjectSessionType} from './pkg/twine_wasm';
import type {TwineWasmProjectBootstrap as TwineWasmProjectBootstrapType} from './pkg/twine_wasm';
import {
	isPassageRenameRequestTooLarge,
	isProjectReplaceRequestTooLarge
} from '../refactor-limits';

let wasmReady: Promise<void> | undefined;
let SessionConstructor:
	(new (snapshot: unknown) => TwineWasmProjectSessionType) | undefined;
let BootstrapConstructor:
	(new (snapshot: unknown) => TwineWasmProjectBootstrapType) | undefined;
let wasmMemoryBytes = 0;
let wasmMemory: WebAssembly.Memory | undefined;
let performanceProbeWorkerJsRetained:
	Array<{index: number; label: string; payload: string}> | undefined;
let nextRefactorRuntimeEpoch = 0;
let nextSessionInstanceId = 0;
const sessions = new Map<
	string,
	{
		instanceId: number;
		refactorRuntimeEpoch: number;
		revision: number;
		session: TwineWasmProjectSessionType;
	}
>();
const refactorPlanningTaskOwners = new Map<
	string,
	{instanceId: number; sessionId: string}
>();
const bootstraps = new Map<
	string,
	{
		assets: unknown[];
		bootstrap: TwineWasmProjectBootstrapType;
		revision: number;
	}
>();

function now() {
	return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function epochNow() {
	return typeof performance !== 'undefined'
		? performance.timeOrigin + performance.now()
		: Date.now();
}

// `Performance.memory` is Chromium-specific and is omitted by the standard
// Worker lib. Keep the non-standard surface local so the production metric
// remains explicit rather than treating an unsupported API as zero bytes.
type WorkerPerformanceWithMemory = Performance & {
	memory?: {usedJSHeapSize?: number};
};

function workerJsHeapUsedBytes() {
	const bytes = (performance as WorkerPerformanceWithMemory).memory
		?.usedJSHeapSize;

	return typeof bytes === 'number' && Number.isFinite(bytes)
		? bytes
		: undefined;
}

function workerMemoryObservation() {
	wasmMemoryBytes = wasmMemory?.buffer.byteLength ?? wasmMemoryBytes;

	return {
		wasmMemoryBytes: wasmMemory ? wasmMemoryBytes : undefined,
		workerJsHeapUsedBytes: workerJsHeapUsedBytes()
	};
}

function retainPerformanceProbeWorkerJs(bytes: number) {
	const targetBytes = Math.max(1, Math.min(bytes, 32 * 1024 * 1024));
	const chunkBytes = 64 * 1024;
	const count = Math.ceil(targetBytes / chunkBytes);

	// Keep ordinary strings and object headers live. A Uint8Array-only probe
	// would primarily exercise backing stores rather than the worker JS heap
	// that this contract owns.
	performanceProbeWorkerJsRetained = Array.from({length: count}, (_, index) => {
		const payloadBytes = Math.min(chunkBytes, targetBytes - index * chunkBytes);
		const label = `twine-perf-worker-js-${index}`;
		const payloadSource = `${label}:${'x'.repeat(
			Math.max(0, payloadBytes - label.length - 1)
		)}`;

		return {
			index,
			label,
			// JSON parsing materializes a flat string. Keeping the repeat/concat rope
			// alone lets V8 represent this 8 MiB ownership probe compactly instead of
			// exercising the worker JavaScript heap it is meant to attribute.
			payload: JSON.parse(JSON.stringify(payloadSource)) as string
		};
	});

	// Report the retained string payload, not object/header bookkeeping.
	return performanceProbeWorkerJsRetained.reduce(
		(total, entry) => total + entry.payload.length,
		0
	);
}

function byteSize(value: unknown) {
	const json =
		JSON.stringify(value, (_key, current) =>
			typeof current === 'bigint' ? current.toString() : current
		) ?? '';

	if (typeof TextEncoder !== 'undefined') {
		return new TextEncoder().encode(json).byteLength;
	}

	return json.length;
}

async function ensureWasm() {
	if (!wasmReady) {
		wasmReady = import('./pkg/twine_wasm').then(async module => {
			const output = await module.default();
			wasmMemory = output.memory;
			wasmMemoryBytes = wasmMemory.buffer.byteLength;
			SessionConstructor = module.TwineWasmProjectSession;
			BootstrapConstructor = module.TwineWasmProjectBootstrap;
		});
	}

	await wasmReady;
}

function ensureSession(sessionId: string, revision: number) {
	const entry = sessions.get(sessionId);

	if (!entry || entry.revision !== revision) {
		throw new Error(
			`WASM core session "${sessionId}" is at revision ${
				entry?.revision ?? 'missing'
			}, not ${revision}.`
		);
	}

	return entry;
}

function cancelPlanningTasksForSession(sessionId: string) {
	const entry = sessions.get(sessionId);
	for (const [taskId, owner] of refactorPlanningTaskOwners) {
		if (owner.sessionId !== sessionId) continue;
		try {
			if (entry && owner.instanceId === entry.instanceId) {
				entry.session.cancel_passage_rename_plan({taskId});
			}
		} finally {
			refactorPlanningTaskOwners.delete(taskId);
		}
	}
}

function taskSession(sessionId: string, taskId: string) {
	const owner = refactorPlanningTaskOwners.get(taskId);
	const entry = sessions.get(sessionId);

	return owner?.sessionId === sessionId &&
		owner.instanceId === entry?.instanceId
		? entry
		: undefined;
}

function ensureRefactorRuntimeEpoch(
	entry: {refactorRuntimeEpoch: number},
	epoch: number
) {
	if (entry.refactorRuntimeEpoch !== epoch) {
		throw new Error('WASM refactor runtime epoch is stale.');
	}
}

async function handleRequest(
	request: WasmWorkerRequest
): Promise<WasmWorkerResponse> {
	const workerReceivedAt = now();
	const workerReceivedAtEpochMs = epochNow();
	const requestBytes = byteSize(request);
	let result: unknown;
	let computeMs = 0;
	let computeStartedAt = workerReceivedAt;
	let computeStartedAtEpochMs = workerReceivedAtEpochMs;
	let computeFinishedAtEpochMs = workerReceivedAtEpochMs;
	let rustStartedAtEpochMs: number | undefined;
	let rustFinishedAtEpochMs: number | undefined;

	try {
		await ensureWasm();

		computeStartedAt = now();

		computeStartedAtEpochMs = epochNow();
		switch (request.kind) {
			case 'beginProjectBootstrap': {
				if (!BootstrapConstructor) {
					throw new Error('WASM core module did not expose ProjectBootstrap.');
				}
				bootstraps.get(request.sessionId)?.bootstrap.free();
				const priorSession = sessions.get(request.sessionId);
				if (priorSession) {
					cancelPlanningTasksForSession(request.sessionId);
					priorSession.refactorRuntimeEpoch = ++nextRefactorRuntimeEpoch;
				}
				bootstraps.set(request.sessionId, {
					assets: request.assets,
					bootstrap: new BootstrapConstructor(request.snapshot),
					revision: request.revision
				});
				result = {accepted: true};
				break;
			}
			case 'abortProjectBootstrap': {
				const bootstrap = bootstraps.get(request.sessionId);
				bootstrap?.bootstrap.free();
				bootstraps.delete(request.sessionId);
				result = {aborted: !!bootstrap};
				break;
			}
			case 'appendProjectBootstrap': {
				const entry = bootstraps.get(request.sessionId);
				if (!entry) {
					throw new Error(`Missing project bootstrap "${request.sessionId}".`);
				}
				entry.bootstrap.append_passages(request.storyId, request.passages);
				result = {accepted: true};
				break;
			}
			case 'finishProjectBootstrap': {
				const entry = bootstraps.get(request.sessionId);
				if (!entry || entry.revision !== request.revision) {
					throw new Error(
						`Missing or stale project bootstrap "${request.sessionId}".`
					);
				}
				const nextSession = entry.bootstrap.finish();
				nextSession.set_revision(request.revision);
				nextSession.set_asset_inventory(entry.assets);
				bootstraps.delete(request.sessionId);
				cancelPlanningTasksForSession(request.sessionId);
				sessions.get(request.sessionId)?.session.free();
				sessions.set(request.sessionId, {
					instanceId: ++nextSessionInstanceId,
					refactorRuntimeEpoch: ++nextRefactorRuntimeEpoch,
					revision: request.revision,
					session: nextSession
				});
				result = {
					revision: request.revision,
					status: nextSession.status()
				};
				break;
			}
			case 'replaceProject':
				if (!SessionConstructor) {
					throw new Error('WASM core module did not expose ProjectSession.');
				}

				{
					const nextSession = new SessionConstructor(request.snapshot);

					nextSession.set_revision(request.revision);
					nextSession.set_asset_inventory(request.assets);
					bootstraps.get(request.sessionId)?.bootstrap.free();
					bootstraps.delete(request.sessionId);
					cancelPlanningTasksForSession(request.sessionId);
					sessions.get(request.sessionId)?.session.free();
					sessions.set(request.sessionId, {
						instanceId: ++nextSessionInstanceId,
						refactorRuntimeEpoch: ++nextRefactorRuntimeEpoch,
						revision: request.revision,
						session: nextSession
					});
					result = {
						revision: request.revision,
						status: nextSession.status()
					};
				}
				break;

			case 'apply': {
				const entry = ensureSession(request.sessionId, request.revision);
				const batch = entry.session.apply(
					request.command,
					request.history !== 'skip'
				);

				entry.revision = entry.session.revision();
				result = {
					batch,
					revision: entry.revision,
					status: entry.session.status()
				};
				break;
			}

			case 'applyRefactorPlan': {
				const entry = ensureSession(request.sessionId, request.revision);
				ensureRefactorRuntimeEpoch(entry, request.refactorRuntimeEpoch);
				rustStartedAtEpochMs = epochNow();
				const outcome = entry.session.apply_refactor_plan(request.applyRequest);
				rustFinishedAtEpochMs = epochNow();

				if (outcome.type === 'applied') {
					entry.revision = entry.session.revision();
					result = {
						...outcome,
						revision: entry.revision,
						status: entry.session.status()
					};
				} else {
					result = {...outcome, revision: entry.revision};
				}
				break;
			}

			case 'syncRefactorRuntime': {
				const entry = ensureSession(request.sessionId, request.revision);
				rustStartedAtEpochMs = epochNow();
				entry.session.sync_refactor_runtime(request.runtime);
				rustFinishedAtEpochMs = epochNow();
				entry.refactorRuntimeEpoch = ++nextRefactorRuntimeEpoch;
				result = {refactorRuntimeEpoch: entry.refactorRuntimeEpoch};
				break;
			}

			case 'beginPassageRenamePlan': {
				if (isPassageRenameRequestTooLarge(request.request)) {
					result = {
						failure: {
							code: 'plan-too-large',
							message: 'Passage rename request strings exceed the 64 KiB limit.'
						},
						type: 'failure'
					};
					break;
				}
				const entry = ensureSession(request.sessionId, request.revision);
				ensureRefactorRuntimeEpoch(entry, request.refactorRuntimeEpoch);
				rustStartedAtEpochMs = epochNow();
				result = entry.session.begin_passage_rename_plan(request.request);
				if ((result as {type?: string}).type === 'begun') {
					refactorPlanningTaskOwners.set(
						(result as {task: {taskId: string}}).task.taskId,
						{instanceId: entry.instanceId, sessionId: request.sessionId}
					);
				}
				rustFinishedAtEpochMs = epochNow();
				break;
			}

			case 'continuePassageRenamePlan': {
				const entry = taskSession(request.sessionId, request.task.taskId);
				if (!entry) {
					result = {type: 'cancelled'};
					break;
				}
				rustStartedAtEpochMs = epochNow();
				result = entry.session.continue_passage_rename_plan(request.task);
				rustFinishedAtEpochMs = epochNow();
				if ((result as {type?: string}).type !== 'pending') {
					refactorPlanningTaskOwners.delete(request.task.taskId);
				}
				break;
			}

			case 'cancelPassageRenamePlan': {
				const entry = taskSession(request.sessionId, request.task.taskId);
				if (!entry) {
					result = {cancelled: false};
					break;
				}
				rustStartedAtEpochMs = epochNow();
				result = {
					cancelled: entry.session.cancel_passage_rename_plan(request.task)
				};
				rustFinishedAtEpochMs = epochNow();
				refactorPlanningTaskOwners.delete(request.task.taskId);
				break;
			}

			case 'beginProjectReplacePlan': {
				if (isProjectReplaceRequestTooLarge(request.request)) {
					result = {
						failure: {
							code: 'plan-too-large',
							message:
								'Project replace request strings exceed the 64 KiB limit.'
						},
						type: 'failure'
					};
					break;
				}
				const entry = ensureSession(request.sessionId, request.revision);
				ensureRefactorRuntimeEpoch(entry, request.refactorRuntimeEpoch);
				rustStartedAtEpochMs = epochNow();
				result = entry.session.begin_project_replace_plan(request.request);
				if ((result as {type?: string}).type === 'begun')
					refactorPlanningTaskOwners.set(
						(result as {task: {taskId: string}}).task.taskId,
						{instanceId: entry.instanceId, sessionId: request.sessionId}
					);
				rustFinishedAtEpochMs = epochNow();
				break;
			}
			case 'continueProjectReplacePlan': {
				const entry = taskSession(request.sessionId, request.task.taskId);
				if (!entry) {
					result = {type: 'cancelled'};
					break;
				}
				rustStartedAtEpochMs = epochNow();
				result = entry.session.continue_project_replace_plan(request.task);
				rustFinishedAtEpochMs = epochNow();
				if ((result as {type?: string}).type !== 'pending')
					refactorPlanningTaskOwners.delete(request.task.taskId);
				break;
			}
			case 'cancelProjectReplacePlan': {
				const entry = taskSession(request.sessionId, request.task.taskId);
				rustStartedAtEpochMs = epochNow();
				result = {
					cancelled: entry
						? entry.session.cancel_project_replace_plan(request.task)
						: false
				};
				rustFinishedAtEpochMs = epochNow();
				refactorPlanningTaskOwners.delete(request.task.taskId);
				break;
			}

			case 'undo': {
				const entry = ensureSession(request.sessionId, request.revision);
				const batch = entry.session.undo();

				if (batch) {
					entry.revision = entry.session.revision();
					result = {
						batch,
						revision: entry.revision,
						status: entry.session.status()
					};
				} else {
					result = null;
				}
				break;
			}

			case 'redo': {
				const entry = ensureSession(request.sessionId, request.revision);
				const batch = entry.session.redo();

				if (batch) {
					entry.revision = entry.session.revision();
					result = {
						batch,
						revision: entry.revision,
						status: entry.session.status()
					};
				} else {
					result = null;
				}
				break;
			}

			case 'acknowledgeSaved': {
				const entry = sessions.get(request.sessionId);

				if (!entry) {
					throw new Error(
						`WASM core session "${request.sessionId}" is missing.`
					);
				}
				const batch = entry.session.acknowledge_saved(request.revision);

				result = {
					batch,
					revision: entry.revision,
					status: entry.session.status()
				};
				break;
			}

			case 'ingestExternalDelta': {
				const entry = ensureSession(request.sessionId, request.revision);

				rustStartedAtEpochMs = epochNow();
				const ingest = entry.session.ingest_external_delta(
					request.delta,
					request.force
				);

				rustFinishedAtEpochMs = epochNow();
				entry.revision = entry.session.revision();
				result = {
					...ingest,
					revision: entry.revision
				};
				break;
			}

			case 'queryGraphProjection':
				result = ensureSession(
					request.sessionId,
					request.revision
				).session.query_graph_projection(request.storyId, request.options);
				break;

			case 'queryStoryIndex':
				result = ensureSession(
					request.sessionId,
					request.revision
				).session.query_story_index(request.storyId, request.options);
				break;

			case 'queryStorySummary':
				result = ensureSession(
					request.sessionId,
					request.revision
				).session.query_story_summary(request.storyId);
				break;

			case 'queryDiagnosticsSummary':
				result = ensureSession(
					request.sessionId,
					request.revision
				).session.query_diagnostics_summary(request.storyId, request.options);
				break;

			case 'queryStoryWordCount':
				result = (
					ensureSession(request.sessionId, request.revision)
						.session as unknown as {
						query_story_word_count(storyId: string): number;
					}
				).query_story_word_count(request.storyId);
				break;

			case 'queryContentsPage':
				result = ensureSession(
					request.sessionId,
					request.revision
				).session.query_contents_page(request.storyId, request.options);
				break;

			case 'querySearchPage':
				result = ensureSession(
					request.sessionId,
					request.revision
				).session.query_search_page(request.storyId, request.options);
				break;

			case 'queryRefactorPlanDetail': {
				const entry = ensureSession(request.sessionId, request.revision);
				rustStartedAtEpochMs = epochNow();
				result = entry.session.query_refactor_plan_detail(request.cursor);
				rustFinishedAtEpochMs = epochNow();
				break;
			}

			case 'queryDiagnosticsPage':
				result = ensureSession(
					request.sessionId,
					request.revision
				).session.query_diagnostics_page(request.storyId, request.options);
				break;

			case 'queryDocumentPage':
				result = ensureSession(
					request.sessionId,
					request.revision
				).session.query_document_page(request.storyId, request.options);
				break;

			case 'queryAssetsPage':
				result = ensureSession(
					request.sessionId,
					request.revision
				).session.query_assets_page(request.storyId, request.options);
				break;

			case 'queryPassageFacts':
				result = ensureSession(
					request.sessionId,
					request.revision
				).session.query_passage_facts(request.storyId, request.passageId);
				break;

			case 'queryPassageLocalFacts':
				result = ensureSession(
					request.sessionId,
					request.revision
				).session.query_passage_local_facts(request.storyId, request.passageId);
				break;

			case 'queryBacklinksPage':
				result = ensureSession(
					request.sessionId,
					request.revision
				).session.query_backlinks_page(
					request.storyId,
					request.passageId,
					request.options
				);
				break;

			case 'queryPassageDocument':
				result = ensureSession(
					request.sessionId,
					request.revision
				).session.query_passage_document(request.storyId, request.passageId);
				break;

			case 'querySourceDocument':
				result = ensureSession(
					request.sessionId,
					request.revision
				).session.query_source_document(request.storyId, request.sourceKind);
				break;

			case 'removeSession': {
				const removed = sessions.get(request.sessionId);
				const bootstrap = bootstraps.get(request.sessionId);

				cancelPlanningTasksForSession(request.sessionId);
				removed?.session.free();
				bootstrap?.bootstrap.free();
				sessions.delete(request.sessionId);
				bootstraps.delete(request.sessionId);
				result = {removed: !!removed || !!bootstrap};
				break;
			}

			case 'status':
				result = ensureSession(
					request.sessionId,
					request.revision
				).session.status();
				break;

			case 'performanceProbeWorkerJs':
				if (request.action === 'retain') {
					result = {
						allocatedBytes: retainPerformanceProbeWorkerJs(
							request.bytes ?? 8 * 1024 * 1024
						),
						retained: true
					};
				} else {
					performanceProbeWorkerJsRetained = undefined;
					result = {allocatedBytes: 0, retained: false};
				}
				break;
		}

		computeMs = now() - computeStartedAt;
		computeFinishedAtEpochMs = epochNow();

		const responseBytes = byteSize(result);
		const diagnostics = (
			'sessionId' in request ? sessions.get(request.sessionId) : undefined
		)?.session.performance_diagnostics() as
			| (NonNullable<WasmWorkerMetricBase['readModel']> & {
					lastMutation?: WasmWorkerMetricBase['mutationStages'];
			  })
			| undefined;
		const readModel = diagnostics
			? {
					analysisCacheSourceCount: diagnostics.analysisCacheSourceCount,
					backlinkCacheBytes: diagnostics.backlinkCacheBytes,
					backlinkCacheEntryCount: diagnostics.backlinkCacheEntryCount,
					backlinkCacheHitCount: diagnostics.backlinkCacheHitCount,
					backlinkScanCount: diagnostics.backlinkScanCount,
					backlinkScannedSourceCount: diagnostics.backlinkScannedSourceCount,
					fingerprintEntryCount: diagnostics.fingerprintEntryCount,
					graphCacheStoryCount: diagnostics.graphCacheStoryCount,
					historyBytes: diagnostics.historyBytes,
					parsedSourceCount: diagnostics.parsedSourceCount,
					passageCount: diagnostics.passageCount,
					projectDocumentBytes: diagnostics.projectDocumentBytes,
					refactorPlanningTaskBytes: diagnostics.refactorPlanningTaskBytes,
					refactorPlanningTaskCount: diagnostics.refactorPlanningTaskCount,
					refactorPlanStoreBytes: diagnostics.refactorPlanStoreBytes,
					refactorPlanStoreEntryCount: diagnostics.refactorPlanStoreEntryCount,
					refactorPlanStoreFingerprint:
						diagnostics.refactorPlanStoreFingerprint,
					readModelCacheStoryCount: diagnostics.readModelCacheStoryCount,
					readModelFullBuildCount: diagnostics.readModelFullBuildCount,
					readModelIncrementalUpdateCount:
						diagnostics.readModelIncrementalUpdateCount,
					readModelLastTouchedSourceCount:
						diagnostics.readModelLastTouchedSourceCount,
					redoEntryCount: diagnostics.redoEntryCount,
					undoEntryCount: diagnostics.undoEntryCount
				}
			: undefined;
		// Sample both dedicated-worker owners together at the response boundary.
		// Do not move this above diagnostics serialization: the emitted tuple must
		// describe the response that the client is about to receive.
		const memory = workerMemoryObservation();
		const workerRespondedAt = now();
		const workerRespondedAtEpochMs = epochNow();
		const metrics: WasmWorkerMetricBase = {
			computeMs,
			computeFinishedAtEpochMs,
			computeStartedAtEpochMs,
			payloadBytes:
				request.kind === 'replaceProject'
					? byteSize(request.snapshot)
					: responseBytes,
			requestBytes,
			readModel,
			mutationStages: diagnostics?.lastMutation,
			responseBytes,
			rustFinishedAtEpochMs,
			rustStartedAtEpochMs,
			traceId:
				request.kind === 'ingestExternalDelta' ? request.delta.id : undefined,
			workerReceivedAt,
			workerReceivedAtEpochMs,
			workerRespondedAt,
			...memory,
			workerRespondedAtEpochMs
		};

		return {
			id: request.id,
			kind: request.kind,
			metrics,
			ok: true,
			result
		} as WasmWorkerResponse;
	} catch (error) {
		computeMs = now() - computeStartedAt;
		computeFinishedAtEpochMs = epochNow();
		const workerRespondedAt = now();
		const workerRespondedAtEpochMs = epochNow();
		const memory = workerMemoryObservation();
		const metrics: WasmWorkerMetricBase = {
			computeMs,
			computeFinishedAtEpochMs,
			computeStartedAtEpochMs,
			payloadBytes: 0,
			requestBytes,
			responseBytes: 0,
			rustFinishedAtEpochMs,
			rustStartedAtEpochMs,
			traceId:
				request.kind === 'ingestExternalDelta' ? request.delta.id : undefined,
			workerReceivedAt,
			workerReceivedAtEpochMs,
			...memory,
			workerRespondedAt,
			workerRespondedAtEpochMs
		};

		return {
			error: (error as Error).message,
			id: request.id,
			kind: request.kind,
			metrics,
			ok: false
		};
	}
}

/** Test seam for exercising the production request dispatcher with generated WASM. */
export const handleWasmWorkerRequestForTest = handleRequest;

/** Test-only retained-owner diagnostic for session replacement/removal coverage. */
export function refactorPlanningTaskOwnerCountForTest() {
	return refactorPlanningTaskOwners.size;
}

/** Test-only dependency injection for request-dispatch tests without a Worker global. */
export function configureWasmWorkerForTest(bindings: {
	BootstrapConstructor?: typeof BootstrapConstructor;
	SessionConstructor?: typeof SessionConstructor;
	reset?: boolean;
}) {
	if (bindings.reset) {
		sessions.clear();
		bootstraps.clear();
		refactorPlanningTaskOwners.clear();
		nextRefactorRuntimeEpoch = 0;
		nextSessionInstanceId = 0;
		wasmReady = undefined;
		SessionConstructor = undefined;
		BootstrapConstructor = undefined;
		wasmMemory = undefined;
		wasmMemoryBytes = 0;
		performanceProbeWorkerJsRetained = undefined;
		return;
	}
	wasmReady = Promise.resolve();
	SessionConstructor = bindings.SessionConstructor;
	BootstrapConstructor = bindings.BootstrapConstructor;
}

const workerGlobal =
	typeof self !== 'undefined' &&
	typeof (self as {document?: unknown}).document === 'undefined' &&
	'postMessage' in self
		? self
		: undefined;

if (workerGlobal) {
	workerGlobal.onmessage = (event: MessageEvent<WasmWorkerRequest>) => {
		void handleRequest(event.data).then(response => {
			workerGlobal.postMessage(response);
		});
	};
}
