import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
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
const require = createRequire(import.meta.url);
const {
	distributionArtifactPath,
	localArtifactNotice,
	localArtifactNoticeName,
	profiles,
	requiredArtifactMatrix,
	targetManifestName
} = require('../release-profile.cjs');
const organizeScript = join(repositoryRoot, 'scripts/organize-release.mjs');
const {version} = JSON.parse(
	readFileSync(join(repositoryRoot, 'package.json'), 'utf8')
);
const targets = [
	{arch: 'x64', platform: 'win'},
	{arch: 'x64', platform: 'mac'},
	{arch: 'arm64', platform: 'mac'},
	{arch: 'x64', platform: 'linux'},
	{arch: 'arm64', platform: 'linux'}
];
const temporaryRoots = [];

function releaseFixture() {
	const root = mkdtempSync(join(tmpdir(), 'twine-rs-organize-release-'));
	const source = join(root, 'incoming');
	const output = join(root, 'assembled');

	mkdirSync(source);
	temporaryRoots.push(root);
	return {output, root, source};
}

function sha256(filePath) {
	return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function inspection(profile, platform) {
	if (platform === 'linux') {
		return {
			notarization: 'not-applicable',
			signing: 'not-applicable',
			signingScope: 'not-applicable',
			stapling: 'not-applicable'
		};
	}

	if (profile === profiles.signed && platform === 'win') {
		return {
			notarization: 'not-applicable',
			signerSubject: 'CN=Twine RS',
			signerThumbprint: 'A'.repeat(40),
			signing: 'authenticode',
			signingScope: 'installer',
			stapling: 'not-applicable',
			timestamped: true
		};
	}

	if (profile === profiles.signed) {
		return {
			authority: 'Developer ID Application: Twine RS (TEAM123)',
			identifier: 'rs.twine.app',
			notarization: 'notarized',
			signerTeamId: 'TEAM123',
			signing: 'developer-id',
			signingScope: 'app-inside-dmg',
			stapling: 'stapled'
		};
	}

	return {
		notarization: platform === 'mac' ? 'not-notarized' : 'not-applicable',
		signing: platform === 'mac' ? 'ad-hoc' : 'unsigned',
		signingScope: platform === 'mac' ? 'app-inside-dmg' : 'installer',
		stapling: platform === 'mac' ? 'not-stapled' : 'not-applicable'
	};
}

function writeInputs(source, profile, {sourceTree = 'clean'} = {}) {
	const matrix = requiredArtifactMatrix(version, profile);

	if (profile === profiles.local) {
		writeFileSync(join(source, localArtifactNoticeName), localArtifactNotice);
	}

	for (const artifact of matrix) {
		writeFileSync(
			join(source, artifact.fileName),
			`fixture:${artifact.fileName}\n`
		);
	}

	for (const target of targets) {
		const targetArtifacts = matrix.filter(
			artifact =>
				artifact.platform === target.platform && artifact.arch === target.arch
		);
		const manifest = {
			schemaVersion: 1,
			profile,
			applicationVersion: version,
			sourceCommit: 'a'.repeat(40),
			sourceTree,
			buildDate: '2026-07-23T00:00:00.000Z',
			platform: target.platform,
			architecture: target.arch,
			artifacts: targetArtifacts.map(artifact => {
				const artifactPath = join(source, artifact.fileName);

				return {
					fileName: artifact.fileName,
					sha256: sha256(artifactPath),
					size: statSync(artifactPath).size,
					...inspection(profile, target.platform)
				};
			})
		};

		writeFileSync(
			join(source, targetManifestName(version, target.platform, target.arch)),
			`${JSON.stringify(manifest, null, 2)}\n`
		);
	}
}

function runOrganizer(
	{output, source},
	profile,
	{acknowledgeUnsigned = true, localTestBundle = false} = {}
) {
	const args = [
		organizeScript,
		'--profile',
		profile,
		'--source',
		source,
		'--output',
		output
	];

	if (localTestBundle) {
		args.push('--local-test-bundle');
	}

	const env = {...process.env};
	if (profile === profiles.unsigned && acknowledgeUnsigned) {
		env.ALLOW_UNSIGNED_DISTRIBUTION = '1';
	} else {
		delete env.ALLOW_UNSIGNED_DISTRIBUTION;
	}
	if (profile === profiles.signed) {
		Object.assign(env, {
			APPLE_APP_ID: 'rs.twine.app',
			APPLE_TEAM_ID: 'TEAM123',
			CSC_NAME: 'Developer ID Application: Twine RS (TEAM123)',
			WINDOWS_SIGNER_SHA1: 'A'.repeat(40),
			WINDOWS_SIGNER_SUBJECT: 'CN=Twine RS'
		});
	}

	return spawnSync(process.execPath, args, {
		cwd: repositoryRoot,
		encoding: 'utf8',
		env
	});
}

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) {
		rmSync(root, {force: true, recursive: true});
	}
});

test('local is rejected by distribution assembly', () => {
	const fixture = releaseFixture();
	writeInputs(fixture.source, profiles.local, {sourceTree: 'dirty'});

	const result = runOrganizer(fixture, profiles.local);

	assert.equal(result.status, 1);
	assert.match(
		result.stderr,
		/Distribution assembly rejects the local profile/
	);
	assert.equal(existsSync(fixture.output), false);
});

test('assembly refuses overlapping source and output directories', () => {
	const fixture = releaseFixture();
	writeInputs(fixture.source, profiles.local, {sourceTree: 'dirty'});
	const result = spawnSync(
		process.execPath,
		[
			organizeScript,
			'--profile',
			profiles.local,
			'--local-test-bundle',
			'--source',
			fixture.source,
			'--output',
			fixture.source
		],
		{cwd: repositoryRoot, encoding: 'utf8'}
	);

	assert.equal(result.status, 1);
	assert.match(result.stderr, /must not overlap/);
	assert.ok(
		existsSync(
			join(fixture.source, `Twine-RS-${version}-win-x64.artifact-manifest.json`)
		)
	);
});

test('CI may assemble a clearly labeled local test bundle', () => {
	const fixture = releaseFixture();
	writeInputs(fixture.source, profiles.local, {sourceTree: 'dirty'});

	const result = runOrganizer(fixture, profiles.local, {
		localTestBundle: true
	});

	assert.equal(result.status, 0, result.stderr);
	assert.match(
		readFileSync(join(fixture.output, 'LOCAL-TEST-BUNDLE.txt'), 'utf8'),
		/must not enter release assembly/
	);
	assert.equal(existsSync(join(fixture.output, 'WHICH TO DOWNLOAD.md')), false);
	assert.equal(
		JSON.parse(
			readFileSync(join(fixture.output, 'artifact-manifest.json'), 'utf8')
		).profile,
		profiles.local
	);
});

test('distributable-unsigned assembly requires explicit acknowledgement', () => {
	const fixture = releaseFixture();
	writeInputs(fixture.source, profiles.unsigned);

	const result = runOrganizer(fixture, profiles.unsigned, {
		acknowledgeUnsigned: false
	});

	assert.equal(result.status, 1);
	assert.match(result.stderr, /ALLOW_UNSIGNED_DISTRIBUTION=1/);
	assert.equal(existsSync(fixture.output), false);
});

test('assembles a complete unsigned distribution with warnings and labels', () => {
	const fixture = releaseFixture();
	writeInputs(fixture.source, profiles.unsigned);

	const result = runOrganizer(fixture, profiles.unsigned);

	assert.equal(result.status, 0, result.stderr);
	const files = readdirSync(fixture.output, {recursive: true}).sort();
	const guide = readFileSync(
		join(fixture.output, 'WHICH TO DOWNLOAD.md'),
		'utf8'
	);
	const manifest = JSON.parse(
		readFileSync(join(fixture.output, 'artifact-manifest.json'), 'utf8')
	);

	assert.ok(files.includes(`windows/Twine-RS-${version}-win-x64-unsigned.exe`));
	assert.ok(files.includes(`mac/Twine-RS-${version}-mac-x64-unsigned.dmg`));
	assert.ok(files.includes(`mac/Twine-RS-${version}-mac-arm64-unsigned.dmg`));
	assert.match(guide, /Unsigned distribution warning/);
	assert.match(guide, /SmartScreen may warn or block/);
	assert.match(guide, /unnotarized/);
	assert.match(guide, /not the identity of the publisher/);
	assert.match(
		guide,
		new RegExp(
			`Mac \\(Apple Silicon\\): \`mac/Twine-RS-${version}-mac-arm64-unsigned\\.dmg\``
		)
	);
	assert.match(
		guide,
		new RegExp(
			`Mac \\(Intel\\): \`mac/Twine-RS-${version}-mac-x64-unsigned\\.dmg\``
		)
	);
	assert.match(
		guide,
		new RegExp(
			`Twine-RS-${version}-mac-arm64-unsigned\\.dmg\`: recommended first download; Apple Silicon Mac build`
		)
	);
	assert.match(
		guide,
		new RegExp(
			`Twine-RS-${version}-mac-x64-unsigned\\.dmg\`: recommended first download; Intel Mac build`
		)
	);
	assert.equal(manifest.profile, profiles.unsigned);
	assert.equal(manifest.artifacts.length, 7);
	assert.deepEqual(
		manifest.artifacts.map(artifact => artifact.fileName).sort(),
		requiredArtifactMatrix(version, profiles.unsigned)
			.map(distributionArtifactPath)
			.sort()
	);
	assert.equal(
		manifest.artifacts.find(artifact => artifact.platform === 'mac').signing,
		'ad-hoc'
	);
	assert.equal(
		manifest.artifacts.find(artifact => artifact.platform === 'linux').signing,
		'not-applicable'
	);
});

test('rejects a manifest mismatch before changing existing output', () => {
	const fixture = releaseFixture();
	writeInputs(fixture.source, profiles.unsigned);
	mkdirSync(fixture.output);
	writeFileSync(join(fixture.output, 'sentinel.txt'), 'preserve\n');
	const manifestPath = join(
		fixture.source,
		targetManifestName(version, 'mac', 'arm64')
	);
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

	manifest.artifacts[0].signing = 'developer-id';
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

	const result = runOrganizer(fixture, profiles.unsigned);

	assert.equal(result.status, 1);
	assert.match(result.stderr, /must record signing as ad-hoc/);
	assert.equal(
		readFileSync(join(fixture.output, 'sentinel.txt'), 'utf8'),
		'preserve\n'
	);
});

test('signed bundle records trusted signing only where applicable', () => {
	const fixture = releaseFixture();
	writeInputs(fixture.source, profiles.signed);

	const result = runOrganizer(fixture, profiles.signed);

	assert.equal(result.status, 0, result.stderr);
	const guide = readFileSync(
		join(fixture.output, 'WHICH TO DOWNLOAD.md'),
		'utf8'
	);
	const manifest = JSON.parse(
		readFileSync(join(fixture.output, 'artifact-manifest.json'), 'utf8')
	);

	assert.match(guide, /trusted native-platform signing where applicable/);
	assert.match(
		guide,
		/Linux native-platform signing is recorded as not-applicable/
	);
	assert.doesNotMatch(guide, /fully signed/i);
	assert.match(
		manifest.trustDefinition,
		/Windows and macOS signed; Linux not-applicable/
	);
});

test('signed assembly rejects an unexpected recorded identity', () => {
	const fixture = releaseFixture();
	writeInputs(fixture.source, profiles.signed);
	const manifestPath = join(
		fixture.source,
		targetManifestName(version, 'win', 'x64')
	);
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

	manifest.artifacts[0].signerSubject = 'CN=Unexpected';
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

	const result = runOrganizer(fixture, profiles.signed);

	assert.equal(result.status, 1);
	assert.match(
		result.stderr,
		/does not match the expected Windows signing identity/
	);
	assert.equal(existsSync(fixture.output), false);
});

test('assembly rejects contradictory Linux and colliding artifact fields', () => {
	const linuxFixture = releaseFixture();
	writeInputs(linuxFixture.source, profiles.signed);
	const linuxManifestPath = join(
		linuxFixture.source,
		targetManifestName(version, 'linux', 'x64')
	);
	const linuxManifest = JSON.parse(readFileSync(linuxManifestPath, 'utf8'));

	linuxManifest.artifacts[0].stapling = 'stapled';
	writeFileSync(
		linuxManifestPath,
		`${JSON.stringify(linuxManifest, null, 2)}\n`
	);

	const linuxResult = runOrganizer(linuxFixture, profiles.signed);

	assert.equal(linuxResult.status, 1);
	assert.match(
		linuxResult.stderr,
		/signing, scope, notarization, and stapling as not-applicable/
	);

	const collisionFixture = releaseFixture();
	writeInputs(collisionFixture.source, profiles.signed);
	const winManifestPath = join(
		collisionFixture.source,
		targetManifestName(version, 'win', 'x64')
	);
	const winManifest = JSON.parse(readFileSync(winManifestPath, 'utf8'));

	winManifest.artifacts[0].platform = 'linux';
	writeFileSync(winManifestPath, `${JSON.stringify(winManifest, null, 2)}\n`);

	const collisionResult = runOrganizer(collisionFixture, profiles.signed);

	assert.equal(collisionResult.status, 1);
	assert.match(collisionResult.stderr, /unexpected platform/);

	const windowsFixture = releaseFixture();
	writeInputs(windowsFixture.source, profiles.unsigned);
	const unsignedWinManifestPath = join(
		windowsFixture.source,
		targetManifestName(version, 'win', 'x64')
	);
	const unsignedWinManifest = JSON.parse(
		readFileSync(unsignedWinManifestPath, 'utf8')
	);

	unsignedWinManifest.artifacts[0].signingScope = 'app-inside-dmg';
	unsignedWinManifest.artifacts[0].notarization = 'notarized';
	unsignedWinManifest.artifacts[0].stapling = 'stapled';
	writeFileSync(
		unsignedWinManifestPath,
		`${JSON.stringify(unsignedWinManifest, null, 2)}\n`
	);

	const windowsResult = runOrganizer(windowsFixture, profiles.unsigned);

	assert.equal(windowsResult.status, 1);
	assert.match(windowsResult.stderr, /installer signing scope/);
});

test('assembly rejects profile-contradicting optional trust fields', () => {
	const signedFixture = releaseFixture();
	writeInputs(signedFixture.source, profiles.signed);
	const signedWinManifestPath = join(
		signedFixture.source,
		targetManifestName(version, 'win', 'x64')
	);
	const signedWinManifest = JSON.parse(
		readFileSync(signedWinManifestPath, 'utf8')
	);

	signedWinManifest.artifacts[0].signingStatus = 'HashMismatch';
	writeFileSync(
		signedWinManifestPath,
		`${JSON.stringify(signedWinManifest, null, 2)}\n`
	);

	const signedResult = runOrganizer(signedFixture, profiles.signed);

	assert.equal(signedResult.status, 1);
	assert.match(signedResult.stderr, /unexpected signingStatus/);

	const unsignedFixture = releaseFixture();
	writeInputs(unsignedFixture.source, profiles.unsigned);
	const unsignedWinManifestPath = join(
		unsignedFixture.source,
		targetManifestName(version, 'win', 'x64')
	);
	const unsignedWinManifest = JSON.parse(
		readFileSync(unsignedWinManifestPath, 'utf8')
	);

	unsignedWinManifest.artifacts[0].timestamped = true;
	writeFileSync(
		unsignedWinManifestPath,
		`${JSON.stringify(unsignedWinManifest, null, 2)}\n`
	);

	const unsignedResult = runOrganizer(unsignedFixture, profiles.unsigned);

	assert.equal(unsignedResult.status, 1);
	assert.match(unsignedResult.stderr, /unexpected timestamped/);

	const macFixture = releaseFixture();
	writeInputs(macFixture.source, profiles.unsigned);
	const unsignedMacManifestPath = join(
		macFixture.source,
		targetManifestName(version, 'mac', 'x64')
	);
	const unsignedMacManifest = JSON.parse(
		readFileSync(unsignedMacManifestPath, 'utf8')
	);

	unsignedMacManifest.artifacts[0].authority =
		'Developer ID Application: Unexpected';
	writeFileSync(
		unsignedMacManifestPath,
		`${JSON.stringify(unsignedMacManifest, null, 2)}\n`
	);

	const macResult = runOrganizer(macFixture, profiles.unsigned);

	assert.equal(macResult.status, 1);
	assert.match(macResult.stderr, /unexpected authority/);
});

test('rejects updater metadata and unsigned dirty-tree manifests', () => {
	const updaterFixture = releaseFixture();
	writeInputs(updaterFixture.source, profiles.unsigned);
	writeFileSync(join(updaterFixture.source, 'beta-mac.yml'), 'updates\n');

	const updaterResult = runOrganizer(updaterFixture, profiles.unsigned);

	assert.equal(updaterResult.status, 1);
	assert.match(updaterResult.stderr, /Updater metadata is forbidden/);

	const dirtyFixture = releaseFixture();
	writeInputs(dirtyFixture.source, profiles.unsigned, {sourceTree: 'dirty'});

	const dirtyResult = runOrganizer(dirtyFixture, profiles.unsigned);

	assert.equal(dirtyResult.status, 1);
	assert.match(dirtyResult.stderr, /does not record a clean source tree/);
});
