import {createHash, webcrypto} from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, relative} from 'node:path';
import {
	clearImmediate as nodeClearImmediate,
	setImmediate as nodeSetImmediate
} from 'node:timers';
import extractZip from 'extract-zip';
import type {CoreAssetInventoryEntry} from '../../core';
import type {StoryFormatProperties} from '../../store/story-formats';
import type {StoryWithDocuments} from '../../store/stories';
import {createAssetCompleteStoryBuildPackage} from '../build-package';

Object.defineProperty(globalThis, 'crypto', {
	configurable: true,
	value: webcrypto
});
Object.assign(globalThis, {
	clearImmediate: nodeClearImmediate,
	setImmediate: nodeSetImmediate
});

function bundledFormatProperties(path: string): StoryFormatProperties {
	let properties: StoryFormatProperties | undefined;
	const source = readFileSync(
		join(process.cwd(), 'public', 'story-formats', path, 'format.js'),
		'utf8'
	);

	new Function('window', source)({
		storyFormat(value: StoryFormatProperties) {
			properties = value;
		}
	});

	if (!properties) throw new Error(`No story format manifest found in ${path}`);
	return properties;
}

function inventoryAsset(
	path: string,
	kind: string,
	sizeBytes: number,
	originalRoot: string
): CoreAssetInventoryEntry {
	return {
		durationMs: null,
		exists: true,
		height: null,
		kind,
		missing: false,
		modifiedAt: null,
		normalizedPath: path,
		path,
		previewUrl: `file://${originalRoot}/${path}`,
		publish: {
			copy: true,
			outputPath: path,
			reason: 'Copy asset into published output'
		},
		referenceCount: 1,
		references: [],
		sizeBytes,
		snippet: {label: 'Asset', mediaType: kind, text: path},
		thumbnailUrl: null,
		unused: false,
		width: null
	};
}

function filesUnder(root: string, directory = root): string[] {
	return readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
		const path = join(directory, entry.name);

		return entry.isDirectory()
			? filesUnder(root, path)
			: [relative(root, path).replace(/\\/g, '/')];
	});
}

function sha256(bytes: Uint8Array | Buffer) {
	return createHash('sha256').update(bytes).digest('hex');
}

async function blobBytes(blob: Blob) {
	if ('arrayBuffer' in blob && typeof blob.arrayBuffer === 'function') {
		return Buffer.from(await blob.arrayBuffer());
	}

	return new Promise<Buffer>((resolve, reject) => {
		const reader = new FileReader();

		reader.onerror = () => reject(reader.error);
		reader.onload = () => resolve(Buffer.from(reader.result as ArrayBuffer));
		reader.readAsArrayBuffer(blob);
	});
}

describe('asset-complete Package offline acceptance', () => {
	it('extracts into a clean directory with every claimed byte and no source-root dependency', async () => {
		expect(typeof DOMParser).toBe('function');
		const runRoot = mkdtempSync(join(tmpdir(), 'twine-package-offline-'));
		const offlineRoot = join(runRoot, 'clean-offline-copy');
		const zipPath = join(runRoot, 'package.zip');
		const originalRoot = '/Users/example/Original Moon Castle.twine.rs';
		const coverBytes = Buffer.from(
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
			'base64'
		);
		const cssBytes = Buffer.from(
			'body { background-image: url("../media/cover.png"); }\n',
			'utf8'
		);
		const story: StoryWithDocuments = {
			id: 'offline-package-story',
			ifid: '11111111-2222-4333-8444-555555555555',
			lastUpdate: new Date('2026-01-02T03:04:05.000Z'),
			name: 'Offline Package',
			passages: [
				{
					height: 100,
					highlighted: false,
					id: 'start',
					left: 100,
					name: 'Start',
					selected: false,
					story: 'offline-package-story',
					tags: [],
					text: [
						'<link rel="stylesheet" href="assets/styles/theme.css">',
						'<img src="assets/media/cover.png" alt="Moon castle">'
					].join(''),
					top: 100,
					width: 100
				}
			],
			script: '',
			selected: true,
			snapToGrid: false,
			startPassage: 'start',
			storyFormat: 'Paperthin',
			storyFormatVersion: '1.0.0',
			stylesheet: '',
			tagColors: {},
			tags: [],
			zoom: 1
		};
		const inventory = [
			inventoryAsset(
				'assets/media/cover.png',
				'image',
				coverBytes.length,
				originalRoot
			),
			inventoryAsset(
				'assets/styles/theme.css',
				'stylesheet',
				cssBytes.length,
				originalRoot
			)
		];

		for (const asset of inventory) {
			const start = story.passages[0].text.indexOf(asset.path);

			asset.references = [
				{
					context: asset.kind === 'stylesheet' ? 'html-href' : 'html-src',
					end: start + asset.path.length,
					fragment: null,
					kind: asset.kind,
					line: 1,
					original: asset.path,
					passageId: story.passages[0].id,
					path: asset.path,
					query: null,
					sourceId: story.passages[0].id,
					sourceName: story.passages[0].name,
					start
				}
			];
		}

		try {
			const result = await createAssetCompleteStoryBuildPackage(
				story,
				{
					name: 'twine.rs',
					twineCompatibilityVersion: '2.12.0',
					version: '0.2.0'
				},
				{
					assetInventory: inventory,
					formatProperties: bundledFormatProperties('paperthin-1.0.0'),
					generatedAt: '2026-01-02T03:04:06.000Z',
					packageAssets: [
						{
							archivePath: 'assets/media/cover.png',
							bytes: coverBytes,
							logicalPath: 'assets/media/cover.png',
							mediaType: 'image/png',
							requiredByStaticReference: true,
							sha256: sha256(coverBytes),
							sizeBytes: coverBytes.length,
							status: 'included'
						},
						{
							archivePath: 'assets/styles/theme.css',
							bytes: cssBytes,
							logicalPath: 'assets/styles/theme.css',
							mediaType: 'text/css',
							requiredByStaticReference: true,
							sha256: sha256(cssBytes),
							sizeBytes: cssBytes.length,
							status: 'included'
						}
					],
					packageSnapshot: {
						contentFingerprint: 'a'.repeat(64),
						generation: 7,
						inventoryFingerprint: 'b'.repeat(64),
						revision: 12,
						sessionInstanceId: 'offline-test-session',
						source: originalRoot
					},
					target: 'package'
				}
			);
			const archive = result.files.find(file => file.role === 'primary');

			expect(archive?.contents).toBeInstanceOf(Blob);
			writeFileSync(zipPath, await blobBytes(archive!.contents as Blob));
			mkdirSync(offlineRoot);
			await extractZip(zipPath, {dir: offlineRoot});

			const manifest = JSON.parse(
				readFileSync(join(offlineRoot, '_twine-package/manifest.json'), 'utf8')
			);
			const claimedPaths = [
				...manifest.canonicalSource.map((entry: {path: string}) => entry.path),
				...manifest.derivedOutputs.map((entry: {path: string}) => entry.path),
				...manifest.assets
					.filter((entry: {status: string}) => entry.status === 'included')
					.map((entry: {archivePath: string}) => entry.archivePath)
			];
			const actualPaths = filesUnder(offlineRoot).sort();

			expect(actualPaths).toEqual(
				[...claimedPaths, '_twine-package/manifest.json', 'SHA256SUMS'].sort()
			);
			for (const path of claimedPaths) {
				expect(existsSync(join(offlineRoot, path))).toBe(true);
				expect(statSync(join(offlineRoot, path)).isFile()).toBe(true);
			}
			const manifestFileRecords = [
				...manifest.canonicalSource,
				...manifest.derivedOutputs,
				...manifest.assets
					.filter((entry: {status: string}) => entry.status === 'included')
					.map(
						(entry: {
							archivePath: string;
							sha256: string;
							sizeBytes: number;
						}) => ({
							path: entry.archivePath,
							sha256: entry.sha256,
							sizeBytes: entry.sizeBytes
						})
					)
			] as Array<{path: string; sha256: string; sizeBytes: number}>;

			for (const record of manifestFileRecords) {
				const extracted = readFileSync(join(offlineRoot, record.path));

				expect(extracted.byteLength).toBe(record.sizeBytes);
				expect(sha256(extracted)).toBe(record.sha256);
			}

			const checksumLines = readFileSync(
				join(offlineRoot, 'SHA256SUMS'),
				'utf8'
			)
				.trim()
				.split('\n');
			const checksummedPaths = checksumLines.map(line => line.slice(66));

			expect(checksummedPaths.sort()).toEqual(
				actualPaths.filter(path => path !== 'SHA256SUMS').sort()
			);
			for (const line of checksumLines) {
				const expectedHash = line.slice(0, 64);
				const path = line.slice(66);

				expect(line.slice(64, 66)).toBe('  ');
				expect(sha256(readFileSync(join(offlineRoot, path)))).toBe(
					expectedHash
				);
			}

			expect(readFileSync(join(offlineRoot, 'assets/media/cover.png'))).toEqual(
				coverBytes
			);
			expect(
				readFileSync(join(offlineRoot, 'assets/styles/theme.css'), 'utf8')
			).toContain('../media/cover.png');
			const html = readFileSync(
				join(offlineRoot, 'Offline Package.html'),
				'utf8'
			);

			expect(html).toContain('assets/styles/theme.css');
			expect(html).toContain('assets/media/cover.png');
			expect(manifest.completeness).toEqual({
				copiedAssetContents: 'partially-evaluated',
				dynamicDependencies: 'not-evaluated',
				projectAssetBytes: 'complete',
				staticRuntimeDependencies: 'complete'
			});
			expect(
				manifest.dependencies.filter(
					(dependency: {kind: string}) => dependency.kind === 'managed-local'
				)
			).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						disposition: 'packaged',
						original: '../media/cover.png'
					}),
					expect.objectContaining({
						disposition: 'packaged',
						original: 'assets/media/cover.png'
					}),
					expect.objectContaining({
						disposition: 'packaged',
						original: 'assets/styles/theme.css'
					})
				])
			);

			const originalRootBytes = Buffer.from(originalRoot, 'utf8');

			for (const path of actualPaths) {
				expect(
					readFileSync(join(offlineRoot, path)).includes(originalRootBytes)
				).toBe(false);
			}
		} finally {
			rmSync(runRoot, {force: true, recursive: true});
		}
	});
});
