import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import path from 'path';
import {spawnSync} from 'child_process';
import {
	normalizeGraphProjectionOptions,
	storyToCoreGraphProjection
} from '../graph-projection';
import {projectSnapshotFromStories} from '../project-snapshot';
import {normalizeStoryIndexOptions, storyToCoreIndex} from '../story-index';
import {fakePassage, fakeStory} from '../../test-util';
import type {StoryWithDocuments as Story} from '../../store/stories';

function parityStory() {
	const story = fakeStory(0);

	story.id = 'story-1';
	story.ifid = 'IFID';
	story.name = 'Parity Story';
	story.storyFormat = 'Harlowe';
	story.storyFormatVersion = '3.3.9';
	story.tagColors = {scene: 'red'};
	story.script = 'const $score = 1; assets/script.js';
	story.stylesheet = 'tw-story { background-image: url("assets/bg.png"); }';
	story.passages = [
		fakePassage({
			height: 100,
			id: 'start',
			left: 0,
			name: 'Start',
			story: story.id,
			tags: ['scene'],
			text: 'Set $score. [[Next]] <img src="assets/cover.png">',
			top: 0,
			width: 160
		}),
		fakePassage({
			height: 100,
			id: 'next',
			left: 220,
			name: 'Next',
			story: story.id,
			tags: [],
			text: 'Loop [[Next]] and [[Missing]]',
			top: 0,
			width: 160
		}),
		fakePassage({
			height: 100,
			id: 'loose',
			left: 0,
			name: 'Loose',
			story: story.id,
			tags: [],
			text: '',
			top: 180,
			width: 160
		})
	];
	story.startPassage = 'start';
	return story;
}

function knownImageAsset(path: string) {
	return {
		durationMs: null,
		exists: true,
		height: null,
		kind: 'image',
		missing: false,
		modifiedAt: null,
		normalizedPath: path,
		path,
		previewUrl: null,
		publish: {
			copy: true,
			outputPath: path,
			reason: 'Copy asset into published output'
		},
		referenceCount: 0,
		references: [],
		sizeBytes: 42,
		snippet: {
			label: 'Insert asset reference',
			mediaType: 'image',
			text: ''
		},
		thumbnailUrl: null,
		unused: true,
		width: null
	};
}

function runWasmQuery<T>(
	story: Story,
	query: {kind: 'graph'; options: unknown} | {kind: 'index'; options: unknown}
): T {
	const dir = mkdtempSync(path.join(tmpdir(), 'twine-wasm-parity-'));
	const inputPath = path.join(dir, 'input.json');
	const outputPath = path.join(dir, 'output.json');
	const root = process.cwd();
	const wasmPackage = path.join(root, 'src/core/wasm/pkg/twine_wasm.js');
	const wasmBytes = path.join(root, 'src/core/wasm/pkg/twine_wasm_bg.wasm');

	writeFileSync(
		inputPath,
		JSON.stringify({
			...query,
			snapshot: projectSnapshotFromStories([story]),
			storyId: story.id
		})
	);

	const script = `
		import {readFile, writeFile} from 'node:fs/promises';
		import init, {TwineWasmProjectSession} from ${JSON.stringify(
			`file://${wasmPackage}`
		)};
		const input = JSON.parse(await readFile(${JSON.stringify(inputPath)}, 'utf8'));
		await init(await readFile(${JSON.stringify(wasmBytes)}));
		const session = new TwineWasmProjectSession(input.snapshot);
		const result = input.kind === 'graph'
			? session.query_graph_projection(input.storyId, input.options)
			: session.query_story_index(input.storyId, input.options);
		await writeFile(${JSON.stringify(outputPath)}, JSON.stringify(result));
	`;
	const result = spawnSync(process.execPath, ['--input-type=module'], {
		encoding: 'utf8',
		input: script
	});

	try {
		if (result.status !== 0) {
			throw new Error(result.stderr || result.stdout);
		}

		return JSON.parse(readFileSync(outputPath, 'utf8')) as T;
	} finally {
		rmSync(dir, {force: true, recursive: true});
	}
}

function hitShape(hit: {
	line: number;
	matchText: string;
	passageId: string | null;
	scope: string;
	sourceId: string;
}) {
	return {
		line: hit.line,
		matchText: hit.matchText,
		passageId: hit.passageId,
		scope: hit.scope,
		sourceId: hit.sourceId
	};
}

describe('generated WASM core parity', () => {
	it('matches TypeScript graph projections for saved-layout stories', () => {
		const story = parityStory();
		const options = normalizeGraphProjectionOptions({
			layers: {broken: true, resolved: true, selfLinks: true},
			viewport: {height: 420, left: 0, top: 0, width: 500}
		});
		const jsProjection = storyToCoreGraphProjection(story, options);
		const wasmProjection = runWasmQuery<typeof jsProjection>(story, {
			kind: 'graph',
			options
		});

		expect(wasmProjection).toEqual(jsProjection);
	});

	it('matches TypeScript story index facts for diagnostics, symbols, assets, and search', () => {
		const story = parityStory();
		const options = normalizeStoryIndexOptions({
			knownAssets: [
				knownImageAsset('assets/unused.png'),
				knownImageAsset('assets/a#b.png'),
				knownImageAsset('assets/a%2Fb.png')
			],
			query: '$score'
		});
		const jsIndex = storyToCoreIndex(story, options);
		const wasmIndex = runWasmQuery<typeof jsIndex>(story, {
			kind: 'index',
			options
		});

		expect(wasmIndex.graph).toEqual(jsIndex.graph);
		expect(wasmIndex.files).toEqual(jsIndex.files);
		expect(wasmIndex.tags).toEqual(jsIndex.tags);
		expect(wasmIndex.tagEntries).toEqual(jsIndex.tagEntries);
		expect(wasmIndex.assets).toEqual(jsIndex.assets);
		expect(wasmIndex.assetInventory).toEqual(jsIndex.assetInventory);
		expect(wasmIndex.symbols).toEqual(jsIndex.symbols);
		expect(wasmIndex.diagnostics.map(diagnostic => diagnostic.code)).toEqual(
			jsIndex.diagnostics.map(diagnostic => diagnostic.code)
		);
		expect(wasmIndex.searchHits.map(hitShape)).toEqual(
			jsIndex.searchHits.map(hitShape)
		);
		expect(
			jsIndex.assetInventory
				.filter(asset =>
					['assets/a#b.png', 'assets/a%2Fb.png'].includes(asset.path)
				)
				.map(asset => [asset.path, asset.snippet.text])
		).toEqual([
			['assets/a#b.png', '<img src="assets/a%23b.png" alt="">'],
			['assets/a%2Fb.png', '<img src="assets/a%252Fb.png" alt="">']
		]);
	});

	it('matches TypeScript asset ranges for CSS images and responsive sources', () => {
		const story = parityStory();
		const source = [
			'😀<img srcset="hero,retina.webp?rev=1#face 2x, data:image/png;base64,AA== 3x">',
			'<img srcset="data:image/gif;base64,AA== ((x), recovered.webp 2x">',
			'<link rel="preload" as="image" imagesrcset="small.webp 400w, large.webp 800w">',
			'<style>.hero{background:image-set("sheet hero.webp?rev=3#top" type("image/webp") 2x)}.legacy{background:-webkit-image-set("sheet legacy.webp" 1x)}</style>',
			'<link rel="preload" href="theme.bin?rev=2#main">',
			'<object data="manual.pdf"></object>',
			'<svg><image xlink:href="texture.ktx2#layer"></image><a download xlink:href="vector.bin">Vector</a></svg>',
			'<a href="book.epub" download>Download</a>',
			'<meta http-equiv="refresh" content="0; URL=\'next page.html?rev=5#start\'">'
		].join('');
		const options = normalizeStoryIndexOptions({});

		story.passages[0].text = source;
		const jsIndex = storyToCoreIndex(story, options);
		const wasmIndex = runWasmQuery<typeof jsIndex>(story, {
			kind: 'index',
			options
		});

		expect(wasmIndex.assetInventory).toEqual(jsIndex.assetInventory);
		expect(
			wasmIndex.assetInventory.flatMap(asset =>
				asset.references
					.filter(reference => reference.sourceId === story.passages[0].id)
					.map(reference => [
						asset.path,
						reference.context,
						source.slice(reference.start, reference.end)
					])
			)
		).toEqual([
			['assets/book.epub', 'html-href', 'book.epub'],
			['assets/hero,retina.webp', 'html-srcset', 'hero,retina.webp?rev=1#face'],
			['assets/large.webp', 'html-srcset', 'large.webp'],
			['assets/manual.pdf', 'html-data', 'manual.pdf'],
			['assets/next page.html', 'html-refresh', 'next page.html?rev=5#start'],
			['assets/recovered.webp', 'html-srcset', 'recovered.webp'],
			['assets/sheet hero.webp', 'css-url', 'sheet hero.webp?rev=3#top'],
			['assets/sheet legacy.webp', 'css-url', 'sheet legacy.webp'],
			['assets/small.webp', 'html-srcset', 'small.webp'],
			['assets/texture.ktx2', 'html-href', 'texture.ktx2#layer'],
			['assets/theme.bin', 'html-href', 'theme.bin?rev=2#main'],
			['assets/vector.bin', 'html-href', 'vector.bin']
		]);
	});

	it('matches SVG presentation URLs and parsed attribute authority', () => {
		const story = parityStory();
		const source = [
			'😀<svg><rect filter="url(filters.svg#blur)"',
			' fill="url(paints.svg#gradient)" clip-path="url(#local)"',
			' marker-end="u\\72l(escaped.svg#end)"></rect></svg>',
			'<img src="actual.png" alt="attribute-ghost.png">',
			'<div title="title-ghost.png" data-example=data-ghost.png></div>',
			'"free.png"'
		].join('');
		const options = normalizeStoryIndexOptions({});

		story.passages[0].text = source;
		const jsIndex = storyToCoreIndex(story, options);
		const wasmIndex = runWasmQuery<typeof jsIndex>(story, {
			kind: 'index',
			options
		});

		expect(wasmIndex.assetInventory).toEqual(jsIndex.assetInventory);
		expect(
			jsIndex.assetInventory
				.flatMap(asset =>
					asset.references
						.filter(reference => reference.sourceId === story.passages[0].id)
						.map(reference => ({
							context: reference.context,
							path: asset.path,
							raw: source.slice(reference.start, reference.end),
							start: reference.start
						}))
				)
				.sort((left, right) => left.start - right.start)
				.map(({context, path, raw}) => ({context, path, raw}))
		).toEqual([
			{
				context: 'css-url',
				path: 'assets/filters.svg',
				raw: 'filters.svg#blur'
			},
			{
				context: 'css-url',
				path: 'assets/paints.svg',
				raw: 'paints.svg#gradient'
			},
			{context: 'html-src', path: 'assets/actual.png', raw: 'actual.png'},
			{context: 'literal', path: 'assets/free.png', raw: 'free.png'}
		]);
	});

	it('matches native HTML and SVG resource attribute semantics', () => {
		const story = parityStory();
		const source = [
			'😀<body background="body&amp;hero.png?rev=1#top">',
			'<div src="inert.png" srcset="inert-small.png 1x" poster="inert-poster.png"></div>',
			'<img src="actual.png"><image src="legacy.png" srcset="legacy-small.png 1x">',
			'<input type="IMAGE" src="button.png"><input type=" IMAGE" src="spaced.png">',
			'<svg><linearGradient href="gradients.svg#base"></linearGradient>',
			'<pattern xlink:href="patterns.svg#base"></pattern>',
			'<textPath href="paths.svg#curve"></textPath>',
			'<image href="preferred.png" xlink:href="ignored.png"></image>',
			'<use href xlink:href="empty-fallback.svg"></use>',
			'<a download href xlink:href="download-fallback.svg">Empty</a>',
			'<mpath href="motion.svg#curve"></mpath>',
			'<script href="runtime.js"></script>',
			'<animate href="animation.svg#target"></animate>',
			'<filter href="legacy-filter.svg#base"></filter>',
			'<rect href="inert.svg"></rect></svg>'
		].join('');
		const options = normalizeStoryIndexOptions({});

		story.passages[0].text = source;
		const jsIndex = storyToCoreIndex(story, options);
		const wasmIndex = runWasmQuery<typeof jsIndex>(story, {
			kind: 'index',
			options
		});

		expect(wasmIndex.assetInventory).toEqual(jsIndex.assetInventory);
		expect(
			jsIndex.assetInventory
				.flatMap(asset =>
					asset.references
						.filter(reference => reference.sourceId === story.passages[0].id)
						.map(reference => ({
							context: reference.context,
							path: asset.path,
							raw: source.slice(reference.start, reference.end),
							start: reference.start
						}))
				)
				.sort((left, right) => left.start - right.start)
				.map(({context, path, raw}) => ({context, path, raw}))
		).toEqual([
			{
				context: 'html-background',
				path: 'assets/body&hero.png',
				raw: 'body&amp;hero.png?rev=1#top'
			},
			{context: 'html-src', path: 'assets/actual.png', raw: 'actual.png'},
			{context: 'html-src', path: 'assets/legacy.png', raw: 'legacy.png'},
			{
				context: 'html-srcset',
				path: 'assets/legacy-small.png',
				raw: 'legacy-small.png'
			},
			{context: 'html-src', path: 'assets/button.png', raw: 'button.png'},
			{
				context: 'html-href',
				path: 'assets/gradients.svg',
				raw: 'gradients.svg#base'
			},
			{
				context: 'html-href',
				path: 'assets/patterns.svg',
				raw: 'patterns.svg#base'
			},
			{
				context: 'html-href',
				path: 'assets/paths.svg',
				raw: 'paths.svg#curve'
			},
			{
				context: 'html-href',
				path: 'assets/preferred.png',
				raw: 'preferred.png'
			},
			{
				context: 'html-href',
				path: 'assets/motion.svg',
				raw: 'motion.svg#curve'
			},
			{context: 'html-href', path: 'assets/runtime.js', raw: 'runtime.js'}
		]);
	});

	it('matches tokenizer states, entity semantics, link relations, and raw ranges', () => {
		const story = parityStory();
		const source = [
			'😀<img src="hero&amp;retina.png&#63;rev=1&amp;x=2&num;face">',
			'<img srcset="hero&comma;retina.webp 2x">',
			'<img src="folder\\hero.png"><img src="folder&bsol;hero.png"><img src="folder&#92;hero.png"><source srcset="folder\\hero.png 1x, folder&#x5c;hero.png 2x">',
			'<div style="background:url(inline&amp;texture.bin&#63;x=1&num;f)"></div>',
			'<meta http-equiv="ref&#114;esh" content="0;URL=next&amp;page.bin&#63;x=2&num;top">',
			'<textarea><img src="textarea-ghost.bin"> ghost.png</textarea>',
			'<noscript><img src="noscript-ghost.bin"> ghost.png</noscript>',
			'<script><!--<script></script><img src="script-ghost.bin"></script>',
			'<script><!--><script></script><img src="script-recovered.bin">',
			'<script><!--<foo</script><img src="script-reconsumed.bin">',
			'<svg><title><img src="svg-title.png"></title><script><image href="svg-script.bin"></script>',
			'<foreignObject><title><img src="integration-ghost.bin"></title></foreignObject></svg>',
			'<math><annotation-xml><svg><foreignObject><title><img src="math-svg-ghost.bin"></title></foreignObject></svg></annotation-xml></math>',
			'<linK rel="stylesheet" href="kelvin-ghost.bin">',
			'<link rel="canonical" href="canonical-ghost.png">',
			'<link rel="&nbsp;stylesheet" href="nbsp-ghost.png">',
			'<link rel="preload" as="&nbsp;image" imagesrcset="nbsp-image-ghost.png 1x">',
			'<meta http-equiv=" refresh " content="0;URL=refresh-ghost.png">',
			'<math><annotation-xml encoding="&nbsp;text/html"><title><img src="math-live.png"></title></annotation-xml></math>',
			'<link rel="future" href="unknown.bin"><link rel="future stylesheet" href="theme.bin">',
			'<link rel="preload" as="image" imagesrcset="small.png 1x, large.png 2x">',
			'<!-- bad --!><img src="after-comment.png">',
			'<!---><img src="after-start-dash.png">',
			'</<!--foo><img src="after-bogus-end.png">',
			'<style.foo><img src="style-child.png"></style.foo>'
		].join('');
		const options = normalizeStoryIndexOptions({});

		story.passages[0].text = source;
		story.script =
			'const opening = "<textarea>"; const image = "script-safe.png";';
		const jsIndex = storyToCoreIndex(story, options);
		const wasmIndex = runWasmQuery<typeof jsIndex>(story, {
			kind: 'index',
			options
		});

		expect(wasmIndex.assetInventory).toEqual(jsIndex.assetInventory);
		expect(
			jsIndex.assetInventory
				.find(asset => asset.path === 'assets/script-safe.png')
				?.references.map(reference => reference.context)
		).toEqual(['literal']);
		expect(
			jsIndex.assetInventory
				.flatMap(asset =>
					asset.references
						.filter(reference => reference.sourceId === story.passages[0].id)
						.map(reference => ({
							context: reference.context,
							fragment: reference.fragment,
							path: asset.path,
							query: reference.query,
							raw: source.slice(reference.start, reference.end),
							start: reference.start
						}))
				)
				.sort((left, right) => left.start - right.start)
				.map(reference => ({
					context: reference.context,
					fragment: reference.fragment,
					path: reference.path,
					query: reference.query,
					raw: reference.raw
				}))
		).toEqual([
			{
				context: 'html-src',
				fragment: '&num;face',
				path: 'assets/hero&retina.png',
				query: '&#63;rev=1&amp;x=2',
				raw: 'hero&amp;retina.png&#63;rev=1&amp;x=2&num;face'
			},
			{
				context: 'html-srcset',
				fragment: null,
				path: 'assets/hero,retina.webp',
				query: null,
				raw: 'hero&comma;retina.webp'
			},
			{
				context: 'html-src',
				fragment: null,
				path: 'assets/folder/hero.png',
				query: null,
				raw: 'folder\\hero.png'
			},
			{
				context: 'html-src',
				fragment: null,
				path: 'assets/folder/hero.png',
				query: null,
				raw: 'folder&bsol;hero.png'
			},
			{
				context: 'html-src',
				fragment: null,
				path: 'assets/folder/hero.png',
				query: null,
				raw: 'folder&#92;hero.png'
			},
			{
				context: 'html-srcset',
				fragment: null,
				path: 'assets/folder/hero.png',
				query: null,
				raw: 'folder\\hero.png'
			},
			{
				context: 'html-srcset',
				fragment: null,
				path: 'assets/folder/hero.png',
				query: null,
				raw: 'folder&#x5c;hero.png'
			},
			{
				context: 'css-url',
				fragment: '&num;f',
				path: 'assets/inline&texture.bin',
				query: '&#63;x=1',
				raw: 'inline&amp;texture.bin&#63;x=1&num;f'
			},
			{
				context: 'html-refresh',
				fragment: '&num;top',
				path: 'assets/next&page.bin',
				query: '&#63;x=2',
				raw: 'next&amp;page.bin&#63;x=2&num;top'
			},
			{
				context: 'html-src',
				fragment: null,
				path: 'assets/script-recovered.bin',
				query: null,
				raw: 'script-recovered.bin'
			},
			{
				context: 'html-src',
				fragment: null,
				path: 'assets/script-reconsumed.bin',
				query: null,
				raw: 'script-reconsumed.bin'
			},
			{
				context: 'html-src',
				fragment: null,
				path: 'assets/svg-title.png',
				query: null,
				raw: 'svg-title.png'
			},
			{
				context: 'html-href',
				fragment: null,
				path: 'assets/svg-script.bin',
				query: null,
				raw: 'svg-script.bin'
			},
			{
				context: 'html-src',
				fragment: null,
				path: 'assets/math-live.png',
				query: null,
				raw: 'math-live.png'
			},
			{
				context: 'html-href',
				fragment: null,
				path: 'assets/theme.bin',
				query: null,
				raw: 'theme.bin'
			},
			{
				context: 'html-srcset',
				fragment: null,
				path: 'assets/small.png',
				query: null,
				raw: 'small.png'
			},
			{
				context: 'html-srcset',
				fragment: null,
				path: 'assets/large.png',
				query: null,
				raw: 'large.png'
			},
			{
				context: 'html-src',
				fragment: null,
				path: 'assets/after-comment.png',
				query: null,
				raw: 'after-comment.png'
			},
			{
				context: 'html-src',
				fragment: null,
				path: 'assets/after-start-dash.png',
				query: null,
				raw: 'after-start-dash.png'
			},
			{
				context: 'html-src',
				fragment: null,
				path: 'assets/after-bogus-end.png',
				query: null,
				raw: 'after-bogus-end.png'
			},
			{
				context: 'html-src',
				fragment: null,
				path: 'assets/style-child.png',
				query: null,
				raw: 'style-child.png'
			}
		]);
	});

	it('matches URL preprocessing and encoded segment boundaries', () => {
		const story = parityStory();
		const source = [
			'<img src="x\ty.png"><img src="x&Tab;y.png">',
			'<img src="x%09y.png"><img src="&nbsp;hero.png">',
			'<img src="&#1;edge.png"><img src="hero.png ?rev=1">',
			'<img src="https%3Afoo.png">',
			'<img src="a//b.png"><img src="a&sol;&sol;b.png">',
			'<img src="a%2Fb.png"><img src="a%5Cb.png">',
			'<img src="assets%2Fhero.png"><img src="a&percnt;2Fb.png">',
			'<img src="\0nul-ghost.png">',
			'const first = " literal.png"; const second = "﻿literal.webp"; const unmanaged = " assets/data.bin";'
		].join('');
		const options = normalizeStoryIndexOptions({});

		story.passages[0].text = source;
		const jsIndex = storyToCoreIndex(story, options);
		const wasmIndex = runWasmQuery<typeof jsIndex>(story, {
			kind: 'index',
			options
		});

		expect(wasmIndex.assetInventory).toEqual(jsIndex.assetInventory);
		expect(
			jsIndex.assetInventory
				.flatMap(asset =>
					asset.references
						.filter(reference => reference.sourceId === story.passages[0].id)
						.map(reference => ({
							path: asset.path,
							raw: source.slice(reference.start, reference.end),
							start: reference.start
						}))
				)
				.sort((left, right) => left.start - right.start)
				.map(({path, raw}) => ({path, raw}))
		).toEqual([
			{path: 'assets/xy.png', raw: 'x\ty.png'},
			{path: 'assets/xy.png', raw: 'x&Tab;y.png'},
			{path: 'assets/x\ty.png', raw: 'x%09y.png'},
			{path: 'assets/ hero.png', raw: '&nbsp;hero.png'},
			{path: 'assets/edge.png', raw: 'edge.png'},
			{path: 'assets/hero.png ', raw: 'hero.png ?rev=1'},
			{path: 'assets/https:foo.png', raw: 'https%3Afoo.png'},
			{path: 'assets/ literal.png', raw: ' literal.png'},
			{path: 'assets/﻿literal.webp', raw: '﻿literal.webp'}
		]);
	});

	it('matches TypeScript story index facts for lean search queries', () => {
		const story = parityStory();
		const options = normalizeStoryIndexOptions({
			includeAssets: false,
			includeContents: false,
			includeDiagnostics: false,
			includeFiles: false,
			includeGraph: false,
			includePassageNames: false,
			includeScript: true,
			includeStylesheet: true,
			includeTags: false,
			includeVariables: false,
			query: 'assets'
		});
		const jsIndex = storyToCoreIndex(story, options);
		const wasmIndex = runWasmQuery<typeof jsIndex>(story, {
			kind: 'index',
			options
		});

		expect(wasmIndex.assetInventory).toEqual([]);
		expect(wasmIndex.assets).toEqual([]);
		expect(wasmIndex.contents).toEqual([]);
		expect(wasmIndex.diagnostics).toEqual([]);
		expect(wasmIndex.files).toEqual([]);
		expect(wasmIndex.graph).toEqual(jsIndex.graph);
		expect(wasmIndex.symbols).toEqual([]);
		expect(wasmIndex.searchHits.map(hitShape)).toEqual(
			jsIndex.searchHits.map(hitShape)
		);
	});
});
