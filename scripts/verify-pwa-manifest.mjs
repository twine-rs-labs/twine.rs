#!/usr/bin/env node

import {readFile} from 'node:fs/promises';

export const expectedPwaManifestColors = Object.freeze({
	background_color: '#080D11',
	theme_color: '#F2B544'
});

export function verifyPwaManifestSource(source) {
	let manifest;

	try {
		manifest = typeof source === 'string' ? JSON.parse(source) : source;
	} catch (error) {
		throw new Error(
			`Generated PWA manifest is not valid JSON: ${error.message}`
		);
	}

	for (const [property, expected] of Object.entries(
		expectedPwaManifestColors
	)) {
		if (manifest?.[property] !== expected) {
			throw new Error(
				`Generated PWA manifest ${property} must be ${expected}; received ${JSON.stringify(manifest?.[property])}`
			);
		}
	}

	return manifest;
}

export async function verifyPwaManifest(manifestPath) {
	return verifyPwaManifestSource(await readFile(manifestPath, 'utf8'));
}
