import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {
	parseFixtureSizes,
	performanceFixtureManifest,
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
			{projectPath: 'project', sourcePath: 'source'}
		);

		assert.deepEqual(manifest, {
			assets: ['assets/perf/pixel.svg', 'assets/perf/readme.txt'],
			passageCount: 3,
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
