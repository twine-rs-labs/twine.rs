#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {basename, resolve} from 'node:path';

const [checksumsArgument, fileArgument] = process.argv.slice(2);

if (!checksumsArgument || !fileArgument) {
	console.error(
		'Usage: node scripts/verify-release-download.mjs <SHA256SUMS.txt> <download>'
	);
	process.exit(1);
}

const checksumsPath = resolve(checksumsArgument);
const filePath = resolve(fileArgument);
const fileName = basename(filePath);
const entries = readFileSync(checksumsPath, 'utf8')
	.trim()
	.split(/\r?\n/)
	.map(line => {
		const match = /^([0-9a-f]{64})  (.+)$/.exec(line);

		if (!match) {
			throw new Error(`Invalid checksum line: ${line}`);
		}
		return {fileName: basename(match[2]), sha256: match[1]};
	});
const matches = entries.filter(entry => entry.fileName === fileName);

if (matches.length !== 1) {
	throw new Error(
		`Expected exactly one checksum for ${fileName}, found ${matches.length}.`
	);
}

const actual = createHash('sha256')
	.update(readFileSync(filePath))
	.digest('hex');

if (actual !== matches[0].sha256) {
	throw new Error(
		`SHA-256 mismatch for ${fileName}: expected ${matches[0].sha256}, got ${actual}.`
	);
}

console.log(`verify-release-download: ${fileName} matches SHA256SUMS.txt`);
