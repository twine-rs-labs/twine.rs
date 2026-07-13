import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
	aggregateSamples,
	baselineCandidateErrors,
	evaluatePerformanceReport,
	machineFingerprint,
	mergeRawPerformanceReports,
	percentile,
	regressionAllowance
} from '../performance-tools.mjs';

test('calculates stable nearest-rank percentiles and aggregates', () => {
	assert.equal(percentile([5, 1, 4, 2, 3], 0.5), 3);
	assert.equal(percentile([5, 1, 4, 2, 3], 0.95), 5);
	assert.equal(percentile([], 0.5), undefined);
	assert.deepEqual(aggregateSamples({edit: [4, 1, 3, 2]}), {
		edit: {count: 4, max: 4, mean: 2.5, min: 1, p50: 2, p95: 4}
	});
});

test('merges independently checkpointed benchmark phases', () => {
	const common = {
		environment: {machine: {}, versions: {}},
		fixture: {passageCount: 50_000},
		kind: 'twine-electron-performance',
		schemaVersion: 1
	};
	const merged = mergeRawPerformanceReports(
		[
			{
				...common,
				assertions: [{name: 'startup', passed: true}],
				diagnostics: {bridgeMetrics: [], startup: [{sample: 1}]},
				phase: 'startup',
				samples: {shell: [10]}
			},
			{
				...common,
				assertions: [{name: 'watcher', passed: true}],
				diagnostics: {
					bridgeMetrics: [{kind: 'ingestExternalDelta'}],
					watcher: {trace: true}
				},
				phase: 'watcher',
				samples: {shell: [20], watcher: [5]}
			}
		],
		{
			startup: {status: 'passed'},
			watcher: {status: 'passed'}
		}
	);

	assert.deepEqual(merged.samples, {shell: [10, 20], watcher: [5]});
	assert.deepEqual(merged.assertions, [
		{name: 'startup', passed: true},
		{name: 'watcher', passed: true}
	]);
	assert.equal(merged.diagnostics.startup.length, 1);
	assert.equal(merged.diagnostics.watcher.trace, true);
	assert.equal(merged.test.status, 'passed');
});

test('preserves detailed memory diagnostics for focused reports', () => {
	const report = {
		assertions: [],
		diagnostics: {
			bridgeMetrics: [],
			memoryDetail: {owners: {activeEditorCount: 0}},
			startup: []
		},
		environment: {machine: {}, versions: {}},
		fixture: {passageCount: 50_000},
		kind: 'twine-electron-performance',
		phase: 'memory-detail',
		samples: {},
		schemaVersion: 1
	};
	const merged = mergeRawPerformanceReports([report], {
		'memory-detail': {status: 'passed'}
	});

	assert.equal(merged.diagnostics.memoryDetail.owners.activeEditorCount, 0);
});

test('uses the greater percentage or absolute regression allowance', () => {
	assert.equal(regressionAllowance(100, {floor: 5, percent: 15}), 15);
	assert.equal(regressionAllowance(10, {floor: 5, percent: 15}), 5);
});

test('matches machine fingerprints only on stable performance fields', () => {
	const environment = {
		machine: {
			arch: 'arm64',
			cpu: 'Example CPU',
			cpuCount: 8,
			memoryBytes: 1,
			node: 'v20',
			platform: 'darwin',
			release: 'one'
		},
		versions: {electron: '41.2.0'}
	};

	assert.equal(
		machineFingerprint(environment),
		machineFingerprint({
			...environment,
			machine: {...environment.machine, memoryBytes: 2, release: 'two'}
		})
	);
});

test('blocks invariants and matching-baseline regressions but reports targets', () => {
	const budgets = {
		metrics: {
			'edit.paintMs': {
				category: 'electron',
				enforceTarget: false,
				stat: 'p95',
				target: 16.6
			}
		},
		regressions: {electron: {floor: 5, percent: 15}}
	};
	const base = {
		aggregates: {'edit.paintMs': {p95: 20}},
		assertions: [],
		environment: {fingerprint: 'same'}
	};
	const report = {
		aggregates: {'edit.paintMs': {p95: 31}},
		assertions: [{name: 'worker mode', passed: true}],
		environment: {fingerprint: 'same'}
	};
	const result = evaluatePerformanceReport(report, budgets, base);

	assert.equal(result.baselineStatus, 'matched');
	assert.equal(result.passed, false);
	assert.equal(
		result.checks.find(check => check.kind === 'target').blocking,
		false
	);
	assert.equal(
		result.checks.find(check => check.kind === 'regression').limit,
		25
	);
});

test('does not compare timing across different machines', () => {
	const result = evaluatePerformanceReport(
		{aggregates: {}, assertions: [], environment: {fingerprint: 'one'}},
		{metrics: {}, regressions: {}},
		{aggregates: {}, environment: {fingerprint: 'two'}}
	);

	assert.equal(result.baselineStatus, 'mismatched');
	assert.equal(result.passed, true);
});

test('does not compare metrics whose measurement contract changed', () => {
	const budgets = {
		metrics: {
			'startup.interactiveMs': {
				category: 'electron',
				enforceTarget: false,
				stat: 'p50',
				target: 1500
			}
		},
		regressions: {electron: {floor: 5, percent: 15}}
	};
	const result = evaluatePerformanceReport(
		{
			aggregates: {'startup.interactiveMs': {p50: 3000}},
			assertions: [],
			environment: {
				fingerprint: 'same',
				metricContracts: {startup: 2}
			}
		},
		budgets,
		{
			aggregates: {'startup.interactiveMs': {p50: 1000}},
			environment: {fingerprint: 'same'}
		}
	);

	assert.equal(result.baselineStatus, 'matched');
	assert.equal(
		result.checks.some(check => check.kind === 'regression'),
		false
	);
});

test('accepts only complete all-phase baseline reports', () => {
	const budgets = {
		metrics: {
			'edit.paintMs': {
				category: 'electron',
				stat: 'p95',
				target: 16.6
			}
		}
	};
	const report = {
		aggregates: {'edit.paintMs': {p95: 20}},
		environment: {fingerprint: 'machine'},
		evaluation: {passed: true},
		kind: 'twine-electron-performance',
		phase: 'all',
		phases: Object.fromEntries(
			['startup', 'edit', 'query', 'graph', 'watcher'].map(phase => [
				phase,
				{status: 'passed'}
			])
		),
		schemaVersion: 1,
		test: {status: 'passed'}
	};

	assert.deepEqual(baselineCandidateErrors(report, budgets), []);
	assert.match(
		baselineCandidateErrors({...report, phase: 'watcher'}, budgets).join(' '),
		/all-phase/
	);
	assert.match(
		baselineCandidateErrors(
			{...report, diagnostic: true, phase: 'diagnostic'},
			budgets
		).join(' '),
		/all-phase/
	);
	assert.match(
		baselineCandidateErrors({...report, aggregates: {}}, budgets).join(' '),
		/Missing baseline metric/
	);
});
