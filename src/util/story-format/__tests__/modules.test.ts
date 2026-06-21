import {
	loadStoryFormatModules,
	resolveStoryFormatModule,
	resolveStoryFormatModules
} from '../modules';
import {fakeStoryFormatProperties} from '../../../test-util';

describe('story format module resolver', () => {
	it('resolves declared modules relative to the story format URL', () => {
		const properties = fakeStoryFormatProperties();

		properties.url = 'https://example.com/formats/example/format.js';
		properties.twineRs = {
			modules: [
				{id: 'runtime', slot: 'runtime', url: './runtime.js'},
				{id: 'editor', includeInPublish: false, slot: 'editor'}
			]
		};

		const modules = resolveStoryFormatModules(properties);

		expect(modules.runtime[0]).toEqual(
			expect.objectContaining({
				declaredUrl: './runtime.js',
				includeInPublish: true,
				resolvedUrl: 'https://example.com/formats/example/runtime.js'
			})
		);
		expect(modules.editor[0]).toEqual(
			expect.objectContaining({
				declaredUrl: 'editor.js',
				includeInPublish: false,
				resolvedUrl: 'https://example.com/formats/example/editor.js'
			})
		);
	});

	it('uses development bases before the static format URL', () => {
		const properties = fakeStoryFormatProperties();

		properties.url = 'https://example.com/format.js';
		properties.twineRs = {
			development: {devServerUrl: 'http://localhost:5173/formats/mock/'}
		};

		expect(
			resolveStoryFormatModule(properties, {id: 'preview', slot: 'preview'})
		).toEqual(
			expect.objectContaining({
				resolvedUrl: 'http://localhost:5173/formats/mock/preview.js'
			})
		);
	});

	it('records unresolved relative modules without throwing', () => {
		const properties = fakeStoryFormatProperties();

		delete properties.url;

		expect(
			resolveStoryFormatModule(properties, {
				id: 'runtime',
				slot: 'runtime',
				url: './runtime.js'
			})
		).toEqual(
			expect.objectContaining({
				resolutionError: expect.stringContaining('Could not resolve module'),
				resolvedUrl: null
			})
		);
	});

	it('loads non-lazy modules by slot', async () => {
		const properties = fakeStoryFormatProperties();
		const fetch = jest.fn((url: string) =>
			Promise.resolve({
				headers: new Headers({'content-type': 'text/javascript'}),
				ok: true,
				status: 200,
				text: () => Promise.resolve(`source:${url}`)
			})
		);

		properties.url = 'https://example.com/format.js';
		properties.twineRs = {
			modules: [
				{id: 'runtime', slot: 'runtime'},
				{id: 'lazy-preview', lazy: true, slot: 'preview'}
			]
		};

		const modules = await loadStoryFormatModules(properties, {fetch});

		expect(fetch.mock.calls).toEqual([['https://example.com/runtime.js']]);
		expect(modules.runtime[0]).toEqual(
			expect.objectContaining({
				mediaType: 'text/javascript',
				source: 'source:https://example.com/runtime.js'
			})
		);
		expect(modules.preview).toEqual([]);
	});
});
