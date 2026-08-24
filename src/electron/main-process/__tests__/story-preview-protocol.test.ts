import {protocol} from 'electron';
import {
	handleStoryPreviewRequest,
	initStoryPreviewProtocol,
	maxStoryPreviewPackages,
	registerStoryPreviewPackage,
	registerStoryPreviewStateCleanup,
	registerStoryPreviewScheme,
	registeredStoryPreviewPackageCount,
	releaseStoryPreviewPackage,
	releaseStoryPreviewStateCleanup,
	resetStoryPreviewPackagesForTests,
	storyPreviewScheme
} from '../story-preview-protocol';

jest.mock('electron');

const originalResponse = globalThis.Response;

class TestResponse {
	readonly headers: {get(name: string): string | null};
	readonly status: number;

	constructor(
		private readonly body: BodyInit | null,
		options: {headers?: Record<string, string>; status?: number} = {}
	) {
		const headers = options.headers ?? {};

		this.headers = {
			get: name =>
				Object.entries(headers).find(
					([key]) => key.toLowerCase() === name.toLowerCase()
				)?.[1] ?? null
		};
		this.status = options.status ?? 200;
	}

	async text() {
		if (this.body === null) {
			return '';
		}
		if (typeof this.body === 'string') {
			return this.body;
		}
		if (Object.prototype.toString.call(this.body) === '[object ArrayBuffer]') {
			return new TextDecoder().decode(new Uint8Array(this.body as ArrayBuffer));
		}

		return String(this.body);
	}
}

function registerHtmlPackage(html: string) {
	const bytes = new Uint8Array(Buffer.from(html, 'utf8'));

	return registerStoryPreviewPackage({
		files: [
			{
				bytes,
				mediaType: 'text/html; charset=utf-8',
				outputPath: 'index.html',
				path: '/preview/index.html',
				sizeBytes: bytes.byteLength
			}
		],
		indexPath: '/preview/index.html',
		rootPath: '/preview',
		sizeBytes: bytes.byteLength
	});
}

describe('story preview protocol', () => {
	beforeAll(() => {
		globalThis.Response = TestResponse as unknown as typeof Response;
	});

	afterAll(() => {
		globalThis.Response = originalResponse;
	});

	afterEach(async () => {
		await resetStoryPreviewPackagesForTests();
	});

	it('registers a standard secure origin for browser storage', () => {
		registerStoryPreviewScheme();

		expect(protocol.registerSchemesAsPrivileged).toHaveBeenCalledWith([
			{
				privileges: expect.objectContaining({
					secure: true,
					standard: true
				}),
				scheme: storyPreviewScheme
			}
		]);
	});

	it('serves staged HTML only through its opaque preview URL', async () => {
		initStoryPreviewProtocol();
		const handler = (protocol.handle as jest.Mock).mock.calls[0][1];
		const html = '<html><body>Preview</body></html>';
		const url = registerHtmlPackage(html);

		expect(url).toMatch(/^twine-preview:\/\/[0-9a-f-]+\/index\.html$/);
		const response = await handler({url});

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.text()).toBe(html);

		await releaseStoryPreviewPackage(url);
		const releasedResponse = await handler({url});

		expect(releasedResponse.status).toBe(404);
	});

	it('serves a one-use package-origin state cleanup page without package data', async () => {
		const url = registerHtmlPackage('<html><body>private story</body></html>');
		const cleanup = registerStoryPreviewStateCleanup(url, 'clear-preview-42');

		expect(cleanup).toEqual({
			operationId: 'clear-preview-42',
			url: expect.stringMatching(
				/^twine-preview:\/\/[0-9a-f-]+\/__twine-preview-clear-state\/[0-9a-f-]+$/
			)
		});

		const head = await handleStoryPreviewRequest({
			method: 'HEAD',
			url: cleanup.url
		});

		expect(head.status).toBe(200);
		expect(await head.text()).toBe('');
		expect(head.headers.get('cache-control')).toBe('no-store');
		expect(head.headers.get('x-content-type-options')).toBe('nosniff');
		expect(head.headers.get('content-security-policy')).toMatch(
			/^base-uri 'none'; default-src 'none'; form-action 'none'; script-src 'nonce-[0-9a-f]+'$/
		);
		expect(
			await handleStoryPreviewRequest({url: `${cleanup.url}?retry=1`})
		).toMatchObject({status: 404});

		const response = await handleStoryPreviewRequest({url: cleanup.url});
		const html = await response.text();

		expect(response.status).toBe(200);
		expect(html).toContain('localStorage.clear()');
		expect(html).toContain('sessionStorage.clear()');
		expect(html).toContain('caches.delete(name)');
		expect(html).toContain('indexedDB.deleteDatabase(database.name)');
		expect(html).toContain('Preview state cleanup incomplete');
		expect(html).toContain('twine-preview-state-cleared');
		expect(html).toContain('clear-preview-42');
		expect(html).not.toContain('private story');
		expect((await handleStoryPreviewRequest({url: cleanup.url})).status).toBe(
			404
		);
	});

	it('fails closed for invalid, cancelled, and released state cleanup tickets', async () => {
		const url = registerHtmlPackage('<html><body>private story</body></html>');

		expect(() => registerStoryPreviewStateCleanup(`${url}?retry=1`)).toThrow(
			'exact live story preview package URL'
		);
		expect(() =>
			registerStoryPreviewStateCleanup(url, 'x'.repeat(129))
		).toThrow('bounded operation ID');
		expect(() =>
			registerStoryPreviewStateCleanup(
				url.replace('/index.html', '/assets/preview.html')
			)
		).toThrow('exact live story preview package URL');

		const cancelled = registerStoryPreviewStateCleanup(url, 'cancelled');
		releaseStoryPreviewStateCleanup(cancelled.url);
		expect(await handleStoryPreviewRequest({url: cancelled.url})).toMatchObject(
			{status: 404}
		);

		const released = registerStoryPreviewStateCleanup(url, 'released');
		await releaseStoryPreviewPackage(url);
		expect(await handleStoryPreviewRequest({url: released.url})).toMatchObject({
			status: 404
		});
	});

	it('invalidates state cleanup tickets during test package reset', async () => {
		const cleanup = registerStoryPreviewStateCleanup(
			registerHtmlPackage('<html></html>')
		);

		await resetStoryPreviewPackagesForTests();

		expect(await handleStoryPreviewRequest({url: cleanup.url})).toMatchObject({
			status: 404
		});
	});

	it('serves exact staged assets with query-independent allowlist lookup', async () => {
		const url = registerStoryPreviewPackage({
			files: [
				{
					bytes: new Uint8Array([60, 47, 62, 10, 0]),
					outputPath: 'index.html',
					path: '/preview/index.html',
					sizeBytes: 5
				},
				{
					bytes: new Uint8Array([1, 2, 3]),
					outputPath: 'assets/cover image.png',
					path: '/preview/assets/cover image.png',
					sizeBytes: 3
				}
			],
			indexPath: '/preview/index.html',
			rootPath: '/preview',
			sizeBytes: 8
		});
		const response = await handleStoryPreviewRequest({
			url: url.replace('/index.html', '/assets/cover%20image.png?v=2')
		});

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('image/png');
		expect(response.headers.get('content-length')).toBe('3');
		expect(response.headers.get('accept-ranges')).toBe('bytes');
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
	});

	it('infers support-file MIME types when the native reader returns generic bytes', async () => {
		const css = new TextEncoder().encode('body { color: rebeccapurple; }');
		const url = registerStoryPreviewPackage({
			files: [
				{
					bytes: new Uint8Array([60, 47, 62]),
					outputPath: 'index.html',
					path: '/preview/index.html',
					sizeBytes: 3
				},
				{
					bytes: css,
					mediaType: 'application/octet-stream',
					outputPath: 'assets/theme.css',
					path: '/preview/assets/theme.css',
					sizeBytes: css.byteLength
				}
			],
			indexPath: '/preview/index.html',
			rootPath: '/preview',
			sizeBytes: css.byteLength + 3
		});
		const response = await handleStoryPreviewRequest({
			url: url.replace('/index.html', '/assets/theme.css?theme=1')
		});

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe(
			'text/css; charset=utf-8'
		);
		expect(await response.text()).toContain('rebeccapurple');
	});

	it('supports HEAD and one validated byte range', async () => {
		const url = registerStoryPreviewPackage({
			files: [
				{
					bytes: new Uint8Array([10, 20, 30, 40]),
					outputPath: 'index.html',
					path: '/preview/index.html',
					sizeBytes: 4
				}
			],
			indexPath: '/preview/index.html',
			rootPath: '/preview',
			sizeBytes: 4
		});
		const head = await handleStoryPreviewRequest({method: 'HEAD', url});

		expect(head.status).toBe(200);
		expect(head.headers.get('content-length')).toBe('4');
		expect(await head.text()).toBe('');

		const partial = await handleStoryPreviewRequest({
			headers: {get: name => (name === 'range' ? 'bytes=1-2' : null)},
			url
		});

		expect(partial.status).toBe(206);
		expect(partial.headers.get('content-range')).toBe('bytes 1-2/4');
		expect(partial.headers.get('content-length')).toBe('2');

		const partialHead = await handleStoryPreviewRequest({
			headers: {get: name => (name === 'range' ? 'bytes=1-2' : null)},
			method: 'HEAD',
			url
		});

		expect(partialHead.status).toBe(206);
		expect(partialHead.headers.get('content-range')).toBe('bytes 1-2/4');
		expect(await partialHead.text()).toBe('');
	});

	it.each([
		'bytes=99-100',
		'bytes=3-1',
		'bytes=-0',
		'bytes=0-1,2-3',
		'items=0-1'
	])('returns 416 for an invalid range: %s', async range => {
		const url = registerHtmlPackage('<html></html>');
		const size = Buffer.byteLength('<html></html>');
		const response = await handleStoryPreviewRequest({
			headers: {get: name => (name === 'range' ? range : null)},
			url
		});

		expect(response.status).toBe(416);
		expect(response.headers.get('content-range')).toBe(`bytes */${size}`);
	});

	it.each([
		({url}: {url: string}) => url.replace('/index.html', '/../index.html'),
		({url}: {url: string}) => url.replace('/index.html', '/%2e%2e/index.html'),
		({url}: {url: string}) => url.replace('/index.html', '/assets%2fsecret'),
		({url}: {url: string}) => url.replace('/index.html', '/assets%5csecret'),
		({url}: {url: string}) => url.replace('/index.html', '/assets/%00secret'),
		({url}: {url: string}) => url.replace('twine-preview://', 'https://'),
		({url}: {url: string}) =>
			url.replace('twine-preview://', 'twine-preview://x@'),
		({url}: {url: string}) => url.replace('/index.html', ':80/index.html'),
		() => 'twine-preview://not-a-token/index.html'
	])('rejects malformed or unsafe package URLs', async mutate => {
		const url = registerHtmlPackage('<html></html>');
		const response = await handleStoryPreviewRequest({
			url: mutate({url})
		});

		expect(response.status).toBe(404);
	});

	it('rejects unsupported methods without reading package data', async () => {
		const url = registerHtmlPackage('<html></html>');
		const response = await handleStoryPreviewRequest({method: 'POST', url});

		expect(response.status).toBe(405);
	});

	it('rejects capacity overflow without evicting a live package', async () => {
		const firstUrl = registerHtmlPackage('first');

		for (let index = 1; index < maxStoryPreviewPackages; index++) {
			registerHtmlPackage(`preview-${index}`);
		}

		expect(registeredStoryPreviewPackageCount()).toBe(maxStoryPreviewPackages);
		expect(() => registerHtmlPackage('overflow')).toThrow(
			'live story preview packages'
		);
		expect((await handleStoryPreviewRequest({url: firstUrl})).status).toBe(200);
	});
});
