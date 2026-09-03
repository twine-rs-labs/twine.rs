import {expect, test} from '@playwright/test';
import type {TestInfo} from '@playwright/test';
import {
	_electron as electron,
	type CDPSession,
	ElectronApplication,
	Locator,
	Page
} from 'playwright';
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
import {performanceReportSchemaVersion} from '../benchmarks/performance-report-schema.mjs';
import {currentGitProvenance} from '../benchmarks/performance-tools.mjs';
import type {RendererPerformanceSnapshot} from '../src/util/performance-harness';
import {WorkerHeapCdpBroker} from '../src/test-util/worker-heap-cdp-broker';

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
		processMemory?: {
			private: number;
			residentSet: number;
		};
		rendererNativeMemory?: {
			blinkMemory: {allocated: number; total: number};
			pid: number;
			processMemory: {private: number; residentSet: number};
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
			mainHeap: Record<string, number>;
			mainMemory: PerformanceSnapshot['main']['memory'];
			mainProcessMemory?: PerformanceSnapshot['main']['processMemory'];
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
			renderer: Record<string, number | undefined>;
			sampleCount: number;
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
	renderer: RendererPerformanceSnapshot;
}

interface RunningApp {
	app: ElectronApplication;
	broker: WorkerHeapCdpBroker;
	launchToWindowMs: number;
	page: Page;
	projectPath: string;
	root: string;
}

interface EditStageSample {
	applyBridgeComputeMs: number;
	applyBridgeRoundTripMs: number;
	coreAnalysisMs: number;
	coreFingerprintMs: number;
	coreGraphMs: number;
	coreHistoryMs: number;
	coreLookupAndDeltaMs: number;
	coreProjectMutationMs: number;
	coreReadModelMs: number;
	corePatchFinalizeMs: number;
	coreTotalMs: number;
	index: number;
	postBridgeMs: number;
	postPatchMs: number;
	rendererPatchClassificationMs: number;
	rendererPatchDispatchMs: number;
	rendererPatchPublishMs: number;
	rendererPatchTotalMs: number;
	revision: number;
	storiesDispatchPersistenceSetupMs: number;
	storiesDispatchReducerMs: number;
	storiesDispatchTotalMs: number;
}

interface RefactorTypingCompositorSettle {
	frames: number;
	index: number;
	pending: number;
	ready: boolean;
}

interface RunningEditProfile {
	startedAtMeasuredIndex: number;
	session: CDPSession;
}

const fixturePath = process.env.TWINE_PERF_FIXTURE;
const fixtureVariant = process.env.TWINE_PERF_FIXTURE_VARIANT ?? 'default';
const reportPath = process.env.TWINE_PERF_REPORT;
const passageCount = Number.parseInt(process.env.TWINE_PERF_SIZE ?? '', 10);
const smoke = process.env.TWINE_PERF_SMOKE === '1';
const footprintEnabled = process.env.TWINE_PERF_FOOTPRINT === '1';
const disableHarloweEditorExtensions =
	process.env.TWINE_PERF_DISABLE_HARLOWE_EDITOR_EXTENSIONS === '1';
const editProfileEnabled = process.env.TWINE_PERF_EDIT_PROFILE === '1';
const editTracePath = process.env.TWINE_PERF_EDIT_TRACE;
const editCpuProfilePath = process.env.TWINE_PERF_EDIT_CPU_PROFILE;
const phase = process.env.TWINE_PERF_PHASE;
const runRoot = process.env.TWINE_PERF_RUN_ROOT;
const launchTracePath = process.env.TWINE_PERF_LAUNCH_TRACE;
const runId = process.env.TWINE_PERF_RUN_ID;
const refactorProbeOnly = phase === 'refactor' && smoke && passageCount === 100;
const watcherTimeout = smoke ? 60_000 : 10 * 60 * 1000;
const benchmarkPhases = [
	'diagnostic',
	'edit',
	'graph',
	'memory-detail',
	'query',
	'refactor',
	'startup',
	'watcher'
];
const mainPath = path.resolve(
	'electron-build/main/src/electron/main-process/index.js'
);
const samples: Record<string, number[]> = {};
const assertions: Array<{detail?: string; name: string; passed: boolean}> = [];
const refactorOperations = {
	refactorCore: 'project-replace',
	refactorM3PassageReferences: 'passage-references',
	refactorM3Definition: 'passage-definition',
	refactorM4DiagnosticFixes: 'diagnostic-fixes',
	refactorTyping: 'typing-responsiveness',
	refactorMemory: 'memory-observation'
} as const;
const diagnostics: {
	bridgeMetrics: PerformanceSnapshot['renderer']['bridgeMetrics'];
	editConfiguration?: {
		disableHarloweEditorExtensions: boolean;
		nativeEditorActive: boolean;
		profile: boolean;
	};
	editProfile?: {
		categories: string[];
		cpuProfilePath: string;
		dataLossOccurred: boolean;
		startedAtMeasuredIndex: number;
		stopReason: string;
		tracePath: string;
	};
	editStages: EditStageSample[];
	interaction?: PerformanceSnapshot;
	memoryDetail?: PerformanceSnapshot;
	refactor?: {
		checkpoints: PerformanceSnapshot[];
		commitSamples: number;
		detailSamples: number;
		m4CommitSamples: number;
		m4DetailSamples: number;
		m4SummarySamples: number;
		m4TypingSamples: number;
		m3DefinitionSamples: number;
		m3ReferenceSamples: number;
		operation: 'multi-operation';
		operations: typeof refactorOperations;
		summarySamples: number;
		typingCompositorSettles: RefactorTypingCompositorSettle[];
	};
	startup: PerformanceSnapshot[];
	watcher?: PerformanceSnapshot;
	watcherAsset?: PerformanceSnapshot;
	watcherPassage?: PerformanceSnapshot;
} = {bridgeMetrics: [], editStages: [], startup: []};
let playwrightRetrySettled = false;
let measurementBodyCompleted = false;

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
	if (disableHarloweEditorExtensions) {
		await writeFile(
			path.join(userData, 'prefs.json'),
			`${JSON.stringify({
				disabledStoryFormatEditorExtensions: [
					{name: 'Harlowe', version: '3.3.9'}
				]
			})}\n`
		);
	}
	await recordLaunchPhase('fixture-copy-finished', {root});

	const launchStartedAt = nodePerformance.now();
	let app: ElectronApplication | undefined;
	const broker = new WorkerHeapCdpBroker({
		tracePath: path.join(
			runRoot ?? root,
			`worker-heap-broker-${test.info().retry}-${path.basename(root)}.jsonl`
		),
		userDataPath: userData
	});
	const brokerUrl = await broker.start();
	const environment = electronEnvironment({
		NODE_ENV: 'production',
		TWINE_PERF: '1',
		TWINE_PERF_LAUNCH_TRACE: launchTracePath,
		TWINE_PERF_RUN_ID: runId,
		TWINE_PERF_USER_DATA: userData,
		TWINE_PERF_WORKER_HEAP_BROKER_TOKEN: broker.token,
		TWINE_PERF_WORKER_HEAP_BROKER_URL: brokerUrl
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

		return {app, broker, launchToWindowMs, page, projectPath, root};
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
		await broker.close().catch(() => undefined);
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
	const teardownStartedAt = nodePerformance.now();

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
		running.broker.recordLifecycle('page-teardown');
		await running.broker.close();
		await rm(running.root, {force: true, recursive: true});
		await settleLaunchServices();
	}
	const teardownMs = nodePerformance.now() - teardownStartedAt;
	assertInvariant(
		'worker-heap-broker-teardown-bounded',
		teardownMs <= 10_000,
		`${teardownMs.toFixed(1)}ms`
	);
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

function legacyFormatEventCount(
	current: PerformanceSnapshot,
	name: string,
	formatName = 'Chapbook'
) {
	return current.renderer.events.filter(
		event => event.name === name && event.detail?.formatName === formatName
	).length;
}

interface EditLongTaskEntry {
	duration: number;
	startTime: number;
}

async function startEditLongTaskObservation(page: Page) {
	const supported = await page.evaluate(() => {
		const Observer = globalThis.PerformanceObserver;

		if (
			typeof Observer === 'undefined' ||
			!Observer.supportedEntryTypes?.includes('longtask')
		) {
			return false;
		}

		const harnessWindow = window as any;
		const previous = harnessWindow.__twineEditLongTaskProbe;

		previous?.observer?.disconnect();
		const entries: EditLongTaskEntry[] = [];
		const observer = new Observer(list => {
			entries.push(
				...list.getEntries().map(entry => ({
					duration: entry.duration,
					startTime: entry.startTime
				}))
			);
		});

		observer.observe({buffered: false, type: 'longtask'});
		harnessWindow.__twineEditLongTaskProbe = {entries, observer};
		return true;
	});

	assertInvariant(
		'edit-long-task-api-supported',
		supported,
		'PerformanceObserver longtask entries are required for the edit phase.'
	);
	if (!supported) {
		throw new Error(
			'The Long Tasks API is unsupported; edit responsiveness cannot be verified.'
		);
	}
}

async function mutationWindowLongTasks(
	page: Page,
	measurement: {duration: number; startTime: number}
) {
	await page.waitForTimeout(0);
	return page.evaluate(
		({windowEnd, windowStart}) => {
			const probe = (window as any).__twineEditLongTaskProbe as
				| {
						entries: EditLongTaskEntry[];
						observer: PerformanceObserver;
				  }
				| undefined;

			if (!probe) {
				throw new Error('Edit Long Tasks observer was not initialized.');
			}
			probe.entries.push(
				...probe.observer.takeRecords().map(entry => ({
					duration: entry.duration,
					startTime: entry.startTime
				}))
			);
			const matching = probe.entries.filter(
				entry =>
					entry.startTime < windowEnd &&
					entry.startTime + entry.duration > windowStart
			);

			const retained = probe.entries.filter(
				entry => entry.startTime + entry.duration > windowEnd
			);

			probe.entries.splice(0, probe.entries.length, ...retained);
			return matching;
		},
		{
			windowEnd: measurement.startTime + measurement.duration,
			windowStart: measurement.startTime
		}
	);
}

async function stopEditLongTaskObservation(page: Page) {
	await page.evaluate(() => {
		const harnessWindow = window as any;

		harnessWindow.__twineEditLongTaskProbe?.observer?.disconnect();
		delete harnessWindow.__twineEditLongTaskProbe;
	});
}

const editTraceCategories = [
	'toplevel',
	'devtools.timeline',
	'disabled-by-default-devtools.timeline',
	'disabled-by-default-devtools.timeline.stack',
	'blink.user_timing',
	'v8',
	'v8.execute',
	'disabled-by-default-v8.gc'
];

function finiteEventDetail(
	event: PerformanceSnapshot['renderer']['events'][number] | undefined,
	name: string
) {
	const value = event?.detail?.[name];

	return typeof value === 'number' && Number.isFinite(value)
		? value
		: undefined;
}

function correlatedEditStageSample(
	current: PerformanceSnapshot,
	index: number,
	editRoundTripMs: number | undefined
): EditStageSample | undefined {
	const mutation = current.renderer.events
		.filter(event => event.name === 'mutation-applied')
		.at(-1);
	const revision = finiteEventDetail(mutation, 'revision');

	if (revision === undefined || editRoundTripMs === undefined) {
		return undefined;
	}

	const applyBridge = current.renderer.bridgeMetrics
		.filter(
			metric =>
				metric.kind === 'apply' &&
				metric.mutationStages?.operation === 'localPassageText' &&
				metric.mutationStages.revision === revision
		)
		.at(-1);
	const rendererPatch = current.renderer.events
		.filter(
			event =>
				event.name === 'renderer-patch-stages' &&
				event.detail?.revision === revision &&
				event.detail?.documentUpdates === 1 &&
				event.epochTime <= mutation!.epochTime
		)
		.at(-1);
	const storiesDispatch = current.renderer.events
		.filter(
			event =>
				event.name === 'stories-dispatch-stages' &&
				event.detail?.action === 'applyCorePatchBatch' &&
				(!applyBridge || event.epochTime >= applyBridge.receivedAtEpochMs) &&
				(!rendererPatch || event.epochTime <= rendererPatch.epochTime)
		)
		.at(-1);
	const rendererPatchClassificationMs = finiteEventDetail(
		rendererPatch,
		'classificationMs'
	);
	const rendererPatchDispatchMs = finiteEventDetail(
		rendererPatch,
		'dispatchMs'
	);
	const rendererPatchPublishMs = finiteEventDetail(rendererPatch, 'publishMs');
	const rendererPatchTotalMs = finiteEventDetail(rendererPatch, 'totalMs');
	const storiesDispatchPersistenceSetupMs = finiteEventDetail(
		storiesDispatch,
		'persistenceSetupMs'
	);
	const storiesDispatchReducerMs = finiteEventDetail(
		storiesDispatch,
		'reducerMs'
	);
	const storiesDispatchTotalMs = finiteEventDetail(storiesDispatch, 'totalMs');
	const coreStages = applyBridge?.mutationStages;
	const coreStageValues = coreStages
		? [
				coreStages.totalMs,
				coreStages.lookupAndDeltaMs,
				coreStages.projectMutationMs,
				coreStages.fingerprintMs,
				coreStages.graphMs,
				coreStages.analysisMs,
				coreStages.readModelMs,
				coreStages.historyMs,
				coreStages.patchFinalizeMs
			]
		: [];
	const coreStageSum = coreStages
		? coreStages.lookupAndDeltaMs +
			coreStages.projectMutationMs +
			coreStages.fingerprintMs +
			coreStages.graphMs +
			coreStages.analysisMs +
			coreStages.readModelMs +
			coreStages.historyMs +
			coreStages.patchFinalizeMs
		: undefined;
	const values = [
		applyBridge?.computeMs,
		applyBridge?.roundTripMs,
		rendererPatchClassificationMs,
		rendererPatchDispatchMs,
		rendererPatchPublishMs,
		rendererPatchTotalMs,
		storiesDispatchPersistenceSetupMs,
		storiesDispatchReducerMs,
		storiesDispatchTotalMs,
		...coreStageValues
	];

	if (
		!applyBridge ||
		values.some(
			value => typeof value !== 'number' || !Number.isFinite(value)
		) ||
		coreStageValues.some(value => value < 0) ||
		coreStageSum === undefined ||
		coreStageSum > coreStages!.totalMs + 0.25
	) {
		return undefined;
	}

	const postBridgeMs = editRoundTripMs - applyBridge.roundTripMs;
	const postPatchMs = postBridgeMs - rendererPatchTotalMs!;

	if (!Number.isFinite(postBridgeMs) || !Number.isFinite(postPatchMs)) {
		return undefined;
	}

	return {
		applyBridgeComputeMs: applyBridge.computeMs,
		applyBridgeRoundTripMs: applyBridge.roundTripMs,
		coreAnalysisMs: coreStages!.analysisMs,
		coreFingerprintMs: coreStages!.fingerprintMs,
		coreGraphMs: coreStages!.graphMs,
		coreHistoryMs: coreStages!.historyMs,
		coreLookupAndDeltaMs: coreStages!.lookupAndDeltaMs,
		coreProjectMutationMs: coreStages!.projectMutationMs,
		coreReadModelMs: coreStages!.readModelMs,
		corePatchFinalizeMs: coreStages!.patchFinalizeMs,
		coreTotalMs: coreStages!.totalMs,
		index,
		postBridgeMs,
		postPatchMs,
		rendererPatchClassificationMs: rendererPatchClassificationMs!,
		rendererPatchDispatchMs: rendererPatchDispatchMs!,
		rendererPatchPublishMs: rendererPatchPublishMs!,
		rendererPatchTotalMs: rendererPatchTotalMs!,
		revision,
		storiesDispatchPersistenceSetupMs: storiesDispatchPersistenceSetupMs!,
		storiesDispatchReducerMs: storiesDispatchReducerMs!,
		storiesDispatchTotalMs: storiesDispatchTotalMs!
	};
}

function recordEditStageSample(sample: EditStageSample) {
	diagnostics.editStages.push(sample);
	addSample('edit.applyBridge.computeMs', sample.applyBridgeComputeMs);
	addSample('edit.applyBridge.roundTripMs', sample.applyBridgeRoundTripMs);
	addSample('edit.core.totalMs', sample.coreTotalMs);
	addSample('edit.core.lookupAndDeltaMs', sample.coreLookupAndDeltaMs);
	addSample('edit.core.projectMutationMs', sample.coreProjectMutationMs);
	addSample('edit.core.fingerprintMs', sample.coreFingerprintMs);
	addSample('edit.core.graphMs', sample.coreGraphMs);
	addSample('edit.core.analysisMs', sample.coreAnalysisMs);
	addSample('edit.core.readModelMs', sample.coreReadModelMs);
	addSample('edit.core.historyMs', sample.coreHistoryMs);
	addSample('edit.core.patchFinalizeMs', sample.corePatchFinalizeMs);
	addSample('edit.postBridgeMs', sample.postBridgeMs);
	addSample(
		'edit.rendererPatch.classificationMs',
		sample.rendererPatchClassificationMs
	);
	addSample('edit.rendererPatch.dispatchMs', sample.rendererPatchDispatchMs);
	addSample('edit.rendererPatch.publishMs', sample.rendererPatchPublishMs);
	addSample('edit.rendererPatch.totalMs', sample.rendererPatchTotalMs);
	addSample(
		'edit.storiesDispatch.persistenceSetupMs',
		sample.storiesDispatchPersistenceSetupMs
	);
	addSample('edit.storiesDispatch.reducerMs', sample.storiesDispatchReducerMs);
	addSample('edit.storiesDispatch.totalMs', sample.storiesDispatchTotalMs);
	addSample('edit.postPatchMs', sample.postPatchMs);
}

async function startEditProfile(
	page: Page,
	startedAtMeasuredIndex: number
): Promise<RunningEditProfile> {
	if (!editTracePath || !editCpuProfilePath) {
		throw new Error(
			'TWINE_PERF_EDIT_TRACE and TWINE_PERF_EDIT_CPU_PROFILE are required when TWINE_PERF_EDIT_PROFILE=1.'
		);
	}

	const session = await page.context().newCDPSession(page);
	const {categories} = await session.send('Tracing.getCategories');
	const missingCategories = editTraceCategories.filter(
		category => !categories.includes(category)
	);

	if (missingCategories.length > 0) {
		await session.detach();
		throw new Error(
			`CDP tracing categories unavailable: ${missingCategories.join(', ')}`
		);
	}

	try {
		await session.send('Profiler.enable');
		await session.send('Profiler.setSamplingInterval', {interval: 1000});
		await session.send('Profiler.start');
		await session.send('Tracing.start', {
			categories: editTraceCategories.join(','),
			streamCompression: 'gzip',
			streamFormat: 'json',
			transferMode: 'ReturnAsStream'
		});
	} catch (error) {
		await session.send('Profiler.disable').catch(() => undefined);
		await session.detach();
		throw error;
	}

	return {session, startedAtMeasuredIndex};
}

async function stopEditProfile(
	profile: RunningEditProfile,
	stopReason: string
) {
	const {session} = profile;
	const cpuProfile = await session.send('Profiler.stop');
	await session.send('Profiler.disable');
	const tracingComplete = new Promise<{
		dataLossOccurred?: boolean;
		stream?: string;
	}>(resolve => {
		session.once('Tracing.tracingComplete', resolve);
	});

	await session.send('Tracing.end');
	const {dataLossOccurred = false, stream} = await tracingComplete;

	if (!stream || !editTracePath || !editCpuProfilePath) {
		await session.detach();
		throw new Error('CDP tracing did not return an artifact stream.');
	}

	await writeFile(
		editCpuProfilePath,
		`${JSON.stringify(cpuProfile.profile)}\n`
	);
	await writeFile(editTracePath, Buffer.alloc(0));
	try {
		let eof = false;

		while (!eof) {
			const chunk = await session.send('IO.read', {handle: stream});

			await appendFile(
				editTracePath,
				Buffer.from(chunk.data, chunk.base64Encoded ? 'base64' : 'utf8')
			);
			eof = chunk.eof;
		}
	} finally {
		await session.send('IO.close', {handle: stream}).catch(() => undefined);
		await session.detach();
	}

	diagnostics.editProfile = {
		categories: editTraceCategories,
		cpuProfilePath: editCpuProfilePath,
		dataLossOccurred,
		startedAtMeasuredIndex: profile.startedAtMeasuredIndex,
		stopReason,
		tracePath: editTracePath
	};
	assertInvariant(
		'edit-profile-trace-data-complete',
		!dataLossOccurred,
		`dataLossOccurred=${dataLossOccurred}`
	);
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
		? checkpointWorkingSetByRole(baselineMemory)
		: new Map<string, number>();

	for (const checkpoint of memoryCheckpoints.values()) {
		const workingSetKiB = [
			...Object.values(checkpoint.processWorkingSetKiBByRole)
		].reduce((total, value) => total + value, 0);

		addSample(
			`startupMemory.${checkpoint.name}.residentMiB`,
			workingSetKiB > 0
				? workingSetKiB / 1024
				: checkpoint.mainMemory.rss / 1024 / 1024
		);
		for (const [role, workingSetKiB] of checkpointWorkingSetByRole(
			checkpoint
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
		addSample(
			`startupMemory.${checkpoint.name}.private.mainMiB`,
			checkpoint.mainProcessMemory?.private === undefined
				? undefined
				: checkpoint.mainProcessMemory.private / 1024
		);
		addSample(
			`startupMemory.${checkpoint.name}.private.rendererMiB`,
			typeof checkpoint.renderer.rendererPrivateKiB === 'number'
				? checkpoint.renderer.rendererPrivateKiB / 1024
				: undefined
		);
		addSample(
			`startupMemory.${checkpoint.name}.blink.allocatedMiB`,
			typeof checkpoint.renderer.rendererBlinkAllocatedKiB === 'number'
				? checkpoint.renderer.rendererBlinkAllocatedKiB / 1024
				: undefined
		);
	}
	captureMemory(snapshot);
}

function footprintMetricSegment(name: string) {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

async function captureMacFootprint(
	snapshot: PerformanceSnapshot,
	label: string
) {
	if (!footprintEnabled) {
		return;
	}
	if (process.platform !== 'darwin') {
		throw new Error('TWINE_PERF_FOOTPRINT=1 is supported only on macOS.');
	}
	if (!runRoot) {
		throw new Error('TWINE_PERF_RUN_ROOT is required for footprint capture.');
	}

	const pids = Array.from(
		new Set(snapshot.main.appMetrics.map(metric => metric.pid))
	);
	const output = path.join(runRoot, `footprint-${label}.json`);
	const args = ['--json', output];

	for (const pid of pids) {
		args.push('--pid', String(pid));
	}
	execFileSync('/usr/bin/footprint', args, {
		encoding: 'utf8',
		maxBuffer: 20 * 1024 * 1024,
		stdio: ['ignore', 'ignore', 'pipe']
	});
	const footprint = JSON.parse(await readFile(output, 'utf8'));
	const mib = 1024 * 1024;

	addSample(
		'footprint.totalMiB',
		typeof footprint['total footprint'] === 'number'
			? footprint['total footprint'] / mib
			: undefined
	);
	for (const [name, category] of Object.entries(footprint.summary ?? {})) {
		const dirty = (category as {dirty?: number}).dirty;

		if (name !== 'total' && typeof dirty === 'number') {
			addSample(
				`footprint.category.${footprintMetricSegment(name)}MiB`,
				dirty / mib
			);
		}
	}

	const roleByPid = new Map(
		snapshot.main.appMetrics.map(metric => [metric.pid, metric.type])
	);
	const footprintByRole = new Map<string, number>();

	for (const processInfo of footprint.processes ?? []) {
		const role = roleByPid.get(processInfo.pid);

		if (role && typeof processInfo.footprint === 'number') {
			footprintByRole.set(
				role,
				(footprintByRole.get(role) ?? 0) + processInfo.footprint
			);
		}
	}
	for (const [role, bytes] of footprintByRole) {
		addSample(
			`footprint.process.${footprintMetricSegment(role)}MiB`,
			bytes / mib
		);
	}
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

function checkpointWorkingSetByRole(
	checkpoint: PerformanceSnapshot['main']['memoryCheckpoints'][number]
) {
	return new Map(Object.entries(checkpoint.processWorkingSetKiBByRole));
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

async function waitForMutationPaintAfter(page: Page, inputStartedAt: number) {
	await page.waitForFunction(
		startedAt =>
			performance
				.getEntriesByName('twine:mutation-to-paint')
				.some(
					entry =>
						entry.entryType === 'measure' &&
						entry.startTime >= startedAt &&
						entry.startTime + entry.duration >= startedAt
				),
		inputStartedAt,
		{timeout: 60_000}
	);

	return page.evaluate(startedAt => {
		const entry = performance
			.getEntriesByName('twine:mutation-to-paint')
			.filter(
				candidate =>
					candidate.entryType === 'measure' &&
					candidate.startTime >= startedAt &&
					candidate.startTime + candidate.duration >= startedAt
			)
			.at(-1);

		return entry
			? {
					duration: entry.duration,
					name: entry.name,
					startTime: entry.startTime,
					type: entry.entryType
				}
			: undefined;
	}, inputStartedAt);
}

async function waitForMutationPaintForRevision(
	page: Page,
	{inputStartedAt, revision}: {inputStartedAt: number; revision: number}
) {
	const mutationSnapshot = await waitForRevisionEvent(
		page,
		['mutation-applied'],
		revision
	);
	const mutations = mutationSnapshot.renderer.events.filter(
		event =>
			event.name === 'mutation-applied' && event.detail?.revision === revision
	);
	if (mutations.length !== 1) {
		throw new Error(
			`Expected one mutation event for revision ${revision}, found ${mutations.length}.`
		);
	}
	const mutation = mutations[0];
	const token = mutation?.detail?.performanceToken;

	if (typeof token !== 'string' || token.length === 0) {
		throw new Error(
			`Mutation revision ${revision} did not expose a scoped paint token.`
		);
	}

	const measureName = `mutation-to-paint-${token}`;
	const submitName = `mutation-submit-${token}`;
	const workerResponseName = `mutation-worker-response-${token}`;
	const patchDispatchName = `mutation-patch-dispatch-${token}`;
	await page.waitForFunction(
		({
			measureName,
			patchDispatchName,
			startedAt,
			submitName,
			workerResponseName
		}) =>
			performance
				.getEntriesByName(`twine:${measureName}`)
				.some(
					entry => entry.entryType === 'measure' && entry.startTime >= startedAt
				) &&
			[submitName, workerResponseName, patchDispatchName].every(name =>
				performance
					.getEntriesByName(`twine:${name}`)
					.some(entry => entry.entryType === 'mark')
			),
		{
			measureName,
			patchDispatchName,
			startedAt: inputStartedAt,
			submitName,
			workerResponseName
		},
		{timeout: 60_000}
	);

	return page.evaluate(
		({
			measureName,
			patchDispatchName,
			startedAt,
			submitName,
			workerResponseName
		}) => {
			const exactlyOne = (name: string, type: string) => {
				const entries = performance
					.getEntriesByName(`twine:${name}`)
					.filter(entry => entry.entryType === type);
				if (entries.length !== 1) {
					throw new Error(
						`Expected one ${type} entry for ${name}, found ${entries.length}.`
					);
				}
				return entries[0];
			};
			const paint = exactlyOne(measureName, 'measure');
			const submit = exactlyOne(submitName, 'mark');
			const workerResponse = exactlyOne(workerResponseName, 'mark');
			const patchDispatch = exactlyOne(patchDispatchName, 'mark');

			if (paint.startTime < startedAt) {
				throw new Error(
					`Scoped paint measure ${measureName} predates its input.`
				);
			}
			const paintEnd = paint.startTime + paint.duration;
			const result = {
				paint: {
					duration: paint.duration,
					name: paint.name,
					startTime: paint.startTime,
					type: paint.entryType
				},
				stages: {
					frameWaitMs: paintEnd - patchDispatch.startTime,
					patchDispatchMs: patchDispatch.startTime - workerResponse.startTime,
					totalMs: paint.duration,
					workerMs: workerResponse.startTime - submit.startTime
				}
			};

			// Keep the token-scoped diagnostic artifacts bounded across all 20
			// planning windows. The generic product metrics remain unchanged.
			performance.clearMeasures(`twine:${measureName}`);
			for (const name of [
				submitName,
				workerResponseName,
				patchDispatchName,
				`${measureName}-end`
			]) {
				performance.clearMarks(`twine:${name}`);
			}
			return result;
		},
		{
			measureName,
			patchDispatchName,
			startedAt: inputStartedAt,
			submitName,
			workerResponseName
		}
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
	const acceptDisk = page.getByRole('button', {name: 'Use Disk Version'});
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
	let runningEditProfile: RunningEditProfile | undefined;

	if (fixtureVariant === 'chapbook') {
		try {
			await waitForEvent(page, 'core-passage-document-ready');
		} catch (error) {
			throw new Error(
				`${(error as Error).message}\nEditor readiness: ${JSON.stringify({
					contentLength: (await content.textContent())?.length ?? 0,
					editorId: await editor.getAttribute('data-testid'),
					editorWindowLabel: await editorWindow.getAttribute('aria-label'),
					textTabSelected: await page
						.getByRole('group', {name: 'Workspace Mode'})
						.getByRole('tab', {name: 'Text'})
						.getAttribute('aria-selected')
				})}`
			);
		}
		try {
			await waitForEvent(page, 'legacy-editor-adapter-created');
			await waitForEvent(page, 'legacy-lookahead-line-index-rebuilt');
		} catch (error) {
			const current = await snapshot(page);

			throw new Error(
				`${(error as Error).message}\nLegacy editor readiness: ${JSON.stringify(
					{
						contentLength: (await content.textContent())?.length ?? 0,
						events: current.renderer.events.filter(event =>
							/^(core-passage|legacy-editor|legacy-lookahead|source-editor)/.test(
								event.name
							)
						)
					}
				)}`
			);
		}
	}
	const nativeToolbar = page.getByRole('toolbar', {
		name: 'Harlowe editor toolbar'
	});

	if (fixtureVariant === 'default' && !disableHarloweEditorExtensions) {
		await nativeToolbar
			.waitFor({state: 'visible', timeout: 30_000})
			.catch(() => undefined);
	}
	const nativeEditorActive = await nativeToolbar.isVisible();

	diagnostics.editConfiguration = {
		disableHarloweEditorExtensions,
		nativeEditorActive,
		profile: editProfileEnabled
	};
	assertInvariant(
		'edit-native-editor-configuration-verified',
		fixtureVariant !== 'default' ||
			nativeEditorActive === !disableHarloweEditorExtensions,
		JSON.stringify(diagnostics.editConfiguration)
	);
	await startEditLongTaskObservation(page);

	try {
		for (let index = 0; index < (smoke ? 3 : 22); index++) {
			await recordLaunchPhase('benchmark-sample-started', {
				index,
				phase,
				surface: 'edit'
			});
			await reset(page);
			if (index === 2 && editProfileEnabled) {
				runningEditProfile = await startEditProfile(page, 0);
			}
			const bridgeMetricStart = (await snapshot(page)).renderer.bridgeMetrics
				.length;
			let previousRevision = await currentRevision(page);
			await content.click();
			await page.keyboard.press('End');
			const editorInputStartedAt = await page.evaluate(() => performance.now());

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
			const editPaintEntry = lastEntry(current, 'mutation-to-paint', 'measure');
			const editPaintMs = editPaintEntry?.duration;
			const editorInputWindow = editPaintEntry
				? {
						duration: Math.max(
							0,
							editPaintEntry.startTime +
								editPaintEntry.duration -
								editorInputStartedAt
						),
						startTime: editorInputStartedAt
					}
				: undefined;
			const editorInputLongTasks =
				index >= 2 && editorInputWindow
					? await mutationWindowLongTasks(page, editorInputWindow)
					: [];
			const editStageSample =
				index >= 2
					? correlatedEditStageSample(current, index, editRoundTripMs)
					: undefined;
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
				assertInvariant(
					`edit-${index}-stage-sample-correlated`,
					!!editStageSample,
					JSON.stringify({
						applyMetrics: current.renderer.bridgeMetrics.filter(
							metric => metric.kind === 'apply'
						),
						events: current.renderer.events.filter(event =>
							[
								'mutation-applied',
								'renderer-patch-stages',
								'stories-dispatch-stages'
							].includes(event.name)
						)
					})
				);
				if (editStageSample) {
					recordEditStageSample(editStageSample);
				}
				assertInvariant(
					`edit-${index}-mutation-window-captured`,
					!!editPaintEntry,
					JSON.stringify(editPaintEntry)
				);
				const longestEditorInputTask = Math.max(
					0,
					...editorInputLongTasks.map(entry => entry.duration)
				);

				addSample(
					'edit.inputToPaintLongTaskWindowMaxMs',
					longestEditorInputTask
				);
				for (const entry of editorInputLongTasks) {
					addSample('edit.inputToPaintLongTaskMs', entry.duration);
				}
				assertInvariant(
					`edit-${index}-input-to-paint-has-no-long-task`,
					editorInputLongTasks.every(entry => entry.duration <= 50),
					JSON.stringify({
						longTasks: editorInputLongTasks,
						window: {
							duration: editorInputWindow?.duration,
							startTime: editorInputWindow?.startTime
						}
					})
				);
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
			if (fixtureVariant === 'chapbook') {
				const adapterEvents = current.renderer.events.filter(
					event =>
						event.name === 'legacy-editor-adapter-created' &&
						event.detail?.formatName === 'Chapbook'
				);
				const adapterRebuilds = adapterEvents.length;
				const editorLifecycleEvents = current.renderer.events.filter(event =>
					[
						'source-editor-view-created',
						'source-editor-view-destroyed'
					].includes(event.name)
				);
				const lineIndexRebuilds = legacyFormatEventCount(
					current,
					'legacy-lookahead-line-index-rebuilt'
				);

				addSample('chapbook.ordinary.adapterRebuildCount', adapterRebuilds);
				addSample(
					'chapbook.ordinary.editorViewLifecycleEventCount',
					editorLifecycleEvents.length
				);
				addSample('chapbook.ordinary.lineIndexRebuildCount', lineIndexRebuilds);
				assertInvariant(
					`chapbook-ordinary-${index}-preserves-adapter-and-line-index`,
					adapterRebuilds === 0 &&
						editorLifecycleEvents.length === 0 &&
						lineIndexRebuilds === 0,
					JSON.stringify({
						adapterEvents: adapterEvents.map(event => event.detail),
						adapterRebuilds,
						delimiterEvents: current.renderer.events
							.filter(
								event =>
									event.name === 'legacy-delimiter-presence-changed' &&
									event.detail?.formatName === 'Chapbook'
							)
							.map(event => event.detail),
						editorLifecycleEvents,
						lineIndexRebuilds
					})
				);
			}
			captureBridgeMetrics(current);
			await recordLaunchPhase('benchmark-sample-completed', {
				index,
				phase,
				surface: 'edit'
			});
			if (
				runningEditProfile &&
				(editorInputLongTasks.some(entry => entry.duration >= 80) ||
					index === (smoke ? 2 : 21))
			) {
				const stopReason = editorInputLongTasks.some(
					entry => entry.duration >= 80
				)
					? 'first-input-to-paint-long-task-at-least-80ms'
					: 'measured-samples-complete';

				await stopEditProfile(runningEditProfile, stopReason);
				runningEditProfile = undefined;
			}
		}
	} finally {
		if (runningEditProfile) {
			await stopEditProfile(runningEditProfile, 'measurement-ended');
		}
		await stopEditLongTaskObservation(page);
	}
	const expectedMeasuredSamples = smoke ? 1 : 20;
	const editStageSampleNames = [
		'edit.applyBridge.computeMs',
		'edit.applyBridge.roundTripMs',
		'edit.core.totalMs',
		'edit.core.lookupAndDeltaMs',
		'edit.core.projectMutationMs',
		'edit.core.fingerprintMs',
		'edit.core.graphMs',
		'edit.core.analysisMs',
		'edit.core.readModelMs',
		'edit.core.historyMs',
		'edit.core.patchFinalizeMs',
		'edit.postBridgeMs',
		'edit.rendererPatch.classificationMs',
		'edit.rendererPatch.dispatchMs',
		'edit.rendererPatch.publishMs',
		'edit.rendererPatch.totalMs',
		'edit.storiesDispatch.persistenceSetupMs',
		'edit.storiesDispatch.reducerMs',
		'edit.storiesDispatch.totalMs',
		'edit.postPatchMs'
	];

	assertInvariant(
		'edit-stage-sample-coverage-and-finite-correlation',
		diagnostics.editStages.length === expectedMeasuredSamples &&
			editStageSampleNames.every(
				name =>
					samples[name]?.length === expectedMeasuredSamples &&
					samples[name].every(Number.isFinite)
			),
		JSON.stringify({
			diagnostics: diagnostics.editStages.length,
			samples: Object.fromEntries(
				editStageSampleNames.map(name => [name, samples[name]?.length ?? 0])
			)
		})
	);
	assertInvariant(
		'edit-input-to-paint-long-task-window-sample-coverage',
		(samples['edit.inputToPaintLongTaskWindowMaxMs']?.length ?? 0) ===
			expectedMeasuredSamples,
		`${samples['edit.inputToPaintLongTaskWindowMaxMs']?.length ?? 0}/${
			smoke ? 1 : 20
		}`
	);

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

	if (fixtureVariant === 'chapbook') {
		await measureChapbookOrdinaryEditLocations(page, content);
		await measureChapbookDelimiterInvalidation(page, content);
	}
}

async function revealEditorSearchMatch(
	page: Page,
	content: Locator,
	query: string
) {
	const editorId = await content
		.locator('xpath=ancestor::*[@data-testid][1]')
		.getAttribute('data-testid');
	const selected = await page.evaluate(
		({id, text}) => (window as any).twinePerformance.selectEditorText(id, text),
		{id: editorId, text: query}
	);

	assertInvariant(
		`chapbook-location-${query.slice(-4)}-selected`,
		selected,
		`${editorId ?? 'missing editor'}; ${query}`
	);
	await page.keyboard.press('ArrowRight');
}

async function measureChapbookOrdinaryEditLocations(
	page: Page,
	content: Locator
) {
	const probes = [
		{
			label: 'beginning',
			query: 'benchmark variable 0001: value 0001'
		},
		{
			label: 'middle',
			query: 'benchmark variable 2048: value 2048'
		},
		{label: 'end', query: 'benchmark variable 4096: value 4096'}
	];

	for (const [ordinal, probe] of probes.entries()) {
		await reset(page);
		await revealEditorSearchMatch(page, content, probe.query);
		let previousRevision = await currentRevision(page);
		const suffix = ` [perf-${probe.label}]`;

		await page.keyboard.insertText(suffix);
		await waitForEvent(page, 'mutation-applied');
		await waitForMeasure(page, 'mutation-to-paint');
		await expect(content.locator('.cm-activeLine')).toHaveText(
			`${probe.query}${suffix}`
		);
		const editRevision = await waitForRevisionAfter(page, previousRevision);
		const editPersisted = await waitForRevisionEvent(
			page,
			['save-acknowledgement-complete', 'persistence-save-failed'],
			editRevision,
			watcherTimeout
		);

		assertInvariant(
			`chapbook-ordinary-${probe.label}-edit-persisted`,
			editPersisted.renderer.events.some(
				event =>
					event.name === 'save-acknowledgement-complete' &&
					event.detail?.revision === editRevision
			),
			`revision ${editRevision}`
		);

		previousRevision = editRevision;
		const undo = page.getByRole('button', {name: /^Undo/});
		const controlledSyncCount = (await snapshot(page)).renderer.events.filter(
			event => event.name === 'source-editor-controlled-value-synchronized'
		).length;

		await expect(undo).toBeEnabled();
		await undo.click();
		await waitForEvent(page, 'undo-applied');
		const restoreRevision = await waitForRevisionAfter(page, previousRevision);

		// Project undo restores story content but does not promise to retain the
		// editor's active line. The next probe reveals its own unique target, so
		// document-wide marker removal is the relevant restoration contract.
		await expect(content).not.toContainText(suffix);
		const restorePersisted = await waitForRevisionEvent(
			page,
			['save-acknowledgement-complete', 'persistence-save-failed'],
			restoreRevision,
			watcherTimeout
		);

		const synchronized = await pollSnapshot(
			page,
			current =>
				current.renderer.events.filter(
					event => event.name === 'source-editor-controlled-value-synchronized'
				).length > controlledSyncCount
		);
		if (
			synchronized.renderer.events.some(
				event => event.name === 'legacy-delimiter-presence-changed'
			)
		) {
			await waitForEvent(page, 'source-editor-dynamic-extensions-applied');
		}
		const current = await snapshot(page);
		const adapterEvents = current.renderer.events.filter(
			event =>
				event.name === 'legacy-editor-adapter-created' &&
				event.detail?.formatName === 'Chapbook'
		);
		const delimiterEvents = current.renderer.events.filter(
			event =>
				event.name === 'legacy-delimiter-presence-changed' &&
				event.detail?.formatName === 'Chapbook'
		);
		const adapterRebuilds = legacyFormatEventCount(
			current,
			'legacy-editor-adapter-created'
		);
		const lineIndexRebuilds = legacyFormatEventCount(
			current,
			'legacy-lookahead-line-index-rebuilt'
		);

		addSample('chapbook.ordinaryLocation.ordinal', ordinal);
		addSample(
			`chapbook.ordinaryLocation.${probe.label}.adapterRebuildCount`,
			adapterRebuilds
		);
		addSample(
			`chapbook.ordinaryLocation.${probe.label}.lineIndexRebuildCount`,
			lineIndexRebuilds
		);
		assertInvariant(
			`chapbook-ordinary-${probe.label}-preserves-adapter-and-line-index`,
			adapterRebuilds === 0 && lineIndexRebuilds === 0,
			JSON.stringify({
				adapterEvents: adapterEvents.map(event => event.detail),
				adapterRebuilds,
				delimiterEvents: delimiterEvents.map(event => event.detail),
				lineIndexRebuilds
			})
		);
		assertInvariant(
			`chapbook-ordinary-${probe.label}-content-restored`,
			restorePersisted.renderer.events.some(
				event =>
					event.name === 'save-acknowledgement-complete' &&
					event.detail?.revision === restoreRevision
			),
			`${probe.query}; revision ${restoreRevision}`
		);
	}
}

async function measureChapbookDelimiterInvalidation(
	page: Page,
	content: Locator
) {
	await reset(page);
	let previousRevision = await currentRevision(page);

	await content.click();
	await page.keyboard.press(
		process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End'
	);
	await page.keyboard.down('Shift');
	await page.keyboard.press('ArrowLeft');
	await page.keyboard.press('ArrowLeft');
	await page.keyboard.up('Shift');
	await page.keyboard.press('Backspace');
	await waitForEvent(page, 'mutation-applied');
	await waitForMeasure(page, 'mutation-to-paint');
	await expect(content.locator('.cm-activeLine')).toHaveText('');
	await waitForEvent(page, 'legacy-editor-adapter-created');
	await waitForEvent(page, 'legacy-lookahead-line-index-rebuilt');
	const removalRevision = await waitForRevisionAfter(page, previousRevision);
	let current = await snapshot(page);
	const removalAdapterRebuilds = legacyFormatEventCount(
		current,
		'legacy-editor-adapter-created'
	);
	const removalLineIndexRebuilds = legacyFormatEventCount(
		current,
		'legacy-lookahead-line-index-rebuilt'
	);

	addSample(
		'chapbook.delimiterRemove.roundTripMs',
		lastEntry(current, 'mutation-round-trip', 'measure')?.duration
	);
	addSample(
		'chapbook.delimiterRemove.paintMs',
		lastEntry(current, 'mutation-to-paint', 'measure')?.duration
	);
	addSample(
		'chapbook.delimiterRemove.adapterRebuildCount',
		removalAdapterRebuilds
	);
	addSample(
		'chapbook.delimiterRemove.lineIndexRebuildCount',
		removalLineIndexRebuilds
	);
	assertInvariant(
		'chapbook-delimiter-remove-rebuilds-once',
		removalAdapterRebuilds === 1 && removalLineIndexRebuilds === 1,
		JSON.stringify({
			adapterRebuilds: removalAdapterRebuilds,
			lineIndexRebuilds: removalLineIndexRebuilds
		})
	);
	assertInvariant(
		'chapbook-delimiter-remove-avoids-full-replace',
		!current.renderer.bridgeMetrics.some(
			metric => metric.kind === 'replaceProject'
		)
	);
	const removalPersisted = await waitForRevisionEvent(
		page,
		['save-acknowledgement-complete', 'persistence-save-failed'],
		removalRevision,
		watcherTimeout
	);

	assertInvariant(
		'chapbook-delimiter-remove-persisted',
		removalPersisted.renderer.events.some(
			event =>
				event.name === 'save-acknowledgement-complete' &&
				event.detail?.revision === removalRevision
		),
		`revision ${removalRevision}`
	);

	await reset(page);
	previousRevision = removalRevision;
	await content.click();
	await page.keyboard.press(
		process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End'
	);
	await page.keyboard.insertText('--');
	await waitForEvent(page, 'mutation-applied');
	await waitForMeasure(page, 'mutation-to-paint');
	await expect(content.locator('.cm-activeLine')).toHaveText('--');
	await waitForEvent(page, 'legacy-editor-adapter-created');
	await waitForEvent(page, 'legacy-lookahead-line-index-rebuilt');
	const additionRevision = await waitForRevisionAfter(page, previousRevision);

	current = await snapshot(page);
	const additionAdapterRebuilds = legacyFormatEventCount(
		current,
		'legacy-editor-adapter-created'
	);
	const additionLineIndexRebuilds = legacyFormatEventCount(
		current,
		'legacy-lookahead-line-index-rebuilt'
	);
	addSample(
		'chapbook.delimiterAdd.roundTripMs',
		lastEntry(current, 'mutation-round-trip', 'measure')?.duration
	);
	addSample(
		'chapbook.delimiterAdd.paintMs',
		lastEntry(current, 'mutation-to-paint', 'measure')?.duration
	);
	addSample(
		'chapbook.delimiterAdd.adapterRebuildCount',
		additionAdapterRebuilds
	);
	addSample(
		'chapbook.delimiterAdd.lineIndexRebuildCount',
		additionLineIndexRebuilds
	);
	assertInvariant(
		'chapbook-delimiter-add-rebuilds-once',
		additionAdapterRebuilds === 1 && additionLineIndexRebuilds === 1,
		JSON.stringify({
			adapterRebuilds: additionAdapterRebuilds,
			lineIndexRebuilds: additionLineIndexRebuilds
		})
	);
	assertInvariant(
		'chapbook-delimiter-add-avoids-full-replace',
		!current.renderer.bridgeMetrics.some(
			metric => metric.kind === 'replaceProject'
		)
	);
	const additionPersisted = await waitForRevisionEvent(
		page,
		['save-acknowledgement-complete', 'persistence-save-failed'],
		additionRevision,
		watcherTimeout
	);

	assertInvariant(
		'chapbook-delimiter-add-persisted',
		additionPersisted.renderer.events.some(
			event =>
				event.name === 'save-acknowledgement-complete' &&
				event.detail?.revision === additionRevision
		),
		`revision ${additionRevision}`
	);
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
	await page
		.getByRole('group', {name: 'Workspace Mode'})
		.getByRole('tab', {name: 'Text'})
		.click();
	const defaultEditorWindow = page.locator('.story-edit-editor-window').first();

	await expect(defaultEditorWindow).toBeVisible({timeout: 60_000});
	await defaultEditorWindow.getByRole('button', {name: /^Close /}).click();
	await expect(defaultEditorWindow).not.toBeVisible();
	await pollSnapshot(
		page,
		current => current.renderer.owners?.activeEditorCount === 0
	);
	await recordMemoryDetailCheckpoint(page, 'before-editor', true);

	const selectedPassage = page.locator(
		'.story-edit-passage-list-item[aria-current="true"]'
	);

	await expect(selectedPassage).toBeVisible({timeout: 60_000});
	await selectedPassage.click();
	const editSelectedPassage = page.getByRole('button', {
		exact: true,
		name: 'Edit'
	});

	await expect(editSelectedPassage).toBeEnabled();
	const editorOpenStartedAt = nodePerformance.now();

	await editSelectedPassage.click();
	const editorWindow = page.locator('.story-edit-editor-window').first();
	const editor = editorWindow
		.locator('[data-testid^="story-editor-window-"]')
		.first();

	await expect(editor).toBeVisible({timeout: 60_000});
	await pollSnapshot(
		page,
		current => current.renderer.owners?.activeEditorCount === 1
	);
	addSample('editor.openMs', nodePerformance.now() - editorOpenStartedAt);
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
	await pollSnapshot(
		page,
		current =>
			current.renderer.owners?.activeEditorCount === 0 &&
			current.renderer.owners?.editorDocumentBytes === 0
	);
	await recordMemoryDetailCheckpoint(page, 'editor-closed');
	await recordMemoryDetailCheckpoint(page, 'post-editor-close-gc', true);
	const passageItems = page.locator('.story-edit-passage-list-item');
	const lifecycleTargets: Array<{index: number; name: string}> = [];

	for (
		let index = 0;
		index < (await passageItems.count()) && lifecycleTargets.length < 4;
		index++
	) {
		const item = passageItems.nth(index);

		if ((await item.getAttribute('aria-current')) !== 'true') {
			lifecycleTargets.push({
				index,
				name:
					(
						await item.locator('.story-edit-passage-list-name').textContent()
					)?.trim() ?? `passage-${index}`
			});
		}
	}
	assertInvariant(
		'memory-detail-distinct-passage-coverage',
		lifecycleTargets.length === 4 &&
			new Set(lifecycleTargets.map(target => target.name)).size === 4,
		JSON.stringify(lifecycleTargets)
	);
	const lifecycleStart = await snapshot(page);
	const lifecycleAdapterStart = legacyFormatEventCount(
		lifecycleStart,
		'legacy-editor-adapter-created'
	);
	const lifecycleLineIndexStart = legacyFormatEventCount(
		lifecycleStart,
		'legacy-lookahead-line-index-rebuilt'
	);
	const lifecycleWindows: Array<{
		target: (typeof lifecycleTargets)[number];
		window: Locator;
	}> = [];

	for (const [cycle, target] of lifecycleTargets.entries()) {
		const beforeOpen = await snapshot(page);
		const adapterCountBefore = legacyFormatEventCount(
			beforeOpen,
			'legacy-editor-adapter-created'
		);
		const lineIndexCountBefore = legacyFormatEventCount(
			beforeOpen,
			'legacy-lookahead-line-index-rebuilt'
		);

		await passageItems.nth(target.index).click();
		const distinctOpenStartedAt = nodePerformance.now();

		await editSelectedPassage.click();
		const targetWindow = page.locator('.story-edit-editor-window').filter({
			has: page
				.locator('.story-edit-editor-window-name')
				.filter({hasText: target.name})
		});

		await expect(targetWindow).toBeVisible({timeout: 60_000});
		await expect(targetWindow).toHaveAttribute('aria-label', target.name);
		const opened = await pollSnapshot(
			page,
			current =>
				current.renderer.owners?.activeEditorCount === cycle + 1 &&
				(fixtureVariant !== 'chapbook' ||
					(legacyFormatEventCount(current, 'legacy-editor-adapter-created') >
						adapterCountBefore &&
						legacyFormatEventCount(
							current,
							'legacy-lookahead-line-index-rebuilt'
						) > lineIndexCountBefore))
		);
		addSample(
			'memoryDetail.distinctEditor.openMs',
			nodePerformance.now() - distinctOpenStartedAt
		);
		addSample(
			'memoryDetail.distinctEditor.openDocumentBytes',
			opened.renderer.owners?.editorDocumentBytes
		);
		if (fixtureVariant === 'chapbook') {
			const adapterCreations =
				legacyFormatEventCount(opened, 'legacy-editor-adapter-created') -
				adapterCountBefore;
			const lineIndexCreations =
				legacyFormatEventCount(opened, 'legacy-lookahead-line-index-rebuilt') -
				lineIndexCountBefore;

			addSample(
				'memoryDetail.distinctEditor.adapterCreationCount',
				adapterCreations
			);
			addSample(
				'memoryDetail.distinctEditor.lineIndexCreationCount',
				lineIndexCreations
			);
			assertInvariant(
				`memory-detail-distinct-editor-${cycle + 1}-creates-one-legacy-integration`,
				adapterCreations === 1 && lineIndexCreations === 1,
				JSON.stringify({
					adapterCreations,
					lineIndexCreations,
					passage: target.name
				})
			);
		}

		const targetContent = targetWindow.locator('.cm-content');
		const revisionBeforeEdit = await currentRevision(page);

		await targetContent.click();
		await page.keyboard.press('End');
		await page.keyboard.insertText(` memory-editor-${cycle + 1}`);
		const editRevision = await waitForRevisionAfter(page, revisionBeforeEdit);

		await waitForDiagnosticSaveCompletion(page, editRevision, watcherTimeout);
		if (fixtureVariant === 'chapbook') {
			const toolbar = targetWindow.getByRole('toolbar', {
				name: 'Chapbook editor toolbar'
			});
			const style = toolbar.getByRole('button', {name: 'Style'});
			const link = toolbar.getByRole('button', {name: 'Link'});

			await expect(toolbar).toBeVisible();
			await expect(style).toBeEnabled();
			await expect(link).toBeEnabled();
			await page.keyboard.down('Shift');
			await page.keyboard.press('ArrowLeft');
			await page.keyboard.up('Shift');
			await expect(link).toBeDisabled();
			await expect(style).toBeEnabled();
			await page.keyboard.press('ArrowRight');
			await expect(link).toBeEnabled();

			const edited = await snapshot(page);
			const editAdapterCreations =
				legacyFormatEventCount(edited, 'legacy-editor-adapter-created') -
				legacyFormatEventCount(opened, 'legacy-editor-adapter-created');
			const editLineIndexCreations =
				legacyFormatEventCount(edited, 'legacy-lookahead-line-index-rebuilt') -
				legacyFormatEventCount(opened, 'legacy-lookahead-line-index-rebuilt');

			addSample(
				'memoryDetail.distinctEditor.editAdapterRebuildCount',
				editAdapterCreations
			);
			addSample(
				'memoryDetail.distinctEditor.editLineIndexRebuildCount',
				editLineIndexCreations
			);
			assertInvariant(
				`memory-detail-distinct-editor-${cycle + 1}-edit-preserves-integration`,
				editAdapterCreations === 0 && editLineIndexCreations === 0,
				JSON.stringify({
					adapterCreations: editAdapterCreations,
					lineIndexCreations: editLineIndexCreations,
					passage: target.name
				})
			);
		}
		lifecycleWindows.push({target, window: targetWindow});
	}
	const allEditorsOpen = await snapshot(page);

	assertInvariant(
		'memory-detail-four-distinct-editors-open',
		allEditorsOpen.renderer.owners?.activeEditorCount === 4 &&
			(allEditorsOpen.renderer.owners?.editorDocumentBytes ?? 0) > 0,
		JSON.stringify(allEditorsOpen.renderer.owners)
	);
	if (fixtureVariant === 'chapbook') {
		const adapterCreations =
			legacyFormatEventCount(allEditorsOpen, 'legacy-editor-adapter-created') -
			lifecycleAdapterStart;
		const lineIndexCreations =
			legacyFormatEventCount(
				allEditorsOpen,
				'legacy-lookahead-line-index-rebuilt'
			) - lifecycleLineIndexStart;

		assertInvariant(
			'memory-detail-four-editors-create-four-legacy-integrations',
			adapterCreations === 4 && lineIndexCreations === 4,
			JSON.stringify({adapterCreations, lineIndexCreations})
		);
	}
	await recordMemoryDetailCheckpoint(page, 'four-distinct-editors-open');

	for (const [cycle, opened] of lifecycleWindows.entries()) {
		await opened.window.locator('.story-edit-editor-window-bar').click();
		await expect(opened.window).toHaveClass(/is-active/);
		addSample('memoryDetail.distinctEditor.focusOrdinal', cycle);
		assertInvariant(
			`memory-detail-distinct-editor-${cycle + 1}-focusable`,
			await opened.window.evaluate(element =>
				element.classList.contains('is-active')
			),
			opened.target.name
		);
	}

	for (let cycle = lifecycleWindows.length - 1; cycle >= 0; cycle--) {
		const opened = lifecycleWindows[cycle];

		await opened.window.getByRole('button', {name: /^Close /}).click();
		await expect(opened.window).not.toBeVisible();
		const remainingEditorCount = cycle;
		const closed = await pollSnapshot(
			page,
			current =>
				current.renderer.owners?.activeEditorCount === remainingEditorCount &&
				(remainingEditorCount > 0
					? (current.renderer.owners?.editorDocumentBytes ?? 0) > 0
					: current.renderer.owners?.editorDocumentBytes === 0)
		);
		addSample(
			'memoryDetail.distinctEditor.afterCloseDocumentBytes',
			closed.renderer.owners?.editorDocumentBytes
		);
		addSample(
			'memoryDetail.distinctEditor.afterCloseEditorCount',
			closed.renderer.owners?.activeEditorCount
		);
		assertInvariant(
			`memory-detail-distinct-editor-${cycle + 1}-close-releases-owner`,
			closed.renderer.owners?.activeEditorCount === remainingEditorCount &&
				(remainingEditorCount > 0
					? (closed.renderer.owners?.editorDocumentBytes ?? 0) > 0
					: closed.renderer.owners?.editorDocumentBytes === 0),
			JSON.stringify({
				owners: closed.renderer.owners,
				passage: opened.target.name
			})
		);
	}
	await recordMemoryDetailCheckpoint(
		page,
		'post-distinct-editor-cycles-gc',
		true
	);

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
	const fourOpen = checkpointByName.get('four-distinct-editors-open');
	const postCycles = checkpointByName.get('post-distinct-editor-cycles-gc');
	const postContents = checkpointByName.get('post-contents-close-gc');
	const beforeEditor = checkpointByName.get('before-editor');
	const client = current.renderer.core.hosts[0]?.client;
	const localFactsMetric = current.renderer.bridgeMetrics
		.filter(metric => metric.kind === 'queryPassageLocalFacts')
		.at(-1);
	const backlinkMetric = current.renderer.bridgeMetrics
		.filter(metric => metric.kind === 'queryBacklinksPage')
		.at(-1);
	const selectedPassageQueryBound = lifecycleTargets.length + 1;

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
			'four-distinct-editors-open',
			'post-distinct-editor-cycles-gc',
			'contents-open',
			'post-contents-close-gc'
		].every(name => checkpointByName.has(name))
	);
	assertInvariant(
		'memory-detail-before-editor-has-no-active-editor',
		beforeEditor?.renderer.activeEditorCount === 0 &&
			beforeEditor?.renderer.editorDocumentBytes === 0,
		JSON.stringify(beforeEditor?.renderer)
	);
	assertInvariant(
		'memory-detail-one-active-editor',
		postEditor?.renderer.activeEditorCount === 1,
		JSON.stringify(postEditor?.renderer)
	);
	assertInvariant(
		'memory-detail-editor-released',
		postClose?.renderer.activeEditorCount === 0 &&
			postClose?.renderer.editorDocumentBytes === 0 &&
			postClose?.renderer.retainedEditorViewCount === 0 &&
			postClose?.renderer.retainedLegacyDocumentServiceCount === 0 &&
			postClose?.renderer.retainedLegacyModeAdapterCount === 0 &&
			postClose?.renderer.retainedLegacyToolbarDescriptorSetCount === 0 &&
			postClose?.renderer.retainedLegacyToolbarFacadeCount === 0,
		JSON.stringify(postClose?.renderer)
	);
	assertInvariant(
		'memory-detail-distinct-editors-released',
		postCycles?.renderer.activeEditorCount === 0 &&
			postCycles?.renderer.editorDocumentBytes === 0 &&
			postCycles?.renderer.retainedEditorViewCount === 0 &&
			postCycles?.renderer.retainedLegacyDocumentServiceCount === 0 &&
			postCycles?.renderer.retainedLegacyModeAdapterCount === 0 &&
			postCycles?.renderer.retainedLegacyToolbarDescriptorSetCount === 0 &&
			postCycles?.renderer.retainedLegacyToolbarFacadeCount === 0,
		JSON.stringify(postCycles?.renderer)
	);
	assertInvariant(
		'memory-detail-distinct-editor-retained-memory-bounded',
		(postCycles?.renderer.usedJSHeapSize ?? Infinity) <=
			(postClose?.renderer.usedJSHeapSize ?? 0) + 8 * 1024 * 1024 &&
			(postCycles?.renderer.rendererPrivateKiB ?? Infinity) <=
				(postClose?.renderer.rendererPrivateKiB ?? 0) + 64 * 1024,
		JSON.stringify({
			postClose: postClose?.renderer,
			postCycles: postCycles?.renderer
		})
	);
	assertInvariant(
		'memory-detail-four-editor-checkpoint-owned',
		fourOpen?.renderer.activeEditorCount === 4 &&
			(fourOpen?.renderer.editorDocumentBytes ?? 0) > 0 &&
			fourOpen?.renderer.retainedEditorViewCount === 4 &&
			(fixtureVariant === 'chapbook'
				? fourOpen?.renderer.retainedLegacyDocumentServiceCount === 4 &&
					fourOpen?.renderer.retainedLegacyModeAdapterCount === 4 &&
					(fourOpen?.renderer.retainedLegacyToolbarDescriptorSetCount ?? 0) >=
						4 &&
					fourOpen?.renderer.retainedLegacyToolbarFacadeCount === 8
				: fourOpen?.renderer.retainedLegacyDocumentServiceCount === 0 &&
					fourOpen?.renderer.retainedLegacyModeAdapterCount === 0 &&
					fourOpen?.renderer.retainedLegacyToolbarDescriptorSetCount === 0 &&
					fourOpen?.renderer.retainedLegacyToolbarFacadeCount === 0),
		JSON.stringify(fourOpen?.renderer)
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
			(backlinkMetric.readModel?.backlinkCacheEntryCount ?? Infinity) <=
				selectedPassageQueryBound &&
			(backlinkMetric.readModel?.backlinkCacheBytes ?? Infinity) <=
				4 * 1024 * 1024 &&
			!current.renderer.bridgeMetrics.some(
				metric => metric.kind === 'queryPassageFacts'
			),
		JSON.stringify({backlinkMetric, localFactsMetric})
	);
	assertInvariant(
		'memory-detail-default-contents-stays-bounded',
		(postContents?.renderer.rustAnalysisCacheSourceCount ?? Infinity) <=
			selectedPassageQueryBound &&
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
			stringDetail(contentsTrace?.detail?.waitingOn)
		);
		assertInvariant(
			`contents-${index}-session-ready-attribution-present`,
			!!sessionReadyTrace || !!hostCacheHit,
			stringDetail(sessionReadyTrace?.detail?.mode)
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
	const readModel = clients[0]?.readModel;

	assertInvariant(
		'query-phase-worker-idle',
		clients.length > 0 &&
			clients.every(
				client =>
					client.pendingRequestCount === 0 && client.sessionQueueCount === 0
			),
		JSON.stringify(clients)
	);
	assertInvariant(
		'query-search-keeps-expensive-intelligence-deferred',
		!!readModel &&
			readModel.analysisCacheSourceCount <= 16 &&
			readModel.parsedSourceCount <= 16 &&
			readModel.backlinkCacheEntryCount <= 16 &&
			readModel.graphCacheStoryCount === 0 &&
			readModel.readModelCacheStoryCount === 0 &&
			readModel.readModelFullBuildCount === 0,
		JSON.stringify(readModel)
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

function stringDetail(value: unknown) {
	return typeof value === 'string' ? value : undefined;
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
			new Promise<
				Array<{durationMs: number; endTimeMs: number; startTimeMs: number}>
			>(resolve => {
				const samples: Array<{
					durationMs: number;
					endTimeMs: number;
					startTimeMs: number;
				}> = [];
				let previous = performance.now();

				function frame(now: number) {
					samples.push({
						durationMs: now - previous,
						endTimeMs: now,
						startTimeMs: previous
					});
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

async function panMouseAcrossFrames(
	page: Page,
	start: {x: number; y: number},
	end: {x: number; y: number},
	steps = 20
) {
	await page.mouse.move(start.x, start.y);
	await page.mouse.down({button: 'middle'});
	for (let step = 1; step <= steps; step++) {
		await page.evaluate(
			() => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
		);
		const progress = step / steps;

		await page.mouse.move(
			start.x + (end.x - start.x) * progress,
			start.y + (end.y - start.y) * progress
		);
	}
	await page.mouse.up({button: 'middle'});
}

async function measureGraph(page: Page) {
	await page.getByTitle('Workbench').click();
	await page
		.getByRole('complementary', {name: 'Passages'})
		.getByRole('button', {name: /^Passage 000001/})
		.click();
	const graphOpenedAt = await page.evaluate(() => performance.now());

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
	await waitForMarkAfter(
		page,
		'graph-visible',
		graphOpenedAt,
		'graph-query-result',
		60_000
	);
	await waitForWorkerIdle(page);
	await page.evaluate(
		() =>
			new Promise<void>(resolve =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
			)
	);
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
	const initialGraphTransform = await page
		.locator('.story-edit-graph-canvas')
		.evaluate(element => (element as HTMLElement).style.transform);

	for (let index = 0; index < (smoke ? 1 : 5); index++) {
		const box = await viewport.boundingBox();

		if (!box) {
			throw new Error('Graph viewport has no bounding box.');
		}
		const framesPromise = sampleFrames(page);

		await panMouseAcrossFrames(
			page,
			{x: box.x + box.width * 0.6, y: box.y + box.height * 0.5},
			{x: box.x + box.width * 0.4, y: box.y + box.height * 0.45}
		);
		const frames = await framesPromise;

		for (const frame of frames) {
			addSample('graph.frameMs', frame.durationMs);
			addSample('graph.frameMaxMs', frame.durationMs);
			if (frame.durationMs > 25) {
				addSample('graph.frameOutlierDurationMs', frame.durationMs);
				addSample('graph.frameOutlierStartMs', frame.startTimeMs);
				addSample('graph.frameOutlierEndMs', frame.endTimeMs);
				addSample('graph.frameOutlierPanIndex', index);
			}
		}
	}
	await waitForWorkerIdle(page);
	await waitForPersistenceIdle(page);
	const revisionAfterPanning = await currentRevision(page);
	const finalGraphTransform = await page
		.locator('.story-edit-graph-canvas')
		.evaluate(element => (element as HTMLElement).style.transform);

	assertInvariant(
		'graph-panning-changes-world-transform',
		finalGraphTransform !== initialGraphTransform,
		`${initialGraphTransform} -> ${finalGraphTransform}`
	);
	assertInvariant(
		'graph-panning-does-not-mutate-layout',
		revisionAfterPanning === baselineRevision,
		`${baselineRevision} -> ${revisionAfterPanning}`
	);
	const nodeCountAfterPanning = await nodes.count();

	assertInvariant(
		'graph-panning-keeps-mounted-node-count-bounded',
		nodeCountAfterPanning > 0 && nodeCountAfterPanning < 1000,
		`${nodeCountAfterPanning} mounted nodes`
	);
	addSample('graph.mountedNodeCount', nodeCountAfterPanning);
	const visibleNodeIndex = await viewport.evaluate(element => {
		const viewportBounds = element.getBoundingClientRect();

		return Array.from(
			element.querySelectorAll<HTMLElement>('.story-edit-graph-node')
		).findIndex(node => {
			const bounds = node.getBoundingClientRect();
			const centerX = bounds.left + bounds.width / 2;
			const centerY = bounds.top + bounds.height / 2;

			return (
				centerX >= viewportBounds.left + 20 &&
				centerX <= viewportBounds.right - 20 &&
				centerY >= viewportBounds.top + 20 &&
				centerY <= viewportBounds.bottom - 20
			);
		});
	});

	if (visibleNodeIndex < 0) {
		throw new Error('Graph viewport has no draggable visible node.');
	}

	const node = nodes.nth(visibleNodeIndex);

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
		finalRevision === baselineRevision + 1,
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
		nativeSaves.length === 1,
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

function captureMemory(current: PerformanceSnapshot, prefix = 'memory') {
	const mib = 1024 * 1024;
	const metric = (name: string, value: number | undefined) =>
		addSample(`${prefix}.${name}`, value);
	const workingSetKiB = current.main.appMetrics.reduce(
		(total, process) => total + (process.memory?.workingSetSize ?? 0),
		0
	);
	const processWorkingSets = processWorkingSetByRole(current.main.appMetrics);
	const processMiB = (type: string) => {
		const value = processWorkingSets.get(type) ?? 0;

		return value > 0 ? value / 1024 : undefined;
	};
	const rendererWorkingSetMiB = processMiB('Tab');
	const browserWorkingSetMiB = processMiB('Browser');
	const rendererHeapUsedMiB =
		current.renderer.heap.usedJSHeapSize === undefined
			? undefined
			: current.renderer.heap.usedJSHeapSize / mib;
	const mainHeapUsedMiB =
		current.main.memory.heapUsed === undefined
			? undefined
			: current.main.memory.heapUsed / mib;
	const mainExternalMiB =
		current.main.memory.external === undefined
			? undefined
			: current.main.memory.external / mib;
	const client = current.renderer.core.hosts[0]?.client;
	const workerHeapCheckpoint = [...current.main.memoryCheckpoints].sort(
		(left, right) => right.recordedAtEpochMs - left.recordedAtEpochMs
	)[0];
	const workerWasmMiB =
		typeof workerHeapCheckpoint?.renderer.workerWasmMemoryBytes !== 'number'
			? undefined
			: workerHeapCheckpoint.renderer.workerWasmMemoryBytes / mib;
	const workerCdpHeapMiB =
		typeof workerHeapCheckpoint?.renderer.workerHeapCdpUsedBytes !== 'number'
			? undefined
			: workerHeapCheckpoint.renderer.workerHeapCdpUsedBytes / mib;
	const workerSelfReportedHeapMiB =
		client?.workerMemoryObservation?.workerJsHeapUsedBytes === undefined
			? undefined
			: client.workerMemoryObservation.workerJsHeapUsedBytes / mib;
	const mainPrivateMiB = current.main.processMemory?.private
		? current.main.processMemory.private / 1024
		: undefined;
	const rendererPrivateMiB = current.main.rendererNativeMemory?.processMemory
		.private
		? current.main.rendererNativeMemory.processMemory.private / 1024
		: undefined;
	const projectBearingPrivateMiB =
		mainPrivateMiB === undefined || rendererPrivateMiB === undefined
			? undefined
			: mainPrivateMiB + rendererPrivateMiB;
	const knownPrivateOwnerMiB = [
		mainHeapUsedMiB,
		mainExternalMiB,
		rendererHeapUsedMiB,
		workerCdpHeapMiB,
		workerWasmMiB
	].every(value => value !== undefined)
		? mainHeapUsedMiB! +
			mainExternalMiB! +
			rendererHeapUsedMiB! +
			workerCdpHeapMiB! +
			workerWasmMiB!
		: undefined;

	metric(
		'residentMiB',
		workingSetKiB > 0 ? workingSetKiB / 1024 : current.main.memory.rss / mib
	);
	metric('rendererMiB', rendererWorkingSetMiB);
	metric('mainMiB', current.main.memory.rss / mib);
	metric('private.mainMiB', mainPrivateMiB);
	metric('private.rendererMiB', rendererPrivateMiB);
	metric('private.projectBearingMiB', projectBearingPrivateMiB);
	metric('private.knownOwnerMiB', knownPrivateOwnerMiB);
	metric(
		'private.knownOwnerShare',
		knownPrivateOwnerMiB === undefined || !projectBearingPrivateMiB
			? undefined
			: knownPrivateOwnerMiB / projectBearingPrivateMiB
	);
	metric(
		'blink.allocatedMiB',
		current.main.rendererNativeMemory?.blinkMemory.allocated === undefined
			? undefined
			: current.main.rendererNativeMemory.blinkMemory.allocated / 1024
	);
	metric(
		'blink.totalMiB',
		current.main.rendererNativeMemory?.blinkMemory.total === undefined
			? undefined
			: current.main.rendererNativeMemory.blinkMemory.total / 1024
	);
	for (const type of ['Browser', 'GPU', 'Tab', 'Utility']) {
		metric(`process.${type.toLowerCase()}MiB`, processMiB(type));
	}
	metric('heap.rendererUsedMiB', rendererHeapUsedMiB);
	metric('heap.workerCdpUsedMiB', workerCdpHeapMiB);
	metric('heap.workerSelfReportedUsedMiB', workerSelfReportedHeapMiB);
	metric(
		'heap.workerCdpTotalMiB',
		typeof workerHeapCheckpoint?.renderer.workerHeapCdpTotalSize === 'number'
			? workerHeapCheckpoint.renderer.workerHeapCdpTotalSize / mib
			: undefined
	);
	metric(
		'heap.workerCdpResponseDriftMs',
		typeof workerHeapCheckpoint?.renderer.workerHeapCdpResponseDriftMs ===
			'number'
			? workerHeapCheckpoint.renderer.workerHeapCdpResponseDriftMs
			: undefined
	);
	metric(
		'heap.rendererTotalMiB',
		current.renderer.heap.totalJSHeapSize === undefined
			? undefined
			: current.renderer.heap.totalJSHeapSize / mib
	);
	metric('heap.mainUsedMiB', mainHeapUsedMiB);
	metric(
		'heap.mainTotalMiB',
		current.main.memory.heapTotal === undefined
			? undefined
			: current.main.memory.heapTotal / mib
	);
	metric('heap.mainExternalMiB', mainExternalMiB);
	metric(
		'heap.mainArrayBuffersMiB',
		current.main.memory.arrayBuffers === undefined
			? undefined
			: current.main.memory.arrayBuffers / mib
	);
	metric(
		'residual.rendererAfterHeapWorkerJsAndWasmMiB',
		rendererWorkingSetMiB !== undefined &&
			rendererHeapUsedMiB !== undefined &&
			workerCdpHeapMiB !== undefined &&
			workerWasmMiB !== undefined
			? Math.max(
					0,
					rendererWorkingSetMiB -
						rendererHeapUsedMiB -
						workerCdpHeapMiB -
						workerWasmMiB
				)
			: undefined
	);
	metric(
		'residual.mainAfterHeapAndExternalMiB',
		browserWorkingSetMiB !== undefined &&
			mainHeapUsedMiB !== undefined &&
			mainExternalMiB !== undefined
			? Math.max(0, browserWorkingSetMiB - mainHeapUsedMiB - mainExternalMiB)
			: undefined
	);
	metric(
		'residual.rendererPrivateAfterHeapWorkerJsAndWasmMiB',
		rendererPrivateMiB !== undefined &&
			rendererHeapUsedMiB !== undefined &&
			workerCdpHeapMiB !== undefined &&
			workerWasmMiB !== undefined
			? Math.max(
					0,
					rendererPrivateMiB -
						rendererHeapUsedMiB -
						workerCdpHeapMiB -
						workerWasmMiB
				)
			: undefined
	);
	metric(
		'residual.mainPrivateAfterHeapAndExternalMiB',
		mainPrivateMiB !== undefined &&
			mainHeapUsedMiB !== undefined &&
			mainExternalMiB !== undefined
			? Math.max(0, mainPrivateMiB - mainHeapUsedMiB - mainExternalMiB)
			: undefined
	);

	const nativeHydration = current.main.owners?.nativeHydration;
	const projectSessions = current.main.owners?.projectSessions;

	metric('owner.nativeHydrationLeaseCount', nativeHydration?.activeLeaseCount);
	metric(
		'owner.nativeHydrationTextCapacityMiB',
		nativeHydration ? nativeHydration.textCapacityBytes / mib : undefined
	);
	metric(
		'owner.nativeBaselineFileStringMiB',
		projectSessions ? projectSessions.baselineFileStringBytes / mib : undefined
	);
	metric(
		'owner.nativeBaselinePassageCount',
		projectSessions?.baselinePassageCount
	);
	metric(
		'owner.nativeDescriptorPathStringMiB',
		projectSessions
			? projectSessions.descriptorPathStringBytes / mib
			: undefined
	);
	metric(
		'owner.bootstrapTextMiB',
		current.renderer.core.bootstrap?.textBytes === undefined
			? undefined
			: current.renderer.core.bootstrap.textBytes / mib
	);
	metric('owner.workerWasmLinearMiB', workerWasmMiB);
	metric('owner.workerCdpHeapUsedMiB', workerCdpHeapMiB);
	metric('owner.workerSelfReportedHeapUsedMiB', workerSelfReportedHeapMiB);
	metric(
		'owner.workerCachedPayloadMiB',
		client ? client.cachedPayloadBytes / mib : undefined
	);
	metric('owner.workerPendingRequests', client?.pendingRequestCount);
	metric('owner.workerSessionQueues', client?.sessionQueueCount);
	metric('owner.workerReadModelCacheEntries', client?.readModelCacheEntryCount);
	metric('owner.activeEditorCount', current.renderer.owners?.activeEditorCount);
	metric(
		'owner.editorDocumentMiB',
		current.renderer.owners
			? current.renderer.owners.editorDocumentBytes / mib
			: undefined
	);
	metric(
		'owner.retainedEditorViews',
		current.renderer.owners?.retainedEditorViewCount
	);
	metric(
		'owner.retainedLegacyDocumentServices',
		current.renderer.owners?.retainedLegacyDocumentServiceCount
	);
	metric(
		'owner.retainedLegacyModeAdapters',
		current.renderer.owners?.retainedLegacyModeAdapterCount
	);
	metric(
		'owner.retainedLegacyToolbarDescriptorSets',
		current.renderer.owners?.retainedLegacyToolbarDescriptorSetCount
	);
	metric(
		'owner.retainedLegacyToolbarFacades',
		current.renderer.owners?.retainedLegacyToolbarFacadeCount
	);
	const rust = client?.readModel;

	metric(
		'owner.rustProjectDocumentsMiB',
		rust ? rust.projectDocumentBytes / mib : undefined
	);
	metric('owner.rustAnalysisSources', rust?.analysisCacheSourceCount);
	metric(
		'owner.rustBacklinkCacheMiB',
		rust ? rust.backlinkCacheBytes / mib : undefined
	);
	metric('owner.rustBacklinkCacheEntries', rust?.backlinkCacheEntryCount);
	metric('owner.rustBacklinkScans', rust?.backlinkScanCount);
	metric('owner.rustBacklinkScannedSources', rust?.backlinkScannedSourceCount);
	metric('owner.rustFingerprintEntries', rust?.fingerprintEntryCount);
	metric('owner.rustGraphCacheStories', rust?.graphCacheStoryCount);
	metric('owner.rustReadModelCacheStories', rust?.readModelCacheStoryCount);
}

async function recordMemoryDetailCheckpoint(
	page: Page,
	name: string,
	retained = false
) {
	const startedAt = nodePerformance.now();
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
	return nodePerformance.now() - startedAt;
}

interface RefactorFixtureTarget {
	afterName: string;
	beforeName: string;
	passageId: string;
	storyId: string;
}

interface M3QueryFixtureTarget {
	definitionNames: string[];
	passageId: string;
	passageName: string;
	storyId: string;
}

interface M4DiagnosticFixFixtureTarget {
	expectedChangeCount: number;
	selection: 'allSafe';
	storyId: string;
}

function recordM3BridgeSample(
	prefix: string,
	metric: {computeMs: number; responseBytes: number; roundTripMs: number}
) {
	addSample(`${prefix}ComputeMs`, metric.computeMs);
	addSample(`${prefix}ResponseBytes`, metric.responseBytes);
	addSample(`${prefix}RoundTripMs`, metric.roundTripMs);
}

async function measureM3Queries(page: Page, target: M3QueryFixtureTarget) {
	const before = await snapshot(page);
	const baselineReadModel = before.renderer.core.hosts[0]?.client?.readModel;
	const expectedBacklinkScanCount =
		(baselineReadModel?.backlinkScanCount ?? 0) + 1;
	const expectedBacklinkScannedSourceCount =
		(baselineReadModel?.backlinkScannedSourceCount ?? 0) + passageCount;
	const first = await page.evaluate(
		async target =>
			(window as any).twinePerformance.queries.passageReferences(
				target.storyId,
				target.passageId,
				{cursor: null, limit: 50}
			),
		target
	);
	recordM3BridgeSample('refactor.m3.referencesCold', first.metric);
	assertInvariant(
		'refactor-m3-references-cold-page-bounded',
		first.result.storyId === target.storyId &&
			first.result.passageId === target.passageId &&
			first.result.coverage === 'standard-links-only' &&
			first.result.totalCount === passageCount &&
			first.result.references.length === 50 &&
			first.result.nextCursor !== null &&
			new Set(
				first.result.references.map(
					(reference: any) => reference.location.resultKey
				)
			).size === first.result.references.length &&
			first.metric.responseBytes <= 64 * 1024,
		JSON.stringify(first)
	);
	assertInvariant(
		'refactor-m3-references-cold-scans-once-without-full-indexes',
		first.metric.kind === 'queryPassageReferencesPage' &&
			first.metric.readModel?.backlinkScanCount === expectedBacklinkScanCount &&
			first.metric.readModel.backlinkScannedSourceCount ===
				expectedBacklinkScannedSourceCount &&
			first.metric.readModel.graphCacheStoryCount === 0 &&
			first.metric.readModel.readModelCacheStoryCount === 0,
		JSON.stringify(first.metric.readModel)
	);

	const second = await page.evaluate(
		async ({cursor, target}) =>
			(window as any).twinePerformance.queries.passageReferences(
				target.storyId,
				target.passageId,
				{cursor, limit: 50}
			),
		{cursor: first.result.nextCursor, target}
	);
	const firstKeys = new Set(
		first.result.references.map(
			(reference: any) => reference.location.resultKey
		)
	);
	assertInvariant(
		'refactor-m3-references-next-page-reuses-scan',
		second.result.references.length === 50 &&
			second.result.nextCursor !== first.result.nextCursor &&
			second.result.references.every(
				(reference: any) => !firstKeys.has(reference.location.resultKey)
			) &&
			second.metric.readModel?.backlinkScanCount ===
				expectedBacklinkScanCount &&
			(second.metric.readModel.backlinkCacheHitCount ?? 0) >= 1,
		JSON.stringify(second)
	);

	for (let index = 0; index < 20; index++) {
		const references = await page.evaluate(
			async ({index, target}) =>
				(window as any).twinePerformance.queries.passageReferences(
					target.storyId,
					target.passageId,
					{cursor: null, limit: 51 + index}
				),
			{index, target}
		);
		assertInvariant(
			`refactor-m3-references-warm-${index}-bounded`,
			references.result.references.length === 51 + index &&
				references.result.totalCount === passageCount &&
				references.metric.readModel?.backlinkScanCount ===
					expectedBacklinkScanCount &&
				references.metric.responseBytes <= 96 * 1024,
			JSON.stringify(references)
		);
		recordM3BridgeSample('refactor.m3.referencesWarm', references.metric);

		const definition = await page.evaluate(
			async ({expectedRevision, index, target}) =>
				(window as any).twinePerformance.queries.definition({
					expectedRevision,
					name: target.definitionNames[index],
					storyId: target.storyId,
					symbolKind: 'passage'
				}),
			{expectedRevision: first.result.revision, index, target}
		);
		assertInvariant(
			`refactor-m3-definition-${index}-unique-bounded`,
			definition.result.type === 'unique' &&
				definition.result.location.passageName ===
					target.definitionNames[index] &&
				definition.result.location.revision === first.result.revision &&
				definition.metric.kind === 'queryDefinition' &&
				definition.metric.responseBytes <= 16 * 1024,
			JSON.stringify(definition)
		);
		recordM3BridgeSample('refactor.m3.definition', definition.metric);
	}

	const after = await snapshot(page);
	const client = after.renderer.core.hosts[0]?.client;
	assertInvariant(
		'refactor-m3-queries-stay-worker-owned-and-idle',
		after.renderer.core.hosts[0]?.mode === 'wasm-worker' &&
			after.renderer.core.workerClients === 1 &&
			after.renderer.core.activeSessions === 1 &&
			client?.pendingRequestCount === 0 &&
			client.sessionQueueCount === 0 &&
			client.readModel?.graphCacheStoryCount === 0 &&
			client.readModel.readModelCacheStoryCount === 0 &&
			client.readModel.backlinkScanCount === expectedBacklinkScanCount &&
			client.readModel.backlinkScannedSourceCount ===
				expectedBacklinkScannedSourceCount,
		JSON.stringify(client)
	);
	assertInvariant(
		'refactor-m3-query-samples-complete',
		(samples['refactor.m3.referencesWarmComputeMs']?.length ?? 0) === 20 &&
			(samples['refactor.m3.definitionComputeMs']?.length ?? 0) === 20
	);
}

async function measureM4DiagnosticFixes(
	page: Page,
	target: M4DiagnosticFixFixtureTarget
) {
	const warmups = 3;
	const measured = 20;
	await startEditLongTaskObservation(page);
	await page
		.getByRole('group', {name: 'Workspace Mode'})
		.getByRole('tab', {name: 'Text'})
		.click();
	const content = page
		.locator('.story-edit-editor-window')
		.first()
		.locator('[data-testid^="story-editor-window-"]')
		.first()
		.locator('.cm-content');
	await expect(content).toBeVisible({timeout: 60_000});
	// Establish an operation-local baseline from a current worker response in a
	// fresh M4 fixture session. This prevents earlier refactor workloads or a
	// stale response tuple from becoming the comparator.
	await page.evaluate(
		storyId => (window as any).twinePerformance.worker.diagnostics(storyId),
		target.storyId
	);
	await recordMemoryDetailCheckpoint(
		page,
		'refactor-m4-all-safe-response-boundary-baseline'
	);
	const memoryBaseline = await snapshot(page);
	const refactorDiagnostics = diagnostics.refactor;
	if (!refactorDiagnostics) {
		throw new Error(
			'M4 diagnostics require the completed core refactor phase.'
		);
	}
	refactorDiagnostics.checkpoints.push(memoryBaseline);
	const baselineCheckpoint = memoryBaseline.main.memoryCheckpoints.find(
		checkpoint =>
			checkpoint.name === 'refactor-m4-all-safe-response-boundary-baseline'
	);
	assertInvariant(
		'refactor-m4-all-safe-response-boundary-baseline-current-coherent',
		baselineCheckpoint?.sampleCount === 1 &&
			baselineCheckpoint.ownedHighWater.sampleCount === 1 &&
			typeof baselineCheckpoint.ownedHighWater.totalBytes === 'number' &&
			typeof baselineCheckpoint.ownedHighWater.wasmBytes === 'number' &&
			typeof baselineCheckpoint.ownedHighWater.workerCdpUsedBytes ===
				'number' &&
			typeof baselineCheckpoint.ownedHighWater.workerResponseAtEpochMs ===
				'number' &&
			typeof baselineCheckpoint.ownedHighWater.workerCdpSampledAtEpochMs ===
				'number' &&
			typeof baselineCheckpoint.renderer.workerResponseAtEpochMs === 'number' &&
			typeof baselineCheckpoint.renderer.workerHeapCdpSampledAtEpochMs ===
				'number',
		JSON.stringify(baselineCheckpoint)
	);
	let maxPlanStoreBytes = 0;

	for (let index = 0; index < warmups + measured; index++) {
		await content.click();
		await page.keyboard.press('End');
		const beforeRevision = await currentRevision(page);
		await page.evaluate(
			({index, target, warmups}) => {
				const harness = (window as any).twinePerformance;
				const probe = {
					active: true,
					activeBeforeInput: false,
					checkpointOutcome: undefined as Promise<{error?: string}> | undefined,
					editorInputDispatched: false,
					inputStartedAt: undefined as number | undefined,
					promise: undefined as Promise<unknown> | undefined,
					startedAt: performance.now()
				};
				(window as any).__twineM4PlanProbe = probe;
				let workerMetric: any;
				const request = {
					selection: {excludedDiagnosticIds: [], type: target.selection},
					storyId: target.storyId
				};
				const options = {
					onPlanningStarted: () => {
						queueMicrotask(() => {
							const editor = document.querySelector<HTMLElement>(
								'.story-edit-editor-window [data-testid^="story-editor-window-"] .cm-content'
							);
							probe.activeBeforeInput = probe.active;
							probe.inputStartedAt = performance.now();
							editor?.focus();
							probe.editorInputDispatched = Boolean(
								editor &&
								document.execCommand(
									'insertText',
									false,
									` m4-all-safe-typing-${target.expectedChangeCount}`
								)
							);
						});
					},
					onWorkerMetric: (metric: any) => (workerMetric = metric)
				};
				const operation =
					index >= warmups
						? harness.refactor.planDiagnosticFixesObserved(
								target.storyId,
								request,
								'refactor-m4-all-safe-plan-response-boundary',
								options
							)
						: {
								result: harness.refactor.planDiagnosticFixes(
									target.storyId,
									request,
									options
								),
								workerResponseCheckpoint: Promise.resolve()
							};
				probe.checkpointOutcome = operation.workerResponseCheckpoint.then(
					() => ({}),
					(error: unknown) => ({error: String(error)})
				);
				probe.promise = operation.result
					.then((result: any) => ({
						activeBeforeInput: probe.activeBeforeInput,
						durationMs: performance.now() - probe.startedAt,
						editorInputDispatched: probe.editorInputDispatched,
						finishedAt: performance.now(),
						inputStartedAt: probe.inputStartedAt,
						result,
						serializedBytes: new TextEncoder().encode(JSON.stringify(result))
							.byteLength,
						workerMetric
					}))
					.finally(() => {
						probe.active = false;
					});
			},
			{index, target, warmups}
		);
		await page.waitForFunction(
			() =>
				typeof (window as any).__twineM4PlanProbe?.inputStartedAt === 'number',
			undefined,
			{timeout: 60_000}
		);
		const revision = await waitForRevisionAfter(page, beforeRevision);
		const inputStartedAt = await page.evaluate(
			() => (window as any).__twineM4PlanProbe.inputStartedAt as number
		);
		const editTiming = await waitForMutationPaintForRevision(page, {
			inputStartedAt,
			revision
		});
		const planned = await page.evaluate(async () => {
			const probe = (window as any).__twineM4PlanProbe;
			return probe.promise;
		});
		const checkpointOutcome = await page.evaluate(async () => {
			const probe = (window as any).__twineM4PlanProbe;
			const outcome = await probe.checkpointOutcome;
			delete (window as any).__twineM4PlanProbe;
			return outcome;
		});
		if (checkpointOutcome.error) {
			throw new Error(checkpointOutcome.error);
		}
		const longTasks = await mutationWindowLongTasks(page, {
			duration: planned.durationMs,
			startTime: planned.finishedAt - planned.durationMs
		});
		addSample(
			'refactor.m4.allSafe.longTaskMs',
			Math.max(0, ...longTasks.map(task => task.duration))
		);
		assertInvariant(
			`refactor-m4-all-safe-plan-${index}-complete-bounded`,
			planned.activeBeforeInput &&
				planned.editorInputDispatched &&
				planned.result.type === 'complete' &&
				planned.result.summary.operationKind === 'diagnostic-fixes' &&
				planned.result.summary.coverage === 'deterministic-safe-fixes' &&
				planned.result.summary.changeCount === target.expectedChangeCount &&
				planned.serializedBytes <= 64 * 1024 &&
				planned.workerMetric?.kind === 'planDiagnosticFixes' &&
				typeof planned.workerMetric.rustStartedAtEpochMs === 'number' &&
				typeof planned.workerMetric.rustFinishedAtEpochMs === 'number',
			JSON.stringify(planned)
		);
		assertInvariant(
			`refactor-m4-all-safe-typing-${index}-measured-during-plan`,
			planned.finishedAt >= inputStartedAt && revision === beforeRevision + 1,
			JSON.stringify({
				beforeRevision,
				finishedAt: planned.finishedAt,
				inputStartedAt,
				revision
			})
		);
		for (const task of longTasks) {
			assertInvariant(
				`refactor-m4-all-safe-plan-${index}-long-task-limit`,
				task.duration <= 50,
				`${task.duration.toFixed(2)}ms`
			);
		}
		if (index >= warmups) {
			addSample('refactor.m4.allSafe.planMs', planned.durationMs);
			addSample('refactor.m4.allSafe.summaryBytes', planned.serializedBytes);
			addSample('refactor.m4.allSafe.editPaintMs', editTiming.paint.duration);
		}
		await page.evaluate(
			storyId => (window as any).twinePerformance.review.closeReview(storyId),
			target.storyId
		);
		const undo = page.getByRole('button', {name: /^Undo/});
		await expect(undo).toBeEnabled();
		await undo.click();
		const undoRevision = await waitForRevisionAfter(page, revision);
		await waitForRevisionEvent(page, ['undo-applied'], undoRevision);
		await waitForPersistenceIdle(page);
	}

	const postPlan = await snapshot(page);
	refactorDiagnostics.checkpoints.push(postPlan);
	const postPlanStore = refactorStoreSnapshot(postPlan);
	maxPlanStoreBytes = Math.max(
		maxPlanStoreBytes,
		postPlanStore?.refactorPlanStoreBytes ?? 0
	);
	const planResponseBoundary = postPlan.main.memoryCheckpoints.find(
		checkpoint =>
			checkpoint.name === 'refactor-m4-all-safe-plan-response-boundary'
	);
	assertInvariant(
		'refactor-m4-all-safe-plan-response-boundary-retained',
		planResponseBoundary?.sampleCount === measured &&
			planResponseBoundary.ownedHighWater.sampleCount >= 1 &&
			planResponseBoundary.ownedHighWater.sampleCount <= measured &&
			typeof planResponseBoundary.ownedHighWater.totalBytes === 'number' &&
			typeof planResponseBoundary.ownedHighWater.wasmBytes === 'number' &&
			typeof planResponseBoundary.ownedHighWater.workerCdpUsedBytes ===
				'number' &&
			typeof planResponseBoundary.ownedHighWater.workerResponseAtEpochMs ===
				'number' &&
			typeof planResponseBoundary.ownedHighWater.workerCdpSampledAtEpochMs ===
				'number',
		JSON.stringify(planResponseBoundary)
	);

	await page.evaluate(
		storyId => (window as any).twinePerformance.review.closeReview(storyId),
		target.storyId
	);
	const heapBeforeDetail = await page.evaluate(() =>
		(window as any).twinePerformance.rendererHeapAfterGarbageCollection()
	);
	const detailPlan = await page.evaluate(async target => {
		const harness = (window as any).twinePerformance;
		return harness.refactor.planDiagnosticFixes(target.storyId, {
			selection: {excludedDiagnosticIds: [], type: target.selection},
			storyId: target.storyId
		});
	}, target);
	assertInvariant(
		'refactor-m4-all-safe-detail-plan-complete',
		detailPlan.type === 'complete' &&
			detailPlan.summary.changeCount === target.expectedChangeCount,
		JSON.stringify(detailPlan)
	);
	if (detailPlan.type === 'complete') {
		for (let index = 0; index < warmups + measured; index++) {
			const detail = await page.evaluate(
				async ({cursor, measuredSample, storyId}) => {
					const harness = (window as any).twinePerformance;
					const startedAt = performance.now();
					const operation = measuredSample
						? harness.refactor.detailObserved(
								storyId,
								cursor,
								'refactor-m4-all-safe-detail-response-boundary'
							)
						: {
								result: harness.refactor.detail(storyId, cursor),
								workerResponseCheckpoint: Promise.resolve()
							};
					const result = await operation.result;
					const durationMs = performance.now() - startedAt;
					const checkpointError = await operation.workerResponseCheckpoint.then(
						() => undefined,
						(error: unknown) => String(error)
					);
					return {
						checkpointError,
						durationMs,
						result,
						serializedBytes: new TextEncoder().encode(JSON.stringify(result))
							.byteLength
					};
				},
				{
					cursor: detailPlan.summary.firstDetailCursor,
					measuredSample: index >= warmups,
					storyId: target.storyId
				}
			);
			if (detail.checkpointError) throw new Error(detail.checkpointError);
			assertInvariant(
				`refactor-m4-all-safe-detail-${index}-canonical-bounded`,
				detail.result.type === 'page' &&
					detail.result.page.changes.length > 0 &&
					detail.result.page.changes.length <= 200 &&
					detail.result.page.changes.every(
						(change: any) => change.kind === 'add-passage'
					) &&
					detail.serializedBytes <= 256 * 1024,
				JSON.stringify(detail)
			);
			if (index >= warmups) {
				addSample('refactor.m4.allSafe.detailPageMs', detail.durationMs);
				addSample(
					'refactor.m4.allSafe.detailPageBytes',
					detail.serializedBytes
				);
			}
		}
	}
	const postDetail = await snapshot(page);
	refactorDiagnostics.checkpoints.push(postDetail);
	const postDetailStore = refactorStoreSnapshot(postDetail);
	maxPlanStoreBytes = Math.max(
		maxPlanStoreBytes,
		postDetailStore?.refactorPlanStoreBytes ?? 0
	);
	const detailResponseBoundary = postDetail.main.memoryCheckpoints.find(
		checkpoint =>
			checkpoint.name === 'refactor-m4-all-safe-detail-response-boundary'
	);
	assertInvariant(
		'refactor-m4-all-safe-detail-response-boundary-retained',
		detailResponseBoundary?.sampleCount === measured &&
			detailResponseBoundary.ownedHighWater.sampleCount >= 1 &&
			detailResponseBoundary.ownedHighWater.sampleCount <= measured &&
			typeof detailResponseBoundary.ownedHighWater.totalBytes === 'number' &&
			typeof detailResponseBoundary.ownedHighWater.wasmBytes === 'number' &&
			typeof detailResponseBoundary.ownedHighWater.workerCdpUsedBytes ===
				'number' &&
			typeof detailResponseBoundary.ownedHighWater.workerResponseAtEpochMs ===
				'number' &&
			typeof detailResponseBoundary.ownedHighWater.workerCdpSampledAtEpochMs ===
				'number',
		JSON.stringify(detailResponseBoundary)
	);
	const baselineResponseBoundaryBytes =
		baselineCheckpoint?.ownedHighWater.totalBytes;
	const maxResponseBoundaryBytes = Math.max(
		planResponseBoundary?.ownedHighWater.totalBytes ?? Number.NaN,
		detailResponseBoundary?.ownedHighWater.totalBytes ?? Number.NaN
	);
	addSample(
		'refactor.m4.allSafe.responseBoundaryIncrementalMemoryMiB',
		typeof baselineResponseBoundaryBytes !== 'number' ||
			!Number.isFinite(maxResponseBoundaryBytes)
			? undefined
			: Math.max(0, maxResponseBoundaryBytes - baselineResponseBoundaryBytes) /
					(1024 * 1024)
	);
	addSample(
		'refactor.m4.allSafe.planStoreMiB',
		maxPlanStoreBytes / (1024 * 1024)
	);
	await page.evaluate(
		storyId => (window as any).twinePerformance.review.closeReview(storyId),
		target.storyId
	);
	const heapAfterClose = await page.evaluate(() =>
		(window as any).twinePerformance.rendererHeapAfterGarbageCollection()
	);
	addSample(
		'refactor.m4.allSafe.retainedFrontendMiB',
		Math.max(
			0,
			(heapAfterClose.usedJSHeapSize - heapBeforeDetail.usedJSHeapSize) /
				1024 /
				1024
		)
	);
	const detailBridgeMetric = (await snapshot(page)).renderer.bridgeMetrics
		.filter(metric => metric.kind === 'queryRefactorPlanDetail')
		.at(-1);
	assertInvariant(
		'refactor-m4-detail-worker-operation-observed',
		detailBridgeMetric?.kind === 'queryRefactorPlanDetail' &&
			typeof detailBridgeMetric.rustStartedAtEpochMs === 'number' &&
			typeof detailBridgeMetric.rustFinishedAtEpochMs === 'number',
		JSON.stringify(detailBridgeMetric)
	);
	assertInvariant(
		'refactor-m4-all-safe-measured-samples-complete',
		[
			'refactor.m4.allSafe.planMs',
			'refactor.m4.allSafe.summaryBytes',
			'refactor.m4.allSafe.detailPageMs',
			'refactor.m4.allSafe.detailPageBytes',
			'refactor.m4.allSafe.editPaintMs'
		].every(name => (samples[name]?.length ?? 0) === measured),
		JSON.stringify(
			Object.fromEntries(
				Object.entries(samples).filter(([name]) =>
					name.startsWith('refactor.m4')
				)
			)
		)
	);
	assertInvariant(
		'refactor-m4-all-safe-response-boundary-memory-sample-complete',
		(samples['refactor.m4.allSafe.responseBoundaryIncrementalMemoryMiB']
			?.length ?? 0) === 1,
		JSON.stringify(
			samples['refactor.m4.allSafe.responseBoundaryIncrementalMemoryMiB']
		)
	);
	await stopEditLongTaskObservation(page);
}

function refactorStoreSnapshot(current: PerformanceSnapshot) {
	const readModel = current.renderer.core.hosts[0]?.client?.readModel;

	return readModel
		? {
				refactorPlanStoreBytes: readModel.refactorPlanStoreBytes,
				refactorPlanStoreEntryCount: readModel.refactorPlanStoreEntryCount,
				refactorPlanStoreFingerprint: readModel.refactorPlanStoreFingerprint
			}
		: undefined;
}

function refactorPlanningTaskSnapshot(current: PerformanceSnapshot) {
	const readModel = current.renderer.core.hosts[0]?.client?.readModel;

	return readModel
		? {
				refactorPlanningTaskBytes: readModel.refactorPlanningTaskBytes,
				refactorPlanningTaskCount: readModel.refactorPlanningTaskCount
			}
		: undefined;
}

function refactorOwnedMiB(
	current: PerformanceSnapshot,
	checkpointName?: string
) {
	const checkpoint = checkpointName
		? current.main.memoryCheckpoints.find(item => item.name === checkpointName)
		: [...current.main.memoryCheckpoints].sort(
				(left, right) => right.recordedAtEpochMs - left.recordedAtEpochMs
			)[0];
	const ownedBytes = checkpoint?.ownedHighWater.totalBytes;

	// The authoritative tuple is recorded in main after CDP samples the worker
	// target: renderer JS + CDP worker usedSize + one response's WASM bytes.
	return typeof ownedBytes === 'number'
		? ownedBytes / (1024 * 1024)
		: undefined;
}

function refactorProcessPrivateComponentsMiB(current: PerformanceSnapshot) {
	return {
		main: (current.main.processMemory?.private ?? 0) / 1024,
		renderer:
			(current.main.rendererNativeMemory?.processMemory.private ?? 0) / 1024
	};
}

function refactorOwnedIncrementalMiB(
	baseline: PerformanceSnapshot,
	current: PerformanceSnapshot
) {
	const currentMiB = refactorOwnedMiB(current);
	const baselineMiB = refactorOwnedMiB(baseline, 'refactor-baseline');

	return currentMiB === undefined || baselineMiB === undefined
		? undefined
		: Math.max(0, currentMiB - baselineMiB);
}

function recordRefactorMemoryObservation(
	baseline: PerformanceSnapshot,
	current: PerformanceSnapshot
) {
	addSample(
		'refactor.peakIncrementalMemoryMiB',
		refactorOwnedIncrementalMiB(baseline, current)
	);
	const beforePrivate = refactorProcessPrivateComponentsMiB(baseline);
	const currentPrivate = refactorProcessPrivateComponentsMiB(current);

	addSample(
		'refactor.processPrivateIncrementalMiB',
		Math.max(
			0,
			currentPrivate.main +
				currentPrivate.renderer -
				(beforePrivate.main + beforePrivate.renderer)
		)
	);
	addSample(
		'refactor.processPrivateMainIncrementalMiB',
		Math.max(0, currentPrivate.main - beforePrivate.main)
	);
	addSample(
		'refactor.processPrivateRendererIncrementalMiB',
		Math.max(0, currentPrivate.renderer - beforePrivate.renderer)
	);
}

function recordRefactorCheckpointMemoryObservation(
	baseline: PerformanceSnapshot,
	checkpoint: PerformanceSnapshot['main']['memoryCheckpoints'][number]
) {
	addSample(
		'refactor.peakIncrementalMemoryMiB',
		checkpoint.ownedHighWater.totalBytes === undefined ||
			refactorOwnedMiB(baseline, 'refactor-baseline') === undefined
			? undefined
			: Math.max(
					0,
					checkpoint.ownedHighWater.totalBytes / (1024 * 1024) -
						refactorOwnedMiB(baseline, 'refactor-baseline')!
				)
	);
	const beforePrivate = refactorProcessPrivateComponentsMiB(baseline);
	const privateHighWater = checkpoint.processPrivateHighWater;

	addSample(
		'refactor.processPrivateIncrementalMiB',
		Math.max(
			0,
			privateHighWater.totalBytes / (1024 * 1024) -
				(beforePrivate.main + beforePrivate.renderer)
		)
	);
	addSample(
		'refactor.processPrivateMainIncrementalMiB',
		Math.max(
			0,
			privateHighWater.mainPrivateBytes / (1024 * 1024) - beforePrivate.main
		)
	);
	addSample(
		'refactor.processPrivateRendererIncrementalMiB',
		Math.max(
			0,
			privateHighWater.rendererPrivateBytes / (1024 * 1024) -
				beforePrivate.renderer
		)
	);
}

async function planRefactor(
	page: Page,
	target: RefactorFixtureTarget,
	{cancelOnFirstPending = false}: {cancelOnFirstPending?: boolean} = {}
) {
	return page.evaluate(
		async ({cancelOnFirstPending, target}) => {
			const controller = new AbortController();
			let pendingCount = 0;
			const startedAt = performance.now();
			const operation = (window as any).twinePerformance.refactor.plan(
				target.storyId,
				{
					includePassageNames: false,
					includePassageText: true,
					includeScript: false,
					includeStylesheet: false,
					matchCase: true,
					query: 'Synthetic',
					replacement: 'Generated',
					storyId: target.storyId,
					useRegexes: false
				},
				{
					signal: controller.signal,
					onProgress: (progress: {type: string}) => {
						if (progress.type === 'pending') {
							pendingCount += 1;
							if (cancelOnFirstPending) controller.abort();
						}
					}
				}
			);
			const result = await operation.result;
			const durationMs = performance.now() - startedAt;
			await operation.terminalCheckpoint;
			return {
				durationMs,
				pendingCount,
				result,
				serializedBytes: new TextEncoder().encode(JSON.stringify(result))
					.byteLength
			};
		},
		{cancelOnFirstPending, target}
	);
}

async function applyRefactorUnrelatedEditorMutation(page: Page, label: string) {
	await page
		.getByRole('group', {name: 'Workspace Mode'})
		.getByRole('tab', {name: 'Text'})
		.click();
	const content = page
		.locator('.story-edit-editor-window')
		.first()
		.locator('[data-testid^="story-editor-window-"]')
		.first()
		.locator('.cm-content');
	await expect(content).toBeVisible({timeout: 60_000});
	const beforeRevision = await currentRevision(page);
	await content.click();
	await page.keyboard.press('End');
	const startedAt = await page.evaluate(() => performance.now());
	await page.keyboard.insertText(` ${label}`);
	const revision = await waitForRevisionAfter(page, beforeRevision);
	await waitForRevisionEvent(page, ['mutation-applied'], revision);
	await waitForMutationPaintAfter(page, startedAt);

	return {beforeRevision, revision};
}

async function measureRefactorTyping(
	page: Page,
	target: RefactorFixtureTarget,
	baseline: PerformanceSnapshot,
	initialHighWaterSampleCount: number
) {
	const warmups = 2;
	const measured = 20;
	await page
		.getByRole('group', {name: 'Workspace Mode'})
		.getByRole('tab', {name: 'Text'})
		.click();
	const editor = page
		.locator('.story-edit-editor-window')
		.first()
		.locator('[data-testid^="story-editor-window-"]')
		.first();
	const content = editor.locator('.cm-content');
	await expect(content).toBeVisible({timeout: 60_000});

	let expectedHighWaterSampleCount = initialHighWaterSampleCount;
	let measuredWindows = 0;
	let warmupWindows = 0;
	const compositorSettles: RefactorTypingCompositorSettle[] = [];

	for (let index = 0; index < warmups + measured; index++) {
		await page.evaluate(target => {
			const controller = new AbortController();
			const probe = {
				active: true,
				controller,
				gateHeld: false,
				pending: 0,
				promise: undefined as Promise<unknown> | undefined,
				releasePendingGate: undefined as (() => void) | undefined
			};
			(window as any).__twineRefactorTypingProbe = probe;
			probe.promise = (window as any).twinePerformance.refactor
				.plan(
					target.storyId,
					{
						includePassageNames: false,
						includePassageText: true,
						includeScript: false,
						includeStylesheet: false,
						matchCase: true,
						query: 'Synthetic',
						replacement: 'Generated',
						storyId: target.storyId,
						useRegexes: false
					},
					{
						signal: controller.signal,
						onProgress: async (result: {type: string}) => {
							if (result.type !== 'pending') return;
							probe.pending += 1;
							if (probe.gateHeld) return;
							probe.gateHeld = true;
							await new Promise<void>(resolve => {
								probe.releasePendingGate = resolve;
							});
						}
					}
				)
				.result.finally(() => {
					probe.active = false;
				});
		}, target);
		await page.waitForFunction(
			() => (window as any).__twineRefactorTypingProbe?.pending > 0,
			undefined,
			{timeout: 60_000}
		);
		// This is the sole pre-edit observation. The planner is still held at its
		// awaited pending callback, so one coherent snapshot records task/store
		// ownership, the shared high-water result, and the revision for this edit.
		const pendingSnapshot = await snapshot(page);
		recordRefactorMemoryObservation(baseline, pendingSnapshot);
		const storeBeforeCancellation = refactorStoreSnapshot(pendingSnapshot);
		const pendingCheckpoint = pendingSnapshot.main.memoryCheckpoints.find(
			checkpoint => checkpoint.name === 'refactor-plan-high-water'
		);
		const beforeRevision =
			pendingSnapshot.renderer.core.hosts[0]?.sessions[0]?.revision ?? 0;
		assertInvariant(
			`refactor-typing-${index}-pending-coherent-observation`,
			await page.evaluate(
				() => (window as any).__twineRefactorTypingProbe?.active === true
			)
		);
		const pendingTask = refactorPlanningTaskSnapshot(pendingSnapshot);
		assertInvariant(
			`refactor-typing-${index}-pending-rust-task-observable`,
			pendingTask?.refactorPlanningTaskCount === 1 &&
				(pendingTask.refactorPlanningTaskBytes ?? 0) > 0,
			JSON.stringify(pendingTask)
		);
		assertInvariant(
			`refactor-typing-${index}-shared-high-water-recorded-once`,
			pendingCheckpoint?.sampleCount === expectedHighWaterSampleCount + 1,
			JSON.stringify({
				expected: expectedHighWaterSampleCount + 1,
				observed: pendingCheckpoint?.sampleCount
			})
		);
		assertInvariant(
			`refactor-typing-${index}-pending-observation-supplies-store-and-revision`,
			storeBeforeCancellation !== undefined &&
				typeof storeBeforeCancellation.refactorPlanStoreFingerprint ===
					'string' &&
				Number.isSafeInteger(
					storeBeforeCancellation.refactorPlanStoreEntryCount
				) &&
				Number.isSafeInteger(storeBeforeCancellation.refactorPlanStoreBytes) &&
				Number.isSafeInteger(beforeRevision) &&
				beforeRevision >= 0,
			JSON.stringify({beforeRevision, storeBeforeCancellation})
		);
		if (pendingCheckpoint) {
			expectedHighWaterSampleCount = pendingCheckpoint.sampleCount;
		}
		const compositorSettle = await page.evaluate(async () => {
			const isReady = () => {
				const probe = (window as any).__twineRefactorTypingProbe;
				return (
					probe?.active === true && probe.gateHeld === true && probe.pending > 0
				);
			};
			let frames = 0;
			let ready = isReady();
			await new Promise<void>(resolve => {
				requestAnimationFrame(() => {
					frames += 1;
					const firstFrameReady = isReady();
					ready = ready && firstFrameReady;
					requestAnimationFrame(() => {
						frames += 1;
						const secondFrameReady = isReady();
						ready = ready && secondFrameReady;
						resolve();
					});
				});
			});
			const probe = (window as any).__twineRefactorTypingProbe;
			return {frames, pending: probe?.pending ?? 0, ready};
		});
		if (compositorSettles.length < warmups + measured) {
			compositorSettles.push({index, ...compositorSettle});
		}
		assertInvariant(
			`refactor-typing-${index}-input-compositor-settled`,
			compositorSettle.frames === 2 &&
				compositorSettle.pending > 0 &&
				compositorSettle.ready,
			JSON.stringify({index, ...compositorSettle})
		);
		await content.click();
		await page.keyboard.press('End');
		const startedAt = await page.evaluate(() => performance.now());
		await page.keyboard.insertText(` refactor-typing-${index}`);
		const revision = await waitForRevisionAfter(page, beforeRevision);
		const editTiming = await waitForMutationPaintForRevision(page, {
			inputStartedAt: startedAt,
			revision
		});
		const paint = editTiming.paint;
		const window = {
			duration: Math.max(0, paint.startTime + paint.duration - startedAt),
			startTime: startedAt
		};
		const longTasks = window ? await mutationWindowLongTasks(page, window) : [];
		addSample(
			'refactor.longTaskMs',
			Math.max(0, ...longTasks.map(task => task.duration))
		);
		assertInvariant(`refactor-typing-${index}-paint-present`, !!paint);
		assertInvariant(
			`refactor-typing-${index}-new-revision`,
			revision > beforeRevision,
			`${beforeRevision} -> ${revision}`
		);
		assertInvariant(
			`refactor-typing-${index}-plan-pending-through-paint`,
			await page.evaluate(
				() =>
					(window as any).__twineRefactorTypingProbe?.active === true &&
					(window as any).__twineRefactorTypingProbe?.pending > 0
			)
		);
		if (index < warmups) {
			warmupWindows += 1;
		} else {
			measuredWindows += 1;
			addSample('refactor.editPaintMs', paint.duration);
			addSample('refactor.editWorkerMs', editTiming.stages.workerMs);
			addSample(
				'refactor.editPatchDispatchMs',
				editTiming.stages.patchDispatchMs
			);
			addSample('refactor.editFrameWaitMs', editTiming.stages.frameWaitMs);
		}
		assertInvariant(
			`refactor-typing-${index}-stage-durations-valid`,
			[
				...Object.values(editTiming.stages).filter(
					(value): value is number => typeof value === 'number'
				)
			].every(value => Number.isFinite(value) && value >= 0),
			JSON.stringify(editTiming.stages)
		);
		assertInvariant(
			`refactor-typing-${index}-stages-recompute-paint`,
			Math.abs(
				editTiming.stages.workerMs +
					editTiming.stages.patchDispatchMs +
					editTiming.stages.frameWaitMs -
					editTiming.stages.totalMs
			) <= 0.5,
			JSON.stringify(editTiming.stages)
		);
		for (const task of longTasks) {
			addSample('refactor.longTaskMs', task.duration);
			assertInvariant(
				`refactor-typing-${index}-long-task-limit`,
				task.duration <= 50,
				`${task.duration.toFixed(2)}ms`
			);
		}
		const cancellation = await page.evaluate(async () => {
			const probe = (window as any).__twineRefactorTypingProbe;
			probe.controller.abort();
			probe.releasePendingGate?.();
			const result = await probe.promise;
			delete (window as any).__twineRefactorTypingProbe;
			return result;
		});
		const afterCancellationSnapshot = await snapshot(page);
		const storeAfterCancellation = refactorStoreSnapshot(
			afterCancellationSnapshot
		);
		const taskAfterCancellation = refactorPlanningTaskSnapshot(
			afterCancellationSnapshot
		);
		assertInvariant(
			`refactor-typing-${index}-cancelled-after-paint`,
			(cancellation as {type?: string}).type === 'cancelled',
			JSON.stringify(cancellation)
		);
		assertInvariant(
			`refactor-typing-${index}-cancellation-keeps-plan-store`,
			JSON.stringify(storeBeforeCancellation) ===
				JSON.stringify(storeAfterCancellation),
			JSON.stringify({storeAfterCancellation, storeBeforeCancellation})
		);
		assertInvariant(
			`refactor-typing-${index}-cancellation-releases-rust-task`,
			taskAfterCancellation?.refactorPlanningTaskCount === 0 &&
				taskAfterCancellation.refactorPlanningTaskBytes === 0,
			JSON.stringify({taskAfterCancellation})
		);
		const undo = page.getByRole('button', {name: /^Undo/});
		await expect(undo).toBeEnabled();
		await undo.click();
		const undoRevision = await waitForRevisionAfter(page, revision);
		await waitForRevisionEvent(page, ['undo-applied'], undoRevision);
	}

	assertInvariant(
		'refactor-typing-warmup-policy',
		warmupWindows === 2 && measuredWindows === 20,
		JSON.stringify({measuredWindows, warmupWindows})
	);
	assertInvariant(
		'refactor-typing-input-compositor-settles-complete',
		compositorSettles.length === warmups + measured &&
			compositorSettles.every(
				(observation, position) =>
					observation.index === position &&
					observation.frames === 2 &&
					observation.pending > 0 &&
					observation.ready
			),
		JSON.stringify(compositorSettles)
	);

	return compositorSettles;
}

function checkpointFor(current: PerformanceSnapshot, name: string) {
	return current.main.memoryCheckpoints.find(
		checkpoint => checkpoint.name === name
	);
}

async function verifyWorkerJsMemoryProbe(page: Page, storyId: string) {
	const initialCheckpointMs = await recordMemoryDetailCheckpoint(
		page,
		'refactor-worker-probe-attached'
	);
	const attached = await snapshot(page);
	const attachedCheckpoint = checkpointFor(
		attached,
		'refactor-worker-probe-attached'
	);

	assertInvariant(
		'refactor-worker-cdp-memory-observation-supported',
		typeof attachedCheckpoint?.renderer.workerHeapCdpUsedBytes === 'number' &&
			typeof attachedCheckpoint.renderer.workerWasmMemoryBytes === 'number' &&
			typeof attachedCheckpoint.renderer.workerHeapCdpSampledAtEpochMs ===
				'number' &&
			typeof attachedCheckpoint.renderer.workerHeapCdpTargetId === 'string' &&
			typeof attachedCheckpoint.renderer.workerHeapCdpResponseDriftMs ===
				'number' &&
			attachedCheckpoint.renderer.workerHeapCdpResponseDriftMs <= 5_000,
		JSON.stringify(attachedCheckpoint?.renderer)
	);
	assertInvariant(
		'refactor-worker-cdp-first-response-bounded',
		initialCheckpointMs < 4_000,
		`${initialCheckpointMs.toFixed(1)}ms`
	);

	const diagnosticStartedAt = nodePerformance.now();
	await page.evaluate(
		targetStoryId =>
			(window as any).twinePerformance.worker.diagnostics(targetStoryId),
		storyId
	);
	const diagnosticMs = nodePerformance.now() - diagnosticStartedAt;
	assertInvariant(
		'refactor-worker-post-attach-diagnostic-bounded',
		diagnosticMs < 2_000,
		`${diagnosticMs.toFixed(1)}ms`
	);
	const diagnosticReadModel = (await snapshot(page)).renderer.core.hosts[0]
		?.client?.readModel;
	assertInvariant(
		'refactor-worker-diagnostic-retained-before-metric-only-probe',
		diagnosticReadModel !== undefined,
		JSON.stringify(diagnosticReadModel)
	);
	// The diagnostic itself may grow the WASM allocator. Baseline after it, so
	// the retained JS-string probe is isolated from that legitimate worker work.
	await recordMemoryDetailCheckpoint(page, 'refactor-worker-probe-before');
	const before = await snapshot(page);
	const beforeCheckpoint = checkpointFor(
		before,
		'refactor-worker-probe-before'
	);

	const retained = await page.evaluate(() =>
		(window as any).twinePerformance.worker.probeJsHeap(
			'retain',
			8 * 1024 * 1024
		)
	);
	await recordMemoryDetailCheckpoint(page, 'refactor-worker-probe-retained');
	const whileRetained = await snapshot(page);
	const retainedCheckpoint = checkpointFor(
		whileRetained,
		'refactor-worker-probe-retained'
	);
	assertInvariant(
		'refactor-worker-metric-only-probe-does-not-erase-read-model-diagnostic',
		JSON.stringify(whileRetained.renderer.core.hosts[0]?.client?.readModel) ===
			JSON.stringify(diagnosticReadModel),
		JSON.stringify({
			afterMetricOnlyProbe:
				whileRetained.renderer.core.hosts[0]?.client?.readModel,
			diagnosticReadModel
		})
	);
	const beforeOwnedMiB = refactorOwnedMiB(
		before,
		'refactor-worker-probe-before'
	);
	const retainedOwnedMiB = refactorOwnedMiB(
		whileRetained,
		'refactor-worker-probe-retained'
	);

	assertInvariant(
		'refactor-worker-js-probe-retained-owner',
		retained?.retained === true && retained.allocatedBytes >= 8 * 1024 * 1024,
		JSON.stringify(retained)
	);
	assertInvariant(
		'refactor-worker-cdp-probe-conservative-increase',
		typeof beforeCheckpoint?.renderer.workerHeapCdpUsedBytes === 'number' &&
			typeof retainedCheckpoint?.renderer.workerHeapCdpUsedBytes === 'number' &&
			retainedCheckpoint.renderer.workerHeapCdpUsedBytes >=
				beforeCheckpoint.renderer.workerHeapCdpUsedBytes + 1024 * 1024,
		JSON.stringify({beforeCheckpoint, retainedCheckpoint})
	);
	assertInvariant(
		'refactor-worker-js-probe-wasm-unchanged',
		retainedCheckpoint?.renderer.workerWasmMemoryBytes ===
			beforeCheckpoint?.renderer.workerWasmMemoryBytes,
		JSON.stringify({beforeCheckpoint, retainedCheckpoint})
	);
	assertInvariant(
		'refactor-worker-js-probe-composite-increase',
		typeof beforeOwnedMiB === 'number' &&
			typeof retainedOwnedMiB === 'number' &&
			retainedOwnedMiB > beforeOwnedMiB,
		JSON.stringify({beforeOwnedMiB, retainedOwnedMiB})
	);

	const released = await page.evaluate(() =>
		(window as any).twinePerformance.worker.probeJsHeap('release')
	);

	assertInvariant(
		'refactor-worker-js-probe-owner-cleared',
		released?.retained === false && released.allocatedBytes === 0,
		JSON.stringify(released)
	);
	await page.evaluate(
		targetStoryId =>
			(window as any).twinePerformance.worker.diagnostics(targetStoryId),
		storyId
	);
	const afterRelease = await snapshot(page);
	const afterReleaseStore = refactorStoreSnapshot(afterRelease);
	assertInvariant(
		'refactor-worker-probe-release-has-explicit-empty-store',
		afterReleaseStore?.refactorPlanStoreEntryCount === 0 &&
			afterReleaseStore.refactorPlanStoreBytes === 0,
		JSON.stringify(afterReleaseStore)
	);
}

async function measureRefactor(
	page: Page,
	target: RefactorFixtureTarget,
	m3QueryTarget: M3QueryFixtureTarget
) {
	const checkpoints: PerformanceSnapshot[] = [];
	const warmups = 3;
	const measured = 20;
	const refactorBridgeKinds = new Set<string>();
	const refactorBridgeKindsWithRustTiming = new Set<string>();
	let refactorReplaceProjectObserved = false;
	let typingCompositorSettles: RefactorTypingCompositorSettle[] = [];
	const captureRefactorBridgeOperation = (metric: any) => {
		refactorBridgeKinds.add(metric.kind);
		if (
			metric.rustStartedAtEpochMs !== undefined &&
			metric.rustFinishedAtEpochMs !== undefined
		) {
			refactorBridgeKindsWithRustTiming.add(metric.kind);
		}
		refactorReplaceProjectObserved ||= metric.kind === 'replaceProject';
	};
	const captureRefactorBridgeOperations = (current: PerformanceSnapshot) => {
		for (const metric of current.renderer.bridgeMetrics) {
			captureRefactorBridgeOperation(metric);
		}
	};
	await startEditLongTaskObservation(page);
	try {
		await measureM3Queries(page, m3QueryTarget);
		captureRefactorBridgeOperations(await snapshot(page));
		// This retained-worker probe is a structural measurement-integrity check,
		// not a refactor sample. It runs before the baseline so its deliberately
		// retained allocation cannot contribute to the 64/128 MiB budget.
		await verifyWorkerJsMemoryProbe(page, target.storyId);
		await recordMemoryDetailCheckpoint(page, 'refactor-baseline');
		const baseline = await snapshot(page);
		checkpoints.push(baseline);
		const typingBaselineStore = refactorStoreSnapshot(baseline);
		assertInvariant(
			'refactor-typing-baseline-has-no-completed-plan',
			typingBaselineStore?.refactorPlanStoreEntryCount === 0 &&
				typingBaselineStore.refactorPlanStoreBytes === 0,
			JSON.stringify(typingBaselineStore)
		);
		const typingInitialHighWaterSampleCount =
			baseline.main.memoryCheckpoints.find(
				checkpoint => checkpoint.name === 'refactor-plan-high-water'
			)?.sampleCount ?? 0;
		// Keep the responsiveness measurement isolated from later plan/detail,
		// selection, review-owner, and forced-GC workloads. Each window holds its
		// first native planning chunk pending until its exact edit paint completes.
		typingCompositorSettles = await measureRefactorTyping(
			page,
			target,
			baseline,
			typingInitialHighWaterSampleCount
		);
		const postTyping = await snapshot(page);
		checkpoints.push(postTyping);
		recordRefactorMemoryObservation(baseline, postTyping);
		const typingStoreAfterCancellation = refactorStoreSnapshot(postTyping);
		assertInvariant(
			'refactor-typing-cancellations-create-no-completed-plan',
			JSON.stringify(typingStoreAfterCancellation) ===
				JSON.stringify(typingBaselineStore),
			JSON.stringify({typingBaselineStore, typingStoreAfterCancellation})
		);
		const summaries: any[] = [];
		let maxStoreEntries = 0;
		let maxStoreBytes = 0;

		for (let index = 0; index < warmups + measured; index++) {
			const windowStart = await page.evaluate(() => performance.now());
			const beforePlan = await snapshot(page);
			const pendingSamplesBeforePlan =
				beforePlan.main.memoryCheckpoints.find(
					checkpoint => checkpoint.name === 'refactor-plan-high-water'
				)?.sampleCount ?? 0;
			const localPendingObservationsBeforePlan =
				beforePlan.renderer.refactorPendingChunkObservations.local;
			const nativePendingObservationsBeforePlan =
				beforePlan.renderer.refactorPendingChunkObservations.native;
			const planning = await planRefactor(page, target);
			const longTasks = await mutationWindowLongTasks(page, {
				duration: planning.durationMs,
				startTime: windowStart
			});
			addSample(
				'refactor.longTaskMs',
				Math.max(0, ...longTasks.map(task => task.duration))
			);
			assertInvariant(
				`refactor-summary-${index}-completed`,
				planning.result.type === 'complete',
				JSON.stringify(planning.result)
			);
			assertInvariant(
				`refactor-summary-${index}-dto-limit`,
				planning.serializedBytes <= 64 * 1024,
				`${planning.serializedBytes} bytes`
			);
			for (const task of longTasks) {
				addSample('refactor.longTaskMs', task.duration);
				assertInvariant(
					`refactor-summary-${index}-long-task-limit`,
					task.duration <= 50,
					`${task.duration.toFixed(2)}ms`
				);
			}
			if (planning.result.type !== 'complete') continue;
			summaries.push(planning.result.summary);
			assertInvariant(
				`refactor-summary-${index}-ttl-limit`,
				planning.result.summary.expiresAtEpochMs > Date.now() &&
					planning.result.summary.expiresAtEpochMs <=
						Date.now() + 10 * 60 * 1000 + 5_000,
				String(planning.result.summary.expiresAtEpochMs)
			);
			const current = await snapshot(page);
			captureRefactorBridgeOperations(current);
			const pendingCheckpoint = current.main.memoryCheckpoints.find(
				checkpoint => checkpoint.name === 'refactor-plan-high-water'
			);
			assertInvariant(
				`refactor-summary-${index}-all-pending-chunks-locally-observed`,
				current.renderer.refactorPendingChunkObservations.local -
					localPendingObservationsBeforePlan ===
					planning.pendingCount,
				JSON.stringify({
					local: current.renderer.refactorPendingChunkObservations.local,
					before: localPendingObservationsBeforePlan,
					pending: planning.pendingCount
				})
			);
			assertInvariant(
				`refactor-summary-${index}-renderer-high-water-checkpoints`,
				current.renderer.refactorPendingChunkObservations.native -
					nativePendingObservationsBeforePlan ===
					(planning.pendingCount === 0 ? 0 : 2) &&
					(pendingCheckpoint?.sampleCount ?? pendingSamplesBeforePlan) -
						pendingSamplesBeforePlan ===
						(planning.pendingCount === 0 ? 0 : 2),
				JSON.stringify({
					native: current.renderer.refactorPendingChunkObservations.native,
					nativeBefore: nativePendingObservationsBeforePlan,
					checkpointSamples: pendingCheckpoint?.sampleCount,
					checkpointSamplesBefore: pendingSamplesBeforePlan,
					pending: planning.pendingCount
				})
			);
			if (pendingCheckpoint) {
				recordRefactorCheckpointMemoryObservation(baseline, pendingCheckpoint);
			}
			const store = refactorStoreSnapshot(current);
			maxStoreEntries = Math.max(
				maxStoreEntries,
				store?.refactorPlanStoreEntryCount ?? 0
			);
			maxStoreBytes = Math.max(
				maxStoreBytes,
				store?.refactorPlanStoreBytes ?? 0
			);
			if (index >= warmups) {
				addSample('refactor.summaryGenerationMs', planning.durationMs);
				addSample('refactor.summaryBytes', planning.serializedBytes);
			}
		}

		assertInvariant(
			'refactor-summary-samples-complete',
			summaries.length === 23
		);
		assertInvariant(
			'refactor-worker-mode-active',
			(await snapshot(page)).renderer.core.hosts[0]?.mode === 'wasm-worker'
		);
		assertInvariant(
			'refactor-plan-store-entry-limit',
			maxStoreEntries <= 8,
			String(maxStoreEntries)
		);
		addSample('refactor.planStoreMiB', maxStoreBytes / (1024 * 1024));
		assertInvariant(
			'refactor-plan-store-bytes-observable',
			Number.isFinite(maxStoreBytes),
			String(maxStoreBytes)
		);
		await recordMemoryDetailCheckpoint(page, 'refactor-post-plan');
		const postPlan = await snapshot(page);
		checkpoints.push(postPlan);
		recordRefactorMemoryObservation(baseline, postPlan);
		const stalePlanning = await planRefactor(page, target);
		assertInvariant(
			'refactor-stale-plan-created-fresh',
			stalePlanning.result.type === 'complete',
			JSON.stringify(stalePlanning.result)
		);
		const staleSummary =
			stalePlanning.result.type === 'complete'
				? stalePlanning.result.summary
				: undefined;
		const staleEdit = await applyRefactorUnrelatedEditorMutation(
			page,
			'refactor-stale-plan-edit'
		);
		// The edit is expected to persist; drain it before attributing any later
		// mutation/persistence event to the stale apply attempt.
		await waitForPersistenceIdle(page);
		const staleApply = await page.evaluate(
			async ({storyId, summary}) => {
				const startedAt = performance.now();
				const result = await (window as any).twinePerformance.refactor.apply(
					storyId,
					{
						expectedProjectRevision: summary.projectRevision,
						planId: summary.planId,
						selection: {type: 'all'}
					}
				);
				return {result, startedAt};
			},
			{storyId: target.storyId, summary: staleSummary}
		);
		const staleAfterApply = await snapshot(page);
		captureRefactorBridgeOperations(staleAfterApply);
		assertInvariant(
			'refactor-stale-plan-rejected-after-real-edit',
			staleApply.result.type === 'failure' &&
				staleApply.result.failure.code === 'stale-project-revision',
			JSON.stringify(staleApply)
		);
		assertInvariant(
			'refactor-stale-plan-does-not-mutate-or-persist',
			(staleAfterApply.renderer.core.hosts[0]?.sessions[0]?.revision ?? 0) ===
				staleEdit.revision &&
				!staleAfterApply.renderer.events.some(
					event =>
						event.time >= staleApply.startedAt &&
						(event.name === 'mutation-applied' ||
							event.name === 'persistence-save-queued')
				)
		);
		const staleUndo = page.getByRole('button', {name: /^Undo/});
		await expect(staleUndo).toBeEnabled();
		await staleUndo.click();
		const staleUndoRevision = await waitForRevisionAfter(
			page,
			staleEdit.revision
		);
		await waitForRevisionEvent(page, ['undo-applied'], staleUndoRevision);

		// Establish the retained-frontend baseline before the fresh plan captures
		// its product-owned summary/page DTOs. The helper is renderer-local, so no
		// main-process snapshot can be retained by the value being measured.
		await page.evaluate(storyId => {
			(window as any).twinePerformance.review.closeReview(storyId);
		}, target.storyId);
		const reviewHeapBeforeOwnership = await page.evaluate(() =>
			(window as any).twinePerformance.rendererHeapAfterGarbageCollection()
		);

		const detailPlanning = await planRefactor(page, target);
		assertInvariant(
			'refactor-detail-plan-created-fresh',
			detailPlanning.result.type === 'complete',
			JSON.stringify(detailPlanning.result)
		);
		const detailSummary =
			detailPlanning.result.type === 'complete'
				? detailPlanning.result.summary
				: undefined;
		let reviewOwnerCursor = detailSummary?.firstDetailCursor;

		for (let index = 0; detailSummary && index < warmups + measured; index++) {
			const detail = await page.evaluate(
				async ({cursor, storyId}) => {
					const startedAt = performance.now();
					const result = await (window as any).twinePerformance.refactor.detail(
						storyId,
						cursor
					);
					return {
						durationMs: performance.now() - startedAt,
						result,
						serializedBytes: new TextEncoder().encode(JSON.stringify(result))
							.byteLength
					};
				},
				{cursor: detailSummary.firstDetailCursor, storyId: target.storyId}
			);
			assertInvariant(
				`refactor-detail-${index}-page`,
				detail.result.type === 'page'
			);
			if (detail.result.type === 'page') {
				assertInvariant(
					`refactor-detail-${index}-change-limit`,
					detail.result.page.changes.length <= 200,
					String(detail.result.page.changes.length)
				);
			}
			assertInvariant(
				`refactor-detail-${index}-byte-limit`,
				detail.serializedBytes <= 256 * 1024,
				`${detail.serializedBytes} bytes`
			);
			if (index >= warmups) {
				addSample('refactor.detailPageMs', detail.durationMs);
				addSample('refactor.detailPageBytes', detail.serializedBytes);
			}
			if (index === 0) captureRefactorBridgeOperations(await snapshot(page));
		}
		const selectionPlanning = await planRefactor(page, target);
		if (selectionPlanning.result.type === 'complete') {
			const selectionSummary = selectionPlanning.result.summary;
			reviewOwnerCursor = selectionSummary.firstDetailCursor;
			const revisionBeforeSelection = await currentRevision(page);
			const selectionFailures = await page.evaluate(
				async ({storyId, summary}) => {
					const harness = (window as any).twinePerformance;
					const invalid = await harness.refactor.apply(storyId, {
						expectedProjectRevision: summary.projectRevision,
						planId: summary.planId,
						selection: {type: 'only', changeIds: ['unknown-change']}
					});
					const over = await harness.refactor.apply(storyId, {
						expectedProjectRevision: summary.projectRevision,
						planId: summary.planId,
						selection: {
							type: 'allExcept',
							changeIds: Array.from(
								{length: 50_001},
								(_, index) => `selection-${index}`
							)
						}
					});
					const byteOver = await harness.refactor.apply(storyId, {
						expectedProjectRevision: summary.projectRevision,
						planId: summary.planId,
						selection: {
							type: 'only',
							changeIds: Array.from(
								{length: 49_999},
								(_, index) => `${index}-${'x'.repeat(96)}`
							)
						}
					});
					return {byteOver, invalid, over};
				},
				{storyId: target.storyId, summary: selectionSummary}
			);
			assertInvariant(
				'refactor-live-invalid-compact-selection-rejected',
				selectionFailures.invalid.type === 'failure' &&
					selectionFailures.invalid.failure.code === 'invalid-selection',
				JSON.stringify(selectionFailures.invalid)
			);
			assertInvariant(
				'refactor-live-over-limit-compact-selection-rejected',
				selectionFailures.over.type === 'failure' &&
					selectionFailures.over.failure.code === 'selection-too-large',
				JSON.stringify(selectionFailures.over)
			);
			assertInvariant(
				'refactor-live-over-byte-limit-compact-selection-rejected',
				selectionFailures.byteOver.type === 'failure' &&
					selectionFailures.byteOver.failure.code === 'selection-too-large',
				JSON.stringify(selectionFailures.byteOver)
			);
			assertInvariant(
				'refactor-live-selection-failures-do-not-mutate',
				(await currentRevision(page)) === revisionBeforeSelection
			);
		}
		assertInvariant(
			'refactor-detail-samples-complete',
			(samples['refactor.detailPageMs']?.length ?? 0) === measured,
			String(samples['refactor.detailPageMs']?.length ?? 0)
		);

		const beforeCancellationSnapshot = await snapshot(page);
		const beforeCancellation = refactorStoreSnapshot(
			beforeCancellationSnapshot
		);
		const beforeCancellationTask = refactorPlanningTaskSnapshot(
			beforeCancellationSnapshot
		);
		const cancelled = await planRefactor(page, target, {
			cancelOnFirstPending: true
		});
		const afterCancellationSnapshot = await snapshot(page);
		const afterCancellation = refactorStoreSnapshot(afterCancellationSnapshot);
		const afterCancellationTask = refactorPlanningTaskSnapshot(
			afterCancellationSnapshot
		);
		captureRefactorBridgeOperations(await snapshot(page));
		assertInvariant(
			'refactor-cancellation-observed-pending',
			cancelled.pendingCount > 0
		);
		assertInvariant(
			'refactor-cancellation-result',
			cancelled.result.type === 'cancelled'
		);
		assertInvariant(
			'refactor-cancellation-creates-no-plan',
			JSON.stringify(beforeCancellation) === JSON.stringify(afterCancellation),
			JSON.stringify({afterCancellation, beforeCancellation})
		);
		assertInvariant(
			'refactor-cancellation-releases-rust-planning-task',
			beforeCancellationTask?.refactorPlanningTaskCount === 0 &&
				beforeCancellationTask.refactorPlanningTaskBytes === 0 &&
				afterCancellationTask?.refactorPlanningTaskCount === 0 &&
				afterCancellationTask.refactorPlanningTaskBytes === 0,
			JSON.stringify({afterCancellationTask, beforeCancellationTask})
		);
		assertInvariant(
			'refactor-operation-is-project-replace',
			summaries.length === warmups + measured &&
				summaries.every(summary => summary.operationKind === 'project-replace'),
			JSON.stringify(summaries.map(summary => summary.operationKind))
		);
		assertInvariant(
			'refactor-phase-avoids-replace-project',
			!refactorReplaceProjectObserved
		);
		assertInvariant(
			'refactor-one-worker-client-session',
			(await snapshot(page)).renderer.core.workerClients === 1 &&
				(await snapshot(page)).renderer.core.activeSessions === 1
		);
		const reviewOwnerDetail = reviewOwnerCursor
			? await page.evaluate(
					async ({cursor, storyId}) =>
						(window as any).twinePerformance.refactor.detail(storyId, cursor),
					{cursor: reviewOwnerCursor, storyId: target.storyId}
				)
			: undefined;
		assertInvariant(
			'refactor-review-owner-page-matches-current-summary',
			reviewOwnerDetail?.type === 'page',
			JSON.stringify(reviewOwnerDetail)
		);

		await recordMemoryDetailCheckpoint(page, 'refactor-post-detail');
		const postDetail = await snapshot(page);
		checkpoints.push(postDetail);
		recordRefactorMemoryObservation(baseline, postDetail);
		const reviewBeforeClose = await page.evaluate(
			storyId => (window as any).twinePerformance.review.snapshot(storyId),
			target.storyId
		);
		assertInvariant(
			'refactor-review-owner-captures-bounded-dtos',
			reviewBeforeClose.summaryCount === 1 &&
				reviewBeforeClose.pageCount === 1 &&
				reviewBeforeClose.encodedBytes > 0,
			JSON.stringify(reviewBeforeClose)
		);
		await page.evaluate(
			storyId => (window as any).twinePerformance.review.closeReview(storyId),
			target.storyId
		);
		const reviewHeapAfterClose = await page.evaluate(() =>
			(window as any).twinePerformance.rendererHeapAfterGarbageCollection()
		);
		const retainedFrontendMiB = Math.max(
			0,
			(reviewHeapAfterClose.usedJSHeapSize -
				reviewHeapBeforeOwnership.usedJSHeapSize) /
				1024 /
				1024
		);
		assertInvariant(
			'refactor-retained-frontend-renderer-heap-observed',
			Number.isFinite(reviewHeapBeforeOwnership.usedJSHeapSize) &&
				Number.isFinite(reviewHeapAfterClose.usedJSHeapSize),
			JSON.stringify({
				afterClose: reviewHeapAfterClose,
				beforeOwnership: reviewHeapBeforeOwnership
			})
		);
		await recordMemoryDetailCheckpoint(
			page,
			'refactor-post-close-forced-gc',
			true
		);
		const reviewAfterClose = await page.evaluate(
			storyId => (window as any).twinePerformance.review.snapshot(storyId),
			target.storyId
		);
		const retained = await snapshot(page);
		checkpoints.push(retained);
		addSample('refactor.retainedFrontendMiB', retainedFrontendMiB);
		assertInvariant(
			'refactor-review-owner-released-before-gc',
			reviewAfterClose.encodedBytes === 0 &&
				reviewAfterClose.pageCount === 0 &&
				reviewAfterClose.summaryCount === 0 &&
				retained.renderer.owners?.refactorReview?.ownerCount === 0,
			JSON.stringify({
				aggregate: retained.renderer.owners?.refactorReview,
				heap: {
					afterClose: reviewHeapAfterClose,
					beforeOwnership: reviewHeapBeforeOwnership
				},
				reviewAfterClose
			})
		);
		assertInvariant(
			'refactor-review-close-keeps-editor-ownership-stable',
			retained.renderer.owners?.activeEditorCount ===
				postDetail.renderer.owners?.activeEditorCount &&
				retained.renderer.owners?.editorDocumentBytes ===
					postDetail.renderer.owners?.editorDocumentBytes,
			JSON.stringify({
				after: retained.renderer.owners,
				before: postDetail.renderer.owners
			})
		);
		recordRefactorMemoryObservation(baseline, retained);
		captureMemory(retained, 'refactor.memory.postClose');
		assertInvariant(
			'refactor-bridge-operations-observed',
			[
				'syncRefactorRuntime',
				'beginProjectReplacePlan',
				'continueProjectReplacePlan',
				'queryRefactorPlanDetail',
				'applyRefactorPlan',
				'cancelProjectReplacePlan'
			].every(kind => refactorBridgeKinds.has(kind)),
			JSON.stringify([...refactorBridgeKinds])
		);
		assertInvariant(
			'refactor-wasm-call-timing-observed',
			[
				'syncRefactorRuntime',
				'beginProjectReplacePlan',
				'continueProjectReplacePlan',
				'queryRefactorPlanDetail',
				'applyRefactorPlan',
				'cancelProjectReplacePlan'
			].every(kind => refactorBridgeKindsWithRustTiming.has(kind)),
			JSON.stringify([...refactorBridgeKindsWithRustTiming])
		);
		assertInvariant(
			'refactor-summary-measured-samples-complete',
			(samples['refactor.summaryGenerationMs']?.length ?? 0) === measured,
			String(samples['refactor.summaryGenerationMs']?.length ?? 0)
		);
		assertInvariant(
			'refactor-typing-measured-samples-complete',
			(samples['refactor.editPaintMs']?.length ?? 0) === measured,
			String(samples['refactor.editPaintMs']?.length ?? 0)
		);
		assertInvariant(
			'refactor-typing-stage-samples-complete',
			[
				'refactor.editWorkerMs',
				'refactor.editPatchDispatchMs',
				'refactor.editFrameWaitMs'
			].every(name => (samples[name]?.length ?? 0) === measured),
			JSON.stringify({
				frameWait: samples['refactor.editFrameWaitMs']?.length ?? 0,
				patchDispatch: samples['refactor.editPatchDispatchMs']?.length ?? 0,
				worker: samples['refactor.editWorkerMs']?.length ?? 0
			})
		);
	} finally {
		await stopEditLongTaskObservation(page);
	}

	diagnostics.refactor = {
		checkpoints,
		commitSamples: 0,
		detailSamples: measured,
		m4CommitSamples: 0,
		m4DetailSamples: measured,
		m4SummarySamples: measured,
		m4TypingSamples: measured,
		m3DefinitionSamples: measured,
		m3ReferenceSamples: measured,
		operation: 'multi-operation',
		operations: refactorOperations,
		summarySamples: measured,
		typingCompositorSettles
	};
}

async function measureRefactorCommitSamples(target: RefactorFixtureTarget) {
	for (let index = 0; index < 10; index++) {
		const running = await launchFixture();
		try {
			await recordMemoryDetailCheckpoint(
				running.page,
				`refactor-commit-${index}-baseline`
			);
			const baseline = await snapshot(running.page);
			const planning = await planRefactor(running.page, target);
			assertInvariant(
				`refactor-commit-${index}-plan-complete`,
				planning.result.type === 'complete',
				JSON.stringify(planning.result)
			);
			if (planning.result.type !== 'complete') continue;
			await recordMemoryDetailCheckpoint(
				running.page,
				`refactor-commit-${index}-before-dispatch`
			);
			const preApplySnapshot = await snapshot(running.page);
			const preApplySession = preApplySnapshot.renderer.core.hosts
				.flatMap(host => host.sessions)
				.at(0);
			assertInvariant(
				`refactor-commit-${index}-target-session-observed`,
				preApplySession !== undefined,
				JSON.stringify(preApplySnapshot.renderer.core.hosts)
			);
			const preApplySessionId = preApplySession?.sessionId;
			const preApplyRevision = preApplySession?.revision ?? 0;
			await running.page.evaluate(
				({responseCheckpointName, summary, storyId}) => {
					const probe = {
						active: true,
						startedAt: performance.now(),
						promise: undefined as Promise<unknown> | undefined,
						workerResponseCheckpoint: undefined as Promise<void> | undefined
					};
					(window as any).__twineRefactorApplyProbe = probe;
					const operation = (
						window as any
					).twinePerformance.refactor.applyModelCommit(
						storyId,
						{
							expectedProjectRevision: summary.projectRevision,
							planId: summary.planId,
							selection: {type: 'all'}
						},
						responseCheckpointName
					);
					probe.workerResponseCheckpoint = operation.workerResponseCheckpoint;
					probe.promise = operation.result.finally(() => {
						probe.active = false;
					});
				},
				{
					responseCheckpointName: `refactor-commit-${index}-worker-response`,
					storyId: target.storyId,
					summary: planning.result.summary
				}
			);
			const applyInFlight = await running.page.evaluate(
				() => (window as any).__twineRefactorApplyProbe?.active === true
			);
			assertInvariant(`refactor-commit-${index}-in-flight`, applyInFlight);
			const commit = await running.page.evaluate(async () => {
				const probe = (window as any).__twineRefactorApplyProbe;
				const result = await probe.promise;
				return {
					durationMs: performance.now() - probe.startedAt,
					result:
						result.type === 'applied'
							? {
									patchCount: result.batch.patches.length,
									textEditCount: result.receipt.textEdits.length,
									type: result.type
								}
							: {failure: result.failure, type: result.type}
				};
			});
			assertInvariant(
				`refactor-commit-${index}-applied`,
				commit.result.type === 'applied' &&
					commit.result.patchCount === passageCount + 1 &&
					commit.result.textEditCount === passageCount,
				JSON.stringify(commit.result)
			);
			addSample('refactor.atomicCommitMs', commit.durationMs);
			await running.page.evaluate(async () => {
				const probe = (window as any).__twineRefactorApplyProbe;
				await probe.workerResponseCheckpoint;
			});
			const workerResponse = await snapshot(running.page);
			const workerResponseCheckpoint = checkpointFor(
				workerResponse,
				`refactor-commit-${index}-worker-response`
			);
			const workerResponseMetric = workerResponse.renderer.bridgeMetrics
				.filter(
					metric =>
						metric.kind === 'applyRefactorPlan' &&
						metric.workerRespondedAtEpochMs ===
							workerResponseCheckpoint?.renderer.workerResponseAtEpochMs
				)
				.at(-1);
			const committedRevision = workerResponse.renderer.core.hosts
				.flatMap(host => host.sessions)
				.find(session => session.sessionId === preApplySessionId)?.revision;
			const refactorStages = workerResponseMetric?.mutationStages;
			const refactorStageValues = refactorStages
				? [
						refactorStages.totalMs,
						refactorStages.lookupAndDeltaMs,
						refactorStages.projectMutationMs,
						refactorStages.fingerprintMs,
						refactorStages.graphMs,
						refactorStages.analysisMs,
						refactorStages.readModelMs,
						refactorStages.historyMs,
						refactorStages.patchFinalizeMs,
						refactorStages.savepointMs
					]
				: [];
			const refactorStageSum = refactorStages
				? refactorStages.lookupAndDeltaMs +
					refactorStages.projectMutationMs +
					refactorStages.fingerprintMs +
					refactorStages.graphMs +
					refactorStages.analysisMs +
					refactorStages.readModelMs +
					refactorStages.historyMs +
					refactorStages.patchFinalizeMs +
					refactorStages.savepointMs
				: undefined;
			assertInvariant(
				`refactor-commit-${index}-worker-response-checkpoint`,
				workerResponseCheckpoint?.sampleCount === 1 &&
					workerResponseMetric?.workerRespondedAtEpochMs !== undefined &&
					workerResponseMetric.wasmMemoryBytes !== undefined &&
					workerResponseCheckpoint.renderer.workerResponseAtEpochMs ===
						workerResponseMetric.workerRespondedAtEpochMs &&
					workerResponseCheckpoint.renderer.workerWasmMemoryBytes ===
						workerResponseMetric.wasmMemoryBytes &&
					typeof workerResponseCheckpoint.renderer.workerHeapCdpUsedBytes ===
						'number' &&
					typeof workerResponseCheckpoint.renderer
						.workerHeapCdpSampledAtEpochMs === 'number' &&
					typeof workerResponseCheckpoint.renderer.workerHeapCdpTargetId ===
						'string' &&
					typeof workerResponseCheckpoint.renderer
						.workerHeapCdpResponseDriftMs === 'number' &&
					workerResponseCheckpoint.renderer.workerHeapCdpResponseDriftMs <=
						5_000 &&
					refactorStages?.operation === 'refactorPlan' &&
					refactorStages.deltaId === planning.result.summary.planId &&
					refactorStages.revision === committedRevision &&
					refactorStageValues.every(
						value => Number.isFinite(value) && value >= 0
					) &&
					refactorStageSum !== undefined &&
					refactorStageSum <= refactorStages.totalMs + 0.25,
				JSON.stringify({
					workerResponseCheckpoint: workerResponseCheckpoint
						? {
								sampleCount: workerResponseCheckpoint.sampleCount,
								workerHeapCdpResponseDriftMs:
									workerResponseCheckpoint.renderer
										.workerHeapCdpResponseDriftMs,
								workerResponseAtEpochMs:
									workerResponseCheckpoint.renderer.workerResponseAtEpochMs,
								workerWasmMemoryBytes:
									workerResponseCheckpoint.renderer.workerWasmMemoryBytes
							}
						: undefined,
					workerResponseMetric
				})
			);
			assertInvariant(
				`refactor-commit-${index}-target-session-revision-advanced`,
				committedRevision !== undefined && committedRevision > preApplyRevision,
				JSON.stringify({
					committedRevision,
					preApplyRevision,
					preApplySessionId
				})
			);
			recordRefactorMemoryObservation(baseline, workerResponse);
			// The response-bound checkpoint is the authoritative worker/CDP tuple.
			// A second native checkpoint here would begin only after large renderer
			// reconciliation and therefore pair CDP with a stale worker response.
			const postCommit = await snapshot(running.page);
			const sampleEvents = postCommit.renderer.events.slice(
				baseline.renderer.events.length
			);
			const modelCommitPatches = sampleEvents.filter(
				event =>
					event.name === 'renderer-patch-stages' &&
					event.detail?.revision === committedRevision
			);
			assertInvariant(
				`refactor-commit-${index}-one-renderer-patch`,
				modelCommitPatches.length === 1,
				JSON.stringify(modelCommitPatches)
			);
			const persistenceEvents = new Set([
				'persistence-save-queued',
				'persistence-save-started',
				'persistence-save-completed',
				'persistence-save-notified',
				'persistence-save-failed',
				'save-acknowledgement-start',
				'save-acknowledgement-complete',
				'save-acknowledgement-failed'
			]);
			assertInvariant(
				`refactor-commit-${index}-no-persistence`,
				sampleEvents.every(
					event =>
						!persistenceEvents.has(event.name) ||
						event.detail?.revision !== committedRevision
				),
				JSON.stringify(sampleEvents)
			);
			assertInvariant(
				`refactor-commit-${index}-bridge-apply-observed`,
				postCommit.renderer.bridgeMetrics.some(
					metric => metric.kind === 'applyRefactorPlan'
				)
			);
			recordRefactorMemoryObservation(baseline, postCommit);
			captureMemory(postCommit, 'refactor.memory.postCommit');
		} finally {
			await closeFixture(running);
		}
	}
	assertInvariant(
		'refactor-atomic-commit-samples-complete',
		(samples['refactor.atomicCommitMs']?.length ?? 0) === 10,
		String(samples['refactor.atomicCommitMs']?.length ?? 0)
	);
	if (diagnostics.refactor) diagnostics.refactor.commitSamples = 10;
}

async function measureM4DiagnosticFixCommitSamples(
	target: M4DiagnosticFixFixtureTarget
) {
	for (let index = 0; index < 10; index++) {
		const running = await launchFixture();
		try {
			const before = await snapshot(running.page);
			const beforeRevision = await currentRevision(running.page);
			const planning = await running.page.evaluate(async target => {
				const harness = (window as any).twinePerformance;
				return harness.refactor.planDiagnosticFixes(target.storyId, {
					selection: {excludedDiagnosticIds: [], type: target.selection},
					storyId: target.storyId
				});
			}, target);
			assertInvariant(
				`refactor-m4-all-safe-commit-${index}-plan-complete`,
				planning.type === 'complete' &&
					planning.summary.changeCount === target.expectedChangeCount,
				JSON.stringify(planning)
			);
			if (planning.type !== 'complete') continue;
			const commit = await running.page.evaluate(
				async ({index, storyId, summary}) => {
					const startedAt = performance.now();
					const operation = (
						window as any
					).twinePerformance.refactor.applyModelCommit(
						storyId,
						{
							expectedProjectRevision: summary.projectRevision,
							planId: summary.planId,
							selection: {type: 'all'}
						},
						`refactor-m4-all-safe-commit-${index}-worker-response`
					);
					const [result] = await Promise.all([
						operation.result,
						operation.workerResponseCheckpoint
					]);
					return {
						durationMs: performance.now() - startedAt,
						result:
							result.type === 'applied'
								? {
										patchCount: result.batch.patches.length,
										type: result.type
									}
								: {failure: result.failure, type: result.type}
					};
				},
				{index, storyId: target.storyId, summary: planning.summary}
			);
			const appliedRevision = await waitForRevisionAfter(
				running.page,
				beforeRevision
			);
			const afterApply = await snapshot(running.page);
			const appliedEvents = afterApply.renderer.events.slice(
				before.renderer.events.length
			);
			const persistenceEvents = new Set([
				'persistence-save-queued',
				'persistence-save-started',
				'persistence-save-completed',
				'persistence-save-notified',
				'persistence-save-failed',
				'save-acknowledgement-start',
				'save-acknowledgement-complete',
				'save-acknowledgement-failed'
			]);
			assertInvariant(
				`refactor-m4-all-safe-commit-${index}-one-atomic-model-transaction`,
				commit.result.type === 'applied' &&
					commit.result.patchCount === target.expectedChangeCount + 1 &&
					appliedRevision === beforeRevision + 1 &&
					appliedEvents.filter(
						event =>
							event.name === 'renderer-patch-stages' &&
							event.detail?.revision === appliedRevision
					).length === 1 &&
					appliedEvents.some(
						event =>
							event.name === 'renderer-patch-stages' &&
							event.detail?.revision === appliedRevision &&
							event.detail?.documentUpdates === target.expectedChangeCount &&
							event.detail?.storyActions === target.expectedChangeCount
					) &&
					appliedEvents.every(
						event =>
							!persistenceEvents.has(event.name) ||
							event.detail?.revision !== appliedRevision
					),
				JSON.stringify({
					appliedEvents,
					appliedRevision,
					beforeRevision,
					commit
				})
			);
			addSample('refactor.m4.allSafe.atomicCommitMs', commit.durationMs);
			await running.page.evaluate(
				storyId => (window as any).twinePerformance.review.closeReview(storyId),
				target.storyId
			);
			await running.page.evaluate(
				storyId =>
					(window as any).twinePerformance.refactor.undoModelCommit(storyId),
				target.storyId
			);
			const undoRevision = await waitForRevisionAfter(
				running.page,
				appliedRevision
			);
			const restored = await running.page.evaluate(async target => {
				const harness = (window as any).twinePerformance;
				return harness.refactor.planDiagnosticFixes(target.storyId, {
					selection: {excludedDiagnosticIds: [], type: target.selection},
					storyId: target.storyId
				});
			}, target);
			assertInvariant(
				`refactor-m4-all-safe-commit-${index}-undo-restores-full-batch`,
				undoRevision === appliedRevision + 1 &&
					restored.type === 'complete' &&
					restored.summary.changeCount === target.expectedChangeCount,
				JSON.stringify({appliedRevision, restored, undoRevision})
			);
		} finally {
			await closeFixture(running);
		}
	}
	assertInvariant(
		'refactor-m4-all-safe-atomic-commit-samples-complete',
		(samples['refactor.m4.allSafe.atomicCommitMs']?.length ?? 0) === 10,
		String(samples['refactor.m4.allSafe.atomicCommitMs']?.length ?? 0)
	);
	if (diagnostics.refactor) diagnostics.refactor.m4CommitSamples = 10;
}

function captureMemoryDetailCheckpoints(current: PerformanceSnapshot) {
	const checkpoints = current.main.memoryCheckpoints;
	const baseline = checkpoints.find(
		checkpoint => checkpoint.name === 'before-editor'
	);
	const baselineRoles = baseline
		? checkpointWorkingSetByRole(baseline)
		: new Map<string, number>();
	const baselineMainPrivateKiB = baseline?.mainProcessMemory?.private;
	const baselineRendererPrivateKiB = baseline?.renderer.rendererPrivateKiB;

	for (const checkpoint of checkpoints) {
		const prefix = `memoryDetail.${checkpoint.name}`;
		const workingSetKiB = [
			...Object.values(checkpoint.processWorkingSetKiBByRole)
		].reduce((total, value) => total + value, 0);

		addSample(`${prefix}.residentMiB`, workingSetKiB / 1024);
		addSample(
			`${prefix}.private.mainMiB`,
			checkpoint.mainProcessMemory?.private === undefined
				? undefined
				: checkpoint.mainProcessMemory.private / 1024
		);
		addSample(
			`${prefix}.private.rendererMiB`,
			typeof checkpoint.renderer.rendererPrivateKiB === 'number'
				? checkpoint.renderer.rendererPrivateKiB / 1024
				: undefined
		);
		addSample(
			`${prefix}.private.delta.mainMiB`,
			checkpoint.mainProcessMemory?.private === undefined ||
				baselineMainPrivateKiB === undefined
				? undefined
				: (checkpoint.mainProcessMemory.private - baselineMainPrivateKiB) / 1024
		);
		addSample(
			`${prefix}.private.delta.rendererMiB`,
			typeof checkpoint.renderer.rendererPrivateKiB !== 'number' ||
				typeof baselineRendererPrivateKiB !== 'number'
				? undefined
				: (checkpoint.renderer.rendererPrivateKiB -
						baselineRendererPrivateKiB) /
						1024
		);
		addSample(
			`${prefix}.blink.allocatedMiB`,
			typeof checkpoint.renderer.rendererBlinkAllocatedKiB === 'number'
				? checkpoint.renderer.rendererBlinkAllocatedKiB / 1024
				: undefined
		);
		for (const [role, value] of checkpointWorkingSetByRole(checkpoint)) {
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
			'retainedEditorViewCount',
			'retainedLegacyDocumentServiceCount',
			'retainedLegacyModeAdapterCount',
			'retainedLegacyToolbarDescriptorSetCount',
			'retainedLegacyToolbarFacadeCount',
			'workerCachedPayloadBytes',
			'workerPendingRequestCount',
			'workerReadModelCacheEntryCount',
			'workerSessionQueueCount',
			'workerHeapCdpUsedBytes',
			'workerHeapCdpTotalSize',
			'workerHeapCdpSampledAtEpochMs',
			'workerHeapCdpResponseDriftMs',
			'workerJsHeapUsedBytes',
			'workerResponseAtEpochMs',
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
		for (const field of [
			'heapUsed',
			'heapTotal',
			'external',
			'arrayBuffers'
		] as const) {
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
	const applied = current.renderer.events.find(
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
	const git = await currentGitProvenance(path.resolve('.'));
	const failedInvariantCount = assertions.filter(
		assertion => !assertion.passed
	).length;
	const failureKind =
		measurementBodyCompleted && testInfo.status === 'passed'
			? failedInvariantCount > 0
				? 'assertion'
				: undefined
			: 'infrastructure';
	const attempt = {
		bodyCompleted: measurementBodyCompleted,
		failedInvariantCount,
		failureKind,
		retry: testInfo.retry,
		status: testInfo.status
	};
	let attempts: Array<typeof attempt> = [];

	try {
		const previous = JSON.parse(await readFile(reportPath, 'utf8'));

		if (!Array.isArray(previous.measurement?.attempts)) {
			throw new Error('Existing phase report has no retry history.');
		}
		attempts = previous.measurement.attempts;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
			throw error;
		}
	}
	attempts.push(attempt);
	const measuredRefactorOperations = diagnostics.refactor
		? refactorOperations
		: undefined;

	await writeFile(
		reportPath,
		`${JSON.stringify(
			{
				assertions,
				configuration: {
					baselineCompatible:
						!disableHarloweEditorExtensions && !editProfileEnabled,
					edit:
						phase === 'edit'
							? (diagnostics.editConfiguration ?? {
									disableHarloweEditorExtensions,
									nativeEditorActive: null,
									profile: editProfileEnabled
								})
							: undefined,
					refactor:
						phase === 'refactor' && measuredRefactorOperations
							? {
									operation: 'multi-operation',
									operations: measuredRefactorOperations
								}
							: undefined
				},
				createdAt: new Date().toISOString(),
				diagnostics,
				diagnostic:
					phase === 'diagnostic' ||
					disableHarloweEditorExtensions ||
					editProfileEnabled,
				memoryDetail: phase === 'memory-detail',
				environment: {
					metricContracts: {
						editAttribution: 1,
						memory: 5,
						memoryAttribution: 2,
						...(phase === 'refactor'
							? {
									refactorAtomicCommit: 1,
									atomicCommitOperation:
										'model-commit-renderer-reconciliation-no-persistence',
									refactorM4DiagnosticFixes: 3,
									refactorMemory: 3,
									...(measuredRefactorOperations
										? {
												refactorOperation: 'multi-operation',
												refactorOperations: measuredRefactorOperations
											}
										: {})
								}
							: {}),
						...(footprintEnabled ? {memoryFootprint: 1} : {}),
						startup: 2
					},
					git,
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
				measurement: {
					attempts,
					bodyCompleted: measurementBodyCompleted,
					failedInvariantCount,
					failureKind
				},
				phase,
				probeOnly: refactorProbeOnly,
				sampleCount:
					phase === 'diagnostic' || phase === 'memory-detail' ? 1 : undefined,
				samples,
				schemaVersion: performanceReportSchemaVersion,
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

test.afterEach(async ({browserName}, testInfo) => {
	void browserName;
	await writeRawPerformanceReport(testInfo);
});

test(`measures the production Electron ${phase ?? 'unknown'} phase`, async () => {
	measurementBodyCompleted = false;
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
	if (
		(disableHarloweEditorExtensions || editProfileEnabled) &&
		phase !== 'edit'
	) {
		throw new Error('Focused edit controls require TWINE_PERF_PHASE=edit.');
	}
	if (editProfileEnabled && (!editTracePath || !editCpuProfilePath)) {
		throw new Error(
			'TWINE_PERF_EDIT_TRACE and TWINE_PERF_EDIT_CPU_PROFILE are required when profiling edits.'
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

	if (phase === 'refactor') {
		const fixtureManifest = JSON.parse(
			await readFile(
				path.join(path.dirname(fixturePath), `story-${passageCount}.perf.json`),
				'utf8'
			)
		) as {
			linkCounts?: {broken?: number};
			m3QueryTarget?: M3QueryFixtureTarget;
			m4DiagnosticFixTarget?: M4DiagnosticFixFixtureTarget;
			performanceFixtureMeasurementContractVersion?: number;
			refactorTarget?: RefactorFixtureTarget;
		};
		assertInvariant(
			'refactor-fixture-measurement-contract-current',
			fixtureManifest.performanceFixtureMeasurementContractVersion === 4,
			String(fixtureManifest.performanceFixtureMeasurementContractVersion)
		);
		const target = fixtureManifest.refactorTarget;
		const m3QueryTarget = fixtureManifest.m3QueryTarget;
		const m4Target = fixtureManifest.m4DiagnosticFixTarget;
		assertInvariant(
			'refactor-fixture-target-present',
			!!target &&
				target.storyId.length > 0 &&
				target.passageId.length > 0 &&
				target.beforeName !== target.afterName,
			JSON.stringify(target)
		);
		if (!target)
			throw new Error('Fixture lacks the deterministic refactor target.');
		assertInvariant(
			'refactor-fixture-m3-query-target-present',
			!!m3QueryTarget &&
				m3QueryTarget.storyId === target.storyId &&
				m3QueryTarget.passageId.length > 0 &&
				m3QueryTarget.passageName.length > 0 &&
				m3QueryTarget.definitionNames.length === 20,
			JSON.stringify(m3QueryTarget)
		);
		if (!m3QueryTarget)
			throw new Error('Fixture lacks the deterministic M3 query target.');
		assertInvariant(
			'refactor-fixture-m4-diagnostic-fix-target-present',
			!!m4Target &&
				m4Target.storyId === target.storyId &&
				m4Target.selection === 'allSafe' &&
				m4Target.expectedChangeCount === fixtureManifest.linkCounts?.broken &&
				m4Target.expectedChangeCount > 0,
			JSON.stringify(m4Target)
		);
		if (!m4Target)
			throw new Error('Fixture lacks the deterministic M4 diagnostic target.');
		const running = await launchFixture();
		try {
			if (refactorProbeOnly) {
				// A 100-passage fixture can complete the rename planner in one chunk, so
				// it cannot exercise the deliberately held pending-callback workload.
				// Keep this path probe-only: it validates the broker attribution contract
				// without presenting 100 passages as refactor throughput evidence.
				await verifyWorkerJsMemoryProbe(running.page, target.storyId);
				assertInvariant('refactor-100-worker-heap-probe-only', true);
			} else {
				await measureRefactor(running.page, target, m3QueryTarget);
			}
		} finally {
			await closeFixture(running);
		}
		if (!refactorProbeOnly) {
			// M4 owns a fresh fixture process and worker session so its baseline cannot
			// inherit project-replace plan-store or renderer ownership high water.
			const m4Running = await launchFixture();
			try {
				await measureM4DiagnosticFixes(m4Running.page, m4Target);
			} finally {
				await closeFixture(m4Running);
			}
			await measureRefactorCommitSamples(target);
			await measureM4DiagnosticFixCommitSamples(m4Target);
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
				await captureMacFootprint(startupSnapshot, startupPrefix);
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

			const liveSnapshot = await snapshot(running.page);

			captureMemory(liveSnapshot, 'memory.live');
			await recordMemoryDetailCheckpoint(
				running.page,
				'phase-final-retained',
				true
			);
			const retainedSnapshot = await snapshot(running.page);

			diagnostics.interaction = retainedSnapshot;
			captureMemory(retainedSnapshot);
			captureMemory(retainedSnapshot, 'memory.retained');
			assertInvariant(
				'final-retained-memory-checkpoint-present',
				retainedSnapshot.main.memoryCheckpoints.some(
					checkpoint => checkpoint.name === 'phase-final-retained'
				)
			);
			assertInvariant(
				'final-memory-primary-owners-present',
				(retainedSnapshot.renderer.heap.usedJSHeapSize ?? 0) > 0 &&
					(retainedSnapshot.main.memory.heapUsed ?? 0) > 0 &&
					(retainedSnapshot.renderer.core.hosts[0]?.client?.wasmMemoryBytes ??
						0) > 0
			);
			assertInvariant(
				'final-memory-native-private-present',
				(retainedSnapshot.main.processMemory?.private ?? 0) > 0 &&
					(retainedSnapshot.main.rendererNativeMemory?.processMemory.private ??
						0) > 0 &&
					(retainedSnapshot.main.rendererNativeMemory?.blinkMemory.total ?? 0) >
						0
			);
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
	measurementBodyCompleted = true;
});
