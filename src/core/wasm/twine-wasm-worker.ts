import type {
	WasmWorkerMetricBase,
	WasmWorkerRequest,
	WasmWorkerResponse
} from './twine-wasm-protocol';
import type {TwineWasmProjectSession as TwineWasmProjectSessionType} from './pkg/twine_wasm';
import type {TwineWasmProjectBootstrap as TwineWasmProjectBootstrapType} from './pkg/twine_wasm';

let wasmReady: Promise<void> | undefined;
let SessionConstructor:
	(new (snapshot: unknown) => TwineWasmProjectSessionType) | undefined;
let BootstrapConstructor:
	(new (snapshot: unknown) => TwineWasmProjectBootstrapType) | undefined;
let wasmMemoryBytes = 0;
let wasmMemory: WebAssembly.Memory | undefined;
const sessions = new Map<
	string,
	{revision: number; session: TwineWasmProjectSessionType}
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
				bootstraps.set(request.sessionId, {
					assets: request.assets,
					bootstrap: new BootstrapConstructor(request.snapshot),
					revision: request.revision
				});
				result = {accepted: true};
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
				sessions.get(request.sessionId)?.session.free();
				sessions.set(request.sessionId, {
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
					sessions.get(request.sessionId)?.session.free();
					sessions.set(request.sessionId, {
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
		}

		computeMs = now() - computeStartedAt;
		computeFinishedAtEpochMs = epochNow();
		wasmMemoryBytes = wasmMemory?.buffer.byteLength ?? wasmMemoryBytes;

		const responseBytes = byteSize(result);
		const diagnostics = sessions
			.get(request.sessionId)
			?.session.performance_diagnostics() as
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
			wasmMemoryBytes,
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

self.onmessage = (event: MessageEvent<WasmWorkerRequest>) => {
	void handleRequest(event.data).then(response => {
		self.postMessage(response);
	});
};
