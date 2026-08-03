import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {performanceReportSchemaVersion} from '../performance-report-schema.mjs';
import {
	aggregateSamples,
	baselineCandidateErrors,
	evaluatePerformanceReport,
	latestReport,
	machineFingerprint,
	mergeRawPerformanceReports,
	performanceBaselinePath,
	performanceReportSchemaVersion as validatorPerformanceReportSchemaVersion,
	percentile,
	reportFixtureVariant,
	regressionAllowance
} from '../performance-tools.mjs';

test('discovers the latest report within an explicit fixture variant', async () => {
	const directory = await mkdtemp(path.join(tmpdir(), 'twine-perf-reports-'));

	try {
		for (const file of [
			'electron-2026-01-01T00-00-00-000Z-10000.json',
			'electron-2026-01-01T00-00-01-000Z-10000-chapbook.json',
			'electron-2026-01-01T00-00-02-000Z-10000-chapbook.json'
		]) {
			await writeFile(path.join(directory, file), '{}');
		}

		assert.equal(
			await latestReport(directory, 10_000, 'chapbook'),
			path.join(
				directory,
				'electron-2026-01-01T00-00-02-000Z-10000-chapbook.json'
			)
		);
		assert.equal(
			await latestReport(directory, 10_000),
			path.join(directory, 'electron-2026-01-01T00-00-00-000Z-10000.json')
		);
		assert.equal(
			await latestReport(directory),
			path.join(directory, 'electron-2026-01-01T00-00-00-000Z-10000.json')
		);
		assert.equal(
			await latestReport(directory, undefined, 'chapbook'),
			path.join(
				directory,
				'electron-2026-01-01T00-00-02-000Z-10000-chapbook.json'
			)
		);
	} finally {
		await rm(directory, {force: true, recursive: true});
	}
});

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
		environment: {
			git: {dirty: false, revision: 'abc123'},
			machine: {},
			versions: {}
		},
		fixture: {passageCount: 50_000},
		kind: 'twine-electron-performance',
		schemaVersion: performanceReportSchemaVersion
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
		{name: 'watcher', passed: true},
		{
			detail: '["abc123","abc123"]',
			name: 'git-revision-stable-across-phases',
			passed: true
		},
		{
			detail: '[false,false]',
			name: 'git-dirty-state-stable-across-phases',
			passed: true
		},
		{
			detail: '["default","default"]',
			name: 'fixture-variant-stable-across-phases',
			passed: true
		}
	]);
	assert.equal(merged.diagnostics.startup.length, 1);
	assert.equal(merged.diagnostics.watcher.trace, true);
	assert.equal(merged.test.status, 'passed');
});

test('blocks merged reports that mix fixture variants', () => {
	const common = {
		assertions: [],
		diagnostics: {},
		environment: {
			git: {dirty: false, revision: 'abc123'},
			machine: {},
			versions: {}
		},
		fixture: {passageCount: 10_000},
		kind: 'twine-electron-performance',
		samples: {},
		schemaVersion: performanceReportSchemaVersion
	};
	const merged = mergeRawPerformanceReports([
		{...common, phase: 'edit'},
		{
			...common,
			fixture: {...common.fixture, fixtureVariant: 'chapbook'},
			phase: 'query'
		}
	]);

	assert.deepEqual(
		merged.assertions.find(
			assertion => assertion.name === 'fixture-variant-stable-across-phases'
		),
		{
			detail: '["default","chapbook"]',
			name: 'fixture-variant-stable-across-phases',
			passed: false
		}
	);
});

test('preserves detailed memory diagnostics for focused reports', () => {
	const report = {
		assertions: [],
		diagnostics: {
			bridgeMetrics: [],
			memoryDetail: {owners: {activeEditorCount: 0}},
			startup: []
		},
		environment: {
			git: {dirty: false, revision: 'abc123'},
			machine: {},
			versions: {}
		},
		fixture: {passageCount: 50_000},
		kind: 'twine-electron-performance',
		phase: 'memory-detail',
		samples: {},
		schemaVersion: performanceReportSchemaVersion
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

test('uses backward-compatible default and variant-safe baseline paths', () => {
	const common = {
		environment: {fingerprint: 'machine'},
		fixture: {passageCount: 10_000}
	};

	assert.equal(reportFixtureVariant(common), 'default');
	assert.equal(
		performanceBaselinePath('/results', common),
		path.join('/results', 'baselines', 'machine-10000.json')
	);
	assert.equal(
		performanceBaselinePath('/results', {
			...common,
			fixture: {...common.fixture, fixtureVariant: 'default'}
		}),
		path.join('/results', 'baselines', 'machine-10000.json')
	);
	assert.equal(
		performanceBaselinePath('/results', {
			...common,
			fixture: {...common.fixture, fixtureVariant: 'chapbook'}
		}),
		path.join('/results', 'baselines', 'machine-10000-chapbook.json')
	);
	assert.throws(
		() =>
			performanceBaselinePath('/results', {
				...common,
				fixture: {...common.fixture, fixtureVariant: '../default'}
			}),
		/Invalid performance fixture variant/
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

test('does not compare timing across fixture variants', () => {
	const result = evaluatePerformanceReport(
		{
			aggregates: {},
			assertions: [],
			environment: {fingerprint: 'same'},
			fixture: {fixtureVariant: 'chapbook'}
		},
		{metrics: {}, regressions: {}},
		{
			aggregates: {},
			environment: {fingerprint: 'same'},
			fixture: {fixtureVariant: 'default'}
		}
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

test('shares the report schema version between writer and validator', async () => {
	const writerSource = await readFile(
		new URL('../../e2e/electron-performance.spec.ts', import.meta.url),
		'utf8'
	);

	assert.equal(performanceReportSchemaVersion, 2);
	assert.equal(
		validatorPerformanceReportSchemaVersion,
		performanceReportSchemaVersion
	);
	assert.match(
		writerSource,
		/import \{performanceReportSchemaVersion\} from '\.\.\/benchmarks\/performance-report-schema\.mjs';/
	);
	assert.match(writerSource, /schemaVersion: performanceReportSchemaVersion/);
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
		schemaVersion: performanceReportSchemaVersion,
		test: {status: 'passed'}
	};

	assert.deepEqual(baselineCandidateErrors(report, budgets), []);
	assert.match(
		baselineCandidateErrors(
			{...report, schemaVersion: performanceReportSchemaVersion - 1},
			budgets
		).join(' '),
		/not a completed performance report/
	);
	assert.match(
		baselineCandidateErrors(report, budgets, {requireClean: true}).join(' '),
		/clean Git revision/
	);
	assert.deepEqual(
		baselineCandidateErrors(
			{
				...report,
				assertions: [
					{
						name: 'git-revision-stable-across-phases',
						passed: true
					},
					{
						name: 'git-dirty-state-stable-across-phases',
						passed: true
					}
				],
				environment: {
					...report.environment,
					git: {dirty: false, revision: 'abc123'}
				}
			},
			budgets,
			{requireClean: true}
		),
		[]
	);
	assert.match(
		baselineCandidateErrors(
			{
				...report,
				environment: {
					...report.environment,
					git: {dirty: false, revision: 'abc123'}
				}
			},
			budgets,
			{requireClean: true}
		).join(' '),
		/git-revision-stable-across-phases/
	);
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
