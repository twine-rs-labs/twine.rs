#!/usr/bin/env node

import {spawnSync} from 'node:child_process';
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
	chapbookPerformancePassageText,
	parseFixtureSizes,
	parseFixtureVariant,
	performanceFixtureManifest,
	performanceFixtureVariantRoot,
	performanceFixtureVariants,
	writePerformanceFixtureAssets
} from './fixture-tools.mjs';

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..'
);
const generatedRoot = path.join(
	repoRoot,
	'benchmarks',
	'fixtures',
	'generated'
);
const cliArgs = process.argv.slice(2);
const fixtureVariant = parseFixtureVariant(cliArgs);
const fixtureVariantRoot = performanceFixtureVariantRoot(
	generatedRoot,
	fixtureVariant
);
const sourceRoot = path.join(fixtureVariantRoot, 'sources');
const projectRoot = path.join(fixtureVariantRoot, 'projects');
const fixtureVariantConfig = performanceFixtureVariants[fixtureVariant];

async function prepareVariantSource(source) {
	if (fixtureVariant !== 'chapbook') {
		return;
	}

	const story = JSON.parse(await readFile(source, 'utf8'));
	const measuredPassage = story.passages.find(
		passage => passage.id === story.startPassage
	);

	if (!measuredPassage) {
		throw new Error('Chapbook fixture has no start passage to expand.');
	}
	measuredPassage.text = chapbookPerformancePassageText(measuredPassage.text);
	await writeFile(source, `${JSON.stringify(story, null, 2)}\n`);
}

function run(command, args) {
	const result = spawnSync(command, args, {
		cwd: repoRoot,
		encoding: 'utf8',
		stdio: 'inherit'
	});

	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(' ')} failed.`);
	}
}

async function prepare(size) {
	const source = path.join(sourceRoot, `story-${size}.story.json`);
	const project = path.join(projectRoot, `story-${size}.twine.rs`);
	const sourceManifest = path.join(sourceRoot, `story-${size}.manifest.json`);

	run(process.execPath, [
		path.join(repoRoot, 'benchmarks', 'generate-fixtures.mjs'),
		'--sizes',
		String(size),
		'--formats',
		'json',
		'--story-format',
		fixtureVariantConfig.storyFormat,
		'--story-format-version',
		fixtureVariantConfig.storyFormatVersion,
		'--out',
		path.relative(repoRoot, sourceRoot)
	]);
	await prepareVariantSource(source);

	await rm(project, {force: true, recursive: true});
	await mkdir(projectRoot, {recursive: true});
	run('cargo', [
		'run',
		'-q',
		'-p',
		'twine_cli',
		'--release',
		'--',
		'import',
		source,
		project
	]);

	await writePerformanceFixtureAssets(project);

	const manifest = JSON.parse(await readFile(sourceManifest, 'utf8'));
	const perfManifest = performanceFixtureManifest(manifest, {
		fixtureVariant,
		projectPath: path.relative(repoRoot, project),
		sourcePath: path.relative(repoRoot, source)
	});

	await writeFile(
		path.join(projectRoot, `story-${size}.perf.json`),
		`${JSON.stringify(perfManifest, null, 2)}\n`
	);
	process.stdout.write(`Prepared ${fixtureVariant} ${size}: ${project}\n`);
}

try {
	for (const size of parseFixtureSizes(cliArgs)) {
		await prepare(size);
	}
} catch (error) {
	process.stderr.write(`${error.message}\n`);
	process.exitCode = 1;
}
