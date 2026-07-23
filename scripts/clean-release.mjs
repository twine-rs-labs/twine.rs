#!/usr/bin/env node
// Clears desktop artifact output before a fresh packaging or assembly run.
import {mkdirSync, rmSync} from 'node:fs';
import {join, resolve} from 'node:path';

const artifactsDir = resolve(
	process.argv[2] || join(process.cwd(), 'artifacts')
);

if (
	artifactsDir === resolve(process.cwd()) ||
	artifactsDir === resolve(artifactsDir, '..')
) {
	console.error(
		'clean-release: refusing to remove a project or filesystem root.'
	);
	process.exit(1);
}

rmSync(artifactsDir, {force: true, recursive: true});
mkdirSync(artifactsDir, {recursive: true});
console.log(`clean-release: cleared ${artifactsDir}`);
