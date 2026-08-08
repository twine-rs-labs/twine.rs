import {
	copyAssetSnippetCommand,
	deleteAssetCommand,
	importAssetCommand,
	insertAssetSnippetCommand,
	mergeKnownAssetInventory,
	renameAssetCommand,
	replaceAssetCommand,
	revealAssetCommand,
	validateAssetReferencesCommand
} from '../index';
import {storyToCoreIndex} from '../story-index';
import {assetManagerViewModel} from '../view-models';
import {
	assetSnippet,
	assetReferencesInSource,
	boundedReferencedMediaPathsInSource,
	classifyHtmlLinkRelations,
	compareAssetPaths,
	normalizedAssetPath,
	projectAssetPath,
	replaceAssetReferencesInSource
} from '../asset-paths';
import {fakePassage, fakeStory} from '../../test-util';

describe('asset M5 contract', () => {
	it('orders asset paths by Unicode scalar value without locale dependence', () => {
		expect(
			['assets/\u{10000}.png', 'assets/\uE000.png', 'assets/a.png'].sort(
				compareAssetPaths
			)
		).toEqual(['assets/a.png', 'assets/\uE000.png', 'assets/\u{10000}.png']);
	});
	it('preserves logical asset names while encoding authored URL references', () => {
		const logicalPath = 'assets/a#b%2F c.png';
		const source =
			'<img src="old.png"><style>.hero{background:url("old.png")}</style>';
		const rewritten = replaceAssetReferencesInSource(
			source,
			'assets/old.png',
			logicalPath
		);

		expect(projectAssetPath(logicalPath)).toBe(logicalPath);
		expect(rewritten).toBe(
			'<img src="assets/a%23b%252F%20c.png"><style>.hero{background:url("assets/a%23b%252F%20c.png")}</style>'
		);
		expect(
			assetReferencesInSource('passage-a', 'Start', rewritten, 'passage-a').map(
				reference => reference.path
			)
		).toEqual([logicalPath, logicalPath]);
		expect(assetSnippet(logicalPath, 'image').text).toBe(
			'<img src="assets/a%23b%252F%20c.png" alt="">'
		);
	});
	it('keeps bounded media candidates in parity with complete full parsing', () => {
		const source = [
			'<img src="assets/z.png">',
			'<audio src="assets/b.ogg"><source src="assets/a.mp3">',
			'<style>body { background: url("assets/c.webp") } /* url(assets/comment.png) */</style>',
			'<div style="background:url(\'assets/inline.png\')"></div>',
			'a::after { content: "url(assets/string.png)"; }',
			'const media = "assets/d.webm";',
			'<link rel="stylesheet" href="assets/style.css">'
		].join('\n');
		const fullPaths = [
			...new Set(
				assetReferencesInSource('source', 'Source', source, null)
					.filter(reference =>
						['image', 'audio', 'video'].includes(reference.kind)
					)
					.map(reference => normalizedAssetPath(reference.path))
			)
		].sort(compareAssetPaths);

		expect(boundedReferencedMediaPathsInSource(source)).toEqual({
			complete: true,
			paths: [
				'assets/a.mp3',
				'assets/b.ogg',
				'assets/c.webp',
				'assets/d.webm',
				'assets/inline.png',
				'assets/z.png'
			]
		});
		expect(fullPaths).toEqual(
			boundedReferencedMediaPathsInSource(source).paths
		);
	});
	it('uses the no-media fast path without missing encoded media suffixes', () => {
		expect(
			boundedReferencedMediaPathsInSource(
				'Ordinary prose. const note = "archive.txt"; no local media here.'
			)
		).toEqual({complete: true, paths: []});
		expect(
			boundedReferencedMediaPathsInSource('const image = "assets/cover%2Epng";')
		).toEqual({complete: true, paths: ['assets/cover.png']});
		expect(
			boundedReferencedMediaPathsInSource(
				'const audio = "assets/theme.%6D%70%33";'
			)
		).toEqual({complete: true, paths: ['assets/theme.mp3']});
		expect(boundedReferencedMediaPathsInSource('('.repeat(257), true)).toEqual({
			complete: true,
			paths: []
		});
		for (const marker of ['%2E', '&period;', 'é', '\\2e ']) {
			const source = `${marker}${'('.repeat(257)}`;

			expect(boundedReferencedMediaPathsInSource(source, true)).toEqual({
				complete: false,
				paths: []
			});
		}
	});
	it('fails bounded scanning closed for dense and oversized sources', () => {
		expect(
			boundedReferencedMediaPathsInSource(
				Array.from(
					{length: 257},
					(_, index) => `<img src="assets/${index}.png">`
				).join('')
			).complete
		).toBe(false);
		expect(
			boundedReferencedMediaPathsInSource('x'.repeat(1024 * 1024 + 1))
		).toEqual({complete: false, paths: []});
	});
	it('fails bounded scanning closed for oversized paths and dense srcsets', () => {
		const exactAsciiPath = `assets/${'a'.repeat(4085)}.png`;
		const oversizedAsciiPath = `assets/${'a'.repeat(4086)}.png`;
		const exactMultibytePath = `assets/a${'é'.repeat(2042)}.png`;
		const oversizedMultibytePath = `assets/aa${'é'.repeat(2042)}.png`;

		expect(
			boundedReferencedMediaPathsInSource(`<img src="${exactAsciiPath}">`)
		).toEqual({complete: true, paths: [exactAsciiPath]});
		expect(
			boundedReferencedMediaPathsInSource(`<img src="${oversizedAsciiPath}">`)
		).toEqual({complete: false, paths: []});
		expect(
			boundedReferencedMediaPathsInSource(`<img src="${exactMultibytePath}">`)
		).toEqual({complete: true, paths: [exactMultibytePath]});
		expect(
			boundedReferencedMediaPathsInSource(
				`<img src="${oversizedMultibytePath}">`
			)
		).toEqual({complete: false, paths: []});
		expect(
			boundedReferencedMediaPathsInSource(
				`const blob = "${'x'.repeat(4097)}";<img src="assets/a.png">`
			)
		).toEqual({complete: true, paths: ['assets/a.png']});
		expect(
			boundedReferencedMediaPathsInSource(
				`const media = "assets/${'x'.repeat(4086)}%2Epng";`
			)
		).toEqual({complete: false, paths: []});
		expect(
			boundedReferencedMediaPathsInSource(
				`<img srcset="${','.repeat(16_384)}assets/last.png">`
			)
		).toEqual({complete: true, paths: ['assets/last.png']});
		expect(
			boundedReferencedMediaPathsInSource(
				`<img srcset="${Array.from(
					{length: 257},
					(_, index) => `assets/${index}.png 1x`
				).join(',')}">`
			)
		).toEqual({complete: false, paths: []});
		expect(
			boundedReferencedMediaPathsInSource(
				`<style>${'('.repeat(257)}assets/deep.png</style>`
			)
		).toEqual({complete: false, paths: []});
	});
	it('reports full-parser lines correctly with forward scanning', () => {
		const source = [
			'first',
			'<img src="assets/a.png">',
			'猫',
			'url("assets/b.webp")'
		].join('\n');

		expect(
			assetReferencesInSource('source', 'Source', source, null).map(
				reference => [reference.path, reference.line]
			)
		).toEqual([
			['assets/a.png', 2],
			['assets/b.webp', 4]
		]);
	});
	it('indexes arbitrary structured and explicitly managed asset files', () => {
		const references = [
			...assetReferencesInSource(
				'story:stylesheet',
				'Story Stylesheet',
				'@font-face { src: url("font.woff2") format("woff2"); }',
				null
			),
			...assetReferencesInSource(
				'passage-a',
				'Start',
				'<img src="assets/config.json">',
				'passage-a'
			),
			...assetReferencesInSource(
				'story:script',
				'Story JavaScript',
				'const module = "assets/runtime.wasm"; const note = "notes.txt";',
				null
			)
		];

		expect(
			references.map(reference => [reference.path, reference.kind])
		).toEqual([
			['assets/font.woff2', 'file'],
			['assets/config.json', 'file'],
			['assets/runtime.wasm', 'file']
		]);
	});
	it('handles data and blob srcset candidates individually and indexes resource contexts', () => {
		const source = [
			'<img srcset="data:image/png;base64,AAAA 1x, assets/猫%20cover.png?x=1#hero 2x">',
			'<source srcset="blob:https://example.test/id, assets/sound.ogg 1x">',
			'<source srcset="data:image/png;base64,AAAA, hero.webp 2x">',
			'<link rel="preload" href="theme.bin?rev=2#main"><link rel="manifest" href="site.webmanifest"><link rel="canonical" href="canonical.bin"><link href="bare.tokens">',
			'<object data="model.glb"></object><svg><image href="icon.bin"></image><use xlink:href="sprite.bin#x"></use><feImage href="filter.exr"></feImage></svg>',
			'<a download href="archive.zip">x</a><a href="later.zip" download>x</a><svg><a download xlink:href="vector-download.bin">x</a></svg><a href="navigation.bin">x</a><div href="ignored.bin"></div>',
			'<!-- <link rel="icon" href="comment.bin"> --><broken / junk><link title=">" rel="icon" href="after.bin"><link rel=icon href=unquoted.bin>'
		].join('\n');
		const references = assetReferencesInSource(
			'passage-a',
			'Start',
			source,
			'passage-a'
		);
		expect(
			references.map(reference => [reference.path, reference.context])
		).toEqual([
			['assets/猫 cover.png', 'html-srcset'],
			['assets/sound.ogg', 'html-srcset'],
			['assets/hero.webp', 'html-srcset'],
			['assets/theme.bin', 'html-href'],
			['assets/site.webmanifest', 'html-href'],
			['assets/model.glb', 'html-data'],
			['assets/icon.bin', 'html-href'],
			['assets/sprite.bin', 'html-href'],
			['assets/filter.exr', 'html-href'],
			['assets/archive.zip', 'html-href'],
			['assets/later.zip', 'html-href'],
			['assets/vector-download.bin', 'html-href'],
			['assets/after.bin', 'html-href'],
			['assets/unquoted.bin', 'html-href']
		]);
		const cat = references[0];
		expect(source.slice(cat.start, cat.end)).toBe(
			'assets/猫%20cover.png?x=1#hero'
		);
		expect(
			replaceAssetReferencesInSource(
				source,
				'assets/theme.bin',
				'assets/replaced.bin'
			)
		).toContain('href="assets/replaced.bin?rev=2#main"');
		expect(boundedReferencedMediaPathsInSource(source)).toEqual({
			complete: true,
			paths: ['assets/hero.webp', 'assets/sound.ogg', 'assets/猫 cover.png']
		});
	});
	it('scans dense data srcsets in a bounded pass', () => {
		const source = `<img srcset="data:image/png;base64,${','.repeat(65_536)}AAAA, assets/real.png 2x">`;

		expect(
			assetReferencesInSource('passage-a', 'Start', source, 'passage-a').map(
				reference => reference.path
			)
		).toEqual(['assets/real.png']);
		expect(boundedReferencedMediaPathsInSource(source)).toEqual({
			complete: true,
			paths: ['assets/real.png']
		});
	});
	it('projects entity-dense srcsets without rescanning every entity', () => {
		const candidateCount = 512;
		const source = `<img srcset="${Array.from(
			{length: candidateCount},
			(_, index) => `image-${index}&amp;retina.png 1x`
		).join(',')}">`;
		const originalFilter = Array.prototype.filter;
		let filterPredicateCalls = 0;
		const filterSpy = jest
			.spyOn(Array.prototype, 'filter')
			.mockImplementation(function (
				this: unknown[],
				predicate: (value: unknown, index: number, array: unknown[]) => unknown,
				thisArg?: unknown
			) {
				return originalFilter.call(this, (value, index, array) => {
					filterPredicateCalls++;
					return predicate.call(thisArg, value, index, array);
				});
			});
		let references: ReturnType<typeof assetReferencesInSource> = [];

		try {
			references = assetReferencesInSource(
				'passage-a',
				'Start',
				source,
				'passage-a'
			);
		} finally {
			filterSpy.mockRestore();
		}

		expect(filterPredicateCalls).toBeLessThan(candidateCount * 8);
		expect(references).toHaveLength(candidateCount);
		expect(
			[references[0], references[candidateCount - 1]].map(reference => ({
				original: reference.original,
				path: reference.path,
				raw: source.slice(reference.start, reference.end)
			}))
		).toEqual([
			{
				original: 'image-0&amp;retina.png',
				path: 'assets/image-0&retina.png',
				raw: 'image-0&amp;retina.png'
			},
			{
				original: 'image-511&amp;retina.png',
				path: 'assets/image-511&retina.png',
				raw: 'image-511&amp;retina.png'
			}
		]);
	});
	it('decodes HTML attribute character references while preserving raw ranges and suffixes', () => {
		const source = [
			'😀<img class="ordinary multi character value" src="hero&amp;retina.png&#63;rev=1&amp;x=2&num;face">',
			'<img srcset="hero&comma;retina.webp 2x">',
			'<img src="price&#x80;.png">',
			'<img src="unknown&NotARealEntity;.png">'
		].join('');
		const references = assetReferencesInSource(
			'passage-a',
			'Start',
			source,
			'passage-a'
		);

		expect(
			references.map(reference => ({
				fragment: reference.fragment,
				original: reference.original,
				path: reference.path,
				query: reference.query,
				raw: source.slice(reference.start, reference.end)
			}))
		).toEqual([
			{
				fragment: '&num;face',
				original: 'hero&amp;retina.png&#63;rev=1&amp;x=2&num;face',
				path: 'assets/hero&retina.png',
				query: '&#63;rev=1&amp;x=2',
				raw: 'hero&amp;retina.png&#63;rev=1&amp;x=2&num;face'
			},
			{
				fragment: null,
				original: 'hero&comma;retina.webp',
				path: 'assets/hero,retina.webp',
				query: null,
				raw: 'hero&comma;retina.webp'
			},
			{
				fragment: null,
				original: 'price&#x80;.png',
				path: 'assets/price€.png',
				query: null,
				raw: 'price&#x80;.png'
			},
			{
				fragment: null,
				original: 'unknown&NotARealEntity;.png',
				path: 'assets/unknown&NotARealEntity;.png',
				query: null,
				raw: 'unknown&NotARealEntity;.png'
			}
		]);
		expect(
			replaceAssetReferencesInSource(
				source,
				'assets/hero&retina.png',
				'assets/final.png'
			)
		).toContain('src="assets/final.png&#63;rev=1&amp;x=2&num;face"');
		expect(boundedReferencedMediaPathsInSource(source)).toEqual({
			complete: true,
			paths: [
				'assets/hero&retina.png',
				'assets/hero,retina.webp',
				'assets/price€.png',
				'assets/unknown&NotARealEntity;.png'
			].sort(compareAssetPaths)
		});
	});
	it('keeps HTML raw text, RCDATA, comments, and plaintext out of fallback discovery', () => {
		for (const tag of [
			'textarea',
			'title',
			'xmp',
			'iframe',
			'noembed',
			'noframes',
			'noscript'
		]) {
			const source = `<${tag}/><img src="ghost.png"> bare.png</${tag} data-close=">"><img src="real.png">`;

			expect(
				assetReferencesInSource('passage-a', 'Start', source, 'passage-a').map(
					reference => reference.path
				)
			).toEqual(['assets/real.png']);
			expect(
				replaceAssetReferencesInSource(
					source,
					'assets/ghost.png',
					'assets/replaced.png'
				)
			).toBe(source);
		}

		const script =
			'<script><!--<script></script><img src="ghost.png"> bare.png</script><img src="real.png">';
		expect(
			assetReferencesInSource('passage-a', 'Start', script, 'passage-a').map(
				reference => reference.path
			)
		).toEqual(['assets/real.png']);
		const abruptlyClosedEscapedScript =
			'<script><!--><script></script><img src="recovered.png">';

		expect(
			assetReferencesInSource(
				'passage-a',
				'Start',
				abruptlyClosedEscapedScript,
				'passage-a'
			).map(reference => reference.path)
		).toEqual(['assets/recovered.png']);
		expect(
			boundedReferencedMediaPathsInSource(abruptlyClosedEscapedScript)
		).toEqual({complete: true, paths: ['assets/recovered.png']});
		for (const [source, expected] of [
			[
				'<script><!--<foo</script><img src="after-foo.png">',
				'assets/after-foo.png'
			],
			[
				'<script><!--<scriptX</script><img src="after-script-x.png">',
				'assets/after-script-x.png'
			]
		] as const) {
			expect(
				assetReferencesInSource('passage-a', 'Start', source, 'passage-a').map(
					reference => reference.path
				)
			).toEqual([expected]);
			expect(boundedReferencedMediaPathsInSource(source)).toEqual({
				complete: true,
				paths: [expected]
			});
		}
		const bogusEndTag = '</<!--foo><img src="after-bogus-end.png">';

		expect(
			assetReferencesInSource(
				'passage-a',
				'Start',
				bogusEndTag,
				'passage-a'
			).map(reference => reference.path)
		).toEqual(['assets/after-bogus-end.png']);
		expect(boundedReferencedMediaPathsInSource(bogusEndTag)).toEqual({
			complete: true,
			paths: ['assets/after-bogus-end.png']
		});
		expect(
			assetReferencesInSource(
				'passage-a',
				'Start',
				'<!-- <img src="ghost.png"> bare.png --><img src="real.png">',
				'passage-a'
			).map(reference => reference.path)
		).toEqual(['assets/real.png']);
		expect(
			assetReferencesInSource(
				'passage-a',
				'Start',
				'<plaintext><img src="ghost.png"> bare.png<img src="never.png">',
				'passage-a'
			)
		).toEqual([]);
		const storyScript =
			'const opening = "<textarea>"; const image = "assets/safe.png"; const fake = \'<img src="ghost.png">\';';

		expect(
			assetReferencesInSource(
				'story:script',
				'Story JavaScript',
				storyScript,
				null
			).map(reference => [reference.path, reference.context])
		).toEqual([['assets/safe.png', 'literal']]);
		expect(
			boundedReferencedMediaPathsInSource(storyScript, false, true)
		).toEqual({complete: true, paths: ['assets/safe.png']});
		expect(
			replaceAssetReferencesInSource(
				storyScript,
				'assets/safe.png',
				'assets/renamed.png',
				false,
				true
			)
		).toContain('const image = "assets/renamed.png"');
	});
	it('matches WHATWG attribute entity edge cases in structured HTML and inline CSS', () => {
		const source = [
			'<img src="legacy&copy.png">',
			'<img src="blocked&ampx.png">',
			'<img src="multi&NotEqualTilde;mark.png">',
			'<img src="null&#0;.png">',
			'<img src="surrogate&#xD800;.png">',
			'<img src="large&#x110000;.png">',
			'<div style="background:url(hero&amp;retina.png&#63;x=1&num;f)"></div>',
			'<meta http-equiv="ref&#114;esh" content="0; URL=next&amp;page.bin&#63;x=1&num;f">'
		].join('');
		const references = assetReferencesInSource(
			'passage-a',
			'Start',
			source,
			'passage-a'
		);

		expect(
			references.map(reference => [
				reference.path,
				reference.context,
				reference.query,
				reference.fragment
			])
		).toEqual([
			['assets/legacy©.png', 'html-src', null, null],
			['assets/blocked&ampx.png', 'html-src', null, null],
			['assets/multi≂̸mark.png', 'html-src', null, null],
			['assets/null�.png', 'html-src', null, null],
			['assets/surrogate�.png', 'html-src', null, null],
			['assets/large�.png', 'html-src', null, null],
			['assets/hero&retina.png', 'css-url', '&#63;x=1', '&num;f'],
			['assets/next&page.bin', 'html-refresh', '&#63;x=1', '&num;f']
		]);
	});
	it('normalizes literal and entity-decoded HTML path separators', () => {
		const source =
			'<img src="folder\\hero.png"><img src="folder&bsol;hero.png"><img src="folder&#92;hero.png"><source srcset="folder\\hero.png 1x, folder&#x5c;hero.png 2x">';
		const references = assetReferencesInSource(
			'passage-a',
			'Start',
			source,
			'passage-a'
		);

		expect(
			references.map(reference => ({
				original: reference.original,
				path: reference.path,
				raw: source.slice(reference.start, reference.end)
			}))
		).toEqual([
			{
				original: 'folder\\hero.png',
				path: 'assets/folder/hero.png',
				raw: 'folder\\hero.png'
			},
			{
				original: 'folder&bsol;hero.png',
				path: 'assets/folder/hero.png',
				raw: 'folder&bsol;hero.png'
			},
			{
				original: 'folder&#92;hero.png',
				path: 'assets/folder/hero.png',
				raw: 'folder&#92;hero.png'
			},
			{
				original: 'folder\\hero.png',
				path: 'assets/folder/hero.png',
				raw: 'folder\\hero.png'
			},
			{
				original: 'folder&#x5c;hero.png',
				path: 'assets/folder/hero.png',
				raw: 'folder&#x5c;hero.png'
			}
		]);
		expect(boundedReferencedMediaPathsInSource(source)).toEqual({
			complete: true,
			paths: ['assets/folder/hero.png']
		});
		expect(
			replaceAssetReferencesInSource(
				source,
				'assets/folder/hero.png',
				'assets/replaced.png'
			)
		).toBe(
			'<img src="assets/replaced.png"><img src="assets/replaced.png"><img src="assets/replaced.png"><source srcset="assets/replaced.png 1x, assets/replaced.png 2x">'
		);
	});
	it('matches URL preprocessing without collapsing authored path segments', () => {
		const source = [
			'<img src="x\ty.png">',
			'<img src="x\ny.png">',
			'<img src="x\ry.png">',
			'<img src="x&Tab;y.png">',
			'<img src="x&NewLine;y.png">',
			'<img src="x&#13;y.png">',
			'<img src="x%09y.png">',
			'<img src="&nbsp;hero.png">',
			'<img src="&#1;edge.png">',
			'<img src="hero.png ?rev=1">',
			'<img src="a//b.png">',
			'<img src="a&sol;&sol;b.png">',
			'<img src="/assets//b.png">',
			'<img src="a%2Fb.png">',
			'<img src="a%5Cb.png">',
			'<img src="assets%2Fhero.png">',
			'<img src="a&percnt;2Fb.png">'
		].join('');
		const references = assetReferencesInSource(
			'passage-a',
			'Start',
			source,
			'passage-a'
		);

		expect(references.map(reference => reference.path)).toEqual([
			...Array<string>(6).fill('assets/xy.png'),
			'assets/x\ty.png',
			'assets/ hero.png',
			'assets/edge.png',
			'assets/hero.png '
		]);
		expect(boundedReferencedMediaPathsInSource(source)).toEqual({
			complete: true,
			paths: [
				'assets/edge.png',
				'assets/x\ty.png',
				'assets/xy.png',
				'assets/ hero.png'
			].sort(compareAssetPaths)
		});
		const rewritten = replaceAssetReferencesInSource(
			source,
			'assets/xy.png',
			'assets/clean.png'
		);

		expect(rewritten.match(/assets\/clean\.png/g)).toHaveLength(6);
		expect(rewritten).toContain('src="x%09y.png"');
		expect(rewritten).toContain('src="a%2Fb.png"');
		expect(rewritten).toContain('src="a&percnt;2Fb.png"');
		const literalNull = '<img src="\0hero.png">';

		expect(
			assetReferencesInSource('passage-a', 'Start', literalNull, 'passage-a')
		).toEqual([]);
		expect(boundedReferencedMediaPathsInSource(literalNull)).toEqual({
			complete: false,
			paths: []
		});
	});
	it('preserves non-C0 whitespace in quoted literal asset paths', () => {
		const source =
			'const first = " hero.png"; const second = "﻿cover.webp"; const unmanaged = " assets/data.bin";';

		expect(
			assetReferencesInSource('passage-a', 'Start', source, 'passage-a').map(
				reference => reference.path
			)
		).toEqual(['assets/ hero.png', 'assets/﻿cover.webp']);
		expect(boundedReferencedMediaPathsInSource(source)).toEqual({
			complete: true,
			paths: ['assets/ hero.png', 'assets/﻿cover.webp'].sort(compareAssetPaths)
		});
	});
	it('recovers live tags after malformed comments and keeps nonstandard tag names ordinary', () => {
		const source = [
			'<!-- bad --!><img src="after-bang.png">',
			'<!--><img src="after-abrupt.png">',
			'<!---><img src="after-start-dash.png">',
			'<!bogus " ><img src="after-bogus.png">',
			'<?bogus " ><img src="after-pi.png">',
			'<style.foo><img src="style-child.png"></style.foo>',
			'<script.foo><img src="script-child.png"></script.foo>',
			'<1img src="ghost.png">'
		].join('');

		expect(
			assetReferencesInSource('passage-a', 'Start', source, 'passage-a').map(
				reference => reference.path
			)
		).toEqual([
			'assets/after-bang.png',
			'assets/after-abrupt.png',
			'assets/after-start-dash.png',
			'assets/after-bogus.png',
			'assets/after-pi.png',
			'assets/style-child.png',
			'assets/script-child.png',
			'assets/ghost.png'
		]);
		expect(boundedReferencedMediaPathsInSource(source)).toEqual({
			complete: true,
			paths: [
				'assets/after-abrupt.png',
				'assets/after-bang.png',
				'assets/after-bogus.png',
				'assets/after-pi.png',
				'assets/after-start-dash.png',
				'assets/ghost.png',
				'assets/script-child.png',
				'assets/style-child.png'
			]
		});
		expect(
			assetReferencesInSource('passage-a', 'Start', source, 'passage-a').at(-1)
				?.context
		).toBe('literal');
	});
	it('preserves foreign-content dependencies and applies HTML text states at integration points', () => {
		const source = [
			'<svg><title><img src="svg-title.png"></title>',
			'<script><image href="svg-script.bin"></script>',
			'<style><image href="svg-style.bin"></style>',
			'<foreignObject><title><img src="html-title-ghost.png"></title></foreignObject>',
			'</svg>',
			'<math><annotation-xml><svg><foreignObject><title><img src="math-svg-ghost.png"></title></foreignObject></svg></annotation-xml></math>',
			'<img src="real.png">'
		].join('');

		expect(
			assetReferencesInSource('passage-a', 'Start', source, 'passage-a').map(
				reference => reference.path
			)
		).toEqual([
			'assets/svg-title.png',
			'assets/svg-script.bin',
			'assets/svg-style.bin',
			'assets/real.png'
		]);
	});
	it('classifies link relations and fails bounded scans closed for unknown-only extensions', () => {
		expect(
			classifyHtmlLinkRelations('future stylesheet canonical', 'image')
		).toEqual({
			href: true,
			imagesrcset: false,
			stylesheet: true,
			unknown: false
		});
		expect(classifyHtmlLinkRelations('expect canonical', 'image')).toEqual({
			href: false,
			imagesrcset: false,
			stylesheet: false,
			unknown: false
		});
		const source = [
			'<link rel="canonical" href="canonical.png">',
			'<link rel="expect" href="expect.png">',
			'<link href="bare.png">',
			'<link rel="future" href="unknown.png">',
			'<link rel="future stylesheet" href="mixed.bin">',
			'<link rel="icon" imagesrcset="ignored.png 1x">',
			'<link rel="preload" as="script" imagesrcset="ignored-too.png 1x">',
			'<link rel="preload" as="image" imagesrcset="small.png 1x, large.png 2x">',
			'<svg><link href="foreign.png"></link></svg>',
			'<div title="title.png" data-art="custom.png"></div>'
		].join('');

		expect(
			assetReferencesInSource('passage-a', 'Start', source, 'passage-a').map(
				reference => reference.path
			)
		).toEqual(['assets/mixed.bin', 'assets/small.png', 'assets/large.png']);
		expect(boundedReferencedMediaPathsInSource(source)).toEqual({
			complete: false,
			paths: []
		});
	});
	it('uses ASCII-only matching for HTML names, keywords, and whitespace', () => {
		expect(classifyHtmlLinkRelations('\u00a0stylesheet', '')).toEqual({
			href: false,
			imagesrcset: false,
			stylesheet: false,
			unknown: true
		});
		expect(classifyHtmlLinkRelations('preload', '\u00a0image')).toEqual({
			href: true,
			imagesrcset: false,
			stylesheet: false,
			unknown: false
		});
		expect(classifyHtmlLinkRelations('\vstylesheet', '')).toEqual({
			href: false,
			imagesrcset: false,
			stylesheet: false,
			unknown: true
		});
		const source = [
			'<linK rel="stylesheet" href="kelvin.bin">',
			'<svg><image xlinK:href="kelvin-attribute.bin"></image></svg>',
			'<link rel="masK-icon" href="mask.png">',
			'<link rel="&nbsp;stylesheet" href="nbsp.png">',
			'<link rel="preload" as="&nbsp;image" imagesrcset="nbsp-image.png 1x">',
			'<meta http-equiv=" refresh " content="0;URL=spaced-refresh.png">',
			'<meta http-equiv="&nbsp;refresh" content="0;URL=nbsp-refresh.png">',
			'<math><annotation-xml encoding="&nbsp;text/html"><title><img src="math-live.png"></title></annotation-xml></math>',
			'<math><annotation-xml encoding=" text/html "><title><img src="math-spaced-live.png"></title></annotation-xml></math>',
			'<LINK REL=" STYLESHEET " HREF="valid.bin">'
		].join('');

		expect(
			assetReferencesInSource('passage-a', 'Start', source, 'passage-a').map(
				reference => reference.path
			)
		).toEqual([
			'assets/math-live.png',
			'assets/math-spaced-live.png',
			'assets/valid.bin'
		]);
	});
	it('fails bounded CSS scanning only for URL-bearing escapes or escaped identifiers', () => {
		expect(
			boundedReferencedMediaPathsInSource(
				'a::after { content: "ordinary\\26 escaped"; }',
				true
			)
		).toEqual({complete: true, paths: []});
		for (const source of [
			'a { background: url("hero\\2e png"); }',
			'a { background: u\\72l(hero.png); }',
			'a { background: image-set("hero\\2e png" 2x); }',
			'@import "theme\\2e css";'
		]) {
			expect(boundedReferencedMediaPathsInSource(source, true)).toEqual({
				complete: false,
				paths: []
			});
		}
		expect(
			boundedReferencedMediaPathsInSource(
				'.x { content: "<link rel=custom href=ghost.png>"; }',
				true
			)
		).toEqual({complete: true, paths: []});
	});
	it('keeps decoded boundary memory compact for large irrelevant and plain attributes', () => {
		const source = `<img class="${'x'.repeat(
			200_000
		)}" src="plain-multi-character.png"><img src="hero&amp;retina.png">`;

		expect(
			assetReferencesInSource('passage-a', 'Start', source, 'passage-a').map(
				reference => reference.path
			)
		).toEqual(['assets/plain-multi-character.png', 'assets/hero&retina.png']);
		expect(boundedReferencedMediaPathsInSource(source)).toEqual({
			complete: true,
			paths: ['assets/hero&retina.png', 'assets/plain-multi-character.png']
		});
	});
	it('preserves URL commas and indexes link imagesrcset candidates', () => {
		const source = [
			'😀<img srcset="hero,retina.png?rev=1#face 2x, fallback.png 3x">',
			'<link rel="preload" as="image" imagesrcset="small.png 400w, large.png 800w" imagesizes="100vw">',
			'<img srcset="data:image/gif;base64,AA== ((x), recovered.png 2x">',
			'<meta http-equiv="refresh" content="0; URL=\'next page.html?rev=5#start\'">'
		].join('\n');
		const references = assetReferencesInSource(
			'passage-a',
			'Start',
			source,
			'passage-a'
		);

		expect(
			references.map(reference => [
				reference.path,
				reference.context,
				source.slice(reference.start, reference.end)
			])
		).toEqual([
			['assets/hero,retina.png', 'html-srcset', 'hero,retina.png?rev=1#face'],
			['assets/fallback.png', 'html-srcset', 'fallback.png'],
			['assets/small.png', 'html-srcset', 'small.png'],
			['assets/large.png', 'html-srcset', 'large.png'],
			['assets/recovered.png', 'html-srcset', 'recovered.png'],
			['assets/next page.html', 'html-refresh', 'next page.html?rev=5#start']
		]);
		expect(boundedReferencedMediaPathsInSource(source)).toEqual({
			complete: true,
			paths: [
				'assets/fallback.png',
				'assets/hero,retina.png',
				'assets/large.png',
				'assets/recovered.png',
				'assets/small.png'
			]
		});
		expect(
			replaceAssetReferencesInSource(
				source,
				'assets/hero,retina.png',
				'assets/hero,retina@2x.png'
			)
		).toContain('assets/hero%2Cretina%402x.png?rev=1#face 2x');
		expect(
			replaceAssetReferencesInSource(
				source,
				'assets/next page.html',
				'assets/next final.html'
			)
		).toContain("URL='assets/next%20final.html?rev=5#start'");
	});
	it('lexes CSS URLs without indexing strings or comments', () => {
		const source = [
			'<div style="background: url(\'inline.woff2\')"></div>',
			'<style>',
			'a::after { content: "url(string.woff2)"; }',
			'/* url(comment.woff2) url(comment.png) */',
			'@font-face { src: u/**/rl("font.woff2"); }',
			'</style>'
		].join('\n');

		expect(
			assetReferencesInSource('passage-a', 'Start', source, 'passage-a').map(
				reference => [reference.path, reference.context]
			)
		).toEqual([
			['assets/inline.woff2', 'css-url'],
			['assets/font.woff2', 'css-url']
		]);
	});
	it('indexes SVG presentation attribute URLs as CSS values', () => {
		const source = [
			'<svg>',
			'<rect filter="url(filters.svg#blur)" fill="url(paints.svg#gradient)"',
			' clip-path="url(#local-clip)" marker-end="url(markers.svg#end)"></rect>',
			'</svg>'
		].join('');
		const references = assetReferencesInSource(
			'passage-a',
			'Start',
			source,
			'passage-a'
		);

		expect(
			references.map(reference => [
				reference.path,
				reference.context,
				source.slice(reference.start, reference.end)
			])
		).toEqual([
			['assets/filters.svg', 'css-url', 'filters.svg#blur'],
			['assets/paints.svg', 'css-url', 'paints.svg#gradient'],
			['assets/markers.svg', 'css-url', 'markers.svg#end']
		]);
		expect(boundedReferencedMediaPathsInSource(source)).toEqual({
			complete: true,
			paths: ['assets/filters.svg', 'assets/markers.svg', 'assets/paints.svg']
		});
		expect(
			replaceAssetReferencesInSource(
				source,
				'assets/filters.svg',
				'assets/final filters.svg'
			)
		).toContain('filter="url(assets/final%20filters.svg#blur)"');
		expect(
			boundedReferencedMediaPathsInSource(
				'<svg><rect filter="u\\72l(filters.svg#blur)"></rect></svg>'
			)
		).toEqual({complete: false, paths: []});
	});
	it('keeps generic asset heuristics out of parsed HTML attributes', () => {
		const source = [
			'<img src="actual.png" alt="hero.png">',
			'<div title="hero.png" data-example=hero.png class="icon.png"></div>',
			'"free.png"'
		].join('');

		expect(
			assetReferencesInSource('passage-a', 'Start', source, 'passage-a').map(
				reference => [reference.path, reference.context]
			)
		).toEqual([
			['assets/actual.png', 'html-src'],
			['assets/free.png', 'literal']
		]);
		expect(boundedReferencedMediaPathsInSource(source)).toEqual({
			complete: true,
			paths: ['assets/actual.png', 'assets/free.png']
		});
		expect(
			replaceAssetReferencesInSource(
				source,
				'assets/hero.png',
				'assets/replaced.png'
			)
		).toBe(source);
	});
	it('indexes legacy HTML background URLs on their browser-defined elements', () => {
		const source = [
			'<body background="body&amp;hero.png?rev=1#top">',
			'<table background="table.png"><thead background="head.png">',
			'<tbody background="body-rows.png"><tfoot background="foot.png">',
			'<tr background="row.png"><td background="cell.png">',
			'<th background="header.png">'
		].join('');
		const references = assetReferencesInSource(
			'passage-a',
			'Start',
			source,
			'passage-a'
		);

		expect(
			references.map(reference => [reference.path, reference.context])
		).toEqual([
			['assets/body&hero.png', 'html-background'],
			['assets/table.png', 'html-background'],
			['assets/head.png', 'html-background'],
			['assets/body-rows.png', 'html-background'],
			['assets/foot.png', 'html-background'],
			['assets/row.png', 'html-background'],
			['assets/cell.png', 'html-background'],
			['assets/header.png', 'html-background']
		]);
		expect(boundedReferencedMediaPathsInSource(source)).toEqual({
			complete: true,
			paths: [
				'assets/body&hero.png',
				'assets/body-rows.png',
				'assets/cell.png',
				'assets/foot.png',
				'assets/head.png',
				'assets/header.png',
				'assets/row.png',
				'assets/table.png'
			]
		});
		expect(
			replaceAssetReferencesInSource(
				source,
				'assets/body&hero.png',
				'assets/final hero.png'
			)
		).toContain('background="assets/final%20hero.png?rev=1#top"');
	});
	it('qualifies src, srcset, and poster by HTML element semantics', () => {
		const source = [
			'<div src="div.png" srcset="div-small.png 1x" poster="div-poster.png"></div>',
			'<custom-label src="custom.png" srcset="custom-small.png 1x" poster="custom-poster.png"></custom-label>',
			'<audio src="sound.ogg" poster="audio-poster.png" srcset="audio-small.png 1x"></audio>',
			'<img src="actual.png" srcset="small.png 1x, large.png 2x" poster="img-poster.png">',
			'<image src="legacy.png" srcset="legacy-small.png 1x">',
			'<video src="movie.mp4" srcset="video-small.png 1x" poster="cover.png"></video>',
			'<frame src="frame.html">',
			'<input type="text" src="text-input.png"><input type="IMAGE" src="button.png">',
			'<input type=" IMAGE" src="spaced-type.png">',
			'<svg><rect src="svg.png" srcset="svg-small.png 1x" poster="svg-poster.png"></rect></svg>'
		].join('');
		const references = assetReferencesInSource(
			'passage-a',
			'Start',
			source,
			'passage-a'
		);

		expect(
			references.map(reference => [reference.path, reference.context])
		).toEqual([
			['assets/sound.ogg', 'html-src'],
			['assets/actual.png', 'html-src'],
			['assets/small.png', 'html-srcset'],
			['assets/large.png', 'html-srcset'],
			['assets/legacy.png', 'html-src'],
			['assets/legacy-small.png', 'html-srcset'],
			['assets/movie.mp4', 'html-src'],
			['assets/cover.png', 'html-poster'],
			['assets/frame.html', 'html-src'],
			['assets/button.png', 'html-src']
		]);
		expect(
			replaceAssetReferencesInSource(
				source,
				'assets/div.png',
				'assets/replaced.png'
			)
		).toBe(source);
	});
	it('does not spend the bounded candidate budget on inert HTML attributes', () => {
		const source = `${Array.from(
			{length: 300},
			(_, index) =>
				`<x-probe src="ghost-${index}.png" srcset="ghost-${index}.png 1x" poster="ghost-${index}.png"></x-probe>`
		).join('')}"real.png"`;

		expect(boundedReferencedMediaPathsInSource(source)).toEqual({
			complete: true,
			paths: ['assets/real.png']
		});
	});
	it('shares SVG href semantics without indexing inert or structural attributes', () => {
		const source = [
			'<svg>',
			'<linearGradient href="gradients.svg#base"></linearGradient>',
			'<radialGradient xlink:href="radial.svg#base"></radialGradient>',
			'<pattern href="patterns.svg#base"></pattern>',
			'<script href="runtime.js"></script>',
			'<textPath href="paths.svg#curve"></textPath>',
			'<image href="preferred.png" xlink:href="ignored.png"></image>',
			'<feImage href="filters.exr"></feImage><use href="symbols.svg#check"></use>',
			'<use href xlink:href="empty-fallback.svg"></use>',
			'<a href="navigation.svg">Navigate</a><a download href="download.svg">Save</a>',
			'<a download href xlink:href="download-fallback.svg">Empty</a>',
			'<animate href="animation-target.svg#node"></animate>',
			'<mpath href="motion.svg#curve"></mpath>',
			'<filter href="legacy-filter.svg#base"></filter>',
			'<rect href="rect.svg"></rect><g xlink:href="group.svg"></g>',
			'</svg>'
		].join('');
		const references = assetReferencesInSource(
			'passage-a',
			'Start',
			source,
			'passage-a'
		);

		expect(references.map(reference => reference.path)).toEqual([
			'assets/gradients.svg',
			'assets/radial.svg',
			'assets/patterns.svg',
			'assets/runtime.js',
			'assets/paths.svg',
			'assets/preferred.png',
			'assets/filters.exr',
			'assets/symbols.svg',
			'assets/download.svg',
			'assets/motion.svg'
		]);
		expect(
			replaceAssetReferencesInSource(
				source,
				'assets/gradients.svg',
				'assets/final gradient.svg'
			)
		).toContain('href="assets/final%20gradient.svg#base"');
	});
	it('indexes only URL-bearing image-set string options', () => {
		const source = [
			'<div style="background-image:image-set(\'inline.webp\')"></div>',
			'<style>',
			'.hero { background-image: image-set("hero image.webp?rev=2#face" type("image/webp") 2x, url("fallback.webp") type("image/avif") 1x); }',
			".legacy { background-image: -webkit-image-/**/set /**/(/* lead */'legacy.webp', linear-gradient(red, blue) 2x); }",
			'a::after { content: "ghost.webp"; }',
			'/* image-set("comment.webp") */',
			'</style>'
		].join('\n');
		const references = assetReferencesInSource(
			'passage-a',
			'Start',
			source,
			'passage-a'
		);

		expect(
			references.map(reference => [
				reference.path,
				reference.context,
				source.slice(reference.start, reference.end)
			])
		).toEqual([
			['assets/inline.webp', 'css-url', 'inline.webp'],
			['assets/hero image.webp', 'css-url', 'hero image.webp?rev=2#face'],
			['assets/fallback.webp', 'css-url', 'fallback.webp'],
			['assets/legacy.webp', 'css-url', 'legacy.webp']
		]);
		expect(boundedReferencedMediaPathsInSource(source)).toEqual({
			complete: true,
			paths: [
				'assets/fallback.webp',
				'assets/hero image.webp',
				'assets/inline.webp',
				'assets/legacy.webp'
			]
		});
		expect(
			replaceAssetReferencesInSource(
				source,
				'assets/hero image.webp',
				'assets/hero final.webp'
			)
		).toContain('"assets/hero%20final.webp?rev=2#face" type("image/webp")');
	});
	it('scopes CSS comments to stylesheet, style element, and style attribute content', () => {
		const passageSource = '<div>/*</div><img src="hero.png"><div>*/</div>';

		expect(
			assetReferencesInSource(
				'passage-a',
				'Start',
				passageSource,
				'passage-a'
			).map(reference => reference.path)
		).toEqual(['assets/hero.png']);
		expect(boundedReferencedMediaPathsInSource(passageSource)).toEqual({
			complete: true,
			paths: ['assets/hero.png']
		});

		const stylesheet = [
			'/* <img src="comment.png"> url(comment.png) */',
			'a::after { content: " <img src=\'ghost.png\'> "; }',
			'body { background: url("real.png"); }'
		].join('\n');
		expect(
			assetReferencesInSource(
				'story:stylesheet',
				'Story Stylesheet',
				stylesheet,
				null
			).map(reference => reference.path)
		).toEqual(['assets/real.png']);
		expect(boundedReferencedMediaPathsInSource(stylesheet, true)).toEqual({
			complete: true,
			paths: ['assets/real.png']
		});
		expect(
			replaceAssetReferencesInSource(
				stylesheet,
				'assets/comment.png',
				'assets/replaced.png',
				true
			)
		).toBe(stylesheet);

		const mixedCssContexts = [
			'<style>a::after { content: " <img src=\'style-ghost.png\'> "; }</style>',
			'<div style="--markup: <img src=\'inline-ghost.png\'>;"></div>',
			'<img src="visible.png">'
		].join('\n');
		expect(
			assetReferencesInSource(
				'passage-a',
				'Start',
				mixedCssContexts,
				'passage-a'
			).map(reference => reference.path)
		).toEqual(['assets/visible.png']);
		expect(boundedReferencedMediaPathsInSource(mixedCssContexts)).toEqual({
			complete: true,
			paths: ['assets/visible.png']
		});
	});
	it('keeps dense CSS comment overlap scans linear in span count', () => {
		const commentCount = 1_000;
		const source = '/*.png*/""'.repeat(commentCount);
		const originalSome = Array.prototype.some;
		let predicateCalls = 0;
		const someSpy = jest
			.spyOn(Array.prototype, 'some')
			.mockImplementation(function (
				this: unknown[],
				predicate: (value: unknown, index: number, array: unknown[]) => unknown,
				thisArg?: unknown
			) {
				return originalSome.call(this, (value, index, array) => {
					predicateCalls++;
					return predicate.call(thisArg, value, index, array);
				});
			});

		try {
			expect(
				assetReferencesInSource(
					'story:stylesheet',
					'Story Stylesheet',
					source,
					null
				)
			).toEqual([]);
			expect(predicateCalls).toBeLessThan(commentCount * 20);
		} finally {
			someSpy.mockRestore();
		}
	});
	it('indexes and rewrites static quoted CSS imports', () => {
		const stylesheet = [
			'@im/**/port /* lead */ "theme.css";',
			"@import /* one *//**/'print.css';",
			'@import /* a *//**/"tokens";',
			'body { background: url(/* before */ "assets/theme.bin" /* after */); }',
			'a::after { content: "ignored.css"; }'
		].join('\n');
		const references = assetReferencesInSource(
			'story:stylesheet',
			'Story Stylesheet',
			stylesheet,
			null
		);

		expect(
			references.map(reference => [reference.path, reference.context])
		).toEqual([
			['assets/theme.css', 'css-import'],
			['assets/print.css', 'css-import'],
			['assets/tokens', 'css-import'],
			['assets/theme.bin', 'css-url']
		]);
		expect(
			replaceAssetReferencesInSource(
				stylesheet,
				'assets/tokens',
				'assets/replaced.tokens',
				true
			)
		).toContain('@import /* a *//**/"assets/replaced.tokens";');
		expect(
			assetReferencesInSource(
				'passage-a',
				'Start',
				'<style>@import /* c */ "passage.tokens"; .x { background: url(/**/ "passage.bin" /**/) }</style>',
				'passage-a'
			).map(reference => [reference.path, reference.context])
		).toEqual([
			['assets/passage.tokens', 'css-import'],
			['assets/passage.bin', 'css-url']
		]);
	});
	it('creates host-first asset command shapes', () => {
		expect(importAssetCommand('story', '/tmp/cover.png')).toEqual({
			type: 'importAsset',
			overwrite: false,
			source_path: '/tmp/cover.png',
			story_id: 'story',
			target_path: null
		});
		expect(renameAssetCommand('story', 'assets/a.png', 'assets/b.png')).toEqual(
			{
				type: 'renameAsset',
				new_path: 'assets/b.png',
				path: 'assets/a.png',
				story_id: 'story',
				update_references: true
			}
		);
		expect(deleteAssetCommand('story', 'assets/a.png', true)).toEqual({
			type: 'deleteAsset',
			path: 'assets/a.png',
			remove_references: true,
			story_id: 'story'
		});
		expect(
			replaceAssetCommand('story', 'assets/a.png', '/tmp/new.png')
		).toEqual({
			type: 'replaceAsset',
			path: 'assets/a.png',
			source_path: '/tmp/new.png',
			story_id: 'story'
		});
		expect(revealAssetCommand('story', 'assets/a.png')).toEqual({
			type: 'revealAsset',
			path: 'assets/a.png',
			story_id: 'story'
		});
		expect(copyAssetSnippetCommand('story', 'assets/a.png')).toEqual({
			type: 'copyAssetSnippet',
			path: 'assets/a.png',
			snippet: null,
			story_id: 'story'
		});
		expect(
			insertAssetSnippetCommand('story', 'assets/a.png', 'passage', 12, {
				passageId: 'passage',
				snippet: '<img src="assets/a.png" alt="">'
			})
		).toEqual({
			type: 'insertAssetSnippet',
			passage_id: 'passage',
			path: 'assets/a.png',
			position: 12,
			snippet: '<img src="assets/a.png" alt="">',
			source_id: 'passage',
			story_id: 'story'
		});
		expect(validateAssetReferencesCommand('story')).toEqual({
			type: 'validateAssetReferences',
			story_id: 'story'
		});
	});

	it('feeds Asset Manager entries from inventory with reference fallback', () => {
		const story = fakeStory(0);

		story.passages = [
			fakePassage({
				id: 'start',
				name: 'Start',
				story: story.id,
				text: '<img src="assets/cover.png">'
			})
		];

		const referenceBacked = assetManagerViewModel(storyToCoreIndex(story));

		expect(referenceBacked.entries).toEqual([
			expect.objectContaining({
				exists: null,
				missing: false,
				path: 'assets/cover.png',
				referenceCount: 1,
				unused: false
			})
		]);

		const inventoryBacked = assetManagerViewModel(
			storyToCoreIndex(story, {
				knownAssets: [
					{
						...referenceBacked.entries[0].inventory,
						exists: true,
						sizeBytes: 2048,
						thumbnailUrl: 'file:///project/assets/cover.png'
					}
				]
			})
		);

		expect(inventoryBacked.entries).toEqual([
			expect.objectContaining({
				exists: true,
				path: 'assets/cover.png',
				referenceCount: 1,
				sizeBytes: 2048,
				thumbnailUrl: 'file:///project/assets/cover.png'
			})
		]);
	});

	it('keeps native file metadata when merging Rust asset references', () => {
		const story = fakeStory(0);

		story.passages = [
			fakePassage({
				id: 'start',
				name: 'Start',
				story: story.id,
				text: '<img src="assets/cover.png">'
			})
		];
		const indexed = storyToCoreIndex(story).assetInventory[0];
		const native = {
			...indexed,
			exists: true,
			modifiedAt: '2026-06-21T16:00:00.000Z',
			previewUrl: 'file:///project/assets/cover.png',
			referenceCount: 0,
			references: [],
			sizeBytes: 2048,
			thumbnailUrl: 'file:///project/assets/cover.png',
			unused: true
		};

		expect(mergeKnownAssetInventory([indexed], [native])).toEqual([
			expect.objectContaining({
				exists: true,
				modifiedAt: '2026-06-21T16:00:00.000Z',
				path: 'assets/cover.png',
				referenceCount: 1,
				references: indexed.references,
				sizeBytes: 2048,
				thumbnailUrl: 'file:///project/assets/cover.png',
				unused: false
			})
		]);
	});
});
