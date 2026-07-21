#!/usr/bin/env node

import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';

const addonPath = process.argv[2];

if (!addonPath) {
	throw new Error('Usage: check-native-asset-reader-abi.mjs <addon-path>');
}

const addon = createRequire(import.meta.url)(path.resolve(addonPath));

assert.equal(
	typeof addon.readProjectAssetPayloads,
	'function',
	'The native addon must export readProjectAssetPayloads.'
);
assert.equal(
	typeof addon.captureProjectAssetDigests,
	'function',
	'The native addon must export captureProjectAssetDigests.'
);

const missingProjectRoot = path.join(
	os.tmpdir(),
	`twine-native-asset-reader-abi-missing-${process.pid}-${Date.now()}`
);
async function assertPromiseRejection(exportName, invoke) {
	let result;

	try {
		result = invoke();
	} catch (error) {
		throw new Error(`${exportName} threw synchronously: ${error.message}`, {
			cause: error
		});
	}

	assert.equal(
		typeof result?.then,
		'function',
		`${exportName} must return a Promise.`
	);
	await assert.rejects(
		result,
		/Project root could not be resolved/,
		`${exportName} must reject invalid roots through the returned Promise.`
	);
}

await assertPromiseRejection('readProjectAssetPayloads', () =>
	addon.readProjectAssetPayloads(missingProjectRoot, [], 1, 1, 1)
);
await assertPromiseRejection('captureProjectAssetDigests', () =>
	addon.captureProjectAssetDigests(missingProjectRoot, [], 1, 1)
);

console.log(
	'check-native-asset-reader-abi: payload and digest Promise rejection verified'
);
