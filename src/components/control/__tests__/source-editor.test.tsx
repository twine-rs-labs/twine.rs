import {render, screen, waitFor} from '@testing-library/react';
import {StateField} from '@codemirror/state';
import {Decoration, EditorView, ViewPlugin} from '@codemirror/view';
import * as React from 'react';
import {SourceEditor, type SourceEditorHandle} from '../source-editor';

describe('<SourceEditor>', () => {
	afterEach(() => {
		window.localStorage.clear();
		jest.restoreAllMocks();
	});

	it('clamps restored selections to the current document', () => {
		window.localStorage.setItem(
			'twine-source-editor-story-start',
			JSON.stringify({
				anchor: 999,
				head: 1000,
				scrollLeft: 0,
				scrollTop: 0
			})
		);

		expect(() =>
			render(
				<SourceEditor
					id="story-start-editor"
					label="Passage text"
					memoryKey="story-start"
					onChange={jest.fn()}
					value="Short"
				/>
			)
		).not.toThrow();

		expect(
			screen.getByRole('textbox', {name: 'Passage text'})
		).toBeInTheDocument();
	});

	it('restores the exact saved selection for a reopened editor', async () => {
		window.localStorage.setItem(
			'twine-source-editor-story-reopen',
			JSON.stringify({
				anchor: 2,
				head: 7,
				scrollLeft: 0,
				scrollTop: 0
			})
		);
		const editor = React.createRef<SourceEditorHandle>();

		render(
			<SourceEditor
				id="story-reopen-editor"
				label="Reopened passage"
				memoryKey="story-reopen"
				onChange={jest.fn()}
				ref={editor}
				value="0123456789"
			/>
		);

		await waitFor(() =>
			expect(editor.current?.getSnapshot().selections).toEqual([
				{anchor: 2, head: 7}
			])
		);
	});

	it('does not echo a controlled value synchronization through onChange', async () => {
		const onChange = jest.fn();
		const onDocumentChange = jest.fn();
		const editor = React.createRef<SourceEditorHandle>();
		const {rerender} = render(
			<SourceEditor
				id="controlled-editor"
				label="Controlled passage"
				onChange={onChange}
				ref={editor}
				value="Before"
			/>
		);
		await waitFor(() => expect(editor.current).toBeDefined());
		const unsubscribe =
			editor.current?.subscribeDocumentChanges(onDocumentChange);

		rerender(
			<SourceEditor
				id="controlled-editor"
				label="Controlled passage"
				onChange={onChange}
				ref={editor}
				value="After"
			/>
		);

		await waitFor(() =>
			expect(editor.current?.getSnapshot().document).toBe('After')
		);
		expect(onChange).not.toHaveBeenCalled();
		expect(onDocumentChange).toHaveBeenCalledWith(
			expect.objectContaining({document: 'After'})
		);
		unsubscribe?.();
	});

	it('highlights Harlowe and SugarCube macros without marking parenthesized prose', async () => {
		const {container} = render(
			<SourceEditor
				id="story-start-editor"
				label="Passage text"
				onChange={jest.fn()}
				value={
					'(if: true)[Shown]\n' +
					'(set:_secret_thought to "secretly harbor")\n' +
					'<<=Story.name>>\n' +
					'<</if>>\n' +
					'$object.properties\n' +
					'// the keeper watches from the stair\n' +
					'(you have to force yourself)\n' +
					'She said "not a code string."'
				}
			/>
		);

		await waitFor(() =>
			expect(container.querySelectorAll('.cm-twine-macro')).toHaveLength(8)
		);
		expect(
			Array.from(container.querySelectorAll('.cm-twine-macro')).map(element =>
				element.textContent?.trim()
			)
		).toEqual([
			'(if:',
			')',
			'(set:',
			')',
			'<<=Story.name',
			'>>',
			'<</if',
			'>>'
		]);
		expect(
			Array.from(container.querySelectorAll('.cm-twine-string')).map(
				element => element.textContent
			)
		).toEqual(['"secretly harbor"', '"not a code string."']);
		expect(
			Array.from(container.querySelectorAll('.cm-twine-comment')).map(
				element => element.textContent
			)
		).toEqual(['// the keeper watches from the stair']);
		expect(
			Array.from(container.querySelectorAll('.cm-twine-variable')).map(
				element => element.textContent?.trim()
			)
		).toContain('$object.properties');
		expect(
			Array.from(container.querySelectorAll('.cm-twine-variable')).map(
				element => element.textContent?.trim()
			)
		).toContain('_secret_thought');
		expect(container).toHaveTextContent('(you have to force yourself)');
		expect(
			Array.from(container.querySelectorAll('.cm-twine-macro')).some(element =>
				element.textContent?.includes('(you')
			)
		).toBe(false);
	});

	it('highlights Chapbook and Snowman syntax with the shared Twine palette', async () => {
		const {container} = render(
			<SourceEditor
				id="story-start-editor"
				label="Passage text"
				onChange={jest.fn()}
				value={
					'{embed passage: "Lamp Room"}\n' +
					'{{ config.debug }}\n' +
					'<% if (s.lampLit) { %><%= "Glow" %><% } %>\n' +
					'[[Proof Link]]'
				}
			/>
		);

		await waitFor(() =>
			expect(container.querySelectorAll('.cm-twine-macro')).toHaveLength(10)
		);
		expect(
			Array.from(container.querySelectorAll('.cm-twine-macro')).map(element =>
				element.textContent?.trim()
			)
		).toEqual([
			'{embed passage:',
			'}',
			'{{',
			'}}',
			'<%',
			'%>',
			'<%=',
			'%>',
			'<%',
			'%>'
		]);
		expect(
			Array.from(container.querySelectorAll('.cm-twine-string')).map(
				element => element.textContent
			)
		).toEqual(['"Lamp Room"', '"Glow"']);
		expect(
			Array.from(container.querySelectorAll('.cm-twine-link')).map(
				element => element.textContent
			)
		).toEqual(['[[Proof Link]]']);
	});

	it('toggles the editor search panel when requested without an explicit query', async () => {
		const {container, rerender} = render(
			<SourceEditor
				id="story-start-editor"
				label="Passage text"
				onChange={jest.fn()}
				value="Find this text"
			/>
		);

		rerender(
			<SourceEditor
				id="story-start-editor"
				label="Passage text"
				onChange={jest.fn()}
				searchRequestKey={1}
				value="Find this text"
			/>
		);

		await waitFor(() =>
			expect(container.querySelector('.cm-search')).toBeInTheDocument()
		);

		rerender(
			<SourceEditor
				id="story-start-editor"
				label="Passage text"
				onChange={jest.fn()}
				searchRequestKey={2}
				value="Find this text"
			/>
		);

		await waitFor(() =>
			expect(container.querySelector('.cm-search')).not.toBeInTheDocument()
		);
	});

	it('wraps passage prose without showing a fold gutter', async () => {
		const {container, rerender} = render(
			<SourceEditor
				id="story-start-editor"
				label="Passage text"
				onChange={jest.fn()}
				value="A very long passage line should wrap instead of forcing a horizontal scrollbar."
			/>
		);

		await waitFor(() =>
			expect(container.querySelector('.cm-lineWrapping')).toBeInTheDocument()
		);
		expect(container.querySelector('.cm-foldGutter')).not.toBeInTheDocument();

		rerender(
			<SourceEditor
				id="story-start-editor"
				label="Passage text"
				language="css"
				onChange={jest.fn()}
				value=".story { color: red; }"
			/>
		);

		await waitFor(() =>
			expect(container.querySelector('.cm-foldGutter')).toBeInTheDocument()
		);
	});

	it('installs, reconfigures, and destroys dynamic extensions without recreating the view', async () => {
		const destroyed = jest.fn();
		const editor = React.createRef<SourceEditorHandle>();
		const synthetic = [
			EditorView.editorAttributes.of({class: 'cm-synthetic-extension'}),
			ViewPlugin.define(() => ({destroy: destroyed}))
		];
		const {container, rerender, unmount} = render(
			<SourceEditor
				dynamicExtensions={synthetic}
				dynamicExtensionsKey="synthetic"
				id="dynamic-editor"
				label="Dynamic editor"
				onChange={jest.fn()}
				ref={editor}
				value="Text"
			/>
		);

		await waitFor(() =>
			expect(container.querySelector('.cm-synthetic-extension')).toBeTruthy()
		);
		expect(editor.current?.isAlive()).toBe(true);
		const handle = editor.current!;
		const view = container.querySelector('.cm-editor');

		rerender(
			<SourceEditor
				dynamicExtensions={[]}
				dynamicExtensionsKey="generic"
				id="dynamic-editor"
				label="Dynamic editor"
				onChange={jest.fn()}
				ref={editor}
				value="Text"
			/>
		);

		await waitFor(() =>
			expect(container.querySelector('.cm-synthetic-extension')).toBeNull()
		);
		expect(container.querySelector('.cm-editor')).toBe(view);
		expect(destroyed).toHaveBeenCalledTimes(1);

		unmount();
		expect(destroyed).toHaveBeenCalledTimes(1);
		expect(editor.current).toBeNull();
		expect(handle.isAlive()).toBe(false);
	});

	it('scopes the format code-font preference to dialect syntax', async () => {
		const {container, rerender} = render(
			<SourceEditor
				id="dialect-font-editor"
				label="Dialect font editor"
				onChange={jest.fn()}
				useCodeFont
				value="prose (print: $value)"
			/>
		);

		await waitFor(() =>
			expect(container.querySelector('.source-editor')).toHaveClass(
				'source-editor--syntax-code-font'
			)
		);

		rerender(
			<SourceEditor
				id="dialect-font-editor"
				label="Dialect font editor"
				onChange={jest.fn()}
				value="prose (print: $value)"
			/>
		);
		expect(container.querySelector('.source-editor')).not.toHaveClass(
			'source-editor--syntax-code-font'
		);
	});

	it('exposes controlled snapshots, edits, selections, and commands', async () => {
		const editor = React.createRef<SourceEditorHandle>();
		const onDocumentChange = jest.fn();

		const {rerender} = render(
			<SourceEditor
				id="handled-editor"
				label="Handled editor"
				onChange={jest.fn()}
				ref={editor}
				value={'one\ntwo'}
			/>
		);

		await waitFor(() => expect(editor.current).toBeTruthy());
		const handle = editor.current!;
		const unsubscribe = handle.subscribeDocumentChanges(onDocumentChange);

		editor.current!.applyEdits(
			[{from: 0, insert: 'ONE', to: 3}],
			[{anchor: 0, head: 3}]
		);
		expect(editor.current!.getSnapshot()).toMatchObject({
			canUndo: true,
			document: 'ONE\ntwo',
			selections: [{anchor: 0, head: 3}]
		});
		expect(onDocumentChange).toHaveBeenCalledWith({
			document: 'ONE\ntwo',
			edits: [{from: 0, fromNew: 0, insert: 'ONE', to: 3, toNew: 3}]
		});
		expect(editor.current!.runCommand('undo')).toBe(true);
		expect(editor.current!.getSnapshot().document).toBe('one\ntwo');
		expect(editor.current!.runCommand('redo')).toBe(true);
		expect(editor.current!.getSnapshot().document).toBe('ONE\ntwo');

		rerender(
			<SourceEditor
				id="handled-editor"
				label="Handled editor"
				onChange={jest.fn()}
				ref={editor}
				value={'ONE\ntwo'}
			/>
		);
		expect(editor.current).toBe(handle);
		unsubscribe();
	});

	it('contains a failing dynamic extension and restores generic syntax', async () => {
		const onError = jest.fn();
		const failing = StateField.define({
			create() {
				throw new Error('synthetic dynamic failure');
			},
			update(value) {
				return value;
			}
		});
		const {container} = render(
			<SourceEditor
				dynamicExtensions={[failing]}
				dynamicExtensionsKey="failing"
				id="failing-editor"
				label="Failing editor"
				onChange={jest.fn()}
				onDynamicExtensionError={onError}
				replaceGenericTwineSyntax
				value="(if: true)[still editable]"
			/>
		);

		await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
		await waitFor(() =>
			expect(container.querySelector('.cm-twine-macro')).toBeInTheDocument()
		);
	});

	it('keeps links and diagnostics while an adapted mode singularly owns syntax', async () => {
		const adaptedSyntax = EditorView.decorations.of(
			Decoration.set([
				Decoration.mark({class: 'cm-adapted-syntax'}).range(0, 3)
			])
		);
		const {container} = render(
			<SourceEditor
				brokenLinkNames={['Missing']}
				dynamicExtensions={[adaptedSyntax]}
				dynamicExtensionsKey="adapted"
				id="adapted-editor"
				label="Adapted editor"
				onChange={jest.fn()}
				replaceGenericTwineSyntax
				value={'(if: true)[shown]\n[[Missing]]'}
			/>
		);

		await waitFor(() =>
			expect(container.querySelector('.cm-adapted-syntax')).toBeInTheDocument()
		);
		expect(container.querySelector('.cm-twine-macro')).not.toBeInTheDocument();
		expect(container.querySelector('.cm-twine-link-broken')).toHaveTextContent(
			'[[Missing]]'
		);
		expect(
			container.querySelector('.cm-twine-diagnostic-line')
		).toBeInTheDocument();
	});
});
