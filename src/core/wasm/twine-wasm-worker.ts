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
	const requestBytes = byteSize(request);
	let result: unknown;
	let computeMs = 0;

	try {
		await ensureWasm();

		const computeStartedAt = now();

		switch (request.kind) {
			case 'replaceProject':
				if (!SessionConstructor) {
					throw new Error('WASM core module did not expose ProjectSession.');
				}

				{
					const nextSession = new SessionConstructor(request.snapshot);

					nextSession.set_revision(request.revision);
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

			case 'applyExternalDelta': {
				const entry = ensureSession(request.sessionId, request.revision);
				const batch = entry.session.apply_external_delta(request.delta);

				entry.revision = entry.session.revision();
				result = {
					batch,
					revision: entry.revision,
					status: entry.session.status()
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

		const responseBytes = byteSize(result);
		const metrics: WasmWorkerMetricBase = {
			computeMs,
			payloadBytes:
				request.kind === 'replaceProject'
					? byteSize(request.snapshot)
					: responseBytes,
			requestBytes,
			responseBytes,
			workerReceivedAt,
			workerRespondedAt: now()
		};

		return {
			id: request.id,
			kind: request.kind,
			metrics,
			ok: true,
			result
		} as WasmWorkerResponse;
	} catch (error) {
		const metrics: WasmWorkerMetricBase = {
			computeMs,
			payloadBytes: 0,
			requestBytes,
			responseBytes: 0,
			workerReceivedAt,
			workerRespondedAt: now()
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
