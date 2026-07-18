import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {syntaxTree} from '@codemirror/language';
import {EditorState} from '@codemirror/state';
import type {StoryFormatProperties} from '../../../store/story-formats';
import {hydrateStoryFormatProperties} from '../hydrate-properties';
import {
	createLegacyStreamDocumentService,
	createLegacyStreamModeAdapter
} from '../legacy-editor/legacy-stream-mode';

function bundledManifest(path: string): StoryFormatProperties {
	let properties: StoryFormatProperties | undefined;
	const source = readFileSync(
		join(process.cwd(), 'public', 'story-formats', path, 'format.js'),
		'utf8'
	);

	new Function('window', source)({
		storyFormat(value: StoryFormatProperties) {
			properties = value;
		}
	});

	if (!properties) {
		throw new Error(`No story format manifest found in ${path}`);
	}

	return properties;
}

describe('bundled editor integration fixtures', () => {
	it.each(['chapbook-1.2.3', 'chapbook-2.3.1'])(
		'hydrates the real %s legacy mode, commands, and toolbar',
		fixture => {
			const raw = bundledManifest(fixture);
			const hydrated = hydrateStoryFormatProperties(raw);
			const codeMirror =
				hydrated.properties.editorExtensions?.twine?.['^2.4.0-beta2']
					?.codeMirror;

			expect(hydrated.diagnostic).toBeUndefined();
			expect(codeMirror?.mode).toEqual(expect.any(Function));
			expect(Object.keys(codeMirror?.commands ?? {})).toHaveLength(32);
			expect(codeMirror?.toolbar).toEqual(expect.any(Function));

			const document =
				"title: Example\n--\n[[Passage]]\n{embed passage: 'Other'}";
			const adapter = createLegacyStreamModeAdapter(codeMirror!.mode!, {
				documentService: createLegacyStreamDocumentService(document)
			});
			const state = EditorState.create({
				doc: document,
				extensions: [adapter.extension]
			});
			const tokens: string[] = [];

			syntaxTree(state).iterate({
				enter(node) {
					tokens.push(node.name);
				}
			});
			expect(tokens).toEqual(
				expect.arrayContaining([
					'variableName.definition',
					'punctuation',
					'link',
					'keyword'
				])
			);
			expect(adapter.failure).toBeUndefined();
		}
	);

	it('keeps Harlowe runtime source unchanged without executing legacy hydration', () => {
		const raw = bundledManifest('harlowe-3.3.9');
		const source = raw.source;
		const defineMode = jest.fn();
		const originalCodeMirror = (window as any).CodeMirror;

		(window as any).CodeMirror = {defineMode};

		try {
			const hydrated = hydrateStoryFormatProperties(raw);

			expect(hydrated.properties.source).toBe(source);
			expect(hydrated.properties).toBe(raw);
			expect(hydrated.diagnostic?.code).toBe('legacy-harlowe-editor-skipped');
			expect(defineMode).not.toHaveBeenCalled();
		} finally {
			(window as any).CodeMirror = originalCodeMirror;
		}
	});
});
