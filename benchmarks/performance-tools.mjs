import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {
	lstat,
	mkdir,
	readFile,
	readdir,
	readlink,
	writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {performanceReportSchemaVersion} from './performance-report-schema.mjs';

export {performanceReportSchemaVersion};
export const completeElectronPhases = [
	'startup',
	'edit',
	'query',
	'graph',
	'watcher'
];

function isRecord(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const gitFingerprintMaxBytes = 128 * 1024 * 1024;

function gitOutput(repoRoot, args) {
	return execFileSync('git', args, {
		cwd: repoRoot,
		encoding: 'buffer',
		maxBuffer: gitFingerprintMaxBytes
	});
}

function updateFingerprint(hash, label, value) {
	const contents = Buffer.isBuffer(value) ? value : Buffer.from(value);

	hash.update(label);
	hash.update('\0');
	hash.update(String(contents.length));
	hash.update('\0');
	hash.update(contents);
	hash.update('\0');
}

export async function currentGitProvenance(repoRoot) {
	const revision = gitOutput(repoRoot, ['rev-parse', 'HEAD'])
		.toString('utf8')
		.trim();
	const status = gitOutput(repoRoot, [
		'status',
		'--porcelain=v2',
		'-z',
		'--untracked-files=all'
	]);
	const staged = gitOutput(repoRoot, [
		'diff',
		'--cached',
		'--no-ext-diff',
		'--binary'
	]);
	const unstaged = gitOutput(repoRoot, ['diff', '--no-ext-diff', '--binary']);
	const untracked = gitOutput(repoRoot, [
		'ls-files',
		'--others',
		'--exclude-standard',
		'-z'
	])
		.toString('utf8')
		.split('\0')
		.filter(Boolean)
		.sort();
	const hash = createHash('sha256');
	let untrackedBytes = 0;

	updateFingerprint(hash, 'status', status);
	updateFingerprint(hash, 'staged', staged);
	updateFingerprint(hash, 'unstaged', unstaged);
	for (const relativePath of untracked) {
		const absolutePath = path.join(repoRoot, relativePath);
		const metadata = await lstat(absolutePath);
		const contents = metadata.isSymbolicLink()
			? Buffer.from(await readlink(absolutePath))
			: await readFile(absolutePath);

		untrackedBytes += contents.length;
		if (untrackedBytes > gitFingerprintMaxBytes) {
			throw new Error(
				'Untracked files exceed the worktree fingerprint size limit.'
			);
		}
		updateFingerprint(
			hash,
			`untracked:${relativePath}:${metadata.mode}:${
				metadata.isSymbolicLink() ? 'symlink' : 'file'
			}`,
			contents
		);
	}

	return {
		dirty: status.length > 0,
		revision,
		worktreeFingerprint: hash.digest('hex')
	};
}

export function preserveFirstNonzeroStatus(current, next) {
	return current !== 0 ? current : next;
}

export function validateElectronPhaseReport(
	report,
	{fixtureVariant, git, phase, size}
) {
	const errors = [];

	if (!isRecord(report)) {
		return {
			bodyCompleted: false,
			errors: ['The phase report is not a JSON object.'],
			failedAssertionCount: 0,
			failureKind: 'infrastructure',
			valid: false
		};
	}

	if (report.schemaVersion !== performanceReportSchemaVersion) {
		errors.push('The phase report uses an unsupported schema version.');
	}
	if (report.kind !== 'twine-electron-performance') {
		errors.push('The phase report has an unexpected kind.');
	}
	if (report.phase !== phase) {
		errors.push(
			`The phase report identifies ${String(report.phase)} instead of ${phase}.`
		);
	}
	if (report.fixture?.passageCount !== size) {
		errors.push(
			`The phase report identifies ${String(
				report.fixture?.passageCount
			)} passages instead of ${size}.`
		);
	}
	try {
		if (reportFixtureVariant(report) !== fixtureVariant) {
			errors.push('The phase report has an unexpected fixture variant.');
		}
	} catch (error) {
		errors.push(error.message);
	}

	const samplesValid =
		isRecord(report.samples) &&
		Object.values(report.samples).every(
			values =>
				Array.isArray(values) && values.every(value => Number.isFinite(value))
		);

	if (!samplesValid) {
		errors.push('The phase report samples are malformed.');
	}

	const assertionsValid =
		Array.isArray(report.assertions) &&
		report.assertions.every(
			assertion =>
				isRecord(assertion) &&
				typeof assertion.name === 'string' &&
				assertion.name.length > 0 &&
				typeof assertion.passed === 'boolean' &&
				(assertion.detail === undefined || typeof assertion.detail === 'string')
		);

	if (!assertionsValid) {
		errors.push('The phase report assertions are malformed.');
	}

	const failedAssertionCount = assertionsValid
		? report.assertions.filter(assertion => !assertion.passed).length
		: 0;
	const bodyCompleted = report.measurement?.bodyCompleted === true;
	const reportedFailedAssertionCount = report.measurement?.failedInvariantCount;
	const failureKind = report.measurement?.failureKind;
	const testStatus = report.test?.status;
	const attempts = report.measurement?.attempts;

	if (
		!isRecord(report.measurement) ||
		typeof report.measurement.bodyCompleted !== 'boolean' ||
		!Number.isInteger(reportedFailedAssertionCount) ||
		reportedFailedAssertionCount < 0 ||
		(failureKind !== undefined &&
			failureKind !== 'assertion' &&
			failureKind !== 'infrastructure')
	) {
		errors.push('The phase report measurement result is malformed.');
	}
	if (typeof testStatus !== 'string' || testStatus.length === 0) {
		errors.push('The phase report test status is malformed.');
	}
	if (reportedFailedAssertionCount !== failedAssertionCount) {
		errors.push('The phase report failed-invariant count is inconsistent.');
	}

	let infrastructureAttemptCount = 0;

	if (!Array.isArray(attempts) || attempts.length === 0) {
		errors.push('The phase report retry history is missing or malformed.');
	} else {
		for (const [index, attempt] of attempts.entries()) {
			if (
				!isRecord(attempt) ||
				attempt.retry !== index ||
				typeof attempt.status !== 'string' ||
				attempt.status.length === 0 ||
				typeof attempt.bodyCompleted !== 'boolean' ||
				!Number.isInteger(attempt.failedInvariantCount) ||
				attempt.failedInvariantCount < 0 ||
				(attempt.failureKind !== undefined &&
					attempt.failureKind !== 'assertion' &&
					attempt.failureKind !== 'infrastructure')
			) {
				errors.push(`The phase report retry attempt ${index} is malformed.`);
				continue;
			}

			const expectedFailureKind =
				attempt.bodyCompleted && attempt.status === 'passed'
					? attempt.failedInvariantCount > 0
						? 'assertion'
						: undefined
					: 'infrastructure';

			if (attempt.failureKind !== expectedFailureKind) {
				errors.push(
					`The phase report retry attempt ${index} has an inconsistent result.`
				);
			}
			if (expectedFailureKind === 'infrastructure') {
				infrastructureAttemptCount += 1;
			}
			if (
				index < attempts.length - 1 &&
				expectedFailureKind !== 'infrastructure'
			) {
				errors.push(
					`The non-final retry attempt ${index} hides an infrastructure failure.`
				);
				infrastructureAttemptCount += 1;
			}
		}

		const finalAttempt = attempts.at(-1);

		if (
			!isRecord(finalAttempt) ||
			finalAttempt.status !== testStatus ||
			finalAttempt.bodyCompleted !== bodyCompleted ||
			finalAttempt.failureKind !== failureKind ||
			finalAttempt.failedInvariantCount !== reportedFailedAssertionCount
		) {
			errors.push(
				'The final retry attempt does not match the top-level phase result.'
			);
		}
	}

	const reportGit = report.environment?.git;

	if (
		!isRecord(reportGit) ||
		typeof reportGit.revision !== 'string' ||
		reportGit.revision.length === 0 ||
		typeof reportGit.dirty !== 'boolean' ||
		typeof reportGit.worktreeFingerprint !== 'string' ||
		reportGit.worktreeFingerprint.length === 0
	) {
		errors.push('The phase report is missing essential Git provenance.');
	} else if (
		git &&
		(reportGit.revision !== git.revision ||
			reportGit.dirty !== git.dirty ||
			reportGit.worktreeFingerprint !== git.worktreeFingerprint)
	) {
		errors.push('The Git revision or worktree state changed across phases.');
	}

	return {
		bodyCompleted,
		errors,
		failedAssertionCount,
		failureKind,
		git: isRecord(reportGit) ? reportGit : undefined,
		infrastructureAttemptCount,
		valid: errors.length === 0
	};
}

export function decideElectronPhaseContinuation({
	exitCode,
	failFast = false,
	productionBuildUnchanged = true,
	reportValidation,
	sourceFixtureUnchanged = true
}) {
	if (exitCode !== 0) {
		return {
			continueRun: false,
			failureKind: 'infrastructure',
			reason: 'The Playwright process exited nonzero.',
			status: 'failed',
			usable: false
		};
	}
	if (!reportValidation.valid) {
		return {
			continueRun: false,
			failureKind: 'infrastructure',
			reason: reportValidation.errors.join(' '),
			status: 'failed',
			usable: false
		};
	}
	if (reportValidation.infrastructureAttemptCount > 0) {
		return {
			continueRun: false,
			failureKind: 'infrastructure',
			reason: 'A Playwright retry attempt had an infrastructure failure.',
			status: 'failed',
			usable: false
		};
	}
	if (!sourceFixtureUnchanged) {
		return {
			continueRun: false,
			failureKind: 'infrastructure',
			reason: 'The source fixture changed during the phase.',
			status: 'failed',
			usable: false
		};
	}
	if (!productionBuildUnchanged) {
		return {
			continueRun: false,
			failureKind: 'infrastructure',
			reason: 'The production build changed during the phase.',
			status: 'failed',
			usable: false
		};
	}

	const reportPassed =
		reportValidation.bodyCompleted &&
		reportValidation.failureKind === undefined &&
		reportValidation.failedAssertionCount === 0;
	const assertionFailed =
		reportValidation.bodyCompleted &&
		reportValidation.failureKind === 'assertion' &&
		reportValidation.failedAssertionCount > 0;

	if (reportPassed) {
		return {
			continueRun: true,
			status: 'passed',
			usable: true
		};
	}
	if (assertionFailed) {
		return {
			continueRun: !failFast,
			failureKind: 'assertion',
			reason: 'The completed phase has failed performance assertions.',
			status: 'failed',
			usable: true
		};
	}

	return {
		continueRun: false,
		failureKind: 'infrastructure',
		reason: 'The phase measurement did not complete successfully.',
		status: 'failed',
		usable: false
	};
}

export function percentile(values, percentage) {
	const sorted = values
		.filter(value => Number.isFinite(value))
		.sort((left, right) => left - right);

	if (sorted.length === 0) {
		return undefined;
	}

	const rank = Math.max(
		0,
		Math.min(sorted.length - 1, Math.ceil(percentage * sorted.length) - 1)
	);

	return sorted[rank];
}

export function aggregateSamples(samples) {
	return Object.fromEntries(
		Object.entries(samples).map(([name, values]) => {
			const finite = values.filter(value => Number.isFinite(value));
			const total = finite.reduce((sum, value) => sum + value, 0);

			return [
				name,
				{
					count: finite.length,
					max: finite.length ? Math.max(...finite) : undefined,
					mean: finite.length ? total / finite.length : undefined,
					min: finite.length ? Math.min(...finite) : undefined,
					p50: percentile(finite, 0.5),
					p95: percentile(finite, 0.95)
				}
			];
		})
	);
}

export function mergeRawPerformanceReports(reports, phaseResults = {}) {
	if (reports.length === 0) {
		return undefined;
	}

	const first = reports[0];
	const samples = {};
	const diagnostics = {
		bridgeMetrics: [],
		phases: {},
		startup: []
	};

	for (const report of reports) {
		for (const [name, values] of Object.entries(report.samples ?? {})) {
			(samples[name] ??= []).push(...values);
		}

		diagnostics.phases[report.phase] = report.diagnostics ?? {};
		diagnostics.bridgeMetrics.push(
			...(report.diagnostics?.bridgeMetrics ?? [])
		);
		diagnostics.startup.push(...(report.diagnostics?.startup ?? []));

		for (const key of [
			'interaction',
			'memoryDetail',
			'watcher',
			'watcherAsset',
			'watcherPassage'
		]) {
			if (report.diagnostics?.[key] !== undefined) {
				diagnostics[key] = report.diagnostics[key];
			}
		}
	}
	const gitStates = reports.map(report => report.environment?.git);
	const gitRevisions = gitStates.map(state => state?.revision);
	const gitDirtyStates = gitStates.map(state => state?.dirty);
	const gitWorktreeFingerprints = gitStates.map(
		state => state?.worktreeFingerprint
	);
	const fixtureVariants = reports.map(reportFixtureVariant);
	const mergedAssertions = reports.flatMap(report => report.assertions ?? []);

	mergedAssertions.push(
		{
			detail: JSON.stringify(gitRevisions),
			name: 'git-revision-stable-across-phases',
			passed:
				gitRevisions.every(
					revision => typeof revision === 'string' && revision
				) && gitRevisions.every(revision => revision === gitRevisions[0])
		},
		{
			detail: JSON.stringify(gitDirtyStates),
			name: 'git-dirty-state-stable-across-phases',
			passed:
				gitDirtyStates.every(state => typeof state === 'boolean') &&
				gitDirtyStates.every(state => state === gitDirtyStates[0])
		},
		{
			detail: JSON.stringify(gitWorktreeFingerprints),
			name: 'git-worktree-state-stable-across-phases',
			passed:
				gitWorktreeFingerprints.every(
					fingerprint => typeof fingerprint === 'string' && fingerprint
				) &&
				gitWorktreeFingerprints.every(
					fingerprint => fingerprint === gitWorktreeFingerprints[0]
				)
		},
		{
			detail: JSON.stringify(fixtureVariants),
			name: 'fixture-variant-stable-across-phases',
			passed: fixtureVariants.every(variant => variant === fixtureVariants[0])
		}
	);

	const merged = {
		...first,
		assertions: mergedAssertions,
		createdAt: new Date().toISOString(),
		diagnostics,
		phase: reports.length === 1 ? first.phase : 'all',
		phases: phaseResults,
		samples,
		test: {
			status: Object.values(phaseResults).every(
				result => result.status === 'passed'
			)
				? 'passed'
				: 'failed'
		}
	};

	if (reports.length > 1) {
		delete merged.measurement;
	}

	return merged;
}

export function currentMachine() {
	const cpu = os.cpus()[0];

	return {
		arch: process.arch,
		cpu: cpu?.model ?? 'unknown',
		cpuCount: os.cpus().length,
		memoryBytes: os.totalmem(),
		node: process.version,
		platform: process.platform,
		release: os.release()
	};
}

export function machineFingerprint(environment) {
	const stable = JSON.stringify({
		arch: environment.machine.arch,
		cpu: environment.machine.cpu,
		cpuCount: environment.machine.cpuCount,
		electron: environment.versions.electron,
		platform: environment.machine.platform
	});

	return createHash('sha256').update(stable).digest('hex').slice(0, 16);
}

export function reportFixtureVariant(report) {
	const variant = report.fixture?.fixtureVariant ?? 'default';

	if (
		typeof variant !== 'string' ||
		!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(variant)
	) {
		throw new Error(`Invalid performance fixture variant: ${String(variant)}.`);
	}

	return variant;
}

export function performanceBaselinePath(resultsDir, report) {
	const variant = reportFixtureVariant(report);
	const suffix = variant === 'default' ? '' : `-${variant}`;

	return path.join(
		resultsDir,
		'baselines',
		`${report.environment.fingerprint}-${report.fixture.passageCount}${suffix}.json`
	);
}

export function regressionAllowance(baselineValue, policy) {
	return Math.max(baselineValue * (policy.percent / 100), policy.floor);
}

function metricValue(report, name, stat) {
	return report.aggregates?.[name]?.[stat];
}

export function evaluatePerformanceReport(report, budgets, baseline) {
	const checks = [];

	for (const assertion of report.assertions ?? []) {
		checks.push({
			blocking: true,
			detail: assertion.detail,
			kind: 'invariant',
			name: assertion.name,
			passed: assertion.passed
		});
	}

	for (const [name, budget] of Object.entries(budgets.metrics ?? {})) {
		const actual = metricValue(report, name, budget.stat);

		if (actual === undefined) {
			checks.push({
				blocking: false,
				detail: 'Metric was not captured by this scenario.',
				kind: 'target',
				name,
				passed: true,
				status: 'missing'
			});
			continue;
		}

		checks.push({
			actual,
			blocking: budget.enforceTarget === true,
			detail: `${budget.stat} ${actual.toFixed(2)}; target ≤ ${budget.target}`,
			kind: 'target',
			limit: budget.target,
			name,
			passed: actual <= budget.target
		});
	}

	let baselineStatus = 'missing';

	if (baseline) {
		baselineStatus =
			baseline.environment?.fingerprint === report.environment?.fingerprint &&
			reportFixtureVariant(baseline) === reportFixtureVariant(report)
				? 'matched'
				: 'mismatched';
	}

	if (baselineStatus === 'matched') {
		for (const [name, budget] of Object.entries(budgets.metrics ?? {})) {
			const metricNamespace = name.split('.')[0];
			const reportContract =
				report.environment?.metricContracts?.[metricNamespace];
			const baselineContract =
				baseline.environment?.metricContracts?.[metricNamespace];

			if (
				(reportContract !== undefined || baselineContract !== undefined) &&
				reportContract !== baselineContract
			) {
				continue;
			}
			const actual = metricValue(report, name, budget.stat);
			const previous = metricValue(baseline, name, budget.stat);

			if (actual === undefined || previous === undefined) {
				continue;
			}

			const policy = budgets.regressions[budget.category];
			const allowance = regressionAllowance(previous, policy);
			const limit = previous + allowance;

			checks.push({
				actual,
				baseline: previous,
				blocking: true,
				detail: `${budget.stat} ${actual.toFixed(2)}; baseline ${previous.toFixed(
					2
				)} + ${allowance.toFixed(2)}`,
				kind: 'regression',
				limit,
				name,
				passed: actual <= limit
			});
		}
	}

	return {
		baselineStatus,
		checks,
		passed: checks.every(check => !check.blocking || check.passed)
	};
}

export function baselineCandidateErrors(
	report,
	budgets,
	{requireClean = false} = {}
) {
	const errors = [];

	if (
		report.schemaVersion !== performanceReportSchemaVersion ||
		report.kind !== 'twine-electron-performance' ||
		!report.environment?.fingerprint
	) {
		errors.push('The selected file is not a completed performance report.');
		return errors;
	}
	if (report.smoke) {
		errors.push('Smoke reports cannot be accepted as baselines.');
	}
	if (report.phase !== 'all' || report.test?.status !== 'passed') {
		errors.push('A baseline must be a passing all-phase report.');
	}
	for (const phase of completeElectronPhases) {
		if (report.phases?.[phase]?.status !== 'passed') {
			errors.push(`Missing passing phase: ${phase}.`);
		}
	}
	for (const [name, budget] of Object.entries(budgets.metrics ?? {})) {
		if (metricValue(report, name, budget.stat) === undefined) {
			errors.push(`Missing baseline metric: ${name}.`);
		}
	}
	if (report.evaluation?.passed !== true) {
		errors.push('The report has blocking invariant failures.');
	}
	if (
		requireClean &&
		(report.environment?.git?.dirty !== false ||
			typeof report.environment?.git?.revision !== 'string' ||
			!report.environment.git.revision ||
			typeof report.environment?.git?.worktreeFingerprint !== 'string' ||
			!report.environment.git.worktreeFingerprint)
	) {
		errors.push('An accepted baseline must come from a clean Git revision.');
	}
	if (requireClean) {
		for (const name of [
			'git-revision-stable-across-phases',
			'git-dirty-state-stable-across-phases',
			'git-worktree-state-stable-across-phases'
		]) {
			if (
				!report.assertions?.some(
					assertion => assertion.name === name && assertion.passed === true
				)
			) {
				errors.push(
					`An accepted baseline must include a passing ${name} assertion.`
				);
			}
		}
	}

	return errors;
}

export async function readJson(file) {
	return JSON.parse(await readFile(file, 'utf8'));
}

export async function writeJson(file, value) {
	await mkdir(path.dirname(file), {recursive: true});
	await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

export async function latestReport(resultsDir, size, variant = 'default') {
	let files;

	try {
		files = await readdir(resultsDir);
	} catch (error) {
		if (error.code === 'ENOENT') {
			return undefined;
		}
		throw error;
	}

	const candidates = files
		.filter(file => {
			if (!file.startsWith('electron-')) {
				return false;
			}

			const match = file.match(/-(\d+)(?:-([a-z][a-z0-9-]*))?\.json$/i);

			if (!match) {
				return false;
			}

			const fileSize = Number.parseInt(match[1], 10);
			const fileVariant = match[2] ?? 'default';

			return (
				(size === undefined || fileSize === size) && fileVariant === variant
			);
		})
		.sort()
		.reverse();

	return candidates[0] ? path.join(resultsDir, candidates[0]) : undefined;
}

export function markdownReport(report) {
	const lines = [
		`# Electron Performance — ${report.fixture.passageCount} passages`,
		'',
		`Generated: ${report.createdAt}`,
		`Phase: ${report.phase ?? 'all'}`,
		`Machine: ${report.environment.machine.cpu} (${report.environment.machine.platform}/${report.environment.machine.arch})`,
		`Baseline: ${report.evaluation.baselineStatus}`,
		'',
		'| Metric | p50 | p95 | max | Target | Baseline | Δ | Result |',
		'| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |'
	];

	for (const [name, aggregate] of Object.entries(report.aggregates)) {
		const target = report.budgets.metrics[name]?.target;
		const regression = report.evaluation.checks.find(
			check => check.kind === 'regression' && check.name === name
		);
		const baseline = regression?.baseline;
		const statistic = report.budgets.metrics[name]?.stat;
		const actual = statistic ? aggregate[statistic] : undefined;
		const blockingFailure = report.evaluation.checks.some(
			check => check.name === name && check.blocking && !check.passed
		);
		const targetMiss = report.evaluation.checks.some(
			check => check.name === name && check.kind === 'target' && !check.passed
		);
		const result = blockingFailure ? 'FAIL' : targetMiss ? 'TARGET MISS' : 'OK';

		lines.push(
			`| ${name} | ${numberCell(aggregate.p50)} | ${numberCell(
				aggregate.p95
			)} | ${numberCell(aggregate.max)} | ${
				target === undefined ? '—' : target
			} | ${numberCell(baseline)} | ${deltaCell(actual, baseline)} | ${result} |`
		);
	}

	lines.push('', '## Invariants', '');

	for (const assertion of report.assertions) {
		lines.push(
			`- ${assertion.passed ? 'PASS' : 'FAIL'} — ${assertion.name}${
				assertion.detail ? `: ${assertion.detail}` : ''
			}`
		);
	}

	const failures = report.evaluation.checks.filter(
		check => check.blocking && !check.passed
	);

	if (failures.length > 0) {
		lines.push('', '## Blocking failures', '');
		for (const failure of failures) {
			lines.push(`- ${failure.name}: ${failure.detail}`);
		}
	}

	return `${lines.join('\n')}\n`;
}

function numberCell(value) {
	return value === undefined ? '—' : value.toFixed(2);
}

function deltaCell(actual, baseline) {
	if (actual === undefined || baseline === undefined) {
		return '—';
	}

	const delta = actual - baseline;

	return `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`;
}
