import assert from 'node:assert/strict';
import {readFile, rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {after, test} from 'node:test';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const {
	collectBundledAssets,
	collectElectronRuntime,
	collectNpmPackages,
	collectStoryFormats,
	generateComplianceArtifacts,
	verifyPackagedCompliance
} = require('../compliance-artifacts.cjs');
const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../..'
);
const temporaryRoots = [];
const electronVersion =
	require('../../node_modules/electron/package.json').version;
const runtimeVersions = {
	chrome: '150.0.0-test',
	electron: electronVersion,
	node: '24.0.0-test',
	v8: '15.0.0-test'
};

after(async () => {
	await Promise.all(
		temporaryRoots.map(root => rm(root, {force: true, recursive: true}))
	);
});

function cargoMetadataWithoutThirdParties() {
	const nativeId = 'path+file:///repo/twine_native#0.1.4';
	const wasmId = 'path+file:///repo/twine_wasm#0.1.4';

	return {
		packages: [
			{
				id: nativeId,
				license: 'GPL-3.0-only',
				manifest_path: path.join(
					rootDir,
					'crates',
					'twine_native',
					'Cargo.toml'
				),
				name: 'twine_native',
				version: '0.1.4'
			},
			{
				id: wasmId,
				license: 'GPL-3.0-only',
				manifest_path: path.join(rootDir, 'crates', 'twine_wasm', 'Cargo.toml'),
				name: 'twine_wasm',
				version: '0.1.4'
			}
		],
		resolve: {
			nodes: [
				{id: nativeId, deps: []},
				{id: wasmId, deps: []}
			]
		},
		workspace_members: [nativeId, wasmId]
	};
}

test('the story-format inventory is exhaustive and every format has an adjacent license', () => {
	const formats = collectStoryFormats(rootDir);

	assert.equal(formats.length, 24);
	assert.equal(new Set(formats.map(format => format.directory)).size, 24);
	assert.equal(
		formats.every(format => format.licenseFiles.length > 0),
		true
	);
	assert.deepEqual(
		formats
			.filter(format => format.name === 'Chapbook')
			.map(format => format.version),
		['1.2.3', '2.3.1']
	);
});

test('the npm inventory follows Electron Builder production dependency traversal', () => {
	const packages = collectNpmPackages(rootDir);

	assert.equal(packages.length, 83);
	assert.equal(
		packages.every(pkg => pkg.name && pkg.version && pkg.license),
		true
	);
	assert.equal(
		packages.some(pkg => pkg.name === 'jsonp'),
		true
	);
	assert.equal(
		packages.some(pkg => pkg.name === 'electron'),
		false
	);
	assert.equal(
		packages.some(pkg => pkg.name === 'jest'),
		false
	);
	assert.equal(
		packages.some(pkg => pkg.name === 'typescript'),
		false
	);
	assert.equal(
		packages.some(pkg => pkg.name === '@types/react'),
		false
	);
});

test('the runtime and bundled font inventories include their distributable notices', () => {
	const runtime = collectElectronRuntime(rootDir, runtimeVersions);
	const assets = collectBundledAssets(rootDir);

	assert.deepEqual(
		runtime.map(component => component.name),
		['Electron', 'Chromium', 'Node.js', 'V8']
	);
	assert.equal(
		runtime.every(component => component.licenseFiles.length > 0),
		true
	);
	assert.deepEqual(
		assets.map(component => component.name),
		['Hanken Grotesk', 'JetBrains Mono', 'Space Grotesk']
	);
	assert.equal(
		assets.every(component => component.license === 'OFL-1.1'),
		true
	);
});

test('generated notices and SBOM are deterministic and package-verifiable', async () => {
	const first = path.join(
		os.tmpdir(),
		`twine-compliance-${process.pid}-${Date.now()}-first`
	);
	const second = `${first}-second`;
	temporaryRoots.push(first, second);

	const options = {
		cargo: cargoMetadataWithoutThirdParties(),
		rootDir,
		runtimeVersions
	};
	const counts = generateComplianceArtifacts({...options, outputDir: first});
	generateComplianceArtifacts({...options, outputDir: second});

	const firstNotices = await readFile(
		path.join(first, 'THIRD_PARTY_NOTICES.md')
	);
	const secondNotices = await readFile(
		path.join(second, 'THIRD_PARTY_NOTICES.md')
	);
	const firstBom = await readFile(path.join(first, 'sbom.cdx.json'));
	const secondBom = await readFile(path.join(second, 'sbom.cdx.json'));
	const firstChromiumLicenses = await readFile(
		path.join(first, 'LICENSES.chromium.html')
	);
	const secondChromiumLicenses = await readFile(
		path.join(second, 'LICENSES.chromium.html')
	);
	const applicationLicense = await readFile(path.join(rootDir, 'LICENSE'));
	const bom = JSON.parse(firstBom);

	assert.deepEqual(firstNotices, secondNotices);
	assert.deepEqual(firstBom, secondBom);
	assert.deepEqual(firstChromiumLicenses, secondChromiumLicenses);
	assert.deepEqual(
		firstChromiumLicenses,
		await readFile(
			path.join(rootDir, 'node_modules/electron/dist/LICENSES.chromium.html')
		)
	);
	assert.equal(counts.storyFormats, 24);
	assert.equal(counts.cargo, 0);
	assert.equal(counts.npm, 83);
	assert.equal(counts.runtime, 4);
	assert.equal(counts.assets, 3);
	assert.equal(bom.bomFormat, 'CycloneDX');
	assert.equal(bom.specVersion, '1.6');
	assert.equal(bom.components.length, counts.total);
	assert.equal(
		bom.components.some(component =>
			component.properties.some(
				property =>
					property.name === 'twine:story-format-directory' &&
					property.value === 'paperthin-1.0.0'
			)
		),
		true
	);
	assert.match(
		firstNotices.toString('utf8'),
		/npm:jsonp@0\.2\.1 \(jsonp-MIT\.txt\)/
	);
	assert.match(
		firstNotices.toString('utf8'),
		/Copyright \(c\) 2012 LearnBoost/
	);
	assert.doesNotMatch(
		firstNotices.toString('utf8'),
		/Declared licenses without separate upstream notice files/
	);
	assert.match(firstNotices.toString('utf8'), /LICENSES\.chromium\.html/);
	assert.match(firstNotices.toString('utf8'), /story-format:Harlowe@3\.3\.9/);

	const expectedFiles = {
		LICENSE: applicationLicense,
		'LICENSES.chromium.html': firstChromiumLicenses,
		'THIRD_PARTY_NOTICES.md': firstNotices,
		'sbom.cdx.json': firstBom
	};
	const packageEntries = [];
	const packagedFiles = new Map();
	let assetIndex = 0;
	for (const component of bom.components) {
		const ecosystem = component.properties.find(
			property => property.name === 'twine:ecosystem'
		)?.value;
		if (ecosystem === 'npm') {
			for (const property of component.properties.filter(
				property => property.name === 'twine:npm-package-path'
			)) {
				const entry = `${property.value}/package.json`;
				packageEntries.push(`/${entry}`);
				packagedFiles.set(
					entry,
					Buffer.from(
						JSON.stringify({name: component.name, version: component.version})
					)
				);
			}
		}
		if (ecosystem === 'asset') {
			const sourcePath = component.properties.find(
				property => property.name === 'twine:asset-source-path'
			).value;
			const entry = `assets/font-${assetIndex++}.woff2`;
			packageEntries.push(`/${entry}`);
			packagedFiles.set(entry, await readFile(path.join(rootDir, sourcePath)));
		}
	}
	const requested = [];
	const result = verifyPackagedCompliance({
		asarPath: '/package/resources/app.asar',
		expectedFiles,
		extractFile: (_asarPath, fileName) => {
			requested.push(fileName);
			return expectedFiles[fileName] ?? packagedFiles.get(fileName);
		},
		listPackage: () => packageEntries
	});

	assert.deepEqual(requested.slice(0, 4), [
		'LICENSE',
		'THIRD_PARTY_NOTICES.md',
		'sbom.cdx.json',
		'LICENSES.chromium.html'
	]);
	assert.equal(result.components, counts.total);
	const windowsRequested = [];
	assert.equal(
		verifyPackagedCompliance({
			asarPath: 'C:\\package\\resources\\app.asar',
			expectedFiles,
			extractFile: (_asarPath, fileName) => {
				windowsRequested.push(fileName);
				return (
					expectedFiles[fileName] ??
					packagedFiles.get(fileName.replaceAll('\\', '/'))
				);
			},
			listPackage: () =>
				packageEntries.map(entry => entry.replaceAll('/', '\\'))
		}).components,
		counts.total
	);
	assert.equal(
		windowsRequested.some(fileName => fileName.startsWith('node_modules\\')),
		true
	);
	assert.throws(
		() =>
			verifyPackagedCompliance({
				asarPath: '/package/resources/app.asar',
				expectedFiles,
				extractFile: (_asarPath, fileName) =>
					fileName === 'LICENSE'
						? Buffer.from('wrong')
						: expectedFiles[fileName],
				listPackage: () => packageEntries
			}),
		/packaged root \/LICENSE differs/
	);
	assert.throws(
		() =>
			verifyPackagedCompliance({
				asarPath: '/package/resources/app.asar',
				expectedFiles,
				extractFile: (_asarPath, fileName) => {
					if (fileName === 'node_modules/unlisted/package.json') {
						return Buffer.from(
							JSON.stringify({name: 'unlisted', version: '1.0.0'})
						);
					}
					return expectedFiles[fileName] ?? packagedFiles.get(fileName);
				},
				listPackage: () => [
					...packageEntries,
					'/node_modules/unlisted/package.json'
				]
			}),
		/packaged npm dependency identities differ/
	);
});
