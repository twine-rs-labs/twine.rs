#!/usr/bin/env node

import {access, readFile, rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeDeterministicZip} from './deterministic-zip.mjs';
import {verifyPrecacheManifest} from './verify-precache-manifest.mjs';

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

await access(webDir);
await verifyPrecacheManifest(path.join(webDir, 'sw.js'));
await rm(archivePath, {force: true});
await writeDeterministicZip({
	archivePath,
	prefix: 'web',
	rootDirectory: webDir
});

console.log(`archive-web: wrote ${archivePath}`);
