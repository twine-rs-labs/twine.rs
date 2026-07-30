import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';

async function findWasmAssets(directory, prefix = '') {
	const urls = [];

	for (const entry of await readdir(directory, {withFileTypes: true})) {
		const url = prefix ? `${prefix}/${entry.name}` : entry.name;

		if (entry.isDirectory()) {
			urls.push(
				...(await findWasmAssets(path.join(directory, entry.name), url))
			);
		} else if (entry.isFile() && entry.name.endsWith('.wasm')) {
			urls.push(url);
		}
	}

	return urls.sort();
}

export function verifyPrecacheSource(source, requiredRuntimeUrls = []) {
	const manifest = source.match(
		/\.precacheAndRoute\(\s*\[(.*?)\]\s*(?:,\s*\{.*?\})?\s*\)/s
	)?.[1];

	if (!manifest) {
		throw new Error('Could not find a generated Workbox precache manifest.');
	}

	const urls = [
		...manifest.matchAll(/(?:\burl|"url")\s*:\s*("(?:\\.|[^"\\])*")/g)
	].map(match => JSON.parse(match[1]));
	const uniqueUrls = new Set(urls);

	if (urls.length === 0) {
		throw new Error('The generated Workbox precache manifest is empty.');
	}
	if (uniqueUrls.size !== urls.length) {
		const duplicate = urls.find((url, index) => urls.indexOf(url) !== index);

		throw new Error(
			`The generated Workbox precache manifest contains duplicate URL ${JSON.stringify(duplicate)}.`
		);
	}

	const missingRuntimeUrl = requiredRuntimeUrls.find(
		url => !uniqueUrls.has(url)
	);

	if (missingRuntimeUrl) {
		throw new Error(
			`The generated Workbox precache manifest omits required runtime asset ${JSON.stringify(missingRuntimeUrl)}.`
		);
	}

	// vite-plugin-pwa appends its generated manifest after Workbox transforms.
	// Everything else must follow the canonical URL order established in Vite.
	const generatedManifest = 'manifest.webmanifest';
	const orderedUrls = urls.filter(url => url !== generatedManifest);
	const expectedUrls = [...orderedUrls].sort();

	if (
		urls.at(-1) !== generatedManifest ||
		urls.filter(url => url === generatedManifest).length !== 1 ||
		orderedUrls.some((url, index) => url !== expectedUrls[index])
	) {
		throw new Error(
			'The generated Workbox precache manifest is not in canonical URL order.'
		);
	}

	return urls;
}

export async function verifyPrecacheManifest(filePath) {
	return verifyPrecacheSource(
		await readFile(filePath, 'utf8'),
		await findWasmAssets(path.dirname(filePath))
	);
}
