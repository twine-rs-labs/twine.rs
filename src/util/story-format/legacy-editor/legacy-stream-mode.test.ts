import {
	ensureSyntaxTree,
	HighlightStyle,
	syntaxTree
} from '@codemirror/language';
import {EditorState} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {highlightTree, tags} from '@lezer/highlight';
import {
	createLegacyStreamDocumentService,
	createLegacyStreamModeAdapter,
	createLegacyStreamModeAdapterRecipe,
	legacyCustomTokenClasses,
	LegacyStreamModeFailure
} from './legacy-stream-mode';

const standardHighlighter = HighlightStyle.define([
	{tag: tags.keyword, class: 'keyword'},
	{tag: tags.definition(tags.variableName), class: 'definition'},
	{tag: tags.link, class: 'link'},
	{tag: tags.punctuation, class: 'punctuation'}
]);

function parse(
	document: string,
	extension: ReturnType<typeof createLegacyStreamModeAdapter>['extension']
) {
	const state = EditorState.create({doc: document, extensions: [extension]});

	expect(ensureSyntaxTree(state, state.doc.length, 1000)).not.toBeNull();
	return state;
}

function highlightedClasses(
	state: EditorState,
	highlighter = standardHighlighter
) {
	const result: {classes: string; from: number; to: number}[] = [];

	highlightTree(syntaxTree(state), highlighter, (from, to, classes) => {
		result.push({classes, from, to});
	});

	return result;
}

describe('createLegacyStreamModeAdapter()', () => {
	it('supplies minimal config and the supported StringStream methods', () => {
		const document = '\tab cc z';
		const adapter = createLegacyStreamModeAdapter(
			config => {
				expect(config).toEqual({indentUnit: 3, tabSize: 8});
				expect(Object.isFrozen(config)).toBe(true);

				return {
					token(stream) {
						expect(stream.sol()).toBe(true);
						expect(stream.eol()).toBe(false);
						expect(stream.indentation()).toBe(4);
						expect(stream.column()).toBe(0);
						expect(stream.peek()).toBe('\t');
						expect(stream.next()).toBe('\t');
						stream.backUp(1);
						expect(stream.eat(/\s/)).toBe('\t');
						expect(stream.match('ab')).toBe(true);
						expect(stream.eatSpace()).toBe(true);
						expect(stream.eatWhile('c')).toBe(true);
						expect(stream.skipTo('z')).toBe(true);
						expect(stream.current()).toBe('\tab cc ');
						stream.skipToEnd();
						expect(stream.eol()).toBe(true);
						return 'keyword';
					}
				};
			},
			{
				config: {indentUnit: 3, tabSize: 8},
				documentService: createLegacyStreamDocumentService(document)
			}
		);

		parse(document, adapter.extension);
		expect(adapter.failure).toBeUndefined();
	});

	it('preserves start, copy, and blank-line state semantics', () => {
		let copyCalls = 0;
		let blankLineCalls = 0;
		const document = `first\n\n${'next\n'.repeat(150)}last`;
		const adapter = createLegacyStreamModeAdapter(
			() => ({
				startState: () => ({blankLines: [] as number[]}),
				copyState: state => {
					copyCalls++;
					return {blankLines: state.blankLines.slice()};
				},
				blankLine: state => {
					blankLineCalls++;
					state.blankLines.push(blankLineCalls);
				},
				token(stream, state) {
					stream.skipToEnd();
					return state.blankLines.length ? 'keyword' : null;
				}
			}),
			{
				documentService: createLegacyStreamDocumentService(document)
			}
		);
		const state = parse(document, adapter.extension);

		expect(blankLineCalls).toBeGreaterThan(0);
		expect(copyCalls).toBeGreaterThan(0);
		expect(highlightedClasses(state)).toEqual(
			expect.arrayContaining([expect.objectContaining({classes: 'keyword'})])
		);
		expect(adapter.failure).toBeUndefined();
	});

	it('implements per-instance lookAhead and refreshes document snapshots', () => {
		let document = 'name: Alex\n--\nHello';
		const service = createLegacyStreamDocumentService(document);
		const adapter = createLegacyStreamModeAdapter(
			() => ({
				startState: () => ({inVariables: false, scanned: false}),
				token(stream, state) {
					if (!state.scanned) {
						state.scanned = true;

						for (let offset = 1; stream.lookAhead(offset); offset++) {
							if (stream.lookAhead(offset) === '--') {
								state.inVariables = true;
								break;
							}
						}
					}

					if (state.inVariables && stream.sol()) {
						if (stream.match(/^--$/)) {
							state.inVariables = false;
							return 'punctuation';
						}

						if (stream.skipTo(':')) {
							stream.next();
							return 'def';
						}
					}

					stream.skipToEnd();
					return 'text';
				}
			}),
			{documentService: service}
		);

		expect(highlightedClasses(parse(document, adapter.extension))).toEqual(
			expect.arrayContaining([
				{classes: 'definition', from: 0, to: 5},
				{classes: 'punctuation', from: 11, to: 13}
			])
		);

		document = 'name: Alex\nHello';
		service.replaceDocument(document);
		expect(highlightedClasses(parse(document, adapter.extension))).toEqual([]);
		service.dispose();
		expect(service.line(0)).toBeUndefined();
		expect(adapter.failure).toBeUndefined();
	});

	it('makes the globally retained stream parser inert when disposed', () => {
		const document = 'first\nsecond';
		const service = createLegacyStreamDocumentService(document);
		const token = jest.fn((stream: any) => {
			stream.lookAhead(1);
			stream.skipToEnd();
			return 'keyword';
		});
		const onFailure = jest.fn();
		const adapter = createLegacyStreamModeAdapter(() => ({token}), {
			documentService: service,
			onFailure
		});

		parse(document, adapter.extension);
		const callsBeforeDispose = token.mock.calls.length;

		expect(callsBeforeDispose).toBeGreaterThan(0);
		adapter.dispose();
		adapter.dispose();
		expect(() => parse(document, adapter.extension)).not.toThrow();
		expect(token).toHaveBeenCalledTimes(callsBeforeDispose);
		expect(onFailure).not.toHaveBeenCalled();
	});

	it('explicitly preserves a built lookAhead snapshot without rebuilding', () => {
		const rebuilt = jest.fn();
		const service = createLegacyStreamDocumentService('first\nsecond\nthird', {
			onLineIndexRebuild: rebuilt
		});

		expect(service.line(1)).toBe('second');
		expect(service.metrics()).toEqual({
			lineIndexInvalidations: 0,
			lineIndexRebuilds: 1,
			preservedLookAheadSnapshots: 0
		});
		service.preserveLookAheadSnapshot();
		expect(service.line(1)).toBe('second');
		expect(service.line(2)).toBe('third');
		expect(service.metrics()).toEqual({
			lineIndexInvalidations: 0,
			lineIndexRebuilds: 1,
			preservedLookAheadSnapshots: 1
		});
		expect(rebuilt).toHaveBeenCalledTimes(1);
	});

	it('replaces and invalidates the lookAhead snapshot explicitly', () => {
		const service = createLegacyStreamDocumentService('one\n--\nfour');

		expect(service.line(1)).toBe('--');
		service.replaceDocument('one\nfour');
		expect(service.line(1)).toBe('four');
		expect(service.line(2)).toBeUndefined();
		expect(service.metrics()).toEqual({
			lineIndexInvalidations: 1,
			lineIndexRebuilds: 2,
			preservedLookAheadSnapshots: 0
		});
	});

	it('keeps conservative replacements current for custom modes', () => {
		const service = createLegacyStreamDocumentService('one\ntwo');

		expect(service.line(1)).toBe('two');
		service.replaceDocument('one\nchanged');
		expect(service.metrics().lineIndexInvalidations).toBe(1);
		expect(service.line(1)).toBe('changed');
		expect(service.metrics().lineIndexRebuilds).toBe(2);
	});

	it('maps standard multi-token names and approved custom tokens', () => {
		const document = 'standard\ncustom';
		const adapter = createLegacyStreamModeAdapter(
			() => ({
				token(stream) {
					const custom = stream.lookAhead(0) === 'custom';

					stream.skipToEnd();
					return custom ? 'format-widget' : 'keyword link';
				}
			}),
			{
				customTokenMap: {'format-widget': 'format-primary'},
				documentService: createLegacyStreamDocumentService(document)
			}
		);
		const state = parse(document, adapter.extension);
		const standard = highlightedClasses(state);
		const parent = globalThis.document.createElement('div');
		const view = new EditorView({
			doc: document,
			extensions: adapter.extension,
			parent
		});

		expect(standard[0]).toMatchObject({
			classes: 'keyword link',
			from: 0,
			to: 8
		});
		expect(legacyCustomTokenClasses['format-primary']).toBe(
			'cm-twine-legacy-format-primary'
		);
		expect(
			parent.querySelector('.cm-twine-legacy-format-primary')?.textContent
		).toBe('custom');
		expect(adapter.failure).toBeUndefined();
		view.destroy();
	});

	it.each([
		{
			expectedKind: 'zero-advance',
			mode: () => ({token: () => 'keyword'})
		},
		{
			expectedKind: 'exception',
			mode: () => ({
				token: () => {
					throw new Error('bad mode');
				}
			})
		},
		{
			expectedKind: 'unsupported-api',
			mode: () => ({
				token: (stream: any) => {
					stream.hideFirstChars();
					return null;
				}
			})
		},
		{
			expectedKind: 'invalid-token',
			mode: () => ({
				token: (stream: any) => {
					stream.skipToEnd();
					return 'format-injected-class';
				}
			})
		}
	])(
		'fails closed once for $expectedKind',
		({expectedKind, mode}: {expectedKind: string; mode: () => any}) => {
			const failures: LegacyStreamModeFailure[] = [];
			const document = 'one\ntwo\nthree';
			const adapter = createLegacyStreamModeAdapter(mode, {
				documentService: createLegacyStreamDocumentService(document),
				onFailure: failure => failures.push(failure)
			});
			const state = parse(document, adapter.extension);

			expect(syntaxTree(state).length).toBe(document.length);
			expect(highlightedClasses(state)).toEqual([]);
			expect(failures).toHaveLength(1);
			expect(failures[0].kind).toBe(expectedKind);
			expect(adapter.failure).toBe(failures[0]);
		}
	);

	it('contains mode factory, state lifecycle, and diagnostic callback errors', () => {
		const callback = jest.fn(() => {
			throw new Error('diagnostic failed');
		});
		const document = 'safe';
		const adapter = createLegacyStreamModeAdapter(
			() => {
				throw new Error('factory failed');
			},
			{
				documentService: createLegacyStreamDocumentService(document),
				onFailure: callback
			}
		);

		expect(() => parse(document, adapter.extension)).not.toThrow();
		expect(callback).toHaveBeenCalledTimes(1);
		expect(adapter.failure).toMatchObject({
			kind: 'exception',
			phase: 'mode-factory'
		});
	});

	it('shares one language recipe without sharing mode or document state', () => {
		const firstDocument = 'first';
		const secondDocument = 'second';
		const states: object[] = [];
		const factory = () => ({
			startState: () => {
				const state = {calls: 0};

				states.push(state);
				return state;
			},
			token(stream: any, state: {calls: number}) {
				state.calls++;
				const line = stream.lookAhead(0);

				stream.skipToEnd();
				return line === 'first' ? 'keyword' : 'link';
			}
		});
		const recipe = createLegacyStreamModeAdapterRecipe(factory);
		const first = recipe.create({
			documentService: createLegacyStreamDocumentService(firstDocument)
		});
		const second = recipe.create({
			documentService: createLegacyStreamDocumentService(secondDocument)
		});

		expect(first.language).toBe(second.language);
		expect(
			highlightedClasses(parse(firstDocument, first.extension))[0].classes
		).toBe('keyword');
		expect(
			highlightedClasses(parse(secondDocument, second.extension))[0].classes
		).toBe('link');
		expect(states).toHaveLength(2);
		expect(states[0]).not.toBe(states[1]);
		expect(first.failure).toBeUndefined();
		expect(second.failure).toBeUndefined();
	});
});
