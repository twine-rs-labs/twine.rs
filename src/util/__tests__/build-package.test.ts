import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {
	buildAssetCopyPlan,
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

	it('builds package targets with a manifest, compatibility outputs, and assets', () => {
		const story = fakeStory();
		const result = createStoryBuildPackage(story, fakeAppInfo(), {
			assetInventory: [asset()],
			formatProperties: fakeStoryFormatProperties(),
			target: 'package'
		});
		const manifest = JSON.parse(result.files[0].contents as string);
		const archive = result.files[1].contents as Uint8Array;
		const archiveText = Array.from(archive, byte =>
			String.fromCharCode(byte)
		).join('');

		expect(result.files.map(file => file.kind)).toEqual([
			'package-manifest',
			'archive',
			'html',
			'json',
			'twee'
		]);
		expect(manifest).toEqual(
			expect.objectContaining({
				type: 'twine.rs/story-build-package',
				story: expect.objectContaining({id: story.id})
			})
		);
		expect(manifest.assets).toEqual([
			expect.objectContaining({outputPath: 'assets/cover.png'})
		]);
		expect(result.files[1]).toEqual(
			expect.objectContaining({
				filename: `${story.name}.zip`,
				mediaType: 'application/zip'
			})
		);
		expect([...archive.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
		expect(archiveText).toContain('asset-copy-plan.json');
		expect(archiveText).toContain('twine.rs/story-graph/v1');
		expect(result.report.outputs.map(output => output.kind)).toEqual([
			'package-manifest',
			'archive',
			'html',
			'json',
			'twee'
		]);
		expect(result.report.diagnostics).toEqual([]);
		expect(result.report.fidelity.omits).toContain(
			'project asset file bytes; the archive contains an asset copy plan only'
		);
	});

	it('promotes package asset-source gaps into build diagnostics', () => {
		const result = createStoryBuildPackage(fakeStory(), fakeAppInfo(), {
			assetInventory: [
				asset({
					previewUrl: null,
					thumbnailUrl: null
				})
			],
			formatProperties: fakeStoryFormatProperties(),
			target: 'package'
		});

		expect(result.report.diagnostics).toEqual([
			expect.objectContaining({
				code: 'asset-copy-source-missing',
				outputPath: 'assets/cover.png',
				severity: 'warning'
			})
		]);
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

	it('blocks publish packages when dev-only format code would ship', () => {
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

		expect(() =>
			createStoryBuildPackage(story, fakeAppInfo(), {
				formatProperties: properties,
				target: 'package'
			})
		).toThrow('not publish-safe');

		expect(() =>
			createStoryBuildPackage(story, fakeAppInfo(), {
				formatProperties: properties,
				target: 'test'
			})
		).not.toThrow();
	});
});
