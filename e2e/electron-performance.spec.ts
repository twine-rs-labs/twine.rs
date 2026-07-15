import {expect, test} from '@playwright/test';
import type {TestInfo} from '@playwright/test';
import {_electron as electron, ElectronApplication, Page} from 'playwright';
import {execFileSync} from 'node:child_process';
import {
	appendFile,
	cp,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {performance as nodePerformance} from 'node:perf_hooks';

interface PerformanceSnapshot {
	main: {
		appMetrics: Array<{
			memory?: {workingSetSize?: number};
			name?: string;
			pid: number;
			type: string;
		}>;
		memory: {
			arrayBuffers?: number;
			external?: number;
			heapTotal?: number;
			heapUsed?: number;
			rss: number;
		};
		owners?: {
			nativeHydration?: {
				activeLeaseCount: number;
				passageCount: number;
				textCapacityBytes: number;
				textLengthBytes: number;
			};
			projectSessions?: {
				baselineFileCount: number;
				baselineFileStringBytes: number;
				baselinePassageCount: number;
				candidateCount: number;
				descriptorPathCount: number;
				descriptorPathStringBytes: number;
				resolvedCandidateCount: number;
				sessionCount: number;
			};
		};
		memoryCheckpoints: Array<{
			appMetrics: PerformanceSnapshot['main']['appMetrics'];
			mainHeap: Record<string, number>;
			mainMemory: PerformanceSnapshot['main']['memory'];
			name: string;
			recordedAtEpochMs: number;
			renderer: Record<string, number>;
		}>;
		timings: Array<{name: string; timeMs: number}>;
		watcherMetrics: Array<{
			assetChanges: number;
			changedPaths: string[];
			contentFilesRead: number;
			deltaId: string;
			durationMs: number;
			entityChanges: number;
			recovery: boolean;
		}>;
		watcherTraceEvents: Array<{
			deltaId: string;
			rootPath: string;
			stage: string;
			timeEpochMs: number;
		}>;
	};
	renderer: {
		bridgeMetrics: Array<{
			computeMs: number;
			computeFinishedAtEpochMs: number;
			computeStartedAtEpochMs: number;
			kind: string;
			mode: string;
			mutationStages?: {
				analysisMs: number;
				deltaId: string;
				fingerprintMs: number;
				graphMs: number;
				graphParsedSourceCount: number;
				historyMs: number;
				lookupAndDeltaMs: number;
				operation: string;
				patchFinalizeMs: number;
				readModelMs: number;
				revision: number;
				savepointMs: number;
				topologyChanged: boolean;
				totalMs: number;
			};
			payloadBytes: number;
			queuedMs: number;
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
			traceId?: string;
			transferMs: number;
			workerReceivedAtEpochMs: number;
			workerRespondedAtEpochMs: number;
			wasmMemoryBytes?: number;
		}>;
		core: {
			activeSessions: number;
			bootstrap?: {
				passageCount: number;
				storyCount: number;
				textBytes: number;
			};
			hosts: Array<{
				client?: {
					cachedPayloadBytes: number;
					graphCacheEntryCount: number;
					indexCacheEntryCount: number;
					lastGraphEntryCount: number;
					wasmMemoryBytes: number;
					pendingRequestCount: number;
					readModelCacheEntryCount: number;
					readModel?: NonNullable<
						PerformanceSnapshot['renderer']['bridgeMetrics'][number]['readModel']
					>;
					readySessionCount: number;
					sessionQueueCount: number;
				};
				mode: string;
				sessions: Array<{
					passageTextCharacterCount: number;
					revision: number;
					sessionId: string;
					storyIds: string[];
				}>;
			}>;
			workerClients: number;
		};
		owners?: {
			activeEditorCount: number;
			editorDocumentBytes: number;
		};
		entries: Array<{
			duration: number;
			name: string;
			startTime: number;
			type: string;
		}>;
		events: Array<{
			detail?: Record<string, unknown>;
			epochTime: number;
			name: string;
			time: number;
		}>;
	};
}

interface RunningApp {
	app: ElectronApplication;
	launchToWindowMs: number;
	page: Page;
	projectPath: string;
	root: string;
}

const fixturePath = process.env.TWINE_PERF_FIXTURE;
const reportPath = process.env.TWINE_PERF_REPORT;
const passageCount = Number.parseInt(process.env.TWINE_PERF_SIZE ?? '', 10);
const smoke = process.env.TWINE_PERF_SMOKE === '1';
const phase = process.env.TWINE_PERF_PHASE;
const runRoot = process.env.TWINE_PERF_RUN_ROOT;
const launchTracePath = process.env.TWINE_PERF_LAUNCH_TRACE;
const runId = process.env.TWINE_PERF_RUN_ID;
const watcherTimeout = smoke ? 60_000 : 10 * 60 * 1000;
const benchmarkPhases = [
	'diagnostic',
	'edit',
	'graph',
	'memory-detail',
	'query',
	'startup',
	'watcher'
];
const mainPath = path.resolve(
	'electron-build/main/src/electron/main-process/index.js'
);
const samples: Record<string, number[]> = {};
const assertions: Array<{detail?: string; name: string; passed: boolean}> = [];
const diagnostics: {
	bridgeMetrics: PerformanceSnapshot['renderer']['bridgeMetrics'];
	interaction?: PerformanceSnapshot;
	memoryDetail?: PerformanceSnapshot;
	startup: PerformanceSnapshot[];
	watcher?: PerformanceSnapshot;
	watcherAsset?: PerformanceSnapshot;
	watcherPassage?: PerformanceSnapshot;
} = {bridgeMetrics: [], startup: []};
let playwrightRetrySettled = false;

const inheritedElectronEnvironmentKeys = [
	'APPDATA',
	'ComSpec',
	'DBUS_SESSION_BUS_ADDRESS',
	'DISPLAY',
	'HOME',
	'HOMEDRIVE',
	'HOMEPATH',
	'LANG',
	'LC_ALL',
	'LC_CTYPE',
	'LOCALAPPDATA',
	'LOGNAME',
	'PATH',
	'PATHEXT',
	'RUST_LOG',
	'SHELL',
	'SystemRoot',
	'TEMP',
	'TMP',
	'TMPDIR',
	'TWINE_NATIVE_LOAD_THREADS',
	'USER',
	'USERNAME',
	'USERPROFILE',
	'WAYLAND_DISPLAY',
	'WINDIR',
	'XAUTHORITY',
	'XDG_RUNTIME_DIR'
] as const;

function addSample(name: string, value: number | undefined) {
	if (value !== undefined && Number.isFinite(value)) {
		(samples[name] ??= []).push(value);
	}
}

function assertInvariant(name: string, passed: boolean, detail?: string) {
	assertions.push({detail, name, passed});
	expect.soft(passed, `${name}${detail ? `: ${detail}` : ''}`).toBe(true);
}

function captureBridgeMetrics(current: PerformanceSnapshot) {
	diagnostics.bridgeMetrics.push(...current.renderer.bridgeMetrics);
}

function electronEnvironment(extra: Record<string, string | undefined>) {
	const inherited = Object.fromEntries(
		inheritedElectronEnvironmentKeys.map(key => [key, process.env[key]])
	);

	return Object.fromEntries(
		Object.entries({...inherited, ...extra}).filter(
			(entry): entry is [string, string] => typeof entry[1] === 'string'
		)
	);
}

async function recordLaunchPhase(
	stage: string,
	detail: Record<string, unknown> = {}
) {
	if (!launchTracePath) {
		return;
	}

	await appendFile(
		launchTracePath,
		`${JSON.stringify({
			...detail,
			runId,
			source: 'playwright',
			stage,
			timeEpochMs: Date.now()
		})}\n`
	);
}

async function settleLaunchServices(delayOverride?: number) {
	if (process.platform !== 'darwin') {
		return;
	}

	const delayMs =
		delayOverride ??
		Number.parseInt(process.env.TWINE_PERF_SETTLE_MS ?? '3500', 10);

	if (Number.isFinite(delayMs) && delayMs > 0) {
		await new Promise(resolve => setTimeout(resolve, delayMs));
	}
}

async function settlePlaywrightRetry() {
	if (
		playwrightRetrySettled ||
		process.platform !== 'darwin' ||
		test.info().retry === 0
	) {
		return;
	}

	playwrightRetrySettled = true;
	const delayMs = Number.parseInt(
		process.env.TWINE_PERF_RETRY_SETTLE_MS ?? '10000',
		10
	);

	await recordLaunchPhase('playwright-retry-settle', {
		delayMs,
		retry: test.info().retry
	});
	await settleLaunchServices(delayMs);
}

async function launchFixture(): Promise<RunningApp> {
	if (!fixturePath) {
		throw new Error('TWINE_PERF_FIXTURE is required.');
	}

	await settlePlaywrightRetry();
	const root = await mkdtemp(
		path.join(runRoot ?? os.tmpdir(), 'twine-rs-perf-launch-')
	);
	const userData = path.join(root, 'user-data');
	const library = path.join(root, 'library');
	const backups = path.join(root, 'backups');
	const scratch = path.join(root, 'scratch');
	const projectPath = path.join(root, path.basename(fixturePath));

	await recordLaunchPhase('fixture-copy-started', {root});
	await Promise.all([
		cp(fixturePath, projectPath, {recursive: true}),
		mkdir(userData, {recursive: true}),
		mkdir(library, {recursive: true}),
		mkdir(backups, {recursive: true}),
		mkdir(scratch, {recursive: true})
	]);
	await recordLaunchPhase('fixture-copy-finished', {root});

	const launchStartedAt = nodePerformance.now();
	let app: ElectronApplication | undefined;
	const environment = electronEnvironment({
		NODE_ENV: 'production',
		TWINE_PERF: '1',
		TWINE_PERF_LAUNCH_TRACE: launchTracePath,
		TWINE_PERF_RUN_ID: runId,
		TWINE_PERF_USER_DATA: userData
	});
	const retry = test.info().retry;

	try {
		await recordLaunchPhase('launch-requested', {
			electronEnvironmentKeys: Object.keys(environment).sort(),
			parentBundleIdentifier: process.env.__CFBundleIdentifier,
			retry,
			root,
			userData
		});
		app = await electron.launch({
			args: [
				'--enable-precise-memory-info',
				'--js-flags=--expose-gc',
				mainPath,
				`--storyLibraryFolderPath=${library}`,
				`--backupFolderPath=${backups}`,
				`--scratchFolderPath=${scratch}`,
				'--backupCadenceMinutes=10080',
				projectPath
			],
			env: environment
		});
		await recordLaunchPhase('debugger-connected', {
			pid: app.process().pid,
			retry,
			root
		});
		const page = await app.firstWindow();
		const launchToWindowMs = nodePerformance.now() - launchStartedAt;

		await recordLaunchPhase('first-window', {
			pid: app.process().pid,
			retry,
			root
		});
		await page.waitForFunction(() => !!(window as any).twinePerformance);
		await expect(page.locator('[data-testid="app-shell"]')).toBeVisible({
			timeout: 10 * 60 * 1000
		});
		await pollSnapshot(
			page,
			snapshot => {
				const names = new Set(
					snapshot.renderer.entries.map((entry: {name: string}) => entry.name)
				);

				return (
					names.has('all-passages-ready') &&
					names.has('session-baseline-ready') &&
					names.has('session-initialization-complete')
				);
			},
			smoke ? 3 * 60 * 1000 : 10 * 60 * 1000
		);
		await recordLaunchPhase('session-ready', {
			pid: app.process().pid,
			retry,
			root
		});

		return {app, launchToWindowMs, page, projectPath, root};
	} catch (error) {
		let child: ReturnType<ElectronApplication['process']> | undefined;
		try {
			child = app?.process();
		} catch {
			// Playwright may already have disposed its Electron connection after a
			// native launch failure. Cleanup must not mask the original error.
		}
		await recordLaunchPhase('launch-failed', {
			error: (error as Error).message,
			pid: child?.pid,
			retry,
			root
		});
		await app?.close().catch(() => undefined);
		if (child?.exitCode === null) {
			child.kill('SIGKILL');
		}
		await rm(root, {force: true, recursive: true});
		await settleLaunchServices();
		throw error;
	}
}

async function closeFixture(running: RunningApp) {
	const pid = running.app.process().pid;

	await recordLaunchPhase('close-requested', {
		pid,
		root: running.root
	});
	try {
		await running.app.close();
		await recordLaunchPhase('process-closed', {
			pid,
			root: running.root
		});
	} finally {
		await rm(running.root, {force: true, recursive: true});
		await settleLaunchServices();
	}
}

async function snapshot(page: Page): Promise<PerformanceSnapshot> {
	return page.evaluate(() => (window as any).twinePerformance.snapshot());
}

async function pollSnapshot(
	page: Page,
	predicate: (current: PerformanceSnapshot) => boolean,
	timeout = 60_000
) {
	const deadline = Date.now() + timeout;
	let last: PerformanceSnapshot | undefined;

	while (Date.now() < deadline) {
		const current = await snapshot(page);

		last = current;
		if (predicate(current)) {
			return current;
		}
		await page.waitForTimeout(50);
	}
	throw new Error(
		`Timed out waiting for a performance snapshot after ${timeout}ms. ` +
			`Renderer entries: ${last?.renderer.entries
				.map(entry => entry.name)
				.join(', ')}. Core: ${JSON.stringify(last?.renderer.core)}`
	);
}

async function reset(page: Page) {
	await page.evaluate(() => (window as any).twinePerformance.reset());
}

function lastEntry(snapshot: PerformanceSnapshot, name: string, type?: string) {
	return snapshot.renderer.entries
		.filter(entry => entry.name === name && (!type || entry.type === type))
		.at(-1);
}

function startupMetrics(
	snapshot: PerformanceSnapshot,
	launchToWindowMs: number
) {
	const openStart = lastEntry(snapshot, 'open-start', 'mark')?.startTime;
	const sessionReady = lastEntry(
		snapshot,
		'session-baseline-ready',
		'mark'
	)?.startTime;
	const graphVisible = lastEntry(snapshot, 'graph-visible', 'mark')?.startTime;

	addSample('startup.launchToWindowMs', launchToWindowMs);
	addSample(
		'startup.shellMs',
		lastEntry(snapshot, 'open-to-shell', 'measure')?.duration
	);
	for (const eventName of [
		'native-project-shell-loaded',
		'native-project-hydrated',
		'renderer-project-shell-dispatched',
		'renderer-project-hydration-merged',
		'renderer-project-hydration-dispatched',
		'core-session-snapshot-built',
		'core-session-ready',
		'native-session-baseline-ready'
	]) {
		for (const event of snapshot.renderer.events.filter(
			candidate =>
				candidate.name === eventName &&
				(eventName !== 'core-session-ready' ||
					candidate.detail?.mode === 'replace')
		)) {
			const duration = event.detail?.durationMs;

			addSample(
				`startupStage.${eventName}Ms`,
				typeof duration === 'number' ? duration : undefined
			);
		}
	}
	for (const event of snapshot.renderer.events.filter(
		candidate => candidate.name === 'native-session-baseline-ready'
	)) {
		addSample(
			'startupStage.native-session-baselineMs',
			typeof event.detail?.baselinePrimeMs === 'number'
				? event.detail.baselinePrimeMs
				: undefined
		);
		for (const field of ['receiptAdoptionMs', 'receiptCatchupMs'] as const) {
			addSample(
				`startupStage.native-${field}`,
				typeof event.detail?.[field] === 'number'
					? event.detail[field]
					: undefined
			);
		}
		for (const field of [
			'assetCount',
			'baselineFileCount',
			'descriptorPathCount',
			'receiptFileCount'
		] as const) {
			addSample(
				`startupEntities.native.${field}`,
				typeof event.detail?.[field] === 'number'
					? event.detail[field]
					: undefined
			);
		}
	}
	for (const event of snapshot.renderer.events.filter(candidate =>
		['native-project-shell-loaded', 'native-project-hydrated'].includes(
			candidate.name
		)
	)) {
		const prefix = `startupLoad.${
			event.name === 'native-project-shell-loaded' ? 'shell' : 'hydration'
		}`;

		addSample(
			`${prefix}.nativeCallMs`,
			typeof event.detail?.mainNativeCallMs === 'number'
				? event.detail.mainNativeCallMs
				: undefined
		);
		addSample(
			`${prefix}.jsonParseMs`,
			typeof event.detail?.jsJsonParseMs === 'number'
				? event.detail.jsJsonParseMs
				: undefined
		);
		addSample(
			`${prefix}.payloadMiB`,
			typeof event.detail?.payloadBytes === 'number'
				? event.detail.payloadBytes / 1024 / 1024
				: undefined
		);
		addSample(
			`${prefix}.baselineReceiptMs`,
			typeof event.detail?.baselineReceiptUs === 'number'
				? event.detail.baselineReceiptUs / 1000
				: undefined
		);
		for (const field of [
			'assetScanUs',
			'graphLayoutUs',
			'manifestCacheDecodeUs',
			'manifestCacheReadUs',
			'manifestHashUs',
			'manifestParseUs',
			'manifestReadUs',
			'manifestTomlParseUs',
			'modelBuildUs',
			'nativeStoryConversionUs',
			'passageSourceUs',
			'sourceJobPrepareUs',
			'storySourceUs'
		] as const) {
			addSample(
				`${prefix}.${field.replace(/Us$/, 'Ms')}`,
				typeof event.detail?.[field] === 'number'
					? event.detail[field] / 1000
					: undefined
			);
		}
		for (const field of [
			'manifestCacheBytes',
			'passageSourceCount',
			'sourceBytes',
			'storySourceCount',
			'workerCount'
		] as const) {
			addSample(
				`${prefix}.${field}`,
				typeof event.detail?.[field] === 'number'
					? event.detail[field]
					: undefined
			);
		}
	}
	addSample(
		'startup.hydratedMs',
		lastEntry(snapshot, 'open-to-hydrated', 'measure')?.duration
	);
	addSample(
		'startup.interactiveMs',
		openStart === undefined
			? undefined
			: Math.max(sessionReady ?? openStart, graphVisible ?? openStart) -
					openStart
	);
	addSample(
		'startup.graphVisibleMs',
		openStart === undefined || graphVisible === undefined
			? undefined
			: graphVisible - openStart
	);
	addSample(
		'startupMemory.wasmLinearMiB',
		snapshot.renderer.bridgeMetrics
			.map(metric => metric.wasmMemoryBytes ?? 0)
			.reduce((largest, value) => Math.max(largest, value), 0) /
			1024 /
			1024
	);
	const initializedSession = snapshot.renderer.bridgeMetrics.find(
		metric => metric.kind === 'replaceProject'
	);
	if (initializedSession?.readModel) {
		for (const field of [
			'analysisCacheSourceCount',
			'historyBytes',
			'passageCount',
			'redoEntryCount',
			'undoEntryCount'
		] as const) {
			addSample(
				`startupEntities.rust.${field}`,
				initializedSession.readModel[field]
			);
		}
	}
	const memoryCheckpoints = new Map(
		(snapshot.main.memoryCheckpoints ?? []).map(checkpoint => [
			checkpoint.name,
			checkpoint
		])
	);
	const baselineMemory = memoryCheckpoints.get('open-start');
	const baselineByRole = baselineMemory
		? processWorkingSetByRole(baselineMemory.appMetrics)
		: new Map<string, number>();

	for (const checkpoint of memoryCheckpoints.values()) {
		const workingSetKiB = checkpoint.appMetrics.reduce(
			(total, metric) => total + (metric.memory?.workingSetSize ?? 0),
			0
		);

		addSample(
			`startupMemory.${checkpoint.name}.residentMiB`,
			workingSetKiB > 0
				? workingSetKiB / 1024
				: checkpoint.mainMemory.rss / 1024 / 1024
		);
		for (const [role, workingSetKiB] of processWorkingSetByRole(
			checkpoint.appMetrics
		)) {
			addSample(
				`startupMemory.${checkpoint.name}.process.${role.toLowerCase()}MiB`,
				workingSetKiB / 1024
			);
			const baselineKiB = baselineByRole.get(role);

			addSample(
				`startupMemory.${checkpoint.name}.projectDelta.${role.toLowerCase()}MiB`,
				baselineKiB === undefined
					? undefined
					: (workingSetKiB - baselineKiB) / 1024
			);
		}
		addSample(
			`startupMemory.${checkpoint.name}.rendererHeapMiB`,
			typeof checkpoint.renderer.usedJSHeapSize === 'number'
				? checkpoint.renderer.usedJSHeapSize / 1024 / 1024
				: undefined
		);
		addSample(
			`startupMemory.${checkpoint.name}.mainHeapMiB`,
			typeof checkpoint.mainHeap.used_heap_size === 'number'
				? checkpoint.mainHeap.used_heap_size / 1024 / 1024
				: undefined
		);
	}
	captureMemory(snapshot);
}

function processWorkingSetByRole(
	metrics: PerformanceSnapshot['main']['appMetrics']
) {
	const result = new Map<string, number>();

	for (const metric of metrics) {
		result.set(
			metric.type,
			(result.get(metric.type) ?? 0) + (metric.memory?.workingSetSize ?? 0)
		);
	}
	return result;
}

async function waitForEvent(
	page: Page,
	name: string,
	previousCount = 0,
	timeout = 60_000
) {
	await pollSnapshot(
		page,
		current =>
			current.renderer.events.filter(event => event.name === name).length >
			previousCount,
		timeout
	);
}

async function waitForCorrelatedEvent(
	page: Page,
	name: string,
	deltaId: string,
	timeout = 60_000
) {
	return pollSnapshot(
		page,
		current =>
			current.renderer.events.some(
				event => event.name === name && event.detail?.deltaId === deltaId
			),
		timeout
	);
}

async function waitForRevisionEvent(
	page: Page,
	names: string[],
	revision: number,
	timeout = 60_000
) {
	return pollSnapshot(
		page,
		current =>
			current.renderer.events.some(
				event =>
					names.includes(event.name) && event.detail?.revision === revision
			),
		timeout
	);
}

async function waitForDiagnosticSaveCompletion(
	page: Page,
	revision: number,
	timeout = 60_000
) {
	return pollSnapshot(
		page,
		current =>
			current.renderer.events.some(
				event =>
					event.name === 'save-acknowledgement-complete' &&
					event.detail?.revision === revision
			) &&
			current.renderer.events.some(
				event => event.name === 'save-native-timings'
			),
		timeout
	);
}

async function waitForAssetWatcherReview(page: Page, timeout = 60_000) {
	const current = await pollSnapshot(
		page,
		snapshot =>
			snapshot.renderer.events.some(
				event => event.name === 'watcher-review-required'
			) && snapshot.main.watcherMetrics.some(metric => metric.assetChanges > 0),
		timeout
	);
	const metric = current.main.watcherMetrics
		.filter(metric => metric.assetChanges > 0)
		.at(-1);
	const deltaId =
		metric?.deltaId ??
		(current.renderer.events
			.filter(event => event.name === 'watcher-review-required')
			.at(-1)?.detail?.deltaId as string | undefined);

	return {current, deltaId, metric};
}

async function waitForMeasure(page: Page, name: string) {
	await page.waitForFunction(
		measureName =>
			performance
				.getEntriesByName(`twine:${measureName}`)
				.some(entry => entry.entryType === 'measure'),
		name,
		{timeout: 60_000}
	);
}

async function waitForMark(page: Page, name: string) {
	await page.waitForFunction(
		markName =>
			performance
				.getEntriesByName(`twine:${markName}`)
				.some(entry => entry.entryType === 'mark'),
		name,
		{timeout: 60_000}
	);
}

async function currentRevision(page: Page) {
	const current = await snapshot(page);

	return current.renderer.core.hosts[0]?.sessions[0]?.revision ?? 0;
}

async function waitForRevisionAfter(page: Page, previous: number) {
	const current = await pollSnapshot(
		page,
		snapshot =>
			(snapshot.renderer.core.hosts[0]?.sessions[0]?.revision ?? 0) > previous
	);
	return current.renderer.core.hosts[0]?.sessions[0]?.revision ?? 0;
}

async function waitForDiagnosticWarmup(page: Page) {
	await pollSnapshot(
		page,
		current =>
			(current.renderer.core.hosts[0]?.sessions[0]?.revision ?? 0) >= 1 &&
			current.renderer.entries.some(
				event => event.name === 'session-baseline-ready'
			) &&
			current.renderer.entries.some(
				event => event.name === 'session-initialization-complete'
			) &&
			current.renderer.entries.some(
				entry => entry.name === 'all-passages-ready'
			),
		180_000
	);
}

async function waitForInitialReadModelSettle(page: Page) {
	// Startup readiness intentionally precedes nonessential dock queries. Give
	// those effects one turn to submit, then wait until their worker requests and
	// mutation queue are both drained so editor deltas are measured separately.
	await page.waitForTimeout(500);
	await pollSnapshot(
		page,
		current => {
			const client = current.renderer.core.hosts[0]?.client;

			return (
				client?.pendingRequestCount === 0 && client?.sessionQueueCount === 0
			);
		},
		10 * 60 * 1000
	);
}

function workerClients(current: PerformanceSnapshot) {
	return current.renderer.core.hosts.flatMap(host =>
		host.client ? [host.client] : []
	);
}

async function waitForWorkerIdle(
	page: Page,
	timeout = smoke ? 3 * 60 * 1000 : 10 * 60 * 1000
) {
	return pollSnapshot(
		page,
		current => {
			const clients = workerClients(current);

			return (
				clients.length > 0 &&
				clients.every(
					client =>
						client.pendingRequestCount === 0 && client.sessionQueueCount === 0
				)
			);
		},
		timeout
	);
}

function pendingPersistenceRevisions(current: PerformanceSnapshot) {
	const terminalRevisions = new Set(
		current.renderer.events.flatMap(event =>
			[
				'save-acknowledgement-complete',
				'save-acknowledgement-failed',
				'persistence-save-failed'
			].includes(event.name) && typeof event.detail?.revision === 'number'
				? [event.detail.revision]
				: []
		)
	);

	return Array.from(
		new Set(
			current.renderer.events.flatMap(event =>
				event.name === 'persistence-save-queued' &&
				typeof event.detail?.revision === 'number'
					? [event.detail.revision]
					: []
			)
		)
	).filter(revision => !terminalRevisions.has(revision));
}

async function waitForPersistenceIdle(
	page: Page,
	timeout = smoke ? 3 * 60 * 1000 : 10 * 60 * 1000
) {
	return pollSnapshot(
		page,
		current => pendingPersistenceRevisions(current).length === 0,
		timeout
	);
}

async function waitForContentsQueryPaintAfter(
	page: Page,
	startedAt: number,
	timeout = 60_000
) {
	return pollSnapshot(
		page,
		current => {
			const submit = lastEntry(current, 'contents-page-query-submit', 'mark');
			const result = lastEntry(current, 'contents-page-query-result', 'mark');
			const paintEnd = lastEntry(
				current,
				'contents-page-result-to-paint-end',
				'mark'
			);
			const resultToPaint = lastEntry(
				current,
				'contents-page-result-to-paint',
				'measure'
			);
			const visible = lastEntry(current, 'contents-visible', 'mark');

			return (
				!!submit &&
				!!result &&
				!!paintEnd &&
				!!resultToPaint &&
				!!visible &&
				submit.startTime >= startedAt &&
				result.startTime >= submit.startTime &&
				paintEnd.startTime >= result.startTime &&
				visible.startTime >= result.startTime
			);
		},
		timeout
	);
}

async function waitForMarkAfter(
	page: Page,
	name: string,
	startedAt: number,
	afterName?: string,
	timeout = 60_000
) {
	return pollSnapshot(
		page,
		current => {
			const mark = lastEntry(current, name, 'mark');
			const after = afterName
				? lastEntry(current, afterName, 'mark')
				: undefined;

			return (
				!!mark &&
				mark.startTime >= startedAt &&
				(!afterName ||
					(!!after &&
						after.startTime >= startedAt &&
						mark.startTime >= after.startTime))
			);
		},
		timeout
	);
}

async function waitForWatcherMetric(
	page: Page,
	expectedPath: string,
	timeout = 10 * 60 * 1000
) {
	const current = await pollSnapshot(
		page,
		snapshot =>
			snapshot.main.watcherMetrics.some(metric =>
				metric.changedPaths.includes(expectedPath)
			),
		timeout
	);
	return current.main.watcherMetrics
		.filter(metric => metric.changedPaths.includes(expectedPath))
		.at(-1)!;
}

async function settleInitialWatcherReview(page: Page) {
	const acceptDisk = page.getByRole('button', {name: 'Accept Disk'});
	await page.waitForTimeout(750);

	if (!(await acceptDisk.isVisible())) {
		return;
	}

	const before = await snapshot(page);
	const deltaId = before.renderer.events
		.filter(event => event.name === 'watcher-review-required')
		.at(-1)?.detail?.deltaId;

	await acceptDisk.click();
	await expect(acceptDisk).not.toBeVisible({timeout: watcherTimeout});
	if (typeof deltaId === 'string') {
		await pollSnapshot(
			page,
			current =>
				current.renderer.events.some(
					event =>
						event.name === 'watcher-acknowledgement-complete' &&
						event.detail?.deltaId === deltaId
				),
			watcherTimeout
		);
	}
}

async function measureEdits(page: Page) {
	await page
		.getByRole('group', {name: 'Workspace Mode'})
		.getByRole('tab', {name: 'Text'})
		.click();
	const editorWindow = page.locator('.story-edit-editor-window').first();
	const editor = editorWindow
		.locator('[data-testid^="story-editor-window-"]')
		.first();

	await expect(editor).toBeVisible({timeout: 60_000});
	const content = editor.locator('.cm-content');
	const revisions: number[] = [];
	let cleanMeasuredSamples = 0;
	let externallyContaminatedSamples = 0;

	for (let index = 0; index < (smoke ? 3 : 22); index++) {
		await recordLaunchPhase('benchmark-sample-started', {
			index,
			phase,
			surface: 'edit'
		});
		await reset(page);
		const bridgeMetricStart = (await snapshot(page)).renderer.bridgeMetrics
			.length;
		let previousRevision = await currentRevision(page);
		await content.click();
		await page.keyboard.press('End');
		await page.keyboard.insertText(` perf-${index}`);
		await waitForEvent(page, 'mutation-applied');
		await waitForMeasure(page, 'mutation-to-paint');
		previousRevision = await waitForRevisionAfter(page, previousRevision);
		revisions.push(previousRevision);
		let current = await snapshot(page);
		const editRoundTripMs = lastEntry(
			current,
			'mutation-round-trip',
			'measure'
		)?.duration;
		const editPaintMs = lastEntry(
			current,
			'mutation-to-paint',
			'measure'
		)?.duration;
		const undo = page.getByRole('button', {name: /^Undo/});

		await expect(undo).toBeEnabled();
		await undo.click();
		await waitForEvent(page, 'undo-applied');
		previousRevision = await waitForRevisionAfter(page, previousRevision);
		revisions.push(previousRevision);
		current = await snapshot(page);
		const undoRoundTripMs = lastEntry(
			current,
			'undo-round-trip',
			'measure'
		)?.duration;
		const redo = page.getByRole('button', {name: /^Redo/});

		await expect(redo).toBeEnabled();
		await redo.click();
		await waitForEvent(page, 'redo-applied');
		previousRevision = await waitForRevisionAfter(page, previousRevision);
		revisions.push(previousRevision);
		current = await snapshot(page);
		const redoRoundTripMs = lastEntry(
			current,
			'redo-round-trip',
			'measure'
		)?.duration;
		const externalIngestMetrics = current.renderer.bridgeMetrics
			.slice(bridgeMetricStart)
			.filter(metric =>
				['applyExternalDelta', 'ingestExternalDelta'].includes(metric.kind)
			);

		if (index >= 2) {
			if (externalIngestMetrics.length === 0) {
				cleanMeasuredSamples++;
				addSample('edit.roundTripMs', editRoundTripMs);
				addSample('edit.paintMs', editPaintMs);
				addSample('undo.roundTripMs', undoRoundTripMs);
				addSample('redo.roundTripMs', redoRoundTripMs);
			} else {
				externallyContaminatedSamples++;
				addSample(
					'edit.externalIngestContaminated.roundTripMs',
					editRoundTripMs
				);
				addSample('edit.externalIngestContaminated.paintMs', editPaintMs);
				addSample(
					'undo.externalIngestContaminated.roundTripMs',
					undoRoundTripMs
				);
				addSample(
					'redo.externalIngestContaminated.roundTripMs',
					redoRoundTripMs
				);
			}
			for (const metric of externalIngestMetrics) {
				addSample('edit.externalIngest.roundTripMs', metric.roundTripMs);
				addSample('edit.externalIngest.computeMs', metric.computeMs);
				addSample('edit.externalIngest.queuedMs', metric.queuedMs);
			}
		}
		assertInvariant(
			`edit-${index}-avoids-full-replace`,
			!current.renderer.bridgeMetrics.some(
				metric => metric.kind === 'replaceProject'
			)
		);
		captureBridgeMetrics(current);
		await recordLaunchPhase('benchmark-sample-completed', {
			index,
			phase,
			surface: 'edit'
		});
	}

	assertInvariant(
		'edit-clean-sample-coverage',
		cleanMeasuredSamples > 0,
		`${cleanMeasuredSamples} clean; ${externallyContaminatedSamples} external-ingest-contaminated`
	);
	assertInvariant(
		'edit-ordinary-timings-exclude-external-ingest',
		(samples['edit.roundTripMs']?.length ?? 0) === cleanMeasuredSamples &&
			(samples['edit.paintMs']?.length ?? 0) === cleanMeasuredSamples,
		`${samples['edit.roundTripMs']?.length ?? 0}/${cleanMeasuredSamples} round trips; ${
			samples['edit.paintMs']?.length ?? 0
		}/${cleanMeasuredSamples} paints`
	);
	addSample('edit.cleanSampleCount', cleanMeasuredSamples);
	addSample(
		'edit.externalIngestContaminatedSampleCount',
		externallyContaminatedSamples
	);
	assertInvariant(
		'edit-undo-redo-revisions-monotonic',
		revisions.every(
			(value, index) => index === 0 || value > revisions[index - 1]
		),
		revisions.slice(-6).join(', ')
	);
	const finalRevision = revisions.at(-1);

	if (finalRevision !== undefined) {
		const persisted = await waitForRevisionEvent(
			page,
			['save-acknowledgement-complete', 'persistence-save-failed'],
			finalRevision,
			watcherTimeout
		);

		capturePersistenceMetrics(persisted);
		captureNativeSaveMetrics(persisted);
		assertInvariant(
			'edit-final-revision-persisted',
			persisted.renderer.events.some(
				event =>
					event.name === 'save-acknowledgement-complete' &&
					event.detail?.revision === finalRevision
			),
			`revision ${finalRevision}`
		);
	}
}

async function measureDiagnostic(page: Page, launchToWindowMs: number) {
	const startupSnapshot = await snapshot(page);

	startupMetrics(startupSnapshot, launchToWindowMs);
	diagnostics.startup.push(startupSnapshot);
	assertInvariant(
		'wasm-worker-mode-active',
		startupSnapshot.renderer.core.hosts.length === 1 &&
			startupSnapshot.renderer.core.hosts[0].mode === 'wasm-worker'
	);
	assertInvariant(
		'one-project-one-session-worker',
		startupSnapshot.renderer.core.workerClients === 1 &&
			startupSnapshot.renderer.core.activeSessions === 1
	);
	assertInvariant(
		'react-passage-body-mirror-empty',
		startupSnapshot.renderer.core.hosts[0].sessions.every(
			session => session.passageTextCharacterCount === 0
		)
	);

	await waitForDiagnosticWarmup(page);
	await reset(page);
	await page
		.getByRole('group', {name: 'Workspace Mode'})
		.getByRole('tab', {name: 'Text'})
		.click();
	await waitForEvent(page, 'core-passage-document-ready');
	const editor = page.locator('[data-testid^="story-editor-window-"]').first();

	await expect(editor).toBeVisible();
	const content = editor.locator('.cm-content');
	const previousRevision = await currentRevision(page);
	const bridgeMetricStart = (await snapshot(page)).renderer.bridgeMetrics
		.length;

	await content.click();
	await page.keyboard.press('End');
	await page.keyboard.insertText(' diagnostic-save-profile');
	await waitForEvent(page, 'mutation-applied');
	await waitForMeasure(page, 'mutation-to-paint');
	const finalRevision = await waitForRevisionAfter(page, previousRevision);
	const mutationSnapshot = await snapshot(page);

	addSample(
		'edit.roundTripMs',
		lastEntry(mutationSnapshot, 'mutation-round-trip', 'measure')?.duration
	);
	addSample(
		'edit.paintMs',
		lastEntry(mutationSnapshot, 'mutation-to-paint', 'measure')?.duration
	);
	assertInvariant(
		'diagnostic-edit-revision-monotonic',
		finalRevision > previousRevision,
		`${previousRevision} -> ${finalRevision}`
	);

	const persisted = await waitForDiagnosticSaveCompletion(
		page,
		finalRevision,
		watcherTimeout
	);
	const queuedSaves = persisted.renderer.events.filter(
		event =>
			event.name === 'persistence-save-queued' &&
			event.detail?.revision === finalRevision
	);

	capturePersistenceMetrics(persisted);
	captureNativeSaveMetrics(persisted);
	captureBridgeMetrics(persisted);
	captureMemory(persisted);
	diagnostics.interaction = persisted;
	assertInvariant(
		'diagnostic-final-revision-persisted',
		persisted.renderer.events.some(
			event =>
				event.name === 'save-acknowledgement-complete' &&
				event.detail?.revision === finalRevision
		),
		`revision ${finalRevision}`
	);
	assertInvariant(
		'diagnostic-one-save-for-final-revision',
		queuedSaves.length === 1,
		`revision ${finalRevision}; saves ${queuedSaves.length}`
	);
	assertInvariant(
		'diagnostic-save-stage-timings-present',
		persisted.renderer.events.some(
			event => event.name === 'save-native-timings'
		)
	);
	assertInvariant(
		'diagnostic-save-uses-incremental-mode',
		persisted.renderer.events.some(
			event =>
				event.name === 'save-native-timings' &&
				event.detail?.mode === 'incremental'
		)
	);
	assertInvariant(
		'diagnostic-save-touches-one-path',
		persisted.renderer.events.some(
			event =>
				event.name === 'save-native-timings' &&
				event.detail?.touchedPathCount === 1
		)
	);
	assertInvariant(
		'diagnostic-avoids-full-replace',
		!persisted.renderer.bridgeMetrics
			.slice(bridgeMetricStart)
			.some(metric => metric.kind === 'replaceProject')
	);
	const mutationMetric = persisted.renderer.bridgeMetrics
		.slice(bridgeMetricStart)
		.filter(metric => metric.kind === 'apply')
		.at(-1);
	assertInvariant(
		'diagnostic-read-model-attribution-present',
		!!mutationMetric?.readModel,
		JSON.stringify(mutationMetric?.readModel)
	);
	assertInvariant(
		'diagnostic-read-model-update-is-bounded',
		(mutationMetric?.readModel?.readModelLastTouchedSourceCount ?? 0) <= 1,
		JSON.stringify(mutationMetric?.readModel)
	);
}

async function measureMemoryDetail(page: Page, launchToWindowMs: number) {
	const startupSnapshot = await snapshot(page);

	startupMetrics(startupSnapshot, launchToWindowMs);
	diagnostics.startup.push(startupSnapshot);
	await waitForDiagnosticWarmup(page);
	await reset(page);
	await recordMemoryDetailCheckpoint(page, 'pre-read-model-settle', true);
	await waitForInitialReadModelSettle(page);
	await recordMemoryDetailCheckpoint(page, 'before-editor', true);

	await page
		.getByRole('group', {name: 'Workspace Mode'})
		.getByRole('tab', {name: 'Text'})
		.click();
	const editorWindow = page.locator('.story-edit-editor-window').first();
	const editor = editorWindow
		.locator('[data-testid^="story-editor-window-"]')
		.first();

	await expect(editor).toBeVisible({timeout: 60_000});
	await recordMemoryDetailCheckpoint(page, 'editor-open');
	await recordMemoryDetailCheckpoint(page, 'post-editor-gc', true);

	const content = editor.locator('.cm-content');
	const previousRevision = await currentRevision(page);

	await content.click();
	await page.keyboard.press('End');
	await page.keyboard.insertText(' memory-detail-profile');
	await waitForEvent(page, 'mutation-applied');
	await waitForMeasure(page, 'mutation-to-paint');
	await recordMemoryDetailCheckpoint(page, 'post-edit-paint');
	const revision = await waitForRevisionAfter(page, previousRevision);

	await waitForDiagnosticSaveCompletion(page, revision, watcherTimeout);
	await recordMemoryDetailCheckpoint(page, 'post-save-acknowledgement');
	await recordMemoryDetailCheckpoint(page, 'post-edit-gc', true);

	await editorWindow.getByRole('button', {name: /^Close /}).click();
	await expect(editorWindow).not.toBeVisible();
	await recordMemoryDetailCheckpoint(page, 'editor-closed');
	await recordMemoryDetailCheckpoint(page, 'post-editor-close-gc', true);

	await page.getByTitle('Contents').click();
	await expect(page.getByLabel('Contents', {exact: true})).toBeVisible();
	await waitForMark(page, 'contents-visible');
	await recordMemoryDetailCheckpoint(page, 'contents-open');
	await page.getByTitle('Workbench').click();
	await expect(page.locator('.story-edit-workspace')).toBeVisible();
	await waitForInitialReadModelSettle(page);
	await recordMemoryDetailCheckpoint(page, 'post-contents-close-gc', true);

	const current = await snapshot(page);
	const checkpointByName = new Map(
		current.main.memoryCheckpoints.map(checkpoint => [
			checkpoint.name,
			checkpoint
		])
	);
	const postEditor = checkpointByName.get('post-editor-gc');
	const postEdit = checkpointByName.get('post-edit-gc');
	const postClose = checkpointByName.get('post-editor-close-gc');
	const postContents = checkpointByName.get('post-contents-close-gc');
	const client = current.renderer.core.hosts[0]?.client;
	const localFactsMetric = current.renderer.bridgeMetrics
		.filter(metric => metric.kind === 'queryPassageLocalFacts')
		.at(-1);
	const backlinkMetric = current.renderer.bridgeMetrics
		.filter(metric => metric.kind === 'queryBacklinksPage')
		.at(-1);

	captureMemory(current);
	captureMemoryDetailCheckpoints(current);
	captureBridgeMetrics(current);
	diagnostics.memoryDetail = current;
	assertInvariant(
		'memory-detail-checkpoints-present',
		[
			'pre-read-model-settle',
			'before-editor',
			'editor-open',
			'post-editor-gc',
			'post-edit-paint',
			'post-save-acknowledgement',
			'post-edit-gc',
			'editor-closed',
			'post-editor-close-gc',
			'contents-open',
			'post-contents-close-gc'
		].every(name => checkpointByName.has(name))
	);
	assertInvariant(
		'memory-detail-one-active-editor',
		postEditor?.renderer.activeEditorCount === 1,
		JSON.stringify(postEditor?.renderer)
	);
	assertInvariant(
		'memory-detail-editor-released',
		postClose?.renderer.activeEditorCount === 0 &&
			postClose?.renderer.editorDocumentBytes === 0,
		JSON.stringify(postClose?.renderer)
	);
	assertInvariant(
		'memory-detail-edit-keeps-analysis-bounded',
		(postEdit?.renderer.rustAnalysisCacheSourceCount ?? Infinity) <= 1 &&
			postEdit?.renderer.rustReadModelCacheStoryCount === 0,
		JSON.stringify(postEdit?.renderer)
	);
	assertInvariant(
		'memory-detail-selected-passage-uses-bounded-queries',
		!!localFactsMetric &&
			!!backlinkMetric &&
			localFactsMetric.responseBytes <= 32 * 1024 &&
			(backlinkMetric.readModel?.backlinkCacheEntryCount ?? Infinity) <= 1 &&
			(backlinkMetric.readModel?.backlinkCacheBytes ?? Infinity) <=
				4 * 1024 * 1024 &&
			!current.renderer.bridgeMetrics.some(
				metric => metric.kind === 'queryPassageFacts'
			),
		JSON.stringify({backlinkMetric, localFactsMetric})
	);
	assertInvariant(
		'memory-detail-default-contents-stays-bounded',
		(postContents?.renderer.rustAnalysisCacheSourceCount ?? Infinity) <= 2 &&
			postContents?.renderer.rustGraphCacheStoryCount === 0 &&
			postContents?.renderer.rustReadModelCacheStoryCount === 0,
		JSON.stringify(postContents?.renderer)
	);
	assertInvariant(
		'memory-detail-no-pending-worker-requests',
		client?.pendingRequestCount === 0,
		JSON.stringify(client)
	);
	assertInvariant(
		'memory-detail-no-session-queue',
		client?.sessionQueueCount === 0,
		JSON.stringify(client)
	);
	assertInvariant(
		'memory-detail-bootstrap-released',
		current.renderer.core.bootstrap?.textBytes === 0
	);
	assertInvariant(
		'memory-detail-native-hydration-released',
		current.main.owners?.nativeHydration?.activeLeaseCount === 0
	);
}

async function measureContents(page: Page) {
	for (let index = 0; index < (smoke ? 3 : 22); index++) {
		await recordLaunchPhase('benchmark-sample-started', {
			index,
			phase,
			surface: 'contents'
		});
		await page.getByTitle('Workbench').click();
		await expect(page.locator('.story-edit-workspace')).toBeVisible();
		await reset(page);
		const startedAt = await page.evaluate(() => performance.now());

		await page.getByTitle('Contents').click();
		await expect(page.getByLabel('Contents', {exact: true})).toBeVisible();
		await waitForContentsQueryPaintAfter(page, startedAt);
		await expect(page.locator('.contents-route__row').first()).toBeVisible({
			timeout: 60_000
		});
		const current = await snapshot(page);
		const querySubmit = lastEntry(
			current,
			'contents-page-query-submit',
			'mark'
		);
		const queryResult = lastEntry(
			current,
			'contents-page-query-result',
			'mark'
		);
		const resultToPaint = lastEntry(
			current,
			'contents-page-result-to-paint',
			'measure'
		);
		const contentsVisible = lastEntry(current, 'contents-visible', 'mark');
		const contentsTrace = current.renderer.events
			.filter(
				event =>
					event.name === 'core-read-model-query' &&
					event.detail?.kind === 'queryContentsPage'
			)
			.at(-1);
		const hostCacheHit = current.renderer.events
			.filter(
				event =>
					event.name === 'core-read-model-host-cache-hit' &&
					event.detail?.kind === 'queryContentsPage'
			)
			.at(-1);
		const sessionReadyTrace = current.renderer.events
			.filter(event => event.name === 'core-session-ready')
			.at(-1);

		assertInvariant(
			`contents-${index}-matching-result-painted`,
			!!querySubmit &&
				!!queryResult &&
				!!resultToPaint &&
				!!contentsVisible &&
				queryResult.startTime >= querySubmit.startTime &&
				contentsVisible.startTime >= queryResult.startTime,
			JSON.stringify({contentsVisible, queryResult, querySubmit, resultToPaint})
		);
		if (index === 0) {
			addSample(
				'query.contentsColdMs',
				contentsVisible ? contentsVisible.startTime - startedAt : undefined
			);
			addSample(
				'query.contentsColdRequestMs',
				lastEntry(current, 'contents-page-query-round-trip', 'measure')
					?.duration
			);
			addSample('query.contentsColdResultToPaintMs', resultToPaint?.duration);
		} else if (index >= 2) {
			addSample(
				'query.contentsMs',
				contentsVisible ? contentsVisible.startTime - startedAt : undefined
			);
			addSample(
				'query.contentsWarmMs',
				contentsVisible ? contentsVisible.startTime - startedAt : undefined
			);
			addSample(
				'query.contentsRequestMs',
				lastEntry(current, 'contents-page-query-round-trip', 'measure')
					?.duration
			);
			addSample(
				'query.contentsNavigationToCommitMs',
				lastEntry(current, 'contents-navigation-to-commit', 'measure')?.duration
			);
			addSample(
				'query.contentsCommitToRequestMs',
				lastEntry(current, 'contents-commit-to-query-submit', 'measure')
					?.duration
			);
			addSample(
				'query.contentsResultToPaintMs',
				lastEntry(current, 'contents-page-result-to-paint', 'measure')?.duration
			);
			addSample(
				'query.contentsSessionQueueMs',
				contentsTrace
					? numericDetail(contentsTrace.detail?.queueWaitMs)
					: hostCacheHit
						? 0
						: undefined
			);
			addSample(
				'query.contentsSessionReadyMs',
				sessionReadyTrace
					? numericDetail(sessionReadyTrace.detail?.durationMs)
					: hostCacheHit
						? 0
						: undefined
			);
			addSample(
				'query.coreRoundTripMs',
				current.renderer.bridgeMetrics
					.filter(metric => metric.kind === 'queryContentsPage')
					.at(-1)?.roundTripMs
			);
		}
		const contentsMetrics = current.renderer.bridgeMetrics.filter(
			metric => metric.kind === 'queryContentsPage'
		);
		assertInvariant(
			`contents-${index}-queue-attribution-present`,
			!!contentsTrace || !!hostCacheHit,
			contentsTrace?.detail?.waitingOn as string | undefined
		);
		assertInvariant(
			`contents-${index}-session-ready-attribution-present`,
			!!sessionReadyTrace || !!hostCacheHit,
			sessionReadyTrace?.detail?.mode as string | undefined
		);
		assertInvariant(
			`contents-${index}-uses-wasm-worker`,
			current.renderer.core.hosts[0]?.mode === 'wasm-worker' &&
				contentsMetrics.every(metric => metric.mode === 'wasm-worker'),
			contentsMetrics.length === 0
				? 'served from the Rust session cache'
				: undefined
		);
		assertInvariant(
			`contents-${index}-avoids-full-index-transfer`,
			passageCount <= 500 ||
				!current.renderer.bridgeMetrics.some(
					metric => metric.kind === 'queryStoryIndex'
				)
		);
		assertInvariant(
			`contents-${index}-payload-is-bounded`,
			contentsMetrics.every(metric => metric.responseBytes <= 1_000_000),
			contentsMetrics.map(metric => metric.responseBytes).join(', ')
		);
		assertInvariant(
			`contents-${index}-uses-compact-catalog`,
			contentsMetrics.every(
				metric =>
					!!metric.readModel &&
					metric.readModel.analysisCacheSourceCount <= 1 &&
					metric.readModel.graphCacheStoryCount === 0 &&
					metric.readModel.readModelCacheStoryCount === 0 &&
					metric.readModel.readModelFullBuildCount === 0
			),
			JSON.stringify(contentsMetrics.map(metric => metric.readModel))
		);
		addSample(
			'query.contentsPayloadBytes',
			contentsMetrics.at(-1)?.responseBytes
		);
		captureBridgeMetrics(current);
		await waitForWorkerIdle(page);
		await recordLaunchPhase('benchmark-sample-completed', {
			index,
			phase,
			surface: 'contents'
		});
	}
	const idle = await waitForWorkerIdle(page);
	const clients = workerClients(idle);

	assertInvariant(
		'contents-phase-worker-idle',
		clients.length > 0 &&
			clients.every(
				client =>
					client.pendingRequestCount === 0 && client.sessionQueueCount === 0
			),
		JSON.stringify(clients)
	);
}

async function measureSearch(page: Page) {
	const input = page.getByLabel('Filter contents');

	await expect(input).toBeVisible();
	for (let index = 0; index < (smoke ? 3 : 22); index++) {
		await recordLaunchPhase('benchmark-sample-started', {
			index,
			phase,
			surface: 'search'
		});
		if (await input.inputValue()) {
			const clearStartedAt = await page.evaluate(() => performance.now());

			await input.fill('');
			await waitForContentsQueryPaintAfter(page, clearStartedAt);
			await waitForWorkerIdle(page);
		}
		await reset(page);
		const startedAt = await page.evaluate(() => performance.now());

		await input.fill(`Passage ${String((index % 9) + 1).padStart(6, '0')}`);
		await waitForContentsQueryPaintAfter(page, startedAt);
		await expect(page.locator('.contents-route__row').first()).toBeVisible({
			timeout: 60_000
		});
		await waitForMarkAfter(
			page,
			'contents-search-visible',
			startedAt,
			'contents-page-query-result'
		);
		const current = await snapshot(page);

		if (index >= 2) {
			addSample(
				'query.searchMs',
				lastEntry(current, 'contents-search-visible', 'mark')!.startTime -
					startedAt
			);
		}
		await recordLaunchPhase('benchmark-sample-completed', {
			index,
			phase,
			surface: 'search'
		});
	}
	const idle = await waitForWorkerIdle(page);
	const clients = workerClients(idle);

	assertInvariant(
		'query-phase-worker-idle',
		clients.length > 0 &&
			clients.every(
				client =>
					client.pendingRequestCount === 0 && client.sessionQueueCount === 0
			),
		JSON.stringify(clients)
	);
}

function capturePersistenceMetrics(current: PerformanceSnapshot) {
	const revisions = new Set(
		current.renderer.events.flatMap(event =>
			typeof event.detail?.revision === 'number' ? [event.detail.revision] : []
		)
	);

	for (const revision of revisions) {
		const event = (name: string) =>
			current.renderer.events.find(
				candidate =>
					candidate.name === name && candidate.detail?.revision === revision
			);
		const queued = event('persistence-save-queued');
		const started = event('persistence-save-started');
		const completed = event('persistence-save-completed');
		const notified = event('persistence-save-notified');
		const acknowledgementStarted = event('save-acknowledgement-start');
		const acknowledgementCompleted = event('save-acknowledgement-complete');

		addSample(
			'persistence.queueMs',
			queued && started ? started.epochTime - queued.epochTime : undefined
		);
		addSample(
			'persistence.saveMs',
			started && completed ? completed.epochTime - started.epochTime : undefined
		);
		addSample(
			'persistence.notifyMs',
			completed && notified
				? notified.epochTime - completed.epochTime
				: undefined
		);
		addSample(
			'persistence.acknowledgementMs',
			acknowledgementStarted && acknowledgementCompleted
				? acknowledgementCompleted.epochTime - acknowledgementStarted.epochTime
				: undefined
		);
		addSample(
			'save.acknowledgementMs',
			acknowledgementStarted && acknowledgementCompleted
				? acknowledgementCompleted.epochTime - acknowledgementStarted.epochTime
				: undefined
		);
		addSample(
			'persistence.endToEndMs',
			queued && acknowledgementCompleted
				? acknowledgementCompleted.epochTime - queued.epochTime
				: undefined
		);
		addSample(
			'save.endToEndMs',
			queued && acknowledgementCompleted
				? acknowledgementCompleted.epochTime - queued.epochTime
				: undefined
		);
	}
}

function microsToMillis(value: unknown) {
	return typeof value === 'number' && Number.isFinite(value)
		? value / 1000
		: undefined;
}

function numericDetail(value: unknown) {
	return typeof value === 'number' && Number.isFinite(value)
		? value
		: undefined;
}

function captureNativeSaveMetrics(current: PerformanceSnapshot) {
	const timingEvents = current.renderer.events.filter(
		event => event.name === 'save-native-timings'
	);

	for (const event of timingEvents) {
		const detail = event.detail ?? {};

		addSample('save.nativeTotalMs', microsToMillis(detail.totalUs));
		addSample('save.nativeDeserializeMs', microsToMillis(detail.jsonParseUs));
		addSample('save.projectBuildMs', microsToMillis(detail.projectBuildUs));
		addSample('save.writeProjectMs', microsToMillis(detail.saveProjectPathUs));
		addSample(
			'save.collectOldFilesMs',
			microsToMillis(detail.collectOldFilesUs)
		);
		addSample(
			'save.writeTempProjectMs',
			microsToMillis(detail.writeTempProjectUs)
		);
		addSample('save.copyAssetsMs', microsToMillis(detail.copyAssetsUs));
		addSample(
			'save.collectNewFilesMs',
			microsToMillis(detail.collectNewFilesUs)
		);
		addSample('save.dirtyCompareMs', microsToMillis(detail.dirtyCompareUs));
		addSample(
			'save.changedFilePlanMs',
			microsToMillis(detail.changedFilePlanUs)
		);
		addSample('save.rootSwapMs', microsToMillis(detail.rootSwapUs));
		addSample('save.sidecarMs', microsToMillis(detail.sidecarUs));
		addSample(
			'save.baselineRefreshMs',
			microsToMillis(detail.baselineRefreshUs)
		);
		addSample('save.touchedPathCount', numericDetail(detail.touchedPathCount));
		addSample('save.conflictCheckMs', microsToMillis(detail.conflictCheckUs));
		addSample(
			'save.writeTouchedFilesMs',
			microsToMillis(detail.writeTouchedFilesUs)
		);
		addSample('save.baselinePatchMs', microsToMillis(detail.baselinePatchUs));
	}
}

async function sampleFrames(page: Page, frameCount = 90) {
	return page.evaluate(
		count =>
			new Promise<number[]>(resolve => {
				const samples: number[] = [];
				let previous = performance.now();

				function frame(now: number) {
					samples.push(now - previous);
					previous = now;
					if (samples.length >= count) {
						resolve(samples.slice(1));
					} else {
						requestAnimationFrame(frame);
					}
				}
				requestAnimationFrame(frame);
			}),
		frameCount
	);
}

async function measureGraph(page: Page) {
	await page.getByTitle('Workbench').click();
	await page
		.getByRole('complementary', {name: 'Passages'})
		.getByRole('button', {name: /^Passage 000001/})
		.click();
	await page
		.getByRole('group', {name: 'Workspace Mode'})
		.getByRole('tab', {name: 'Graph'})
		.click();
	const viewport = page.locator('.story-edit-graph-viewport');

	await expect(viewport).toBeVisible();
	const nodes = page.locator('.story-edit-graph-node');

	if ((await nodes.count()) === 0) {
		const focus = page.getByRole('button', {
			name: 'Focus selected passages'
		});

		await focus.click();
		await expect(nodes.first()).toBeVisible({timeout: 60_000});
		await page.getByRole('button', {name: 'Reveal in Graph'}).first().click();
		await focus.click();
		await expect(nodes.first()).toBeVisible({timeout: 60_000});
	}
	const nodeCount = await nodes.count();

	assertInvariant(
		'graph-viewport-node-count-bounded',
		nodeCount > 0 && nodeCount < 500,
		`${nodeCount} mounted nodes`
	);
	await waitForWorkerIdle(page);
	await waitForPersistenceIdle(page);
	await reset(page);
	const measurementStartedAtEpochMs = Date.now();
	const baselineRevision = await currentRevision(page);

	for (let index = 0; index < (smoke ? 1 : 5); index++) {
		const box = await viewport.boundingBox();

		if (!box) {
			throw new Error('Graph viewport has no bounding box.');
		}
		const framesPromise = sampleFrames(page);

		await page.keyboard.down('Space');
		await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.45, {
			steps: 20
		});
		await page.mouse.up();
		await page.keyboard.up('Space');
		const frames = await framesPromise;

		for (const frame of frames) {
			addSample('graph.frameMs', frame);
			addSample('graph.frameMaxMs', frame);
		}
	}

	const node = nodes.first();

	await expect(node).toBeVisible();
	const nodeBox = await node.boundingBox();

	if (!nodeBox) {
		throw new Error('Graph node has no bounding box.');
	}
	await page.mouse.move(
		nodeBox.x + nodeBox.width / 2,
		nodeBox.y + nodeBox.height / 2
	);
	await page.mouse.down();
	await page.mouse.move(
		nodeBox.x + nodeBox.width / 2 + 32,
		nodeBox.y + nodeBox.height / 2 + 24,
		{steps: 6}
	);
	await page.mouse.up();
	await waitForRevisionAfter(page, baselineRevision);
	await waitForWorkerIdle(page);
	const finalRevision = await currentRevision(page);
	const persisted = await waitForRevisionEvent(
		page,
		[
			'save-acknowledgement-complete',
			'save-acknowledgement-failed',
			'persistence-save-failed'
		],
		finalRevision,
		watcherTimeout
	);
	const settled = await waitForPersistenceIdle(page, watcherTimeout);
	const nativeSaves = settled.renderer.events.filter(
		event =>
			event.name === 'save-native-timings' &&
			event.epochTime >= measurementStartedAtEpochMs
	);
	const pendingRevisions = pendingPersistenceRevisions(settled);
	const clients = workerClients(settled);

	addSample('graph.layoutRevisionDelta', finalRevision - baselineRevision);
	addSample('graph.layoutSaveCount', nativeSaves.length);
	addSample(
		'graph.layoutFullSaveFallbackCount',
		nativeSaves.filter(
			event =>
				event.detail?.mode === 'full' ||
				typeof event.detail?.fallbackReason === 'string'
		).length
	);
	capturePersistenceMetrics(settled);
	captureNativeSaveMetrics(settled);
	captureBridgeMetrics(settled);
	assertInvariant(
		'graph-layout-interaction-advances-revision',
		finalRevision > baselineRevision,
		`${baselineRevision} -> ${finalRevision}`
	);
	assertInvariant(
		'graph-final-revision-persisted',
		persisted.renderer.events.some(
			event =>
				event.name === 'save-acknowledgement-complete' &&
				event.detail?.revision === finalRevision
		),
		`revision ${finalRevision}`
	);
	assertInvariant(
		'graph-layout-save-timings-present',
		nativeSaves.length > 0,
		`${nativeSaves.length} native saves`
	);
	assertInvariant(
		'graph-layout-saves-use-incremental-mode',
		nativeSaves.length > 0 &&
			nativeSaves.every(event => event.detail?.mode === 'incremental'),
		JSON.stringify(nativeSaves.map(event => event.detail))
	);
	assertInvariant(
		'graph-layout-saves-avoid-full-save-fallback',
		nativeSaves.every(
			event =>
				event.detail?.mode !== 'full' &&
				typeof event.detail?.fallbackReason !== 'string'
		),
		JSON.stringify(nativeSaves.map(event => event.detail))
	);
	assertInvariant(
		'graph-phase-no-save-in-flight',
		pendingRevisions.length === 0,
		pendingRevisions.join(', ')
	);
	assertInvariant(
		'graph-phase-worker-idle',
		clients.length > 0 &&
			clients.every(
				client =>
					client.pendingRequestCount === 0 && client.sessionQueueCount === 0
			),
		JSON.stringify(clients)
	);
}

function captureMemory(current: PerformanceSnapshot) {
	const workingSetKiB = current.main.appMetrics.reduce(
		(total, metric) => total + (metric.memory?.workingSetSize ?? 0),
		0
	);
	const rendererWorkingSetKiB = current.main.appMetrics
		.filter(metric => metric.type === 'Tab')
		.reduce((total, metric) => total + (metric.memory?.workingSetSize ?? 0), 0);

	addSample(
		'memory.residentMiB',
		workingSetKiB > 0
			? workingSetKiB / 1024
			: current.main.memory.rss / 1024 / 1024
	);
	addSample(
		'memory.rendererMiB',
		rendererWorkingSetKiB > 0 ? rendererWorkingSetKiB / 1024 : undefined
	);
	addSample('memory.mainMiB', current.main.memory.rss / 1024 / 1024);
	for (const type of ['Browser', 'GPU', 'Tab', 'Utility']) {
		const workingSet = current.main.appMetrics
			.filter(metric => metric.type === type)
			.reduce(
				(total, metric) => total + (metric.memory?.workingSetSize ?? 0),
				0
			);

		addSample(
			`memory.process.${type.toLowerCase()}MiB`,
			workingSet > 0 ? workingSet / 1024 : undefined
		);
	}
	const nativeHydration = current.main.owners?.nativeHydration;
	const projectSessions = current.main.owners?.projectSessions;

	addSample(
		'memory.owner.nativeHydrationLeaseCount',
		nativeHydration?.activeLeaseCount
	);
	addSample(
		'memory.owner.nativeHydrationTextCapacityMiB',
		nativeHydration
			? nativeHydration.textCapacityBytes / 1024 / 1024
			: undefined
	);
	addSample(
		'memory.owner.nativeBaselineFileStringMiB',
		projectSessions
			? projectSessions.baselineFileStringBytes / 1024 / 1024
			: undefined
	);
	addSample(
		'memory.owner.nativeBaselinePassageCount',
		projectSessions?.baselinePassageCount
	);
	addSample(
		'memory.owner.nativeDescriptorPathStringMiB',
		projectSessions
			? projectSessions.descriptorPathStringBytes / 1024 / 1024
			: undefined
	);
	addSample(
		'memory.owner.bootstrapTextMiB',
		current.renderer.core.bootstrap?.textBytes !== undefined
			? current.renderer.core.bootstrap.textBytes / 1024 / 1024
			: undefined
	);
	const client = current.renderer.core.hosts[0]?.client;

	addSample(
		'memory.owner.workerCachedPayloadMiB',
		client ? client.cachedPayloadBytes / 1024 / 1024 : undefined
	);
	addSample('memory.owner.workerPendingRequests', client?.pendingRequestCount);
	addSample('memory.owner.workerSessionQueues', client?.sessionQueueCount);
	addSample(
		'memory.owner.workerReadModelCacheEntries',
		client?.readModelCacheEntryCount
	);
	addSample(
		'memory.owner.activeEditorCount',
		current.renderer.owners?.activeEditorCount
	);
	addSample(
		'memory.owner.editorDocumentMiB',
		current.renderer.owners
			? current.renderer.owners.editorDocumentBytes / 1024 / 1024
			: undefined
	);
	const rust = current.renderer.bridgeMetrics
		.map(metric => metric.readModel)
		.filter(Boolean)
		.at(-1);

	addSample(
		'memory.owner.rustProjectDocumentsMiB',
		rust ? rust.projectDocumentBytes / 1024 / 1024 : undefined
	);
	addSample('memory.owner.rustAnalysisSources', rust?.analysisCacheSourceCount);
	addSample(
		'memory.owner.rustBacklinkCacheMiB',
		rust ? rust.backlinkCacheBytes / 1024 / 1024 : undefined
	);
	addSample(
		'memory.owner.rustBacklinkCacheEntries',
		rust?.backlinkCacheEntryCount
	);
	addSample('memory.owner.rustBacklinkScans', rust?.backlinkScanCount);
	addSample(
		'memory.owner.rustBacklinkScannedSources',
		rust?.backlinkScannedSourceCount
	);
	addSample('memory.owner.rustFingerprintEntries', rust?.fingerprintEntryCount);
	addSample('memory.owner.rustGraphCacheStories', rust?.graphCacheStoryCount);
	addSample(
		'memory.owner.rustReadModelCacheStories',
		rust?.readModelCacheStoryCount
	);
}

async function recordMemoryDetailCheckpoint(
	page: Page,
	name: string,
	retained = false
) {
	await page.evaluate(
		async ({checkpointName, collectRetained}) => {
			const harness = (window as any).twinePerformance;

			if (collectRetained) {
				await harness.collectRetainedMemory(checkpointName);
			} else {
				await harness.checkpoint(checkpointName);
			}
		},
		{checkpointName: name, collectRetained: retained}
	);
}

function captureMemoryDetailCheckpoints(current: PerformanceSnapshot) {
	const checkpoints = current.main.memoryCheckpoints;
	const baseline = checkpoints.find(
		checkpoint => checkpoint.name === 'before-editor'
	);
	const baselineRoles = baseline
		? processWorkingSetByRole(baseline.appMetrics)
		: new Map<string, number>();

	for (const checkpoint of checkpoints) {
		const prefix = `memoryDetail.${checkpoint.name}`;
		const workingSetKiB = checkpoint.appMetrics.reduce(
			(total, metric) => total + (metric.memory?.workingSetSize ?? 0),
			0
		);

		addSample(`${prefix}.residentMiB`, workingSetKiB / 1024);
		for (const [role, value] of processWorkingSetByRole(
			checkpoint.appMetrics
		)) {
			addSample(`${prefix}.process.${role.toLowerCase()}MiB`, value / 1024);
			addSample(
				`${prefix}.delta.${role.toLowerCase()}MiB`,
				baselineRoles.has(role)
					? (value - baselineRoles.get(role)!) / 1024
					: undefined
			);
		}
		for (const field of [
			'usedJSHeapSize',
			'totalJSHeapSize',
			'activeEditorCount',
			'editorDocumentBytes',
			'workerCachedPayloadBytes',
			'workerPendingRequestCount',
			'workerReadModelCacheEntryCount',
			'workerSessionQueueCount',
			'workerWasmMemoryBytes',
			'rustAnalysisCacheSourceCount',
			'rustBacklinkCacheBytes',
			'rustBacklinkCacheEntryCount',
			'rustBacklinkCacheHitCount',
			'rustBacklinkScanCount',
			'rustBacklinkScannedSourceCount',
			'rustFingerprintEntryCount',
			'rustGraphCacheStoryCount',
			'rustProjectDocumentBytes',
			'rustReadModelCacheStoryCount'
		]) {
			addSample(
				`${prefix}.renderer.${field}`,
				typeof checkpoint.renderer[field] === 'number'
					? checkpoint.renderer[field]
					: undefined
			);
		}
		for (const field of ['heapUsed', 'heapTotal', 'external', 'arrayBuffers']) {
			addSample(
				`${prefix}.main.${field}`,
				typeof checkpoint.mainMemory[field] === 'number'
					? checkpoint.mainMemory[field]
					: undefined
			);
		}
	}
}

async function passageFiles(projectPath: string) {
	const passageRoot = path.join(projectPath, 'passages');
	const pending = [passageRoot];
	const files: string[] = [];

	while (pending.length > 0) {
		const current = pending.pop()!;

		for (const entry of await readdir(current, {withFileTypes: true})) {
			const entryPath = path.join(current, entry.name);

			if (entry.isDirectory()) {
				pending.push(entryPath);
			} else if (entry.isFile() && entry.name.endsWith('.twee')) {
				files.push(entryPath);
			}
		}
	}

	if (files.length === 0) {
		throw new Error('Fixture project does not contain a passage file.');
	}

	return files.sort((left, right) => left.localeCompare(right));
}

function watcherPassageSampleIndices(length: number) {
	if (length === 0) {
		throw new Error('Watcher sampling requires a passage file.');
	}

	// Repeatedly use the median fixture passage so the distribution measures
	// runtime variance rather than graph-position variance. Every append still
	// produces an independent native candidate and Rust transaction.
	const warmup = Math.floor(length / 2);
	const measured = Array.from({length: 5}, () => warmup);

	return {measured, warmup};
}

function captureWatcherTrace(
	current: PerformanceSnapshot,
	deltaId?: string
): string | undefined {
	const traceId = deltaId ?? current.main.watcherTraceEvents.at(-1)?.deltaId;

	if (!traceId) {
		return undefined;
	}

	const nativeStages = new Map(
		current.main.watcherTraceEvents
			.filter(event => event.deltaId === traceId)
			.map(event => [event.stage, event.timeEpochMs])
	);
	const rendererObserved = current.renderer.events.find(
		event =>
			event.name === 'watcher-delta-observed' &&
			event.detail?.deltaId === traceId
	);
	const rust = current.renderer.bridgeMetrics
		.filter(
			metric =>
				metric.kind === 'ingestExternalDelta' && metric.traceId === traceId
		)
		.at(-1);
	const patchApplied = current.renderer.events.find(
		event =>
			event.name === 'external-delta-patch-applied' &&
			event.detail?.deltaId === traceId
	);
	const observedAt = nativeStages.get('watcher-observed');
	const scanStartedAt = nativeStages.get('scan-started');
	const deltaCreatedAt = nativeStages.get('delta-created');
	const nativeNotifiedAt = nativeStages.get('native-notified');

	addSample(
		'watcher.observationToScanMs',
		observedAt !== undefined && scanStartedAt !== undefined
			? scanStartedAt - observedAt
			: undefined
	);
	addSample(
		'watcher.nativeDeltaCreationMs',
		scanStartedAt !== undefined && deltaCreatedAt !== undefined
			? deltaCreatedAt - scanStartedAt
			: undefined
	);
	addSample(
		'watcher.nativeToRendererMs',
		nativeNotifiedAt !== undefined && rendererObserved
			? rendererObserved.epochTime - nativeNotifiedAt
			: undefined
	);
	addSample(
		'watcher.rendererToWorkerMs',
		rendererObserved && rust
			? rust.requestedAtEpochMs - rendererObserved.epochTime
			: undefined
	);
	addSample(
		'watcher.rustIngestMs',
		rust?.rustStartedAtEpochMs !== undefined &&
			rust.rustFinishedAtEpochMs !== undefined
			? rust.rustFinishedAtEpochMs - rust.rustStartedAtEpochMs
			: undefined
	);
	addSample(
		'watcher.rustToPatchMs',
		rust?.rustFinishedAtEpochMs !== undefined && patchApplied
			? patchApplied.epochTime - rust.rustFinishedAtEpochMs
			: undefined
	);
	addSample(
		'watcher.observationToPatchMs',
		observedAt !== undefined && patchApplied
			? patchApplied.epochTime - observedAt
			: undefined
	);

	return traceId;
}

async function measureWatcherPassageSample(
	page: Page,
	projectPath: string,
	passageFile: string,
	sampleLabel: string,
	recordSamples: boolean
) {
	await reset(page);
	const passageProjectPath = path
		.relative(projectPath, passageFile)
		.replaceAll(path.sep, '/');

	await appendFile(
		passageFile,
		`\nExternal watcher benchmark edit ${sampleLabel}.\n`
	);
	let watcher;
	try {
		watcher = await waitForWatcherMetric(
			page,
			passageProjectPath,
			watcherTimeout
		);
	} catch (error) {
		const failedSnapshot = await snapshot(page);

		captureWatcherTrace(failedSnapshot);
		diagnostics.watcher = failedSnapshot;
		diagnostics.watcherPassage = failedSnapshot;
		assertInvariant(
			'watcher-passage-observed',
			false,
			(error as Error).message
		);
		return;
	}
	const deltaId = watcher.deltaId;

	try {
		await waitForCorrelatedEvent(
			page,
			'watcher-delta-observed',
			deltaId,
			watcherTimeout
		);
	} catch (error) {
		const failedSnapshot = await snapshot(page);

		captureWatcherTrace(failedSnapshot, deltaId);
		diagnostics.watcher = failedSnapshot;
		diagnostics.watcherPassage = failedSnapshot;
		assertInvariant(
			'watcher-passage-observed',
			false,
			(error as Error).message
		);
		return;
	}
	assertInvariant('watcher-passage-observed', true);
	let current = await snapshot(page);
	let observed = current.renderer.events.find(
		event =>
			event.name === 'watcher-delta-observed' &&
			event.detail?.deltaId === deltaId
	);

	try {
		current = await waitForCorrelatedEvent(
			page,
			'external-delta-patch-applied',
			deltaId,
			watcherTimeout
		);
	} catch (error) {
		const failedSnapshot = await snapshot(page);

		captureWatcherTrace(failedSnapshot, deltaId);
		diagnostics.watcher = failedSnapshot;
		diagnostics.watcherPassage = failedSnapshot;
		assertInvariant('watcher-passage-applied', false, (error as Error).message);
		return;
	}
	assertInvariant('watcher-passage-applied', true);

	diagnostics.watcherPassage = current;
	captureBridgeMetrics(current);
	observed = current.renderer.events.find(
		event =>
			event.name === 'watcher-delta-observed' &&
			event.detail?.deltaId === deltaId
	);
	let applied = current.renderer.events.find(
		event =>
			event.name === 'external-delta-patch-applied' &&
			event.detail?.deltaId === deltaId
	);
	const ingest = current.renderer.bridgeMetrics
		.filter(
			metric =>
				metric.kind === 'ingestExternalDelta' && metric.traceId === deltaId
		)
		.at(-1);

	addSample(
		'watcher.contentIngestMs',
		observed && applied ? applied.epochTime - observed.epochTime : undefined
	);
	captureWatcherTrace(current, deltaId);
	addSample('incremental.reindexComputeMs', ingest?.computeMs);
	assertInvariant(
		'watcher-passage-trace-complete',
		!!deltaId &&
			current.main.watcherTraceEvents.some(
				event => event.deltaId === deltaId && event.stage === 'watcher-observed'
			) &&
			current.main.watcherTraceEvents.some(
				event => event.deltaId === deltaId && event.stage === 'delta-created'
			) &&
			!!ingest?.rustStartedAtEpochMs &&
			current.renderer.events.some(
				event =>
					event.name === 'external-delta-patch-applied' &&
					event.detail?.deltaId === deltaId
			)
	);
	assertInvariant(
		'watcher-passage-parses-one-source',
		watcher?.changedPaths.length === 1 &&
			watcher.contentFilesRead === 1 &&
			watcher.assetChanges === 0,
		JSON.stringify(watcher)
	);
	assertInvariant(
		'watcher-passage-avoids-recovery',
		watcher?.recovery === false
	);
	assertInvariant(
		'watcher-read-model-attribution-present',
		!!ingest?.readModel,
		JSON.stringify(ingest?.readModel)
	);
	assertInvariant(
		'watcher-read-model-update-is-bounded',
		(ingest?.readModel?.readModelLastTouchedSourceCount ?? 0) <= 1,
		JSON.stringify(ingest?.readModel)
	);

	current = await pollSnapshot(
		page,
		snapshot =>
			snapshot.renderer.events.some(
				event =>
					(event.name === 'watcher-acknowledgement-complete' ||
						event.name === 'watcher-acknowledgement-failed') &&
					event.detail?.deltaId === deltaId
			),
		watcherTimeout
	);
	const acknowledgementFailure = current.renderer.events
		.filter(
			event =>
				event.name === 'watcher-acknowledgement-failed' &&
				event.detail?.deltaId === deltaId
		)
		.at(-1);
	const acknowledgementComplete = current.renderer.events.some(
		event =>
			event.name === 'watcher-acknowledgement-complete' &&
			event.detail?.deltaId === deltaId
	);

	assertInvariant(
		'watcher-passage-acknowledged',
		acknowledgementComplete,
		typeof acknowledgementFailure?.detail?.error === 'string'
			? acknowledgementFailure.detail.error
			: undefined
	);
	if (!acknowledgementComplete) {
		diagnostics.watcher = current;
		diagnostics.watcherPassage = current;
		return undefined;
	}

	const stages = ingest?.mutationStages;
	const stageSum = stages
		? stages.lookupAndDeltaMs +
			stages.fingerprintMs +
			stages.savepointMs +
			stages.graphMs +
			stages.analysisMs +
			stages.readModelMs +
			stages.historyMs +
			stages.patchFinalizeMs
		: undefined;
	const activeRevision = current.renderer.core.hosts
		.flatMap(host => host.sessions)
		.find(session => session.sessionId.includes(projectPath))?.revision;

	assertInvariant(
		`watcher-${sampleLabel}-rust-stage-attribution-present`,
		!!stages,
		JSON.stringify(stages)
	);
	assertInvariant(
		`watcher-${sampleLabel}-rust-stage-correlation`,
		stages?.deltaId === deltaId && stages?.revision === activeRevision,
		JSON.stringify({activeRevision, deltaId, stages})
	);
	assertInvariant(
		`watcher-${sampleLabel}-rust-stage-sum-bounded`,
		stageSum !== undefined && stageSum <= (stages?.totalMs ?? 0) + 0.25,
		JSON.stringify({stageSum, totalMs: stages?.totalMs})
	);
	assertInvariant(
		`watcher-${sampleLabel}-rust-avoids-graph-reparse`,
		stages?.topologyChanged === false && stages.graphParsedSourceCount === 0,
		JSON.stringify(stages)
	);

	if (recordSamples && stages && stageSum !== undefined) {
		addSample('watcher.coreTotalMs', stages.totalMs);
		addSample('watcher.lookupAndDeltaMs', stages.lookupAndDeltaMs);
		addSample('watcher.fingerprintMs', stages.fingerprintMs);
		addSample('watcher.savepointMs', stages.savepointMs);
		addSample('watcher.graphMs', stages.graphMs);
		addSample('watcher.analysisMs', stages.analysisMs);
		addSample('watcher.readModelMs', stages.readModelMs);
		addSample('watcher.historyMs', stages.historyMs);
		addSample('watcher.patchFinalizeMs', stages.patchFinalizeMs);
		addSample(
			'watcher.coreUnattributedMs',
			Math.max(0, stages.totalMs - stageSum)
		);
		addSample(
			'watcher.wasmBoundaryMs',
			ingest.rustStartedAtEpochMs !== undefined &&
				ingest.rustFinishedAtEpochMs !== undefined
				? Math.max(
						0,
						ingest.rustFinishedAtEpochMs -
							ingest.rustStartedAtEpochMs -
							stages.totalMs
					)
				: undefined
		);
	}

	return {current, ingest};
}

async function measureWatcher(page: Page, projectPath: string) {
	const files = await passageFiles(projectPath);
	const indices = watcherPassageSampleIndices(files.length);
	const sampleLengths = Object.fromEntries(
		Object.entries(samples).map(([name, values]) => [name, values.length])
	);
	const warmup = await measureWatcherPassageSample(
		page,
		projectPath,
		files[indices.warmup],
		'warmup',
		false
	);

	for (const [name, values] of Object.entries(samples)) {
		values.length = sampleLengths[name] ?? 0;
	}
	if (!warmup) {
		return;
	}

	let previousReadModel = warmup.ingest?.readModel;
	for (const [sampleIndex, passageIndex] of indices.measured.entries()) {
		const result = await measureWatcherPassageSample(
			page,
			projectPath,
			files[passageIndex],
			`passage-${sampleIndex + 1}`,
			true
		);

		if (!result) {
			return;
		}
		const readModel = result.ingest?.readModel;

		assertInvariant(
			`watcher-passage-${sampleIndex + 1}-avoids-full-read-model-build`,
			!!readModel &&
				readModel.readModelFullBuildCount ===
					previousReadModel?.readModelFullBuildCount,
			JSON.stringify({previousReadModel, readModel})
		);
		assertInvariant(
			`watcher-passage-${sampleIndex + 1}-updates-one-source`,
			!!readModel &&
				readModel.parsedSourceCount ===
					(previousReadModel?.parsedSourceCount ?? 0) + 1 &&
				readModel.readModelIncrementalUpdateCount ===
					(previousReadModel?.readModelIncrementalUpdateCount ?? 0) +
						((previousReadModel?.readModelFullBuildCount ?? 0) > 0 ? 1 : 0),
			JSON.stringify({previousReadModel, readModel})
		);
		previousReadModel = readModel;
		diagnostics.watcher = result.current;
		diagnostics.watcherPassage = result.current;
	}

	await page.waitForTimeout(750);
	await reset(page);
	const assetPath = path.join(projectPath, 'assets', 'perf', 'readme.txt');

	await appendFile(assetPath, '\nExternal asset benchmark edit.\n');
	let assetReview;
	try {
		assetReview = await waitForAssetWatcherReview(page, watcherTimeout);
	} catch (error) {
		assertInvariant('watcher-asset-observed', false, (error as Error).message);
		return;
	}
	const watcher = assetReview.metric;
	const current = assetReview.current;
	const assetDeltaId = watcher?.deltaId;
	const review = current.renderer.events
		.filter(
			event =>
				event.name === 'watcher-review-required' &&
				event.detail?.deltaId === assetDeltaId
		)
		.at(-1);
	const observed = current.renderer.events.find(
		event =>
			event.name === 'watcher-delta-observed' &&
			event.detail?.deltaId === assetDeltaId
	);

	assertInvariant('watcher-asset-observed', !!assetDeltaId && !!review);
	await expect(page.getByRole('button', {name: 'Later'})).toBeVisible();
	diagnostics.watcherAsset = current;
	captureBridgeMetrics(current);
	captureWatcherTrace(current, assetDeltaId);
	addSample(
		'watcher.assetReviewMs',
		observed && review ? review.time - observed.time : undefined
	);
	assertInvariant(
		'watcher-asset-parses-no-story-source',
		watcher?.changedPaths.length === 1 &&
			watcher.contentFilesRead === 0 &&
			watcher.assetChanges === 1,
		JSON.stringify(watcher)
	);
	assertInvariant('watcher-asset-enters-review', !!review);
	assertInvariant('watcher-asset-avoids-recovery', watcher?.recovery === false);
	assertInvariant(
		'watcher-avoids-full-replace',
		!current.renderer.bridgeMetrics.some(
			metric => metric.kind === 'replaceProject'
		)
	);
	await page.getByRole('button', {name: 'Later'}).click();
}

async function writeRawPerformanceReport(testInfo: TestInfo) {
	if (
		!fixturePath ||
		!reportPath ||
		!Number.isInteger(passageCount) ||
		!phase
	) {
		return;
	}

	const fixtureManifest = JSON.parse(
		await readFile(
			path.join(path.dirname(fixturePath), `story-${passageCount}.perf.json`),
			'utf8'
		)
	);
	const electronPackage = JSON.parse(
		await readFile(path.resolve('node_modules/electron/package.json'), 'utf8')
	);
	const playwrightPackage = JSON.parse(
		await readFile(path.resolve('node_modules/playwright/package.json'), 'utf8')
	);
	const cpu = os.cpus()[0];
	const gitRevision = execFileSync('git', ['rev-parse', 'HEAD'], {
		encoding: 'utf8'
	}).trim();
	const gitDirty =
		execFileSync('git', ['status', '--porcelain'], {encoding: 'utf8'}).trim()
			.length > 0;

	await writeFile(
		reportPath,
		`${JSON.stringify(
			{
				assertions: [
					...assertions,
					{
						detail: testInfo.error?.message,
						name: `phase-${phase}-completed`,
						passed: testInfo.status === 'passed'
					}
				],
				createdAt: new Date().toISOString(),
				diagnostics,
				diagnostic: phase === 'diagnostic',
				memoryDetail: phase === 'memory-detail',
				environment: {
					metricContracts: {memory: 2, startup: 2},
					git: {dirty: gitDirty, revision: gitRevision},
					machine: {
						arch: process.arch,
						cpu: cpu?.model ?? 'unknown',
						cpuCount: os.cpus().length,
						memoryBytes: os.totalmem(),
						node: process.version,
						platform: process.platform,
						release: os.release()
					},
					versions: {
						electron: electronPackage.version,
						playwright: playwrightPackage.version
					}
				},
				fixture: fixtureManifest,
				kind: 'twine-electron-performance',
				phase,
				sampleCount:
					phase === 'diagnostic' || phase === 'memory-detail' ? 1 : undefined,
				samples,
				schemaVersion: 1,
				smoke,
				test: {
					error: testInfo.error?.message,
					status: testInfo.status
				}
			},
			null,
			2
		)}\n`
	);
}

test.afterEach(async ({}, testInfo) => {
	await writeRawPerformanceReport(testInfo);
});

test(`measures the production Electron ${phase ?? 'unknown'} phase`, async () => {
	test.setTimeout(
		passageCount >= 50_000 && (phase === 'edit' || phase === 'query')
			? 45 * 60 * 1000
			: 20 * 60 * 1000
	);
	if (
		!fixturePath ||
		!reportPath ||
		!runRoot ||
		!Number.isInteger(passageCount) ||
		!benchmarkPhases.includes(phase ?? '')
	) {
		throw new Error(
			'TWINE_PERF_FIXTURE, TWINE_PERF_REPORT, TWINE_PERF_RUN_ROOT, ' +
				'TWINE_PERF_SIZE, and a valid TWINE_PERF_PHASE are required.'
		);
	}
	const fixtureManifestBefore = await readFile(
		path.join(fixturePath, 'twine.toml')
	);

	if (phase === 'diagnostic') {
		const running = await launchFixture();

		try {
			await measureDiagnostic(running.page, running.launchToWindowMs);
		} finally {
			await closeFixture(running);
		}
	}

	if (phase === 'memory-detail') {
		const running = await launchFixture();

		try {
			await measureMemoryDetail(running.page, running.launchToWindowMs);
		} finally {
			await closeFixture(running);
		}
	}

	if (phase === 'startup') {
		for (let index = 0; index < (smoke ? 1 : 3); index++) {
			const running = await launchFixture();

			try {
				await running.page.evaluate(() =>
					(window as any).twinePerformance.collectRetainedMemory()
				);
				const startupSnapshot = await snapshot(running.page);
				const startupPrefix = `startup-${index + 1}`;
				const checkpointNames = new Set(
					startupSnapshot.main.memoryCheckpoints.map(
						checkpoint => checkpoint.name
					)
				);
				const replacements = startupSnapshot.renderer.bridgeMetrics.filter(
					metric => metric.kind === 'replaceProject'
				);
				const bootstrapFinishes = startupSnapshot.renderer.bridgeMetrics.filter(
					metric => metric.kind === 'finishProjectBootstrap'
				);

				assertInvariant(
					`${startupPrefix}-react-passage-body-mirror-empty`,
					startupSnapshot.renderer.core.hosts[0]?.sessions.every(
						session => session.passageTextCharacterCount === 0
					) ?? false
				);

				assertInvariant(
					`${startupPrefix}-one-streamed-project-bootstrap`,
					replacements.length === 0 && bootstrapFinishes.length === 1,
					`replaceProject count ${replacements.length}, bootstrap finish count ${bootstrapFinishes.length}`
				);
				assertInvariant(
					`${startupPrefix}-memory-checkpoints-present`,
					[
						'all-passages-ready',
						'open-start',
						'session-initialization-complete',
						'shell-visible',
						'post-gc-retained'
					].every(name => checkpointNames.has(name)),
					JSON.stringify([...checkpointNames])
				);
				assertInvariant(
					`${startupPrefix}-bootstrap-documents-released`,
					startupSnapshot.renderer.core.bootstrap?.storyCount === 0 &&
						startupSnapshot.renderer.core.bootstrap.textBytes === 0,
					JSON.stringify(startupSnapshot.renderer.core.bootstrap)
				);
				assertInvariant(
					`${startupPrefix}-native-hydration-leases-released`,
					startupSnapshot.main.owners?.nativeHydration?.activeLeaseCount === 0,
					JSON.stringify(startupSnapshot.main.owners?.nativeHydration)
				);
				assertInvariant(
					`${startupPrefix}-native-load-attribution-present`,
					startupSnapshot.renderer.events.some(
						event =>
							event.name === 'native-project-hydrated' &&
							typeof event.detail?.mainNativeCallMs === 'number'
					)
				);
				const shellLoadEvent = startupSnapshot.renderer.events.find(
					event => event.name === 'native-project-shell-loaded'
				);
				const hydrationLoadEvent = startupSnapshot.renderer.events.find(
					event => event.name === 'native-project-hydrated'
				);

				assertInvariant(
					`${startupPrefix}-shell-load-is-lightweight`,
					shellLoadEvent?.detail?.loadProfile === 'shell' &&
						shellLoadEvent.detail.passageTextLoaded === false &&
						shellLoadEvent.detail.storySourcesLoaded === false &&
						shellLoadEvent.detail.graphLayoutLoaded === false
				);
				assertInvariant(
					`${startupPrefix}-full-hydration-is-complete`,
					hydrationLoadEvent?.detail?.loadProfile === 'full' &&
						hydrationLoadEvent.detail.passageTextLoaded === true &&
						hydrationLoadEvent.detail.storySourcesLoaded === true &&
						hydrationLoadEvent.detail.graphLayoutLoaded === true
				);
				assertInvariant(
					`${startupPrefix}-compiled-manifest-cache-used`,
					shellLoadEvent?.detail?.manifestCacheHit === true &&
						hydrationLoadEvent?.detail?.manifestCacheHit === true &&
						shellLoadEvent.detail.manifestTomlParseUs === 0 &&
						hydrationLoadEvent.detail.manifestTomlParseUs === 0
				);
				assertInvariant(
					`${startupPrefix}-manifest-digest-matches`,
					typeof shellLoadEvent?.detail?.manifestDigest === 'string' &&
						shellLoadEvent.detail.manifestDigest ===
							hydrationLoadEvent?.detail?.manifestDigest
				);
				const baselineEvent = startupSnapshot.renderer.events.find(
					event => event.name === 'native-session-baseline-ready'
				);

				assertInvariant(
					`${startupPrefix}-uses-native-baseline-receipt`,
					baselineEvent?.detail?.baselineMode === 'receipt',
					String(baselineEvent?.detail?.baselineMode)
				);
				assertInvariant(
					`${startupPrefix}-receipt-covers-baseline`,
					baselineEvent?.detail?.receiptFileCount ===
						baselineEvent?.detail?.baselineFileCount,
					`${baselineEvent?.detail?.receiptFileCount}/${baselineEvent?.detail?.baselineFileCount}`
				);
				assertInvariant(
					`${startupPrefix}-wasm-memory-attribution-present`,
					bootstrapFinishes.some(metric => (metric.wasmMemoryBytes ?? 0) > 0)
				);

				startupMetrics(startupSnapshot, running.launchToWindowMs);
				diagnostics.startup.push(startupSnapshot);
			} finally {
				await closeFixture(running);
			}
		}
	}

	if (phase === 'edit' || phase === 'graph' || phase === 'query') {
		const running = await launchFixture();

		try {
			const initial = await snapshot(running.page);

			assertInvariant(
				'wasm-worker-mode-active',
				initial.renderer.core.hosts.length === 1 &&
					initial.renderer.core.hosts[0].mode === 'wasm-worker'
			);
			assertInvariant(
				'one-project-one-session-worker',
				initial.renderer.core.workerClients === 1 &&
					initial.renderer.core.activeSessions === 1
			);
			assertInvariant(
				'react-passage-body-mirror-empty',
				initial.renderer.core.hosts[0].sessions.every(
					session => session.passageTextCharacterCount === 0
				)
			);
			if (phase === 'edit') {
				await measureEdits(running.page);
			} else if (phase === 'query') {
				await measureContents(running.page);
				await measureSearch(running.page);
			} else {
				await measureGraph(running.page);
			}

			const finalSnapshot = await snapshot(running.page);

			diagnostics.interaction = finalSnapshot;
			captureMemory(finalSnapshot);
		} finally {
			await closeFixture(running);
		}
	}

	if (phase === 'watcher') {
		const watcherRunning = await launchFixture();

		try {
			await settleInitialWatcherReview(watcherRunning.page);
			const initial = await snapshot(watcherRunning.page);

			assertInvariant(
				'wasm-worker-mode-active',
				initial.renderer.core.hosts.length === 1 &&
					initial.renderer.core.hosts[0].mode === 'wasm-worker'
			);
			assertInvariant(
				'one-project-one-session-worker',
				initial.renderer.core.workerClients === 1 &&
					initial.renderer.core.activeSessions === 1
			);
			assertInvariant(
				'react-passage-body-mirror-empty',
				initial.renderer.core.hosts[0].sessions.every(
					session => session.passageTextCharacterCount === 0
				)
			);
			await measureWatcher(watcherRunning.page, watcherRunning.projectPath);
			diagnostics.watcher = await snapshot(watcherRunning.page);
		} finally {
			await closeFixture(watcherRunning);
		}
	}

	assertInvariant(
		'source-fixture-manifest-unchanged',
		fixtureManifestBefore.equals(
			await readFile(path.join(fixturePath, 'twine.toml'))
		)
	);
});
