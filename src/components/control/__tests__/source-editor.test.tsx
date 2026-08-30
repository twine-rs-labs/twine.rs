import {CompletionContext} from '@codemirror/autocomplete';
import {EditorState, StateField} from '@codemirror/state';
import {Decoration, EditorView, ViewPlugin} from '@codemirror/view';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import {
	passageCompletionSource,
	SourceEditor,
	type SourceEditorHandle
} from '../source-editor';

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

	it.each([
		{
			initialDocument: '[[Hal',
			name: 'an unclosed link'
		},
		{
			initialDocument: '[[Hal]]',
			name: 'a link with CM6-generated closing brackets'
		}
	])(
		'completes $name with the upstream closing suffix',
		async ({initialDocument}) => {
			const state = EditorState.create({
				doc: initialDocument,
				selection: {anchor: 5}
			});
			const view = new EditorView({state});
			const result = await passageCompletionSource(['Hallway'])(
				new CompletionContext(view.state, 5, true, view)
			);

			expect(result).not.toBeNull();
			const completion = result!.options[0];

			if (typeof completion.apply !== 'function') {
				throw new TypeError('Passage completion must define an apply action');
			}

			completion.apply(
				view,
				completion,
				result!.from,
				view.state.selection.main.head
			);
			expect(view.state.doc.toString()).toBe('[[Hallway]] ');
			expect(view.state.selection.main).toMatchObject({
				anchor: 12,
				head: 12
			});
			view.destroy();
		}
	);

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

	it('observes real CM6 composition events, gates admission, and retains final composition text after reopen', async () => {
		const editor = React.createRef<SourceEditorHandle>();
		const onChange = jest.fn();
		const {container} = render(
			<SourceEditor
				id="ime-editor"
				label="IME passage"
				onChange={onChange}
				ref={editor}
				value="start"
			/>
		);
		await waitFor(() => expect(editor.current).toBeTruthy());
		const content = container.querySelector('.cm-content')!;

		act(() => fireEvent.compositionStart(content, {data: ''}));
		expect(editor.current!.isCompositionActive!()).toBe(true);
		expect(editor.current!.isComposing!()).toBe(true);
		act(() => fireEvent.compositionUpdate(content, {data: '終'}));
		editor.current!.setInputAdmission!(false);
		expect(editor.current!.getSnapshot().document).toBe('start');
		editor.current!.setInputAdmission!(true);
		// jsdom does not apply browser IME DOM mutations to contenteditable; dispatch
		// the final editor transaction after reopening, as CM receives it in-browser.
		editor.current!.applyEdits([{from: 5, insert: '終', to: 5}]);
		act(() => fireEvent.compositionEnd(content, {data: '終'}));
		expect(editor.current!.isCompositionActive!()).toBe(false);
		expect(editor.current!.getSnapshot().document).toBe('start終');
		expect(onChange).toHaveBeenCalledWith('start終');
	});

	it('maps every selection through exact controlled edits without local echo and preserves undo/redo', async () => {
		const editor = React.createRef<SourceEditorHandle>();
		const onChange = jest.fn();
		render(
			<SourceEditor
				id="receipt-editor"
				label="Receipt passage"
				onChange={onChange}
				ref={editor}
				value="0123456789abcdefghij"
			/>
		);
		await waitFor(() => expect(editor.current).toBeTruthy());
		editor.current!.setSelections(
			[
				{anchor: 0, head: 1},
				{anchor: 3, head: 4},
				{anchor: 8, head: 11},
				{anchor: 18, head: 20}
			],
			2
		);
		editor.current!.applyAuthoritativeEdits([
			{from: 2, insert: 'XX', to: 4},
			{from: 10, insert: 'Q', to: 13}
		]);

		expect(editor.current!.getSnapshot()).toMatchObject({
			document: '01XX456789Qdefghij',
			mainSelectionIndex: 2,
			selections: [
				{anchor: 0, head: 1},
				{anchor: 4, head: 4},
				{anchor: 8, head: 10},
				{anchor: 16, head: 18}
			]
		});
		expect(onChange).not.toHaveBeenCalled();
		expect(editor.current!.runCommand('undo')).toBe(true);
		expect(editor.current!.getSnapshot().document).toBe('0123456789abcdefghij');
		expect(editor.current!.runCommand('redo')).toBe(true);
		expect(editor.current!.getSnapshot().document).toBe('01XX456789Qdefghij');
		expect(onChange).toHaveBeenNthCalledWith(1, '0123456789abcdefghij');
		expect(onChange).toHaveBeenNthCalledWith(2, '01XX456789Qdefghij');
	});

	it('rejects imperative and command edits while admission is closed but accepts authoritative receipts', async () => {
		const editor = React.createRef<SourceEditorHandle>();
		const onChange = jest.fn();
		render(
			<SourceEditor
				id="admission-editor"
				label="Admission"
				onChange={onChange}
				ref={editor}
				value="start"
			/>
		);
		await waitFor(() => expect(editor.current).toBeTruthy());
		editor.current!.setInputAdmission!(false);
		editor.current!.applyEdits([{from: 5, insert: ' blocked', to: 5}]);
		expect(editor.current!.runCommand('undo')).toBe(false);
		expect(editor.current!.getSnapshot().document).toBe('start');
		expect(onChange).not.toHaveBeenCalled();
		editor.current!.applyAuthoritativeEdits([
			{from: 5, insert: ' receipt', to: 5}
		]);
		expect(editor.current!.getSnapshot().document).toBe('start receipt');
		expect(onChange).not.toHaveBeenCalled();
		editor.current!.setInputAdmission!(true);
		editor.current!.applyEdits([{from: 13, insert: ' local', to: 13}]);
		expect(editor.current!.getSnapshot().document).toBe('start receipt local');
		expect(onChange).toHaveBeenCalledWith('start receipt local');
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
