import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {EditorView} from '@codemirror/view';
import {act, render, waitFor} from '@testing-library/react';
import * as React from 'react';
import type {StoryFormatProperties} from '../../../store/story-formats';
import {fakeLoadedStoryFormat} from '../../../test-util';
import {
	hydrateStoryFormatProperties,
	resolveStoryFormatEditorIntegration
} from '../../../util/story-format';
import {
	createLegacyStreamDocumentService,
	createLegacyStreamModeAdapter
} from '../../../util/story-format/legacy-editor/legacy-stream-mode';
import {SourceEditor, SourceEditorHandle} from '../source-editor';

function bundledProperties(path: string) {
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

describe('SourceEditor format integration lifecycle', () => {
	it('switches among real Chapbook, opt-out, and Harlowe fallback without recreating the view', async () => {
		const rawChapbook = bundledProperties('chapbook-2.3.1');
		const chapbookProperties =
			hydrateStoryFormatProperties(rawChapbook).properties;
		const chapbookFormat = fakeLoadedStoryFormat(
			{
				name: 'Chapbook',
				url: 'story-formats/chapbook-2.3.1/format.js',
				userAdded: false,
				version: '2.3.1'
			},
			chapbookProperties
		);
		const chapbook = resolveStoryFormatEditorIntegration(chapbookFormat, {
			twineVersion: '2.12.0'
		});

		expect(chapbook.type).toBe('adapted-legacy');
		if (chapbook.type !== 'adapted-legacy' || !chapbook.codeMirror.mode) {
			throw new Error('Real Chapbook fixture did not resolve an adapted mode');
		}

		const document = '{embed passage: "Other"}\n[[Missing]]';
		const documentService = createLegacyStreamDocumentService(document);
		const adapter = createLegacyStreamModeAdapter(chapbook.codeMirror.mode, {
			documentService
		});
		const adaptedExtensions = [
			adapter.extension,
			EditorView.editorAttributes.of({class: 'cm-chapbook-adapted'})
		];
		const disabled = resolveStoryFormatEditorIntegration(chapbookFormat, {
			disabled: true,
			twineVersion: '2.12.0'
		});
		const harlowe = resolveStoryFormatEditorIntegration(
			fakeLoadedStoryFormat(
				{
					name: 'Harlowe',
					url: 'story-formats/harlowe-3.3.9/format.js',
					userAdded: false,
					version: '3.3.9'
				},
				{
					name: 'Harlowe',
					source: '{{STORY_DATA}}',
					version: '3.3.9'
				}
			),
			{twineVersion: '2.12.0'}
		);
		const common = {
			brokenLinkNames: ['Missing'],
			id: 'format-switch-editor',
			label: 'Format switch editor',
			onChange: jest.fn(),
			value: document
		};
		const view = render(
			<SourceEditor
				{...common}
				dynamicExtensions={adaptedExtensions}
				dynamicExtensionsKey={chapbook.key}
				replaceGenericTwineSyntax
			/>
		);

		await waitFor(() =>
			expect(
				view.container.querySelector('.cm-chapbook-adapted')
			).toBeInTheDocument()
		);
		const editorView = view.container.querySelector('.cm-editor');

		expect(
			view.container.querySelector('.cm-twine-macro')
		).not.toBeInTheDocument();
		expect(
			view.container.querySelector('.cm-twine-link-broken')
		).toHaveTextContent('[[Missing]]');

		view.rerender(
			<SourceEditor
				{...common}
				dynamicExtensions={[]}
				dynamicExtensionsKey={disabled.key}
			/>
		);
		await waitFor(() =>
			expect(
				view.container.querySelector('.cm-twine-macro')
			).toBeInTheDocument()
		);
		expect(view.container.querySelector('.cm-editor')).toBe(editorView);

		view.rerender(
			<SourceEditor
				{...common}
				dynamicExtensions={[]}
				dynamicExtensionsKey={harlowe.key}
			/>
		);
		expect(harlowe.type).toBe('generic-fallback');
		expect(view.container.querySelector('.cm-editor')).toBe(editorView);
		expect(view.container.querySelector('.cm-twine-macro')).toBeInTheDocument();
		expect(
			view.container.querySelector('.cm-twine-link-broken')
		).toHaveTextContent('[[Missing]]');

		view.rerender(
			<SourceEditor
				{...common}
				dynamicExtensions={adaptedExtensions}
				dynamicExtensionsKey={chapbook.key}
				replaceGenericTwineSyntax
			/>
		);
		await waitFor(() =>
			expect(
				view.container.querySelector('.cm-chapbook-adapted')
			).toBeInTheDocument()
		);
		expect(view.container.querySelector('.cm-editor')).toBe(editorView);
		expect(adapter.failure).toBeUndefined();

		view.unmount();
		adapter.dispose();
		documentService.dispose();
	});

	it('keeps two Harlowe fallback editors independently editable', async () => {
		const harlowe = resolveStoryFormatEditorIntegration(
			fakeLoadedStoryFormat(
				{
					name: 'Harlowe',
					url: 'story-formats/harlowe-3.3.9/format.js',
					userAdded: false,
					version: '3.3.9'
				},
				{
					name: 'Harlowe',
					source: '{{STORY_DATA}}',
					version: '3.3.9'
				}
			),
			{twineVersion: '2.12.0'}
		);
		const first = React.createRef<SourceEditorHandle>();
		const second = React.createRef<SourceEditorHandle>();
		const view = render(
			<>
				<SourceEditor
					brokenLinkNames={['Missing']}
					dynamicExtensions={[]}
					dynamicExtensionsKey={harlowe.key}
					id="harlowe-first"
					label="First Harlowe passage"
					onChange={jest.fn()}
					ref={first}
					value="(if: true)[One] [[Missing]]"
				/>
				<SourceEditor
					dynamicExtensions={[]}
					dynamicExtensionsKey={harlowe.key}
					id="harlowe-second"
					label="Second Harlowe passage"
					onChange={jest.fn()}
					ref={second}
					value="(if: false)[Two]"
				/>
			</>
		);

		expect(harlowe.type).toBe('generic-fallback');
		await waitFor(() => {
			expect(first.current).toBeDefined();
			expect(second.current).toBeDefined();
			expect(
				view.container.querySelector('.cm-twine-link-broken')
			).toHaveTextContent('[[Missing]]');
		});

		act(() => {
			first.current!.applyEdits([{from: 0, insert: 'Changed ', to: 0}]);
			first.current!.setSelections([{anchor: 0, head: 7}]);
		});

		expect(first.current?.getSnapshot()).toMatchObject({
			document: 'Changed (if: true)[One] [[Missing]]',
			selections: [{anchor: 0, head: 7}]
		});
		expect(second.current?.getSnapshot()).toMatchObject({
			document: '(if: false)[Two]',
			selections: [{anchor: 0, head: 0}]
		});
	});
});
