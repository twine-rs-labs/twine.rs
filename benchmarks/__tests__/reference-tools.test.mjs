import assert from 'node:assert/strict';
import {test} from 'node:test';
import {performanceReportSchemaVersion} from '../performance-report-schema.mjs';
import {
	createPerformanceReferenceSummary,
	objectSha256,
	sha256
} from '../reference-tools.mjs';

const performanceBudgets = {
	metrics: {'startup.shellMs': {stat: 'p50', target: 400}}
};
const completePhases = ['startup', 'edit', 'query', 'graph', 'watcher'];
const provenanceAssertions = [
	'git-revision-stable-across-phases',
	'git-dirty-state-stable-across-phases',
	'git-worktree-state-stable-across-phases'
];

function invariantCheck(name) {
	return {blocking: true, kind: 'invariant', name, passed: true};
}

function summaryOptions() {
	return {
		budgets: performanceBudgets,
		sourceReportFile: 'benchmarks/results/source.json',
		sourceReportSha256: sha256('source report')
	};
}

function exampleReport() {
	const assertions = [
		{name: 'worker-mode', passed: true},
		{name: 'worker-mode', passed: true},
		{name: 'watcher-incremental', passed: true}
	];

	return {
		aggregates: {
			'startup.shellMs': {
				count: 3,
				max: 12,
				mean: 10,
				min: 8,
				p50: 10,
				p95: 12
			}
		},
		assertions,
		budgets: performanceBudgets,
		createdAt: '2026-07-03T19:32:40.160Z',
		diagnostics: {large: 'omitted'},
		environment: {
			fingerprint: 'machine',
			git: {dirty: true, revision: 'abc123'},
			machine: {arch: 'arm64', cpu: 'Example'},
			versions: {electron: '41.2.0'}
		},
		evaluation: {
			baselineStatus: 'matched',
			checks: [
				...assertions.map(assertion => invariantCheck(assertion.name)),
				{
					actual: 10,
					blocking: false,
					kind: 'target',
					limit: 400,
					name: 'startup.shellMs',
					passed: true
				}
			],
			passed: true
		},
		fixture: {passageCount: 50_000, storyFormat: 'Harlowe'},
		kind: 'twine-electron-performance',
		phase: 'all',
		phases: Object.fromEntries(
			completePhases.map((phase, index) => [
				phase,
				{
					exitCode: 0,
					finishedAt: `2026-07-03T19:0${index + 1}:00.000Z`,
					startedAt: `2026-07-03T19:0${index}:00.000Z`,
					status: 'passed'
				}
			])
		),
		samples: {'startup.shellMs': [8, 10, 12]},
		schemaVersion: performanceReportSchemaVersion,
		smoke: false,
		test: {status: 'passed'}
	};
}

function cleanReport() {
	const report = exampleReport();

	report.environment.git = {
		dirty: false,
		revision: 'def456',
		worktreeFingerprint: 'worktree-one'
	};
	for (const name of provenanceAssertions) {
		report.assertions.push({name, passed: true});
		report.evaluation.checks.push(invariantCheck(name));
	}

	return report;
}

test('creates a deterministic, normalized historical reference', () => {
	const report = exampleReport();
	const first = createPerformanceReferenceSummary(report, summaryOptions());
	const second = createPerformanceReferenceSummary(report, summaryOptions());

	assert.deepEqual(first, second);
	assert.equal(first.classification, 'historical-initial-baseline');
	assert.equal(first.baselineEligible, false);
	assert.equal(first.environment.git.dirty, true);
	assert.equal(first.invariants.total, 2);
	assert.deepEqual(first.invariants.checks[1], {
		name: 'worker-mode',
		occurrences: 2,
		passed: true
	});
	assert.equal(first.provenance.sourceReport.tracked, false);
	assert.match(first.provenance.limitations[0], /dirty worktree/);
	assert.equal('samples' in first, false);
	assert.equal('diagnostics' in first, false);
});

test('classifies a strictly eligible clean report as a clean-commit baseline', () => {
	const summary = createPerformanceReferenceSummary(
		cleanReport(),
		summaryOptions()
	);

	assert.equal(summary.classification, 'clean-commit-baseline');
	assert.equal(summary.baselineEligible, true);
	assert.deepEqual(summary.provenance.limitations, []);
});

test('classifies a clean failed gate as evidence and retains its comparator', () => {
	const report = cleanReport();

	report.evaluation.checks.push({
		actual: 1148.90625,
		baseline: 1044.125,
		blocking: true,
		kind: 'regression',
		limit: 1148.5375,
		name: 'memory.residentMiB',
		passed: false
	});
	report.evaluation.passed = false;
	const summary = createPerformanceReferenceSummary(report, summaryOptions());

	assert.equal(summary.classification, 'clean-commit-failed-gate-evidence');
	assert.equal(summary.baselineEligible, false);
	assert.match(summary.provenance.limitations[0], /not eligible for baseline/);
	assert.equal(summary.evaluation.checks[0].baseline, 1044.125);
});

test('does not label a clean incomplete report as baseline evidence', () => {
	const report = cleanReport();

	report.phase = 'startup';
	report.phases = {startup: report.phases.startup};
	const summary = createPerformanceReferenceSummary(report, summaryOptions());

	assert.equal(summary.classification, 'clean-commit-ineligible-evidence');
	assert.equal(summary.baselineEligible, false);
	assert.match(
		summary.provenance.limitations[0],
		/strict baseline acceptance.*all-phase/
	);
});

test('requires budgets when determining baseline eligibility', () => {
	assert.throws(
		() =>
			createPerformanceReferenceSummary(cleanReport(), {
				sourceReportFile: 'benchmarks/results/source.json',
				sourceReportSha256: sha256('source report')
			}),
		/requires performance budgets/
	);
});

test('requires phase-stable provenance for clean classification', () => {
	const report = exampleReport();

	report.environment.git = {dirty: false, revision: 'def456'};
	const summary = createPerformanceReferenceSummary(report, summaryOptions());

	assert.equal(summary.classification, 'historical-initial-baseline');
	assert.match(summary.provenance.limitations[0], /phase-stable/);
});

test('does not classify missing Git provenance as a clean baseline', () => {
	const report = exampleReport();

	delete report.environment.git;
	const summary = createPerformanceReferenceSummary(report, summaryOptions());

	assert.equal(summary.classification, 'historical-initial-baseline');
	assert.match(
		summary.provenance.limitations[0],
		/verified clean Git revision/
	);
});

test('hashes equivalent objects independently of key order', () => {
	assert.equal(
		objectSha256({a: 1, b: {c: 2, d: 3}}),
		objectSha256({b: {d: 3, c: 2}, a: 1})
	);
});
