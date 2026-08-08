import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {gunzipSync} from 'node:zlib';

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../..'
);

const textExtensions = new Set([
	'.css',
	'.html',
	'.js',
	'.json',
	'.jsx',
	'.md',
	'.svg',
	'.ts',
	'.tsx'
]);

async function collectTextFiles(directory) {
	const result = [];

	for (const entry of await readdir(directory, {withFileTypes: true})) {
		const entryPath = path.join(directory, entry.name);

		if (entry.isDirectory()) {
			result.push(...(await collectTextFiles(entryPath)));
		} else if (textExtensions.has(path.extname(entry.name))) {
			result.push(entryPath);
		}
	}

	return result;
}

function embeddedJson(html, type, relativePath) {
	const source = html.match(
		new RegExp(`<script type="__bundler/${type}">\\s*([\\s\\S]*?)\\s*</script>`)
	)?.[1];

	assert.ok(source, `${relativePath} must contain its ${type} payload`);
	return JSON.parse(source);
}

function assertRemediationBundleUsesAmber(
	html,
	relativePath,
	canonicalBundleSource
) {
	const manifest = embeddedJson(html, 'manifest', relativePath);
	const template = embeddedJson(html, 'template', relativePath);
	const renderedPages = Object.values(template.pages).join('\n');
	const embeddedSources = [];
	let designSystemBundles = 0;

	for (const [id, resource] of Object.entries(manifest)) {
		const storedBytes = Buffer.from(resource.data, 'base64');
		const resourceBytes = resource.compressed
			? gunzipSync(storedBytes)
			: storedBytes;
		const source = resourceBytes.toString('utf8');
		const integrity = `sha384-${createHash('sha384')
			.update(resourceBytes)
			.digest('base64')}`;
		embeddedSources.push(source);
		if (source.includes('@ds-bundle')) {
			designSystemBundles += 1;
			assert.equal(
				source,
				canonicalBundleSource,
				`${relativePath} must embed the authoritative design-system bundle`
			);
		}

		assert.doesNotMatch(
			source,
			/--acc-green/,
			`${relativePath} embedded resource ${id} still uses the retired accent`
		);
		const scriptTag = renderedPages.match(
			new RegExp(`<script src="${id}"[^>]*>`)
		)?.[0];

		if (scriptTag?.includes('integrity=')) {
			assert.ok(
				scriptTag.includes(`integrity="${integrity}"`),
				`${relativePath} embedded resource ${id} has stale integrity metadata`
			);
		}
	}

	assert.match(
		embeddedSources.join('\n'),
		/\.tw-node__start\s*\{[^}]*color:\s*var\(--sem-saved\)/s
	);
	assert.doesNotMatch(
		embeddedSources.join('\n'),
		/green:\s*['"](?:var\(--sem-saved\)|saved)['"]/
	);
	assert.equal(
		(
			embeddedSources
				.join('\n')
				.match(/green:\s*['"]var\(--named-green\)['"]/g) ?? []
		).length,
		3,
		`${relativePath} must keep all explicit green tag mappings on --named-green`
	);
	assert.equal(designSystemBundles, 1);
	assert.match(html, /stop-color="#F2B544"/i);
	assert.doesNotMatch(html, /#4fc28a/i);
}

test('application brand sources use amber instead of the retired green accent', async () => {
	const sourceFiles = await collectTextFiles(path.join(rootDir, 'src'));
	const designSystemFiles = await collectTextFiles(
		path.join(rootDir, 'docs/design-system')
	);
	const remediationFiles = await collectTextFiles(
		path.join(rootDir, 'ui_kits_remediation')
	);
	const staleAccentFiles = [];

	for (const filePath of [
		...sourceFiles,
		...designSystemFiles,
		...remediationFiles
	]) {
		if ((await readFile(filePath, 'utf8')).includes('--acc-green')) {
			staleAccentFiles.push(path.relative(rootDir, filePath));
		}
	}

	assert.deepEqual(staleAccentFiles, []);
	const canonicalBundleSource = await readFile(
		path.join(rootDir, 'docs/design-system/_ds_bundle.js'),
		'utf8'
	);

	for (const relativePath of [
		'ui_kits_remediation/export.html',
		'ui_kits_remediation/themes.html'
	]) {
		assertRemediationBundleUsesAmber(
			await readFile(path.join(rootDir, relativePath), 'utf8'),
			relativePath,
			canonicalBundleSource
		);
	}

	for (const relativePath of [
		'src/assets/twine-mark.svg',
		'src/components/image/icon/twine.tsx',
		'docs/design-system/assets/twine-mark.svg'
	]) {
		const source = await readFile(path.join(rootDir, relativePath), 'utf8');

		assert.match(source, /#F2B544/i, `${relativePath} must use amber`);
		assert.doesNotMatch(source, /#10f05e/i, `${relativePath} still uses green`);
	}
});

test('saved UI color and explicit green author colors remain separate', async () => {
	const [tokens, legacyColors, namedColorMap, sourceEditorThemes] =
		await Promise.all([
			readFile(
				path.join(rootDir, 'src/styles/design-system/tokens/colors.css'),
				'utf8'
			),
			readFile(path.join(rootDir, 'src/styles/colors.css'), 'utf8'),
			readFile(
				path.join(rootDir, 'src/components/design-system/colors.ts'),
				'utf8'
			),
			readFile(
				path.join(rootDir, 'src/components/control/source-editor/themes.ts'),
				'utf8'
			)
		]);
	const highContrastTheme = sourceEditorThemes.slice(
		sourceEditorThemes.indexOf('const highContrastVars'),
		sourceEditorThemes.indexOf('function themeVariables')
	);

	assert.match(tokens, /--acc-amber:\s*#f2b544;/i);
	assert.match(tokens, /--sem-saved:\s*var\(--acc-amber\);/);
	assert.match(tokens, /--named-green:\s*oklch\(/);
	assert.match(legacyColors, /--green:\s*var\(--named-green\);/);
	assert.match(namedColorMap, /green:\s*'var\(--named-green\)'/);
	assert.match(highContrastTheme, /--source-editor-self-link': '#F2B544'/i);
	assert.match(highContrastTheme, /--source-editor-syntax-string': '#F2B544'/i);
	assert.doesNotMatch(highContrastTheme, /#8dff8d|#103c10/i);
});
