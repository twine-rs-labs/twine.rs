import {app} from 'electron';
import {appendFileSync} from 'fs';
import {tmpdir} from 'os';
import {isAbsolute, join, relative, resolve} from 'path';
import {performance} from 'perf_hooks';
import {getHeapStatistics} from 'v8';
import {sampleWorkerHeapCdpFromBroker} from './worker-heap-cdp-broker-client';

export interface NativeWatcherPerformanceMetric {
	assetChanges: number;
	changedPaths: string[];
	contentFilesRead: number;
	deltaId: string;
	durationMs: number;
	entityChanges: number;
	recovery: boolean;
	recordedAt: number;
	rootPath: string;
}

export interface NativeWatcherTraceEvent {
	deltaId: string;
	rootPath: string;
	stage:
		'delta-created' | 'native-notified' | 'scan-started' | 'watcher-observed';
	timeEpochMs: number;
}

const enabled = process.env.TWINE_PERF === '1';
const startedAt = performance.now();
const timings: Array<{name: string; timeMs: number}> = [
	{name: 'main-module', timeMs: 0}
];
const watcherMetrics: NativeWatcherPerformanceMetric[] = [];
const watcherTraceEvents: NativeWatcherTraceEvent[] = [];
interface MemoryCheckpoint {
	mainHeap: ReturnType<typeof getHeapStatistics>;
	mainMemory: NodeJS.MemoryUsage;
	mainProcessMemory?: Electron.ProcessMemoryInfo;
	name: string;
	ownedHighWater: {
		jsHeapBytes: number;
		milestone: string;
		sampleCount: number;
		totalBytes?: number;
		wasmBytes?: number;
		workerCdpResponseDriftMs?: number;
		workerCdpSampledAtEpochMs?: number;
		workerCdpUsedBytes?: number;
		workerResponseAtEpochMs?: number;
	};
	processPrivateHighWater: {
		mainPrivateBytes: number;
		milestone: string;
		rendererPrivateBytes: number;
		sampleCount: number;
		totalBytes: number;
	};
	processWorkingSetKiBByRole: Record<string, number>;
	recordedAtEpochMs: number;
	renderer: Record<string, number | string | undefined>;
	sampleCount: number;
}

const maxMemoryCheckpointRecords = 64;
const memoryCheckpoints = new Map<string, MemoryCheckpoint>();
/** The largest allowed gap between the worker response and its CDP heap read. */
export const maxWorkerHeapCdpResponseDriftMs = 5_000;

export async function sampleWorkerHeapCdp() {
	if (!enabled) {
		throw new Error('The Electron performance harness is disabled.');
	}
	return sampleWorkerHeapCdpFromBroker();
}

function processWorkingSetKiBByRole() {
	const byRole: Record<string, number> = {};

	for (const metric of app.getAppMetrics()) {
		const role = metric.type;
		byRole[role] = (byRole[role] ?? 0) + (metric.memory?.workingSetSize ?? 0);
	}
	return byRole;
}

function ownedMemoryObservation(
	milestone: string,
	sampleCount: number,
	renderer: Record<string, number | string | undefined>
) {
	const jsHeapCandidate = renderer.usedJSHeapSize;
	const jsHeapBytes = typeof jsHeapCandidate === 'number' ? jsHeapCandidate : 0;
	const workerCdpHeapCandidate = renderer.workerHeapCdpUsedBytes;
	const workerCdpUsedBytes =
		typeof workerCdpHeapCandidate === 'number'
			? workerCdpHeapCandidate
			: undefined;
	const wasmCandidate = renderer.workerWasmMemoryBytes;
	const wasmBytes =
		typeof wasmCandidate === 'number' ? wasmCandidate : undefined;
	const totalBytes =
		workerCdpUsedBytes !== undefined && wasmBytes !== undefined
			? jsHeapBytes + workerCdpUsedBytes + wasmBytes
			: undefined;

	return {
		jsHeapBytes,
		milestone,
		sampleCount,
		totalBytes,
		wasmBytes,
		workerCdpResponseDriftMs:
			typeof renderer.workerHeapCdpResponseDriftMs === 'number'
				? renderer.workerHeapCdpResponseDriftMs
				: undefined,
		workerCdpSampledAtEpochMs:
			typeof renderer.workerHeapCdpSampledAtEpochMs === 'number'
				? renderer.workerHeapCdpSampledAtEpochMs
				: undefined,
		workerCdpUsedBytes,
		workerResponseAtEpochMs:
			typeof renderer.workerResponseAtEpochMs === 'number'
				? renderer.workerResponseAtEpochMs
				: undefined
	};
}

function processPrivateObservation(
	milestone: string,
	sampleCount: number,
	mainProcessMemory: Electron.ProcessMemoryInfo | undefined,
	renderer: Record<string, number | string | undefined>
) {
	const mainPrivateBytes = (mainProcessMemory?.private ?? 0) * 1024;
	const rendererPrivateKiB = renderer.rendererPrivateKiB;
	const rendererPrivateBytes =
		(typeof rendererPrivateKiB === 'number' ? rendererPrivateKiB : 0) * 1024;

	return {
		mainPrivateBytes,
		milestone,
		rendererPrivateBytes,
		sampleCount,
		totalBytes: mainPrivateBytes + rendererPrivateBytes
	};
}

function coherentHighWater<T extends {totalBytes?: number}>(
	previous: T | undefined,
	current: T
) {
	if (current.totalBytes === undefined) return previous ?? current;
	if (previous?.totalBytes === undefined) return current;

	return current.totalBytes >= previous.totalBytes ? current : previous;
}

export function performanceEpochNow() {
	return performance.timeOrigin + performance.now();
}

export function performanceHarnessEnabled() {
	return enabled;
}

export function performanceHarnessUserDataPath() {
	if (!enabled) {
		return undefined;
	}

	const configured = process.env.TWINE_PERF_USER_DATA;

	if (!configured || !isAbsolute(configured)) {
		throw new Error(
			'TWINE_PERF=1 requires an absolute TWINE_PERF_USER_DATA path.'
		);
	}

	const temporaryRoot = resolve(tmpdir());
	const resolved = resolve(configured);
	const fromTemporaryRoot = relative(temporaryRoot, resolved);

	if (
		fromTemporaryRoot === '' ||
		fromTemporaryRoot.startsWith('..') ||
		isAbsolute(fromTemporaryRoot)
	) {
		throw new Error(
			'TWINE_PERF_USER_DATA must be inside the system temp folder.'
		);
	}

	return resolved;
}

export function performanceHarnessSessionDataPath() {
	const userData = performanceHarnessUserDataPath();

	return userData ? join(userData, 'session') : undefined;
}

export function recordMainLaunchPhase(stage: string) {
	if (!enabled) {
		return;
	}

	const tracePath = process.env.TWINE_PERF_LAUNCH_TRACE;

	if (!tracePath || !isAbsolute(tracePath)) {
		return;
	}

	const temporaryRoot = resolve(tmpdir());
	const resolved = resolve(tracePath);
	const fromTemporaryRoot = relative(temporaryRoot, resolved);

	if (
		fromTemporaryRoot === '' ||
		fromTemporaryRoot.startsWith('..') ||
		isAbsolute(fromTemporaryRoot)
	) {
		return;
	}

	try {
		appendFileSync(
			resolved,
			`${JSON.stringify({
				pid: process.pid,
				runId: process.env.TWINE_PERF_RUN_ID,
				source: 'electron-main',
				stage,
				timeEpochMs: performanceEpochNow()
			})}\n`
		);
	} catch {
		// Launch checkpoints are diagnostics only.
	}
}

export function markMainPerformance(name: string) {
	if (!enabled) {
		return;
	}

	timings.push({name, timeMs: performance.now() - startedAt});
}

export function recordWatcherPerformanceMetric(
	metric: Omit<NativeWatcherPerformanceMetric, 'recordedAt'>
) {
	if (!enabled) {
		return;
	}

	watcherMetrics.push({...metric, recordedAt: Date.now()});
	if (watcherMetrics.length > 80) {
		watcherMetrics.splice(0, watcherMetrics.length - 80);
	}
}

export function recordWatcherTraceEvent(
	event: Omit<NativeWatcherTraceEvent, 'timeEpochMs'> & {timeEpochMs?: number}
) {
	if (!enabled) {
		return;
	}

	watcherTraceEvents.push({
		...event,
		timeEpochMs: event.timeEpochMs ?? performanceEpochNow()
	});
	if (watcherTraceEvents.length > 160) {
		watcherTraceEvents.splice(0, watcherTraceEvents.length - 160);
	}
}

export function resetMainPerformanceHarness() {
	watcherMetrics.length = 0;
	watcherTraceEvents.length = 0;
	memoryCheckpoints.clear();
}

export function recordMemoryCheckpoint(
	name: string,
	renderer: Record<string, number | string | undefined> = {},
	mainProcessMemory?: Electron.ProcessMemoryInfo
) {
	if (!enabled) {
		return;
	}

	const previous = memoryCheckpoints.get(name);
	const sampleCount = (previous?.sampleCount ?? 0) + 1;
	const current: MemoryCheckpoint = {
		mainHeap: getHeapStatistics(),
		mainMemory: process.memoryUsage(),
		mainProcessMemory,
		name,
		ownedHighWater: ownedMemoryObservation(name, sampleCount, renderer),
		processPrivateHighWater: processPrivateObservation(
			name,
			sampleCount,
			mainProcessMemory,
			renderer
		),
		processWorkingSetKiBByRole: processWorkingSetKiBByRole(),
		recordedAtEpochMs: performanceEpochNow(),
		renderer,
		sampleCount
	};
	const reduced: MemoryCheckpoint = previous
		? {
				...current,
				// Keep whole observations, not fieldwise maxima: (JS=30, WASM=15)
				// must never be reported as a synthetic (JS=30, WASM=20) sample.
				ownedHighWater: coherentHighWater(
					previous.ownedHighWater,
					current.ownedHighWater
				),
				processPrivateHighWater: coherentHighWater(
					previous.processPrivateHighWater,
					current.processPrivateHighWater
				)
			}
		: current;

	if (!previous && memoryCheckpoints.size >= maxMemoryCheckpointRecords) {
		memoryCheckpoints.delete(memoryCheckpoints.keys().next().value!);
	}
	memoryCheckpoints.set(name, reduced);
}

export function mainPerformanceHarnessSnapshot(
	processMemory?: Electron.ProcessMemoryInfo
) {
	if (!enabled) {
		throw new Error('The Electron performance harness is disabled.');
	}

	return {
		appMetrics: app.getAppMetrics(),
		memoryCheckpoints: [...memoryCheckpoints.values()],
		memory: process.memoryUsage(),
		processMemory,
		timings: [...timings],
		watcherMetrics: [...watcherMetrics],
		watcherTraceEvents: [...watcherTraceEvents]
	};
}
