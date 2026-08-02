import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {
	classifyChangedPaths,
	isSafeDocumentationPath
} from '../classify-packaged-changes.mjs';

const repositoryRoot = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'../..'
);

test('safe documentation-only paths may skip native packaging', () => {
	for (const path of [
		'README.md',
		'CONTRIBUTING.md',
		'docs/architecture/overview.md',
		'docs/product/screenshot.png'
	]) {
		assert.equal(isSafeDocumentationPath(path), true, path);
	}
	assert.deepEqual(
		classifyChangedPaths(['README.md', 'docs/architecture/overview.md']),
		{nativeRequired: false, reason: 'safe-documentation-only'}
	);
});

test('release records and release policy always require native evidence', () => {
	for (const path of [
		'CHANGELOG.md',
		'RELEASING.md',
		'docs/releases/README.md',
		'docs/releases/plans/v1.2.3.json'
	]) {
		assert.equal(isSafeDocumentationPath(path), false, path);
		assert.equal(classifyChangedPaths([path]).nativeRequired, true, path);
	}
});

test('source, workflow, dependency, and mixed changes require native packaging', () => {
	for (const paths of [
		['src/app.ts'],
		['package-lock.json'],
		['.github/workflows/quality.yml'],
		['README.md', 'scripts/build-wasm.mjs']
	]) {
		assert.equal(classifyChangedPaths(paths).nativeRequired, true);
	}
});

test('empty and invalid diffs fail closed', () => {
	assert.equal(classifyChangedPaths([]).nativeRequired, true);
	assert.equal(classifyChangedPaths(undefined).nativeRequired, true);
	assert.equal(classifyChangedPaths(['']).nativeRequired, true);
});

test('CLI records native-required instead of trusting an invalid commit range', t => {
	const temporaryRoot = mkdtempSync(join(tmpdir(), 'twine-change-classifier-'));
	const output = join(temporaryRoot, 'output.txt');
	t.after(() => rmSync(temporaryRoot, {force: true, recursive: true}));
	const result = spawnSync(
		process.execPath,
		[
			join(repositoryRoot, 'scripts', 'classify-packaged-changes.mjs'),
			'--base',
			'0'.repeat(40),
			'--head',
			'1'.repeat(40),
			'--output',
			output
		],
		{cwd: repositoryRoot, encoding: 'utf8'}
	);

	assert.equal(result.status, 0, result.stderr);
	assert.match(readFileSync(output, 'utf8'), /native_required=true/);
	assert.match(readFileSync(output, 'utf8'), /reason=empty-or-invalid-diff/);
});
