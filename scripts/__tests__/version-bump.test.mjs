import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const repositoryRoot = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'../..'
);
const script = join(repositoryRoot, 'scripts/version-bump.mjs');

function dryRun(version) {
	return spawnSync(process.execPath, [script, version, '--dry-run'], {
		cwd: repositoryRoot,
		encoding: 'utf8'
	});
}

test('version bump accepts explicit valid SemVer prerelease versions', () => {
	for (const version of [
		'0.2.0-beta.1',
		'1.0.0-rc.2+build.5',
		'2.3.4-preview.20260723'
	]) {
		const result = dryRun(version);

		assert.equal(result.status, 0, result.stderr);
		assert.ok(result.stdout.includes(`-> ${version}`));
	}
});

test('version bump rejects invalid prerelease numeric identifiers', () => {
	const result = dryRun('0.2.0-beta.01');

	assert.equal(result.status, 1);
	assert.match(result.stderr, /Expected a valid SemVer version/);
});
