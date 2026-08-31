export type CoreBridgeMode = 'js-fallback' | 'unavailable' | 'wasm-worker';

export interface CoreBridgeMetric {
	computeMs: number;
	computeFinishedAtEpochMs: number;
	computeStartedAtEpochMs: number;
	kind:
		| 'acknowledgeSaved'
		| 'apply'
		| 'applyRefactorPlan'
		| 'syncRefactorRuntime'
		| 'beginPassageRenamePlan'
		| 'continuePassageRenamePlan'
		| 'cancelPassageRenamePlan'
		| 'beginProjectReplacePlan'
		| 'continueProjectReplacePlan'
		| 'cancelProjectReplacePlan'
		| 'appendProjectBootstrap'
		| 'beginProjectBootstrap'
		| 'abortProjectBootstrap'
		| 'finishProjectBootstrap'
		| 'ingestExternalDelta'
		| 'queryGraphProjection'
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
		| 'queryRefactorPlanDetail'
		| 'querySourceDocument'
		| 'querySearchPage'
		| 'queryStoryIndex'
		| 'queryStorySummary'
		| 'queryStoryWordCount'
		| 'performanceProbeWorkerJs'
		| 'redo'
		| 'removeSession'
		| 'replaceProject'
		| 'status'
		| 'undo';
	mode: CoreBridgeMode;
	mutationStages?: import('./twine-wasm-protocol').WasmMutationStageTimings;
	payloadBytes: number;
	queuedMs: number;
	receivedAt: number;
	receivedAtEpochMs: number;
	requestBytes: number;
	requestedAtEpochMs: number;
	readModel?: {
		analysisCacheSourceCount: number;
		backlinkCacheBytes: number;
		backlinkCacheEntryCount: number;
		backlinkCacheHitCount: number;
		backlinkScanCount: number;
		backlinkScannedSourceCount: number;
		fingerprintEntryCount: number;
		graphCacheStoryCount: number;
		historyBytes: number;
		parsedSourceCount: number;
		passageCount: number;
		projectDocumentBytes: number;
		refactorPlanningTaskBytes: number;
		refactorPlanningTaskCount: number;
		refactorPlanStoreBytes: number;
		refactorPlanStoreEntryCount: number;
		refactorPlanStoreFingerprint: string;
		readModelCacheStoryCount: number;
		readModelFullBuildCount: number;
		readModelIncrementalUpdateCount: number;
		readModelLastTouchedSourceCount: number;
		redoEntryCount: number;
		undoEntryCount: number;
	};
	responseBytes: number;
	roundTripMs: number;
	rustFinishedAtEpochMs?: number;
	rustStartedAtEpochMs?: number;
	storyId?: string;
	traceId?: string;
	transferMs: number;
	workerReceivedAtEpochMs: number;
	workerJsHeapUsedBytes?: number;
	workerRespondedAtEpochMs: number;
	wasmMemoryBytes?: number;
}

const maxMetrics = 80;
const metrics: CoreBridgeMetric[] = [];
const listeners = new Set<() => void>();

export function recordCoreBridgeMetric(metric: CoreBridgeMetric) {
	metrics.push(metric);

	if (metrics.length > maxMetrics) {
		metrics.splice(0, metrics.length - maxMetrics);
	}

	for (const listener of listeners) {
		listener();
	}
}

export function coreBridgeMetricsSnapshot() {
	return [...metrics];
}

export function resetCoreBridgeMetrics() {
	metrics.length = 0;
}

export function subscribeCoreBridgeMetrics(listener: () => void) {
	listeners.add(listener);

	return () => {
		listeners.delete(listener);
	};
}
