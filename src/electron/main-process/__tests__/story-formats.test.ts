import {fakePendingStoryFormat} from '../../../test-util';
import {dialog, net} from 'electron';
import {copy, pathExists, readFile, realpath, stat} from 'fs-extra';
import {loadJsonFile} from '../json-file';
import {
	addLocalStoryFormat,
	loadStoryFormatProperties,
	loadStoryFormats
} from '../story-formats';

jest.mock('electron');
jest.mock('fs-extra', () => ({
	copy: jest.fn(),
	mkdirp: jest.fn(),
	pathExists: jest.fn(),
	readFile: jest.fn(),
	realpath: jest.fn(),
	stat: jest.fn(),
	writeFile: jest.fn()
}));
jest.mock('../json-file');

function mockResponse(
	source: string | null,
	options: {headers?: Record<string, string>; status?: number} = {}
) {
	const bytes = source === null ? undefined : new TextEncoder().encode(source);
	let read = false;
	const headers = new Map(
		Object.entries(options.headers ?? {}).map(([key, value]) => [
			key.toLowerCase(),
			value
		])
	);
	const status = options.status ?? 200;

	return {
		body:
			source === null
				? null
				: {
						cancel: jest.fn(),
						getReader: () => ({
							cancel: jest.fn(),
							read: async () => {
								if (read) {
									return {done: true, value: undefined};
								}

								read = true;
								return {done: false, value: bytes};
							},
							releaseLock: jest.fn()
						})
					},
		headers: {get: (name: string) => headers.get(name.toLowerCase()) ?? null},
		ok: status >= 200 && status < 300,
		status
	};
}

describe('loadStoryFormats()', () => {
	const loadJsonFileMock = loadJsonFile as jest.Mock;

	it('resolves to the result of loading story-formats.json', async () => {
		const formats = [fakePendingStoryFormat(), fakePendingStoryFormat()];

		loadJsonFileMock.mockImplementation((name: string) => {
			if (name === 'story-formats.json') {
				return Promise.resolve(formats);
			}

			throw new Error(`Loaded incorrect file "${name}"`);
		});
		expect(await loadStoryFormats()).toBe(formats);
	});
});

describe('addLocalStoryFormat()', () => {
	const copyMock = copy as jest.Mock;
	const pathExistsMock = pathExists as jest.Mock;
	const readFileMock = readFile as jest.Mock;
	const showOpenDialogMock = dialog.showOpenDialog as jest.Mock;
	const statMock = stat as jest.Mock;

	function storyFormatSource(image: string) {
		return `window.storyFormat(${JSON.stringify({
			image,
			name: 'Mock Format',
			version: '1.2.3'
		})});`;
	}

	beforeEach(() => {
		showOpenDialogMock.mockResolvedValue({
			canceled: false,
			filePaths: ['/source/format.js']
		});
		statMock.mockResolvedValue({isDirectory: () => false});
		pathExistsMock.mockResolvedValue(true);
	});

	it('copies a relative image next to the managed format', async () => {
		readFileMock.mockResolvedValue(storyFormatSource('images/icon.svg'));

		await addLocalStoryFormat();
		expect(copyMock).toHaveBeenCalledWith(
			'/source/images/icon.svg',
			'mock-electron-app-path-userData/story-formats/Mock-Format-1.2.3/images/icon.svg',
			{overwrite: true}
		);
	});

	it('does not copy an image whose URL has a scheme', async () => {
		readFileMock.mockResolvedValue(
			storyFormatSource('data:image/svg+xml,%3Csvg%3E')
		);

		await addLocalStoryFormat();
		expect(copyMock).not.toHaveBeenCalled();
		expect(pathExistsMock).not.toHaveBeenCalled();
	});
});

describe('loadStoryFormatProperties()', () => {
	const fetchMock = net.fetch as jest.Mock;
	const readFileMock = readFile as jest.Mock;
	const realpathMock = realpath as unknown as jest.Mock;
	const statMock = stat as jest.Mock;

	beforeEach(() => {
		realpathMock.mockImplementation(async (value: string) =>
			value.startsWith('mock-electron-app-path-') ? `/${value}` : value
		);
		statMock.mockResolvedValue({isFile: () => true, size: 100});
	});

	it('parses an imported file without running its wrapper or hydration code', async () => {
		(globalThis as any).storyFormatExecuted = false;
		readFileMock.mockResolvedValue(
			`globalThis.storyFormatExecuted = true; window.storyFormat(${JSON.stringify(
				{
					hydrate: 'globalThis.storyFormatExecuted = true;',
					name: 'Untrusted Format',
					source: '<html></html>',
					version: '1.0.0'
				}
			)});`
		);

		const properties = await loadStoryFormatProperties(
			'file:///mock-electron-app-path-userData/story-formats/untrusted/format.js'
		);

		expect((globalThis as any).storyFormatExecuted).toBe(false);
		expect(properties).toEqual(
			expect.objectContaining({
				hydrate: undefined,
				name: 'Untrusted Format',
				version: '1.0.0'
			})
		);
	});

	it('rejects cleartext remote story formats', async () => {
		await expect(
			loadStoryFormatProperties('http://formats.example/format.js')
		).rejects.toThrow('must use HTTPS');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('parses an HTTPS response without evaluating it', async () => {
		fetchMock.mockResolvedValue(
			mockResponse(
				'window.storyFormat({"name":"Remote","version":"2.0.0","source":"<html></html>"});',
				{status: 200}
			)
		);

		await expect(
			loadStoryFormatProperties('https://cdn.example/format.js')
		).resolves.toEqual(
			expect.objectContaining({name: 'Remote', version: '2.0.0'})
		);
	});

	it('rejects a redirect downgrade before fetching its target', async () => {
		fetchMock.mockResolvedValue(
			mockResponse(null, {
				headers: {location: 'http://cdn.example/format.js'},
				status: 302
			})
		);

		await expect(
			loadStoryFormatProperties('https://formats.example/format.js')
		).rejects.toThrow('must use HTTPS');
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledWith(
			'https://formats.example/format.js',
			expect.objectContaining({redirect: 'manual'})
		);
	});

	it('bounds redirect chains', async () => {
		fetchMock.mockImplementation(async (url: string) =>
			Promise.resolve(
				mockResponse(null, {
					headers: {location: new URL('./next', url).toString()},
					status: 302
				})
			)
		);

		await expect(
			loadStoryFormatProperties('https://formats.example/format.js')
		).rejects.toThrow('redirected too many times');
		expect(fetchMock).toHaveBeenCalledTimes(6);
	});

	it('stops reading a response body once it exceeds the byte limit', async () => {
		// The reader checks byteLength before passing the chunk to TextDecoder, so
		// this sentinel exercises the bound without allocating 25 MiB in Jest.
		const oversizedChunk = {byteLength: 25 * 1024 * 1024 + 1};
		const cancel = jest.fn();
		let read = false;
		const releaseLock = jest.fn();

		fetchMock.mockResolvedValue({
			body: {
				getReader: () => ({
					cancel,
					read: async () => {
						if (read) {
							return {done: true, value: undefined};
						}

						read = true;
						return {done: false, value: oversizedChunk};
					},
					releaseLock
				})
			},
			headers: {get: () => null},
			ok: true,
			status: 200
		});

		await expect(
			loadStoryFormatProperties('https://formats.example/format.js')
		).rejects.toThrow('response is too large');
		expect(cancel).toHaveBeenCalledTimes(1);
		expect(releaseLock).toHaveBeenCalledTimes(1);
	});
});
