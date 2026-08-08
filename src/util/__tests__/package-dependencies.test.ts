import type {CoreAssetInventoryEntry} from '../../core/bindings/CoreAssetInventoryEntry';
import type {CoreAssetReference} from '../../core/bindings/CoreAssetReference';
import {assetReferencesInSource} from '../../core/asset-paths';
import {fakeStory} from '../../test-util';
import {
	assessPackageDependencies,
	PackageAssetReferenceRewriteError,
	rewriteStoryAssetReferencesForPackage,
	type PackageDependencyAsset
} from '../package-dependencies';

function reference(
	source: string,
	original: string,
	options: {
		context?: string;
		end?: number;
		fragment?: string | null;
		passageId?: string | null;
		path: string;
		query?: string | null;
		sourceId: string;
		sourceName?: string;
		start?: number;
	}
): CoreAssetReference {
	const start = options.start ?? source.indexOf(original);
	const end = options.end ?? start + original.length;

	return {
		context: options.context ?? 'html-src',
		end,
		fragment: options.fragment ?? null,
		kind: 'image',
		line: 1,
		original,
		passageId: options.passageId ?? null,
		path: options.path,
		query: options.query ?? null,
		sourceId: options.sourceId,
		sourceName: options.sourceName ?? '',
		start
	};
}

function inventoryAsset(
	path: string,
	references: CoreAssetReference[]
): CoreAssetInventoryEntry {
	return {
		durationMs: null,
		exists: true,
		height: null,
		kind: 'file',
		missing: false,
		modifiedAt: null,
		normalizedPath: path.toLowerCase(),
		path,
		previewUrl: null,
		publish: {copy: true, outputPath: path, reason: 'Referenced asset'},
		referenceCount: references.length,
		references,
		sizeBytes: 1,
		snippet: {label: '', mediaType: 'file', text: ''},
		thumbnailUrl: null,
		unused: references.length === 0,
		width: null
	};
}

function dependencyAsset(
	logicalPath: string,
	content: string | Uint8Array = new Uint8Array([1]),
	options: Partial<PackageDependencyAsset> = {}
): PackageDependencyAsset {
	return {
		bytes:
			typeof content === 'string' ? new TextEncoder().encode(content) : content,
		logicalPath,
		...options
	};
}

describe('rewriteStoryAssetReferencesForPackage', () => {
	it('clones the story and exactly rewrites bare paths with encoded archive components', () => {
		const story = fakeStory();
		const original = 'hero cat.png?size=large%20view#top%20left';
		const source = `<img src="${original}">`;

		story.passages[0].text = source;
		const result = rewriteStoryAssetReferencesForPackage(story, [
			inventoryAsset('assets/hero cat.png', [
				reference(source, original, {
					fragment: '#top%20left',
					passageId: story.passages[0].id,
					path: 'assets/hero cat.png',
					query: '?size=large%20view',
					sourceId: story.passages[0].id,
					sourceName: story.passages[0].name
				})
			])
		]);

		expect(result).toEqual(
			expect.objectContaining({
				rewrittenAssetCount: 1,
				rewrittenReferenceCount: 1
			})
		);
		expect(result.story).not.toBe(story);
		expect(result.story.passages[0]).not.toBe(story.passages[0]);
		expect(result.story.passages[0].text).toBe(
			'<img src="assets/hero%20cat.png?size=large%20view#top%20left">'
		);
		expect(story.passages[0].text).toBe(source);
	});

	it('rewrites SVG presentation URLs without mutating nonresource attributes', () => {
		const story = fakeStory();
		const source = [
			'<svg><rect filter="url(filters.svg#blur)"></rect></svg>',
			'<img src="actual.png" alt="hero.png">',
			'<div title="hero.png" data-example=hero.png></div>'
		].join('');

		story.passages[0].text = source;
		const references = assetReferencesInSource(
			story.passages[0].id,
			story.passages[0].name,
			source,
			story.passages[0].id
		);
		const inventory = ['assets/filters.svg', 'assets/actual.png'].map(path =>
			inventoryAsset(
				path,
				references.filter(reference => reference.path === path)
			)
		);
		const result = rewriteStoryAssetReferencesForPackage(story, inventory);

		expect(references.map(reference => reference.path)).toEqual([
			'assets/filters.svg',
			'assets/actual.png'
		]);
		expect(result.story.passages[0].text).toBe(
			[
				'<svg><rect filter="url(assets/filters.svg#blur)"></rect></svg>',
				'<img src="assets/actual.png" alt="hero.png">',
				'<div title="hero.png" data-example=hero.png></div>'
			].join('')
		);
		expect(story.passages[0].text).toBe(source);
	});

	it('rewrites native background and SVG href resources without touching inert attributes', () => {
		const story = fakeStory();
		const source = [
			'<table background="hero&amp;bg.png?rev=2#top"><tr><td background="cell.png"></td></tr></table>',
			'<div src="inert.png" poster="inert-poster.png"></div>',
			'<input type="text" src="text.png"><input type="image" src="button.png">',
			'<svg><linearGradient href="gradient.svg#base"></linearGradient>',
			'<rect href="inert.svg"></rect></svg>'
		].join('');

		story.passages[0].text = source;
		const references = assetReferencesInSource(
			story.passages[0].id,
			story.passages[0].name,
			source,
			story.passages[0].id
		);
		const inventory = [
			'assets/hero&bg.png',
			'assets/cell.png',
			'assets/button.png',
			'assets/gradient.svg'
		].map(path =>
			inventoryAsset(
				path,
				references.filter(reference => reference.path === path)
			)
		);
		const result = rewriteStoryAssetReferencesForPackage(story, inventory);

		expect(references.map(reference => reference.path)).toEqual([
			'assets/hero&bg.png',
			'assets/cell.png',
			'assets/button.png',
			'assets/gradient.svg'
		]);
		expect(result.story.passages[0].text).toBe(
			[
				'<table background="assets/hero%26bg.png?rev=2#top"><tr><td background="assets/cell.png"></td></tr></table>',
				'<div src="inert.png" poster="inert-poster.png"></div>',
				'<input type="text" src="text.png"><input type="image" src="assets/button.png">',
				'<svg><linearGradient href="assets/gradient.svg#base"></linearGradient>',
				'<rect href="inert.svg"></rect></svg>'
			].join('')
		);
		expect(story.passages[0].text).toBe(source);
	});

	it('rewrites entity-spelled source from its semantic path and authored suffixes', () => {
		const story = fakeStory();
		const original = 'hero&amp;retina.png&#63;rev=1&amp;x=2&num;face';
		const source = `<img src="${original}">`;
		const passage = story.passages[0];

		passage.text = source;
		const result = rewriteStoryAssetReferencesForPackage(story, [
			inventoryAsset('assets/hero&retina.png', [
				reference(source, original, {
					fragment: '&num;face',
					passageId: passage.id,
					path: 'assets/hero&retina.png',
					query: '&#63;rev=1&amp;x=2',
					sourceId: passage.id,
					sourceName: passage.name
				})
			])
		]);

		expect(result.story.passages[0].text).toBe(
			'<img src="assets/hero%26retina.png&#63;rev=1&amp;x=2&num;face">'
		);
		expect(story.passages[0].text).toBe(source);
	});

	it('preserves hash and literal-percent identities in logical asset paths', () => {
		const story = fakeStory();
		const passage = story.passages[0];
		const source = '<img src="a%23b.png"><img src="a%252Fb.png">';

		passage.text = source;
		const references = assetReferencesInSource(
			passage.id,
			passage.name,
			source,
			passage.id
		);
		const result = rewriteStoryAssetReferencesForPackage(story, [
			inventoryAsset(
				'assets/a#b.png',
				references.filter(reference => reference.path === 'assets/a#b.png')
			),
			inventoryAsset(
				'assets/a%2Fb.png',
				references.filter(reference => reference.path === 'assets/a%2Fb.png')
			)
		]);

		expect(references.map(reference => reference.path)).toEqual([
			'assets/a#b.png',
			'assets/a%2Fb.png'
		]);
		expect(result.story.passages[0].text).toBe(
			'<img src="assets/a%23b.png"><img src="assets/a%252Fb.png">'
		);
		expect(story.passages[0].text).toBe(source);
	});

	it('rewrites indexed story script and stylesheet sources', () => {
		const story = fakeStory();
		story.script = 'const worker = "worker file.js";';
		story.stylesheet = 'main { background: url("cover art.png") }';
		const scriptOriginal = 'worker file.js';
		const stylesheetOriginal = 'cover art.png';

		const result = rewriteStoryAssetReferencesForPackage(story, [
			inventoryAsset('assets/worker file.js', [
				reference(story.script, scriptOriginal, {
					path: 'assets/worker file.js',
					sourceId: `${story.id}:script`,
					sourceName: 'Story JavaScript'
				})
			]),
			inventoryAsset('assets/cover art.png', [
				reference(story.stylesheet, stylesheetOriginal, {
					context: 'css-url',
					path: 'assets/cover art.png',
					sourceId: `${story.id}:stylesheet`,
					sourceName: 'Story Stylesheet'
				})
			])
		]);

		expect(result.story.script).toBe(
			'const worker = "assets/worker%20file.js";'
		);
		expect(result.story.stylesheet).toBe(
			'main { background: url("assets/cover%20art.png") }'
		);
		expect(story.script).toBe('const worker = "worker file.js";');
		expect(story.stylesheet).toBe('main { background: url("cover art.png") }');
	});

	it('rejects stale and overlapping indexed ranges', () => {
		const story = fakeStory();
		story.passages[0].text = 'hero.png?x';
		const base = {
			passageId: story.passages[0].id,
			path: 'assets/hero.png',
			sourceId: story.passages[0].id,
			sourceName: story.passages[0].name
		};

		expect(() =>
			rewriteStoryAssetReferencesForPackage(story, [
				inventoryAsset('assets/hero.png', [
					reference(story.passages[0].text, 'wrong.png', {
						...base,
						start: 0
					})
				])
			])
		).toThrow(PackageAssetReferenceRewriteError);

		expect(() =>
			rewriteStoryAssetReferencesForPackage(story, [
				inventoryAsset('assets/hero.png', [
					reference(story.passages[0].text, 'hero.png', base),
					reference(story.passages[0].text, 'hero.png?x', {
						...base,
						query: '?x'
					})
				])
			])
		).toThrow(/Overlapping asset references/);

		const incompleteInventory = inventoryAsset('assets/hero.png', []);
		incompleteInventory.referenceCount = 1;
		expect(() =>
			rewriteStoryAssetReferencesForPackage(story, [incompleteInventory])
		).toThrow(/only 0 indexed source ranges/);

		expect(() =>
			rewriteStoryAssetReferencesForPackage(story, [
				inventoryAsset('assets/hero.png', [
					reference(story.passages[0].text, 'hero.png', {
						...base,
						path: 'assets/other.png'
					})
				])
			])
		).toThrow(/does not resolve to managed asset/);
	});

	it('rejects unknown source IDs even when their display name resembles a script', () => {
		const story = fakeStory();
		story.script = 'const worker = "worker.js";';

		expect(() =>
			rewriteStoryAssetReferencesForPackage(story, [
				inventoryAsset('assets/worker.js', [
					reference(story.script, 'worker.js', {
						path: 'assets/worker.js',
						sourceId: 'stale-story:script',
						sourceName: 'Story JavaScript'
					})
				])
			])
		).toThrow(/unknown source/);
	});

	it('rejects a passage reference whose source and passage IDs disagree', () => {
		const story = fakeStory();
		const source = '<img src="hero.png">';

		story.passages[0].text = source;
		expect(() =>
			rewriteStoryAssetReferencesForPackage(story, [
				inventoryAsset('assets/hero.png', [
					reference(source, 'hero.png', {
						passageId: story.passages[0].id,
						path: 'assets/hero.png',
						sourceId: 'different-passage',
						sourceName: story.passages[0].name
					})
				])
			])
		).toThrow(/unknown source/);
	});
});

describe('assessPackageDependencies', () => {
	it('distinguishes packaged assets, remote resources, navigation, and file URLs', () => {
		const result = assessPackageDependencies({
			assets: [
				dependencyAsset('assets/local.png', undefined, {
					requiredByStaticReference: true
				})
			],
			html: [
				'<img src="assets/local.png">',
				'<img src="https://cdn.example/remote.png">',
				'<a href="https://example.com/docs">Docs</a>',
				'<script src="file:///Users/example/original.js"></script>',
				'<img src="blob:https://example.com/session-only">',
				'<img src="data:image/png;base64,AA==">'
			].join('')
		});

		expect(result.dependencies).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					disposition: 'packaged',
					kind: 'managed-local',
					original: 'assets/local.png'
				}),
				expect.objectContaining({
					disposition: 'external',
					kind: 'remote-resource',
					original: 'https://cdn.example/remote.png'
				}),
				expect.objectContaining({
					disposition: 'external',
					kind: 'navigation',
					original: 'https://example.com/docs'
				}),
				expect.objectContaining({
					disposition: 'blocked',
					kind: 'unsafe-local',
					original: 'file:///Users/example/original.js'
				}),
				expect.objectContaining({
					disposition: 'blocked',
					kind: 'unsafe-local',
					original: 'blob:https://example.com/session-only'
				})
			])
		);
		expect(
			result.dependencies.some(dependency =>
				dependency.original.startsWith('data:')
			)
		).toBe(false);
		expect(result.staticRuntimeDependencies).toBe('incomplete');
	});

	it('uses URL preprocessing without collapsing encoded or empty path segments', () => {
		const result = assessPackageDependencies({
			assets: [
				dependencyAsset('assets/xy.png'),
				dependencyAsset('assets/edge.png'),
				dependencyAsset('assets/a/b.png'),
				dependencyAsset('assets/hero.png')
			],
			html: [
				'<img src="assets/x&Tab;y.png">',
				'<img src="assets/x%09y.png">',
				'<img src="java&Tab;script:alert(1)">',
				'<img src="&#1;assets/edge.png">',
				'<img src="&nbsp;assets/hero.png">',
				'<img src="assets/hero.png ?rev=1">',
				'<img src="assets/a//b.png">',
				'<img src="assets/c&sol;&sol;d.png">',
				'<img src="assets/a%2Fb.png">',
				'<img src="assets/a&percnt;2Fb.png">'
			].join('')
		});
		const dependency = (original: string) =>
			result.dependencies.find(item => item.original === original);

		expect(dependency('assets/x\ty.png')).toEqual(
			expect.objectContaining({
				disposition: 'packaged',
				kind: 'managed-local'
			})
		);
		expect(dependency('\u0001assets/edge.png')).toEqual(
			expect.objectContaining({disposition: 'packaged'})
		);
		expect(dependency('java\tscript:alert(1)')).toEqual(
			expect.objectContaining({
				disposition: 'not-evaluated',
				kind: 'dynamic-unknown'
			})
		);
		for (const original of [
			'assets/x%09y.png',
			' assets/hero.png',
			'assets/hero.png ?rev=1',
			'assets/a//b.png',
			'assets/c//d.png',
			'assets/a%2Fb.png'
		]) {
			expect(dependency(original)).toEqual(
				expect.objectContaining({disposition: 'blocked'})
			);
		}
		expect(result.staticRuntimeDependencies).not.toBe('complete');
	});

	it('treats remote navigation as informational for static completeness', () => {
		const result = assessPackageDependencies({
			assets: [],
			html: '<a href="https://example.com/guide">Guide</a>'
		});

		expect(result.staticRuntimeDependencies).toBe('complete');
		expect(result.dependencies).toContainEqual(
			expect.objectContaining({
				disposition: 'external',
				kind: 'navigation'
			})
		);
	});

	it('resolves local navigation before applying the external-navigation exemption', () => {
		const result = assessPackageDependencies({
			assets: [
				dependencyAsset('assets/guide.html'),
				dependencyAsset('assets/download.zip')
			],
			html: [
				'<a href="assets/guide.html?edition=1#intro">Guide</a>',
				'<a href="assets/missing.html">Missing</a>',
				'<area href="https://example.com/guide#top">Remote</area>',
				'<a download href="assets/download.zip?release=1#notes">Download</a>',
				'<area download href="assets/missing.zip">Missing download</area>',
				'<a download href="https://example.com/download.zip">Remote download</a>',
				'<svg><a download href="https://example.com/svg-download.zip"></a><a download xlink:href="assets/download.zip"></a></svg>',
				'<a href="#section">Fragment</a>'
			].join('')
		});

		expect(result.dependencies).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					disposition: 'packaged',
					kind: 'managed-local',
					original: 'assets/guide.html?edition=1#intro'
				}),
				expect.objectContaining({
					disposition: 'blocked',
					kind: 'managed-local',
					original: 'assets/missing.html'
				}),
				expect.objectContaining({
					disposition: 'external',
					kind: 'navigation',
					original: 'https://example.com/guide#top'
				}),
				expect.objectContaining({
					disposition: 'packaged',
					kind: 'managed-local',
					original: 'assets/download.zip?release=1#notes'
				}),
				expect.objectContaining({
					disposition: 'blocked',
					kind: 'managed-local',
					original: 'assets/missing.zip'
				}),
				expect.objectContaining({
					disposition: 'external',
					kind: 'remote-resource',
					original: 'https://example.com/download.zip'
				}),
				expect.objectContaining({
					disposition: 'external',
					kind: 'remote-resource',
					original: 'https://example.com/svg-download.zip'
				}),
				expect.objectContaining({
					disposition: 'packaged',
					kind: 'managed-local',
					original: 'assets/download.zip'
				})
			])
		);
		expect(
			result.dependencies.filter(
				dependency =>
					dependency.original === 'https://example.com/svg-download.zip'
			)
		).toHaveLength(1);
		expect(result.staticRuntimeDependencies).toBe('incomplete');
	});

	it('assesses authored runtime HTML stored as escaped passage source', () => {
		const result = assessPackageDependencies({
			assets: [],
			html: [
				'<tw-storydata>',
				'  <tw-passagedata>',
				'    &lt;img src="https://cdn.example/remote.png"&gt;',
				'    &lt;script src="file:///Users/example/original.js"&gt;&lt;/script&gt;',
				'  </tw-passagedata>',
				'</tw-storydata>'
			].join('')
		});

		expect(result.dependencies).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					disposition: 'external',
					kind: 'remote-resource',
					original: 'https://cdn.example/remote.png'
				}),
				expect.objectContaining({
					disposition: 'blocked',
					kind: 'unsafe-local',
					original: 'file:///Users/example/original.js'
				})
			])
		);
		expect(result.staticRuntimeDependencies).toBe('incomplete');
	});

	it('assesses legacy background URLs and qualifies native HTML resource attributes', () => {
		const result = assessPackageDependencies({
			assets: [
				dependencyAsset('assets/body.png'),
				dependencyAsset('assets/button.png')
			],
			html: [
				'<tw-storydata><tw-passagedata>',
				'&lt;body background="assets/body.png?rev=1#top"&gt;',
				'&lt;table background="https://cdn.example/background"&gt;',
				'&lt;tr&gt;&lt;td background="assets/missing.png"&gt;&lt;/td&gt;&lt;/tr&gt;&lt;/table&gt;',
				'&lt;div src="https://cdn.example/inert" poster="assets/inert.png"&gt;&lt;/div&gt;',
				'&lt;input type="text" src="https://cdn.example/text-input"&gt;',
				'&lt;input type="image" src="assets/button.png"&gt;',
				'</tw-passagedata></tw-storydata>'
			].join('')
		});

		expect(result.dependencies).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					disposition: 'packaged',
					original: 'assets/body.png?rev=1#top',
					sourceLocation: expect.stringContaining('@background')
				}),
				expect.objectContaining({
					disposition: 'external',
					kind: 'remote-resource',
					original: 'https://cdn.example/background'
				}),
				expect.objectContaining({
					disposition: 'blocked',
					original: 'assets/missing.png'
				}),
				expect.objectContaining({
					disposition: 'packaged',
					original: 'assets/button.png'
				})
			])
		);
		expect(
			result.dependencies.some(dependency =>
				[
					'https://cdn.example/inert',
					'assets/inert.png',
					'https://cdn.example/text-input'
				].includes(dependency.original)
			)
		).toBe(false);
		expect(result.staticRuntimeDependencies).toBe('incomplete');

		const frameResult = assessPackageDependencies({
			assets: [dependencyAsset('assets/frame.html')],
			html: '<frameset><frame src="assets/frame.html"></frameset>'
		});

		expect(frameResult.dependencies).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					disposition: 'packaged',
					original: 'assets/frame.html'
				})
			])
		);
	});

	it('assesses legacy and modern SVG resource links in escaped passage source', () => {
		const result = assessPackageDependencies({
			assets: [dependencyAsset('assets/texture.png')],
			html: [
				'<tw-storydata>',
				'  <tw-passagedata>',
				'    &lt;svg xmlns:xlink="http://www.w3.org/1999/xlink"&gt;',
				'      &lt;image xlink:href="assets/texture.png"&gt;&lt;/image&gt;',
				'      &lt;feImage href="//cdn.example/filter.png"&gt;&lt;/feImage&gt;',
				'    &lt;/svg&gt;',
				'  </tw-passagedata>',
				'</tw-storydata>'
			].join('')
		});

		expect(result.dependencies).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					disposition: 'packaged',
					kind: 'managed-local',
					original: 'assets/texture.png'
				}),
				expect.objectContaining({
					disposition: 'external',
					kind: 'remote-resource',
					original: '//cdn.example/filter.png'
				})
			])
		);
		expect(result.staticRuntimeDependencies).toBe('incomplete');
	});

	it('assesses only consuming SVG href elements and honors href precedence', () => {
		const packaged = [
			'assets/gradients.svg',
			'assets/radial.svg',
			'assets/patterns.svg',
			'assets/paths.svg',
			'assets/preferred.png',
			'assets/filter.exr',
			'assets/symbols.svg',
			'assets/download.svg',
			'assets/motion.svg'
		];
		const result = assessPackageDependencies({
			assets: packaged.map(path => dependencyAsset(path)),
			html: [
				'<svg>',
				'<linearGradient href="assets/gradients.svg#base"></linearGradient>',
				'<radialGradient xlink:href="assets/radial.svg#base"></radialGradient>',
				'<pattern href="assets/patterns.svg#base"></pattern>',
				'<script href="https://cdn.example/runtime"></script>',
				'<textPath href="assets/paths.svg#curve"></textPath>',
				'<image href="assets/preferred.png" xlink:href="assets/ignored.png"></image>',
				'<use href xlink:href="assets/empty-fallback.svg"></use>',
				'<a download href xlink:href="assets/download-fallback.svg">Empty</a>',
				'<feImage href="assets/filter.exr"></feImage>',
				'<use href="assets/symbols.svg#check"></use>',
				'<a href="https://example.com/navigation">Navigate</a>',
				'<a download href="assets/download.svg">Save</a>',
				'<animate href="https://cdn.example/animation-target#node"></animate>',
				'<mpath href="assets/motion.svg#curve"></mpath>',
				'<filter href="https://cdn.example/legacy-filter#base"></filter>',
				'<rect href="https://cdn.example/rect"></rect>',
				'</svg>'
			].join('')
		});

		for (const path of packaged) {
			expect(result.dependencies).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						disposition: 'packaged',
						original: expect.stringContaining(path)
					})
				])
			);
		}
		expect(result.dependencies).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					disposition: 'external',
					kind: 'remote-resource',
					original: 'https://cdn.example/runtime'
				}),
				expect.objectContaining({
					disposition: 'external',
					kind: 'navigation',
					original: 'https://example.com/navigation'
				})
			])
		);
		expect(
			result.dependencies.some(dependency =>
				[
					'assets/ignored.png',
					'assets/empty-fallback.svg',
					'assets/download-fallback.svg',
					'https://cdn.example/animation-target#node',
					'https://cdn.example/legacy-filter#base',
					'https://cdn.example/rect'
				].includes(dependency.original)
			)
		).toBe(false);
		expect(result.staticRuntimeDependencies).toBe('incomplete');
	});

	it('assesses URL-valued SVG presentation attributes as CSS', () => {
		const result = assessPackageDependencies({
			assets: [
				dependencyAsset('assets/filters.svg'),
				dependencyAsset('assets/markers.svg')
			],
			html: [
				'<svg><rect filter="url(assets/filters.svg#blur)"',
				' fill="url(https://cdn.example/paint#gradient)"',
				' clip-path="url(#local-clip)"',
				' marker-end="url(assets/markers.svg#end)"',
				' mask="url(assets/missing.svg#mask)"></rect></svg>'
			].join('')
		});

		expect(result.dependencies).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					disposition: 'packaged',
					original: 'assets/filters.svg#blur',
					sourceLocation: expect.stringContaining('@filter')
				}),
				expect.objectContaining({
					disposition: 'external',
					kind: 'remote-resource',
					original: 'https://cdn.example/paint#gradient',
					sourceLocation: expect.stringContaining('@fill')
				}),
				expect.objectContaining({
					disposition: 'packaged',
					original: 'assets/markers.svg#end',
					sourceLocation: expect.stringContaining('@marker-end')
				}),
				expect.objectContaining({
					disposition: 'blocked',
					original: 'assets/missing.svg#mask',
					sourceLocation: expect.stringContaining('@mask')
				})
			])
		);
		expect(
			result.dependencies.some(
				dependency => dependency.original === '#local-clip'
			)
		).toBe(false);
		expect(result.staticRuntimeDependencies).toBe('incomplete');

		const escaped = assessPackageDependencies({
			assets: [],
			html: '<svg><rect filter="u\\72l(filters.svg#blur)"></rect></svg>'
		});

		expect(escaped.scanIssues).toContainEqual(
			expect.objectContaining({
				code: 'unrecognized-static-reference',
				sourceLocation: expect.stringContaining('@filter')
			})
		);
		expect(escaped.staticRuntimeDependencies).toBe('unknown');
	});

	it('assesses automatically rendered iframe srcdoc resources', () => {
		const result = assessPackageDependencies({
			assets: [],
			html: `<iframe srcdoc="&lt;img src='https://cdn.example/frame.png'&gt;"></iframe>`
		});

		expect(result.dependencies).toContainEqual(
			expect.objectContaining({
				disposition: 'external',
				kind: 'remote-resource',
				original: 'https://cdn.example/frame.png'
			})
		);
		expect(result.staticRuntimeDependencies).toBe('incomplete');
	});

	it('ignores data srcset candidates without hiding later packaged candidates', () => {
		const result = assessPackageDependencies({
			assets: [dependencyAsset('assets/second.png')],
			html: '<img srcset="data:image/png;base64,AA==, assets/second.png 2x">'
		});

		expect(result.dependencies).toContainEqual(
			expect.objectContaining({
				disposition: 'packaged',
				kind: 'managed-local',
				original: 'assets/second.png'
			})
		);
		expect(
			result.dependencies.some(dependency =>
				dependency.original.startsWith('data:')
			)
		).toBe(false);

		const missing = assessPackageDependencies({
			assets: [],
			html: '<img srcset="data:image/png;base64,AA==, assets/missing.png 2x">'
		});

		expect(missing.dependencies).toContainEqual(
			expect.objectContaining({
				disposition: 'blocked',
				kind: 'managed-local',
				original: 'assets/missing.png'
			})
		);
		expect(missing.staticRuntimeDependencies).toBe('incomplete');

		const dense = assessPackageDependencies({
			assets: [dependencyAsset('assets/second.png')],
			html: `<img srcset="data:image/png;base64,${','.repeat(65_536)}AA==, assets/second.png 2x">`
		});

		expect(dense.dependencies).toContainEqual(
			expect.objectContaining({
				disposition: 'packaged',
				kind: 'managed-local',
				original: 'assets/second.png'
			})
		);
		expect(dense.scanIssues).toContainEqual(
			expect.objectContaining({code: 'candidate-limit'})
		);
		expect(dense.staticRuntimeDependencies).toBe('unknown');
	});

	it('blocks blob srcset candidates without hiding later packaged candidates', () => {
		const result = assessPackageDependencies({
			assets: [dependencyAsset('assets/second.png')],
			html: '<img srcset="blob:https://example.test/id,part 1x, assets/second.png 2x">'
		});

		expect(result.dependencies).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					disposition: 'blocked',
					kind: 'unsafe-local',
					original: 'blob:https://example.test/id,part'
				}),
				expect.objectContaining({
					disposition: 'packaged',
					kind: 'managed-local',
					original: 'assets/second.png'
				})
			])
		);
		expect(result.staticRuntimeDependencies).toBe('incomplete');
	});

	it('preserves srcset URL commas and scans link imagesrcset without href', () => {
		const result = assessPackageDependencies({
			assets: [
				dependencyAsset('assets/hero,retina.png'),
				dependencyAsset('assets/small.png'),
				dependencyAsset('assets/large.png')
			],
			html: [
				'<img srcset="assets/hero,retina.png 2x">',
				'<link rel="preload" as="image" imagesrcset="assets/small.png 400w, assets/large.png 800w" imagesizes="100vw">'
			].join('')
		});

		for (const original of [
			'assets/hero,retina.png',
			'assets/small.png',
			'assets/large.png'
		]) {
			expect(result.dependencies).toContainEqual(
				expect.objectContaining({
					disposition: 'packaged',
					kind: 'managed-local',
					original
				})
			);
		}
		expect(result.scanIssues).toHaveLength(0);
		expect(result.staticRuntimeDependencies).toBe('complete');
	});

	it('classifies link relations before scanning href and imagesrcset', () => {
		const result = assessPackageDependencies({
			assets: [
				dependencyAsset('assets/theme.css', ''),
				dependencyAsset('assets/site.webmanifest'),
				dependencyAsset('assets/small.png'),
				dependencyAsset('assets/large.png')
			],
			html: [
				'<link href="https://ignored.example/rel-less">',
				'<link rel="canonical" href="https://ignored.example/canonical">',
				'<link rel="expect" href="https://ignored.example/expect">',
				'<link rel="canonical" imagesrcset="https://ignored.example/canonical.png 1x">',
				'<link rel="preload" as="font" imagesrcset="https://ignored.example/font.png 1x">',
				'<link rel="canonical stylesheet" href="assets/theme.css">',
				'<link rel="manifest" href="assets/site.webmanifest">',
				'<link rel="preload" as="IMAGE" imagesrcset="assets/small.png 1x, assets/large.png 2x">'
			].join('')
		});

		for (const original of [
			'assets/theme.css',
			'assets/site.webmanifest',
			'assets/small.png',
			'assets/large.png'
		]) {
			expect(result.dependencies).toContainEqual(
				expect.objectContaining({
					disposition: 'packaged',
					kind: 'managed-local',
					original
				})
			);
		}
		expect(
			result.dependencies.some(dependency =>
				dependency.original.startsWith('https://ignored.example/')
			)
		).toBe(false);
		expect(result.scanIssues).toHaveLength(0);
		expect(result.staticRuntimeDependencies).toBe('complete');
	});

	it('fails unknown link relation extensions closed once without consuming candidates', () => {
		const result = assessPackageDependencies({
			assets: [
				dependencyAsset('assets/theme.css', ''),
				dependencyAsset('assets/known.png')
			],
			html: [
				'<link rel="canonical stylesheet extension-mixed" href="assets/theme.css">',
				'<link rel="extension-without-a-target">',
				...Array.from(
					{length: 1_000},
					(_, index) =>
						`<link rel="extension-${index}" href="https://ignored.example/${index}">`
				),
				'<img src="assets/known.png">'
			].join(''),
			limits: {maxCandidates: 2}
		});

		for (const original of ['assets/theme.css', 'assets/known.png']) {
			expect(result.dependencies).toContainEqual(
				expect.objectContaining({
					disposition: 'packaged',
					kind: 'managed-local',
					original
				})
			);
		}
		expect(result.dependencies).not.toContainEqual(
			expect.objectContaining({kind: 'remote-resource'})
		);
		expect(result.scanIssues).toEqual([
			expect.objectContaining({
				code: 'unrecognized-static-reference',
				message: expect.stringContaining('unrecognized HTML link relation'),
				sourceLocation: 'index.html:link[4]@rel'
			})
		]);
		expect(result.scanIssues).not.toContainEqual(
			expect.objectContaining({code: 'candidate-limit'})
		);
		expect(result.staticRuntimeDependencies).toBe('unknown');
	});

	it('ignores targetless unknown and foreign-namespace links while honoring HTML integration points', () => {
		const result = assessPackageDependencies({
			assets: [
				dependencyAsset('assets/integrated.css', ''),
				dependencyAsset('assets/known.png')
			],
			html: [
				'<link rel="extension-without-a-target">',
				'<svg><link rel="stylesheet" href="https://ignored.example/svg.css" /></svg>',
				'<math><link rel="extension" href="https://ignored.example/math.css" /></math>',
				'<svg><foreignObject><link rel="stylesheet" href="assets/integrated.css"></foreignObject></svg>',
				'<img src="assets/known.png">'
			].join('')
		});

		for (const original of ['assets/integrated.css', 'assets/known.png']) {
			expect(result.dependencies).toContainEqual(
				expect.objectContaining({
					disposition: 'packaged',
					kind: 'managed-local',
					original
				})
			);
		}
		expect(
			result.dependencies.some(dependency =>
				dependency.original.startsWith('https://ignored.example/')
			)
		).toBe(false);
		expect(result.scanIssues).toHaveLength(0);
		expect(result.staticRuntimeDependencies).toBe('complete');
	});

	it('does not Unicode-fold nonstandard HTML tag names into resource elements', () => {
		const result = assessPackageDependencies({
			assets: [dependencyAsset('assets/known.png')],
			html: [
				'<linK rel="stylesheet" href="https://ignored.example/unicode-fold.css">',
				'<img src="assets/known.png">'
			].join('')
		});

		expect(result.dependencies).toContainEqual(
			expect.objectContaining({
				disposition: 'packaged',
				kind: 'managed-local',
				original: 'assets/known.png'
			})
		);
		expect(result.dependencies).not.toContainEqual(
			expect.objectContaining({
				original: 'https://ignored.example/unicode-fold.css'
			})
		);
		expect(result.scanIssues).toHaveLength(0);
		expect(result.staticRuntimeDependencies).toBe('complete');
	});

	it('recovers later srcset candidates after malformed parenthesized descriptors', () => {
		const result = assessPackageDependencies({
			assets: [],
			html: '<img srcset="data:image/gif;base64,AA== ((x), https://cdn.example/recovered.png 2x">'
		});

		expect(result.dependencies).toContainEqual(
			expect.objectContaining({
				disposition: 'external',
				kind: 'remote-resource',
				original: 'https://cdn.example/recovered.png'
			})
		);
		expect(result.staticRuntimeDependencies).toBe('incomplete');
	});

	it('leaves passive data URLs self-contained but flags active documents and styles without retaining their payloads', () => {
		const percentEncodedDocument =
			'data:text/html,%3Cimg%20src%3D%22https%3A%2F%2Fexample.com%2Fx.png%22%3E';
		const base64Stylesheet =
			'data:text/css;base64,Ym9keXtiYWNrZ3JvdW5kOnVybChodHRwczovL2V4YW1wbGUuY29tL3gucG5nKX0=';
		const result = assessPackageDependencies({
			assets: [
				dependencyAsset(
					'assets/styles.css',
					'@import url(data:text/css;base64,Ym9keXtiYWNrZ3JvdW5kOnVybChodHRwczovL2V4YW1wbGUuY29tL3gucG5nKX0=); body { background: url(data:image/png;base64,AA==) } @font-face { src: url(data:font/woff2;base64,AA==) }'
				)
			],
			html: [
				`<iframe src="${percentEncodedDocument}"></iframe>`,
				`<object data="${percentEncodedDocument}"></object>`,
				`<embed src="${percentEncodedDocument}">`,
				`<link rel="stylesheet" href="${base64Stylesheet}">`,
				'<img src="data:image/png;base64,AA==">',
				'<script src="data:text/javascript,import%20%22https%3A%2F%2Fexample.com%2Fx.js%22"></script>'
			].join('')
		});

		expect(result.scanIssues).toHaveLength(5);
		expect(result.scanIssues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: 'unrecognized-static-reference',
					message: expect.stringContaining('active document or stylesheet')
				})
			])
		);
		for (const issue of result.scanIssues) {
			expect(issue.message).not.toContain('data:');
			expect(issue.sourceLocation).toMatch(/@|css-import/);
		}
		expect(
			result.dependencies.some(dependency =>
				dependency.original.startsWith('data:')
			)
		).toBe(false);
		expect(result.staticRuntimeDependencies).toBe('unknown');
	});

	it('resolves copied CSS url() and both quoted and url() @import forms', () => {
		const mainCss = [
			'body { background: url(/* lead */ "../images/hero image.png" /**/) }',
			'@import /* one *//**/"./theme/base.css";',
			'@import /**/url(/**/ "../fonts.css" /* tail */);',
			'@import "https://cdn.example/remote.css";'
		].join('\n');
		const result = assessPackageDependencies({
			assets: [
				dependencyAsset('assets/styles/main.css', mainCss, {
					mediaType: 'text/css'
				}),
				dependencyAsset('assets/images/hero image.png'),
				dependencyAsset('assets/styles/theme/base.css', ''),
				dependencyAsset('assets/fonts.css', '')
			],
			html: '<link rel="stylesheet" href="assets/styles/main.css">'
		});

		for (const original of [
			'../images/hero image.png',
			'./theme/base.css',
			'../fonts.css'
		]) {
			expect(result.dependencies).toContainEqual(
				expect.objectContaining({
					disposition: 'packaged',
					kind: 'managed-local',
					original
				})
			);
		}
		expect(result.dependencies).toContainEqual(
			expect.objectContaining({
				disposition: 'external',
				kind: 'remote-resource',
				original: 'https://cdn.example/remote.css'
			})
		);
		expect(result.copiedAssetContents).toBe('partially-evaluated');
		expect(result.staticRuntimeDependencies).toBe('incomplete');
	});

	it('scans imported and linked stylesheet bytes regardless of extension or MIME', () => {
		const result = assessPackageDependencies({
			assets: [
				dependencyAsset('assets/main.css', '@import"theme.tokens";'),
				dependencyAsset(
					'assets/theme.tokens',
					'body { background: url("https://cdn.example/imported.png") }'
				),
				dependencyAsset(
					'assets/linked.data',
					'body { background: url("https://cdn.example/linked.png") }'
				)
			],
			html: [
				'<link rel="stylesheet" href="assets/main.css">',
				'<link rel="alternate stylesheet" href="assets/linked.data">'
			].join('')
		});

		for (const original of [
			'https://cdn.example/imported.png',
			'https://cdn.example/linked.png'
		]) {
			expect(result.dependencies).toContainEqual(
				expect.objectContaining({
					disposition: 'external',
					kind: 'remote-resource',
					original
				})
			);
		}
		expect(result.dependencies).toContainEqual(
			expect.objectContaining({
				disposition: 'packaged',
				kind: 'managed-local',
				original: 'theme.tokens'
			})
		);
		expect(result.copiedAssetContents).toBe('partially-evaluated');
		expect(result.staticRuntimeDependencies).toBe('incomplete');
	});

	it('lexes CSS comments and strings without hiding or inventing dependencies', () => {
		const result = assessPackageDependencies({
			assets: [
				dependencyAsset(
					'assets/styles/main.css',
					[
						'a::before { content: "/*"; }',
						'body { background: url("https://cdn.example/image.png"); }',
						'b::after { content: "*/"; }',
						'c::after { content: "url(https://ignored.example/string.png)"; }',
						'/* url(https://ignored.example/comment.png) */'
					].join('\n'),
					{mediaType: 'text/css'}
				)
			],
			html: ''
		});

		expect(result.dependencies).toContainEqual(
			expect.objectContaining({
				disposition: 'external',
				kind: 'remote-resource',
				original: 'https://cdn.example/image.png'
			})
		);
		expect(result.dependencies).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					original: 'https://ignored.example/string.png'
				}),
				expect.objectContaining({
					original: 'https://ignored.example/comment.png'
				})
			])
		);
		expect(result.scanIssues).toHaveLength(0);
		expect(result.staticRuntimeDependencies).toBe('incomplete');
	});

	it('ignores dense nonresource links and escapes in ordinary CSS strings at low candidate limits', () => {
		const result = assessPackageDependencies({
			assets: [dependencyAsset('assets/known.png')],
			html: [
				...Array.from(
					{length: 1_000},
					(_, index) =>
						`<link rel="canonical" href="https://ignored.example/${index}">`
				),
				'<style>',
				...Array.from(
					{length: 1_000},
					(_, index) =>
						`.x${index}::before { content: "label\\A ${index}"; font-family: "A\\ B"; }`
				),
				'</style>',
				'<img src="assets/known.png">'
			].join(''),
			limits: {maxCandidates: 1}
		});

		expect(result.dependencies).toContainEqual(
			expect.objectContaining({
				disposition: 'packaged',
				kind: 'managed-local',
				original: 'assets/known.png'
			})
		);
		expect(result.scanIssues).toHaveLength(0);
		expect(result.staticRuntimeDependencies).toBe('complete');
	});

	it('fails CSS escapes closed in URL-bearing strings', () => {
		const result = assessPackageDependencies({
			assets: [],
			html: '<style>body { background: url("assets/escaped\\20name.png"); }</style>'
		});

		expect(result.scanIssues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: 'unrecognized-static-reference',
					message: expect.stringContaining('CSS escapes')
				})
			])
		);
		expect(result.staticRuntimeDependencies).toBe('unknown');
	});

	it('bounds retained scan issues independently from dependency candidates', () => {
		const result = assessPackageDependencies({
			assets: [],
			html: Array.from(
				{length: 1_000},
				(_, index) =>
					`<div style='background:url("assets/escaped\\20-${index}.png")'></div>`
			).join(''),
			limits: {maxCandidates: 0, maxScanIssues: 2}
		});

		expect(result.scanIssues).toHaveLength(3);
		expect(
			result.scanIssues.filter(issue => issue.code === 'scan-issue-limit')
		).toHaveLength(1);
		expect(result.scanIssues).not.toContainEqual(
			expect.objectContaining({code: 'candidate-limit'})
		);
		const retainedIssueDependencies = result.dependencies.filter(
			dependency =>
				dependency.kind === 'dynamic-unknown' &&
				dependency.original !== 'Runtime JavaScript dependency discovery'
		);

		expect(retainedIssueDependencies).toHaveLength(3);
		expect(retainedIssueDependencies).toContainEqual(
			expect.objectContaining({
				original: expect.stringContaining('2-issue retention limit')
			})
		);
		expect(result.staticRuntimeDependencies).toBe('unknown');
	});

	it('recognizes CSS comments that splice url and import tokens', () => {
		const result = assessPackageDependencies({
			assets: [
				dependencyAsset(
					'assets/styles/main.css',
					[
						'a { background: url/**/("https://cdn.example/a.png"); }',
						'b { background: u/**/rl("https://cdn.example/b.png"); }',
						'@im/**/port "https://cdn.example/theme.css";'
					].join('\n'),
					{mediaType: 'text/css'}
				)
			],
			html: ''
		});

		for (const original of [
			'https://cdn.example/a.png',
			'https://cdn.example/b.png',
			'https://cdn.example/theme.css'
		]) {
			expect(result.dependencies).toContainEqual(
				expect.objectContaining({
					disposition: 'external',
					kind: 'remote-resource',
					original
				})
			);
		}
		expect(result.scanIssues).toHaveLength(0);
		expect(result.staticRuntimeDependencies).toBe('incomplete');
	});

	it('assesses string-form image-set options without treating metadata as URLs', () => {
		const result = assessPackageDependencies({
			assets: [
				dependencyAsset(
					'assets/styles/main.css',
					[
						'body { background: image-set("../images/hero image.webp?rev=2#face" type("image/webp") 2x, url("../images/fallback.webp") type("image/avif") 1x); }',
						'.legacy { background: -webkit-image-/**/set /**/(/* lead */ "../images/legacy.webp", linear-gradient(red, blue) 2x); }',
						'.remote { background: image-set("https://cdn.example/remote.webp" 1x); }',
						'.data { background: image-set("data:image/png;base64,AA==" 1x); }',
						'a::after { content: "ignored.webp"; }'
					].join('\n'),
					{mediaType: 'text/css'}
				),
				dependencyAsset('assets/images/hero image.webp'),
				dependencyAsset('assets/images/fallback.webp'),
				dependencyAsset('assets/images/legacy.webp'),
				dependencyAsset('assets/inline.webp')
			],
			html: [
				'<link rel="stylesheet" href="assets/styles/main.css">',
				'<div style="background:image-set(\'assets/inline.webp\')"></div>'
			].join('')
		});

		for (const original of [
			'../images/hero image.webp?rev=2#face',
			'../images/fallback.webp',
			'../images/legacy.webp',
			'assets/inline.webp'
		]) {
			expect(result.dependencies).toContainEqual(
				expect.objectContaining({
					disposition: 'packaged',
					kind: 'managed-local',
					original
				})
			);
		}
		expect(result.dependencies).toContainEqual(
			expect.objectContaining({
				disposition: 'external',
				kind: 'remote-resource',
				original: 'https://cdn.example/remote.webp'
			})
		);
		expect(
			result.dependencies.some(dependency =>
				['image/webp', 'image/avif', 'ignored.webp'].includes(
					dependency.original
				)
			)
		).toBe(false);
		expect(result.scanIssues).toHaveLength(0);
		expect(result.staticRuntimeDependencies).toBe('incomplete');
	});

	it('fails image-set dependency scanning closed for missing and escaped strings', () => {
		const missing = assessPackageDependencies({
			assets: [],
			html: '<style>body { background: image-set("assets/missing.webp" 1x); }</style>'
		});
		const escaped = assessPackageDependencies({
			assets: [],
			html: '<style>body { background: image-set("assets/escaped\\20name.webp" 1x); }</style>'
		});
		const unterminated = assessPackageDependencies({
			assets: [dependencyAsset('assets/known.webp')],
			html: '<style>body { background: image-set("assets/known.webp" 1x; }</style>'
		});
		const substituted = assessPackageDependencies({
			assets: [],
			html: [
				'<style>body { background: image-set(',
				'var(--missing, "https://example.com/var.webp") 1x, ',
				'env(unknown, "https://example.com/env.webp") 2x, ',
				'inherit(--hero, "https://example.com/inherit.webp") 3x, ',
				'random-item(--choice, "https://example.com/random.webp", "assets/local.webp") 4x',
				'); }</style>'
			].join('')
		});
		const deeplyNested = assessPackageDependencies({
			assets: [],
			html: '<style>body { background: image-set((("assets/deep.webp"))); }</style>',
			limits: {maxCssNestingDepth: 2}
		});

		expect(missing.dependencies).toContainEqual(
			expect.objectContaining({
				disposition: 'blocked',
				kind: 'managed-local',
				original: 'assets/missing.webp'
			})
		);
		expect(missing.staticRuntimeDependencies).toBe('incomplete');
		expect(escaped.scanIssues).toContainEqual(
			expect.objectContaining({
				code: 'unrecognized-static-reference',
				message: expect.stringContaining('CSS escapes')
			})
		);
		expect(escaped.staticRuntimeDependencies).toBe('unknown');
		expect(unterminated.scanIssues).toContainEqual(
			expect.objectContaining({
				code: 'unrecognized-static-reference',
				message: expect.stringContaining('unterminated CSS image-set')
			})
		);
		expect(unterminated.staticRuntimeDependencies).toBe('unknown');
		expect(substituted.scanIssues).toContainEqual(
			expect.objectContaining({
				code: 'unrecognized-static-reference',
				message: expect.stringContaining('substitution inside image-set')
			})
		);
		expect(substituted.scanIssues).toHaveLength(1);
		expect(substituted.staticRuntimeDependencies).toBe('unknown');
		expect(deeplyNested.scanIssues).toContainEqual(
			expect.objectContaining({code: 'css-nesting-limit'})
		);
		expect(deeplyNested.staticRuntimeDependencies).toBe('unknown');
	});

	it('reports dense image-set substitutions once per CSS source', () => {
		const result = assessPackageDependencies({
			assets: [],
			html: `<style>.x { background: image-set(${Array.from(
				{length: 1_000},
				() => 'var(--x, "https://example.com/hidden.webp") 1x'
			).join(',')}); }</style>`,
			limits: {maxCandidates: 1}
		});

		expect(result.scanIssues).toEqual([
			expect.objectContaining({
				code: 'unrecognized-static-reference',
				message: expect.stringContaining('substitution inside image-set')
			})
		]);
		expect(result.staticRuntimeDependencies).toBe('unknown');
	});

	it.each([
		'var(--missing, "https://example.com/var.webp")',
		'env(unknown, "https://example.com/env.webp")',
		'if(style(--x): "https://example.com/if.webp"; else: "assets/local.webp")',
		'inherit(--hero, "https://example.com/inherit.webp")',
		'random-item(--choice, "https://example.com/random.webp", "assets/local.webp")',
		'attr(data-image type(<string>), "https://example.com/attr.webp")',
		'--choose-image("https://example.com/custom.webp")'
	])('fails image-set substitution %s closed', substitution => {
		const result = assessPackageDependencies({
			assets: [],
			html: `<style>.x { background: image-set(${substitution} 1x); }</style>`
		});

		expect(result.scanIssues).toEqual([
			expect.objectContaining({
				code: 'unrecognized-static-reference',
				message: expect.stringContaining('substitution inside image-set')
			})
		]);
		expect(result.staticRuntimeDependencies).toBe('unknown');
	});

	it('treats declarative refresh destinations as automatic dependencies', () => {
		const remote = assessPackageDependencies({
			assets: [],
			html: '<meta http-equiv="refresh" content="0; URL=https://example.com/next">'
		});
		const packaged = assessPackageDependencies({
			assets: [dependencyAsset('assets/next.html')],
			html: '<meta http-equiv="refresh" content=".5, url = \'assets/next.html\'">'
		});
		const missing = assessPackageDependencies({
			assets: [],
			html: '<meta http-equiv="refresh" content="0 assets/missing.html">'
		});
		const dataUrl =
			'data:text/html,%3Cimg%20src%3D%22https%3A%2F%2Fexample.com%2Fx.png%22%3E';
		const activeData = assessPackageDependencies({
			assets: [],
			html: `<meta http-equiv="refresh" content="0; URL=${dataUrl}">`
		});
		const reloadOnly = assessPackageDependencies({
			assets: [],
			html: '<meta http-equiv="refresh" content="300">'
		});
		const invalid = assessPackageDependencies({
			assets: [],
			html: '<meta http-equiv="refresh" content="garbage; URL=https://example.com/wrong">'
		});

		expect(remote.dependencies).toContainEqual(
			expect.objectContaining({
				disposition: 'external',
				kind: 'remote-resource',
				original: 'https://example.com/next'
			})
		);
		expect(remote.staticRuntimeDependencies).toBe('incomplete');
		expect(packaged.dependencies).toContainEqual(
			expect.objectContaining({
				disposition: 'packaged',
				kind: 'managed-local',
				original: 'assets/next.html'
			})
		);
		expect(packaged.staticRuntimeDependencies).toBe('complete');
		expect(missing.dependencies).toContainEqual(
			expect.objectContaining({
				disposition: 'blocked',
				kind: 'managed-local',
				original: 'assets/missing.html'
			})
		);
		expect(missing.staticRuntimeDependencies).toBe('incomplete');
		expect(activeData.scanIssues).toContainEqual(
			expect.objectContaining({code: 'unrecognized-static-reference'})
		);
		expect(JSON.stringify(activeData)).not.toContain(dataUrl);
		expect(activeData.staticRuntimeDependencies).toBe('unknown');
		expect(reloadOnly.scanIssues).toHaveLength(0);
		expect(reloadOnly.staticRuntimeDependencies).toBe('complete');
		expect(invalid.dependencies).not.toContainEqual(
			expect.objectContaining({original: 'https://example.com/wrong'})
		);
		expect(invalid.staticRuntimeDependencies).toBe('complete');
	});

	it('reports invalid UTF-8, source bounds, and unrecognized CSS conservatively', () => {
		const invalid = assessPackageDependencies({
			assets: [
				dependencyAsset('assets/invalid.css', new Uint8Array([0xc3, 0x28]), {
					mediaType: 'text/css'
				})
			],
			html: ''
		});
		const bounded = assessPackageDependencies({
			assets: [
				dependencyAsset('assets/large.css', 'body { color: red }', {
					mediaType: 'text/css'
				})
			],
			html: '',
			limits: {maxCssFileBytes: 4}
		});
		const unrecognized = assessPackageDependencies({
			assets: [
				dependencyAsset('assets/broken.css', 'a { background: url("oops) }', {
					mediaType: 'text/css'
				})
			],
			html: ''
		});
		const escapedSyntax = assessPackageDependencies({
			assets: [
				dependencyAsset(
					'assets/escaped.css',
					'body { background: u\\72l("https://cdn.example/x.png") }',
					{mediaType: 'text/css'}
				)
			],
			html: ''
		});

		expect(invalid.scanIssues).toContainEqual(
			expect.objectContaining({code: 'invalid-css-utf8'})
		);
		expect(bounded.scanIssues).toContainEqual(
			expect.objectContaining({code: 'css-source-limit'})
		);
		expect(unrecognized.scanIssues).toContainEqual(
			expect.objectContaining({code: 'unrecognized-static-reference'})
		);
		expect(escapedSyntax.scanIssues).toContainEqual(
			expect.objectContaining({
				code: 'unrecognized-static-reference',
				message: expect.stringContaining('CSS escapes')
			})
		);
		for (const result of [invalid, bounded, unrecognized, escapedSyntax]) {
			expect(result.copiedAssetContents).toBe('partially-evaluated');
			expect(result.staticRuntimeDependencies).toBe('unknown');
		}
	});

	it('sorts and deduplicates deterministically regardless of asset order', () => {
		const first = dependencyAsset(
			'assets/z.css',
			'@import "https://example.com/z.css";',
			{mediaType: 'text/css'}
		);
		const second = dependencyAsset(
			'assets/a.css',
			'@import "https://example.com/a.css";',
			{mediaType: 'text/css'}
		);
		const html = '<link href="assets/z.css"><link href="assets/z.css">';
		const forward = assessPackageDependencies({assets: [first, second], html});
		const reverse = assessPackageDependencies({assets: [second, first], html});

		expect(reverse).toEqual(forward);
		expect(
			forward.dependencies.filter(
				dependency =>
					dependency.original === 'Runtime JavaScript dependency discovery'
			)
		).toHaveLength(1);
	});

	it('explicitly leaves dynamic JavaScript dependency discovery unevaluated', () => {
		const result = assessPackageDependencies({
			assets: [],
			html: '<main></main>'
		});

		expect(result.dependencies).toContainEqual({
			disposition: 'not-evaluated',
			kind: 'dynamic-unknown',
			original: 'Runtime JavaScript dependency discovery',
			sourceLocation: 'generated HTML and packaged scripts'
		});
		expect(result.staticRuntimeDependencies).toBe('complete');
		expect(result.copiedAssetContents).toBe('not-evaluated');
	});
});
