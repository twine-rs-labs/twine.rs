#!/usr/bin/env node

import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
	baselineCandidateErrors,
	readJson,
	writeJson
} from './performance-tools.mjs';
import {createPerformanceReferenceSummary, sha256} from './reference-tools.mjs';

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..'
);
const args = process.argv.slice(2);
const sourceArg = args[args.indexOf('--from') + 1];
const outputArg = args[args.indexOf('--out') + 1];

if (
	!sourceArg ||
	sourceArg.startsWith('--') ||
	!outputArg ||
	outputArg.startsWith('--')
) {
	throw new Error(
		'Usage: create-reference-summary.mjs --from <performance-report.json> --out <reference-summary.json>'
	);
}

const source = path.resolve(repoRoot, sourceArg);
const output = path.resolve(repoRoot, outputArg);
const sourceBytes = await readFile(source);
const report = JSON.parse(sourceBytes);
const budgets = await readJson(
	path.join(repoRoot, 'benchmarks', 'budgets.json')
);
const errors = baselineCandidateErrors(report, budgets);

if (errors.length > 0) {
	throw new Error(
		`Cannot create a reference summary:\n- ${errors.join('\n- ')}`
	);
}

const sourceReportFile = path
	.relative(repoRoot, source)
	.split(path.sep)
	.join('/');
const summary = createPerformanceReferenceSummary(report, {
	sourceReportFile,
	sourceReportSha256: sha256(sourceBytes)
});

await writeJson(output, summary);
process.stdout.write(`Created reference summary: ${output}\n`);
