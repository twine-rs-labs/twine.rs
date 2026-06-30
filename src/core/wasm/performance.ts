export type CoreBridgeMode = 'js-fallback' | 'unavailable' | 'wasm-worker';

export interface CoreBridgeMetric {
	computeMs: number;
	kind:
		| 'acknowledgeSaved'
		| 'apply'
		| 'applyExternalDelta'
		| 'queryGraphProjection'
		| 'queryStoryIndex'
		| 'redo'
		| 'removeSession'
		| 'replaceProject'
		| 'status'
		| 'undo';
	mode: CoreBridgeMode;
	payloadBytes: number;
	queuedMs: number;
	receivedAt: number;
	requestBytes: number;
	responseBytes: number;
	roundTripMs: number;
	storyId?: string;
	transferMs: number;
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

export function subscribeCoreBridgeMetrics(listener: () => void) {
	listeners.add(listener);

	return () => {
		listeners.delete(listener);
	};
}
