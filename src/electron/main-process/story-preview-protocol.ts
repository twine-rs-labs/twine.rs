import {protocol} from 'electron';
import {randomUUID} from 'crypto';

export const storyPreviewScheme = 'twine-preview';
const maxPreviewHtmlBytes = 50 * 1024 * 1024;
const maxRegisteredPreviews = 64;
const previewHtml = new Map<string, string>();
let initialized = false;

/** Must run before Electron becomes ready so the origin receives normal web storage. */
export function registerStoryPreviewScheme() {
	protocol.registerSchemesAsPrivileged([
		{
			privileges: {
				allowServiceWorkers: false,
				corsEnabled: true,
				secure: true,
				standard: true,
				supportFetchAPI: true
			},
			scheme: storyPreviewScheme
		}
	]);
}

function tokenFromUrl(url: string) {
	try {
		const parsed = new URL(url);
		const token = /^[0-9a-f-]+$/.test(parsed.hostname)
			? parsed.hostname
			: undefined;

		return parsed.protocol === `${storyPreviewScheme}:` &&
			parsed.pathname === '/index.html'
			? token
			: undefined;
	} catch {
		return undefined;
	}
}

export function initStoryPreviewProtocol() {
	if (initialized) {
		return;
	}

	initialized = true;
	protocol.handle(storyPreviewScheme, request => {
		const token = tokenFromUrl(request.url);
		const html = token ? previewHtml.get(token) : undefined;

		if (html === undefined) {
			return new Response('Preview not found.', {
				headers: {'content-type': 'text/plain; charset=utf-8'},
				status: 404
			});
		}

		return new Response(html, {
			headers: {
				'cache-control': 'no-store',
				'content-type': 'text/html; charset=utf-8'
			}
		});
	});
}

export function registerStoryPreview(html: string) {
	if (
		typeof html !== 'string' ||
		Buffer.byteLength(html, 'utf8') > maxPreviewHtmlBytes
	) {
		throw new Error('Story preview HTML is invalid or too large.');
	}

	while (previewHtml.size >= maxRegisteredPreviews) {
		const oldest = previewHtml.keys().next().value;

		if (!oldest) {
			break;
		}
		previewHtml.delete(oldest);
	}

	const token = randomUUID();

	previewHtml.set(token, html);
	return `${storyPreviewScheme}://${token}/index.html`;
}

export function releaseStoryPreview(url: string) {
	const token = tokenFromUrl(url);

	if (token) {
		previewHtml.delete(token);
	}
}
