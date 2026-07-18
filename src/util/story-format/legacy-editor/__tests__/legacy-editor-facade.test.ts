import type {
	SourceEditorEdit,
	SourceEditorHandle,
	SourceEditorSelection,
	SourceEditorSnapshot
} from '../../../../components/control/source-editor/source-editor';
import {
	createLegacyEditorFacade,
	createReadOnlyLegacyEditorFacade,
	UnsupportedLegacyEditorApiError
} from '../legacy-editor-facade';

function fakeHandle(snapshot: SourceEditorSnapshot): SourceEditorHandle {
	return {
		applyEdits: jest.fn(),
		focus: jest.fn(),
		getSnapshot: jest.fn(() => snapshot),
		isAlive: jest.fn(() => true),
		runCommand: jest.fn(),
		setSelections: jest.fn(),
		subscribe: jest.fn(() => jest.fn()),
		subscribeDocumentChanges: jest.fn(() => jest.fn())
	};
}

function snapshot(
	document: string,
	selections: SourceEditorSelection[] = [{anchor: 0, head: 0}],
	mainSelectionIndex = 0
): SourceEditorSnapshot {
	return {
		canRedo: false,
		canUndo: false,
		document,
		mainSelectionIndex,
		selections
	};
}

describe('legacy editor facade', () => {
	it('reads documents and ranges using UTF-16 CodeMirror positions', () => {
		const handle = fakeHandle(snapshot('A😀\nβZ'));
		const editor = createLegacyEditorFacade(handle);

		expect(editor.getValue()).toBe('A😀\nβZ');
		expect(editor.getRange({line: 0, ch: 1}, {line: 0, ch: 3})).toBe('😀');
		expect(editor.indexFromPos({line: 1, ch: 1})).toBe(5);
		expect(editor.posFromIndex(3)).toEqual({line: 0, ch: 3});
	});

	it('clips positions like CodeMirror 5', () => {
		const editor = createLegacyEditorFacade(
			fakeHandle(snapshot('first\nlast'))
		);

		expect(editor.indexFromPos({line: -10, ch: 4})).toBe(0);
		expect(editor.indexFromPos({line: 0, ch: 100})).toBe(5);
		expect(editor.indexFromPos({line: 100, ch: 0})).toBe(10);
		expect(editor.posFromIndex(-20)).toEqual({line: 0, ch: 0});
		expect(editor.posFromIndex(100)).toEqual({line: 1, ch: 4});
	});

	it('reports the main selection and cursor variants', () => {
		const handle = fakeHandle(
			snapshot(
				'zero one two',
				[
					{anchor: 0, head: 4},
					{anchor: 12, head: 9}
				],
				1
			)
		);
		const editor = createLegacyEditorFacade(handle);

		expect(editor.getSelections()).toEqual(['zero', 'two']);
		expect(editor.getSelection()).toBe('zero\ntwo');
		expect(editor.somethingSelected()).toBe(true);
		expect(editor.getCursor()).toEqual({line: 0, ch: 9});
		expect(editor.getCursor('anchor')).toEqual({line: 0, ch: 12});
		expect(editor.getCursor('start')).toEqual({line: 0, ch: 9});
		expect(editor.getCursor('end')).toEqual({line: 0, ch: 12});
	});

	it('replaces a range through the controlled handle', () => {
		const handle = fakeHandle(snapshot('first\nlast'));
		const editor = createLegacyEditorFacade(handle);

		editor.replaceRange('middle', {line: 1, ch: 2}, {line: 0, ch: 2});

		expect(handle.applyEdits).toHaveBeenCalledWith([
			{from: 2, insert: 'middle', to: 8}
		]);
	});

	it('replaces every selection in one coherent transaction', () => {
		const handle = fakeHandle(
			snapshot(
				'one two three',
				[
					{anchor: 0, head: 3},
					{anchor: 13, head: 8}
				],
				1
			)
		);
		const editor = createLegacyEditorFacade(handle);

		editor.replaceSelections(['1', '333'], 'around');

		expect(handle.applyEdits).toHaveBeenCalledWith(
			[
				{from: 0, insert: '1', to: 3},
				{from: 8, insert: '333', to: 13}
			],
			[
				{anchor: 0, head: 1},
				{anchor: 9, head: 6}
			],
			1
		);
	});

	it.each([
		{
			collapse: undefined,
			expected: [
				{anchor: 1, head: 1},
				{anchor: 3, head: 3}
			]
		},
		{
			collapse: 'end' as const,
			expected: [
				{anchor: 1, head: 1},
				{anchor: 3, head: 3}
			]
		},
		{
			collapse: 'start' as const,
			expected: [
				{anchor: 0, head: 0},
				{anchor: 2, head: 2}
			]
		}
	])(
		'uses CodeMirror 5 $collapse collapse behavior',
		({collapse, expected}) => {
			const handle = fakeHandle(
				snapshot('one two', [
					{anchor: 0, head: 3},
					{anchor: 4, head: 7}
				])
			);
			const editor = createLegacyEditorFacade(handle);

			editor.replaceSelection('x', collapse);

			expect(handle.applyEdits).toHaveBeenCalledWith(
				expect.any(Array) as SourceEditorEdit[],
				expected,
				0
			);
		}
	);

	it('requires one replacement for every selection', () => {
		const editor = createLegacyEditorFacade(
			fakeHandle(
				snapshot('one two', [
					{anchor: 0, head: 3},
					{anchor: 4, head: 7}
				])
			)
		);

		expect(() => editor.replaceSelections(['only one'])).toThrow(RangeError);
	});

	it('sets clipped cursors and delegates focus', () => {
		const handle = fakeHandle(snapshot('first\nlast'));
		const editor = createLegacyEditorFacade(handle);

		editor.setCursor(1, 100);
		editor.focus();

		expect(handle.setSelections).toHaveBeenCalledWith([{anchor: 10, head: 10}]);
		expect(handle.focus).toHaveBeenCalledTimes(1);
	});

	it('returns a bounded document facade from getDoc()', () => {
		const editor = createLegacyEditorFacade(fakeHandle(snapshot('text')));
		const documentFacade = editor.getDoc();

		expect(documentFacade.getValue()).toBe('text');
		expect(
			() => (documentFacade as unknown as Record<string, unknown>).getDoc
		).toThrow(UnsupportedLegacyEditorApiError);
	});

	it('throws a typed error for unsupported property access and mutation', () => {
		const editor = createLegacyEditorFacade(fakeHandle(snapshot('text')));

		expect(
			() => (editor as unknown as Record<string, unknown>).display
		).toThrow(
			expect.objectContaining({
				access: 'get',
				apiName: 'display',
				readOnly: false
			})
		);
		expect(
			() => ((editor as unknown as Record<string, unknown>).state = {})
		).toThrow(
			expect.objectContaining({
				access: 'set',
				apiName: 'state'
			})
		);
	});

	it('exposes only state reads to toolbar factories', () => {
		const editor = createReadOnlyLegacyEditorFacade(
			fakeHandle(snapshot('selected', [{anchor: 0, head: 8}]))
		);

		expect(editor.getSelection()).toBe('selected');
		expect(editor.getDoc()).not.toBe(editor);
		expect(
			() => (editor as unknown as Record<string, unknown>).replaceSelection
		).toThrow(
			expect.objectContaining({
				apiName: 'replaceSelection',
				readOnly: true
			})
		);
		expect(
			() => (editor.getDoc() as unknown as Record<string, unknown>).getDoc
		).toThrow(UnsupportedLegacyEditorApiError);
	});
});
