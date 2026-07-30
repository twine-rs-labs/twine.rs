import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {test} from 'node:test';
import {
	addMainRendererCsp,
	mainRendererCsp
} from '../install-main-renderer-csp.mjs';

const root = path.resolve(import.meta.dirname, '../..');

function policyDirectives(policy) {
	return Object.fromEntries(
		policy.split(';').map(directive => {
			const [name, ...sources] = directive.trim().split(/\s+/);

			return [name, sources];
		})
	);
}

test('main renderer CSP allows only the resources used by the desktop app', () => {
	const directives = policyDirectives(mainRendererCsp);

	assert.deepEqual(directives, {
		'base-uri': ["'none'"],
		'connect-src': ["'self'", 'file:', 'http:', 'https:'],
		'default-src': ["'none'"],
		'font-src': ["'self'"],
		'form-action': ["'none'"],
		'frame-src': ["'self'", 'twine-preview:'],
		'img-src': ["'self'", 'data:', 'file:', 'http:', 'https:'],
		'manifest-src': ["'self'"],
		'media-src': ["'self'", 'data:', 'file:'],
		'object-src': ["'none'"],
		'script-src': ["'self'", "'wasm-unsafe-eval'"],
		'style-src': ["'self'", "'unsafe-inline'"],
		'worker-src': ["'self'"]
	});
	assert.equal(directives['script-src'].includes("'unsafe-eval'"), false);
});

test('CSP is installed before any main renderer resources', async () => {
	const source = await readFile(path.join(root, 'index.html'), 'utf8');
	const html = addMainRendererCsp(source);
	const policyPosition = html.indexOf('http-equiv="Content-Security-Policy"');
	const firstResourcePosition = Math.min(
		...['<link ', '<script ']
			.map(marker => html.indexOf(marker))
			.filter(position => position >= 0)
	);

	assert.equal(
		(source.match(/http-equiv=["']Content-Security-Policy["']/gi) ?? []).length,
		0
	);
	assert.equal(
		(html.match(/http-equiv=["']Content-Security-Policy["']/gi) ?? []).length,
		1
	);
	assert.ok(policyPosition > source.indexOf('<meta charset="utf-8"'));
	assert.ok(policyPosition < firstResourcePosition);
	assert.match(html, new RegExp(`content="${mainRendererCsp}"`));
});

test('CSP installation rejects ambiguous renderer HTML', () => {
	assert.throws(
		() =>
			addMainRendererCsp(
				'<meta charset="utf-8"><meta http-equiv="Content-Security-Policy">'
			),
		/already has a CSP/
	);
	assert.throws(
		() => addMainRendererCsp('<html><head></head></html>'),
		/Could not find the UTF-8 charset declaration/
	);
});
