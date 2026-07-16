import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
	createPerformanceReferenceSummary,
	objectSha256,
	sha256
} from '../reference-tools.mjs';

function exampleReport() {
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
		assertions: [
			{name: 'worker-mode', passed: true},
			{name: 'worker-mode', passed: true},
			{name: 'watcher-incremental', passed: true}
		],
		budgets: {metrics: {'startup.shellMs': {target: 400}}},
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
				{
					blocking: true,
					kind: 'invariant',
					name: 'worker-mode',
					passed: true
				},
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
		phase: 'all',
		phases: {
			startup: {
				exitCode: 0,
				finishedAt: '2026-07-03T19:00:00.000Z',
				startedAt: '2026-07-03T18:59:00.000Z',
				status: 'passed'
			}
		},
		samples: {'startup.shellMs': [8, 10, 12]},
		smoke: false,
		test: {status: 'passed'}
	};
}

test('creates a deterministic, normalized historical reference', () => {
	const report = exampleReport();
	const options = {
		sourceReportFile: 'benchmarks/results/source.json',
		sourceReportSha256: sha256('source report')
	};
	const first = createPerformanceReferenceSummary(report, options);
	const second = createPerformanceReferenceSummary(report, options);

	assert.deepEqual(first, second);
	assert.equal(first.classification, 'historical-initial-baseline');
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

test('classifies a clean report as a clean-commit baseline', () => {
	const report = exampleReport();

	report.environment.git = {dirty: false, revision: 'def456'};
	report.assertions.push(
		{name: 'git-revision-stable-across-phases', passed: true},
		{name: 'git-dirty-state-stable-across-phases', passed: true}
	);
	const summary = createPerformanceReferenceSummary(report, {
		sourceReportFile: 'benchmarks/results/source.json',
		sourceReportSha256: sha256('source report')
	});

	assert.equal(summary.classification, 'clean-commit-baseline');
	assert.deepEqual(summary.provenance.limitations, []);
});

test('requires phase-stable provenance for clean classification', () => {
	const report = exampleReport();

	report.environment.git = {dirty: false, revision: 'def456'};
	const summary = createPerformanceReferenceSummary(report, {
		sourceReportFile: 'benchmarks/results/source.json',
		sourceReportSha256: sha256('source report')
	});

	assert.equal(summary.classification, 'historical-initial-baseline');
	assert.match(summary.provenance.limitations[0], /phase-stable/);
});

test('does not classify missing Git provenance as a clean baseline', () => {
	const report = exampleReport();

	delete report.environment.git;
	const summary = createPerformanceReferenceSummary(report, {
		sourceReportFile: 'benchmarks/results/source.json',
		sourceReportSha256: sha256('source report')
	});

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
