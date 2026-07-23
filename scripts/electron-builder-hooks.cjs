const {execFileSync, spawnSync} = require('child_process');
const {notarize} = require('@electron/notarize');
const path = require('path');
const {profiles} = require('./release-profile.cjs');

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

function isMacBuild(context) {
	if (context.electronPlatformName === 'mas') {
		return false;
	}

	return (
		context.electronPlatformName === 'darwin' ||
		context.packager?.platform?.name === 'mac'
	);
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
	const authority = output.match(/^Authority=(.+)$/im)?.[1]?.trim();
	const teamIdentifier = output.match(/^TeamIdentifier=(.+)$/im)?.[1]?.trim();

	if (/^Authority=Developer ID Application:/im.test(output)) {
		return {
			authority,
			identifier,
			kind: 'developer-id',
			teamIdentifier
		};
	}

	return {authority, identifier, kind: 'other', teamIdentifier};
}

function isUniversalMergeInput(context) {
	return /-(?:arm64|x64)-temp$/.test(context.appOutDir);
}

function createMacBuildHooks({productName, profile = profiles.local}) {
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

		if (profile === profiles.signed) {
			dependencies.log('Preserving the app for required Developer ID signing.');
			return;
		}

		if (isUniversalMergeInput(context)) {
			dependencies.log(
				'Deferring local ad-hoc signing until after the universal app is merged.'
			);
			return;
		}

		const signature = inspectMacSignature(appPath, dependencies);

		if (
			profile === profiles.unsigned &&
			signature.kind !== 'unsigned' &&
			signature.kind !== 'ad-hoc'
		) {
			throw new Error(
				`distributable-unsigned refuses an existing ${signature.kind} macOS signature.`
			);
		}

		if (signature.kind !== 'unsigned') {
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

		if (profile !== profiles.signed) {
			return;
		}

		const missingEnv = missingNotarizationEnv(dependencies.env);

		if (missingEnv.length > 0) {
			throw new Error(
				`signed macOS packaging is missing ${missingEnv.join(', ')}.`
			);
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

		if (signature.teamIdentifier !== dependencies.env.APPLE_TEAM_ID) {
			throw new Error(
				`Refusing to notarize ${appPath}: signing team ${
					signature.teamIdentifier ?? '<unknown>'
				} does not match APPLE_TEAM_ID.`
			);
		}

		if (signature.authority !== dependencies.env.CSC_NAME) {
			throw new Error(
				`Refusing to notarize ${appPath}: signing authority ${
					signature.authority ?? '<unknown>'
				} does not match CSC_NAME.`
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

module.exports = {createMacBuildHooks};
