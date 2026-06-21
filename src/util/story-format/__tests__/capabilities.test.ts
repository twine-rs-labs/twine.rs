import {
	inspectStoryFormatPublishSafety,
	storyFormatCapabilities
} from '../capabilities';
import {
	fakeLoadedStoryFormat,
	fakeStoryFormatProperties
} from '../../../test-util';

describe('story format M6 capabilities', () => {
	it('derives a compatibility manifest from legacy editor extensions', () => {
		const properties = fakeStoryFormatProperties();

		properties.editorExtensions = {
			twine: {
				'>=2.0.0': {
					codeMirror: {
						mode: (() => null) as any,
						toolbar: (() => []) as any
					},
					references: {
						parsePassageText: () => []
					}
				}
			}
		};

		const capabilities = storyFormatCapabilities(properties);

		expect(capabilities).toEqual(
			expect.objectContaining({
				editorToolbarActions: true,
				exporter: true,
				parser: true,
				publishSafe: true,
				resolvedModules: expect.objectContaining({
					runtime: []
				}),
				syntax: true
			})
		);
	});

	it('flags dev-only modules and HMR clients in published runtime code', () => {
		const format = fakeLoadedStoryFormat(undefined, {
			source: '{{STORY_DATA}}<script src="/@vite/client"></script>',
			twineRs: {
				modules: [
					{
						id: 'dev-panel',
						includeInPublish: true,
						slot: 'devtools'
					}
				]
			}
		});
		const properties =
			format.loadState === 'loaded'
				? format.properties
				: fakeStoryFormatProperties();

		const safety = inspectStoryFormatPublishSafety(properties);
		const capabilities = storyFormatCapabilities(properties);

		expect(safety.publishSafe).toBe(false);
		expect(safety.issues.map(issue => issue.code)).toEqual([
			'publish-includes-devtools-module',
			'vite-hmr-client'
		]);
		expect(capabilities.devOnlyTools).toBe(true);
		expect(capabilities.publishSafe).toBe(false);
	});

	it('flags development module bases in publish-included code', () => {
		const properties = fakeStoryFormatProperties();

		properties.twineRs = {
			development: {
				devServerUrl: 'http://localhost:5173/formats/mock/',
				hmr: true
			},
			modules: [{id: 'runtime', slot: 'runtime'}]
		};

		expect(
			inspectStoryFormatPublishSafety(properties).issues.map(
				issue => issue.code
			)
		).toEqual([
			'development-dev-server-url',
			'development-hmr',
			'module-dev-server-url'
		]);
	});
});
