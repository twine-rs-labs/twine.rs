#!/usr/bin/env node

import {spawnSync} from 'node:child_process';
import {access, mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {treeMetadataFingerprint} from './fixture-tools.mjs';
import {mergeRawPerformanceReports, writeJson} from './performance-tools.mjs';

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..'
);
const args = process.argv.slice(2);
const sizeIndex = args.indexOf('--size');
const size = Number.parseInt(
	sizeIndex >= 0 ? args[sizeIndex + 1] : '10000',
	10
);
const smoke = args.includes('--smoke');
const phaseIndex = args.indexOf('--phase');
const requestedPhase = phaseIndex >= 0 ? args[phaseIndex + 1] : 'all';
const completePhases = ['startup', 'edit', 'query', 'graph', 'watcher'];
const validPhases = ['all', 'interaction', ...completePhases];

if (!Number.isInteger(size) || size <= 0) {
	throw new Error('--size must be a positive integer.');
}
if (!validPhases.includes(requestedPhase)) {
	throw new Error(`--phase must be one of: ${validPhases.join(', ')}.`);
}

const phases =
	requestedPhase === 'all'
		? completePhases
		: requestedPhase === 'interaction'
			? ['edit', 'query', 'graph']
			: [requestedPhase];

const fixture = path.join(
	repoRoot,
	'benchmarks',
	'fixtures',
	'generated',
	'projects',
	`story-${size}.twine.rs`
);
const report = path.join(
	repoRoot,
	'benchmarks',
	'results',
	`electron-${new Date().toISOString().replace(/[:.]/g, '-')}-${size}.json`
);
const checkpoint = report.replace(/\.json$/, '.checkpoint.json');
const main = path.join(
	repoRoot,
	'electron-build',
	'main',
	'src',
	'electron',
	'main-process',
	'index.js'
);

await access(fixture).catch(() => {
	throw new Error(
		`Missing fixture ${fixture}. Run npm run perf:prepare first.`
	);
});
await access(main).catch(() => {
	throw new Error(
		`Missing production Electron build. Run npm run perf:prepare first.`
	);
});
await mkdir(path.join(repoRoot, 'benchmarks', 'results'), {recursive: true});

const fixtureFingerprintBefore = await treeMetadataFingerprint(fixture);
const runRoot = await mkdtemp(path.join(os.tmpdir(), 'twine-rs-perf-run-'));
const runId = path.basename(runRoot);
const launchTrace = path.join(runRoot, 'launch-trace.jsonl');
const phaseResults = {};
const rawReports = [];
let runStatus = 0;
let merged;
let runRootRemoved = false;
let sourceFixtureUnchanged = false;
let isolatedUserData = false;
const checkpointState = {
	createdAt: new Date().toISOString(),
	currentPhase: undefined,
	launches: [],
	phases: phaseResults,
	requestedPhases: phases,
	runId,
	schemaVersion: 1,
	size,
	status: 'running',
	updatedAt: new Date().toISOString()
};

async function updateCheckpoint() {
	checkpointState.updatedAt = new Date().toISOString();
	await writeJson(checkpoint, checkpointState);
}

async function readLaunchTrace() {
	try {
		return (await readFile(launchTrace, 'utf8'))
			.split('\n')
			.filter(Boolean)
			.map(line => JSON.parse(line));
	} catch (error) {
		if (error.code === 'ENOENT') {
			return [];
		}
		throw error;
	}
}

async function settleLaunchServices() {
	if (process.platform !== 'darwin') {
		return;
	}

	const delayMs = Number.parseInt(
		process.env.TWINE_PERF_SETTLE_MS ?? '3500',
		10
	);

	if (Number.isFinite(delayMs) && delayMs > 0) {
		await new Promise(resolve => setTimeout(resolve, delayMs));
	}
}

function captureRelevantProcesses() {
	if (process.platform === 'win32') {
		return undefined;
	}

	const result = spawnSync(
		'ps',
		['-ax', '-o', 'pid,ppid,pgid,stat,etime,pcpu,command'],
		{encoding: 'utf8'}
	);

	return {
		error: result.error?.message,
		exitCode: result.status,
		lines: (result.stdout ?? '')
			.split('\n')
			.filter(line =>
				/Electron|twine-rs|playwright|electron-performance/.test(line)
			),
		stderr: result.stderr?.trim() || undefined
	};
}

await updateCheckpoint();

try {
	for (const phase of phases) {
		const partialReport = path.join(runRoot, `${phase}.json`);
		const startedAt = new Date().toISOString();

		checkpointState.currentPhase = phase;
		phaseResults[phase] = {startedAt, status: 'running'};
		await updateCheckpoint();

		const result = spawnSync(
			process.platform === 'win32' ? 'npx.cmd' : 'npx',
			['playwright', 'test', '--config', 'playwright.electron.config.ts'],
			{
				cwd: repoRoot,
				encoding: 'utf8',
				env: {
					...process.env,
					TWINE_PERF_FIXTURE: fixture,
					TWINE_PERF_LAUNCH_TRACE: launchTrace,
					TWINE_PERF_PHASE: phase,
					TWINE_PERF_REPORT: partialReport,
					TWINE_PERF_RUN_ID: runId,
					TWINE_PERF_RUN_ROOT: runRoot,
					TWINE_PERF_SMOKE: smoke ? '1' : '0',
					TWINE_PERF_SIZE: String(size)
				},
				stdio: 'inherit'
			}
		);
		const exitCode = result.status ?? 1;

		phaseResults[phase] = {
			error: result.error?.message,
			exitCode,
			finishedAt: new Date().toISOString(),
			processes: exitCode === 0 ? undefined : captureRelevantProcesses(),
			startedAt,
			status: exitCode === 0 ? 'passed' : 'failed'
		};
		checkpointState.launches = await readLaunchTrace();

		try {
			rawReports.push(JSON.parse(await readFile(partialReport, 'utf8')));
		} catch (error) {
			if (error.code !== 'ENOENT') {
				throw error;
			}
		}

		await updateCheckpoint();
		await settleLaunchServices();

		if (exitCode !== 0) {
			runStatus = exitCode;
			break;
		}
	}

	merged = mergeRawPerformanceReports(rawReports, phaseResults);

	checkpointState.currentPhase = undefined;
	checkpointState.status = runStatus === 0 ? 'completed' : 'failed';
	await updateCheckpoint();
} finally {
	const launches = await readLaunchTrace();

	checkpointState.launches = launches;
	await rm(runRoot, {force: true, recursive: true});
	runRootRemoved = await access(runRoot).then(
		() => false,
		error => error.code === 'ENOENT'
	);
	sourceFixtureUnchanged =
		(await treeMetadataFingerprint(fixture)) === fixtureFingerprintBefore;
	const launchRequests = launches.filter(
		entry => entry.source === 'playwright' && entry.stage === 'launch-requested'
	);

	isolatedUserData =
		launchRequests.length > 0 &&
		launchRequests.every(entry => {
			if (typeof entry.userData !== 'string') {
				return false;
			}
			const relativePath = path.relative(runRoot, entry.userData);

			return (
				relativePath !== '' &&
				!relativePath.startsWith('..') &&
				!path.isAbsolute(relativePath)
			);
		});
	checkpointState.cleanup = {
		isolatedUserData,
		runRootRemoved,
		sourceFixtureUnchanged
	};
	await settleLaunchServices();
}

if (merged) {
	merged.assertions.push(
		{
			name: 'source-fixture-tree-unchanged',
			passed: sourceFixtureUnchanged
		},
		{name: 'temporary-run-root-removed', passed: runRootRemoved},
		{name: 'user-data-paths-isolated', passed: isolatedUserData}
	);
	await writeJson(report, merged);
	checkpointState.report = report;
}

let reportStatus = 0;

try {
	await access(report);
	const reportResult = spawnSync(
		process.execPath,
		[
			path.join(repoRoot, 'benchmarks', 'report-performance.mjs'),
			'--input',
			path.relative(repoRoot, report)
		],
		{cwd: repoRoot, encoding: 'utf8', stdio: 'inherit'}
	);

	reportStatus = reportResult.status ?? 1;
} catch (error) {
	if (error.code !== 'ENOENT') {
		throw error;
	}
}

checkpointState.evaluationExitCode = reportStatus;
checkpointState.status =
	runStatus === 0 && reportStatus === 0 ? 'completed' : 'failed';
await updateCheckpoint();

process.exitCode = runStatus !== 0 ? runStatus : reportStatus;
