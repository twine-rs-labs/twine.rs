import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	utimesSync,
	writeFileSync
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, test} from 'node:test';
import yauzl from 'yauzl';
import {writeDeterministicZip} from '../deterministic-zip.mjs';
import {
	expectedPwaManifestColors,
	verifyPwaManifestSource
} from '../verify-pwa-manifest.mjs';
import {verifyPrecacheSource} from '../verify-precache-manifest.mjs';

const fixtureRoot = mkdtempSync(join(tmpdir(), 'twine-rs-zip-test-'));

after(() => rmSync(fixtureRoot, {force: true, recursive: true}));

function sha256(filePath) {
	return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function readZip(filePath) {
	return new Promise((resolve, reject) => {
		yauzl.open(filePath, {lazyEntries: true}, (openError, zip) => {
			if (openError) {
				reject(openError);
				return;
			}

			const entries = [];
			zip.on('error', reject);
			zip.on('end', () => resolve(entries));
			zip.on('entry', entry => {
				zip.openReadStream(entry, (streamError, stream) => {
					if (streamError) {
						reject(streamError);
						return;
					}

					const chunks = [];
					stream.on('data', chunk => chunks.push(chunk));
					stream.on('error', reject);
					stream.on('end', () => {
						entries.push({
							contents: Buffer.concat(chunks).toString('utf8'),
							name: entry.fileName
						});
						zip.readEntry();
					});
				});
			});
			zip.readEntry();
		});
	});
}

test('writes portable archives independent of input timestamps', async () => {
	const input = join(fixtureRoot, 'input');
	const nested = join(input, 'nested');
	const firstArchive = join(fixtureRoot, 'first.zip');
	const secondArchive = join(fixtureRoot, 'second.zip');

	mkdirSync(nested, {recursive: true});
	writeFileSync(join(input, 'alpha.txt'), 'alpha');
	writeFileSync(join(nested, 'omega.txt'), 'omega');
	utimesSync(join(input, 'alpha.txt'), new Date(0), new Date(0));
	utimesSync(join(nested, 'omega.txt'), new Date(1_000), new Date(1_000));

	await writeDeterministicZip({
		archivePath: firstArchive,
		prefix: 'web',
		rootDirectory: input
	});

	utimesSync(join(input, 'alpha.txt'), new Date(), new Date());
	utimesSync(join(nested, 'omega.txt'), new Date(), new Date());
	await writeDeterministicZip({
		archivePath: secondArchive,
		prefix: 'web',
		rootDirectory: input
	});

	assert.equal(sha256(firstArchive), sha256(secondArchive));
	assert.deepEqual(await readZip(secondArchive), [
		{name: 'web/alpha.txt', contents: 'alpha'},
		{name: 'web/nested/omega.txt', contents: 'omega'}
	]);
});

test('the PWA precache manifest has one deterministic asset source', () => {
	const config = readFileSync(join(process.cwd(), 'vite.config.mts'), 'utf8');
	const archiveScript = readFileSync(
		join(process.cwd(), 'scripts', 'archive-web.mjs'),
		'utf8'
	);

	assert.match(config, /manifestTransforms: \[sortPrecacheManifest\]/);
	assert.match(config, /includeManifestIcons: false/);
	assert.match(config, /background_color: '#080D11'/);
	assert.match(config, /theme_color: '#F2B544'/);
	assert.doesNotMatch(config, /includeAssets:/);
	assert.match(config, /png,wasm/);
	assert.match(config, /'\*\*\/LICENSE'/);
	assert.match(
		config,
		/ignoreURLParametersMatching: \[\/\^utm_\/, \/\^fbclid\$\/, \/\^callback\$\/\]/
	);
	assert.match(config, /maximumFileSizeToCacheInBytes: 5 \* 1024 \* 1024/);
	assert.match(archiveScript, /verifyPrecacheManifest/);
	assert.match(archiveScript, /verifyPwaManifest/);
});

test('validates generated PWA manifest brand and surface colors', () => {
	assert.deepEqual(
		verifyPwaManifestSource(JSON.stringify(expectedPwaManifestColors)),
		expectedPwaManifestColors
	);
	assert.throws(
		() =>
			verifyPwaManifestSource(
				JSON.stringify({
					background_color: '#080D11',
					theme_color: '#42b883'
				})
			),
		/generated PWA manifest theme_color must be #F2B544/i
	);
});

test('validates generated PWA precache runtime closure, uniqueness, and order', () => {
	const wasmUrl = 'assets/twine_wasm_bg-abc123.wasm';
	const valid =
		's.precacheAndRoute([{url:"a.js",revision:null},' +
		`{url:"${wasmUrl}",revision:null},` +
		'{url:"icons/pwa-192.png",revision:"hash"},' +
		'{url:"manifest.webmanifest",revision:"hash"}],' +
		'{ignoreURLParametersMatching:[/^utm_/,/^fbclid$/, /^callback$/]})';

	assert.deepEqual(verifyPrecacheSource(valid, [wasmUrl]), [
		'a.js',
		wasmUrl,
		'icons/pwa-192.png',
		'manifest.webmanifest'
	]);
	assert.deepEqual(
		verifyPrecacheSource(
			`workbox.precacheAndRoute([
				{"url": "a.js", "revision": null},
				{"url": "${wasmUrl}", "revision": null},
				{"url": "icons/pwa-192.png", "revision": "hash"},
				{"url": "manifest.webmanifest", "revision": "hash"}
			], {
				"ignoreURLParametersMatching": [/^utm_/, /^fbclid$/, /^callback$/]
			})`,
			[wasmUrl]
		),
		['a.js', wasmUrl, 'icons/pwa-192.png', 'manifest.webmanifest']
	);
	assert.throws(
		() =>
			verifyPrecacheSource(
				's.precacheAndRoute([{url:"a.js"},' +
					'{url:"manifest.webmanifest"}],{})',
				[wasmUrl]
			),
		/omits required runtime asset "assets\/twine_wasm_bg-abc123\.wasm"/
	);
	assert.throws(
		() =>
			verifyPrecacheSource(
				's.precacheAndRoute([{url:"a.js"},{url:"a.js"},' +
					'{url:"manifest.webmanifest"}],{})'
			),
		/duplicate URL "a\.js"/
	);
	assert.throws(
		() =>
			verifyPrecacheSource(
				's.precacheAndRoute([{url:"z.js"},{url:"a.js"},' +
					'{url:"manifest.webmanifest"}],{})'
			),
		/canonical URL order/
	);
});
