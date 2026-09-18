import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs';
import {basename, join, relative} from 'node:path';
import {tmpdir} from 'node:os';
import {test} from 'node:test';
import {
	checkDesignSystemGuide,
	checkDocumentation,
	checkHtmlResources,
	checkLegacyWorkbench,
	checkLegacyUserManualLanding,
	checkLegacyUserManualLinks,
	legacyUserManualLanding,
	legacyUserManualHeadingMap,
	checkMarkdownFiles,
	checkUpstreamHistory,
	checkUserManual,
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

function writeLegacyGuides(root) {
	const sources = new Map();
	const targets = new Map();
	for (const {source, heading, target} of legacyUserManualHeadingMap) {
		sources.set(
			source,
			(sources.get(source) ?? '') +
				`## ${heading}\n\n[Read the replacement](../en/src/${target})\n\n`
		);
		const [path, anchor] = target.split('#');
		targets.set(path, (targets.get(path) ?? '') + `<a id="${anchor}"></a>\n\n`);
	}
	for (const [path, content] of sources)
		write(root, `docs/user/${path}`, content);
	for (const [path, content] of targets)
		write(root, `docs/en/src/${path}`, content);
}

function writeLegacyUserManualLanding(root) {
	const {anchor, heading, target} = legacyUserManualLanding;
	write(
		root,
		'docs/user/README.md',
		`<a id="${anchor}"></a>\n\n# ${heading}\n\n[Twine RS User Manual](${target})`
	);
}

function writeValidUserManual(root) {
	writeLegacyGuides(root);
	writeLegacyUserManualLanding(root);
	write(
		root,
		'docs/en/book.toml',
		'[book]\ntitle   =   "Twine RS User Manual"'
	);
	write(
		root,
		'docs/en/src/README.md',
		[
			'<!-- documentation-class: twine-rs-user-manual -->',
			'> This manual describes the shipped Twine RS desktop and',
			'> browser editors.',
			'> See the [documentation map](https://github.com/twine-rs-labs/twine.rs/blob/main/docs/README.md)',
			'> and [user documentation](https://github.com/twine-rs-labs/twine.rs/blob/main/docs/user/README.md).'
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

test('documentation roots include the served user manual', () => {
	assert.ok(documentationRoots.includes('docs/en/src'));
	assert.ok(documentationRoots.includes('ui_kits'));
});

test('Markdown validation checks user-manual links', () => {
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

test('user-manual local links cannot escape the book source', () => {
	const root = fixture();
	write(root, 'docs/README.md', '# Repository documentation');
	write(root, 'docs/en/src/chapter.md', '[repository docs](../../README.md)');

	const result = checkMarkdownFiles({
		root,
		roots: ['docs/en/src'],
		currentDirectories: []
	});

	assert.deepEqual(result.failures, [
		'docs/en/src/chapter.md:1: local user-manual link escapes docs/en/src (../../README.md); use an explicit external or repository URL'
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

test('user manual accepts equivalent title spacing and scope reflow', () => {
	const root = fixture();
	writeValidUserManual(root);

	assert.deepEqual(checkUserManual({root}), []);
});

test('user manual requires title, scope, marker, and canonical links', () => {
	const root = fixture();
	write(root, 'docs/en/book.toml', '[book]\ntitle = "Twine RS manual"');
	write(root, 'docs/en/src/README.md', '# Product documentation');

	const failures = checkUserManual({root});

	assert.equal(failures.length, 5);
	assert.match(failures[0], /user manual title/);
	assert.match(failures[1], /documentation-class: twine-rs-user-manual/);
	assert.match(failures[2], /shipped Twine RS desktop and browser editors/);
	assert.match(failures[3], /documentation map/);
	assert.match(failures[4], /user documentation/);
});

test('upstream-history notices include unlisted release-note Markdown files', () => {
	const root = fixture();
	write(
		root,
		'docs/en/src/release-notes/twee.md',
		'<!-- documentation-class: upstream-history -->\nHistorical upstream Twine documentation; not Twine RS release notes.'
	);
	write(root, 'docs/en/src/release-notes/unlisted.md', '# Unlisted');

	assert.deepEqual(checkUpstreamHistory({root}), [
		'docs/en/src/release-notes/unlisted.md: missing upstream-history marker "<!-- documentation-class: upstream-history -->"',
		'docs/en/src/release-notes/unlisted.md: missing upstream-history notice "Historical upstream Twine documentation; not Twine RS release notes."'
	]);
});

test('legacy recovery headings require the mapped replacement anchor', () => {
	const root = fixture();
	writeLegacyGuides(root);
	write(
		root,
		'docs/user/recovery-and-backups.md',
		'## Recovering from damaged settings\n\n[Read the replacement](../en/src/troubleshooting/wont-start.md#recovering-from-damaged-settings)'
	);
	write(root, 'docs/en/src/troubleshooting/wont-start.md', '# Troubleshooting');

	assert.deepEqual(checkLegacyUserManualLinks({root}), [
		'docs/user/recovery-and-backups.md: missing legacy heading #desktop-recovery-and-backups',
		'docs/user/recovery-and-backups.md: missing legacy heading #story-library-and-backup-locations',
		'docs/user/recovery-and-backups.md: missing legacy heading #restore-a-project-from-a-backup',
		'docs/user/recovery-and-backups.md: missing legacy heading #test-with-an-isolated-library',
		'docs/user/recovery-and-backups.md: missing legacy heading #interrupted-operations',
		'docs/user/recovery-and-backups.md: missing legacy heading #choose-dedicated-folders',
		'docs/user/recovery-and-backups.md: legacy heading #recovering-from-damaged-settings target is missing anchor #recovering-from-damaged-settings'
	]);
});

test('legacy headings reject a replacement link to the wrong destination', () => {
	const root = fixture();
	writeLegacyGuides(root);
	write(
		root,
		'docs/user/availability-and-updates.md',
		'# Twine RS availability and updates\n\n[Read the replacement](../en/src/getting-started/updating.md#updating-twine-rs)\n\n## Updates\n\n[Read the replacement](../en/src/getting-started/updating.md#updating-twine-rs)'
	);
	write(
		root,
		'docs/en/src/getting-started/installing.md',
		'# Installing Twine RS'
	);
	write(root, 'docs/en/src/getting-started/updating.md', '# Updating Twine RS');

	assert.deepEqual(checkLegacyUserManualLinks({root}), [
		'docs/user/availability-and-updates.md: legacy heading #twine-rs-availability-and-updates must immediately link to ../en/src/getting-started/installing.md#installing-twine-rs'
	]);
});

test('documentation check rejects reintroduced legacy workbench content', () => {
	const root = fixture();
	writeValidUserManual(root);
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
	writeValidUserManual(root);
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
	writeValidUserManual(root);
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

test('legacy guide links resolve into the served manual and cannot disappear', () => {
	const root = fixture();
	writeLegacyGuides(root);
	assert.deepEqual(checkLegacyUserManualLinks({root}), []);
	assert.deepEqual(
		checkMarkdownFiles({root, roots: ['docs/user'], currentDirectories: []})
			.failures,
		[]
	);
	assert.equal(checkLegacyUserManualLinks({root: fixture()}).length, 4);
});

test('legacy Help landing preserves its explicit anchor and manual destination', () => {
	const root = fixture();
	write(root, 'docs/en/src/README.md', '# Twine RS User Manual');
	writeLegacyUserManualLanding(root);

	assert.deepEqual(checkLegacyUserManualLanding({root}), []);

	write(
		root,
		'docs/user/README.md',
		'# Twine RS user documentation\n\n[Twine RS User Manual](../en/src/README.md)'
	);
	assert.deepEqual(checkLegacyUserManualLanding({root}), [
		'docs/user/README.md: legacy Help landing must preserve HTML anchor #twiners-user-documentation'
	]);
});
