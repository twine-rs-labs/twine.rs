#!/usr/bin/env node

import {spawnSync} from 'node:child_process';
import {
	access,
	cp,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	stat,
	writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
	parseFixtureVariant,
	performanceFixtureVariantRoot,
	treeMetadataFingerprint
} from './fixture-tools.mjs';
import {
	currentGitProvenance,
	decideElectronPhaseContinuation,
	isElectronPerformancePhase,
	mergeRawPerformanceReports,
	preserveFirstNonzeroStatus,
	requiresRefactorPerformancePreflight,
	validateElectronPhaseReport,
	writeJson
} from './performance-tools.mjs';

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..'
);
const args = process.argv.slice(2);
const fixtureVariant = parseFixtureVariant(args);
const sizeIndex = args.indexOf('--size');
const size = Number.parseInt(
	sizeIndex >= 0 ? args[sizeIndex + 1] : '10000',
	10
);
const smoke = args.includes('--smoke');
const failFast = args.includes('--fail-fast');
const disableHarloweEditorExtensions = args.includes(
	'--disable-harlowe-editor-extensions'
);
const profileEdit = args.includes('--profile-edit');
const phaseIndex = args.indexOf('--phase');
const requestedPhase = phaseIndex >= 0 ? args[phaseIndex + 1] : 'all';
const completePhases = ['startup', 'edit', 'query', 'graph', 'watcher'];
const validPhases = [
	'all',
	'diagnostic',
	'interaction',
	'memory-detail',
	'refactor',
	...completePhases
];

function redactBrokerSecrets(value) {
	return value.replace(/\b[a-f0-9]{64}\b/gi, '[redacted-broker-token]');
}

if (!Number.isInteger(size) || size <= 0) {
	throw new Error('--size must be a positive integer.');
}
if (!isElectronPerformancePhase(requestedPhase)) {
	throw new Error(`--phase must be one of: ${validPhases.join(', ')}.`);
}
if (requiresRefactorPerformancePreflight(requestedPhase)) {
	const preflight = spawnSync('npm', ['run', 'typecheck:e2e-performance'], {
		cwd: repoRoot,
		stdio: 'inherit'
	});
	if (preflight.status !== 0) {
		throw new Error(
			'Refactor performance preflight failed: typecheck:e2e-performance must pass before Electron launches.'
		);
	}
}
if (
	(disableHarloweEditorExtensions || profileEdit) &&
	requestedPhase !== 'edit'
) {
	throw new Error(
		'--disable-harlowe-editor-extensions and --profile-edit require focused --phase edit.'
	);
}
if (disableHarloweEditorExtensions && fixtureVariant !== 'default') {
	throw new Error(
		'--disable-harlowe-editor-extensions requires the default Harlowe fixture variant.'
	);
}

const phases =
	requestedPhase === 'all'
		? completePhases
		: requestedPhase === 'interaction'
			? ['edit', 'query', 'graph']
			: [requestedPhase];

const generatedRoot = path.join(
	repoRoot,
	'benchmarks',
	'fixtures',
	'generated'
);
const fixtureVariantRoot = performanceFixtureVariantRoot(
	generatedRoot,
	fixtureVariant
);
const fixture = path.join(
	fixtureVariantRoot,
	'projects',
	`story-${size}.twine.rs`
);
const reportVariantSuffix =
	fixtureVariant === 'default' ? '' : `-${fixtureVariant}`;
const report = path.join(
	repoRoot,
	'benchmarks',
	'results',
	`electron-${new Date()
		.toISOString()
		.replace(/[:.]/g, '-')}-${size}${reportVariantSuffix}.json`
);
const editTrace = report.replace(/\.json$/, '.edit-trace.json.gz');
const editCpuProfile = report.replace(/\.json$/, '.edit.cpuprofile');
const checkpoint = report.replace(/\.json$/, '.checkpoint.json');
const failureDiagnostics = report.replace(/\.json$/, '.failure');
const main = path.join(
	repoRoot,
	'electron-build',
	'main',
	'src',
	'electron',
	'main-process',
	'index.js'
);
const renderer = path.join(
	repoRoot,
	'electron-build',
	'renderer',
	'index.html'
);
const native = path.join(
	repoRoot,
	'electron-build',
	'main',
	'src',
	'electron',
	'main-process',
	'native',
	'twine_native.node'
);
const buildInputs = [
	path.join(repoRoot, 'src'),
	path.join(repoRoot, 'crates'),
	path.join(repoRoot, 'public'),
	path.join(repoRoot, 'Cargo.lock'),
	path.join(repoRoot, 'Cargo.toml'),
	path.join(repoRoot, 'package-lock.json'),
	path.join(repoRoot, 'package.json'),
	path.join(repoRoot, 'tsconfig.electron.json'),
	path.join(repoRoot, 'tsconfig.json'),
	path.join(repoRoot, 'vite.config.mts')
];
const buildArtifacts = [main, renderer, native];
const productionBuildRoot = path.join(repoRoot, 'electron-build');

await access(fixture).catch(() => {
	throw new Error(
		`Missing fixture ${fixture}. Run node benchmarks/prepare-project-fixtures.mjs ` +
			`--sizes ${size} --variant ${fixtureVariant} first.`
	);
});
await access(main).catch(() => {
	throw new Error(
		`Missing production Electron build. Run npm run perf:prepare first.`
	);
});
await assertFreshProductionBuild();
await mkdir(path.join(repoRoot, 'benchmarks', 'results'), {recursive: true});

async function mtimeMs(file) {
	return (await stat(file)).mtimeMs;
}

async function newestSourceMtime(entry) {
	if (entry.endsWith(path.join('native', 'twine_native.node'))) {
		return 0;
	}

	let info;

	try {
		info = await stat(entry);
	} catch (error) {
		if (error.code === 'ENOENT') {
			return 0;
		}
		throw error;
	}

	if (!info.isDirectory()) {
		return info.mtimeMs;
	}

	let newest = info.mtimeMs;

	for (const child of await readdir(entry)) {
		if (
			child === 'node_modules' ||
			child === 'target' ||
			child === 'dist' ||
			child === 'electron-build' ||
			child === 'release'
		) {
			continue;
		}
		newest = Math.max(newest, await newestSourceMtime(path.join(entry, child)));
	}

	return newest;
}

async function assertFreshProductionBuild() {
	if (process.env.TWINE_PERF_ALLOW_STALE_BUILD === '1') {
		return;
	}

	const missing = [];
	const artifactTimes = [];

	for (const artifact of buildArtifacts) {
		try {
			artifactTimes.push(await mtimeMs(artifact));
		} catch (error) {
			if (error.code === 'ENOENT') {
				missing.push(path.relative(repoRoot, artifact));
				continue;
			}
			throw error;
		}
	}

	if (missing.length > 0) {
		throw new Error(
			`Missing production Electron build artifact(s): ${missing.join(
				', '
			)}. Run npm run perf:prepare first.`
		);
	}

	const sourceNewest = Math.max(
		...(await Promise.all(buildInputs.map(newestSourceMtime)))
	);
	const artifactOldest = Math.min(...artifactTimes);

	if (sourceNewest > artifactOldest + 1000) {
		throw new Error(
			'Production Electron build is older than app/native sources. ' +
				'Run npm run perf:prepare before running performance phases. ' +
				'Set TWINE_PERF_ALLOW_STALE_BUILD=1 only for intentional stale-build diagnostics.'
		);
	}
}

const fixtureFingerprintBefore = await treeMetadataFingerprint(fixture);
const productionBuildFingerprintBefore =
	await treeMetadataFingerprint(productionBuildRoot);
const gitProvenanceBefore = await currentGitProvenance(repoRoot);
const runRoot = await mkdtemp(path.join(os.tmpdir(), 'twine-rs-perf-run-'));
const runId = path.basename(runRoot);
const launchTrace = path.join(runRoot, 'launch-trace.jsonl');
const phaseResults = {};
const rawReports = [];
let runStatus = 0;
let measurementStatus = 0;
let merged;
let runRootRemoved = false;
let sourceFixtureUnchanged = false;
let isolatedUserData = false;
const checkpointState = {
	configuration: {
		baselineCompatible: !disableHarloweEditorExtensions && !profileEdit,
		edit: {
			disableHarloweEditorExtensions,
			profile: profileEdit
		}
	},
	createdAt: new Date().toISOString(),
	currentPhase: undefined,
	launches: [],
	phases: phaseResults,
	requestedPhases: phases,
	runId,
	schemaVersion: 1,
	size,
	fixtureVariant,
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

		const playwrightArgs = [
			'playwright',
			'test',
			'--config',
			'playwright.electron.config.ts',
			...(profileEdit || phase === 'refactor' ? ['--retries=0'] : [])
		];
		const result = spawnSync(
			process.platform === 'win32' ? 'npx.cmd' : 'npx',
			playwrightArgs,
			{
				cwd: repoRoot,
				encoding: 'utf8',
				env: {
					...process.env,
					...(profileEdit
						? {
								TWINE_PERF_EDIT_CPU_PROFILE: editCpuProfile,
								TWINE_PERF_EDIT_PROFILE: '1',
								TWINE_PERF_EDIT_TRACE: editTrace
							}
						: {}),
					TWINE_PERF_FIXTURE: fixture,
					TWINE_PERF_FIXTURE_VARIANT: fixtureVariant,
					TWINE_PERF_DISABLE_HARLOWE_EDITOR_EXTENSIONS:
						disableHarloweEditorExtensions ? '1' : '0',
					TWINE_PERF_LAUNCH_TRACE: launchTrace,
					TWINE_PERF_PHASE: phase,
					TWINE_PERF_REPORT: partialReport,
					TWINE_PERF_RUN_ID: runId,
					TWINE_PERF_RUN_ROOT: runRoot,
					TWINE_PERF_SMOKE: smoke ? '1' : '0',
					TWINE_PERF_SIZE: String(size)
				},
				stdio: 'pipe'
			}
		);
		const stdout = redactBrokerSecrets(result.stdout ?? '');
		const stderr = redactBrokerSecrets(result.stderr ?? '');
		await writeFile(
			path.join(runRoot, `${phase}.playwright.stdout.log`),
			stdout
		);
		await writeFile(
			path.join(runRoot, `${phase}.playwright.stderr.log`),
			stderr
		);
		if (stdout) process.stdout.write(stdout);
		if (stderr) process.stderr.write(stderr);
		const exitCode = result.status ?? 1;
		checkpointState.launches = await readLaunchTrace();
		const phaseSourceFixtureUnchanged =
			(await treeMetadataFingerprint(fixture)) === fixtureFingerprintBefore;
		const phaseProductionBuildUnchanged =
			(await treeMetadataFingerprint(productionBuildRoot)) ===
			productionBuildFingerprintBefore;
		let partial;
		let reportReadError;

		try {
			partial = JSON.parse(await readFile(partialReport, 'utf8'));
		} catch (error) {
			reportReadError = error;
		}
		const reportValidation = validateElectronPhaseReport(partial, {
			fixtureVariant,
			git: gitProvenanceBefore,
			phase,
			size
		});

		if (reportReadError) {
			reportValidation.errors.unshift(
				reportReadError.code === 'ENOENT'
					? 'The phase report is missing.'
					: `The phase report could not be read: ${reportReadError.message}`
			);
			reportValidation.valid = false;
		}
		const decision = decideElectronPhaseContinuation({
			exitCode,
			failFast,
			productionBuildUnchanged: phaseProductionBuildUnchanged,
			reportValidation,
			sourceFixtureUnchanged: phaseSourceFixtureUnchanged
		});

		if (decision.usable) {
			rawReports.push(partial);
		}
		if (exitCode !== 0) {
			runStatus = preserveFirstNonzeroStatus(runStatus, exitCode);
		} else if (decision.failureKind === 'assertion') {
			measurementStatus = 1;
		} else if (decision.status !== 'passed') {
			runStatus = preserveFirstNonzeroStatus(runStatus, 1);
		}

		phaseResults[phase] = {
			error: result.error?.message,
			exitCode,
			failureKind: decision.failureKind,
			finishedAt: new Date().toISOString(),
			measurementBodyCompleted: reportValidation.bodyCompleted,
			processes:
				decision.status === 'passed' ? undefined : captureRelevantProcesses(),
			productionBuildUnchanged: phaseProductionBuildUnchanged,
			reason: decision.reason,
			reportValidationErrors:
				reportValidation.errors.length > 0
					? reportValidation.errors
					: undefined,
			sourceFixtureUnchanged: phaseSourceFixtureUnchanged,
			startedAt,
			status: decision.status
		};

		await updateCheckpoint();
		await settleLaunchServices();

		if (!decision.continueRun) {
			break;
		}
	}

	merged = mergeRawPerformanceReports(rawReports, phaseResults);

	checkpointState.currentPhase = undefined;
	checkpointState.status =
		runStatus === 0 && measurementStatus === 0 ? 'completed' : 'failed';
	await updateCheckpoint();
} finally {
	const launches = await readLaunchTrace();

	checkpointState.launches = launches;
	const retainDiagnostics = runStatus !== 0 || measurementStatus !== 0;
	if (retainDiagnostics) {
		await cp(runRoot, failureDiagnostics, {
			errorOnExist: false,
			recursive: true
		});
		checkpointState.failureDiagnostics = failureDiagnostics;
	}
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
	runStatus === 0 && measurementStatus === 0 && reportStatus === 0
		? 'completed'
		: 'failed';
await updateCheckpoint();

process.exitCode =
	runStatus !== 0
		? runStatus
		: measurementStatus !== 0
			? measurementStatus
			: reportStatus;
