import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {afterEach, test} from 'node:test';

const require = createRequire(import.meta.url);
const {
	expectedArtifacts,
	localArtifactNotice,
	localArtifactNoticeName,
	profiles,
	resolveReleaseProfile,
	validatePackagingProfile
} = require('../release-profile.cjs');
const {
	createArtifactProfileHook,
	inspectWindowsArtifact,
	validateArtifactInspection
} = require('../artifact-profile-hooks.cjs');
const temporaryRoots = [];

function temporaryRoot() {
	const root = mkdtempSync(join(tmpdir(), 'twine-rs-release-profile-'));

	temporaryRoots.push(root);
	return root;
}

function windowsPeFixture({
	certificateTableOffset = 0,
	certificateTableSize = 0
} = {}) {
	const fixture = Buffer.alloc(512);
	const peOffset = 0x80;
	const optionalHeaderOffset = peOffset + 24;
	const dataDirectoryOffset = optionalHeaderOffset + 96;

	fixture.write('MZ');
	fixture.writeUInt32LE(peOffset, 0x3c);
	fixture.writeUInt32LE(0x00004550, peOffset);
	fixture.writeUInt16LE(224, peOffset + 20);
	fixture.writeUInt16LE(0x10b, optionalHeaderOffset);
	fixture.writeUInt32LE(16, optionalHeaderOffset + 92);
	fixture.writeUInt32LE(certificateTableOffset, dataDirectoryOffset + 32);
	fixture.writeUInt32LE(certificateTableSize, dataDirectoryOffset + 36);

	return fixture;
}

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) {
		rmSync(root, {force: true, recursive: true});
	}
});

test('local is the default release profile', () => {
	assert.equal(resolveReleaseProfile({}), profiles.local);
	assert.doesNotThrow(() =>
		validatePackagingProfile(profiles.local, {}, 'linux')
	);
});

test('distributable-unsigned requires acknowledgement and rejects signing input', () => {
	assert.throws(
		() => validatePackagingProfile(profiles.unsigned, {}, 'win32'),
		/ALLOW_UNSIGNED_DISTRIBUTION=1/
	);
	assert.throws(
		() =>
			validatePackagingProfile(
				profiles.unsigned,
				{ALLOW_UNSIGNED_DISTRIBUTION: '1', WIN_CSC_LINK: 'certificate'},
				'win32'
			),
		/rejects trusted signing input/
	);
	assert.doesNotThrow(() =>
		validatePackagingProfile(
			profiles.unsigned,
			{ALLOW_UNSIGNED_DISTRIBUTION: '1'},
			'win32'
		)
	);
});

test('unsigned Windows and macOS filenames are visibly labeled', () => {
	assert.deepEqual(
		expectedArtifacts('0.2.0-beta.1', 'win', 'x64', profiles.unsigned),
		['Twine-RS-0.2.0-beta.1-win-x64-unsigned.exe']
	);
	assert.deepEqual(
		expectedArtifacts('0.2.0-beta.1', 'mac', 'arm64', profiles.unsigned),
		['Twine-RS-0.2.0-beta.1-mac-arm64-unsigned.dmg']
	);
	assert.deepEqual(
		expectedArtifacts('0.2.0-beta.1', 'linux', 'arm64', profiles.unsigned),
		[
			'Twine-RS-0.2.0-beta.1-linux-arm64.AppImage',
			'Twine-RS-0.2.0-beta.1-linux-arm64.zip'
		]
	);
	assert.deepEqual(
		expectedArtifacts('0.2.0-beta.1', 'linux', 'x64', profiles.unsigned),
		[
			'Twine-RS-0.2.0-beta.1-linux-x86_64.AppImage',
			'Twine-RS-0.2.0-beta.1-linux-x64.zip'
		]
	);
});

test('signed packaging fails closed on incomplete or unexpected credentials', () => {
	assert.throws(
		() =>
			validatePackagingProfile(
				profiles.signed,
				{
					APPLE_APP_ID: 'rs.twine.app',
					APPLE_ID: 'developer@example.com',
					APPLE_ID_PASSWORD: 'password',
					APPLE_TEAM_ID: 'TEAM123'
				},
				'darwin'
			),
		/missing CSC_NAME/
	);
	assert.throws(
		() =>
			validatePackagingProfile(
				profiles.signed,
				{
					APPLE_APP_ID: 'rs.twine.app',
					APPLE_ID: 'developer@example.com',
					APPLE_ID_PASSWORD: 'password',
					APPLE_TEAM_ID: 'TEAM123',
					CSC_NAME: 'Apple Development: Unexpected'
				},
				'darwin'
			),
		/expected Developer ID Application identity/
	);
	assert.throws(
		() =>
			validatePackagingProfile(
				profiles.signed,
				{
					CSC_KEY_PASSWORD: 'password',
					CSC_LINK: 'certificate',
					WINDOWS_SIGNER_SHA1: 'not-a-thumbprint',
					WINDOWS_SIGNER_SUBJECT: 'CN=Twine RS'
				},
				'win32'
			),
		/40-character certificate thumbprint/
	);
});

test('signed artifact validation rejects fallback signing and unexpected identity', () => {
	const macEnv = {
		APPLE_APP_ID: 'rs.twine.app',
		APPLE_TEAM_ID: 'TEAM123',
		CSC_NAME: 'Developer ID Application: Twine RS (TEAM123)'
	};

	assert.throws(
		() =>
			validateArtifactInspection(
				profiles.signed,
				'mac',
				{
					authority: macEnv.CSC_NAME,
					identifier: macEnv.APPLE_APP_ID,
					notarization: 'not-notarized',
					signerTeamId: macEnv.APPLE_TEAM_ID,
					signing: 'ad-hoc',
					signingScope: 'app-inside-dmg',
					stapling: 'not-stapled'
				},
				macEnv
			),
		/must contain the expected Developer ID/
	);
	assert.throws(
		() =>
			validateArtifactInspection(
				profiles.signed,
				'win',
				{
					notarization: 'not-applicable',
					signerSubject: 'CN=Unexpected',
					signerThumbprint: 'A'.repeat(40),
					signing: 'authenticode',
					signingScope: 'installer',
					stapling: 'not-applicable',
					timestamped: true
				},
				{
					WINDOWS_SIGNER_SHA1: 'A'.repeat(40),
					WINDOWS_SIGNER_SUBJECT: 'CN=Twine RS'
				}
			),
		/does not match WINDOWS_SIGNER_SUBJECT/
	);
});

test('target hook emits a hash-bound manifest with actual signing state', async () => {
	const root = temporaryRoot();
	const version = '0.2.0-beta.1';
	const artifactNames = expectedArtifacts(
		version,
		'linux',
		'x64',
		profiles.local
	);
	const artifactPaths = artifactNames.map(name => {
		const artifactPath = join(root, name);

		writeFileSync(artifactPath, `artifact:${name}\n`);
		return artifactPath;
	});
	const hook = createArtifactProfileHook({
		arch: 'x64',
		env: {},
		platform: 'linux',
		profile: profiles.local,
		rootDir: root,
		version
	});
	const dependencies = {
		inspectArtifact() {
			return {
				notarization: 'not-applicable',
				signing: 'not-applicable',
				signingScope: 'not-applicable',
				stapling: 'not-applicable'
			};
		},
		readFileSync,
		spawnSync(_file, args) {
			return args[0] === 'rev-parse'
				? {status: 0, stderr: '', stdout: `${'b'.repeat(40)}\n`}
				: {status: 0, stderr: '', stdout: ' M tracked-file\n'};
		},
		statSync,
		writeFileSync
	};

	const [manifestPath] = await hook(
		{artifactPaths, outDir: root},
		dependencies
	);
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

	assert.equal(manifest.profile, profiles.local);
	assert.equal(manifest.applicationVersion, version);
	assert.equal(manifest.sourceCommit, 'b'.repeat(40));
	assert.equal(manifest.sourceTree, 'dirty');
	assert.equal(manifest.artifacts.length, 2);
	assert.match(manifest.artifacts[0].sha256, /^[0-9a-f]{64}$/);
	assert.equal(manifest.artifacts[0].signing, 'not-applicable');
	assert.equal(
		readFileSync(join(root, localArtifactNoticeName), 'utf8'),
		localArtifactNotice
	);
});

test('target hook rejects updater metadata for stable and prerelease channels', async () => {
	const hook = createArtifactProfileHook({
		arch: 'x64',
		env: {},
		platform: 'linux',
		profile: profiles.local,
		rootDir: '/tmp',
		version: '0.2.0'
	});

	for (const metadata of [
		'latest.yml',
		'beta.yml',
		'beta-mac.yml',
		'alpha-linux-arm64.yml',
		'custom-channel.yaml'
	]) {
		await assert.rejects(
			() =>
				hook({
					artifactPaths: [`/tmp/${metadata}`],
					outDir: '/tmp'
				}),
			/Updater metadata is disabled/
		);
	}
});

test('Windows signature inspection passes paths through the environment', () => {
	const artifactPath = 'C:\\workspace with spaces\\Twine RS Setup.exe';
	let invocation;

	const inspection = inspectWindowsArtifact(artifactPath, {
		spawnSync(file, args, options) {
			invocation = {args, file, options};
			return {
				status: 0,
				stderr: '',
				stdout: JSON.stringify({Status: 'NotSigned'})
			};
		}
	});

	assert.equal(invocation.file, 'powershell.exe');
	assert.equal(invocation.args.at(-2), '-Command');
	assert.equal(invocation.args.length, 4);
	assert.equal(invocation.options.env.TWINE_ARTIFACT_PATH, artifactPath);
	assert.match(
		invocation.args.at(-1),
		/\[PSCustomObject\]@\{\nStatus = \[string\]\$signature\.Status/
	);
	assert.doesNotMatch(invocation.args.at(-1), /@\{\s*;/);
	assert.equal(inspection.signing, 'unsigned');
});

test('Windows signature inspection recognizes an empty PE certificate table', () => {
	let invokedPowerShell = false;
	const inspection = inspectWindowsArtifact('unsigned.exe', {
		readFileSync: () => windowsPeFixture(),
		spawnSync() {
			invokedPowerShell = true;
		}
	});

	assert.equal(invokedPowerShell, false);
	assert.deepEqual(inspection, {
		notarization: 'not-applicable',
		signing: 'unsigned',
		signingScope: 'installer',
		stapling: 'not-applicable'
	});
});

test('Windows signature inspection validates a populated PE certificate table', () => {
	const inspection = inspectWindowsArtifact('invalid.exe', {
		readFileSync: () =>
			windowsPeFixture({
				certificateTableOffset: 384,
				certificateTableSize: 128
			}),
		spawnSync() {
			return {
				status: 0,
				stderr: '',
				stdout: JSON.stringify({
					Status: 'HashMismatch',
					StatusMessage: 'The contents of the file have changed.'
				})
			};
		}
	});

	assert.equal(inspection.signing, 'invalid');
	assert.equal(inspection.signingStatus, 'HashMismatch');
	assert.equal(
		inspection.signingStatusMessage,
		'The contents of the file have changed.'
	);
	assert.throws(
		() => validateArtifactInspection(profiles.local, 'win', inspection, {}),
		/Authenticode status HashMismatch: The contents of the file have changed/
	);
});

test(
	'Windows signature inspection handles a real path containing spaces',
	{skip: process.platform !== 'win32'},
	() => {
		const root = temporaryRoot();
		const artifactPath = join(root, 'unsigned artifact with spaces.exe');

		writeFileSync(artifactPath, 'not a signed executable\n');

		const inspection = inspectWindowsArtifact(artifactPath, {spawnSync});

		assert.equal(inspection.signing, 'unsigned');
	}
);

test('target hook rejects extra architecture artifacts in one builder run', async () => {
	const hook = createArtifactProfileHook({
		arch: 'x64',
		env: {},
		platform: 'linux',
		profile: profiles.local,
		rootDir: '/tmp',
		version: '0.2.0'
	});

	await assert.rejects(
		() =>
			hook({
				artifactPaths: [
					'/tmp/Twine-RS-0.2.0-linux-x86_64.AppImage',
					'/tmp/Twine-RS-0.2.0-linux-x64.zip',
					'/tmp/Twine-RS-0.2.0-linux-arm64.AppImage'
				],
				outDir: '/tmp'
			}),
		/unexpected target artifacts/
	);
});

test('target hook allows electron-builder directory-only output', async () => {
	const hook = createArtifactProfileHook({
		arch: 'x64',
		env: {},
		platform: 'linux',
		profile: profiles.local,
		rootDir: '/tmp',
		version: '0.2.0'
	});
	const platformToTargets = new Map([['linux', new Map()]]);

	assert.deepEqual(
		await hook({
			artifactPaths: [],
			outDir: '/tmp',
			platformToTargets
		}),
		[]
	);
});

test('Linux trust state rejects contradictory scope and stapling claims', () => {
	assert.throws(
		() =>
			validateArtifactInspection(
				profiles.signed,
				'linux',
				{
					notarization: 'not-applicable',
					signing: 'not-applicable',
					signingScope: 'installer',
					stapling: 'stapled'
				},
				{}
			),
		/signing, scope, notarization, and stapling as not-applicable/
	);
});

test('Windows and macOS trust state rejects contradictory scope claims', () => {
	assert.throws(
		() =>
			validateArtifactInspection(
				profiles.unsigned,
				'win',
				{
					notarization: 'notarized',
					signing: 'unsigned',
					signingScope: 'app-inside-dmg',
					stapling: 'stapled'
				},
				{}
			),
		/installer signing scope/
	);
	assert.throws(
		() =>
			validateArtifactInspection(
				profiles.unsigned,
				'mac',
				{
					notarization: 'not-notarized',
					signing: 'ad-hoc',
					signingScope: 'installer',
					stapling: 'not-stapled'
				},
				{}
			),
		/app-inside-dmg/
	);
});

test('release trust state rejects identity fields that contradict the profile', () => {
	assert.throws(
		() =>
			validateArtifactInspection(
				profiles.unsigned,
				'win',
				{
					notarization: 'not-applicable',
					signerSubject: 'CN=Unexpected',
					signing: 'unsigned',
					signingScope: 'installer',
					stapling: 'not-applicable',
					timestamped: true
				},
				{}
			),
		/must not contain trusted signing identity fields/
	);
	assert.throws(
		() =>
			validateArtifactInspection(
				profiles.signed,
				'win',
				{
					notarization: 'not-applicable',
					signerSubject: 'CN=Twine RS',
					signerThumbprint: 'A'.repeat(40),
					signing: 'authenticode',
					signingScope: 'installer',
					signingStatus: 'HashMismatch',
					stapling: 'not-applicable',
					timestamped: true
				},
				{
					WINDOWS_SIGNER_SHA1: 'A'.repeat(40),
					WINDOWS_SIGNER_SUBJECT: 'CN=Twine RS'
				}
			),
		/must not record an invalid signing status/
	);
});
