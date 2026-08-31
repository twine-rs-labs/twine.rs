import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {
	chapbookFixtureVariableLineCount,
	chapbookPerformancePassageText,
	parseFixtureSizes,
	parseFixtureVariant,
	performanceFixtureManifest,
	performanceFixtureVariantRoot,
	performanceFixtureVariants,
	treeMetadataFingerprint,
	writePerformanceFixtureAssets
} from '../fixture-tools.mjs';

test('parses deterministic fixture sizes', () => {
	assert.deepEqual(parseFixtureSizes([]), [10_000, 50_000]);
	assert.deepEqual(parseFixtureSizes(['--sizes', '100,10000']), [100, 10_000]);
	assert.throws(
		() => parseFixtureSizes(['--sizes', 'invalid']),
		/positive integer/
	);
});

test('parses and isolates named fixture variants', () => {
	assert.equal(parseFixtureVariant([]), 'default');
	assert.equal(parseFixtureVariant(['--variant', 'chapbook']), 'chapbook');
	assert.deepEqual(performanceFixtureVariants.chapbook, {
		storyFormat: 'Chapbook',
		storyFormatVersion: '2.3.1'
	});
	assert.equal(
		performanceFixtureVariantRoot('/fixtures', 'default'),
		'/fixtures'
	);
	assert.equal(
		performanceFixtureVariantRoot('/fixtures', 'chapbook'),
		path.join('/fixtures', 'variants', 'chapbook')
	);
	assert.throws(
		() => parseFixtureVariant(['--variant', 'unknown']),
		/--variant must be one of/
	);
	assert.throws(
		() => performanceFixtureVariantRoot('/fixtures', 'unknown'),
		/Unknown performance fixture variant/
	);
});

test('builds a deterministic large multiline Chapbook start passage', () => {
	const original = 'Original body with [[Next->Passage 000002]].';
	const passage = chapbookPerformancePassageText(original);
	const lines = passage.split('\n');

	assert.equal(lines.length, chapbookFixtureVariableLineCount + 2);
	assert.equal(lines[0], 'benchmark variable 0001: value 0001');
	assert.equal(
		lines[chapbookFixtureVariableLineCount - 1],
		'benchmark variable 4096: value 4096'
	);
	assert.equal(lines[chapbookFixtureVariableLineCount], original);
	assert.equal(lines.at(-1), '--');
	assert.equal(lines.filter(line => line === '--').length, 1);
});

test('writes deterministic assets and manifest metadata', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'twine-perf-fixture-'));

	try {
		await writePerformanceFixtureAssets(root);
		const firstPixel = await readFile(
			path.join(root, 'assets', 'perf', 'pixel.svg'),
			'utf8'
		);
		const manifest = performanceFixtureManifest(
			{passageCount: 3},
			{
				fixtureVariant: 'chapbook',
				projectPath: 'project',
				sourcePath: 'source'
			}
		);

		assert.deepEqual(manifest, {
			assets: ['assets/perf/pixel.svg', 'assets/perf/readme.txt'],
			fixtureVariant: 'chapbook',
			passageCount: 3,
			performanceFixtureMeasurementContractVersion: 4,
			projectPath: 'project',
			sourcePath: 'source'
		});
		assert.match(
			await readFile(path.join(root, 'assets', 'perf', 'pixel.svg'), 'utf8'),
			/<svg/
		);

		await writePerformanceFixtureAssets(root);
		assert.equal(
			await readFile(path.join(root, 'assets', 'perf', 'pixel.svg'), 'utf8'),
			firstPixel
		);
	} finally {
		await rm(root, {force: true, recursive: true});
	}
});

test('detects source fixture metadata changes', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'twine-perf-tree-'));

	try {
		const file = path.join(root, 'fixture.txt');

		await writeFile(file, 'one');
		const before = await treeMetadataFingerprint(root);

		await writeFile(file, 'changed contents');
		assert.notEqual(await treeMetadataFingerprint(root), before);
	} finally {
		await rm(root, {force: true, recursive: true});
	}
});
