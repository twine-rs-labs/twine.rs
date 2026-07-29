import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs';
import {basename, join, relative} from 'node:path';
import {tmpdir} from 'node:os';
import {test} from 'node:test';
import {
	checkCompatibilityManual,
	checkDesignSystemGuide,
	checkDocumentation,
	checkHtmlResources,
	checkLegacyWorkbench,
	checkMarkdownFiles,
	documentationRoots
} from '../check-documentation.mjs';

function fixture() {
	return mkdtempSync(join(tmpdir(), 'twine-rs-docs-'));
}

function write(root, path, contents) {
	const target = join(root, path);
	mkdirSync(join(target, '..'), {recursive: true});
	writeFileSync(target, contents);
}

function writeValidCompatibilityManual(root) {
	write(
		root,
		'docs/en/book.toml',
		'[book]\ntitle   =   "Twine compatibility manual (upstream)"'
	);
	write(
		root,
		'docs/en/src/README.md',
		[
			'<!-- documentation-class: upstream-compatibility -->',
			'> This manual is predominantly the upstream',
			'> Twine manual. It is not yet an authoritative guide',
			'> to every twine.rs workflow.',
			'> See the [twine.rs documentation map](https://github.com/twine-rs-labs/twine.rs/blob/main/docs/README.md)',
			'> and [user-documentation status](https://github.com/twine-rs-labs/twine.rs/blob/main/docs/user/README.md).'
		].join('\n')
	);
}

function writeValidDesignSystemGuide(root) {
	write(
		root,
		'docs/design-system/IMPLEMENTATION_GUIDE.md',
		[
			'Production barrel: `src/components/design-system/index.ts`',
			"```tsx\nimport {Button} from '../../components/design-system';\n```"
		].join('\n')
	);
}

test('documentation roots include the served compatibility manual', () => {
	assert.ok(documentationRoots.includes('docs/en/src'));
	assert.ok(documentationRoots.includes('ui_kits'));
});

test('Markdown validation checks compatibility-manual links', () => {
	const root = fixture();
	write(
		root,
		'docs/en/src/README.md',
		'[missing](missing.md)\n[generated](existing.html)'
	);
	write(root, 'docs/en/src/existing.md', '# Existing');

	const result = checkMarkdownFiles({
		root,
		roots: ['docs/en/src'],
		currentDirectories: []
	});

	assert.deepEqual(result.failures, [
		'docs/en/src/README.md:1: missing link target missing.md'
	]);
});

test('compatibility-manual local links cannot escape the book source', () => {
	const root = fixture();
	write(root, 'docs/README.md', '# Repository documentation');
	write(root, 'docs/en/src/chapter.md', '[repository docs](../../README.md)');

	const result = checkMarkdownFiles({
		root,
		roots: ['docs/en/src'],
		currentDirectories: []
	});

	assert.deepEqual(result.failures, [
		'docs/en/src/chapter.md:1: local compatibility-manual link escapes docs/en/src (../../README.md); use an explicit external or repository URL'
	]);
});

test('Markdown validation rejects an existing target outside the repository', () => {
	const root = fixture();
	const outside = `${root}-outside.md`;
	writeFileSync(outside, '# Outside');
	write(root, 'README.md', `[outside](../${basename(outside)})`);

	const result = checkMarkdownFiles({
		root,
		roots: ['README.md'],
		currentDirectories: []
	});

	assert.deepEqual(result.failures, [
		`README.md:1: missing link target ../${basename(outside)}`
	]);
});

test('HTML validation reports missing local href and src resources', () => {
	const root = fixture();
	write(
		root,
		'docs/design-system/gallery.html',
		'<link href="missing.css?theme=dark#top">\n<script src="missing%20file.js"></script>'
	);

	const result = checkHtmlResources({root});

	assert.deepEqual(result.failures, [
		'docs/design-system/gallery.html:1: missing local HTML resource missing.css',
		'docs/design-system/gallery.html:2: missing local HTML resource missing file.js'
	]);
});

test('HTML validation accepts valid local resources', () => {
	const root = fixture();
	write(
		root,
		'docs/design-system/cards/index.html',
		'<link href="../styles.css"><script src="./component.jsx"></script>'
	);
	write(root, 'docs/design-system/styles.css', '');
	write(root, 'docs/design-system/cards/component.jsx', '');

	assert.deepEqual(checkHtmlResources({root}).failures, []);
});

test('HTML validation rejects an existing resource outside the repository', () => {
	const root = fixture();
	const outside = `${root}-outside.css`;
	const htmlDirectory = join(root, 'docs/design-system');
	const outsideTarget = relative(htmlDirectory, outside).replaceAll('\\', '/');
	writeFileSync(outside, '');
	write(
		root,
		'docs/design-system/index.html',
		`<link href="${outsideTarget}">`
	);

	assert.deepEqual(checkHtmlResources({root}).failures, [
		`docs/design-system/index.html:1: missing local HTML resource ${outsideTarget}`
	]);
});

test('HTML validation ignores external and non-resource URLs', () => {
	const root = fixture();
	write(
		root,
		'docs/design-system/index.html',
		[
			'<a href="https://example.com/page">web</a>',
			'<script src="//cdn.example.com/app.js"></script>',
			'<img src="data:image/svg+xml;base64,AA==">',
			'<a href="mailto:docs@example.com">mail</a>',
			'<a href="javascript:void(0)">script</a>',
			'<a href="#local">fragment</a>'
		].join('\n')
	);

	assert.deepEqual(checkHtmlResources({root}).failures, []);
});

test('compatibility manual accepts equivalent title spacing and scope reflow', () => {
	const root = fixture();
	writeValidCompatibilityManual(root);

	assert.deepEqual(checkCompatibilityManual({root}), []);
});

test('compatibility manual requires upstream title and scope provenance', () => {
	const root = fixture();
	write(root, 'docs/en/book.toml', '[book]\ntitle = "Twine RS manual"');
	write(root, 'docs/en/src/README.md', '# Product documentation');

	const failures = checkCompatibilityManual({root});

	assert.equal(failures.length, 6);
	assert.match(failures[0], /compatibility manual title/);
	assert.match(failures[1], /documentation-class: upstream-compatibility/);
	assert.match(failures[2], /upstream twine/);
	assert.match(failures[3], /not yet an authoritative guide/);
	assert.match(failures[4], /documentation map/);
	assert.match(failures[5], /user-documentation status/);
});

test('documentation check rejects reintroduced legacy workbench content', () => {
	const root = fixture();
	writeValidCompatibilityManual(root);
	writeValidDesignSystemGuide(root);

	assert.deepEqual(checkLegacyWorkbench({root}), []);
	assert.deepEqual(checkDocumentation({root}).failures, []);

	mkdirSync(join(root, 'ui_kits/workbench'), {recursive: true});
	assert.deepEqual(checkLegacyWorkbench({root}), []);
	assert.deepEqual(checkDocumentation({root}).failures, []);

	write(root, 'ui_kits/workbench/legacy.md', '# Legacy');
	const expected =
		'ui_kits/workbench: legacy workbench content is not allowed; docs/design-system/ui_kits/workbench is the sole authoritative workbench kit';

	assert.deepEqual(checkLegacyWorkbench({root}), [expected]);
	assert.deepEqual(checkDocumentation({root}).failures, [expected]);
});

test('legacy workbench guard rejects root remediation guidance and accepts canonical guidance', () => {
	const root = fixture();
	writeValidCompatibilityManual(root);
	writeValidDesignSystemGuide(root);
	write(
		root,
		'ui_kits_remediation/ACTIVE.md',
		'Edit `docs/design-system/ui_kits/workbench/workbench.css`.'
	);

	assert.deepEqual(checkLegacyWorkbench({root}), []);
	assert.deepEqual(checkDocumentation({root}).failures, []);

	write(
		root,
		'ui_kits_remediation/ACTIVE.md',
		'Edit `ui_kits/workbench/workbench.css`.'
	);
	const expected =
		'ui_kits_remediation/ACTIVE.md:1: active remediation guidance must use docs/design-system/ui_kits/workbench; root ui_kits/workbench references are forbidden';

	assert.deepEqual(checkLegacyWorkbench({root}), [expected]);
	assert.deepEqual(checkDocumentation({root}).failures, [expected]);
});

test('design-system guide accepts the real barrel and a relative import', () => {
	const root = fixture();
	writeValidDesignSystemGuide(root);

	assert.deepEqual(checkDesignSystemGuide({root}), []);
});

test('design-system guide rejects nonexistent aliases and invented imports', () => {
	const root = fixture();
	write(
		root,
		'docs/design-system/IMPLEMENTATION_GUIDE.md',
		"Use `import {Button} from '@twine/ui'`."
	);

	assert.deepEqual(checkDesignSystemGuide({root}), [
		'docs/design-system/IMPLEMENTATION_GUIDE.md: nonexistent @twine/ui imports are not allowed',
		'docs/design-system/IMPLEMENTATION_GUIDE.md: production component guidance must identify src/components/design-system/index.ts as the real barrel',
		'docs/design-system/IMPLEMENTATION_GUIDE.md: production component guidance must show a relative components/design-system import'
	]);
});

test('complete documentation check enforces design-system import guidance', () => {
	const root = fixture();
	writeValidCompatibilityManual(root);
	write(
		root,
		'docs/design-system/IMPLEMENTATION_GUIDE.md',
		'Production components are provided elsewhere.'
	);

	assert.deepEqual(checkDocumentation({root}).failures, [
		'docs/design-system/IMPLEMENTATION_GUIDE.md: production component guidance must identify src/components/design-system/index.ts as the real barrel',
		'docs/design-system/IMPLEMENTATION_GUIDE.md: production component guidance must show a relative components/design-system import'
	]);
});
