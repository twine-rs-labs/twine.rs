import {webcrypto} from 'node:crypto';
import goldenManifest from './fixtures/package-export-v2.manifest.json';
import packageSchema from '../schemas/story-build-package-v2.schema.json';
import {
	createStoredZip,
	createStoredZipBlob,
	createStoryBuildPackageArchive,
	planPackageAssetPaths,
	sha256Hex,
	validatePackagePath,
	validatePackagePathCollisions
} from '../package-export';

const text = new TextEncoder();

async function blobBytes(blob: Blob) {
	if ('arrayBuffer' in blob && typeof blob.arrayBuffer === 'function')
		return new Uint8Array(await blob.arrayBuffer());

	return new Promise<Uint8Array>((resolve, reject) => {
		const reader = new FileReader();

		reader.onerror = () => reject(reader.error);
		reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
		reader.readAsArrayBuffer(blob);
	});
}

Object.defineProperty(globalThis, 'crypto', {
	configurable: true,
	value: webcrypto
});

describe('package export', () => {
	it('keeps the v2 golden manifest contract', () => {
		expect(goldenManifest).toMatchObject({
			type: 'twine.rs/story-build-package',
			version: 2,
			canonicalSource: expect.any(Array),
			derivedOutputs: expect.any(Array),
			completeness: {
				copiedAssetContents: expect.any(String),
				dynamicDependencies: expect.any(String),
				projectAssetBytes: expect.any(String),
				staticRuntimeDependencies: expect.any(String)
			}
		});
		expect(packageSchema.properties.completeness.properties).toEqual(
			expect.objectContaining({
				copiedAssetContents: expect.any(Object),
				dynamicDependencies: {const: 'not-evaluated'},
				projectAssetBytes: expect.any(Object),
				staticRuntimeDependencies: expect.any(Object)
			})
		);
	});

	it('includes binary assets and records checksums without content deduplication', async () => {
		const result = await createStoryBuildPackageArchive({
			assets: [
				{
					archivePath: 'assets/a.bin',
					bytes: new Uint8Array([0, 255, 1]),
					logicalPath: 'assets/a.bin',
					requiredByStaticReference: true,
					sha256: await sha256Hex(new Uint8Array([0, 255, 1])),
					sizeBytes: 3,
					status: 'included'
				},
				{
					archivePath: 'assets/b.bin',
					bytes: new Uint8Array([0, 255, 1]),
					logicalPath: 'assets/b.bin',
					requiredByStaticReference: false,
					sha256: await sha256Hex(new Uint8Array([0, 255, 1])),
					sizeBytes: 3,
					status: 'included'
				},
				{
					logicalPath: 'assets/missing.bin',
					reasonCode: 'unreadable',
					reasonMessage: 'Unavailable',
					requiredByStaticReference: false,
					status: 'failed'
				}
			],
			generatedAt: '2026-01-02T03:04:06.000Z',
			canonicalSource: [
				{
					bytes: text.encode('story'),
					mediaType: 'text/html',
					path: 'index.html'
				}
			],
			derivedOutputs: [],
			story: {name: 'Fixture'}
		});

		expect(result.archiveEntryPaths).toEqual([
			'SHA256SUMS',
			'_twine-package/manifest.json',
			'assets/a.bin',
			'assets/b.bin',
			'index.html'
		]);
		expect(result.manifest.assets).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					logicalPath: 'assets/a.bin',
					status: 'included'
				}),
				expect.objectContaining({
					logicalPath: 'assets/missing.bin',
					reasonCode: 'unreadable',
					status: 'failed'
				})
			])
		);
		expect(result.checksumSource).toContain(
			`${await sha256Hex(text.encode('story'))}  index.html`
		);
		expect(result.checksumSource).toContain(
			`${result.manifestHash}  _twine-package/manifest.json`
		);
		expect(result.checksumSource).not.toContain('SHA256SUMS');
	});

	it('rejects portability collisions and unsafe Windows names', () => {
		expect(() =>
			validatePackagePathCollisions(['assets/A.png', 'assets/a.png'])
		).toThrow('NFC case-folding');
		expect(() =>
			validatePackagePathCollisions(['assets/straße.txt', 'assets/STRASSE.txt'])
		).toThrow('NFC case-folding');
		expect(() =>
			validatePackagePathCollisions(['assets/σ.txt', 'assets/ς.txt'])
		).toThrow('NFC case-folding');
		expect(() =>
			validatePackagePathCollisions(['assets/file', 'assets/file/child'])
		).toThrow('both a file and directory');
		expect(() => planPackageAssetPaths(['assets/CON.txt'])).toThrow(
			'reserved on Windows'
		);
		for (const path of [
			'assets/com¹.TXT',
			'assets/COM².log',
			'assets/Com³',
			'assets/lpt¹.TXT',
			'assets/LPT².log',
			'assets/Lpt³'
		]) {
			expect(() => validatePackagePath(path)).toThrow('reserved on Windows');
		}
		expect(() => planPackageAssetPaths(['cover.png'])).toThrow('under assets');
		expect(() => planPackageAssetPaths(['assets/bad?.txt'])).toThrow(
			'forbidden by portable filesystems'
		);
		expect(() =>
			validatePackagePathCollisions(['assets/\ud800.txt', 'assets/\ud801.txt'])
		).toThrow('unpaired UTF-16 surrogate');
		expect(() => planPackageAssetPaths(['assets/\ud800'])).toThrow(
			'unpaired UTF-16 surrogate'
		);
		expect(() =>
			validatePackagePathCollisions(['assets/Foo', 'assets/foo/bar.txt'])
		).toThrow('both a file and directory');
		expect(() =>
			validatePackagePathCollisions([
				'assets/straße',
				'assets/STRASSE/child.txt'
			])
		).toThrow('both a file and directory');
	});

	it('is deterministic across local timezones and has fixed UTC DOS timestamps', () => {
		const entries = [{bytes: text.encode('x'), path: 'assets/x.txt'}];
		const zip = createStoredZip(entries, new Date('2026-01-02T03:04:06.000Z'));
		const view = new DataView(zip.buffer);
		expect(view.getUint16(6, true)).toBe(0x0800);
		expect(view.getUint16(10, true)).toBe((3 << 11) | (4 << 5) | 3);
		expect(view.getUint16(12, true)).toBe(((2026 - 1980) << 9) | (1 << 5) | 2);
		expect(view.getUint32(14, true)).toBe(0x8cdc1683);
		expect([...zip]).toEqual([
			...createStoredZip(entries, new Date('2026-01-02T03:04:06.000Z'))
		]);
	});

	it('assembles Blob ZIPs with bytes identical to the synchronous primitive', async () => {
		const entries = [
			{bytes: text.encode('alpha'), path: 'assets/a.txt'},
			{bytes: new Uint8Array([0, 255, 1, 128]), path: 'assets/β.bin'},
			{bytes: new Uint8Array(), path: 'empty'}
		];
		const timestamp = new Date('2026-01-02T03:04:06.000Z');
		const expected = createStoredZip(entries, timestamp);
		const archive = await createStoredZipBlob(entries, timestamp);

		expect(archive.type).toBe('application/zip');
		expect(await blobBytes(archive)).toEqual(expected);
	});

	it('fails explicitly when the package runtime has no Blob support', async () => {
		const originalBlob = globalThis.Blob;

		Object.defineProperty(globalThis, 'Blob', {
			configurable: true,
			value: undefined
		});
		try {
			await expect(
				createStoryBuildPackageArchive({
					assets: [],
					canonicalSource: [],
					derivedOutputs: [],
					story: {}
				})
			).rejects.toThrow('requires Blob support');
		} finally {
			Object.defineProperty(globalThis, 'Blob', {
				configurable: true,
				value: originalBlob
			});
		}
	});

	it('yields CRC work between bounded chunks', async () => {
		const schedule = jest.spyOn(globalThis, 'setTimeout');
		try {
			const data = new Uint8Array(1024 * 1024 + 1);
			data[data.length - 1] = 1;
			const timestamp = new Date('2026-01-02T03:04:06.000Z');
			const expected = createStoredZip(
				[{bytes: data, path: 'assets/large.bin'}],
				timestamp
			);
			const archive = await createStoredZipBlob(
				[{bytes: data, path: 'assets/large.bin'}],
				timestamp
			);

			expect(schedule).toHaveBeenCalledTimes(3);
			expect(await blobBytes(archive)).toEqual(expected);
		} finally {
			schedule.mockRestore();
		}
	});

	it('enforces classic ZIP entry and total-size limits', () => {
		expect(() =>
			createStoredZip(
				[{bytes: text.encode('1234'), path: 'a'}],
				new Date('2026-01-01T00:00:00Z'),
				{maxZipBytes: 1}
			)
		).toThrow('ZIP size');
		expect(() =>
			createStoredZip(
				[
					{bytes: text.encode('x'), path: 'a'},
					{bytes: text.encode('x'), path: 'b'}
				],
				new Date('2026-01-01T00:00:00Z'),
				{maxEntryCount: 1}
			)
		).toThrow('entry count');
	});

	it('enforces raw asset file, count, and total limits independently', async () => {
		const assetBytes = text.encode('abc');
		const input = {
			assets: [
				{
					archivePath: 'assets/a.bin',
					bytes: assetBytes,
					logicalPath: 'assets/a.bin',
					requiredByStaticReference: true,
					sha256: await sha256Hex(assetBytes),
					sizeBytes: assetBytes.length,
					status: 'included' as const
				}
			],
			canonicalSource: [],
			derivedOutputs: [],
			generatedAt: '2026-01-02T03:04:06.000Z',
			story: {}
		};

		await expect(
			createStoryBuildPackageArchive({
				...input,
				limits: {maxAssetFileBytes: 2}
			})
		).rejects.toThrow('per-file');
		await expect(
			createStoryBuildPackageArchive({
				...input,
				limits: {maxAssetFileCount: 0}
			})
		).rejects.toThrow('file count');
		await expect(
			createStoryBuildPackageArchive({
				...input,
				limits: {maxAssetTotalBytes: 2}
			})
		).rejects.toThrow('total limit');
	});

	it('rejects valid-looking supplied asset checksums that do not match their bytes', async () => {
		await expect(
			createStoryBuildPackageArchive({
				assets: [
					{
						archivePath: 'assets/a.bin',
						bytes: text.encode('a'),
						logicalPath: 'assets/a.bin',
						requiredByStaticReference: true,
						sha256:
							'0000000000000000000000000000000000000000000000000000000000000000',
						sizeBytes: 1,
						status: 'included'
					}
				],
				canonicalSource: [],
				derivedOutputs: [],
				generatedAt: '2026-01-02T03:04:06.000Z',
				story: {}
			})
		).rejects.toThrow('checksum mismatch');
	});

	it('deduplicates repeated logical requests and rejects conflicting results', async () => {
		const bytes = text.encode('x');
		const sha256 = await sha256Hex(bytes);
		const included = {
			archivePath: 'assets/a.txt',
			bytes,
			logicalPath: 'assets/a.txt',
			requiredByStaticReference: true,
			sha256,
			sizeBytes: 1,
			status: 'included' as const
		};
		const result = await createStoryBuildPackageArchive({
			assets: [included, included],
			canonicalSource: [],
			derivedOutputs: [],
			generatedAt: '2026-01-02T03:04:06.000Z',
			story: {}
		});

		expect(result.manifest.assets).toHaveLength(1);
		await expect(
			createStoryBuildPackageArchive({
				assets: [
					included,
					{
						...included,
						sha256:
							'0000000000000000000000000000000000000000000000000000000000000000'
					}
				],
				canonicalSource: [],
				derivedOutputs: [],
				generatedAt: '2026-01-02T03:04:06.000Z',
				story: {}
			})
		).rejects.toThrow('conflicting results');
	});

	it('enforces scoped completeness invariants and valid JSON serialization', async () => {
		const failure = {
			logicalPath: 'assets/missing.txt',
			reasonCode: 'missing' as const,
			reasonMessage: 'Missing',
			requiredByStaticReference: true,
			status: 'failed' as const
		};
		const result = await createStoryBuildPackageArchive({
			assets: [failure],
			canonicalSource: [],
			dependencies: [
				{
					disposition: 'not-evaluated',
					kind: 'dynamic-unknown',
					original: 'runtime-generated'
				}
			],
			derivedOutputs: [{bytes: text.encode('x'), path: 'index.html'}],
			generatedAt: '2026-01-02T03:04:06.000Z',
			snapshot: {id: undefined, source: 'fixture'},
			story: {optional: undefined}
		});

		expect(JSON.parse(result.manifestSource)).toEqual(result.manifest);
		expect(result.manifest.completeness).toEqual({
			copiedAssetContents: 'not-evaluated',
			dynamicDependencies: 'not-evaluated',
			projectAssetBytes: 'incomplete',
			staticRuntimeDependencies: 'unknown'
		});
		await expect(
			createStoryBuildPackageArchive({
				assets: [failure],
				canonicalSource: [],
				completeness: {
					copiedAssetContents: 'not-evaluated',
					dynamicDependencies: 'not-evaluated',
					projectAssetBytes: 'complete',
					staticRuntimeDependencies: 'complete'
				},
				derivedOutputs: [],
				generatedAt: '2026-01-02T03:04:06.000Z',
				story: {}
			})
		).rejects.toThrow('cannot claim complete');
	});

	it('does not count documented platform-junk exclusions as missing project bytes', async () => {
		const result = await createStoryBuildPackageArchive({
			assets: [
				{
					logicalPath: 'assets/.DS_Store',
					reasonCode: 'excluded',
					reasonMessage: 'Known platform metadata is excluded.',
					requiredByStaticReference: false,
					status: 'failed'
				}
			],
			canonicalSource: [],
			derivedOutputs: [],
			generatedAt: '2026-01-02T03:04:06.000Z',
			story: {}
		});

		expect(result.manifest.completeness.projectAssetBytes).toBe('complete');
	});

	it('counts a statically referenced platform-junk exclusion as incomplete', async () => {
		const result = await createStoryBuildPackageArchive({
			assets: [
				{
					logicalPath: 'assets/._cover.png',
					reasonCode: 'excluded',
					reasonMessage: 'Known platform metadata is excluded.',
					requiredByStaticReference: true,
					status: 'failed'
				}
			],
			canonicalSource: [],
			derivedOutputs: [],
			generatedAt: '2026-01-02T03:04:06.000Z',
			story: {}
		});

		expect(result.manifest.completeness.projectAssetBytes).toBe('incomplete');
	});

	it('redacts host-local paths and totally orders equal-original dependencies', async () => {
		const dependencies = [
			{
				disposition: 'external' as const,
				kind: 'remote-resource' as const,
				original: '//cdn.example/app.js',
				sourceLocation: 'Story.html:script[0]@src'
			},
			{
				disposition: 'packaged' as const,
				kind: 'managed-local' as const,
				original: '../media/cover.png',
				sourceLocation: 'assets/styles/theme.css:css-url@25'
			},
			{
				disposition: 'blocked' as const,
				kind: 'unsafe-local' as const,
				original: 'file:///Users/example/secret.png',
				sourceLocation: 'C:\\private\\story.twee'
			},
			{
				disposition: 'not-evaluated' as const,
				kind: 'dynamic-unknown' as const,
				original: 'same'
			},
			{
				disposition: 'external' as const,
				kind: 'remote-resource' as const,
				original: 'same'
			}
		];
		const create = (ordered: typeof dependencies) =>
			createStoryBuildPackageArchive({
				assets: [
					{
						logicalPath: 'assets/missing.txt',
						reasonCode: 'unreadable',
						reasonMessage: 'Could not read /private/tmp/secret.txt',
						requiredByStaticReference: false,
						status: 'failed'
					}
				],
				canonicalSource: [],
				dependencies: ordered,
				derivedOutputs: [],
				generatedAt: '2026-01-02T03:04:06.000Z',
				snapshot: {source: '/opt/private-project'},
				story: {
					etcPath: '/etc/passwd',
					mntPath: '/mnt/project/story',
					name: 'Fixture',
					rootPath: '/root/secret',
					sourcePath: '/Users/example/project/story',
					traversal: '../outside',
					uncPath: '\\\\server\\share\\secret'
				}
			});
		const first = await create(dependencies);
		const second = await create([...dependencies].reverse());

		expect(first.manifestSource).toBe(second.manifestSource);
		expect(first.manifestSource).not.toMatch(
			/\/Users\/|\/private\/tmp|\/root\/|\/etc\/|\/opt\/|\/mnt\/|file:\/\/|C:\\|server\\share/
		);
		expect(first.manifest.story).toEqual(
			expect.objectContaining({traversal: '[redacted-local-path]'})
		);
		expect(first.manifest.dependencies).toContainEqual(
			expect.objectContaining({
				kind: 'managed-local',
				original: '../media/cover.png'
			})
		);
		expect(first.manifest.dependencies).toContainEqual(
			expect.objectContaining({
				kind: 'remote-resource',
				original: '//cdn.example/app.js'
			})
		);
	});
});
