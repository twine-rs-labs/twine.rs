import type {CoreAssetInventoryEntry} from '../bindings/CoreAssetInventoryEntry';
import type {CoreAssetsPage} from '../bindings/CoreAssetsPage';
import type {CoreAssetsQuery} from '../bindings/CoreAssetsQuery';
import type {CoreBacklinksPage} from '../bindings/CoreBacklinksPage';
import type {CoreBacklinksQuery} from '../bindings/CoreBacklinksQuery';
import type {CoreDefinitionQuery} from '../bindings/CoreDefinitionQuery';
import type {CoreDefinitionResult} from '../bindings/CoreDefinitionResult';
import type {CoreContentsPage} from '../bindings/CoreContentsPage';
import type {CoreContentsQuery} from '../bindings/CoreContentsQuery';
import type {CoreDiagnosticsPage} from '../bindings/CoreDiagnosticsPage';
import type {CoreDiagnosticsQuery} from '../bindings/CoreDiagnosticsQuery';
import type {CoreDiagnosticsSummary} from '../bindings/CoreDiagnosticsSummary';
import type {CoreDiagnosticsSummaryQuery} from '../bindings/CoreDiagnosticsSummaryQuery';
import type {CoreDocumentPage} from '../bindings/CoreDocumentPage';
import type {CoreDocumentQuery} from '../bindings/CoreDocumentQuery';
import type {CoreExternalDelta} from '../bindings/CoreExternalDelta';
import type {CoreExternalIngestResult} from '../bindings/CoreExternalIngestResult';
import type {CoreGraphProjection} from '../bindings/CoreGraphProjection';
import type {CoreGraphProjectionOptions} from '../bindings/CoreGraphProjectionOptions';
import type {CorePassageFacts} from '../bindings/CorePassageFacts';
import type {CorePassageLocalFacts} from '../bindings/CorePassageLocalFacts';
import type {CorePassageDocument} from '../bindings/CorePassageDocument';
import type {CorePassageReferencesPage} from '../bindings/CorePassageReferencesPage';
import type {CorePassageReferencesQuery} from '../bindings/CorePassageReferencesQuery';
import type {CoreSourceDocument} from '../bindings/CoreSourceDocument';
import type {CoreSearchPage} from '../bindings/CoreSearchPage';
import type {CoreSearchQuery} from '../bindings/CoreSearchQuery';
import type {CoreStoryIndex} from '../bindings/CoreStoryIndex';
import type {CoreStoryIndexOptions} from '../bindings/CoreStoryIndexOptions';
import type {CoreStorySummary} from '../bindings/CoreStorySummary';
import type {ProjectSnapshot} from '../bindings/ProjectSnapshot';
import type {PassageSnapshot} from '../bindings/PassageSnapshot';
import type {StoryCommand} from '../bindings/StoryCommand';
import type {RefactorPlanApplyRequest} from '../bindings/RefactorPlanApplyRequest';
import type {RefactorPlanCursor} from '../bindings/RefactorPlanCursor';
import type {RefactorPlanDetailResult} from '../bindings/RefactorPlanDetailResult';
import type {RefactorRuntimeState} from '../bindings/RefactorRuntimeState';
import type {PlanPassageRenameRequest} from '../bindings/PlanPassageRenameRequest';
import type {PlanPassageRenameBeginResult} from '../bindings/PlanPassageRenameBeginResult';
import type {PlanPassageRenameResult} from '../bindings/PlanPassageRenameResult';
import type {PlanProjectReplaceRequest} from '../bindings/PlanProjectReplaceRequest';
import type {PlanProjectReplaceBeginResult} from '../bindings/PlanProjectReplaceBeginResult';
import type {PlanProjectReplaceResult} from '../bindings/PlanProjectReplaceResult';
import type {RefactorPlanningTaskHandle} from '../bindings/RefactorPlanningTaskHandle';
import {
	isPassageRenameRequestTooLarge,
	isProjectReplaceRequestTooLarge
} from '../refactor-limits';
import {recordPerformanceHarnessEvent} from '../../util/performance';
import {recordCoreBridgeMetric} from './performance';
import type {CoreBridgeMetric, CoreBridgeMode} from './performance';
import TwineWasmWorker from './twine-wasm-worker?worker';
import type {
	WasmWorkerFailure,
	WasmWorkerMutationResult,
	WasmWorkerRequest,
	WasmWorkerResponse,
	WasmWorkerSuccess
} from './twine-wasm-protocol';

type PendingRequest = {
	onWorkerMetric?: (metric: CoreBridgeMetric) => void;
	reject: (error: Error) => void;
	requestedAt: number;
	requestedAtEpochMs: number;
	resolve: (response: WasmWorkerSuccess) => void;
};

type CacheEntry<T> = {
	result: T;
	revision: number;
};

export type WorkerMemoryObservation = {
	wasmMemoryBytes: number;
	workerRespondedAtEpochMs: number;
	/** Chromium's worker `performance.memory`; diagnostic-only when available. */
	workerJsHeapUsedBytes?: number;
};

type SessionMutationKind =
	| 'acknowledgeSaved'
	| 'apply'
	| 'applyRefactorPlan'
	| 'syncRefactorRuntime'
	| 'beginProjectBootstrap'
	| 'appendProjectBootstrap'
	| 'abortProjectBootstrap'
	| 'finishProjectBootstrap'
	| 'ingestExternalDelta'
	| 'redo'
	| 'replaceProject'
	| 'undo';

type ReadModelWorkerRequest = Extract<
	WasmWorkerRequest,
	{
		kind:
			| 'queryAssetsPage'
			| 'queryContentsPage'
			| 'queryDiagnosticsPage'
			| 'queryDiagnosticsSummary'
			| 'queryDocumentPage'
			| 'queryPassageFacts'
			| 'queryPassageLocalFacts'
			| 'queryBacklinksPage'
			| 'queryPassageReferencesPage'
			| 'queryDefinition'
			| 'queryPassageDocument'
			| 'querySourceDocument'
			| 'querySearchPage'
			| 'queryStorySummary'
			| 'queryStoryWordCount';
	}
>;

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

function epochNow() {
	return typeof performance !== 'undefined'
		? performance.timeOrigin + performance.now()
		: Date.now();
}

function estimatedJsonBytes(value: unknown) {
	try {
		return JSON.stringify(value).length * 2;
	} catch {
		return 0;
	}
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

function hasPerformanceHarnessBridge() {
	return (
		typeof window !== 'undefined' &&
		!!(window as Window & {twinePerformanceNative?: unknown})
			.twinePerformanceNative
	);
}

function workerFailureError(response: WasmWorkerFailure) {
	return new Error(`WASM core ${response.kind} failed: ${response.error}`);
}

function cacheKey(sessionId: string, storyId: string, options: unknown) {
	return wasmQueryKey(`${sessionId}:${storyId}`, options);
}

export class WasmCoreWorkerClient {
	private disabledReason: string | undefined;
	private diagnosticsSummaryCacheKeys = new Map<string, string>();
	private graphCache = new Map<string, CacheEntry<CoreGraphProjection>>();
	private graphQueryGenerations = new Map<string, number>();
	private indexCache = new Map<string, CacheEntry<CoreStoryIndex>>();
	private indexQueryGenerations = new Map<string, number>();
	private lastGraphByStory = new Map<string, CacheEntry<CoreGraphProjection>>();
	private lastReadModelDiagnostics:
		NonNullable<CoreBridgeMetric['readModel']> | undefined;
	// These values must always originate in the same worker response. Retaining
	// one tuple prevents a later JS-only/WASM-only update from becoming a
	// synthetic ownership observation.
	private lastWorkerMemoryObservation: WorkerMemoryObservation | undefined;
	private readModelCache = new Map<string, CacheEntry<unknown>>();
	private readModelQueryGenerations = new Map<string, number>();
	private nextId = 1;
	private pending = new Map<number, PendingRequest>();
	private readyRevisions = new Map<string, number>();
	private sessionMutationKinds = new Map<string, SessionMutationKind>();
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

	performanceDiagnostics() {
		const cacheEntries = [
			...this.graphCache.values(),
			...this.indexCache.values(),
			...this.lastGraphByStory.values(),
			...this.readModelCache.values()
		];

		return {
			cachedPayloadBytes: cacheEntries.reduce(
				(total, entry) => total + estimatedJsonBytes(entry.result),
				0
			),
			graphCacheEntryCount: this.graphCache.size,
			indexCacheEntryCount: this.indexCache.size,
			lastGraphEntryCount: this.lastGraphByStory.size,
			pendingRequestCount: this.pending.size,
			readModelCacheEntryCount: this.readModelCache.size,
			readModel: this.lastReadModelDiagnostics,
			readySessionCount: this.readyRevisions.size,
			sessionQueueCount: this.sessionQueues.size,
			wasmMemoryBytes: this.lastWorkerMemoryObservation?.wasmMemoryBytes,
			workerJsHeapUsedBytes:
				this.lastWorkerMemoryObservation?.workerJsHeapUsedBytes,
			workerMemoryObservation: this.lastWorkerMemoryObservation
		};
	}

	async performanceProbeWorkerJs(action: 'release' | 'retain', bytes?: number) {
		if (!hasPerformanceHarnessBridge()) {
			throw new Error(
				'Worker JavaScript allocation probes require the TWINE_PERF harness.'
			);
		}

		const response = await this.send({
			action,
			bytes,
			id: 0,
			kind: 'performanceProbeWorkerJs'
		});

		if (response.kind !== 'performanceProbeWorkerJs') {
			throw new Error(`Unexpected WASM response: ${response.kind}`);
		}

		return response.result;
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
		revision: number,
		assets: CoreAssetInventoryEntry[] = []
	) {
		if (!this.enabled) {
			return undefined;
		}

		if (this.readyRevisions.get(sessionId) === revision) {
			return this.status(sessionId, revision);
		}

		const response = await this.enqueueMutation(
			sessionId,
			'replaceProject',
			() =>
				this.send({
					assets,
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

	async beginProjectBootstrap(
		sessionId: string,
		snapshot: ProjectSnapshot,
		revision: number,
		assets: CoreAssetInventoryEntry[] = []
	) {
		const response = await this.enqueueMutation(
			sessionId,
			'beginProjectBootstrap',
			() =>
				this.send({
					assets,
					id: 0,
					kind: 'beginProjectBootstrap',
					revision,
					sessionId,
					snapshot
				})
		);
		if (response.kind !== 'beginProjectBootstrap') {
			throw new Error(`Unexpected WASM response: ${response.kind}`);
		}
	}

	async appendProjectBootstrap(
		sessionId: string,
		storyId: string,
		passages: PassageSnapshot[]
	) {
		const response = await this.enqueueMutation(
			sessionId,
			'appendProjectBootstrap',
			() =>
				this.send({
					id: 0,
					kind: 'appendProjectBootstrap',
					passages,
					sessionId,
					storyId
				})
		);
		if (response.kind !== 'appendProjectBootstrap') {
			throw new Error(`Unexpected WASM response: ${response.kind}`);
		}
	}

	async finishProjectBootstrap(sessionId: string, revision: number) {
		const response = await this.enqueueMutation(
			sessionId,
			'finishProjectBootstrap',
			() =>
				this.send({
					id: 0,
					kind: 'finishProjectBootstrap',
					revision,
					sessionId
				})
		);
		if (response.kind !== 'finishProjectBootstrap') {
			throw new Error(`Unexpected WASM response: ${response.kind}`);
		}
		this.readyRevisions.set(sessionId, response.result.revision);
		this.clearQueryCaches(sessionId);
		return response.result.status;
	}

	async abortProjectBootstrap(sessionId: string) {
		const response = await this.enqueueMutation(
			sessionId,
			'abortProjectBootstrap',
			() =>
				this.send({
					id: 0,
					kind: 'abortProjectBootstrap',
					sessionId
				})
		);
		if (response.kind !== 'abortProjectBootstrap') {
			throw new Error(`Unexpected WASM response: ${response.kind}`);
		}
		this.readyRevisions.delete(sessionId);
		this.clearQueryCaches(sessionId);
		return response.result.aborted;
	}

	async apply(
		sessionId: string,
		command: StoryCommand,
		revision: number,
		history: 'record' | 'skip' = 'record'
	): Promise<CoreSessionMutationResult> {
		const response = await this.enqueueMutation(sessionId, 'apply', () =>
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

	async syncRefactorRuntime(
		sessionId: string,
		runtime: RefactorRuntimeState,
		revision: number
	): Promise<number> {
		const response = await this.enqueueMutation(
			sessionId,
			'syncRefactorRuntime',
			() =>
				this.send({
					id: 0,
					kind: 'syncRefactorRuntime',
					revision,
					runtime,
					sessionId
				})
		);
		if (response.kind !== 'syncRefactorRuntime') {
			throw new Error(`Unexpected WASM response: ${response.kind}`);
		}
		return response.result.refactorRuntimeEpoch;
	}

	async beginPassageRenamePlan(
		sessionId: string,
		request: PlanPassageRenameRequest,
		refactorRuntimeEpoch: number,
		revision: number
	): Promise<PlanPassageRenameBeginResult> {
		if (isPassageRenameRequestTooLarge(request)) {
			return {
				failure: {
					code: 'plan-too-large',
					message: 'Passage rename request strings exceed the 64 KiB limit.'
				},
				type: 'failure'
			};
		}
		await this.waitForMutations(sessionId);
		const response = await this.send({
			id: 0,
			kind: 'beginPassageRenamePlan',
			refactorRuntimeEpoch,
			request,
			revision,
			sessionId
		});
		if (response.kind !== 'beginPassageRenamePlan')
			throw new Error(`Unexpected WASM response: ${response.kind}`);
		return response.result;
	}

	async continuePassageRenamePlan(
		sessionId: string,
		task: RefactorPlanningTaskHandle
	): Promise<PlanPassageRenameResult> {
		await this.waitForMutations(sessionId);
		const response = await this.send({
			id: 0,
			kind: 'continuePassageRenamePlan',
			sessionId,
			task
		});
		if (response.kind !== 'continuePassageRenamePlan')
			throw new Error(`Unexpected WASM response: ${response.kind}`);
		return response.result;
	}

	async cancelPassageRenamePlan(
		sessionId: string,
		task: RefactorPlanningTaskHandle
	): Promise<boolean> {
		const response = await this.send({
			id: 0,
			kind: 'cancelPassageRenamePlan',
			sessionId,
			task
		});
		if (response.kind !== 'cancelPassageRenamePlan')
			throw new Error(`Unexpected WASM response: ${response.kind}`);
		return response.result.cancelled;
	}

	async beginProjectReplacePlan(
		sessionId: string,
		request: PlanProjectReplaceRequest,
		refactorRuntimeEpoch: number,
		revision: number
	): Promise<PlanProjectReplaceBeginResult> {
		if (isProjectReplaceRequestTooLarge(request))
			return {
				type: 'failure',
				failure: {
					code: 'plan-too-large',
					message: 'Project replace request strings exceed the 64 KiB limit.'
				}
			};
		await this.waitForMutations(sessionId);
		const response = await this.send({
			id: 0,
			kind: 'beginProjectReplacePlan',
			sessionId,
			request,
			refactorRuntimeEpoch,
			revision
		});
		if (response.kind !== 'beginProjectReplacePlan')
			throw new Error(`Unexpected WASM response: ${response.kind}`);
		return response.result;
	}

	async continueProjectReplacePlan(
		sessionId: string,
		task: RefactorPlanningTaskHandle
	): Promise<PlanProjectReplaceResult> {
		await this.waitForMutations(sessionId);
		const response = await this.send({
			id: 0,
			kind: 'continueProjectReplacePlan',
			sessionId,
			task
		});
		if (response.kind !== 'continueProjectReplacePlan')
			throw new Error(`Unexpected WASM response: ${response.kind}`);
		return response.result;
	}

	async cancelProjectReplacePlan(
		sessionId: string,
		task: RefactorPlanningTaskHandle
	): Promise<boolean> {
		const response = await this.send({
			id: 0,
			kind: 'cancelProjectReplacePlan',
			sessionId,
			task
		});
		if (response.kind !== 'cancelProjectReplacePlan')
			throw new Error(`Unexpected WASM response: ${response.kind}`);
		return response.result.cancelled;
	}

	async applyRefactorPlan(
		sessionId: string,
		applyRequest: RefactorPlanApplyRequest,
		refactorRuntimeEpoch: number,
		revision: number,
		options: {onWorkerMetric?: (metric: CoreBridgeMetric) => void} = {}
	) {
		const response = await this.enqueueMutation(
			sessionId,
			'applyRefactorPlan',
			() =>
				this.send(
					{
						applyRequest,
						id: 0,
						kind: 'applyRefactorPlan',
						refactorRuntimeEpoch,
						revision,
						sessionId
					},
					options
				)
		);

		if (response.kind !== 'applyRefactorPlan') {
			throw new Error(`Unexpected WASM response: ${response.kind}`);
		}
		if (response.result.type === 'applied') {
			this.clearQueryCaches(sessionId);
			this.readyRevisions.set(sessionId, response.result.revision);
		}
		return response.result;
	}

	async queryRefactorPlanDetail(
		sessionId: string,
		cursor: RefactorPlanCursor,
		revision: number
	): Promise<RefactorPlanDetailResult> {
		await this.waitForMutations(sessionId);
		const response = await this.send({
			cursor,
			id: 0,
			kind: 'queryRefactorPlanDetail',
			revision,
			sessionId
		});

		if (response.kind !== 'queryRefactorPlanDetail') {
			throw new Error(`Unexpected WASM response: ${response.kind}`);
		}
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
		const response = await this.enqueueMutation(
			sessionId,
			'acknowledgeSaved',
			() => this.send({id: 0, kind: 'acknowledgeSaved', revision, sessionId})
		);

		if (response.kind !== 'acknowledgeSaved') {
			throw new Error(`Unexpected WASM response: ${response.kind}`);
		}

		this.readyRevisions.set(sessionId, response.result.revision);
		return response.result;
	}

	async ingestExternalDelta(
		sessionId: string,
		delta: CoreExternalDelta,
		revision: number,
		force = false
	): Promise<CoreExternalIngestResult & {revision: number}> {
		const response = await this.enqueueMutation(
			sessionId,
			'ingestExternalDelta',
			() =>
				this.send({
					delta,
					force,
					id: 0,
					kind: 'ingestExternalDelta',
					revision,
					sessionId
				})
		);

		if (response.kind !== 'ingestExternalDelta') {
			throw new Error(`Unexpected WASM response: ${response.kind}`);
		}

		this.clearQueryCaches(sessionId);
		this.readyRevisions.set(sessionId, response.result.revision);
		return response.result;
	}

	async applyExternalDelta(
		sessionId: string,
		delta: CoreExternalDelta,
		revision: number
	): Promise<CoreSessionMutationResult> {
		const result = await this.ingestExternalDelta(
			sessionId,
			delta,
			revision,
			true
		);

		if (!result.batch) {
			throw new Error('Forced external delta did not return a patch batch.');
		}
		return {
			batch: result.batch,
			revision: result.revision,
			status: result.status
		};
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
		this.sessionMutationKinds.delete(sessionId);
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

	async queryStorySummary(
		sessionId: string,
		storyId: string,
		revision: number
	) {
		return this.queryReadModel<CoreStorySummary>(sessionId, storyId, revision, {
			id: 0,
			kind: 'queryStorySummary',
			revision,
			sessionId,
			storyId
		});
	}

	async queryDiagnosticsSummary(
		sessionId: string,
		storyId: string,
		options: CoreDiagnosticsSummaryQuery,
		revision: number
	) {
		const request: ReadModelWorkerRequest = {
			id: 0,
			kind: 'queryDiagnosticsSummary',
			options,
			revision,
			sessionId,
			storyId
		};

		return this.queryReadModel<CoreDiagnosticsSummary>(
			sessionId,
			storyId,
			revision,
			request,
			true,
			`${sessionId}:${storyId}`
		);
	}

	async queryStoryWordCount(
		sessionId: string,
		storyId: string,
		revision: number
	) {
		return this.queryReadModel<number>(sessionId, storyId, revision, {
			id: 0,
			kind: 'queryStoryWordCount',
			revision,
			sessionId,
			storyId
		});
	}

	async queryContentsPage(
		sessionId: string,
		storyId: string,
		options: CoreContentsQuery,
		revision: number
	) {
		return this.queryReadModel<CoreContentsPage>(sessionId, storyId, revision, {
			id: 0,
			kind: 'queryContentsPage',
			options,
			revision,
			sessionId,
			storyId
		});
	}

	/**
	 * A revision-matched page remains valid while no mutation is queued for the
	 * session. Hosts use this before their readiness await so a cached read is
	 * not held behind an unrelated in-flight status request.
	 */
	cachedContentsPage(
		sessionId: string,
		storyId: string,
		options: CoreContentsQuery,
		revision: number
	) {
		if (this.sessionQueues.has(sessionId)) {
			return undefined;
		}

		const request: ReadModelWorkerRequest = {
			id: 0,
			kind: 'queryContentsPage',
			options,
			revision,
			sessionId,
			storyId
		};
		const cached = this.readModelCache.get(
			cacheKey(sessionId, storyId, request)
		);

		return cached?.revision === revision
			? (cached.result as CoreContentsPage)
			: undefined;
	}

	async querySearchPage(
		sessionId: string,
		storyId: string,
		options: CoreSearchQuery,
		revision: number
	) {
		return this.queryReadModel<CoreSearchPage>(sessionId, storyId, revision, {
			id: 0,
			kind: 'querySearchPage',
			options,
			revision,
			sessionId,
			storyId
		});
	}

	async queryDiagnosticsPage(
		sessionId: string,
		storyId: string,
		options: CoreDiagnosticsQuery,
		revision: number
	) {
		return this.queryReadModel<CoreDiagnosticsPage>(
			sessionId,
			storyId,
			revision,
			{
				id: 0,
				kind: 'queryDiagnosticsPage',
				options,
				revision,
				sessionId,
				storyId
			}
		);
	}

	async queryDocumentPage(
		sessionId: string,
		storyId: string,
		options: CoreDocumentQuery,
		revision: number
	) {
		return this.queryReadModel<CoreDocumentPage>(
			sessionId,
			storyId,
			revision,
			{
				id: 0,
				kind: 'queryDocumentPage',
				options,
				revision,
				sessionId,
				storyId
			},
			false
		);
	}

	async queryAssetsPage(
		sessionId: string,
		storyId: string,
		options: CoreAssetsQuery,
		revision: number
	) {
		return this.queryReadModel<CoreAssetsPage>(sessionId, storyId, revision, {
			id: 0,
			kind: 'queryAssetsPage',
			options,
			revision,
			sessionId,
			storyId
		});
	}

	async queryPassageFacts(
		sessionId: string,
		storyId: string,
		passageId: string,
		revision: number
	) {
		return this.queryReadModel<CorePassageFacts>(sessionId, storyId, revision, {
			id: 0,
			kind: 'queryPassageFacts',
			passageId,
			revision,
			sessionId,
			storyId
		});
	}

	async queryPassageLocalFacts(
		sessionId: string,
		storyId: string,
		passageId: string,
		revision: number
	) {
		return this.queryReadModel<CorePassageLocalFacts>(
			sessionId,
			storyId,
			revision,
			{
				id: 0,
				kind: 'queryPassageLocalFacts',
				passageId,
				revision,
				sessionId,
				storyId
			}
		);
	}

	async queryBacklinksPage(
		sessionId: string,
		storyId: string,
		passageId: string,
		options: CoreBacklinksQuery,
		revision: number
	) {
		return this.queryReadModel<CoreBacklinksPage>(
			sessionId,
			storyId,
			revision,
			{
				id: 0,
				kind: 'queryBacklinksPage',
				options,
				passageId,
				revision,
				sessionId,
				storyId
			}
		);
	}

	async queryPassageReferencesPage(
		sessionId: string,
		storyId: string,
		passageId: string,
		options: CorePassageReferencesQuery,
		revision: number
	) {
		return this.queryReadModel<CorePassageReferencesPage>(
			sessionId,
			storyId,
			revision,
			{
				id: 0,
				kind: 'queryPassageReferencesPage',
				options,
				passageId,
				revision,
				sessionId,
				storyId
			}
		);
	}

	async queryDefinition(
		sessionId: string,
		query: CoreDefinitionQuery,
		revision: number
	) {
		return this.queryReadModel<CoreDefinitionResult>(
			sessionId,
			query.storyId,
			revision,
			{
				id: 0,
				kind: 'queryDefinition',
				query,
				revision,
				sessionId,
				storyId: query.storyId
			}
		);
	}

	async queryPassageDocument(
		sessionId: string,
		storyId: string,
		passageId: string,
		revision: number
	) {
		return this.queryReadModel<CorePassageDocument>(
			sessionId,
			storyId,
			revision,
			{
				id: 0,
				kind: 'queryPassageDocument',
				passageId,
				revision,
				sessionId,
				storyId
			},
			false
		);
	}

	async querySourceDocument(
		sessionId: string,
		storyId: string,
		sourceKind: 'script' | 'stylesheet',
		revision: number
	) {
		return this.queryReadModel<CoreSourceDocument>(
			sessionId,
			storyId,
			revision,
			{
				id: 0,
				kind: 'querySourceDocument',
				revision,
				sessionId,
				sourceKind,
				storyId
			},
			false
		);
	}

	private async queryReadModel<T>(
		sessionId: string,
		storyId: string,
		revision: number,
		request: ReadModelWorkerRequest,
		useClientCache = true,
		latestCacheOwnerKey?: string
	): Promise<T> {
		const queuedAt = now();
		const waitingOn = this.sessionMutationKinds.get(sessionId);

		await this.waitForMutations(sessionId);
		const queueWaitMs = now() - queuedAt;
		const key = cacheKey(sessionId, storyId, request);

		if (latestCacheOwnerKey) {
			const previousCacheEntryKey =
				this.diagnosticsSummaryCacheKeys.get(latestCacheOwnerKey);

			if (previousCacheEntryKey !== key) {
				if (previousCacheEntryKey) {
					this.readModelCache.delete(previousCacheEntryKey);
				}
				this.diagnosticsSummaryCacheKeys.set(latestCacheOwnerKey, key);
			}
		}

		const generationKey = `${sessionId}:${storyId}:${request.kind}`;
		const cached = useClientCache ? this.readModelCache.get(key) : undefined;
		const cacheState = cached?.revision === revision ? 'client' : 'worker';

		recordPerformanceHarnessEvent('core-read-model-query', {
			cacheState,
			kind: request.kind,
			queueWaitMs,
			waitingOn: waitingOn ?? null
		});

		if (cacheState === 'client') {
			return cached!.result as T;
		}

		const generation =
			(this.readModelQueryGenerations.get(generationKey) ?? 0) + 1;

		this.readModelQueryGenerations.set(generationKey, generation);
		const response = await this.send(request);

		if (response.kind !== request.kind) {
			throw new Error(`Unexpected WASM response: ${response.kind}`);
		}

		const result = (response as unknown as {result: T}).result;

		if (
			useClientCache &&
			this.readModelQueryGenerations.get(generationKey) === generation
		) {
			this.readModelCache.set(key, {result, revision});
		}
		return result;
	}

	private async historyMutation(
		kind: 'redo' | 'undo',
		sessionId: string,
		revision: number
	) {
		const response = await this.enqueueMutation(sessionId, kind, () =>
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
		this.sessionMutationKinds.clear();
	}

	private clearQueryCaches(sessionId?: string) {
		if (!sessionId) {
			this.diagnosticsSummaryCacheKeys.clear();
			this.graphCache.clear();
			this.indexCache.clear();
			this.lastGraphByStory.clear();
			this.graphQueryGenerations.clear();
			this.indexQueryGenerations.clear();
			this.readModelCache.clear();
			this.readModelQueryGenerations.clear();
			return;
		}

		const prefix = `${sessionId}:`;

		for (const key of this.diagnosticsSummaryCacheKeys.keys()) {
			if (key.startsWith(prefix)) {
				this.diagnosticsSummaryCacheKeys.delete(key);
			}
		}
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
		for (const key of this.readModelCache.keys()) {
			if (key.startsWith(prefix)) {
				this.readModelCache.delete(key);
			}
		}
		for (const key of this.readModelQueryGenerations.keys()) {
			if (key.startsWith(prefix)) {
				this.readModelQueryGenerations.set(
					key,
					(this.readModelQueryGenerations.get(key) ?? 0) + 1
				);
			}
		}
	}

	private enqueueMutation<T>(
		sessionId: string,
		kind: SessionMutationKind,
		mutation: () => Promise<T>
	): Promise<T> {
		const previous = this.sessionQueues.get(sessionId) ?? Promise.resolve();
		this.sessionMutationKinds.set(sessionId, kind);
		const result = previous.then(mutation, mutation);
		const settled = result.then(
			() => undefined,
			() => undefined
		);

		this.sessionQueues.set(sessionId, settled);
		void settled.finally(() => {
			if (this.sessionQueues.get(sessionId) === settled) {
				this.sessionQueues.delete(sessionId);
				this.sessionMutationKinds.delete(sessionId);
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
			const metric = this.recordMetric(
				response,
				pending.requestedAt,
				pending.requestedAtEpochMs
			);
			if (metric) pending.onWorkerMetric?.(metric);
			pending.reject(workerFailureError(response));
			return;
		}

		const metric = this.recordMetric(
			response,
			pending.requestedAt,
			pending.requestedAtEpochMs
		);
		if (metric) pending.onWorkerMetric?.(metric);
		pending.resolve(response);
	}

	private recordMetric(
		response: WasmWorkerFailure | WasmWorkerSuccess,
		requestedAt: number,
		requestedAtEpochMs: number
	): CoreBridgeMetric | undefined {
		const receivedAt = now();
		const receivedAtEpochMs = epochNow();
		const metrics = response.metrics;

		if (!metrics) {
			return;
		}
		if (
			typeof metrics.wasmMemoryBytes === 'number' &&
			Number.isFinite(metrics.wasmMemoryBytes) &&
			typeof metrics.workerRespondedAtEpochMs === 'number' &&
			Number.isFinite(metrics.workerRespondedAtEpochMs)
		) {
			this.lastWorkerMemoryObservation = {
				wasmMemoryBytes: metrics.wasmMemoryBytes,
				workerJsHeapUsedBytes:
					typeof metrics.workerJsHeapUsedBytes === 'number' &&
					Number.isFinite(metrics.workerJsHeapUsedBytes)
						? metrics.workerJsHeapUsedBytes
						: undefined,
				workerRespondedAtEpochMs: metrics.workerRespondedAtEpochMs
			};
		}
		// Metric-only worker responses do not erase diagnostics from the most
		// recent diagnostic-bearing response. Refactor baseline isolation relies
		// on an explicit later empty-store diagnostic, not accidental clearing.
		if (metrics.readModel !== undefined) {
			this.lastReadModelDiagnostics = metrics.readModel;
		}

		const metric: CoreBridgeMetric = {
			computeMs: metrics.computeMs,
			computeFinishedAtEpochMs: metrics.computeFinishedAtEpochMs,
			computeStartedAtEpochMs: metrics.computeStartedAtEpochMs,
			kind: response.kind,
			mode: 'wasm-worker',
			payloadBytes: metrics.payloadBytes,
			queuedMs: Math.max(
				0,
				metrics.workerReceivedAtEpochMs - requestedAtEpochMs
			),
			receivedAt,
			receivedAtEpochMs,
			requestBytes: metrics.requestBytes,
			requestedAtEpochMs,
			readModel: metrics.readModel,
			mutationStages: metrics.mutationStages,
			responseBytes: metrics.responseBytes,
			roundTripMs: receivedAt - requestedAt,
			rustFinishedAtEpochMs: metrics.rustFinishedAtEpochMs,
			rustStartedAtEpochMs: metrics.rustStartedAtEpochMs,
			storyId:
				response.ok && response.kind === 'queryStoryIndex'
					? response.result.storyId
					: undefined,
			traceId: metrics.traceId,
			transferMs: Math.max(
				0,
				receivedAtEpochMs - metrics.workerRespondedAtEpochMs
			),
			workerReceivedAtEpochMs: metrics.workerReceivedAtEpochMs,
			workerJsHeapUsedBytes: metrics.workerJsHeapUsedBytes,
			wasmMemoryBytes: metrics.wasmMemoryBytes,
			workerRespondedAtEpochMs: metrics.workerRespondedAtEpochMs
		};
		recordCoreBridgeMetric(metric);
		return metric;
	}

	private send(
		request: WasmWorkerRequest,
		metadata: {onWorkerMetric?: (metric: CoreBridgeMetric) => void} = {}
	) {
		if (!this.worker || this.disabledReason) {
			return Promise.reject(
				new Error(this.disabledReason ?? 'WASM core worker is unavailable.')
			);
		}

		const id = this.nextId++;
		const requestedAt = now();
		const requestedAtEpochMs = epochNow();
		const finalRequest = {...request, id} as WasmWorkerRequest;

		return new Promise<WasmWorkerSuccess>((resolve, reject) => {
			this.pending.set(id, {
				onWorkerMetric: metadata.onWorkerMetric,
				reject,
				requestedAt,
				requestedAtEpochMs,
				resolve
			});
			this.worker!.postMessage(finalRequest);
		});
	}
}

export function createWasmCoreWorkerClient() {
	return new WasmCoreWorkerClient();
}
