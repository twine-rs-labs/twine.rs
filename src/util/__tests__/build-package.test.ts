import {createHash, webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {
	buildAssetCopyPlan,
	createAssetCompleteStoryBuildPackage,
	createStoryBuildPackage,
	filePathFromFileUrl,
	safeBuildAssetOutputPath
} from '../build-package';
import {inlineReferencedAssets} from '../inline-assets';
import {
	fakeAppInfo,
	fakeStory,
	fakeStoryFormatProperties,
	unsupportedLegacyEditorFormatProperties
} from '../../test-util';
import type {CoreAssetInventoryEntry} from '../../core/bindings/CoreAssetInventoryEntry';
import type {StoryFormatProperties} from '../../store/story-formats';
import {assetReferencesInSource} from '../../core/asset-paths';

Object.defineProperty(globalThis, 'crypto', {
	configurable: true,
	value: webcrypto
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

	if (!properties) {
		throw new Error(`No story format manifest found in ${path}`);
	}

	return properties;
}

function asset(
	props: Partial<CoreAssetInventoryEntry> = {}
): CoreAssetInventoryEntry {
	return {
		durationMs: null,
		exists: true,
		height: null,
		kind: 'image',
		missing: false,
		modifiedAt: null,
		normalizedPath: 'assets/cover.png',
		path: 'assets/cover.png',
		previewUrl: 'file:///tmp/cover.png',
		publish: {
			copy: true,
			outputPath: 'assets/cover.png',
			reason: 'Copy asset into published output'
		},
		referenceCount: 1,
		references: [],
		sizeBytes: 12,
		snippet: {
			label: 'Insert asset reference',
			mediaType: 'image',
			text: '<img src="assets/cover.png" alt="">'
		},
		thumbnailUrl: 'file:///tmp/cover.png',
		unused: false,
		width: null,
		...props
	};
}

function editorMigrationBuildStory(name: string, version: string) {
	const story = fakeStory(2);

	Object.assign(story, {
		id: 'editor-migration-story',
		ifid: '11111111-2222-4333-8444-555555555555',
		name: 'Editor Migration Fixture',
		script: 'window.fixtureReady = true;',
		selected: false,
		snapToGrid: false,
		startPassage: 'start',
		storyFormat: name,
		storyFormatVersion: version,
		stylesheet: 'body { color: #123456; }',
		tagColors: {fixture: 'blue'},
		tags: ['migration', 'fixture'],
		zoom: 1
	});
	Object.assign(story.passages[0], {
		height: 100,
		highlighted: false,
		id: 'start',
		left: 100,
		name: 'Start',
		selected: false,
		story: story.id,
		tags: ['fixture'],
		text: 'Welcome to [[Second]].',
		top: 200,
		width: 100
	});
	Object.assign(story.passages[1], {
		height: 120,
		highlighted: false,
		id: 'second',
		left: 320,
		name: 'Second',
		selected: false,
		story: story.id,
		tags: [],
		text: 'The second passage.',
		top: 240,
		width: 140
	});
	return story;
}

describe('M6 build package', () => {
	it.each([
		['Chapbook', '2.3.1', 'chapbook-2.3.1'],
		['Harlowe', '3.3.9', 'harlowe-3.3.9'],
		['Paperthin', '1.0.0', 'paperthin-1.0.0'],
		['Snowman', '2.1.1', 'snowman-2.1.1'],
		['SugarCube', '2.37.3', 'sugarcube-2.37.3']
	])(
		'builds unchanged play, test, and publish HTML with the bundled %s runtime',
		(name, version, fixture) => {
			const story = fakeStory();
			const properties = bundledFormatProperties(fixture);

			story.storyFormat = name;
			story.storyFormatVersion = version;

			for (const target of ['play', 'test', 'publish'] as const) {
				const result = createStoryBuildPackage(story, fakeAppInfo(), {
					formatProperties: properties,
					target
				});

				expect(result.html).toContain('<tw-storydata');
				expect(result.html).toContain(`format="${name}"`);
				expect(result.html).toContain(`format-version="${version}"`);
				expect(result.report.target).toBe(target);
			}
		}
	);

	it('matches the frozen runtime output matrix across the editor migration', () => {
		const appInfo = fakeAppInfo({
			name: 'twine.rs',
			twineCompatibilityVersion: '2.12.0',
			version: '0.1.4'
		});
		const formats = [
			['Chapbook', '2.3.1', bundledFormatProperties('chapbook-2.3.1')],
			['Harlowe', '3.3.9', bundledFormatProperties('harlowe-3.3.9')],
			['Paperthin', '1.0.0', bundledFormatProperties('paperthin-1.0.0')],
			['Snowman', '2.1.1', bundledFormatProperties('snowman-2.1.1')],
			['SugarCube', '2.37.3', bundledFormatProperties('sugarcube-2.37.3')],
			[
				'Unsupported Legacy Editor',
				'1.0.0',
				unsupportedLegacyEditorFormatProperties()
			]
		] as const;
		const matrix = formats.flatMap(([name, version, properties]) => {
			const story = editorMigrationBuildStory(name, version);

			return (['play', 'test', 'publish'] as const).map(target => {
				const html = createStoryBuildPackage(story, appInfo, {
					formatProperties: properties,
					target
				}).html;

				return [
					name,
					version,
					target,
					createHash('sha256').update(html).digest('hex')
				];
			});
		});
		const proofProperties = bundledFormatProperties('paperthin-1.0.0');

		for (const [name, version] of formats) {
			const proofHtml = createStoryBuildPackage(
				editorMigrationBuildStory(name, version),
				appInfo,
				{formatProperties: proofProperties, target: 'proof'}
			).html;

			matrix.push([
				name,
				version,
				'proof-via-paperthin',
				createHash('sha256').update(proofHtml).digest('hex')
			]);
		}
		expect(
			createHash('sha256').update(JSON.stringify(matrix)).digest('hex')
		).toMatchInlineSnapshot(
			`"b2c45ee09f194fb227c906a38971e53f9aa273573da56ea42e43550af333428e"`
		);
	});

	it('builds proof HTML with the unchanged bundled Paperthin runtime', () => {
		const result = createStoryBuildPackage(fakeStory(), fakeAppInfo(), {
			formatProperties: bundledFormatProperties('paperthin-1.0.0'),
			target: 'proof'
		});

		expect(result.html).toContain('<tw-storydata');
		expect(result.report.target).toBe('proof');
	});

	it('creates a copy plan from publishable asset inventory', () => {
		expect(filePathFromFileUrl('file:///tmp/cover%20art.png')).toBe(
			'/tmp/cover art.png'
		);
		expect(safeBuildAssetOutputPath('./assets/cover.png')).toBe(
			'assets/cover.png'
		);
		expect(() => safeBuildAssetOutputPath('../cover.png')).toThrow();

		expect(buildAssetCopyPlan([asset()])).toEqual([
			expect.objectContaining({
				outputPath: 'assets/cover.png',
				path: 'assets/cover.png',
				sourcePath: '/tmp/cover.png'
			})
		]);
	});

	it('builds preview packages with report metadata', () => {
		const story = fakeStory();
		const properties = fakeStoryFormatProperties();
		const result = createStoryBuildPackage(story, fakeAppInfo(), {
			assetInventory: [asset()],
			formatProperties: properties,
			target: 'play'
		});

		expect(result.html).toContain('<tw-storydata');
		expect(result.assets).toHaveLength(1);
		expect(result.files).toEqual([
			expect.objectContaining({
				kind: 'html',
				role: 'primary'
			})
		]);
		expect(result.report).toEqual(
			expect.objectContaining({
				assetCount: 1,
				assetMode: 'external',
				availableAssetSourceCount: 1,
				externalAssetCount: 1,
				outputCount: 1,
				publishSafe: true,
				target: 'play'
			})
		);
	});

	it('reports prepared referenced-media embedding in playable HTML', () => {
		const story = fakeStory();
		const path = 'assets/cover.png';
		const passage = story.passages[0];

		passage.text = `<img src="${path}">`;
		const inventory = asset({
			path,
			normalizedPath: path,
			previewUrl: null,
			thumbnailUrl: null,
			references: [
				{
					context: 'html-src',
					end: 10 + path.length,
					fragment: null,
					kind: 'image',
					line: 1,
					original: path,
					passageId: passage.id,
					path,
					query: null,
					sourceId: passage.id,
					sourceName: passage.name,
					start: 10
				}
			]
		});
		const transformed = inlineReferencedAssets({
			assetInventory: [inventory],
			payloads: [
				{bytes: new Uint8Array([0, 1, 255]), mediaType: 'image/png', path}
			],
			story
		});
		const result = createStoryBuildPackage(transformed.story, fakeAppInfo(), {
			assetEmbeddingReport: transformed.report,
			assetInventory: [inventory],
			assetMode: 'inline-referenced',
			formatProperties: fakeStoryFormatProperties(),
			target: 'export-html'
		});

		expect(result.html).toContain('data:image/png;base64,AAH/');
		expect(result.report).toEqual(
			expect.objectContaining({
				assetInliningComplete: true,
				assetMode: 'inline-referenced',
				externalAssetCount: 0,
				inlinedAssetCount: 1,
				inlinedEncodedBytes: 26,
				inlinedSourceBytes: 3
			})
		);
		expect(result.report.fidelity.preserves).toContain(
			'supported statically referenced project media as data URLs'
		);
		expect(story.passages[0].text).toContain(path);
	});

	it.each([
		['Chapbook', '2.3.1', 'chapbook-2.3.1'],
		['Harlowe', '3.3.9', 'harlowe-3.3.9'],
		['Snowman', '2.1.1', 'snowman-2.1.1'],
		['SugarCube', '2.37.3', 'sugarcube-2.37.3']
	])(
		'embeds the format-neutral referenced-media fixture in bundled %s',
		(name, version, fixture) => {
			const story = fakeStory();
			const passage = story.passages[0];

			story.storyFormat = name;
			story.storyFormatVersion = version;
			passage.text = [
				'<img src="assets/cover image.png">',
				'<audio src="assets/theme.ogg"></audio>',
				'<video poster="assets/poster.webp"></video>',
				'<img src="assets/cover image.png">'
			].join('');
			story.script = 'window.media = "assets/clip.webm";';
			story.stylesheet = 'body { background: url("assets/background.svg"); }';
			const original = {
				passage: passage.text,
				script: story.script,
				stylesheet: story.stylesheet
			};
			const references = [
				...assetReferencesInSource(
					passage.id,
					passage.name,
					passage.text,
					passage.id
				),
				...assetReferencesInSource(
					`${story.id}:script`,
					'Story JavaScript',
					story.script,
					null
				),
				...assetReferencesInSource(
					`${story.id}:stylesheet`,
					'Story Stylesheet',
					story.stylesheet,
					null
				)
			];
			const referencesByPath = new Map<string, typeof references>();

			for (const reference of references) {
				referencesByPath.set(reference.path, [
					...(referencesByPath.get(reference.path) ?? []),
					reference
				]);
			}

			const inventory = Array.from(
				referencesByPath,
				([path, assetReferences]) =>
					asset({
						kind: path.endsWith('.ogg')
							? 'audio'
							: path.endsWith('.webm')
								? 'video'
								: 'image',
						normalizedPath: path.toLowerCase(),
						path,
						previewUrl: null,
						publish: {
							copy: true,
							outputPath: path,
							reason: 'Referenced media'
						},
						referenceCount: assetReferences.length,
						references: assetReferences,
						sizeBytes: 3,
						thumbnailUrl: null
					})
			);
			const mediaType = (path: string) =>
				path.endsWith('.png')
					? 'image/png'
					: path.endsWith('.svg')
						? 'image/svg+xml'
						: path.endsWith('.webp')
							? 'image/webp'
							: path.endsWith('.ogg')
								? 'audio/ogg'
								: 'video/webm';
			const transformed = inlineReferencedAssets({
				assetInventory: inventory,
				payloads: inventory.map(({path}) => ({
					bytes: new Uint8Array([0, 1, 255]),
					mediaType: mediaType(path),
					path
				})),
				story
			});
			const result = createStoryBuildPackage(transformed.story, fakeAppInfo(), {
				assetEmbeddingReport: transformed.report,
				assetInventory: inventory,
				assetMode: 'inline-referenced',
				formatProperties: bundledFormatProperties(fixture),
				target: 'export-html'
			});

			expect(result.report.assetInliningComplete).toBe(true);
			expect(result.report.inlinedAssetCount).toBe(5);
			expect(result.report.inlinedReferenceCount).toBe(6);
			expect(result.html).toContain('data:image/png;base64,AAH/');
			expect(result.html).not.toContain('assets/');
			expect(passage.text).toBe(original.passage);
			expect(story.script).toBe(original.script);
			expect(story.stylesheet).toBe(original.stylesheet);
		}
	);

	it('builds JSON export packages without rendering story format HTML', () => {
		const story = fakeStory();
		const result = createStoryBuildPackage(story, fakeAppInfo(), {
			formatProperties: fakeStoryFormatProperties(),
			target: 'export-json'
		});

		expect(result.html).toBe('');
		expect(result.files).toEqual([
			expect.objectContaining({
				kind: 'json',
				role: 'primary'
			})
		]);
		expect(JSON.parse(result.files[0].contents as string)).toEqual(
			expect.objectContaining({
				id: story.id,
				ifid: story.ifid,
				name: story.name
			})
		);
		expect(result.report.fidelity.preserves).toContain(
			'current story store fields'
		);
	});

	it('can compact JSON export packages', () => {
		const result = createStoryBuildPackage(fakeStory(), fakeAppInfo(), {
			formatProperties: fakeStoryFormatProperties(),
			jsonPretty: false,
			target: 'export-json'
		});

		expect(result.files[0].contents as string).not.toContain('\n  ');
	});

	it('builds package targets with a v2 manifest, checksums, and asset bytes', async () => {
		const story = fakeStory();
		const assetBytes = new Uint8Array([0, 1, 255]);
		const result = await createAssetCompleteStoryBuildPackage(
			story,
			fakeAppInfo(),
			{
				assetInventory: [asset({referenceCount: 0, unused: true})],
				formatProperties: fakeStoryFormatProperties(),
				generatedAt: '2026-01-02T03:04:06.000Z',
				packageAssets: [
					{
						archivePath: 'assets/cover.png',
						bytes: assetBytes,
						logicalPath: 'assets/cover.png',
						requiredByStaticReference: true,
						sha256: createHash('sha256').update(assetBytes).digest('hex'),
						sizeBytes: assetBytes.length,
						status: 'included'
					}
				],
				target: 'package'
			}
		);
		const manifest = JSON.parse(result.files[0].contents as string);
		const archiveEntryPaths = result.packageArchive?.archiveEntryPaths ?? [];

		expect(result.files.map(file => file.kind)).toEqual([
			'package-manifest',
			'archive',
			'checksums',
			'html',
			'json',
			'twee'
		]);
		expect(manifest).toEqual(
			expect.objectContaining({
				type: 'twine.rs/story-build-package',
				version: 2,
				story: expect.objectContaining({id: story.id})
			})
		);
		expect(manifest.assets).toEqual([
			expect.objectContaining({
				archivePath: 'assets/cover.png',
				logicalPath: 'assets/cover.png',
				sha256: createHash('sha256').update(assetBytes).digest('hex'),
				status: 'included'
			})
		]);
		expect(result.files[1]).toEqual(
			expect.objectContaining({
				filename: `${story.name}.zip`,
				mediaType: 'application/zip'
			})
		);
		expect(result.files[1].sizeBytes).toBeGreaterThan(0);
		expect(archiveEntryPaths).toContain('assets/cover.png');
		expect(archiveEntryPaths).toContain('SHA256SUMS');
		expect(archiveEntryPaths).not.toContain('asset-copy-plan.json');
		expect(result.html).toContain('twine.rs/story-graph/v1');
		expect(result.report.outputs.map(output => output.kind)).toEqual([
			'package-manifest',
			'archive',
			'checksums',
			'html',
			'json',
			'twee'
		]);
		expect(result.report.diagnostics).toEqual([
			expect.objectContaining({
				code: 'package-dependency-dynamic-unknown',
				severity: 'info'
			})
		]);
		expect(result.report.fidelity.preserves).toContain(
			'bounded project asset bytes with SHA-256 checksums'
		);
		expect(result.packageArchive?.archiveEntryPaths).toEqual(
			expect.arrayContaining([
				'assets/cover.png',
				'_twine-package/manifest.json',
				'SHA256SUMS'
			])
		);
	});

	it('uses portable collision-free output names for difficult story titles', async () => {
		for (const name of [
			'Manifest',
			'MANIFEST',
			'CON',
			'cOm¹',
			'COM²',
			'com³',
			'lPt¹',
			'LPT²',
			'lpt³',
			'cOm¹.Title',
			'lPt².log',
			'Broken\ud800Name',
			'A'.repeat(500),
			'Cafe\u0301'
		]) {
			const story = fakeStory();

			story.name = name;
			const result = await createAssetCompleteStoryBuildPackage(
				story,
				fakeAppInfo(),
				{
					formatProperties: fakeStoryFormatProperties(),
					generatedAt: '2026-01-02T03:04:06.000Z',
					packageAssets: [],
					target: 'package'
				}
			);
			const paths = result.packageArchive?.archiveEntryPaths;

			expect(paths).toContain('_twine-package/manifest.json');
			expect(
				paths?.every(path => new TextEncoder().encode(path).length <= 240)
			).toBe(true);
			if (name === 'CON') expect(paths).toContain('CON-story.json');
			if (['cOm¹', 'COM²', 'com³', 'lPt¹', 'LPT²', 'lpt³'].includes(name))
				expect(paths).toContain(`${name}-story.json`);
			if (name === 'cOm¹.Title')
				expect(paths).toContain('cOm¹-story.Title.json');
			if (name === 'lPt².log') expect(paths).toContain('lPt²-story.log.json');
			if (name === 'Broken\ud800Name')
				expect(paths).toContain('Broken_Name.json');
			if (name === 'Cafe\u0301') expect(paths).toContain('Café.json');
		}

		const manifestStory = fakeStory();
		manifestStory.name = 'Manifest';
		const manifestResult = await createAssetCompleteStoryBuildPackage(
			manifestStory,
			fakeAppInfo(),
			{
				formatProperties: fakeStoryFormatProperties(),
				generatedAt: '2026-01-02T03:04:06.000Z',
				packageAssets: [],
				target: 'package'
			}
		);

		expect(manifestResult.packageArchive?.archiveEntryPaths).toEqual(
			expect.arrayContaining(['Manifest.json', '_twine-package/manifest.json'])
		);
	});

	it('rewrites only the derived runtime clone and preserves canonical source', async () => {
		const story = fakeStory();
		const original = 'cover art.png?size=2#hero';
		const source = `<img src="${original}">`;
		const passage = story.passages[0];

		passage.text = source;
		const assetBytes = new Uint8Array([1, 2, 3]);
		const result = await createAssetCompleteStoryBuildPackage(
			story,
			fakeAppInfo(),
			{
				assetInventory: [
					asset({
						normalizedPath: 'assets/cover art.png',
						path: 'assets/cover art.png',
						publish: {
							copy: true,
							outputPath: 'assets/cover art.png',
							reason: 'Copy asset into published output'
						},
						references: [
							{
								context: 'html-src',
								end: source.indexOf(original) + original.length,
								fragment: '#hero',
								kind: 'image',
								line: 1,
								original,
								passageId: passage.id,
								path: 'assets/cover art.png',
								query: '?size=2',
								sourceId: passage.id,
								sourceName: passage.name,
								start: source.indexOf(original)
							}
						]
					})
				],
				formatProperties: fakeStoryFormatProperties(),
				generatedAt: '2026-01-02T03:04:06.000Z',
				packageAssets: [
					{
						archivePath: 'assets/cover art.png',
						bytes: assetBytes,
						logicalPath: 'assets/cover art.png',
						requiredByStaticReference: true,
						sha256: createHash('sha256').update(assetBytes).digest('hex'),
						sizeBytes: assetBytes.length,
						status: 'included'
					}
				],
				target: 'package'
			}
		);
		const json = result.files.find(file => file.kind === 'json')!;
		const twee = result.files.find(file => file.kind === 'twee')!;

		expect(result.html).toContain('assets/cover%20art.png?size=2#hero');
		expect(JSON.parse(json.contents as string).passages[0].text).toBe(source);
		expect(twee.contents as string).toContain(source);
		expect(story.passages[0].text).toBe(source);
		expect(result.report.packageManifest?.dependencies).toContainEqual(
			expect.objectContaining({
				disposition: 'packaged',
				kind: 'managed-local'
			})
		);
	});

	it('rewrites entity-spelled asset references only in derived package HTML', async () => {
		const story = fakeStory();
		const passage = story.passages[0];
		const ampOriginal = 'hero&amp;retina.png&#63;rev=1&amp;x=2&num;face';
		const commaOriginal = 'hero&comma;retina.webp';
		const source = [
			`<img src="${ampOriginal}">`,
			`<img srcset="${commaOriginal} 2x">`
		].join('');
		const specs = [
			{
				fragment: '&num;face',
				logicalPath: 'assets/hero&retina.png',
				original: ampOriginal,
				query: '&#63;rev=1&amp;x=2'
			},
			{
				fragment: null,
				logicalPath: 'assets/hero,retina.webp',
				original: commaOriginal,
				query: null
			}
		] as const;

		passage.text = source;
		const references = assetReferencesInSource(
			passage.id,
			passage.name,
			source,
			passage.id
		);

		expect(references).toEqual(
			expect.arrayContaining(
				specs.map(({fragment, logicalPath, original, query}, index) =>
					expect.objectContaining({
						context: index === 0 ? 'html-src' : 'html-srcset',
						fragment,
						original,
						path: logicalPath,
						query
					})
				)
			)
		);
		const packageAssets = specs.map(({logicalPath}, index) => {
			const bytes = new Uint8Array([index + 1]);

			return {
				archivePath: logicalPath,
				bytes,
				logicalPath,
				requiredByStaticReference: true,
				sha256: createHash('sha256').update(bytes).digest('hex'),
				sizeBytes: bytes.length,
				status: 'included' as const
			};
		});
		const inventory = specs.map(({logicalPath}) => {
			const assetReferences = references.filter(
				reference => reference.path === logicalPath
			);

			return asset({
				normalizedPath: logicalPath,
				path: logicalPath,
				publish: {
					copy: true,
					outputPath: logicalPath,
					reason: 'Copy asset into published output'
				},
				referenceCount: assetReferences.length,
				references: assetReferences
			});
		});
		const result = await createAssetCompleteStoryBuildPackage(
			story,
			fakeAppInfo(),
			{
				assetInventory: inventory,
				formatProperties: fakeStoryFormatProperties(),
				generatedAt: '2026-01-02T03:04:06.000Z',
				packageAssets,
				target: 'package'
			}
		);
		const json = result.files.find(file => file.kind === 'json')!;
		const twee = result.files.find(file => file.kind === 'twee')!;

		expect(result.html).toContain(
			'assets/hero%26retina.png&amp;#63;rev=1&amp;amp;x=2&amp;num;face'
		);
		expect(result.html).toContain('assets/hero%2Cretina.webp 2x');
		expect(result.packageArchive?.archiveEntryPaths).toEqual(
			expect.arrayContaining(specs.map(({logicalPath}) => logicalPath))
		);
		expect(JSON.parse(json.contents as string).passages[0].text).toBe(source);
		expect(twee.contents as string).toContain(source);
		expect(story.passages[0].text).toBe(source);
		expect(result.report.packageManifest?.dependencies).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					disposition: 'packaged',
					kind: 'managed-local',
					original: 'assets/hero%26retina.png?rev=1&x=2#face'
				}),
				expect.objectContaining({
					disposition: 'packaged',
					kind: 'managed-local',
					original: 'assets/hero%2Cretina.webp'
				})
			])
		);
		expect(
			result.report.packageManifest?.completeness.staticRuntimeDependencies
		).toBe('complete');
	});

	it('rewrites arbitrary Core-indexed CSS asset references into the package', async () => {
		const story = fakeStory();
		const original = 'font.woff2';
		const source = `@font-face { font-family: Fixture; src: url("${original}"); }`;
		const fontBytes = new Uint8Array([0, 1, 0, 0, 70, 79, 78, 84]);

		story.stylesheet = source;
		const inventory = asset({
			kind: 'file',
			normalizedPath: 'assets/font.woff2',
			path: 'assets/font.woff2',
			previewUrl: null,
			publish: {
				copy: true,
				outputPath: 'assets/font.woff2',
				reason: 'Copy asset into published output'
			},
			references: assetReferencesInSource(
				`${story.id}:stylesheet`,
				'Story Stylesheet',
				source,
				null
			),
			sizeBytes: fontBytes.length,
			thumbnailUrl: null
		});
		const result = await createAssetCompleteStoryBuildPackage(
			story,
			fakeAppInfo(),
			{
				assetInventory: [inventory],
				formatProperties: fakeStoryFormatProperties(),
				generatedAt: '2026-01-02T03:04:06.000Z',
				packageAssets: [
					{
						archivePath: 'assets/font.woff2',
						bytes: fontBytes,
						logicalPath: 'assets/font.woff2',
						requiredByStaticReference: true,
						sha256: createHash('sha256').update(fontBytes).digest('hex'),
						sizeBytes: fontBytes.length,
						status: 'included'
					}
				],
				target: 'package'
			}
		);

		expect(result.html).toContain('url("assets/font.woff2")');
		expect(result.report.packageManifest?.dependencies).toContainEqual(
			expect.objectContaining({
				disposition: 'packaged',
				kind: 'managed-local',
				original: 'assets/font.woff2'
			})
		);
		expect(
			result.report.packageManifest?.completeness.staticRuntimeDependencies
		).toBe('complete');
	});

	it('rewrites tag-aware and mixed-srcset references only in derived package HTML', async () => {
		const story = fakeStory();
		const passage = story.passages[0];
		const source = [
			'<table background="table background.png?rev=6#tile"><tr><td>Legacy</td></tr></table>',
			'<link rel="preload" href="theme.bin?rev=2#main" as="font">',
			'<link rel="manifest" href="site.webmanifest">',
			'<object data="manual.pdf?edition=1#page"></object>',
			'<svg><image xlink:href="texture.ktx2?rev=1#layer"></image><use href="symbols.svg#check"></use><linearGradient href="gradient.svg#base"></linearGradient><mpath href="motion.svg#curve"></mpath></svg>',
			'<input type="image" src="button.png"><div src="inert.png" poster="inert-poster.png"></div>',
			'<a download href="book.epub?release=1#notes">Download</a>',
			'<img srcset="data:image/png;base64,AA== 1x, hero.webp?rev=1#face 2x">',
			'<link rel="preload" as="image" imagesrcset="small.webp 400w, hero,retina.webp?rev=4#wide 800w">',
			'<style>.hero{background:image-set("hero image.webp?rev=2#face" type("image/webp") 2x)}.legacy{background:-webkit-image-set("legacy.webp" 1x)}</style>',
			'<meta http-equiv="refresh" content="0; URL=\'next page.html?rev=5#start\'">'
		].join('');
		const specs = [
			['assets/table background.png', 'image'],
			['assets/theme.bin', 'file'],
			['assets/site.webmanifest', 'file'],
			['assets/manual.pdf', 'file'],
			['assets/texture.ktx2', 'file'],
			['assets/symbols.svg', 'image'],
			['assets/gradient.svg', 'image'],
			['assets/motion.svg', 'image'],
			['assets/button.png', 'image'],
			['assets/book.epub', 'file'],
			['assets/hero.webp', 'image'],
			['assets/small.webp', 'image'],
			['assets/hero,retina.webp', 'image'],
			['assets/hero image.webp', 'image'],
			['assets/legacy.webp', 'image'],
			['assets/next page.html', 'file']
		] as const;
		const references = assetReferencesInSource(
			passage.id,
			passage.name,
			source,
			passage.id
		);

		passage.text = source;
		const packageAssets = specs.map(([logicalPath], index) => {
			const bytes = new Uint8Array([index + 1]);

			return {
				archivePath: logicalPath,
				bytes,
				logicalPath,
				requiredByStaticReference: true,
				sha256: createHash('sha256').update(bytes).digest('hex'),
				sizeBytes: bytes.length,
				status: 'included' as const
			};
		});
		const inventory = specs.map(([logicalPath, kind]) =>
			asset({
				kind,
				normalizedPath: logicalPath,
				path: logicalPath,
				previewUrl: null,
				publish: {
					copy: true,
					outputPath: logicalPath,
					reason: 'Copy asset into published output'
				},
				references: references.filter(
					reference => reference.path === logicalPath
				),
				sizeBytes: 1,
				thumbnailUrl: null
			})
		);
		const result = await createAssetCompleteStoryBuildPackage(
			story,
			fakeAppInfo(),
			{
				assetInventory: inventory,
				formatProperties: fakeStoryFormatProperties(),
				generatedAt: '2026-01-02T03:04:06.000Z',
				packageAssets,
				target: 'package'
			}
		);
		const json = result.files.find(file => file.kind === 'json')!;
		const twee = result.files.find(file => file.kind === 'twee')!;

		for (const rewritten of [
			'assets/table%20background.png?rev=6#tile',
			'assets/theme.bin?rev=2#main',
			'assets/site.webmanifest',
			'assets/manual.pdf?edition=1#page',
			'assets/texture.ktx2?rev=1#layer',
			'assets/symbols.svg#check',
			'assets/gradient.svg#base',
			'assets/motion.svg#curve',
			'assets/button.png',
			'assets/book.epub?release=1#notes',
			'assets/hero.webp?rev=1#face',
			'assets/small.webp',
			'assets/hero%2Cretina.webp?rev=4#wide',
			'assets/hero%20image.webp?rev=2#face',
			'assets/legacy.webp',
			'assets/next%20page.html?rev=5#start'
		]) {
			expect(result.html).toContain(rewritten);
		}
		expect(result.html).toContain(
			'&lt;div src=&quot;inert.png&quot; poster=&quot;inert-poster.png&quot;&gt;&lt;/div&gt;'
		);
		expect(JSON.parse(json.contents as string).passages[0].text).toBe(source);
		expect(twee.contents as string).toContain(source);
		expect(story.passages[0].text).toBe(source);
		const runtimeDependencies =
			result.report.packageManifest?.dependencies.filter(
				dependency =>
					dependency.disposition === 'packaged' &&
					dependency.sourceLocation !== 'project asset inventory'
			) ?? [];

		expect(runtimeDependencies).toHaveLength(specs.length);
		expect(runtimeDependencies.map(dependency => dependency.original)).toEqual(
			expect.arrayContaining([
				'assets/theme.bin?rev=2#main',
				'assets/table%20background.png?rev=6#tile',
				'assets/site.webmanifest',
				'assets/manual.pdf?edition=1#page',
				'assets/texture.ktx2?rev=1#layer',
				'assets/symbols.svg#check',
				'assets/gradient.svg#base',
				'assets/motion.svg#curve',
				'assets/button.png',
				'assets/book.epub?release=1#notes',
				'assets/hero.webp?rev=1#face',
				'assets/small.webp',
				'assets/hero%2Cretina.webp?rev=4#wide',
				'assets/hero%20image.webp?rev=2#face',
				'assets/legacy.webp',
				'assets/next%20page.html?rev=5#start'
			])
		);
		expect(
			result.report.packageManifest?.completeness.staticRuntimeDependencies
		).toBe('complete');
	});

	it('reports active data documents as statically unknown without exposing their payloads', async () => {
		const story = fakeStory();
		const dataUrl =
			'data:text/html,%3Cimg%20src%3D%22https%3A%2F%2Fexample.com%2Fsecret.png%22%3E';

		story.passages[0].text = `<iframe src="${dataUrl}"></iframe>`;
		const result = await createAssetCompleteStoryBuildPackage(
			story,
			fakeAppInfo(),
			{
				formatProperties: fakeStoryFormatProperties(),
				generatedAt: '2026-01-02T03:04:06.000Z',
				packageAssets: [],
				target: 'package'
			}
		);
		const activeDataDiagnostic = result.report.diagnostics.find(
			diagnostic =>
				diagnostic.code === 'package-dependency-dynamic-unknown' &&
				diagnostic.severity === 'warning'
		);

		expect(activeDataDiagnostic).toEqual(
			expect.objectContaining({
				message: expect.stringContaining('active document or stylesheet')
			})
		);
		expect(activeDataDiagnostic?.message).not.toContain(dataUrl);
		expect(
			result.report.packageManifest?.completeness.staticRuntimeDependencies
		).toBe('unknown');
	});

	it('reports declarative redirects as automatic package dependencies', async () => {
		const remoteStory = fakeStory();
		const dataStory = fakeStory();
		const dataUrl = 'data:text/html,%3Ch1%3Eoffline%3F%3C%2Fh1%3E';

		remoteStory.passages[0].text =
			'<meta http-equiv="refresh" content="0; URL=https://example.com/next">';
		dataStory.passages[0].text = `<meta http-equiv="refresh" content="0; URL=${dataUrl}">`;
		const [remote, activeData] = await Promise.all(
			[remoteStory, dataStory].map(story =>
				createAssetCompleteStoryBuildPackage(story, fakeAppInfo(), {
					formatProperties: fakeStoryFormatProperties(),
					generatedAt: '2026-01-02T03:04:06.000Z',
					packageAssets: [],
					target: 'package'
				})
			)
		);

		expect(remote.report.diagnostics).toContainEqual(
			expect.objectContaining({
				code: 'package-dependency-remote-resource',
				severity: 'warning'
			})
		);
		expect(
			remote.report.packageManifest?.completeness.staticRuntimeDependencies
		).toBe('incomplete');
		const dataDiagnostic = activeData.report.diagnostics.find(
			diagnostic => diagnostic.code === 'package-dependency-dynamic-unknown'
		);

		expect(dataDiagnostic).toEqual(
			expect.objectContaining({severity: 'warning'})
		);
		expect(dataDiagnostic?.message).not.toContain(dataUrl);
		expect(
			activeData.report.packageManifest?.completeness.staticRuntimeDependencies
		).toBe('unknown');
	});

	it('rejects Package through the synchronous legacy builder', () => {
		expect(() =>
			createStoryBuildPackage(fakeStory(), fakeAppInfo(), {
				assetInventory: [asset()],
				formatProperties: fakeStoryFormatProperties(),
				target: 'package'
			} as unknown as Parameters<typeof createStoryBuildPackage>[2])
		).toThrow('createAssetCompleteStoryBuildPackage');
	});

	it('promotes package asset read failures into build diagnostics', async () => {
		const result = await createAssetCompleteStoryBuildPackage(
			fakeStory(),
			fakeAppInfo(),
			{
				assetInventory: [
					asset({
						previewUrl: null,
						referenceCount: 0,
						thumbnailUrl: null,
						unused: true
					})
				],
				formatProperties: fakeStoryFormatProperties(),
				packageAssets: [
					{
						logicalPath: 'assets/cover.png',
						reasonCode: 'unreadable',
						reasonMessage: 'The file could not be read.',
						requiredByStaticReference: true,
						status: 'failed'
					}
				],
				target: 'package'
			}
		);

		expect(result.report.diagnostics).toEqual([
			expect.objectContaining({
				code: 'package-asset-unreadable',
				outputPath: 'assets/cover.png',
				severity: 'warning'
			}),
			expect.objectContaining({
				code: 'package-dependency-dynamic-unknown',
				severity: 'info'
			})
		]);
		expect(result.report.packageManifest?.completeness.projectAssetBytes).toBe(
			'incomplete'
		);
	});

	it('keeps unavailable managed dependencies saveable as incomplete warnings', async () => {
		const result = await createAssetCompleteStoryBuildPackage(
			fakeStory(),
			fakeAppInfo(),
			{
				formatProperties: fakeStoryFormatProperties(),
				packageAssets: [],
				packageDependencies: [
					{
						disposition: 'blocked',
						kind: 'managed-local',
						original: 'assets/missing.png',
						sourceLocation: 'Story.html:img[0]@src'
					}
				],
				target: 'package'
			}
		);

		expect(result.report.diagnostics).toContainEqual(
			expect.objectContaining({
				code: 'package-dependency-managed-local',
				severity: 'warning'
			})
		);
		expect(result.report.diagnostics).not.toContainEqual(
			expect.objectContaining({severity: 'error'})
		);
		expect(
			result.report.packageManifest?.completeness.staticRuntimeDependencies
		).toBe('incomplete');
	});

	it('reports missing assets as non-blocking warnings', () => {
		const result = createStoryBuildPackage(fakeStory(), fakeAppInfo(), {
			assetInventory: [
				asset({
					exists: false,
					missing: true
				})
			],
			formatProperties: fakeStoryFormatProperties(),
			target: 'export-html'
		});

		expect(result.files[0].kind).toBe('html');
		expect(result.report.diagnostics).toEqual([
			expect.objectContaining({
				code: 'missing-asset',
				severity: 'warning'
			})
		]);
	});

	it('builds HTML compatibility exports without twine.rs StoryData graph metadata', () => {
		const result = createStoryBuildPackage(fakeStory(), fakeAppInfo(), {
			formatProperties: fakeStoryFormatProperties(),
			htmlCompatibility: true,
			target: 'export-html'
		});

		expect(result.files.map(file => file.kind)).toEqual(['html']);
		expect(result.files[0].contents as string).not.toContain(
			'data-twine-rs-story-graph'
		);
		expect(result.report.fidelity.omits).toContain(
			'twine.rs StoryData graph metadata carrier'
		);
		expect(result.report.diagnostics).toEqual([]);
	});

	it('builds default HTML exports with twine.rs StoryData graph metadata', () => {
		const result = createStoryBuildPackage(fakeStory(), fakeAppInfo(), {
			formatProperties: fakeStoryFormatProperties(),
			target: 'export-html'
		});

		expect(result.files[0].contents as string).toContain(
			'data-twine-rs-story-graph'
		);
		expect(result.report.fidelity.preserves).toContain(
			'twine.rs StoryData graph metadata carrier'
		);
	});

	it('blocks publish packages when dev-only format code would ship', async () => {
		const story = fakeStory();
		const properties = {
			...fakeStoryFormatProperties(),
			source: '{{STORY_DATA}}<script>import.meta.hot</script>'
		};

		expect(() =>
			createStoryBuildPackage(story, fakeAppInfo(), {
				formatProperties: properties,
				target: 'publish'
			})
		).toThrow('not publish-safe');

		expect(() =>
			createStoryBuildPackage(story, fakeAppInfo(), {
				formatProperties: properties,
				target: 'export-html'
			})
		).toThrow('not publish-safe');

		expect(() =>
			createStoryBuildPackage(story, fakeAppInfo(), {
				formatProperties: properties,
				htmlCompatibility: true,
				target: 'export-html'
			})
		).toThrow('not publish-safe');

		await expect(
			createAssetCompleteStoryBuildPackage(story, fakeAppInfo(), {
				formatProperties: properties,
				packageAssets: [],
				target: 'package'
			})
		).rejects.toThrow('not publish-safe');

		expect(() =>
			createStoryBuildPackage(story, fakeAppInfo(), {
				formatProperties: properties,
				target: 'test'
			})
		).not.toThrow();
	});
});
