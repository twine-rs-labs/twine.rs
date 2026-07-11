export type CoreBridgeMode = 'js-fallback' | 'unavailable' | 'wasm-worker';

export interface CoreBridgeMetric {
	computeMs: number;
	computeFinishedAtEpochMs: number;
	computeStartedAtEpochMs: number;
	kind:
		| 'acknowledgeSaved'
		| 'apply'
		| 'ingestExternalDelta'
		| 'queryGraphProjection'
		| 'queryAssetsPage'
		| 'queryContentsPage'
		| 'queryDiagnosticsPage'
		| 'queryPassageFacts'
		| 'querySearchPage'
		| 'queryStoryIndex'
		| 'queryStorySummary'
		| 'redo'
		| 'removeSession'
		| 'replaceProject'
		| 'status'
		| 'undo';
	mode: CoreBridgeMode;
	payloadBytes: number;
	queuedMs: number;
	receivedAt: number;
	receivedAtEpochMs: number;
	requestBytes: number;
	requestedAtEpochMs: number;
	readModel?: {
		parsedSourceCount: number;
		readModelFullBuildCount: number;
		readModelIncrementalUpdateCount: number;
		readModelLastTouchedSourceCount: number;
	};
	responseBytes: number;
	roundTripMs: number;
	rustFinishedAtEpochMs?: number;
	rustStartedAtEpochMs?: number;
	storyId?: string;
	traceId?: string;
	transferMs: number;
	workerReceivedAtEpochMs: number;
	workerRespondedAtEpochMs: number;
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
