import {
	coreBridgeMetricsSnapshot,
	coreProjectHostPerformanceHarness,
	coreProjectHostPerformanceSnapshot,
	resetCoreBridgeMetrics
} from '../core';
import type {PlanPassageRenameRequest} from '../core/bindings/PlanPassageRenameRequest';
import type {PlanPassageRenameResult} from '../core/bindings/PlanPassageRenameResult';
import type {RefactorPlanApplyRequest} from '../core/bindings/RefactorPlanApplyRequest';
import type {RefactorPlanApplyResult} from '../core/bindings/RefactorPlanApplyResult';
import type {RefactorPlanCursor} from '../core/bindings/RefactorPlanCursor';
import type {RefactorPlanDetailResult} from '../core/bindings/RefactorPlanDetailResult';
import type {TwineElectronWindow} from '../electron/shared';
import {
	performanceEventSnapshot,
	performanceSnapshot,
	rendererHeapMemorySnapshot,
	resetRendererPerformance
} from './performance';
import {
	rendererMemoryOwnerSnapshot,
	selectPerformanceEditorText
} from './performance-memory-owners';
import {
	refactorRendererHighWater,
	type RendererCheckpointValues
} from './refactor-performance-high-water';

export interface RendererPerformanceSnapshot {
	bridgeMetrics: ReturnType<typeof coreBridgeMetricsSnapshot>;
	core: ReturnType<typeof coreProjectHostPerformanceSnapshot>;
	entries: ReturnType<typeof performanceSnapshot>;
	events: ReturnType<typeof performanceEventSnapshot>;
	heap: ReturnType<typeof rendererHeapMemorySnapshot>;
	owners: ReturnType<typeof rendererMemoryOwnerSnapshot> & {
		refactorReview: {
			encodedBytes: number;
			ownerCount: number;
			pageCount: number;
			summaryCount: number;
		};
	};
	refactorPendingChunkObservations: {
		local: number;
		native: number;
	};
}

export interface TwinePerformanceSnapshot {
	main: unknown;
	renderer: RendererPerformanceSnapshot;
}

export interface TwinePerformanceHarness {
	checkpoint(name: string): Promise<void>;
	collectRetainedMemory(name?: string): Promise<void>;
	/**
	 * Samples renderer-owned heap after collection without requesting main-process
	 * diagnostics. This keeps review-retention attribution independent from IPC
	 * payload cloning.
	 */
	rendererHeapAfterGarbageCollection(): Promise<
		ReturnType<typeof rendererHeapMemorySnapshot>
	>;
	reset(): Promise<void>;
	selectEditorText(id: string, query: string): boolean;
	refactor: {
		apply(
			storyId: string,
			request: RefactorPlanApplyRequest
		): Promise<RefactorPlanApplyResult>;
		detail(
			storyId: string,
			cursor: RefactorPlanCursor
		): Promise<RefactorPlanDetailResult>;
		plan(
			storyId: string,
			request: PlanPassageRenameRequest,
			options?: {
				onProgress?: (result: PlanPassageRenameResult) => void | Promise<void>;
				signal?: AbortSignal;
			}
		): Promise<PlanPassageRenameResult>;
	};
	worker: {
		diagnostics(storyId: string): Promise<unknown>;
		probeJsHeap(
			action: 'release' | 'retain',
			bytes?: number
		): Promise<{allocatedBytes: number; retained: boolean}>;
	};
	review: {
		closeReview(storyId: string): void;
		snapshot(storyId: string): {
			encodedBytes: number;
			pageCount: number;
			summaryCount: number;
		};
	};
	snapshot(): Promise<TwinePerformanceSnapshot>;
}

export interface TwinePerformanceWindow extends TwineElectronWindow {
	twinePerformance?: TwinePerformanceHarness;
}

function refactorReviewDiagnostics() {
	return coreProjectHostPerformanceSnapshot().hosts.reduce(
		(total, host) => ({
			encodedBytes: total.encodedBytes + host.refactorReview.encodedBytes,
			ownerCount: total.ownerCount + host.refactorReview.ownerCount,
			pageCount: total.pageCount + host.refactorReview.pageCount,
			summaryCount: total.summaryCount + host.refactorReview.summaryCount
		}),
		{encodedBytes: 0, ownerCount: 0, pageCount: 0, summaryCount: 0}
	);
}

function rendererCheckpointSnapshot() {
	const core = coreProjectHostPerformanceSnapshot();
	const client = core.hosts[0]?.client;
	const readModel = client?.readModel;
	const workerMemory = client?.workerMemoryObservation;

	return {
		...rendererHeapMemorySnapshot(),
		...rendererMemoryOwnerSnapshot(),
		refactorReviewEncodedBytes: refactorReviewDiagnostics().encodedBytes,
		workerCachedPayloadBytes: client?.cachedPayloadBytes ?? 0,
		workerPendingRequestCount: client?.pendingRequestCount ?? 0,
		workerReadModelCacheEntryCount: client?.readModelCacheEntryCount ?? 0,
		workerSessionQueueCount: client?.sessionQueueCount ?? 0,
		// The self-reported worker heap is diagnostics only. Main obtains the
		// authoritative heap sample through the runner-owned browser-root broker.
		workerJsHeapUsedBytes: workerMemory?.workerJsHeapUsedBytes,
		workerResponseAtEpochMs: workerMemory?.workerRespondedAtEpochMs,
		workerWasmMemoryBytes: workerMemory?.wasmMemoryBytes,
		rustAnalysisCacheSourceCount: readModel?.analysisCacheSourceCount ?? 0,
		rustBacklinkCacheBytes: readModel?.backlinkCacheBytes ?? 0,
		rustBacklinkCacheEntryCount: readModel?.backlinkCacheEntryCount ?? 0,
		rustBacklinkCacheHitCount: readModel?.backlinkCacheHitCount ?? 0,
		rustBacklinkScanCount: readModel?.backlinkScanCount ?? 0,
		rustBacklinkScannedSourceCount: readModel?.backlinkScannedSourceCount ?? 0,
		rustFingerprintEntryCount: readModel?.fingerprintEntryCount ?? 0,
		rustGraphCacheStoryCount: readModel?.graphCacheStoryCount ?? 0,
		rustProjectDocumentBytes: readModel?.projectDocumentBytes ?? 0,
		rustRefactorPlanningTaskBytes: readModel?.refactorPlanningTaskBytes ?? 0,
		rustRefactorPlanningTaskCount: readModel?.refactorPlanningTaskCount ?? 0,
		rustReadModelCacheStoryCount: readModel?.readModelCacheStoryCount ?? 0
	};
}

async function rendererHeapAfterGarbageCollection() {
	const collect = (globalThis as typeof globalThis & {gc?: () => void}).gc;

	if (typeof collect !== 'function') {
		throw new Error(
			'Renderer garbage collection is unavailable in the performance harness'
		);
	}

	// WeakRef targets are not eligible for collection until a later job. Keep
	// this probe renderer-local: native diagnostics are deliberately fetched only
	// after the before/after heap observations have been recorded.
	for (let pass = 0; pass < 3; pass++) {
		await new Promise(resolve => window.setTimeout(resolve, 0));
		collect();
	}

	return rendererHeapMemorySnapshot();
}

export function installPerformanceHarness() {
	const harnessWindow = window as TwinePerformanceWindow;
	const native = harnessWindow.twinePerformanceNative;

	if (!native) {
		return;
	}
	let localRefactorPendingChunkObservations = 0;
	let nativeRefactorPendingChunkObservations = 0;

	harnessWindow.twinePerformance = {
		worker: {
			diagnostics: storyId =>
				coreProjectHostPerformanceHarness().queryDiagnosticsSummaryAsync(
					storyId,
					{
						// Deliberately unique so this is a diagnostic-bearing worker response,
						// never a host-side cache hit after the integrity probe releases.
						dismissedIds: [`twine-perf-baseline-${performance.now()}`]
					}
				),
			probeJsHeap: (action, bytes) =>
				coreProjectHostPerformanceHarness().performanceProbeWorkerJs(
					action,
					bytes
				)
		},
		review: {
			closeReview(storyId) {
				coreProjectHostPerformanceHarness().closeRefactorReview(storyId);
			},
			snapshot: storyId =>
				coreProjectHostPerformanceHarness().refactorReviewSnapshot(storyId)
		},
		refactor: {
			apply: (storyId, request) =>
				coreProjectHostPerformanceHarness().applyRefactorPlan(storyId, request),
			detail: (storyId, cursor) =>
				coreProjectHostPerformanceHarness().queryRefactorPlanDetailAsync(
					storyId,
					cursor
				),
			plan: async (storyId, request, options) => {
				let pendingCount = 0;
				let localHighWater: RendererCheckpointValues | undefined;
				return coreProjectHostPerformanceHarness().planPassageRename(
					storyId,
					request,
					{
						...options,
						onProgress: async progress => {
							if (progress.type === 'pending') {
								const local = rendererCheckpointSnapshot();

								pendingCount += 1;
								localRefactorPendingChunkObservations += 1;
								localHighWater = refactorRendererHighWater(
									localHighWater,
									local
								);
								// Keep the first pending callback as an awaited native boundary for
								// typing probes. Later chunks stay locally observed; the terminal
								// checkpoint carries the winning real renderer tuple.
								if (pendingCount === 1) {
									await native.checkpoint('refactor-plan-high-water', local);
									nativeRefactorPendingChunkObservations += 1;
								}
							} else if (progress.type === 'complete' && localHighWater) {
								await native.checkpoint(
									'refactor-plan-high-water',
									localHighWater
								);
								nativeRefactorPendingChunkObservations += 1;
							}
							await options?.onProgress?.(progress);
						}
					}
				);
			}
		},
		async checkpoint(name: string) {
			await native.checkpoint(name, rendererCheckpointSnapshot());
		},
		async collectRetainedMemory(name = 'post-gc-retained') {
			await rendererHeapAfterGarbageCollection();
			await native.collectGarbage();
			await new Promise(resolve => window.setTimeout(resolve, 0));
			await native.checkpoint(name, rendererCheckpointSnapshot());
		},
		rendererHeapAfterGarbageCollection,
		async reset() {
			resetRendererPerformance();
			resetCoreBridgeMetrics();
			localRefactorPendingChunkObservations = 0;
			nativeRefactorPendingChunkObservations = 0;
			await native.reset();
		},
		selectEditorText(id, query) {
			return selectPerformanceEditorText(id, query);
		},
		async snapshot() {
			// Read the renderer before requesting main diagnostics so IPC serialization
			// cannot inflate the renderer-side heap observation being attributed.
			const renderer: RendererPerformanceSnapshot = {
				bridgeMetrics: coreBridgeMetricsSnapshot(),
				core: coreProjectHostPerformanceSnapshot(),
				entries: performanceSnapshot(),
				events: performanceEventSnapshot(),
				heap: rendererHeapMemorySnapshot(),
				owners: {
					...rendererMemoryOwnerSnapshot(),
					refactorReview: refactorReviewDiagnostics()
				},
				refactorPendingChunkObservations: {
					local: localRefactorPendingChunkObservations,
					native: nativeRefactorPendingChunkObservations
				}
			};
			return {
				main: await native.snapshot(),
				renderer
			};
		}
	};
}
