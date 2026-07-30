#!/usr/bin/env node

import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const mainRendererCsp = [
	"default-src 'none'",
	"script-src 'self' 'wasm-unsafe-eval'",
	"worker-src 'self'",
	"style-src 'self' 'unsafe-inline'",
	"font-src 'self'",
	"img-src 'self' data: file: http: https:",
	"media-src 'self' data: file:",
	"frame-src 'self' twine-preview:",
	"connect-src 'self' file: http: https:",
	"manifest-src 'self'",
	"object-src 'none'",
	"base-uri 'none'",
	"form-action 'none'"
].join('; ');

export function addMainRendererCsp(html) {
	if (/http-equiv=["']Content-Security-Policy["']/i.test(html)) {
		throw new Error('The Electron main renderer already has a CSP.');
	}

	const charsetMeta = /(\s*<meta\s+charset=["']utf-8["']\s*\/?>)/i;

	if (!charsetMeta.test(html)) {
		throw new Error(
			'Could not find the UTF-8 charset declaration in the Electron main renderer.'
		);
	}

	return html.replace(
		charsetMeta,
		`$1
		<meta
			http-equiv="Content-Security-Policy"
			content="${mainRendererCsp}"
		/>`
	);
}

export async function installMainRendererCsp(filePath) {
	const html = await readFile(filePath, 'utf8');

	await writeFile(filePath, addMainRendererCsp(html), 'utf8');
}

const scriptPath = fileURLToPath(import.meta.url);

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
	const rootDir = path.resolve(path.dirname(scriptPath), '..');
	const rendererIndex = path.join(
		rootDir,
		'electron-build',
		'renderer',
		'index.html'
	);

	await installMainRendererCsp(rendererIndex);
}
