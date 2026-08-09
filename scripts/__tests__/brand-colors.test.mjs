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

function oklchToken(source, name) {
	const match = source.match(
		new RegExp(
			`${name}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)(?:\\s*\\/\\s*([\\d.]+))?\\);`
		)
	);

	assert.ok(match, `${name} must be an OKLCH token`);
	return {
		alpha: match[4] === undefined ? 1 : Number(match[4]),
		chroma: Number(match[2]),
		hue: Number(match[3]),
		lightness: Number(match[1])
	};
}

function linearSrgb({chroma, hue, lightness}) {
	const radians = (hue * Math.PI) / 180;
	const a = chroma * Math.cos(radians);
	const b = chroma * Math.sin(radians);
	const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;

	return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
	].map(channel => Math.max(0, Math.min(1, channel)));
}

function contrastRatio(first, second) {
	const luminance = color =>
		0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2];
	const firstLuminance = luminance(first);
	const secondLuminance = luminance(second);

	return (
		(Math.max(firstLuminance, secondLuminance) + 0.05) /
		(Math.min(firstLuminance, secondLuminance) + 0.05)
	);
}

function assertRemediationBundleUsesSemanticRoles(
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
		/\.tw-node__start\s*\{[^}]*color:\s*var\(--acc-amber-ink\)/s
	);
	assert.match(
		embeddedSources.join('\n'),
		/\.tw-badge--success[^}]*var\(--sem-saved-soft\)/s
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
	assert.match(renderedPages, /--acc-amber-ink:\s*var\(--acc-amber\)/);
	assert.match(renderedPages, /--acc-amber-ink:\s*#956100/i);
	assert.match(renderedPages, /--sem-success:\s*oklch\(/);
	assert.match(renderedPages, /--sem-success:\s*oklch\(0\.450 0\.130 156\)/);
	assert.match(renderedPages, /--sem-saved:\s*var\(--sem-success\)/);
	assert.doesNotMatch(renderedPages, /--sem-saved:\s*var\(--acc-amber\)/);
	assert.doesNotMatch(renderedPages, /--sem-saved:\s*#956100/i);
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
		assertRemediationBundleUsesSemanticRoles(
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

test('brand amber, semantic success, and explicit author green remain separate', async () => {
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
	assert.match(tokens, /--acc-amber-ink:\s*var\(--acc-amber\);/);
	assert.match(tokens, /--acc-amber-ink:\s*#956100;/);
	assert.match(tokens, /--sem-success:\s*oklch\(/);
	assert.match(tokens, /--sem-success:\s*oklch\(0\.45 0\.13 156\);/);
	assert.match(tokens, /--sem-saved:\s*var\(--sem-success\);/);
	assert.doesNotMatch(tokens, /--sem-saved:\s*var\(--acc-amber\);/);
	assert.match(tokens, /--named-green:\s*oklch\(/);
	assert.match(tokens, /--named-green:\s*oklch\(0\.52 0\.14 156\);/);
	assert.match(
		tokens,
		/body\[data-high-contrast='true'\][\s\S]*--acc-amber-ink:\s*var\(--acc-amber\);/
	);
	assert.match(
		tokens,
		/body\[data-high-contrast='true'\][\s\S]*--sem-success:\s*oklch\(0\.78 0\.15 152\);/
	);
	assert.match(legacyColors, /--green:\s*var\(--named-green\);/);
	assert.match(namedColorMap, /green:\s*'var\(--named-green\)'/);
	assert.match(
		sourceEditorThemes,
		/--source-editor-self-link': 'var\(--acc-amber-ink\)'/
	);
	assert.match(
		sourceEditorThemes,
		/--source-editor-syntax-string': 'var\(--named-green\)'/
	);
	assert.match(highContrastTheme, /--source-editor-self-link': '#F2B544'/i);
	assert.match(highContrastTheme, /--source-editor-syntax-string': '#F2B544'/i);
	assert.doesNotMatch(highContrastTheme, /#8dff8d|#103c10/i);

	const lightTheme = tokens.slice(
		tokens.indexOf("[data-app-theme='light']"),
		tokens.indexOf("body[data-high-contrast='true']")
	);
	const success = oklchToken(lightTheme, '--sem-success');
	const successSoft = oklchToken(lightTheme, '--sem-success-soft');
	const darkestLightSurface = oklchToken(lightTheme, '--ink-5');
	const successColor = linearSrgb(success);
	const softColor = linearSrgb(successSoft);
	const surfaceColor = linearSrgb(darkestLightSurface);
	const badgeBackground = softColor.map(
		(channel, index) =>
			channel * successSoft.alpha +
			surfaceColor[index] * (1 - successSoft.alpha)
	);

	assert.ok(
		contrastRatio(successColor, badgeBackground) >= 4.5,
		'light success ink must meet WCAG AA on its soft badge fill over ink-5'
	);
});

test('design-system generated artifacts match their authoritative sources', async () => {
	const [bundleSource, tokenSource, manifestSource] = await Promise.all([
		readFile(path.join(rootDir, 'docs/design-system/_ds_bundle.js'), 'utf8'),
		readFile(
			path.join(rootDir, 'docs/design-system/tokens/colors.css'),
			'utf8'
		),
		readFile(path.join(rootDir, 'docs/design-system/_ds_manifest.json'), 'utf8')
	]);
	const metadataSource = bundleSource.match(/^\/\* @ds-bundle: (.+) \*\//)?.[1];

	assert.ok(metadataSource, 'design-system bundle metadata must be present');
	const metadata = JSON.parse(metadataSource);

	for (const [relativePath, expectedHash] of Object.entries(
		metadata.sourceHashes
	)) {
		const source = await readFile(
			path.join(rootDir, 'docs/design-system', relativePath)
		);
		const actualHash = createHash('sha256')
			.update(source)
			.digest('hex')
			.slice(0, 12);

		assert.equal(actualHash, expectedHash, `${relativePath} hash is stale`);
	}

	const manifest = JSON.parse(manifestSource);
	for (const token of manifest.tokens.filter(
		entry => entry.definedIn === 'tokens/colors.css'
	)) {
		const sourceValue = tokenSource.match(
			new RegExp(`${token.name}:\\s*([\\s\\S]*?);`)
		)?.[1];

		assert.ok(sourceValue, `${token.name} is missing from the token source`);
		assert.equal(
			sourceValue.trim(),
			token.value,
			`${token.name} manifest value is stale`
		);
	}
});
