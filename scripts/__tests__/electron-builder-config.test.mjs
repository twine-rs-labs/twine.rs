import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {test} from 'node:test';

const require = createRequire(import.meta.url);
const config = require('../../electron-builder.config.js');
const configPath = require.resolve('../../electron-builder.config.js');
const {createMacBuildHooks} = require('../electron-builder-hooks.cjs');
const {afterPack, afterSign} = createMacBuildHooks({productName: 'Twine RS'});

const completeNotarizationEnv = {
	APPLE_APP_ID: 'rs.twine.app',
	APPLE_ID: 'developer@example.com',
	APPLE_ID_PASSWORD: 'app-specific-password',
	APPLE_TEAM_ID: 'TEAM123'
};

function forceCodeSigningFor(env) {
	const cleanEnv = {...process.env};

	for (const key of Object.keys(completeNotarizationEnv)) {
		delete cleanEnv[key];
	}

	return (
		execFileSync(
			process.execPath,
			[
				'-e',
				`process.stdout.write(String(require(${JSON.stringify(
					configPath
				)}).mac.forceCodeSigning))`
			],
			{encoding: 'utf8', env: {...cleanEnv, ...env}}
		).trim() === 'true'
	);
}

function context({
	appOutDir = '/tmp/twine-builder-test/mac-universal',
	identity,
	platform = 'darwin'
} = {}) {
	const platformSpecificBuildOptions = {};

	if (identity !== undefined) {
		platformSpecificBuildOptions.identity = identity;
	}

	return {
		appOutDir,
		electronPlatformName: platform,
		packager: {
			appInfo: {productFilename: 'Twine RS'},
			platform: {name: platform === 'linux' ? 'linux' : 'mac'},
			platformSpecificBuildOptions
		}
	};
}

function dependencies({
	discovery = {status: 0, stderr: '', stdout: '0 valid identities found'},
	env = {CSC_IDENTITY_AUTO_DISCOVERY: 'false'},
	signature = 'unsigned'
} = {}) {
	const calls = [];
	const logs = [];
	const notarizations = [];
	const signatureDetails = {
		'ad-hoc': 'Identifier=rs.twine.app\nSignature=adhoc',
		'developer-id':
			'Identifier=rs.twine.app\nAuthority=Developer ID Application: Example (TEAM123)\nTeamIdentifier=TEAM123',
		'mismatched-id':
			'Identifier=org.example.other\nAuthority=Developer ID Application: Example (TEAM123)\nTeamIdentifier=TEAM123',
		other:
			'Identifier=rs.twine.app\nAuthority=Apple Development: Example (TEAM123)'
	};

	return {
		calls,
		env,
		execFileSync(file, args) {
			calls.push({args, file});

			if (args[0] === '--verify' && signature === 'unsigned') {
				throw new Error('unsigned');
			}
		},
		log(message) {
			logs.push(message);
		},
		logs,
		async notarize(options) {
			notarizations.push(options);
		},
		notarizations,
		spawnSync(file, args) {
			calls.push({args, file});

			if (file === '/usr/bin/security') {
				return discovery;
			}

			return {
				status: 0,
				stderr: signatureDetails[signature] ?? '',
				stdout: ''
			};
		}
	};
}

test('electron-builder config exposes only schema properties', () => {
	assert.equal(Object.keys(config).includes('__test'), false);
	assert.equal(Object.keys(config).includes('forceCodeSigning'), false);
	assert.equal(config.mac.notarize, false);
});

test('desktop targets are architecture-specific and selected by the runner', () => {
	assert.deepEqual(config.linux.target, ['AppImage', 'zip']);
	assert.equal(config.mac.target, 'dmg');
	assert.equal(config.win.target, 'nsis');
	assert.match(config.mac.artifactName, /mac-\$\{arch\}/);
	assert.doesNotMatch(config.mac.artifactName, /universal/);
});

test('macOS packages remove unsupported sensitive-device usage declarations', () => {
	assert.deepEqual(config.mac.extendInfo, {
		NSAudioCaptureUsageDescription: null,
		NSBluetoothAlwaysUsageDescription: null,
		NSBluetoothPeripheralUsageDescription: null,
		NSCameraUsageDescription: null,
		NSMicrophoneUsageDescription: null
	});
});

test('complete notarization intent requires successful builder code signing', () => {
	assert.equal(forceCodeSigningFor({}), false);
	assert.equal(
		forceCodeSigningFor({...completeNotarizationEnv, APPLE_TEAM_ID: ''}),
		false
	);
	assert.equal(forceCodeSigningFor(completeNotarizationEnv), true);
	assert.equal(
		forceCodeSigningFor({
			...completeNotarizationEnv,
			CSC_NAME: 'Missing Developer ID identity'
		}),
		true
	);
});

test('macOS hooks ignore MAS builds even when the packager platform is mac', async () => {
	const deps = dependencies({
		env: completeNotarizationEnv,
		signature: 'developer-id'
	});
	const masContext = context({platform: 'mas'});

	await afterPack(masContext, deps);
	await afterSign(masContext, deps);

	assert.equal(deps.calls.length, 0);
	assert.equal(deps.logs.length, 0);
	assert.equal(deps.notarizations.length, 0);
});

test('afterPack ad-hoc signs an unsigned local macOS build', async () => {
	const deps = dependencies();

	await afterPack(context(), deps);

	assert.deepEqual(deps.calls.at(-1), {
		args: [
			'--force',
			'--deep',
			'--sign',
			'-',
			'/tmp/twine-builder-test/mac-universal/Twine RS.app'
		],
		file: '/usr/bin/codesign'
	});
});

test('afterPack defers ad-hoc signing for universal merge inputs', async () => {
	for (const arch of ['arm64', 'x64']) {
		const deps = dependencies();

		await afterPack(
			context({
				appOutDir: `/tmp/twine-builder-test/mac-universal-${arch}-temp`
			}),
			deps
		);

		assert.equal(
			deps.calls.some(call => call.args[0] === '--force'),
			false
		);
		assert.deepEqual(deps.logs, [
			'Deferring local ad-hoc signing until after the universal app is merged.'
		]);
	}
});

test('afterPack still ad-hoc signs a standalone architecture build', async () => {
	const deps = dependencies();

	await afterPack(
		context({appOutDir: '/tmp/twine-builder-test/mac-x64'}),
		deps
	);

	assert.deepEqual(deps.calls.at(-1), {
		args: [
			'--force',
			'--deep',
			'--sign',
			'-',
			'/tmp/twine-builder-test/mac-x64/Twine RS.app'
		],
		file: '/usr/bin/codesign'
	});
});

test('afterPack preserves explicit and auto-discovered signing paths', async () => {
	const explicit = dependencies({env: {CSC_NAME: 'Twine Developer ID'}});
	const discovered = dependencies({
		discovery: {
			status: 0,
			stderr: '',
			stdout:
				'  1) ABCDEF1234567890 "Developer ID Application: Example (TEAM123)"\n     1 valid identities found'
		},
		env: {}
	});

	await afterPack(context(), explicit);
	await afterPack(context(), discovered);

	assert.equal(explicit.calls.length, 0);
	assert.equal(
		discovered.calls.some(call => call.args[0] === '--force'),
		false
	);
});

test('afterPack treats failed identity discovery conservatively', async () => {
	const deps = dependencies({
		discovery: {status: 1, stderr: 'security unavailable', stdout: ''},
		env: {}
	});

	await afterPack(context(), deps);

	assert.equal(
		deps.calls.some(call => call.args[0] === '--force'),
		false
	);
});

test('afterPack does not replace complete release intent or a valid signature', async () => {
	const release = dependencies({env: completeNotarizationEnv});
	const alreadySigned = dependencies({signature: 'ad-hoc'});

	await afterPack(context(), release);
	await afterPack(context(), alreadySigned);

	assert.equal(release.calls.length, 0);
	assert.equal(
		alreadySigned.calls.some(call => call.args[0] === '--force'),
		false
	);
});

test('afterSign skips notarization when any credential is missing', async () => {
	const deps = dependencies({
		env: {...completeNotarizationEnv, APPLE_TEAM_ID: ''},
		signature: 'developer-id'
	});

	await afterSign(context(), deps);

	assert.equal(deps.notarizations.length, 0);
	assert.match(deps.logs[0], /APPLE_TEAM_ID/);
});

test('afterSign notarizes only a matching Developer ID-signed app', async () => {
	const deps = dependencies({
		env: completeNotarizationEnv,
		signature: 'developer-id'
	});

	await afterSign(context(), deps);

	assert.deepEqual(deps.notarizations, [
		{
			appPath: '/tmp/twine-builder-test/mac-universal/Twine RS.app',
			appleId: 'developer@example.com',
			appleIdPassword: 'app-specific-password',
			teamId: 'TEAM123'
		}
	]);
});

test('afterSign rejects ad-hoc, non-Developer ID, and mismatched signatures', async () => {
	for (const signature of ['unsigned', 'ad-hoc', 'other', 'mismatched-id']) {
		const deps = dependencies({env: completeNotarizationEnv, signature});

		await assert.rejects(
			() => afterSign(context(), deps),
			/Refusing to notarize/
		);
		assert.equal(deps.notarizations.length, 0);
	}
});
