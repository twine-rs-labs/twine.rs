import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {performanceReportSchemaVersion} from '../performance-report-schema.mjs';
import {
	aggregateSamples,
	baselineCandidateErrors,
	completeElectronPhases,
	currentGitProvenance,
	decideElectronPhaseContinuation,
	evaluatePerformanceReport,
	latestReport,
	isElectronPerformancePhase,
	requiresRefactorPerformancePreflight,
	metricTargetForReport,
	machineFingerprint,
	mergeRawPerformanceReports,
	performanceBaselinePath,
	performanceReportSchemaVersion as validatorPerformanceReportSchemaVersion,
	percentile,
	preserveFirstNonzeroStatus,
	reportFixtureVariant,
	regressionAllowance,
	referenceCandidateErrors,
	validateElectronPhaseReport
} from '../performance-tools.mjs';

function phaseReport(overrides = {}) {
	const attempt = {
		bodyCompleted: true,
		failedInvariantCount: 0,
		retry: 0,
		status: 'passed'
	};

	return {
		assertions: [{name: 'measured-invariant', passed: true}],
		environment: {
			fingerprint: 'machine',
			git: {
				dirty: false,
				revision: 'abc123',
				worktreeFingerprint: 'worktree-one'
			}
		},
		fixture: {fixtureVariant: 'default', passageCount: 100},
		kind: 'twine-electron-performance',
		measurement: {
			attempts: [attempt],
			bodyCompleted: true,
			failedInvariantCount: 0
		},
		phase: 'startup',
		samples: {'startup.shellMs': [10]},
		schemaVersion: performanceReportSchemaVersion,
		test: {status: 'passed'},
		...overrides
	};
}

function validatePhase(report, overrides = {}) {
	return validateElectronPhaseReport(report, {
		fixtureVariant: 'default',
		phase: 'startup',
		size: 100,
		...overrides
	});
}

test('fingerprints tracked, staged, and untracked worktree contents', async () => {
	const directory = await mkdtemp(path.join(tmpdir(), 'twine-perf-git-'));
	const git = args => execFileSync('git', args, {cwd: directory});

	try {
		git(['init', '--quiet']);
		git(['config', 'user.email', 'performance-test@example.invalid']);
		git(['config', 'user.name', 'Performance Test']);
		await writeFile(path.join(directory, 'tracked.txt'), 'one\n');
		git(['add', 'tracked.txt']);
		git(['commit', '--quiet', '-m', 'fixture']);
		const clean = await currentGitProvenance(directory);

		await writeFile(path.join(directory, 'tracked.txt'), 'two\n');
		const unstaged = await currentGitProvenance(directory);

		git(['add', 'tracked.txt']);
		const staged = await currentGitProvenance(directory);

		await writeFile(path.join(directory, 'untracked.txt'), 'aaa\n');
		const untrackedOne = await currentGitProvenance(directory);
		await writeFile(path.join(directory, 'untracked.txt'), 'bbb\n');
		const untrackedTwo = await currentGitProvenance(directory);

		assert.equal(clean.dirty, false);
		assert.equal(unstaged.dirty, true);
		assert.notEqual(clean.worktreeFingerprint, unstaged.worktreeFingerprint);
		assert.notEqual(unstaged.worktreeFingerprint, staged.worktreeFingerprint);
		assert.notEqual(
			untrackedOne.worktreeFingerprint,
			untrackedTwo.worktreeFingerprint
		);
	} finally {
		await rm(directory, {force: true, recursive: true});
	}
});

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
			git: {
				dirty: false,
				revision: 'abc123',
				worktreeFingerprint: 'worktree-one'
			},
			machine: {},
			versions: {}
		},
		fixture: {passageCount: 50_000},
		kind: 'twine-electron-performance',
		measurement: {bodyCompleted: true},
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
			detail: '["worktree-one","worktree-one"]',
			name: 'git-worktree-state-stable-across-phases',
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
	assert.equal(merged.measurement, undefined);
});

test('continues after valid passing and assertion-failed phase reports', () => {
	const passedValidation = validatePhase(phaseReport());

	assert.equal(passedValidation.valid, true);
	assert.deepEqual(
		decideElectronPhaseContinuation({
			exitCode: 0,
			reportValidation: passedValidation
		}),
		{continueRun: true, status: 'passed', usable: true}
	);

	const assertionValidation = validatePhase(
		phaseReport({
			assertions: [{name: 'measured-invariant', passed: false}],
			measurement: {
				attempts: [
					{
						bodyCompleted: true,
						failedInvariantCount: 1,
						failureKind: 'assertion',
						retry: 0,
						status: 'passed'
					}
				],
				bodyCompleted: true,
				failedInvariantCount: 1,
				failureKind: 'assertion'
			}
		})
	);
	const decision = decideElectronPhaseContinuation({
		exitCode: 0,
		reportValidation: assertionValidation
	});

	assert.equal(assertionValidation.valid, true);
	assert.equal(decision.continueRun, true);
	assert.equal(decision.failureKind, 'assertion');
	assert.equal(decision.usable, true);
});

test('fail-fast stops after a completed assertion failure', () => {
	const reportValidation = validatePhase(
		phaseReport({
			assertions: [{name: 'measured-invariant', passed: false}],
			measurement: {
				attempts: [
					{
						bodyCompleted: true,
						failedInvariantCount: 1,
						failureKind: 'assertion',
						retry: 0,
						status: 'passed'
					}
				],
				bodyCompleted: true,
				failedInvariantCount: 1,
				failureKind: 'assertion'
			}
		})
	);
	const decision = decideElectronPhaseContinuation({
		exitCode: 0,
		failFast: true,
		reportValidation
	});

	assert.equal(decision.continueRun, false);
	assert.equal(decision.failureKind, 'assertion');
	assert.equal(decision.usable, true);
});

test('rejects missing, malformed, mismatched, and unstable phase reports', () => {
	assert.equal(validatePhase(undefined).valid, false);
	assert.match(
		validatePhase(
			phaseReport({samples: {'startup.shellMs': ['ten']}})
		).errors.join(' '),
		/malformed/
	);
	assert.match(
		validatePhase(
			phaseReport({
				fixture: {fixtureVariant: 'chapbook', passageCount: 50_000},
				phase: 'edit'
			})
		).errors.join(' '),
		/identifies edit|passages|fixture variant/
	);
	assert.match(
		validatePhase(phaseReport(), {
			git: {
				dirty: false,
				revision: 'abc123',
				worktreeFingerprint: 'worktree-two'
			}
		}).errors.join(' '),
		/Git revision or worktree state changed/
	);
});

test('rejects null assertion detail instead of weakening the phase schema', () => {
	const validation = validatePhase(
		phaseReport({
			assertions: [{detail: null, name: 'measured-invariant', passed: true}]
		})
	);

	assert.equal(validation.valid, false);
	assert.match(validation.errors.join(' '), /assertions are malformed/);
});

test('rejects completed timed-out and interrupted tests as infrastructure', () => {
	for (const status of ['timedOut', 'interrupted']) {
		const reportValidation = validatePhase(
			phaseReport({
				measurement: {
					attempts: [
						{
							bodyCompleted: true,
							failedInvariantCount: 0,
							failureKind: 'infrastructure',
							retry: 0,
							status
						}
					],
					bodyCompleted: true,
					failedInvariantCount: 0,
					failureKind: 'infrastructure'
				},
				test: {status}
			})
		);
		const decision = decideElectronPhaseContinuation({
			exitCode: 0,
			reportValidation
		});

		assert.equal(reportValidation.valid, true);
		assert.equal(decision.continueRun, false);
		assert.equal(decision.failureKind, 'infrastructure');
		assert.equal(decision.usable, false);
	}
});

test('treats every nonzero Playwright exit as infrastructure', () => {
	for (const reportValidation of [
		validatePhase(phaseReport()),
		validatePhase(
			phaseReport({
				assertions: [{name: 'measured-invariant', passed: false}],
				measurement: {
					attempts: [
						{
							bodyCompleted: true,
							failedInvariantCount: 1,
							failureKind: 'assertion',
							retry: 0,
							status: 'passed'
						}
					],
					bodyCompleted: true,
					failedInvariantCount: 1,
					failureKind: 'assertion'
				}
			})
		)
	]) {
		const decision = decideElectronPhaseContinuation({
			exitCode: 7,
			reportValidation
		});

		assert.equal(decision.failureKind, 'infrastructure');
		assert.equal(decision.usable, false);
		assert.match(decision.reason, /Playwright process exited nonzero/);
	}
});

test('rejects retry histories containing infrastructure attempts', () => {
	for (const finalFailure of [undefined, 'assertion']) {
		const failedInvariantCount = finalFailure === 'assertion' ? 1 : 0;
		const reportValidation = validatePhase(
			phaseReport({
				assertions: [
					{name: 'measured-invariant', passed: failedInvariantCount === 0}
				],
				measurement: {
					attempts: [
						{
							bodyCompleted: true,
							failedInvariantCount: 0,
							failureKind: 'infrastructure',
							retry: 0,
							status: 'failed'
						},
						{
							bodyCompleted: true,
							failedInvariantCount,
							failureKind: finalFailure,
							retry: 1,
							status: 'passed'
						}
					],
					bodyCompleted: true,
					failedInvariantCount,
					failureKind: finalFailure
				}
			})
		);
		const decision = decideElectronPhaseContinuation({
			exitCode: 0,
			reportValidation
		});

		assert.equal(reportValidation.valid, true);
		assert.equal(decision.failureKind, 'infrastructure');
		assert.equal(decision.usable, false);
	}
});

test('requires retry histories to start at zero and remain consecutive', () => {
	const report = phaseReport();

	report.measurement.attempts[0].retry = 1;
	assert.match(
		validatePhase(report).errors.join(' '),
		/attempt 0 is malformed/
	);
});

test('rejects a non-final retry recorded before teardown as passing', () => {
	const report = phaseReport({
		measurement: {
			attempts: [
				{
					bodyCompleted: true,
					failedInvariantCount: 0,
					retry: 0,
					status: 'passed'
				},
				{
					bodyCompleted: true,
					failedInvariantCount: 0,
					retry: 1,
					status: 'passed'
				}
			],
			bodyCompleted: true,
			failedInvariantCount: 0
		}
	});
	const reportValidation = validatePhase(report);
	const decision = decideElectronPhaseContinuation({
		exitCode: 0,
		reportValidation
	});

	assert.match(
		reportValidation.errors.join(' '),
		/non-final retry attempt 0 hides an infrastructure failure/
	);
	assert.equal(decision.continueRun, false);
	assert.equal(decision.failureKind, 'infrastructure');
	assert.equal(decision.usable, false);
});

test('aborts if the source fixture changes during a phase', () => {
	const decision = decideElectronPhaseContinuation({
		exitCode: 0,
		reportValidation: validatePhase(phaseReport()),
		sourceFixtureUnchanged: false
	});

	assert.equal(decision.continueRun, false);
	assert.equal(decision.failureKind, 'infrastructure');
	assert.equal(decision.usable, false);
});

test('aborts if the production build changes during a phase', () => {
	const decision = decideElectronPhaseContinuation({
		exitCode: 0,
		productionBuildUnchanged: false,
		reportValidation: validatePhase(phaseReport())
	});

	assert.equal(decision.continueRun, false);
	assert.equal(decision.failureKind, 'infrastructure');
	assert.equal(decision.usable, false);
});

test('preserves the first nonzero phase status', () => {
	assert.equal(preserveFirstNonzeroStatus(0, 2), 2);
	assert.equal(preserveFirstNonzeroStatus(2, 1), 2);
	assert.equal(preserveFirstNonzeroStatus(0, 0), 0);
});

test('keeps a fully collected assertion-failed suite baseline-ineligible', () => {
	const phases = ['startup', 'edit', 'query', 'graph', 'watcher'];
	const reports = phases.map(phase => {
		const assertionFailed = phase === 'edit';
		const failedInvariantCount = assertionFailed ? 1 : 0;

		return phaseReport({
			assertions: [{name: `${phase}-invariant`, passed: !assertionFailed}],
			measurement: {
				attempts: [
					{
						bodyCompleted: true,
						failedInvariantCount,
						failureKind: assertionFailed ? 'assertion' : undefined,
						retry: 0,
						status: 'passed'
					}
				],
				bodyCompleted: true,
				failedInvariantCount,
				failureKind: assertionFailed ? 'assertion' : undefined
			},
			phase
		});
	});
	const phaseResults = Object.fromEntries(
		phases.map(phase => [
			phase,
			{status: phase === 'edit' ? 'failed' : 'passed'}
		])
	);
	const merged = mergeRawPerformanceReports(reports, phaseResults);

	merged.aggregates = {};
	merged.evaluation = {passed: false};
	assert.equal(merged.phase, 'all');
	assert.equal(merged.test.status, 'failed');
	assert.equal(merged.measurement, undefined);
	assert.match(
		baselineCandidateErrors(merged, {metrics: {}}).join(' '),
		/passing all-phase report|Missing passing phase: edit/
	);
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

test('uses size-specific blocking targets and rejects required missing metrics', () => {
	const budget = {
		baselineContract: 'editAttribution',
		category: 'electron',
		enforceTarget: true,
		stat: 'p95',
		targets: {10000: 250, 50000: 1000}
	};
	const report = {
		aggregates: {'refactor.summaryGenerationMs': {p95: 251}},
		assertions: [],
		fixture: {passageCount: 10000},
		phase: 'refactor'
	};

	assert.equal(metricTargetForReport(report, budget), 250);
	const result = evaluatePerformanceReport(
		report,
		{metrics: {'refactor.summaryGenerationMs': budget}, regressions: {}},
		undefined
	);
	assert.equal(result.passed, false);
	assert.equal(result.checks[0].limit, 250);
	const missing = evaluatePerformanceReport(
		{...report, aggregates: {}},
		{metrics: {'refactor.summaryGenerationMs': budget}, regressions: {}},
		undefined
	);
	assert.equal(missing.passed, false);
	assert.equal(missing.checks[0].status, 'missing');
});

test('accepts the focused refactor phase without expanding all-phase coverage', () => {
	assert.equal(isElectronPerformancePhase('refactor'), true);
	assert.equal(isElectronPerformancePhase('all'), true);
	assert.equal(isElectronPerformancePhase('refactor-all'), false);
	assert.equal(completeElectronPhases.includes('refactor'), false);
	assert.equal(requiresRefactorPerformancePreflight('refactor'), true);
	assert.equal(requiresRefactorPerformancePreflight('all'), false);
	assert.equal(requiresRefactorPerformancePreflight('query'), false);
});

test('generated refactor fixture targets resolve and have a standard backlink', async () => {
	for (const size of [10_000, 50_000]) {
		const root = path.resolve('benchmarks/fixtures/generated');
		const manifest = JSON.parse(
			await readFile(
				path.join(root, 'projects', `story-${size}.perf.json`),
				'utf8'
			)
		);
		const source = JSON.parse(
			await readFile(
				path.join(root, 'sources', `story-${size}.story.json`),
				'utf8'
			)
		);
		const target = manifest.refactorTarget;
		assert.ok(target);
		const passage = source.passages.find(item => item.id === target.passageId);
		assert.equal(passage?.name, target.beforeName);
		assert.ok(
			source.passages.some(item =>
				item.text.includes(`->${target.beforeName}]]`)
			)
		);
	}
});

test('blocks refactor typing when a matching accepted baseline lacks edit paint', () => {
	const result = evaluatePerformanceReport(
		{
			aggregates: {'refactor.editPaintMs': {p95: 20}},
			assertions: [],
			environment: {fingerprint: 'same', metricContracts: {editAttribution: 1}},
			phase: 'refactor'
		},
		{
			metrics: {
				'refactor.editPaintMs': {
					baselineContract: 'editAttribution',
					baselineMetric: 'edit.paintMs',
					baselineOffset: 5,
					category: 'electron',
					enforceTarget: true,
					stat: 'p95'
				}
			},
			regressions: {electron: {floor: 5, percent: 15}}
		},
		{
			aggregates: {},
			environment: {
				fingerprint: 'same',
				git: {dirty: false},
				metricContracts: {editAttribution: 1}
			},
			evaluation: {passed: true},
			phase: 'all',
			test: {status: 'passed'}
		}
	);

	assert.equal(result.passed, false);
	assert.match(result.checks[0].detail, /baseline metric is absent/);
});

test('requires a clean accepted matching baseline for baseline-relative gates', () => {
	const budget = {
		baselineContract: 'editAttribution',
		baselineMetric: 'edit.paintMs',
		baselineOffset: 5,
		category: 'electron',
		enforceTarget: true,
		stat: 'p95'
	};
	const report = {
		aggregates: {'refactor.editPaintMs': {p95: 20}},
		assertions: [],
		environment: {
			fingerprint: 'same',
			git: {
				dirty: false,
				revision: 'refactor-revision',
				worktreeFingerprint: 'refactor-worktree'
			},
			metricContracts: {editAttribution: 2}
		},
		phase: 'refactor'
	};
	const accepted = {
		aggregates: {'edit.paintMs': {p95: 16}},
		environment: {
			fingerprint: 'same',
			git: {dirty: false},
			metricContracts: {editAttribution: 1}
		},
		evaluation: {passed: true},
		phase: 'all',
		test: {status: 'passed'}
	};
	const evaluate = baseline =>
		evaluatePerformanceReport(
			report,
			{metrics: {'refactor.editPaintMs': budget}, regressions: {}},
			baseline
		);

	assert.equal(evaluate(undefined).passed, false);
	assert.equal(
		evaluate({
			...accepted,
			environment: {...accepted.environment, fingerprint: 'other'}
		}).passed,
		false
	);
	assert.equal(
		evaluate({
			...accepted,
			environment: {...accepted.environment, metricContracts: {}}
		}).passed,
		false
	);
	assert.equal(
		evaluate({
			...accepted,
			environment: {...accepted.environment, git: {dirty: true}}
		}).passed,
		false
	);
	assert.equal(
		evaluate({...accepted, evaluation: {passed: false}}).passed,
		false
	);
	assert.equal(
		evaluate({
			...accepted,
			environment: {
				...accepted.environment,
				metricContracts: {editAttribution: 3}
			}
		}).passed,
		false
	);
	assert.equal(evaluate({...accepted, aggregates: {}}).passed, false);
	const matchingOne = evaluatePerformanceReport(
		{
			...report,
			environment: {
				fingerprint: 'same',
				git: report.environment.git,
				metricContracts: {editAttribution: 1}
			}
		},
		{metrics: {'refactor.editPaintMs': budget}, regressions: {}},
		{
			...accepted,
			environment: {
				...accepted.environment,
				metricContracts: {editAttribution: 1}
			}
		}
	);
	assert.equal(matchingOne.passed, true);
	const happy = evaluate({
		...accepted,
		environment: {
			...accepted.environment,
			metricContracts: {editAttribution: 2}
		}
	});
	assert.equal(happy.passed, true);
	assert.equal(
		happy.checks.some(check => check.kind === 'baseline-relative'),
		true
	);
});

test('blocks dirty refactor evidence while keeping dirty diagnostic reports useful', () => {
	const cleanGit = {
		dirty: false,
		revision: 'clean-revision',
		worktreeFingerprint: 'clean-worktree'
	};
	const dirtyGit = {...cleanGit, dirty: true};
	const budgets = {metrics: {}, regressions: {}};
	const dirtyRefactor = {
		aggregates: {},
		assertions: [],
		environment: {fingerprint: 'machine', git: dirtyGit},
		phase: 'refactor'
	};
	const dirtyEvaluation = evaluatePerformanceReport(
		dirtyRefactor,
		budgets,
		undefined
	);

	assert.equal(dirtyEvaluation.passed, false);
	assert.deepEqual(
		dirtyEvaluation.checks.find(
			check => check.name === 'refactor-clean-git-provenance'
		),
		{
			blocking: true,
			detail:
				'Reviewed-refactor evidence requires a clean, identified Git worktree.',
			kind: 'provenance',
			name: 'refactor-clean-git-provenance',
			passed: false
		}
	);
	assert.equal(
		evaluatePerformanceReport(
			{...dirtyRefactor, environment: {fingerprint: 'machine', git: cleanGit}},
			budgets,
			undefined
		).passed,
		true
	);
	assert.equal(
		evaluatePerformanceReport(
			{...dirtyRefactor, phase: 'diagnostic'},
			budgets,
			undefined
		).passed,
		true
	);

	const invariant = {
		blocking: true,
		kind: 'invariant',
		name: 'all-phase-complete',
		passed: true
	};
	const refactorCandidate = {
		aggregates: {},
		assertions: [{name: invariant.name, passed: true}],
		environment: {fingerprint: 'machine', git: dirtyGit},
		evaluation: {checks: [invariant], passed: true},
		kind: 'twine-electron-performance',
		phase: 'all',
		phases: Object.fromEntries(
			[...completeElectronPhases, 'refactor'].map(phase => [
				phase,
				{status: 'passed'}
			])
		),
		schemaVersion: performanceReportSchemaVersion,
		smoke: false,
		test: {status: 'passed'}
	};
	assert.match(
		referenceCandidateErrors(refactorCandidate, budgets).join(' '),
		/Refactor candidate\/reference evidence requires a clean, identified Git worktree/
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
		assertions: [{name: 'measured-invariant', passed: true}],
		evaluation: {
			checks: [
				{
					blocking: true,
					kind: 'invariant',
					name: 'measured-invariant',
					passed: true
				}
			],
			passed: true
		},
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
					},
					{
						name: 'git-worktree-state-stable-across-phases',
						passed: true
					}
				],
				evaluation: {
					checks: [
						'git-revision-stable-across-phases',
						'git-dirty-state-stable-across-phases',
						'git-worktree-state-stable-across-phases'
					].map(name => ({
						blocking: true,
						kind: 'invariant',
						name,
						passed: true
					})),
					passed: true
				},
				environment: {
					...report.environment,
					git: {
						dirty: false,
						revision: 'abc123',
						worktreeFingerprint: 'worktree-one'
					}
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
					git: {
						dirty: false,
						revision: 'abc123',
						worktreeFingerprint: 'worktree-one'
					}
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

test('allows complete failed-regression reports as references but not baselines', () => {
	const budgets = {
		metrics: {
			'memory.residentMiB': {category: 'memory', stat: 'p50', target: 600}
		}
	};
	const regression = {
		actual: 1148.90625,
		baseline: 1044.125,
		blocking: true,
		kind: 'regression',
		limit: 1148.5375,
		name: 'memory.residentMiB',
		passed: false
	};
	const invariant = {
		blocking: true,
		kind: 'invariant',
		name: 'measured-invariant',
		passed: true
	};
	const report = {
		aggregates: {'memory.residentMiB': {p50: regression.actual}},
		assertions: [{name: 'measured-invariant', passed: true}],
		environment: {fingerprint: 'machine'},
		evaluation: {checks: [invariant, regression], passed: false},
		kind: 'twine-electron-performance',
		phase: 'all',
		phases: Object.fromEntries(
			completeElectronPhases.map(phase => [phase, {status: 'passed'}])
		),
		schemaVersion: performanceReportSchemaVersion,
		smoke: false,
		test: {status: 'passed'}
	};

	assert.deepEqual(referenceCandidateErrors(report, budgets), []);
	assert.match(
		baselineCandidateErrors(report, budgets).join(' '),
		/blocking evaluation failures/
	);
	assert.match(
		referenceCandidateErrors(
			{
				...report,
				assertions: [{name: 'measured-invariant', passed: false}],
				evaluation: {
					checks: [{...invariant, passed: false}],
					passed: false
				}
			},
			budgets
		).join(' '),
		/structurally passing invariants.*all structural invariants must pass/
	);
	assert.match(
		referenceCandidateErrors(
			{...report, phases: {...report.phases, watcher: {status: 'failed'}}},
			budgets
		).join(' '),
		/Missing passing phase: watcher/
	);
});
