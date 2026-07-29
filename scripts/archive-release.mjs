#!/usr/bin/env node
import {access, rm} from 'node:fs/promises';
import {resolve, sep} from 'node:path';
import {writeDeterministicZip} from './deterministic-zip.mjs';

function usage() {
	return 'Usage: node scripts/archive-release.mjs --source <directory> --output <zip> --prefix <directory-name>';
}

const options = {};
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
	console.log(usage());
	process.exit(0);
}

for (let index = 0; index < args.length; index += 1) {
	const arg = args[index];

	if (!new Set(['--source', '--output', '--prefix']).has(arg)) {
		throw new Error(`Unknown argument "${arg}".`);
	}
	const value = args[++index];

	if (!value) {
		throw new Error(`${arg} requires a value.`);
	}
	options[arg.slice(2)] = value;
}

if (!options.source || !options.output || !options.prefix) {
	throw new Error(usage());
}

const source = resolve(options.source);
const output = resolve(options.output);

if (
	output === source ||
	output.startsWith(`${source}${sep}`) ||
	source.startsWith(`${output}${sep}`)
) {
	throw new Error('Release archive source and output must not overlap.');
}

await access(source);
await rm(output, {force: true});
await writeDeterministicZip({
	archivePath: output,
	prefix: options.prefix,
	rootDirectory: source
});

console.log(`archive-release: wrote ${output}`);
