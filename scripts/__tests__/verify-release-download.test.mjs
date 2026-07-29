import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, test} from 'node:test';

const repositoryRoot = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'../..'
);
const script = join(repositoryRoot, 'scripts/verify-release-download.mjs');
const temporaryRoots = [];

function fixture() {
	const root = mkdtempSync(join(tmpdir(), 'twine-rs-release-download-'));
	const file = join(root, 'Twine-RS-0.2.0-linux-x86_64.AppImage');
	const checksums = join(root, 'SHA256SUMS.txt');
	const contents = 'release bytes\n';
	const hash = createHash('sha256').update(contents).digest('hex');

	writeFileSync(file, contents);
	writeFileSync(checksums, `${hash}  linux/${file.split('/').at(-1)}\n`);
	temporaryRoots.push(root);
	return {checksums, file};
}

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) {
		rmSync(root, {force: true, recursive: true});
	}
});

test('verifies a flattened GitHub Release download by basename', () => {
	const {checksums, file} = fixture();
	const result = spawnSync(process.execPath, [script, checksums, file], {
		encoding: 'utf8'
	});

	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /matches SHA256SUMS\.txt/);
});

test('rejects a release download whose bytes changed', () => {
	const {checksums, file} = fixture();

	writeFileSync(file, 'tampered\n');
	const result = spawnSync(process.execPath, [script, checksums, file], {
		encoding: 'utf8'
	});

	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /SHA-256 mismatch/);
});
