#!/usr/bin/env node

import {access, mkdir, readFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import os from 'node:os';

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..'
);
const rustupToolchain = path.join(
	os.homedir(),
	'.rustup',
	'toolchains',
	'stable-aarch64-apple-darwin'
);
const rustupCargo = path.join(rustupToolchain, 'bin', 'cargo');
const rustupRustc = path.join(rustupToolchain, 'bin', 'rustc');
const cargo =
	process.env.CARGO ?? ((await exists(rustupCargo)) ? rustupCargo : 'cargo');
const rustc =
	process.env.RUSTC ?? ((await exists(rustupRustc)) ? rustupRustc : undefined);
const wasmBindgen =
	process.env.WASM_BINDGEN ??
	((await exists(path.join(os.homedir(), '.cargo', 'bin', 'wasm-bindgen')))
		? path.join(os.homedir(), '.cargo', 'bin', 'wasm-bindgen')
		: 'wasm-bindgen');
const wasmInput = path.join(
	rootDir,
	'target',
	'wasm32-unknown-unknown',
	'release',
	'twine_wasm.wasm'
);
const outDir = path.join(rootDir, 'src', 'core', 'wasm', 'pkg');
const cargoLock = await readFile(path.join(rootDir, 'Cargo.lock'), 'utf8');
const expectedWasmBindgenVersion = cargoLock.match(
	/\[\[package\]\]\s+name = "wasm-bindgen"\s+version = "([^"]+)"/
)?.[1];

if (!expectedWasmBindgenVersion) {
	throw new Error(
		'build-wasm: could not determine wasm-bindgen from Cargo.lock.'
	);
}

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

function capture(command, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: rootDir,
			env: {...process.env, ...(rustc ? {RUSTC: rustc} : {})},
			stdio: ['ignore', 'pipe', 'pipe']
		});
		let stderr = '';
		let stdout = '';

		child.stdout.on('data', chunk => (stdout += chunk));
		child.stderr.on('data', chunk => (stderr += chunk));
		child.on('exit', code => {
			if (code === 0) {
				resolve(stdout.trim());
			} else {
				reject(new Error(`${command} exited with ${code}: ${stderr.trim()}`));
			}
		});
		child.on('error', reject);
	});
}

await mkdir(outDir, {recursive: true});
const wasmBindgenVersion = await capture(wasmBindgen, ['--version']);

if (wasmBindgenVersion !== `wasm-bindgen ${expectedWasmBindgenVersion}`) {
	throw new Error(
		`build-wasm: Cargo.lock requires wasm-bindgen ${expectedWasmBindgenVersion}, ` +
			`but the configured CLI reported ${JSON.stringify(wasmBindgenVersion)}. ` +
			`Install it with cargo install wasm-bindgen-cli --version ${expectedWasmBindgenVersion} --locked.`
	);
}
await run(cargo, [
	'build',
	'-p',
	'twine_wasm',
	'--release',
	'--locked',
	'--target',
	'wasm32-unknown-unknown'
]);
await run(wasmBindgen, [
	wasmInput,
	'--target',
	'web',
	'--out-dir',
	outDir,
	'--out-name',
	'twine_wasm'
]);
console.log(
	`build-wasm: regenerated bindings with wasm-bindgen ${expectedWasmBindgenVersion}`
);
