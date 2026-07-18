import {
	fakeLoadedStoryFormat,
	fakeStoryFormatProperties,
	fakeUnloadedStoryFormat,
	minimalLegacyEditorFormatProperties,
	unsupportedLegacyEditorFormatProperties
} from '../../../test-util';
import {EditorState} from '@codemirror/state';
import {syntaxTree} from '@codemirror/language';
import {
	createLegacyStreamDocumentService,
	createLegacyStreamModeAdapter
} from '../legacy-editor/legacy-stream-mode';
import {resolveStoryFormatEditorIntegration} from '../editor-integration';

const options = {twineVersion: '2.12.0'};

describe('resolveStoryFormatEditorIntegration()', () => {
	it('fails closed for missing, unloaded, and disabled formats', () => {
		expect(
			resolveStoryFormatEditorIntegration(undefined, options)
		).toMatchObject({
			reason: 'format-not-installed',
			type: 'generic-fallback'
		});
		expect(
			resolveStoryFormatEditorIntegration(fakeUnloadedStoryFormat(), options)
		).toMatchObject({
			reason: 'format-not-loaded',
			type: 'generic-fallback'
		});
		expect(
			resolveStoryFormatEditorIntegration(fakeLoadedStoryFormat(), {
				...options,
				disabled: true
			})
		).toMatchObject({
			reason: 'extensions-disabled',
			type: 'generic-fallback'
		});
	});

	it('chooses an app-recognized native integration before legacy adaptation', () => {
		const format = fakeLoadedStoryFormat();
		const native = {
			dialect: {
				family: 'test',
				id: 'test-1',
				version: '1'
			},
			formatId: format.id,
			key: 'native-test',
			loadProvider: jest.fn(),
			ownsSyntax: true,
			type: 'native' as const
		};

		expect(
			resolveStoryFormatEditorIntegration(format, {
				...options,
				nativeResolver: () => native
			})
		).toBe(native);
	});

	it('adapts a compatible legacy extension and caches by properties identity', () => {
		const properties = fakeStoryFormatProperties();

		properties.editorExtensions = {
			twine: {
				'^2.0.0': {
					codeMirror: {
						mode: () => ({
							token(stream) {
								stream.skipToEnd();
								return 'text';
							}
						})
					}
				}
			}
		};
		const format = fakeLoadedStoryFormat({}, properties);

		const first = resolveStoryFormatEditorIntegration(format, options);
		const second = resolveStoryFormatEditorIntegration(format, options);

		expect(first).toBe(second);
		expect(first.type).toBe('adapted-legacy');
		if (first.type === 'adapted-legacy') {
			expect(first.lookAheadPolicy).toBe('current-document');
			expect(first.modeAdapterRecipe).toBeDefined();
		}

		const reloaded = {
			...format,
			properties: {...properties}
		};
		const afterReload = resolveStoryFormatEditorIntegration(reloaded, options);

		expect(afterReload).not.toBe(first);
		expect(afterReload.type).toBe('adapted-legacy');
		expect(afterReload.key).not.toBe(first.key);
		if (
			first.type === 'adapted-legacy' &&
			afterReload.type === 'adapted-legacy'
		) {
			expect(afterReload.modeAdapterRecipe).not.toBe(first.modeAdapterRecipe);
		}
	});

	it('grants delimiter-only lookAhead caching only to inspected bundled Chapbook versions', () => {
		const properties = fakeStoryFormatProperties();

		properties.editorExtensions = {
			twine: {
				'^2.0.0': {
					codeMirror: {
						mode: () => ({
							token(stream) {
								stream.skipToEnd();
								return 'text';
							}
						})
					}
				}
			}
		};

		for (const [version, url] of [
			['1.2.3', 'story-formats/chapbook-1.2.3/format.js'],
			['2.3.1', 'story-formats/chapbook-2.3.1/format.js']
		]) {
			const resolved = resolveStoryFormatEditorIntegration(
				fakeLoadedStoryFormat(
					{name: 'Chapbook', url, userAdded: false, version},
					properties
				),
				options
			);

			expect(resolved.type).toBe('adapted-legacy');
			if (resolved.type === 'adapted-legacy') {
				expect(resolved.lookAheadPolicy).toBe('chapbook-delimiter-presence');
			}
		}

		const userFormat = resolveStoryFormatEditorIntegration(
			fakeLoadedStoryFormat(
				{
					name: 'Chapbook',
					url: 'story-formats/chapbook-2.3.1/format.js',
					userAdded: true,
					version: '2.3.1'
				},
				properties
			),
			options
		);

		expect(userFormat.type).toBe('adapted-legacy');
		if (userFormat.type === 'adapted-legacy') {
			expect(userFormat.lookAheadPolicy).toBe('current-document');
		}
	});

	it('never adapts Harlowe legacy editor code', () => {
		const mode = jest.fn();
		const properties = fakeStoryFormatProperties();

		properties.editorExtensions = {
			twine: {
				'^2.0.0': {
					codeMirror: {
						mode: mode as any
					}
				}
			}
		};
		const format = fakeLoadedStoryFormat(
			{
				name: 'Harlowe',
				url: 'story-formats/harlowe-3.3.9/format.js',
				userAdded: false,
				version: '3.3.9'
			},
			properties
		);

		expect(resolveStoryFormatEditorIntegration(format, options)).toMatchObject({
			message: 'Generic CM6 editor; legacy format toolbar unavailable',
			reason: 'harlowe-legacy-incompatible',
			type: 'generic-fallback'
		});
		expect(mode).not.toHaveBeenCalled();
	});

	it('does not reject a bounded user format only because it is named Harlowe', () => {
		const properties = fakeStoryFormatProperties();

		properties.name = 'Harlowe';
		properties.version = '4.0.0';
		properties.editorExtensions = {
			twine: {
				'^2.0.0': {
					codeMirror: {
						mode: () => ({
							token(stream) {
								stream.skipToEnd();
								return 'text';
							}
						})
					}
				}
			}
		};
		const format = fakeLoadedStoryFormat(
			{
				name: 'Harlowe',
				url: 'https://example.invalid/custom-harlowe/format.js',
				userAdded: true,
				version: '4.0.0'
			},
			properties
		);

		expect(resolveStoryFormatEditorIntegration(format, options).type).toBe(
			'adapted-legacy'
		);
	});

	it('accepts the compliant minimal fixture and fails the unsupported fixture closed', () => {
		const minimal = fakeLoadedStoryFormat(
			{name: 'Minimal Legacy Editor', version: '1.0.0'},
			minimalLegacyEditorFormatProperties()
		);
		const supported = resolveStoryFormatEditorIntegration(minimal, options);

		expect(supported.type).toBe('adapted-legacy');

		const unsupported = fakeLoadedStoryFormat(
			{name: 'Unsupported Legacy Editor', version: '1.0.0'},
			unsupportedLegacyEditorFormatProperties()
		);
		const resolved = resolveStoryFormatEditorIntegration(unsupported, options);

		expect(resolved.type).toBe('adapted-legacy');

		if (resolved.type === 'adapted-legacy') {
			const onFailure = jest.fn();
			const adapter = createLegacyStreamModeAdapter(resolved.codeMirror.mode!, {
				documentService: createLegacyStreamDocumentService('text'),
				onFailure
			});
			const state = EditorState.create({
				doc: 'text',
				extensions: [adapter.extension]
			});

			expect(() => syntaxTree(state)).not.toThrow();
			expect(adapter.failure).toMatchObject({
				kind: 'unsupported-api',
				unsupportedApi: 'lineOracle'
			});
			expect(onFailure).toHaveBeenCalledTimes(1);
		}
	});
});
