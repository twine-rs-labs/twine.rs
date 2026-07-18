import {
	createFromProperties,
	deleteFormat,
	loadAllFormatProperties,
	loadFormatProperties
} from '../action-creators';
import {StoryFormat, StoryFormatProperties} from '../story-formats.types';
import {fetchStoryFormatProperties} from '../../../util/story-format/fetch-properties';
import {
	fakeFailedStoryFormat,
	fakeLoadedStoryFormat,
	fakePendingStoryFormat,
	fakeStoryFormatProperties,
	fakeUnloadedStoryFormat
} from '../../../test-util';

jest.mock('../../../util/story-format/fetch-properties');

describe('createFromProperties', () => {
	it('returns a create action with the URL and properties specified', () => {
		const fakeProps = fakeStoryFormatProperties();

		expect(createFromProperties('mock-url', fakeProps)).toEqual({
			type: 'create',
			props: {
				name: fakeProps.name,
				url: 'mock-url',
				userAdded: true,
				version: fakeProps.version
			}
		});
	});

	it('throws an error if there is no name or version in the properties', () => {
		const fakeProps = fakeStoryFormatProperties();
		const missingName: any = {...fakeProps};
		const missingVersion: any = {...fakeProps};
		const missingBoth: any = {...fakeProps};

		delete missingName.name;
		delete missingVersion.version;
		delete missingBoth.name;
		delete missingBoth.version;

		expect(() => createFromProperties('mock-url', missingName)).toThrow();
		expect(() => createFromProperties('mock-url', missingVersion)).toThrow();
		expect(() => createFromProperties('mock-url', missingBoth)).toThrow();
	});
});

describe('deleteFormat', () => {
	it('returns a delete action', () => {
		const format = fakePendingStoryFormat();

		expect(deleteFormat(format)).toEqual({type: 'delete', id: format.id});
	});
});

describe('loadAllFormatProperties', () => {
	let dispatch: jest.Mock;
	let formats: StoryFormat[];
	let properties: StoryFormatProperties;

	beforeEach(() => {
		dispatch = jest.fn();
		properties = fakeStoryFormatProperties();
		(fetchStoryFormatProperties as jest.Mock).mockReset();
		(fetchStoryFormatProperties as jest.Mock).mockResolvedValue(properties);
		formats = [
			fakeFailedStoryFormat(),
			fakeLoadedStoryFormat(),
			fakePendingStoryFormat(),
			fakeUnloadedStoryFormat()
		];
	});

	it('loads all formats either in unloaded or error loadState', () => {
		// This is testing it indirectly :(

		loadAllFormatProperties(formats)(dispatch, () => formats);
		expect(dispatch.mock.calls).toEqual([
			[{type: 'update', id: formats[0].id, props: {loadState: 'loading'}}],
			[{type: 'update', id: formats[3].id, props: {loadState: 'loading'}}]
		]);
	});

	it('returns a promise that resolves when all formats have loaded or failed', async () => {
		await loadAllFormatProperties(formats)(dispatch, () => formats);
		expect(dispatch.mock.calls).toEqual([
			[{type: 'update', id: formats[0].id, props: {loadState: 'loading'}}],
			[{type: 'update', id: formats[3].id, props: {loadState: 'loading'}}],
			[
				{
					type: 'update',
					id: formats[0].id,
					props: {loadState: 'loaded', properties}
				}
			],
			[
				{
					type: 'update',
					id: formats[3].id,
					props: {loadState: 'loaded', properties}
				}
			]
		]);
	});
});

describe('loadFormatProperties', () => {
	const fetchPropertiesMock = fetchStoryFormatProperties as jest.Mock;
	let dispatch: jest.Mock;
	let format: StoryFormat;
	const invokeLoad = (formatToLoad: StoryFormat) =>
		loadFormatProperties(formatToLoad)(dispatch, () => [format]);

	beforeEach(() => {
		dispatch = jest.fn();
		fetchPropertiesMock.mockReset();
		format = fakePendingStoryFormat();
	});

	it('sets the format state to loading while properties are being fetched', () => {
		fetchPropertiesMock.mockImplementationOnce(() => new Promise(() => {}));
		invokeLoad(format);
		expect(dispatch.mock.calls).toEqual([
			[{type: 'update', id: format.id, props: {loadState: 'loading'}}]
		]);
	});

	describe('when fetching properties succeeds', () => {
		let properties: StoryFormatProperties;

		beforeEach(() => {
			properties = fakeStoryFormatProperties();
			fetchPropertiesMock.mockImplementationOnce((url: string) => {
				if (url !== format.url) {
					throw new Error('Asked to load incorrect story format URL');
				}

				return Promise.resolve(properties);
			});
		});

		it('sets the format properties and state as loaded', async () => {
			await invokeLoad(format);
			expect(dispatch.mock.calls.length).toBe(2);

			// First call is tested above.

			expect(dispatch.mock.calls[1]).toEqual([
				{
					type: 'update',
					id: format.id,
					props: {loadState: 'loaded', properties}
				}
			]);
		});

		it('loads the format properties even if the format previously failed to load', async () => {
			format = fakeFailedStoryFormat();
			await invokeLoad(format);
			expect(dispatch.mock.calls).toEqual([
				[{type: 'update', id: format.id, props: {loadState: 'loading'}}],
				[
					{
						type: 'update',
						id: format.id,
						props: {loadState: 'loaded', properties}
					}
				]
			]);
		});

		it('returns the format properties', async () =>
			expect(await invokeLoad(format)).toBe(properties));

		describe('if the format properties contain a hydrate property', () => {
			it('attempts the bounded hydration contract for a user format named Harlowe', async () => {
				format = fakePendingStoryFormat({
					name: 'Harlowe',
					url: 'https://example.invalid/custom-harlowe/format.js',
					userAdded: true,
					version: '3.3.9'
				});
				properties = fakeStoryFormatProperties();
				properties.name = 'Harlowe';
				properties.version = '3.3.9';
				properties.hydrate = 'this.customEditorHydrated = true';
				fetchPropertiesMock.mockReset();
				fetchPropertiesMock.mockResolvedValue(properties);

				await invokeLoad(format);

				expect(dispatch.mock.calls[1]).toEqual([
					{
						type: 'update',
						id: format.id,
						props: {
							loadState: 'loaded',
							properties: {
								...properties,
								customEditorHydrated: true
							}
						}
					}
				]);
			});

			it('merges in properties set on this by the hydrate property', async () => {
				properties.hydrate = 'this.hydrated = true';
				await invokeLoad(format);
				expect(dispatch.mock.calls).toEqual([
					[{type: 'update', id: format.id, props: {loadState: 'loading'}}],
					[
						{
							type: 'update',
							id: format.id,
							props: {
								loadState: 'loaded',
								properties: {...properties, hydrated: true}
							}
						}
					]
				]);
			});

			it('does not allow overwriting static properties in the format', async () => {
				const origName = properties.name;

				properties.hydrate = 'this.name = "failed"';
				await invokeLoad(format);
				expect(dispatch.mock.calls).toEqual([
					[{type: 'update', id: format.id, props: {loadState: 'loading'}}],
					[
						{
							type: 'update',
							id: format.id,
							props: {
								loadState: 'loaded',
								properties: {...properties, name: origName}
							}
						}
					]
				]);
			});

			it('does not throw an error and does not alter properties if the hydrate property throws', async () => {
				jest.spyOn(console, 'error').mockReturnValue();
				properties.hydrate = 'this.hydrated = true; throw new Error();';
				await invokeLoad(format);
				expect(dispatch.mock.calls).toEqual([
					[{type: 'update', id: format.id, props: {loadState: 'loading'}}],
					[
						{
							type: 'update',
							id: format.id,
							props: {
								editorIntegrationDiagnostic: {
									code: 'hydrate-error',
									message: 'Editor extensions could not be hydrated: '
								},
								loadState: 'loaded',
								properties
							}
						}
					]
				]);
			});

			it('does not execute Harlowe legacy editor hydration', async () => {
				format = fakePendingStoryFormat({
					name: 'Harlowe',
					url: 'story-formats/harlowe-3.3.9/format.js',
					userAdded: false,
					version: '3.3.9'
				});
				properties.name = 'Harlowe';
				properties.version = '3.3.9';
				properties.hydrate = 'globalThis.harloweLegacyHydrationExecuted = true';
				delete (globalThis as any).harloweLegacyHydrationExecuted;

				await invokeLoad(format);

				expect(
					(globalThis as any).harloweLegacyHydrationExecuted
				).toBeUndefined();
				expect(dispatch.mock.calls[1][0].props).toEqual({
					editorIntegrationDiagnostic: {
						code: 'legacy-harlowe-editor-skipped',
						message:
							'Legacy CM5 editor runtime skipped; native CM6 integration is available',
						unsupportedApi: 'Harlowe CodeMirror 5 editor runtime'
					},
					loadState: 'loaded',
					properties
				});
			});
		});
	});

	describe('when fetching properties fails', () => {
		let loadError: Error;

		beforeEach(() => {
			loadError = new Error();

			fetchPropertiesMock.mockImplementationOnce((url: string) => {
				if (url !== format.url) {
					throw new Error('Asked to load incorrect story format URL');
				}

				return Promise.reject(loadError);
			});
		});

		it("sets the load error and state as 'error' if loading properties fails", async () => {
			await invokeLoad(format);
			expect(dispatch.mock.calls.length).toBe(2);

			// First call is tested above.

			expect(dispatch.mock.calls[1]).toEqual([
				{type: 'update', id: format.id, props: {loadError, loadState: 'error'}}
			]);
		});
	});

	describe('when the format is already loaded', () => {
		beforeEach(() => (format = fakeLoadedStoryFormat()));

		it('dispatches no actions', async () => {
			await invokeLoad(format);
			expect(dispatch.mock.calls).toEqual([]);
		});

		it('returns the previously loaded properties', async () => {
			const loadedProps = (format as StoryFormat & {loadState: 'loaded'})
				.properties;

			expect(await invokeLoad(format)).toBe(loadedProps);
		});
	});

	describe('when the format is already loading', () => {
		it('returns the pending load instead of starting another request', async () => {
			let resolveProperties: (properties: StoryFormatProperties) => void;
			const properties = fakeStoryFormatProperties();

			fetchPropertiesMock.mockImplementationOnce(
				() =>
					new Promise<StoryFormatProperties>(resolve => {
						resolveProperties = resolve;
					})
			);

			const firstLoad = invokeLoad(format);
			const secondLoad = invokeLoad({
				...format,
				loadState: 'loading'
			});

			expect(fetchPropertiesMock).toHaveBeenCalledTimes(1);
			expect(dispatch.mock.calls).toEqual([
				[{type: 'update', id: format.id, props: {loadState: 'loading'}}]
			]);

			resolveProperties!(properties);

			await expect(firstLoad).resolves.toBe(properties);
			await expect(secondLoad).resolves.toBe(properties);
			expect(dispatch.mock.calls).toEqual([
				[{type: 'update', id: format.id, props: {loadState: 'loading'}}],
				[
					{
						type: 'update',
						id: format.id,
						props: {loadState: 'loaded', properties}
					}
				]
			]);
		});
	});
});
