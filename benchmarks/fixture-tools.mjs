import {createHash} from 'node:crypto';
import {mkdir, readdir, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';

export const performanceFixtureAssets = {
	'pixel.svg':
		'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="#7c3aed"/></svg>\n',
	'readme.txt':
		'Deterministic asset used by the Electron performance harness.\n'
};

export function parseFixtureSizes(argv, fallback = '10000,50000') {
	const sizeFlag = argv.indexOf('--sizes');
	const raw = sizeFlag >= 0 ? argv[sizeFlag + 1] : fallback;
	const sizes = raw
		.split(',')
		.map(value => Number.parseInt(value.trim(), 10))
		.filter(value => Number.isInteger(value) && value > 0);

	if (sizes.length === 0) {
		throw new Error('--sizes must contain at least one positive integer.');
	}
	return sizes;
}

export function performanceFixtureManifest(
	sourceManifest,
	{projectPath, sourcePath}
) {
	return {
		...sourceManifest,
		assets: Object.keys(performanceFixtureAssets)
			.sort()
			.map(filename => `assets/perf/${filename}`),
		projectPath,
		sourcePath
	};
}

export async function writePerformanceFixtureAssets(projectPath) {
	const assetRoot = path.join(projectPath, 'assets', 'perf');

	await mkdir(assetRoot, {recursive: true});
	await Promise.all(
		Object.entries(performanceFixtureAssets).map(([filename, contents]) =>
			writeFile(path.join(assetRoot, filename), contents)
		)
	);
}

export async function treeMetadataFingerprint(rootPath) {
	const hash = createHash('sha256');
	const pending = [''];

	while (pending.length > 0) {
		const relativeDirectory = pending.pop();
		const absoluteDirectory = path.join(rootPath, relativeDirectory);
		const entries = await readdir(absoluteDirectory, {withFileTypes: true});

		entries.sort((left, right) => left.name.localeCompare(right.name));
		for (const entry of entries) {
			const relativePath = path.join(relativeDirectory, entry.name);

			if (entry.isDirectory()) {
				pending.push(relativePath);
				continue;
			}

			const metadata = await stat(path.join(rootPath, relativePath));

			hash.update(relativePath.replaceAll(path.sep, '/'));
			hash.update('\0');
			hash.update(String(metadata.size));
			hash.update('\0');
			hash.update(String(metadata.mtimeMs));
			hash.update('\n');
		}
	}

	return hash.digest('hex');
}
