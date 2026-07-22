#!/usr/bin/env node

import {access, copyFile, mkdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const {
	assertNativeArtifact,
	nativeArtifactPath,
	nativeLibraryName,
	nativeTargetTriple
} = require('./native-artifact.cjs');

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..'
);
const targetTriple = nativeTargetTriple(process.platform, process.arch);
const rustupToolchain = path.join(
	os.homedir(),
	'.rustup',
	'toolchains',
	`stable-${targetTriple}`
);
const cargoName = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
const rustcName = process.platform === 'win32' ? 'rustc.exe' : 'rustc';
const rustupCargo = path.join(rustupToolchain, 'bin', cargoName);
const rustupRustc = path.join(rustupToolchain, 'bin', rustcName);
const cargo =
	process.env.CARGO ?? ((await exists(rustupCargo)) ? rustupCargo : 'cargo');
const rustc =
	process.env.RUSTC ?? ((await exists(rustupRustc)) ? rustupRustc : undefined);
const nativeSource = path.join(
	rootDir,
	'target',
	targetTriple,
	'release',
	nativeLibraryName(process.platform)
);
const nativeOut = nativeArtifactPath(rootDir, process.platform, process.arch);

async function exists(filePath) {
	try {
		await access(filePath, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function run(command, args, options = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: rootDir,
			env: {...process.env, ...(rustc ? {RUSTC: rustc} : {})},
			stdio: 'inherit',
			...options
		});

		child.on('exit', code => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`${command} exited with ${code}`));
			}
		});
		child.on('error', reject);
	});
}

await mkdir(path.dirname(nativeOut), {recursive: true});
await run(cargo, [
	'build',
	'-p',
	'twine_native',
	'--release',
	'--locked',
	'--target',
	targetTriple
]);
await copyFile(nativeSource, nativeOut);
assertNativeArtifact(nativeOut, {
	arch: process.arch,
	platform: process.platform
});
await run(process.execPath, [
	path.join('scripts', 'check-native-asset-reader-abi.mjs'),
	nativeOut
]);
console.log(
	`build-native: wrote target-qualified ${process.platform}-${process.arch} addon to ${nativeOut}`
);
