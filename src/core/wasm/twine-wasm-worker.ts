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
let session: TwineWasmProjectSessionType | undefined;
let sessionRevision = -1;

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

function ensureSession(revision: number) {
	if (!session || sessionRevision !== revision) {
		throw new Error(
			`WASM core session is at revision ${sessionRevision}, not ${revision}.`
		);
	}

	return session;
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

					session?.free();
					session = nextSession;
				}
				sessionRevision = request.revision;
				result = {revision: request.revision};
				break;

			case 'apply':
				result = ensureSession(request.revision).apply(request.command);
				break;

			case 'queryGraphProjection':
				result = ensureSession(request.revision).query_graph_projection(
					request.storyId,
					request.options
				);
				break;

			case 'queryStoryIndex':
				result = ensureSession(request.revision).query_story_index(
					request.storyId,
					request.options
				);
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
