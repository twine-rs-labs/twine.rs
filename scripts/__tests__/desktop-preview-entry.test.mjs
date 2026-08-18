import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {test} from 'node:test';

const root = path.resolve(import.meta.dirname, '../..');

async function source(relativePath) {
	return readFile(path.join(root, relativePath), 'utf8');
}

test('desktop preview HTML has a dedicated restrictive entry', async () => {
	const html = await source('story-preview.html');

	assert.match(html, /src="src\/desktop-preview\/index\.tsx"/);
	assert.match(html, /default-src 'none'/);
	assert.match(html, /frame-src twine-preview:/);
	assert.match(html, /script-src 'self'/);
	assert.doesNotMatch(html, /https?:|manifest\.webmanifest|registerSW/);
});

test('desktop preview entry does not initialize application authorities', async () => {
	const entry = await source('src/desktop-preview/index.tsx');
	const shell = await source('src/desktop-preview/desktop-story-preview.tsx');
	const sharedFrame = await source('src/routes/story-preview-frame.tsx');
	const sharedDebug = await source('src/routes/story-preview-debug.ts');
	const combined = `${entry}\n${shell}\n${sharedFrame}\n${sharedDebug}`;

	for (const forbidden of [
		"from '../app'",
		"from './app'",
		'StateLoader',
		'CoreProjectHostProvider',
		'ProjectSessionSync',
		'PrefsContext',
		'persistence',
		'serviceWorker',
		'virtual:pwa-register'
	]) {
		assert.doesNotMatch(combined, new RegExp(forbidden));
	}

	assert.match(combined, /StoryPreviewFrame/);
	assert.match(combined, /applyDocumentAppearance/);
	assert.match(combined, /twineStoryPreview/);
	assert.doesNotMatch(
		sharedFrame,
		/from '\.\.\/components\/(?:design-system|error)'/
	);
});

test('sandboxed preview preload has no local runtime dependency', async () => {
	const preload = await source('src/electron/main-process/preview-preload.ts');
	const runtimeImports = [
		...preload.matchAll(/^import(?!\s+type\b)[\s\S]*?from ['"]([^'"]+)['"];$/gm)
	].map(match => match[1]);

	assert.deepEqual(runtimeImports, ['electron']);
	assert.match(preload, /const storyPreviewBridgeName = 'twineStoryPreview'/);
	for (const channel of [
		'story-preview:appearance',
		'story-preview:command',
		'story-preview:copy-text',
		'story-preview:command-result',
		'story-preview:frame-loaded',
		'story-preview:get-initial-state',
		'story-preview:ready',
		'story-preview:replacement'
	]) {
		assert.match(preload, new RegExp(channel));
	}
});

test('Vite packages the preview entry without registering or precaching it as a PWA', async () => {
	const config = await source('vite.config.mts');

	assert.match(
		config,
		/'story-preview': path\.resolve\([\s\S]*'story-preview\.html'/
	);
	assert.match(config, /remove-desktop-preview-pwa-tags/);
	assert.match(config, /story-preview\(\?:-\[\^\/\]\+\)\?/);
	assert.match(config, /vite-plugin-pwa:register-sw/);
});
