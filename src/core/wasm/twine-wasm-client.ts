import type {CoreGraphProjection} from '../bindings/CoreGraphProjection';
import type {CoreGraphProjectionOptions} from '../bindings/CoreGraphProjectionOptions';
import type {CoreStoryIndex} from '../bindings/CoreStoryIndex';
import type {CoreStoryIndexOptions} from '../bindings/CoreStoryIndexOptions';
import type {PatchBatch} from '../bindings/PatchBatch';
import type {ProjectSnapshot} from '../bindings/ProjectSnapshot';
import type {StoryCommand} from '../bindings/StoryCommand';
import {recordCoreBridgeMetric} from './performance';
import type {CoreBridgeMode} from './performance';
import TwineWasmWorker from './twine-wasm-worker?worker';
import type {
	WasmWorkerFailure,
	WasmWorkerRequest,
	WasmWorkerResponse,
	WasmWorkerSuccess
} from './twine-wasm-protocol';

type PendingRequest = {
	reject: (error: Error) => void;
	requestedAt: number;
	resolve: (response: WasmWorkerSuccess) => void;
};

type CacheEntry<T> = {
	result: T;
	revision: number;
};

function stableJson(value: unknown): string {
	if (!value || typeof value !== 'object') {
		return JSON.stringify(value);
	}

	if (Array.isArray(value)) {
		return `[${value.map(stableJson).join(',')}]`;
	}

	const object = value as Record<string, unknown>;

	return `{${Object.keys(object)
		.sort()
		.map(key => `${JSON.stringify(key)}:${stableJson(object[key])}`)
		.join(',')}}`;
}

export function wasmQueryKey(storyId: string, options: unknown) {
	return `${storyId}:${stableJson(options)}`;
}

function now() {
	return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function isWasmEnabled() {
	if (process.env.NODE_ENV === 'test') {
		return false;
	}

	if (typeof window === 'undefined' || typeof Worker === 'undefined') {
		return false;
	}

	try {
		const stored = window.localStorage?.getItem('twine.core.wasm');

		return stored !== 'off';
	} catch {
		return true;
	}
}

function workerFailureError(response: WasmWorkerFailure) {
	return new Error(`WASM core ${response.kind} failed: ${response.error}`);
}

export class WasmCoreWorkerClient {
	private disabledReason: string | undefined;
	private graphCache = new Map<string, CacheEntry<CoreGraphProjection>>();
	private indexCache = new Map<string, CacheEntry<CoreStoryIndex>>();
	private lastGraphByStory = new Map<string, CacheEntry<CoreGraphProjection>>();
	private nextId = 1;
	private pending = new Map<number, PendingRequest>();
	private readyRevision = -1;
	private worker: Worker | undefined;

	constructor() {
		if (!isWasmEnabled()) {
			this.disabledReason = 'disabled';
			return;
		}

		try {
			this.worker = new TwineWasmWorker();
			this.worker.onmessage = event =>
				this.handleResponse(event.data as WasmWorkerResponse);
			this.worker.onerror = event => {
				this.disable(event.message || 'WASM core worker could not be loaded.');
			};
		} catch (error) {
			this.disable((error as Error).message);
		}
	}

	get mode(): CoreBridgeMode {
		return this.worker && !this.disabledReason
			? 'wasm-worker'
			: this.disabledReason
				? 'unavailable'
				: 'js-fallback';
	}

	get enabled() {
		return !!this.worker && !this.disabledReason;
	}

	cachedGraphProjection(
		storyId: string,
		options: CoreGraphProjectionOptions,
		revision: number
	) {
		const key = wasmQueryKey(storyId, options);
		const cached = this.graphCache.get(key);

		return cached?.revision === revision ? cached.result : undefined;
	}

	lastGraphProjection(storyId: string, revision: number) {
		const cached = this.lastGraphByStory.get(storyId);

		return cached?.revision === revision ? cached.result : undefined;
	}

	cachedStoryIndex(
		storyId: string,
		options: CoreStoryIndexOptions,
		revision: number
	) {
		const key = wasmQueryKey(storyId, options);
		const cached = this.indexCache.get(key);

		return cached?.revision === revision ? cached.result : undefined;
	}

	async replaceProject(snapshot: ProjectSnapshot, revision: number) {
		if (!this.enabled) {
			return;
		}

		if (this.readyRevision === revision) {
			return;
		}

		const response = await this.send({
			id: 0,
			kind: 'replaceProject',
			revision,
			snapshot
		});

		if (response.kind !== 'replaceProject') {
			throw new Error(`Unexpected WASM response: ${response.kind}`);
		}

		this.readyRevision = response.result.revision;
		this.clearQueryCaches();
	}

	async apply(command: StoryCommand, revision: number): Promise<PatchBatch> {
		const response = await this.send({
			command,
			id: 0,
			kind: 'apply',
			revision
		});

		if (response.kind !== 'apply') {
			throw new Error(`Unexpected WASM response: ${response.kind}`);
		}

		this.clearQueryCaches();
		this.readyRevision = revision + 1;

		return response.result;
	}

	async undo(revision: number): Promise<PatchBatch | null> {
		const response = await this.send({
			id: 0,
			kind: 'undo',
			revision
		});

		if (response.kind !== 'undo') {
			throw new Error(`Unexpected WASM response: ${response.kind}`);
		}

		if (response.result) {
			this.clearQueryCaches();
			this.readyRevision = revision + 1;
		}

		return response.result;
	}

	async redo(revision: number): Promise<PatchBatch | null> {
		const response = await this.send({
			id: 0,
			kind: 'redo',
			revision
		});

		if (response.kind !== 'redo') {
			throw new Error(`Unexpected WASM response: ${response.kind}`);
		}

		if (response.result) {
			this.clearQueryCaches();
			this.readyRevision = revision + 1;
		}

		return response.result;
	}

	async queryGraphProjection(
		storyId: string,
		options: CoreGraphProjectionOptions,
		revision: number
	) {
		const key = wasmQueryKey(storyId, options);
		const cached = this.graphCache.get(key);

		if (cached?.revision === revision) {
			return cached.result;
		}

		const response = await this.send({
			id: 0,
			kind: 'queryGraphProjection',
			options,
			revision,
			storyId
		});

		if (response.kind !== 'queryGraphProjection') {
			throw new Error(`Unexpected WASM response: ${response.kind}`);
		}

		this.graphCache.set(key, {result: response.result, revision});
		this.lastGraphByStory.set(storyId, {result: response.result, revision});
		return response.result;
	}

	async queryStoryIndex(
		storyId: string,
		options: CoreStoryIndexOptions,
		revision: number
	) {
		const key = wasmQueryKey(storyId, options);
		const cached = this.indexCache.get(key);

		if (cached?.revision === revision) {
			return cached.result;
		}

		const response = await this.send({
			id: 0,
			kind: 'queryStoryIndex',
			options,
			revision,
			storyId
		});

		if (response.kind !== 'queryStoryIndex') {
			throw new Error(`Unexpected WASM response: ${response.kind}`);
		}

		this.indexCache.set(key, {result: response.result, revision});
		return response.result;
	}

	private disable(reason: string) {
		this.disabledReason = reason;
		this.worker?.terminate();
		this.worker = undefined;
		this.clearQueryCaches();

		for (const [, pending] of this.pending) {
			pending.reject(new Error(reason));
		}

		this.pending.clear();
	}

	private clearQueryCaches() {
		this.graphCache.clear();
		this.indexCache.clear();
		this.lastGraphByStory.clear();
	}

	private handleResponse(response: WasmWorkerResponse) {
		const pending = this.pending.get(response.id);

		if (!pending) {
			return;
		}

		this.pending.delete(response.id);

		if (!response.ok) {
			this.recordMetric(response, pending.requestedAt);
			pending.reject(workerFailureError(response));
			this.disable(response.error);
			return;
		}

		this.recordMetric(response, pending.requestedAt);
		pending.resolve(response);
	}

	private recordMetric(
		response: WasmWorkerFailure | WasmWorkerSuccess,
		requestedAt: number
	) {
		const receivedAt = now();
		const metrics = response.metrics;

		if (!metrics) {
			return;
		}

		recordCoreBridgeMetric({
			computeMs: metrics.computeMs,
			kind: response.kind,
			mode: 'wasm-worker',
			payloadBytes: metrics.payloadBytes,
			queuedMs: Math.max(0, metrics.workerReceivedAt - requestedAt),
			receivedAt,
			requestBytes: metrics.requestBytes,
			responseBytes: metrics.responseBytes,
			roundTripMs: receivedAt - requestedAt,
			storyId:
				response.ok && response.kind === 'queryStoryIndex'
					? response.result.storyId
					: undefined,
			transferMs: Math.max(0, receivedAt - metrics.workerRespondedAt)
		});
	}

	private send(request: WasmWorkerRequest) {
		if (!this.worker || this.disabledReason) {
			return Promise.reject(
				new Error(this.disabledReason ?? 'WASM core worker is unavailable.')
			);
		}

		const id = this.nextId++;
		const requestedAt = now();
		const finalRequest = {...request, id} as WasmWorkerRequest;

		return new Promise<WasmWorkerSuccess>((resolve, reject) => {
			this.pending.set(id, {reject, requestedAt, resolve});
			this.worker!.postMessage(finalRequest);
		});
	}
}

export function createWasmCoreWorkerClient() {
	return new WasmCoreWorkerClient();
}
