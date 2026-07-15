import {
	coreBridgeMetricsSnapshot,
	coreProjectHostPerformanceSnapshot,
	resetCoreBridgeMetrics
} from '../core';
import type {TwineElectronWindow} from '../electron/shared';
import {
	performanceEventSnapshot,
	performanceSnapshot,
	rendererHeapMemorySnapshot,
	resetRendererPerformance
} from './performance';
import {rendererMemoryOwnerSnapshot} from './performance-memory-owners';

export interface TwinePerformanceHarness {
	checkpoint(name: string): Promise<void>;
	collectRetainedMemory(name?: string): Promise<void>;
	reset(): Promise<void>;
	snapshot(): Promise<{
		main: unknown;
		renderer: {
			bridgeMetrics: ReturnType<typeof coreBridgeMetricsSnapshot>;
			core: ReturnType<typeof coreProjectHostPerformanceSnapshot>;
			entries: ReturnType<typeof performanceSnapshot>;
			events: ReturnType<typeof performanceEventSnapshot>;
			heap: ReturnType<typeof rendererHeapMemorySnapshot>;
			owners: ReturnType<typeof rendererMemoryOwnerSnapshot>;
		};
	}>;
}

export interface TwinePerformanceWindow extends TwineElectronWindow {
	twinePerformance?: TwinePerformanceHarness;
}

function rendererCheckpointSnapshot() {
	const core = coreProjectHostPerformanceSnapshot();
	const client = core.hosts[0]?.client;
	const readModel = client?.readModel;

	return {
		...rendererHeapMemorySnapshot(),
		...rendererMemoryOwnerSnapshot(),
		workerCachedPayloadBytes: client?.cachedPayloadBytes ?? 0,
		workerPendingRequestCount: client?.pendingRequestCount ?? 0,
		workerReadModelCacheEntryCount: client?.readModelCacheEntryCount ?? 0,
		workerSessionQueueCount: client?.sessionQueueCount ?? 0,
		workerWasmMemoryBytes: client?.wasmMemoryBytes ?? 0,
		rustAnalysisCacheSourceCount: readModel?.analysisCacheSourceCount ?? 0,
		rustBacklinkCacheBytes: readModel?.backlinkCacheBytes ?? 0,
		rustBacklinkCacheEntryCount: readModel?.backlinkCacheEntryCount ?? 0,
		rustBacklinkCacheHitCount: readModel?.backlinkCacheHitCount ?? 0,
		rustBacklinkScanCount: readModel?.backlinkScanCount ?? 0,
		rustBacklinkScannedSourceCount: readModel?.backlinkScannedSourceCount ?? 0,
		rustFingerprintEntryCount: readModel?.fingerprintEntryCount ?? 0,
		rustGraphCacheStoryCount: readModel?.graphCacheStoryCount ?? 0,
		rustProjectDocumentBytes: readModel?.projectDocumentBytes ?? 0,
		rustReadModelCacheStoryCount: readModel?.readModelCacheStoryCount ?? 0
	};
}

export function installPerformanceHarness() {
	const harnessWindow = window as TwinePerformanceWindow;
	const native = harnessWindow.twinePerformanceNative;

	if (!native) {
		return;
	}

	harnessWindow.twinePerformance = {
		async checkpoint(name: string) {
			await native.checkpoint(name, rendererCheckpointSnapshot());
		},
		async collectRetainedMemory(name = 'post-gc-retained') {
			(globalThis as typeof globalThis & {gc?: () => void}).gc?.();
			await native.collectGarbage();
			await new Promise(resolve => window.setTimeout(resolve, 0));
			await native.checkpoint(name, rendererCheckpointSnapshot());
		},
		async reset() {
			resetRendererPerformance();
			resetCoreBridgeMetrics();
			await native.reset();
		},
		async snapshot() {
			return {
				main: await native.snapshot(),
				renderer: {
					bridgeMetrics: coreBridgeMetricsSnapshot(),
					core: coreProjectHostPerformanceSnapshot(),
					entries: performanceSnapshot(),
					events: performanceEventSnapshot(),
					heap: rendererHeapMemorySnapshot(),
					owners: rendererMemoryOwnerSnapshot()
				}
			};
		}
	};
}
