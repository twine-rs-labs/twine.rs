#!/usr/bin/env node

import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
	aggregateSamples,
	evaluatePerformanceReport,
	machineFingerprint,
	markdownReport,
	readJson,
	writeJson
} from './performance-tools.mjs';

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..'
);
const args = process.argv.slice(2);
const input = args[args.indexOf('--input') + 1];

if (!input || input.startsWith('--')) {
	throw new Error('Usage: report-performance.mjs --input <raw-report.json>');
}

const reportPath = path.resolve(repoRoot, input);
const raw = await readJson(reportPath);
const budgets = await readJson(
	path.join(repoRoot, 'benchmarks', 'budgets.json')
);
const fingerprint = machineFingerprint(raw.environment);
const baselinePath = path.join(
	repoRoot,
	'benchmarks',
	'results',
	'baselines',
	`${fingerprint}-${raw.fixture.passageCount}.json`
);
let baseline;

if (!raw.smoke && !raw.diagnostic) {
	try {
		baseline = await readJson(baselinePath);
	} catch (error) {
		if (error.code !== 'ENOENT') {
			throw error;
		}
	}
}

const report = {
	...raw,
	aggregates: aggregateSamples(raw.samples),
	budgets,
	environment: {...raw.environment, fingerprint}
};

report.evaluation = evaluatePerformanceReport(report, budgets, baseline);
await writeJson(reportPath, report);
await writeFile(reportPath.replace(/\.json$/, '.md'), markdownReport(report));
process.stdout.write(`${reportPath}\n`);

if (!report.evaluation.passed) {
	process.exitCode = 1;
}
