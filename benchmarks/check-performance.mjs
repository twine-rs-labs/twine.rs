#!/usr/bin/env node

import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
	baselineCandidateErrors,
	evaluatePerformanceReport,
	latestReport,
	readJson
} from './performance-tools.mjs';

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..'
);
const resultsDir = path.join(repoRoot, 'benchmarks', 'results');
const args = process.argv.slice(2);
const inputIndex = args.indexOf('--input');
const sizeIndex = args.indexOf('--size');
const size =
	sizeIndex >= 0 ? Number.parseInt(args[sizeIndex + 1], 10) : undefined;
const reportFile =
	inputIndex >= 0
		? path.resolve(repoRoot, args[inputIndex + 1])
		: await latestReport(resultsDir, size);

if (!reportFile) {
	throw new Error('No Electron performance report is available.');
}

const report = await readJson(reportFile);
const budgets = await readJson(
	path.join(repoRoot, 'benchmarks', 'budgets.json')
);
const baselineFile = path.join(
	resultsDir,
	'baselines',
	`${report.environment.fingerprint}-${report.fixture.passageCount}.json`
);
let baseline;

if (!report.smoke) {
	try {
		baseline = await readJson(baselineFile);
	} catch (error) {
		if (error.code !== 'ENOENT') {
			throw error;
		}
	}
}

const evaluation = evaluatePerformanceReport(report, budgets, baseline);
const completenessErrors = baselineCandidateErrors(
	{...report, evaluation},
	budgets
);

for (const check of evaluation.checks.filter(
	check => check.blocking && !check.passed
)) {
	process.stderr.write(`FAIL ${check.name}: ${check.detail}\n`);
}
for (const error of completenessErrors) {
	process.stderr.write(`FAIL report-completeness: ${error}\n`);
}

process.stdout.write(
	`${
		evaluation.passed && completenessErrors.length === 0 ? 'PASS' : 'FAIL'
	} ${reportFile} (baseline: ${evaluation.baselineStatus})\n`
);
process.exitCode = evaluation.passed && completenessErrors.length === 0 ? 0 : 1;
