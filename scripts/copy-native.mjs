#!/usr/bin/env node

import {access, copyFile, mkdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..'
);
const source = path.join(
	rootDir,
	'src',
	'electron',
	'main-process',
	'native',
	'twine_native.node'
);
const target = path.join(
	rootDir,
	'electron-build',
	'main',
	'src',
	'electron',
	'main-process',
	'native',
	'twine_native.node'
);

async function exists(filePath) {
	try {
		await access(filePath, constants.R_OK);
		return true;
	} catch {
		return false;
	}
}

if (!(await exists(source))) {
	console.warn(
		'copy-native: native addon is not built; Electron will use the TypeScript project fallback.'
	);
	process.exit(0);
}

await mkdir(path.dirname(target), {recursive: true});
await copyFile(source, target);
console.log(`copy-native: copied ${source} to ${target}`);
