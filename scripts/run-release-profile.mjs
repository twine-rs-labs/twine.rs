#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {
	validProfiles,
	validatePackagingProfile
} = require('./release-profile.cjs');

const [profile, ...forwardedArgs] = process.argv.slice(2);

if (!validProfiles.has(profile)) {
	console.error(
		`run-release-profile: expected one of ${[...validProfiles].join(', ')}.`
	);
	process.exit(1);
}

const env = {...process.env, TWINE_RELEASE_PROFILE: profile};

try {
	validatePackagingProfile(profile, env, process.platform);
} catch (error) {
	console.error(`run-release-profile: ${error.message}`);
	process.exit(1);
}

const npmExecPath = process.env.npm_execpath;
const command = npmExecPath ? process.execPath : 'npm';
const args = npmExecPath
	? [npmExecPath, 'run', 'dist:profile']
	: ['run', 'dist:profile'];

if (forwardedArgs.length > 0) {
	args.push('--', ...forwardedArgs);
}

const result = spawnSync(command, args, {
	env,
	stdio: 'inherit'
});

if (result.error) {
	console.error(`run-release-profile: ${result.error.message}`);
	process.exit(1);
}

process.exit(result.status ?? 1);
