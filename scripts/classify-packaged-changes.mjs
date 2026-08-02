#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const commitPattern = /^[0-9a-f]{40}$/;
const releaseDocumentation = new Set(['CHANGELOG.md', 'RELEASING.md']);

export function isSafeDocumentationPath(path) {
	if (typeof path !== 'string' || path.length === 0) {
		return false;
	}
	if (releaseDocumentation.has(path) || path.startsWith('docs/releases/')) {
		return false;
	}
	return path.startsWith('docs/') || /^[^/]+\.md$/i.test(path);
}

export function classifyChangedPaths(paths) {
	if (!Array.isArray(paths) || paths.length === 0) {
		return {nativeRequired: true, reason: 'empty-or-invalid-diff'};
	}
	if (paths.some(path => !isSafeDocumentationPath(path))) {
		return {nativeRequired: true, reason: 'native-relevant-change'};
	}
	return {nativeRequired: false, reason: 'safe-documentation-only'};
}

function parseArgs(args) {
	const options = {};
	for (let index = 0; index < args.length; index += 2) {
		const arg = args[index];
		const value = args[index + 1];
		if (!new Set(['--base', '--head', '--output']).has(arg) || !value) {
			throw new Error(`Invalid argument ${arg ?? '(missing)'}.`);
		}
		options[arg.slice(2)] = value;
	}
	if (!options.base || !options.head || !options.output) {
		throw new Error('--base, --head, and --output are required.');
	}
	return options;
}

function changedPaths(base, head) {
	if (
		!commitPattern.test(base) ||
		!commitPattern.test(head) ||
		base === head ||
		base === '0'.repeat(40)
	) {
		return undefined;
	}
	try {
		execFileSync('git', ['cat-file', '-e', `${base}^{commit}`], {
			stdio: 'ignore'
		});
		execFileSync('git', ['cat-file', '-e', `${head}^{commit}`], {
			stdio: 'ignore'
		});
		return execFileSync(
			'git',
			['diff', '--name-only', '--no-renames', base, head],
			{
				encoding: 'utf8'
			}
		)
			.split(/\r?\n/)
			.filter(Boolean);
	} catch {
		return undefined;
	}
}

function main() {
	const options = parseArgs(process.argv.slice(2));
	const result = classifyChangedPaths(changedPaths(options.base, options.head));
	appendFileSync(
		options.output,
		`native_required=${result.nativeRequired}\nreason=${result.reason}\n`
	);
	console.log(
		`Packaged change classification: native_required=${result.nativeRequired} (${result.reason}).`
	);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	try {
		main();
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
}
