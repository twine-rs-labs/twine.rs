import {app} from 'electron';
import {appendFileSync} from 'fs';
import {tmpdir} from 'os';
import {isAbsolute, join, relative, resolve} from 'path';
import {performance} from 'perf_hooks';
import {getHeapStatistics} from 'v8';

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
		| 'delta-created'
		| 'native-notified'
		| 'scan-started'
		| 'watcher-observed';
	timeEpochMs: number;
}

const enabled = process.env.TWINE_PERF === '1';
const startedAt = performance.now();
const timings: Array<{name: string; timeMs: number}> = [
	{name: 'main-module', timeMs: 0}
];
const watcherMetrics: NativeWatcherPerformanceMetric[] = [];
const watcherTraceEvents: NativeWatcherTraceEvent[] = [];
const memoryCheckpoints: Array<{
	appMetrics: ReturnType<typeof app.getAppMetrics>;
	mainHeap: ReturnType<typeof getHeapStatistics>;
	mainMemory: NodeJS.MemoryUsage;
	mainProcessMemory?: Electron.ProcessMemoryInfo;
	name: string;
	recordedAtEpochMs: number;
	renderer: Record<string, number>;
}> = [];

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
	memoryCheckpoints.length = 0;
}

export function recordMemoryCheckpoint(
	name: string,
	renderer: Record<string, number> = {},
	mainProcessMemory?: Electron.ProcessMemoryInfo
) {
	if (!enabled) {
		return;
	}

	memoryCheckpoints.push({
		appMetrics: app.getAppMetrics(),
		mainHeap: getHeapStatistics(),
		mainMemory: process.memoryUsage(),
		mainProcessMemory,
		name,
		recordedAtEpochMs: performanceEpochNow(),
		renderer
	});
}

export function mainPerformanceHarnessSnapshot(
	processMemory?: Electron.ProcessMemoryInfo
) {
	if (!enabled) {
		throw new Error('The Electron performance harness is disabled.');
	}

	return {
		appMetrics: app.getAppMetrics(),
		memoryCheckpoints: [...memoryCheckpoints],
		memory: process.memoryUsage(),
		processMemory,
		timings: [...timings],
		watcherMetrics: [...watcherMetrics],
		watcherTraceEvents: [...watcherTraceEvents]
	};
}
