import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, test} from 'node:test';

const repositoryRoot = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'../..'
);
const script = join(repositoryRoot, 'scripts/archive-release.mjs');
const temporaryRoots = [];

function fixture() {
	const root = mkdtempSync(join(tmpdir(), 'twine-rs-release-archive-'));
	const source = join(root, 'release-unit');
	const output = join(root, 'release-evidence.zip');

	mkdirSync(join(source, 'provenance'), {recursive: true});
	writeFileSync(
		join(source, 'artifact-manifest.json'),
		'{"schemaVersion":1}\n'
	);
	writeFileSync(
		join(source, 'provenance', 'target.json'),
		'{"target":"mac"}\n'
	);
	temporaryRoots.push(root);
	return {output, root, source};
}

function run({output, source}) {
	return spawnSync(
		process.execPath,
		[
			script,
			'--source',
			source,
			'--output',
			output,
			'--prefix',
			'Twine-RS-release-evidence'
		],
		{encoding: 'utf8'}
	);
}

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) {
		rmSync(root, {force: true, recursive: true});
	}
});

test('archives a release evidence tree deterministically', () => {
	const releaseFixture = fixture();
	const first = run(releaseFixture);

	assert.equal(first.status, 0, first.stderr);
	const firstBytes = readFileSync(releaseFixture.output);
	const second = run(releaseFixture);

	assert.equal(second.status, 0, second.stderr);
	assert.deepEqual(readFileSync(releaseFixture.output), firstBytes);
});

test('refuses to write the release archive inside its input', () => {
	const releaseFixture = fixture();

	releaseFixture.output = join(releaseFixture.source, 'nested.zip');
	const result = run(releaseFixture);

	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /must not overlap/);
});
