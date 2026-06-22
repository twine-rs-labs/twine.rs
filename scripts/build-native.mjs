#!/usr/bin/env node

import {access, copyFile, mkdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import {spawn} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..'
);
const rustupToolchain = path.join(
	os.homedir(),
	'.rustup',
	'toolchains',
	`stable-${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-${
		process.platform === 'darwin'
			? 'apple-darwin'
			: process.platform === 'win32'
				? 'pc-windows-msvc'
			: 'unknown-linux-gnu'
	}`
);
const cargoName = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
const rustcName = process.platform === 'win32' ? 'rustc.exe' : 'rustc';
const rustupCargo = path.join(rustupToolchain, 'bin', cargoName);
const rustupRustc = path.join(rustupToolchain, 'bin', rustcName);
const cargo = process.env.CARGO ?? ((await exists(rustupCargo)) ? rustupCargo : 'cargo');
const rustc = process.env.RUSTC ?? ((await exists(rustupRustc)) ? rustupRustc : undefined);
const nativeSource = path.join(
	rootDir,
	'target',
	'release',
	process.platform === 'win32'
		? 'twine_native.dll'
		: process.platform === 'darwin'
			? 'libtwine_native.dylib'
			: 'libtwine_native.so'
);
const nativeOutDir = path.join(
	rootDir,
	'src',
	'electron',
	'main-process',
	'native'
);
const nativeOut = path.join(nativeOutDir, 'twine_native.node');

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

await mkdir(nativeOutDir, {recursive: true});
await run(cargo, ['build', '-p', 'twine_native', '--release']);
await copyFile(nativeSource, nativeOut);
console.log(`build-native: wrote ${nativeOut}`);
