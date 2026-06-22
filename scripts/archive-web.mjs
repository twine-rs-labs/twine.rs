#!/usr/bin/env node

import {access, readFile, rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..'
);
const distDir = path.join(rootDir, 'dist');
const webDir = path.join(distDir, 'web');
const packageJson = JSON.parse(
	await readFile(path.join(rootDir, 'package.json'), 'utf8')
);
const archiveName = `twine-rs-${packageJson.version}-web.zip`;
const archivePath = path.join(distDir, archiveName);

function run(command, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {cwd: distDir, stdio: 'inherit'});

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

await access(webDir);
await rm(archivePath, {force: true});

if (process.platform === 'win32') {
	await run('powershell.exe', [
		'-NoProfile',
		'-Command',
		`$ErrorActionPreference = 'Stop'; Compress-Archive -Path 'web' -DestinationPath '${archiveName}' -Force`
	]);
} else {
	await run('zip', ['-r', archiveName, 'web']);
}

console.log(`archive-web: wrote ${archivePath}`);
