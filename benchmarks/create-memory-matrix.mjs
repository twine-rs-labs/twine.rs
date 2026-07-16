#!/usr/bin/env node

import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
	createMemoryMatrix,
	selectLatestMemoryMatrixReports
} from './memory-matrix-tools.mjs';
import {writeJson} from './performance-tools.mjs';

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..'
);
const resultsRoot = path.join(repoRoot, 'benchmarks', 'results');
const args = process.argv.slice(2);
const fromArgs = args
	.map((arg, index) => (arg === '--from' ? args[index + 1] : undefined))
	.filter(value => value && !value.startsWith('--'));
const outputIndex = args.indexOf('--out');
const outputArg = outputIndex >= 0 ? args[outputIndex + 1] : undefined;

async function readReport(file) {
	return JSON.parse(await readFile(file, 'utf8'));
}

async function latestStartupReports() {
	const candidates = [];

	for (const entry of await readdir(resultsRoot)) {
		if (!entry.startsWith('electron-') || !entry.endsWith('.json')) {
			continue;
		}
		const file = path.join(resultsRoot, entry);
		let report;

		try {
			report = await readReport(file);
		} catch {
			continue;
		}
		if (
			report.phase === 'startup' &&
			!report.smoke &&
			report.test?.status === 'passed' &&
			report.environment?.metricContracts?.memoryAttribution === 1
		) {
			candidates.push({file, report});
		}
	}

	return selectLatestMemoryMatrixReports(candidates, {
		requireClean: args.includes('--require-clean')
	});
}

const inputs = fromArgs.length
	? await Promise.all(
			fromArgs.map(async entry => {
				const file = path.resolve(repoRoot, entry);

				return {file, report: await readReport(file)};
			})
		)
	: await latestStartupReports();
const matrix = createMemoryMatrix(
	inputs.map(input => input.report),
	{
		requireClean: args.includes('--require-clean'),
		sourceFiles: inputs.map(input =>
			path.relative(repoRoot, input.file).split(path.sep).join('/')
		)
	}
);
const output = outputArg
	? path.resolve(repoRoot, outputArg)
	: path.join(
			resultsRoot,
			`memory-matrix-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
		);

await writeJson(output, matrix);
process.stdout.write(`Created memory matrix: ${output}\n`);
process.stdout.write(`${JSON.stringify(matrix.decision, null, 2)}\n`);
