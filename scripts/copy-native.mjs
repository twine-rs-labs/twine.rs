#!/usr/bin/env node

import {copyFile, mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const {
	assertNativeArtifact,
	nativeArtifactPath
} = require('./native-artifact.cjs');

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..'
);
const source = nativeArtifactPath(rootDir, process.platform, process.arch);
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

assertNativeArtifact(source, {arch: process.arch, platform: process.platform});
await mkdir(path.dirname(target), {recursive: true});
await copyFile(source, target);
assertNativeArtifact(target, {arch: process.arch, platform: process.platform});
console.log(
	`copy-native: staged verified ${process.platform}-${process.arch} addon at ${target}`
);
