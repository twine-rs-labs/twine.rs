import {protocol} from 'electron';
import {
	initStoryPreviewProtocol,
	registerStoryPreview,
	registerStoryPreviewScheme,
	releaseStoryPreview,
	storyPreviewScheme
} from '../story-preview-protocol';

jest.mock('electron');

const originalResponse = globalThis.Response;

class TestResponse {
	readonly headers: {get(name: string): string | null};
	readonly status: number;

	constructor(
		private readonly body: string,
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
		return this.body;
	}
}

describe('story preview protocol', () => {
	beforeAll(() => {
		globalThis.Response = TestResponse as unknown as typeof Response;
	});

	afterAll(() => {
		globalThis.Response = originalResponse;
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

	it('serves registered HTML only through its opaque preview URL', async () => {
		initStoryPreviewProtocol();
		const handler = (protocol.handle as jest.Mock).mock.calls[0][1];
		const html = '<html><body>Preview</body></html>';
		const url = registerStoryPreview(html);

		expect(url).toMatch(/^twine-preview:\/\/[0-9a-f-]+\/index\.html$/);
		const response = await handler({url});

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.text()).toBe(html);

		releaseStoryPreview(url);
		const releasedResponse = await handler({url});

		expect(releasedResponse.status).toBe(404);
	});
});
