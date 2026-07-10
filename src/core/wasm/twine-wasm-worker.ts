import type {
	WasmWorkerMetricBase,
	WasmWorkerRequest,
	WasmWorkerResponse
} from './twine-wasm-protocol';
import type {TwineWasmProjectSession as TwineWasmProjectSessionType} from './pkg/twine_wasm';

let wasmReady: Promise<void> | undefined;
let SessionConstructor:
	| (new (snapshot: unknown) => TwineWasmProjectSessionType)
	| undefined;
const sessions = new Map<
	string,
	{revision: number; session: TwineWasmProjectSessionType}
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
			await module.default();
			SessionConstructor = module.TwineWasmProjectSession;
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

			case 'removeSession': {
				const removed = sessions.get(request.sessionId);

				removed?.session.free();
				sessions.delete(request.sessionId);
				result = {removed: !!removed};
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

		const responseBytes = byteSize(result);
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
			responseBytes,
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
