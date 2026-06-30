import type {CoreExternalDelta} from '../bindings/CoreExternalDelta';
import type {CoreGraphProjection} from '../bindings/CoreGraphProjection';
import type {CoreGraphProjectionOptions} from '../bindings/CoreGraphProjectionOptions';
import type {CoreStoryIndex} from '../bindings/CoreStoryIndex';
import type {CoreStoryIndexOptions} from '../bindings/CoreStoryIndexOptions';
import type {ProjectSnapshot} from '../bindings/ProjectSnapshot';
import type {StoryCommand} from '../bindings/StoryCommand';
import {recordCoreBridgeMetric} from './performance';
import type {CoreBridgeMode} from './performance';
import TwineWasmWorker from './twine-wasm-worker?worker';
import type {
	WasmWorkerFailure,
	WasmWorkerMutationResult,
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

export type CoreSessionMutationResult = WasmWorkerMutationResult;

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
		return window.localStorage?.getItem('twine.core.wasm') !== 'off';
	} catch {
		return true;
	}
}

function workerFailureError(response: WasmWorkerFailure) {
	return new Error(`WASM core ${response.kind} failed: ${response.error}`);
}

function cacheKey(sessionId: string, storyId: string, options: unknown) {
	return wasmQueryKey(`${sessionId}:${storyId}`, options);
}

export class WasmCoreWorkerClient {
	private disabledReason: string | undefined;
	private graphCache = new Map<string, CacheEntry<CoreGraphProjection>>();
	private graphQueryGenerations = new Map<string, number>();
	private indexCache = new Map<string, CacheEntry<CoreStoryIndex>>();
	private indexQueryGenerations = new Map<string, number>();
	private lastGraphByStory = new Map<string, CacheEntry<CoreGraphProjection>>();
	private nextId = 1;
	private pending = new Map<number, PendingRequest>();
	private readyRevisions = new Map<string, number>();
	private sessionQueues = new Map<string, Promise<void>>();
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

	dispose() {
		this.disable('WASM core worker was disposed.');
		this.readyRevisions.clear();
		this.sessionQueues.clear();
	}

	cachedGraphProjection(
		sessionId: string,
		storyId: string,
		options: CoreGraphProjectionOptions,
		revision: number
	) {
		const cached = this.graphCache.get(cacheKey(sessionId, storyId, options));

		return cached?.revision === revision ? cached.result : undefined;
	}

	lastGraphProjection(sessionId: string, storyId: string, revision: number) {
		const cached = this.lastGraphByStory.get(`${sessionId}:${storyId}`);

		return cached?.revision === revision ? cached.result : undefined;
	}

	cachedStoryIndex(
		sessionId: string,
		storyId: string,
		options: CoreStoryIndexOptions,
		revision: number
	) {
		const cached = this.indexCache.get(cacheKey(sessionId, storyId, options));

		return cached?.revision === revision ? cached.result : undefined;
	}

	async replaceProject(
		sessionId: string,
		snapshot: ProjectSnapshot,
		revision: number
	) {
		if (!this.enabled) {
			return undefined;
		}

		if (this.readyRevisions.get(sessionId) === revision) {
			return this.status(sessionId, revision);
		}

		const response = await this.enqueueMutation(sessionId, () =>
			this.send({
				id: 0,
				kind: 'replaceProject',
				revision,
				sessionId,
				snapshot
			})
		);

		if (response.kind !== 'replaceProject') {
			throw new Error(`Unexpected WASM response: ${response.kind}`);
		}

		this.readyRevisions.set(sessionId, response.result.revision);
		this.clearQueryCaches(sessionId);
		return response.result.status;
	}

	async apply(
		sessionId: string,
		command: StoryCommand,
		revision: number,
		history: 'record' | 'skip' = 'record'
	): Promise<CoreSessionMutationResult> {
		const response = await this.enqueueMutation(sessionId, () =>
			this.send({
				command,
				history,
				id: 0,
				kind: 'apply',
				revision,
				sessionId
			})
		);

		if (response.kind !== 'apply') {
			throw new Error(`Unexpected WASM response: ${response.kind}`);
		}

		this.clearQueryCaches(sessionId);
		this.readyRevisions.set(sessionId, response.result.revision);
		return response.result;
	}

	async undo(
		sessionId: string,
		revision: number
	): Promise<CoreSessionMutationResult | null> {
		return this.historyMutation('undo', sessionId, revision);
	}

	async redo(
		sessionId: string,
		revision: number
	): Promise<CoreSessionMutationResult | null> {
		return this.historyMutation('redo', sessionId, revision);
	}

	async acknowledgeSaved(
		sessionId: string,
		revision: number
	): Promise<CoreSessionMutationResult> {
		const response = await this.enqueueMutation(sessionId, () =>
			this.send({id: 0, kind: 'acknowledgeSaved', revision, sessionId})
		);

		if (response.kind !== 'acknowledgeSaved') {
			throw new Error(`Unexpected WASM response: ${response.kind}`);
		}

		this.readyRevisions.set(sessionId, response.result.revision);
		return response.result;
	}

	async applyExternalDelta(
		sessionId: string,
		delta: CoreExternalDelta,
		revision: number
	): Promise<CoreSessionMutationResult> {
		const response = await this.enqueueMutation(sessionId, () =>
			this.send({
				delta,
				id: 0,
				kind: 'applyExternalDelta',
				revision,
				sessionId
			})
		);

		if (response.kind !== 'applyExternalDelta') {
			throw new Error(`Unexpected WASM response: ${response.kind}`);
		}

		this.clearQueryCaches(sessionId);
		this.readyRevisions.set(sessionId, response.result.revision);
		return response.result;
	}

	async status(sessionId: string, revision: number) {
		await this.waitForMutations(sessionId);
		const response = await this.send({
			id: 0,
			kind: 'status',
			revision,
			sessionId
		});

		if (response.kind !== 'status') {
			throw new Error(`Unexpected WASM response: ${response.kind}`);
		}

		return response.result;
	}

	async removeSession(sessionId: string) {
		await this.waitForMutations(sessionId);
		const response = await this.send({
			id: 0,
			kind: 'removeSession',
			sessionId
		});

		if (response.kind !== 'removeSession') {
			throw new Error(`Unexpected WASM response: ${response.kind}`);
		}

		this.readyRevisions.delete(sessionId);
		this.sessionQueues.delete(sessionId);
		this.clearQueryCaches(sessionId);
		return response.result.removed;
	}

	async queryGraphProjection(
		sessionId: string,
		storyId: string,
		options: CoreGraphProjectionOptions,
		revision: number
	) {
		await this.waitForMutations(sessionId);
		const key = cacheKey(sessionId, storyId, options);
		const generationKey = `${sessionId}:${storyId}`;
		const cached = this.graphCache.get(key);

		if (cached?.revision === revision) {
			return cached.result;
		}

		const generation = (this.graphQueryGenerations.get(generationKey) ?? 0) + 1;

		this.graphQueryGenerations.set(generationKey, generation);
		const response = await this.send({
			id: 0,
			kind: 'queryGraphProjection',
			options,
			revision,
			sessionId,
			storyId
		});

		if (response.kind !== 'queryGraphProjection') {
			throw new Error(`Unexpected WASM response: ${response.kind}`);
		}

		if (this.graphQueryGenerations.get(generationKey) === generation) {
			this.graphCache.set(key, {result: response.result, revision});
			this.lastGraphByStory.set(generationKey, {
				result: response.result,
				revision
			});
		}
		return response.result;
	}

	async queryStoryIndex(
		sessionId: string,
		storyId: string,
		options: CoreStoryIndexOptions,
		revision: number
	) {
		await this.waitForMutations(sessionId);
		const key = cacheKey(sessionId, storyId, options);
		const generationKey = `${sessionId}:${storyId}`;
		const cached = this.indexCache.get(key);

		if (cached?.revision === revision) {
			return cached.result;
		}

		const generation = (this.indexQueryGenerations.get(generationKey) ?? 0) + 1;

		this.indexQueryGenerations.set(generationKey, generation);
		const response = await this.send({
			id: 0,
			kind: 'queryStoryIndex',
			options,
			revision,
			sessionId,
			storyId
		});

		if (response.kind !== 'queryStoryIndex') {
			throw new Error(`Unexpected WASM response: ${response.kind}`);
		}

		if (this.indexQueryGenerations.get(generationKey) === generation) {
			this.indexCache.set(key, {result: response.result, revision});
		}
		return response.result;
	}

	private async historyMutation(
		kind: 'redo' | 'undo',
		sessionId: string,
		revision: number
	) {
		const response = await this.enqueueMutation(sessionId, () =>
			this.send({id: 0, kind, revision, sessionId})
		);

		if (response.kind !== kind) {
			throw new Error(`Unexpected WASM response: ${response.kind}`);
		}

		if (response.result) {
			this.clearQueryCaches(sessionId);
			this.readyRevisions.set(sessionId, response.result.revision);
		}

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

	private clearQueryCaches(sessionId?: string) {
		if (!sessionId) {
			this.graphCache.clear();
			this.indexCache.clear();
			this.lastGraphByStory.clear();
			this.graphQueryGenerations.clear();
			this.indexQueryGenerations.clear();
			return;
		}

		const prefix = `${sessionId}:`;

		for (const key of this.graphCache.keys()) {
			if (key.startsWith(prefix)) {
				this.graphCache.delete(key);
			}
		}
		for (const key of this.indexCache.keys()) {
			if (key.startsWith(prefix)) {
				this.indexCache.delete(key);
			}
		}
		for (const key of this.lastGraphByStory.keys()) {
			if (key.startsWith(prefix)) {
				this.lastGraphByStory.delete(key);
			}
		}
		for (const key of this.graphQueryGenerations.keys()) {
			if (key.startsWith(prefix)) {
				this.graphQueryGenerations.set(
					key,
					(this.graphQueryGenerations.get(key) ?? 0) + 1
				);
			}
		}
		for (const key of this.indexQueryGenerations.keys()) {
			if (key.startsWith(prefix)) {
				this.indexQueryGenerations.set(
					key,
					(this.indexQueryGenerations.get(key) ?? 0) + 1
				);
			}
		}
	}

	private enqueueMutation<T>(
		sessionId: string,
		mutation: () => Promise<T>
	): Promise<T> {
		const previous = this.sessionQueues.get(sessionId) ?? Promise.resolve();
		const result = previous.then(mutation, mutation);
		const settled = result.then(
			() => undefined,
			() => undefined
		);

		this.sessionQueues.set(sessionId, settled);
		void settled.finally(() => {
			if (this.sessionQueues.get(sessionId) === settled) {
				this.sessionQueues.delete(sessionId);
			}
		});
		return result;
	}

	private waitForMutations(sessionId: string) {
		return this.sessionQueues.get(sessionId) ?? Promise.resolve();
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
