#!/usr/bin/env node

import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile, rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyPrecacheManifest} from './verify-precache-manifest.mjs';

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..'
);
const packageJson = JSON.parse(
	await readFile(path.join(rootDir, 'package.json'), 'utf8')
);
const archivePath = path.join(
	rootDir,
	'dist',
	`twine-rs-${packageJson.version}-web.zip`
);
const generatedPaths = [
	path.join(rootDir, 'dist'),
	path.join(rootDir, 'electron-build', 'renderer')
];

function runBuild() {
	return new Promise((resolve, reject) => {
		const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
		const child = spawn(command, ['run', 'build:web'], {
			cwd: rootDir,
			stdio: 'inherit'
		});

		child.on('error', reject);
		child.on('exit', code => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`npm run build:web exited with ${code}`));
			}
		});
	});
}

async function cleanAndBuild() {
	for (const generatedPath of generatedPaths) {
		await rm(generatedPath, {force: true, recursive: true});
	}

	await runBuild();
	await verifyPrecacheManifest(path.join(rootDir, 'dist', 'web', 'sw.js'));
	return createHash('sha256')
		.update(await readFile(archivePath))
		.digest('hex');
}

const firstHash = await cleanAndBuild();
const secondHash = await cleanAndBuild();

if (firstHash !== secondHash) {
	throw new Error(
		`Web archive is not reproducible: ${firstHash} != ${secondHash}`
	);
}

console.log(`check-web-reproducibility: ${firstHash} ${archivePath}`);
