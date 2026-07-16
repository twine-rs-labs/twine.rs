import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
	createMemoryMatrix,
	selectLatestMemoryMatrixReports
} from '../memory-matrix-tools.mjs';

function report(passageCount, privateMiB, knownOwnerMiB) {
	const aggregate = value => ({
		count: 3,
		max: value + 5,
		mean: value,
		min: value - 5,
		p50: value,
		p95: value + 5
	});

	return {
		aggregates: {
			'memory.blink.allocatedMiB': aggregate(50),
			'memory.heap.mainUsedMiB': aggregate(20),
			'memory.heap.rendererUsedMiB': aggregate(80),
			'memory.owner.workerWasmLinearMiB': aggregate(100),
			'memory.private.knownOwnerMiB': aggregate(knownOwnerMiB),
			'memory.private.mainMiB': aggregate(privateMiB * 0.2),
			'memory.private.projectBearingMiB': aggregate(privateMiB),
			'memory.private.rendererMiB': aggregate(privateMiB * 0.8)
		},
		environment: {
			fingerprint: 'machine',
			git: {dirty: false, revision: 'abc123'},
			metricContracts: {memory: 3, memoryAttribution: 1}
		},
		evaluation: {passed: true},
		fixture: {passageCount},
		kind: 'twine-electron-performance',
		phase: 'startup',
		smoke: false,
		test: {status: 'passed'}
	};
}

function withFootprint(item, totalMiB, mallocMiB, vmMiB) {
	const aggregate = value => ({
		count: 3,
		max: value + 1,
		mean: value,
		min: value - 1,
		p50: value,
		p95: value + 1
	});

	item.aggregates['footprint.totalMiB'] = aggregate(totalMiB);
	item.aggregates['footprint.category.malloc-largeMiB'] = aggregate(mallocMiB);
	item.aggregates['footprint.category.untagged-vm-allocateMiB'] =
		aggregate(vmMiB);
	return item;
}

test('creates a repeatable memory-growth decision matrix', () => {
	const matrix = createMemoryMatrix(
		[report(100, 400, 300), report(10_000, 500, 390), report(50_000, 900, 750)],
		{requireClean: true, sourceFiles: ['100.json', '10k.json', '50k.json']}
	);

	assert.equal(matrix.decision.repeatable, true);
	assert.equal(matrix.decision.growthWarrantsOptimization, true);
	assert.equal(matrix.decision.attributionSufficient, true);
	assert.equal(
		matrix.decision.recommendation,
		'optimize-largest-attributed-owner'
	);
	assert.equal(matrix.growth.privateGrowth100To50kMiB, 500);
	assert.equal(matrix.profiles[2].sourceFile, '50k.json');
});

test('rejects dirty reports when a clean matrix is required', () => {
	const reports = [
		report(100, 400, 300),
		report(10_000, 500, 390),
		report(50_000, 900, 500)
	];

	for (const item of reports) {
		item.environment.git.dirty = true;
	}
	assert.throws(
		() => createMemoryMatrix(reports, {requireClean: true}),
		/clean Git revision/
	);
});

test('keeps source files paired with unordered reports', () => {
	const matrix = createMemoryMatrix(
		[report(50_000, 900, 750), report(100, 400, 300), report(10_000, 500, 390)],
		{sourceFiles: ['50k.json', '100.json', '10k.json']}
	);

	assert.equal(matrix.profiles[0].sourceFile, '100.json');
	assert.equal(matrix.profiles[2].sourceFile, '50k.json');
});

test('marks a noisy matrix for repetition instead of holding', () => {
	const reports = [
		report(100, 400, 300),
		report(10_000, 500, 390),
		report(50_000, 900, 750)
	];

	reports[2].aggregates['memory.private.projectBearingMiB'].max = 1100;
	const matrix = createMemoryMatrix(reports);

	assert.equal(matrix.decision.repeatable, false);
	assert.equal(
		matrix.decision.recommendation,
		'repeat-and-stabilize-memory-matrix'
	);
});

test('selects the newest complete same-revision cohort', () => {
	const candidate = (revision, passageCount, createdAt) => {
		const item = report(passageCount, 400, 300);

		item.createdAt = createdAt;
		item.environment.git.revision = revision;
		return {file: `${revision}-${passageCount}.json`, report: item};
	};
	const selected = selectLatestMemoryMatrixReports([
		candidate('old', 100, '2026-01-01T00:00:00.000Z'),
		candidate('old', 10_000, '2026-01-01T00:01:00.000Z'),
		candidate('old', 50_000, '2026-01-01T00:02:00.000Z'),
		candidate('partial', 100, '2026-02-01T00:00:00.000Z')
	]);

	assert.deepEqual(
		selected.map(item => item.report.fixture.passageCount),
		[100, 10_000, 50_000]
	);
	assert.ok(
		selected.every(item => item.report.environment.git.revision === 'old')
	);
});

test('uses de-duplicated footprint categories when logical owners are incomplete', () => {
	const matrix = createMemoryMatrix([
		withFootprint(report(100, 400, 50), 450, 300, 150),
		withFootprint(report(10_000, 500, 70), 550, 370, 180),
		withFootprint(report(50_000, 900, 100), 950, 650, 300)
	]);

	assert.equal(matrix.decision.logicalAttributionSufficient, false);
	assert.equal(matrix.decision.footprintAttributionAvailable, true);
	assert.equal(matrix.footprint.categoryCoverage, 1);
	assert.equal(
		matrix.decision.recommendation,
		'optimize-largest-footprint-category'
	);
	assert.deepEqual(matrix.footprint.categoryGrowthMiB[0], {
		growthMiB: 350,
		name: 'malloc-largeMiB'
	});
});
