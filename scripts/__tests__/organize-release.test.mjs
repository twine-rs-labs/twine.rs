import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
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
const organizeScript = join(repositoryRoot, 'scripts/organize-release.mjs');
const {version} = JSON.parse(
	readFileSync(join(repositoryRoot, 'package.json'), 'utf8')
);
const requiredArtifacts = [
	`Twine-RS-${version}-win-x64.exe`,
	`Twine-RS-${version}-mac-x64.dmg`,
	`Twine-RS-${version}-mac-arm64.dmg`,
	`Twine-RS-${version}-linux-x64.AppImage`,
	`Twine-RS-${version}-linux-x64.zip`,
	`Twine-RS-${version}-linux-arm64.AppImage`,
	`Twine-RS-${version}-linux-arm64.zip`
];
const temporaryRoots = [];

function releaseFixture() {
	const root = mkdtempSync(join(tmpdir(), 'twine-rs-organize-release-'));

	temporaryRoots.push(root);
	return root;
}

function runOrganizer(root) {
	return spawnSync(process.execPath, [organizeScript, root], {
		cwd: repositoryRoot,
		encoding: 'utf8'
	});
}

function writeArtifacts(root, artifacts = requiredArtifacts) {
	for (const artifact of artifacts) {
		writeFileSync(join(root, artifact), `fixture:${artifact}\n`);
	}
}

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) {
		rmSync(root, {force: true, recursive: true});
	}
});

test('rejects a missing or duplicate target before mutating release inputs', () => {
	const root = releaseFixture();
	const incomplete = requiredArtifacts.slice(0, -1);

	writeArtifacts(root, incomplete);
	writeFileSync(
		join(root, requiredArtifacts[0].replace(/\.exe$/, ' (1).exe')),
		'duplicate\n'
	);
	writeFileSync(join(root, 'builder-debug.yml'), 'debug\n');
	mkdirSync(join(root, 'linux-unpacked'));
	writeFileSync(join(root, 'linux-unpacked', 'twine-rs'), 'scratch\n');

	const before = readdirSync(root, {recursive: true}).sort();
	const result = runOrganizer(root);

	assert.equal(result.status, 1);
	assert.match(result.stderr, /missing linux-arm64\.zip/);
	assert.match(result.stderr, /unexpected or duplicate artifact input/);
	assert.match(result.stderr, /win-x64 \(1\)\.exe/);
	assert.deepEqual(readdirSync(root, {recursive: true}).sort(), before);
	assert.equal(existsSync(join(root, 'SHA256SUMS.txt')), false);
	assert.equal(existsSync(join(root, 'WHICH TO DOWNLOAD.md')), false);
});

test('organizes and checksums exactly one complete desktop artifact matrix', () => {
	const root = releaseFixture();

	writeArtifacts(root);
	writeFileSync(join(root, 'builder-debug.yml'), 'debug\n');
	mkdirSync(join(root, 'linux-unpacked'));
	writeFileSync(join(root, 'linux-unpacked', 'twine-rs'), 'scratch\n');

	const result = runOrganizer(root);

	assert.equal(result.status, 0, result.stderr);
	assert.equal(existsSync(join(root, 'builder-debug.yml')), false);
	assert.equal(existsSync(join(root, 'linux-unpacked')), false);
	assert.equal(existsSync(join(root, 'windows', requiredArtifacts[0])), true);
	assert.equal(existsSync(join(root, 'mac', requiredArtifacts[1])), true);
	assert.equal(existsSync(join(root, 'mac', requiredArtifacts[2])), true);
	assert.equal(existsSync(join(root, 'linux', requiredArtifacts[3])), true);
	assert.equal(
		existsSync(join(root, 'linux', 'alternatives', requiredArtifacts[4])),
		true
	);
	assert.equal(existsSync(join(root, 'linux', requiredArtifacts[5])), true);
	assert.equal(
		existsSync(join(root, 'linux', 'alternatives', requiredArtifacts[6])),
		true
	);

	const checksums = readFileSync(join(root, 'SHA256SUMS.txt'), 'utf8')
		.trim()
		.split('\n');
	const guide = readFileSync(join(root, 'WHICH TO DOWNLOAD.md'), 'utf8');

	assert.equal(checksums.length, requiredArtifacts.length);
	assert.doesNotMatch(guide, /No downloads generated/);
});
