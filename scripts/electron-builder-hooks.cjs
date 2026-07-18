const {execFileSync, spawnSync} = require('child_process');
const {notarize} = require('@electron/notarize');
const path = require('path');

const notarizationEnvKeys = [
	'APPLE_APP_ID',
	'APPLE_ID',
	'APPLE_ID_PASSWORD',
	'APPLE_TEAM_ID'
];
const defaultHookDependencies = {
	env: process.env,
	execFileSync,
	log: console.log,
	notarize,
	spawnSync
};

function hasEnvValue(env, key) {
	return typeof env[key] === 'string' && env[key].trim().length > 0;
}

function missingNotarizationEnv(env) {
	return notarizationEnvKeys.filter(key => !hasEnvValue(env, key));
}

function hasCompleteNotarizationEnv(env) {
	return missingNotarizationEnv(env).length === 0;
}

function isMacBuild(context) {
	if (context.electronPlatformName === 'mas') {
		return false;
	}

	return (
		context.electronPlatformName === 'darwin' ||
		context.packager?.platform?.name === 'mac'
	);
}

function macSigningOptions(context) {
	return (
		context.packager?.platformSpecificBuildOptions ??
		context.packager?.config?.mac ??
		{}
	);
}

function discoverSigningIdentity({spawnSync}) {
	const result = spawnSync(
		'/usr/bin/security',
		['find-identity', '-v', '-p', 'codesigning'],
		{encoding: 'utf8'}
	);

	if (result.error || result.status !== 0) {
		return {
			present: true,
			reason: 'code-signing identity discovery could not be verified'
		};
	}

	const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;

	return {
		present: /^\s*\d+\)\s+[0-9a-f]+\s+"[^"]+"/im.test(output),
		reason: 'a code-signing identity is available in the keychain'
	};
}

function realSigningIntent(context, dependencies) {
	const {env} = dependencies;
	const signingOptions = macSigningOptions(context);
	const identity = signingOptions.identity;

	if (
		typeof identity === 'string' &&
		identity.trim().length > 0 &&
		identity.trim() !== '-'
	) {
		return {present: true, reason: 'mac.identity requests a real identity'};
	}

	if (hasEnvValue(env, 'CSC_LINK') || hasEnvValue(env, 'CSC_NAME')) {
		return {present: true, reason: 'CSC_LINK or CSC_NAME is set'};
	}

	if (signingOptions.sign && signingOptions.sign !== false) {
		return {present: true, reason: 'a custom macOS signing hook is configured'};
	}

	if (context.packager?.forceCodeSigning) {
		return {present: true, reason: 'forceCodeSigning is enabled'};
	}

	if (env.CSC_IDENTITY_AUTO_DISCOVERY === 'false') {
		return {present: false, reason: 'identity auto-discovery is disabled'};
	}

	return discoverSigningIdentity(dependencies);
}

function inspectMacSignature(appPath, {execFileSync, spawnSync}) {
	try {
		execFileSync(
			'/usr/bin/codesign',
			['--verify', '--deep', '--strict', appPath],
			{stdio: 'pipe'}
		);
	} catch {
		return {kind: 'unsigned'};
	}

	const result = spawnSync(
		'/usr/bin/codesign',
		['--display', '--verbose=4', appPath],
		{encoding: 'utf8'}
	);
	const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;

	if (result.error || result.status !== 0) {
		return {kind: 'unknown'};
	}

	if (/^Signature=adhoc$/im.test(output)) {
		return {kind: 'ad-hoc'};
	}

	const identifier = output.match(/^Identifier=(.+)$/im)?.[1]?.trim();

	if (/^Authority=Developer ID Application:/im.test(output)) {
		return {identifier, kind: 'developer-id'};
	}

	return {identifier, kind: 'other'};
}

function isUniversalMergeInput(context) {
	return /-(?:arm64|x64)-temp$/.test(context.appOutDir);
}

function createMacBuildHooks({productName}) {
	function macAppPath(context) {
		return path.join(
			context.appOutDir,
			`${context.packager.appInfo.productFilename || productName}.app`
		);
	}

	async function afterPack(context, dependencies = defaultHookDependencies) {
		if (!isMacBuild(context)) {
			return;
		}

		const appPath = macAppPath(context);
		const missingEnv = missingNotarizationEnv(dependencies.env);

		if (missingEnv.length === 0) {
			dependencies.log(
				'Complete notarization credentials are set; preserving the app for Developer ID signing.'
			);
			return;
		}

		const signingIntent = realSigningIntent(context, dependencies);

		if (signingIntent.present) {
			dependencies.log(
				`Skipping local ad-hoc signing because ${signingIntent.reason}.`
			);
			return;
		}

		if (isUniversalMergeInput(context)) {
			dependencies.log(
				'Deferring local ad-hoc signing until after the universal app is merged.'
			);
			return;
		}

		if (inspectMacSignature(appPath, dependencies).kind !== 'unsigned') {
			dependencies.log(
				'Mac app already has a valid signature; leaving it unchanged.'
			);
			return;
		}

		dependencies.log(
			'Ad-hoc signing Mac app for local file access identity...'
		);
		dependencies.execFileSync('/usr/bin/codesign', [
			'--force',
			'--deep',
			'--sign',
			'-',
			appPath
		]);
	}

	async function afterSign(context, dependencies = defaultHookDependencies) {
		if (!isMacBuild(context)) {
			return;
		}

		const missingEnv = missingNotarizationEnv(dependencies.env);

		if (missingEnv.length > 0) {
			dependencies.log(
				`${missingEnv.join(
					', '
				)} environment variable(s) are not set, skipping notarization.`
			);
			return;
		}

		const appPath = macAppPath(context);
		const signature = inspectMacSignature(appPath, dependencies);

		if (signature.kind !== 'developer-id') {
			throw new Error(
				`Refusing to notarize ${appPath}: expected a valid Developer ID Application signature, found ${signature.kind}.`
			);
		}

		if (signature.identifier !== dependencies.env.APPLE_APP_ID) {
			throw new Error(
				`Refusing to notarize ${appPath}: signed identifier ${
					signature.identifier ?? '<unknown>'
				} does not match APPLE_APP_ID.`
			);
		}

		dependencies.log('Notarizing Developer ID-signed Mac app...');
		await dependencies.notarize({
			appPath,
			appleId: dependencies.env.APPLE_ID,
			appleIdPassword: dependencies.env.APPLE_ID_PASSWORD,
			teamId: dependencies.env.APPLE_TEAM_ID
		});
	}

	return {afterPack, afterSign};
}

module.exports = {createMacBuildHooks, hasCompleteNotarizationEnv};
