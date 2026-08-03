#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const commitPattern = /^[0-9a-f]{40}$/;
const regularMode = '100644';
const missingMode = '000000';
const safeRootDocumentation = new Set(['README.md']);
const safeDocumentationFiles = new Set([
	'docs/README.md',
	'docs/en/book.toml',
	'docs/en/custom.css',
	'docs/upstream/README.md'
]);
const safeDocumentationDirectories = [
	'docs/architecture/',
	'docs/archive/',
	'docs/decisions/',
	'docs/product/',
	'docs/roadmap/',
	'docs/status/',
	'docs/user/'
];
const safeDocumentationExtensions = new Set([
	'.avif',
	'.gif',
	'.jpeg',
	'.jpg',
	'.md',
	'.png',
	'.svg',
	'.webp'
]);
const safeManualExtensions = new Set([
	'.avif',
	'.css',
	'.gif',
	'.jpeg',
	'.jpg',
	'.md',
	'.png',
	'.svg',
	'.webp',
	'.woff',
	'.woff2'
]);
const safeMetadataFiles = new Set([
	'.github/FUNDING.yml',
	'.github/PULL_REQUEST_TEMPLATE.md'
]);
const safeIssueTemplateExtensions = new Set(['.md', '.yaml', '.yml']);
const releaseMetadataFiles = new Set([
	'.github/ISSUE_TEMPLATE/release-checklist.yml'
]);

function extension(path) {
	const fileName = path.slice(path.lastIndexOf('/') + 1);
	const dot = fileName.lastIndexOf('.');
	return dot < 0 ? '' : fileName.slice(dot).toLowerCase();
}

export function isSafeDocumentationPath(path) {
	if (typeof path !== 'string' || path.length === 0) {
		return false;
	}
	if (safeRootDocumentation.has(path) || safeDocumentationFiles.has(path)) {
		return true;
	}
	if (path.startsWith('docs/en/src/')) {
		return safeManualExtensions.has(extension(path));
	}
	return (
		safeDocumentationDirectories.some(directory =>
			path.startsWith(directory)
		) && safeDocumentationExtensions.has(extension(path))
	);
}

export function isSafeMetadataPath(path) {
	if (typeof path !== 'string' || path.length === 0) {
		return false;
	}
	if (safeMetadataFiles.has(path)) {
		return true;
	}
	if (path.startsWith('.github/ISSUE_TEMPLATE/')) {
		if (releaseMetadataFiles.has(path)) {
			return false;
		}
		return safeIssueTemplateExtensions.has(extension(path));
	}
	if (path.startsWith('.github/PULL_REQUEST_TEMPLATE/')) {
		return extension(path) === '.md';
	}
	return false;
}

function hasSafeRegularModes({oldMode, newMode, status}) {
	if (status === 'A') {
		return oldMode === missingMode && newMode === regularMode;
	}
	if (status === 'D') {
		return oldMode === regularMode && newMode === missingMode;
	}
	if (status === 'M') {
		return oldMode === regularMode && newMode === regularMode;
	}
	return false;
}

export function classifyChangedFiles(files) {
	if (!Array.isArray(files) || files.length === 0) {
		return {
			nativeRequired: true,
			qualityMode: 'full',
			reason: 'empty-or-invalid-diff'
		};
	}
	if (
		files.some(
			file =>
				!file || typeof file.path !== 'string' || !hasSafeRegularModes(file)
		)
	) {
		return {
			nativeRequired: true,
			qualityMode: 'full',
			reason: 'unsafe-file-mode'
		};
	}

	let documentation = false;
	for (const {path} of files) {
		if (isSafeDocumentationPath(path)) {
			documentation = true;
			continue;
		}
		if (!isSafeMetadataPath(path)) {
			return {
				nativeRequired: true,
				qualityMode: 'full',
				reason: 'native-relevant-change'
			};
		}
	}

	return {
		nativeRequired: false,
		qualityMode: documentation ? 'docs' : 'metadata',
		reason: documentation ? 'safe-documentation-only' : 'safe-metadata-only'
	};
}

export function classifyChangedPaths(paths) {
	return classifyChangedFiles(
		Array.isArray(paths)
			? paths.map(path => ({
					newMode: regularMode,
					oldMode: regularMode,
					path,
					status: 'M'
				}))
			: paths
	);
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

function parseRawDiff(output) {
	const fields = output.split('\0');
	if (fields.at(-1) === '') {
		fields.pop();
	}
	if (fields.length === 0 || fields.length % 2 !== 0) {
		return undefined;
	}

	const files = [];
	for (let index = 0; index < fields.length; index += 2) {
		const header = fields[index].match(
			/^:(\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ ([A-Z])$/
		);
		const path = fields[index + 1];
		if (!header || !path) {
			return undefined;
		}
		files.push({
			oldMode: header[1],
			newMode: header[2],
			status: header[3],
			path
		});
	}
	return files;
}

function changedFiles(base, head) {
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
		return parseRawDiff(
			execFileSync(
				'git',
				['diff', '--raw', '--no-abbrev', '--no-renames', '-z', base, head],
				{encoding: 'utf8'}
			)
		);
	} catch {
		return undefined;
	}
}

function main() {
	const options = parseArgs(process.argv.slice(2));
	const result = classifyChangedFiles(changedFiles(options.base, options.head));
	appendFileSync(
		options.output,
		`native_required=${result.nativeRequired}\nquality_mode=${result.qualityMode}\nreason=${result.reason}\n`
	);
	console.log(
		`Change classification: native_required=${result.nativeRequired}, quality_mode=${result.qualityMode} (${result.reason}).`
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
