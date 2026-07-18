#!/usr/bin/env node

import {readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..'
);
const assetsDir = path.join(repoRoot, 'electron-build', 'renderer', 'assets');
const indexPath = path.join(
	repoRoot,
	'electron-build',
	'renderer',
	'index.html'
);
const referencePath = path.join(
	repoRoot,
	'benchmarks',
	'reference',
	'editor-bundle-codemirror5.json'
);
const removedRuntimeMarkers = [
	'CodeMirror, copyright',
	'CodeMirror.version',
	'codemirror/lib/codemirror',
	'react-codemirror2',
	'version:"5.65.16"'
];
const reference = JSON.parse(await readFile(referencePath, 'utf8'));
const indexHtml = await readFile(indexPath, 'utf8');
const assetNames = Array.from(
	new Set(
		Array.from(
			indexHtml.matchAll(/[./]*assets\/([^"'?]+\.(?:css|js))/g),
			match => match[1]
		)
	)
).sort();

if (assetNames.length === 0) {
	throw new Error(
		`No production CSS or JavaScript assets referenced by ${indexPath}`
	);
}

const assets = await Promise.all(
	assetNames.map(async name => {
		const contents = await readFile(path.join(assetsDir, name));
		const source = contents.toString('utf8');

		return {
			gzipBytes: gzipSync(contents).byteLength,
			legacyRuntimeMarkers: removedRuntimeMarkers.filter(marker =>
				source.includes(marker)
			),
			name,
			rawBytes: contents.byteLength
		};
	})
);
const gzipBytes = assets.reduce((total, asset) => total + asset.gzipBytes, 0);
const rawBytes = assets.reduce((total, asset) => total + asset.rawBytes, 0);
const reductionBytes = reference.gzipBytes - gzipBytes;
const reductionPercent = (reductionBytes / reference.gzipBytes) * 100;
const legacyRuntimeMatches = assets.flatMap(asset =>
	asset.legacyRuntimeMarkers.map(marker => `${asset.name}: ${marker}`)
);
const result = {
	assets: assets.map(({legacyRuntimeMarkers, ...asset}) => asset),
	gzipBytes,
	legacyRuntimeMatches,
	passed: gzipBytes < reference.gzipBytes && legacyRuntimeMatches.length === 0,
	rawBytes,
	referenceGzipBytes: reference.gzipBytes,
	reductionBytes,
	reductionPercent
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

if (!result.passed) {
	throw new Error(
		legacyRuntimeMatches.length > 0
			? `Production renderer contains removed CodeMirror 5 markers:\n${legacyRuntimeMatches.join('\n')}`
			: `Production renderer is ${gzipBytes} gzip bytes; expected less than the CodeMirror 5 reference (${reference.gzipBytes})`
	);
}
