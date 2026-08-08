import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../..'
);

function pngSize(buffer) {
	assert.deepEqual(
		buffer.subarray(0, 8),
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
	);

	return {
		height: buffer.readUInt32BE(20),
		width: buffer.readUInt32BE(16)
	};
}

test('desktop application icons have one channel-neutral family', async () => {
	const entries = await readdir(path.join(rootDir, 'icons'));

	assert.deepEqual(
		entries.filter(entry => entry.startsWith('app-preview')),
		[]
	);
	assert.deepEqual(
		entries.filter(entry => entry.startsWith('app-release')),
		[]
	);

	const [svg, documentedSvg, png, windowsPng, windowsIco] = await Promise.all([
		readFile(path.join(rootDir, 'icons/app.svg'), 'utf8'),
		readFile(path.join(rootDir, 'docs/design-system/assets/app.svg'), 'utf8'),
		readFile(path.join(rootDir, 'icons/app.png')),
		readFile(path.join(rootDir, 'icons/app-no-padding.png')),
		readFile(path.join(rootDir, 'icons/app-no-padding.ico'))
	]);

	assert.match(svg, /<svg\b/);
	assert.equal(documentedSvg, svg);
	assert.deepEqual(pngSize(png), {height: 1024, width: 1024});
	assert.deepEqual(pngSize(windowsPng), {height: 256, width: 256});
	assert.equal(windowsIco.readUInt16LE(0), 0);
	assert.equal(windowsIco.readUInt16LE(2), 1);
	assert.ok(windowsIco.readUInt16LE(4) > 0);
});

test('web icons include SVGs and the required raster sizes', async () => {
	const iconDir = path.join(rootDir, 'public/icons');
	const [
		faviconSvg,
		faviconPng,
		pwa192,
		pwa512,
		maskable512,
		pwaSvg,
		maskableSvg
	] = await Promise.all([
		readFile(path.join(iconDir, 'favicon.svg'), 'utf8'),
		readFile(path.join(iconDir, 'favicon.png')),
		readFile(path.join(iconDir, 'pwa-192.png')),
		readFile(path.join(iconDir, 'pwa-512.png')),
		readFile(path.join(iconDir, 'pwa-maskable-512.png')),
		readFile(path.join(iconDir, 'pwa.svg'), 'utf8'),
		readFile(path.join(iconDir, 'pwa-maskable.svg'), 'utf8')
	]);

	assert.match(faviconSvg, /<svg\b/);
	assert.match(pwaSvg, /<svg\b/);
	assert.match(maskableSvg, /<svg\b/);
	assert.deepEqual(pngSize(faviconPng), {height: 64, width: 64});
	assert.deepEqual(pngSize(pwa192), {height: 192, width: 192});
	assert.deepEqual(pngSize(pwa512), {height: 512, width: 512});
	assert.deepEqual(pngSize(maskable512), {height: 512, width: 512});
});
