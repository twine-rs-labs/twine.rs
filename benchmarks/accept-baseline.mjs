#!/usr/bin/env node

import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
	baselineCandidateErrors,
	performanceBaselinePath,
	readJson,
	writeJson
} from './performance-tools.mjs';

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..'
);
const args = process.argv.slice(2);
const sourceArg = args[args.indexOf('--from') + 1];

if (!sourceArg || sourceArg.startsWith('--')) {
	throw new Error(
		'Usage: accept-baseline.mjs --from <performance-report.json>'
	);
}

const source = path.resolve(repoRoot, sourceArg);
const report = await readJson(source);
const budgets = await readJson(
	path.join(repoRoot, 'benchmarks', 'budgets.json')
);
const errors = baselineCandidateErrors(report, budgets, {requireClean: true});

if (errors.length > 0) {
	throw new Error(`Cannot accept baseline:\n- ${errors.join('\n- ')}`);
}

const destination = performanceBaselinePath(
	path.join(repoRoot, 'benchmarks', 'results'),
	report
);

await writeJson(destination, report);
process.stdout.write(`Accepted baseline: ${destination}\n`);
