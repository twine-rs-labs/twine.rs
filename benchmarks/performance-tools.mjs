import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir, readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const performanceReportSchemaVersion = 1;
export const completeElectronPhases = [
	'startup',
	'edit',
	'query',
	'graph',
	'watcher'
];

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
		}
	);

	return {
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
			baseline.environment?.fingerprint === report.environment?.fingerprint
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
			!report.environment.git.revision)
	) {
		errors.push('An accepted baseline must come from a clean Git revision.');
	}
	if (requireClean) {
		for (const name of [
			'git-revision-stable-across-phases',
			'git-dirty-state-stable-across-phases'
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

export async function latestReport(resultsDir, size) {
	let files;

	try {
		files = await readdir(resultsDir);
	} catch (error) {
		if (error.code === 'ENOENT') {
			return undefined;
		}
		throw error;
	}

	const suffix = size ? `-${size}.json` : '.json';
	const candidates = files
		.filter(file => file.startsWith('electron-') && file.endsWith(suffix))
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
