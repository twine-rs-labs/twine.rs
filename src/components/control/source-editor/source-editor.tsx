import {
	Compartment,
	EditorState,
	Extension,
	RangeSetBuilder
} from '@codemirror/state';
import {
	defaultKeymap,
	history,
	historyKeymap,
	indentWithTab
} from '@codemirror/commands';
import {
	bracketMatching,
	foldGutter,
	foldKeymap,
	indentOnInput
} from '@codemirror/language';
import {
	autocompletion,
	closeBrackets,
	closeBracketsKeymap,
	CompletionContext
} from '@codemirror/autocomplete';
import {css} from '@codemirror/lang-css';
import {html} from '@codemirror/lang-html';
import {javascript} from '@codemirror/lang-javascript';
import {
	closeSearchPanel,
	highlightSelectionMatches,
	openSearchPanel,
	SearchQuery,
	searchKeymap,
	searchPanelOpen,
	setSearchQuery
} from '@codemirror/search';
import {
	Decoration,
	DecorationSet,
	drawSelection,
	EditorView,
	gutter,
	GutterMarker,
	highlightActiveLine,
	highlightActiveLineGutter,
	highlightSpecialChars,
	keymap,
	lineNumbers,
	placeholder,
	ViewPlugin,
	ViewUpdate
} from '@codemirror/view';
import * as React from 'react';
import type {CodeEditorThemePreference} from '../../../store/prefs';
import {usePrefsContext} from '../../../store/prefs';
import {useComputedTheme} from '../../../store/prefs/use-computed-theme';
import './source-editor.css';
import {sourceEditorThemeExtension} from './themes';

export type SourceEditorLanguage =
	| 'css'
	| 'html'
	| 'javascript'
	| 'text'
	| 'twine';

export interface SourceEditorProps {
	autocompletePassageNames?: string[];
	brokenLinkNames?: string[];
	id: string;
	label: string;
	language?: SourceEditorLanguage;
	memoryKey?: string;
	onChange: (value: string) => void;
	placeholderText?: string;
	readOnly?: boolean;
	revealPosition?: {key: number; position: number};
	searchQuery?: string;
	searchRequestKey?: number | string;
	selfLinkName?: string;
	value: string;
}

interface SourceEditorMemory {
	anchor?: number;
	head?: number;
	scrollLeft?: number;
	scrollTop?: number;
}

const languageCompartment = new Compartment();
const readOnlyCompartment = new Compartment();
const autocompleteCompartment = new Compartment();
const foldingCompartment = new Compartment();
const twineDecorationCompartment = new Compartment();
const wrappingCompartment = new Compartment();
const themeCompartment = new Compartment();
const diagnosticMarker = new (class extends GutterMarker {
	toDOM() {
		const marker = document.createElement('span');

		marker.className = 'cm-twine-diagnostic-marker';
		marker.textContent = '!';
		marker.title = 'Broken link';

		return marker;
	}
})();

function languageExtension(language: SourceEditorLanguage): Extension {
	switch (language) {
		case 'css':
			return css();
		case 'html':
			return html();
		case 'javascript':
			return javascript();
		case 'text':
		case 'twine':
			return [];
	}
}

function foldingExtension(language: SourceEditorLanguage): Extension {
	return language === 'css' || language === 'html' || language === 'javascript'
		? foldGutter()
		: [];
}

function loadMemory(memoryKey?: string): SourceEditorMemory {
	if (!memoryKey) {
		return {};
	}

	try {
		return JSON.parse(
			window.localStorage.getItem(`twine-source-editor-${memoryKey}`) ?? '{}'
		);
	} catch {
		return {};
	}
}

function saveMemory(memoryKey: string | undefined, memory: SourceEditorMemory) {
	if (!memoryKey) {
		return;
	}

	try {
		window.localStorage.setItem(
			`twine-source-editor-${memoryKey}`,
			JSON.stringify(memory)
		);
	} catch {
		// Memory is a convenience; storage failures should not block editing.
	}
}

function clampedMemoryPosition(value: unknown, docLength: number) {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return undefined;
	}

	return Math.max(0, Math.min(Math.trunc(value), docLength));
}

function selectionFromMemory(
	memory: SourceEditorMemory,
	doc: string
): {anchor: number; head: number} | undefined {
	const anchor = clampedMemoryPosition(memory.anchor, doc.length);
	const head = clampedMemoryPosition(memory.head, doc.length);

	return anchor !== undefined && head !== undefined
		? {anchor, head}
		: undefined;
}

function completionSource(passageNames: string[] = []) {
	return (context: CompletionContext) => {
		const match = context.matchBefore(/(?:\[\[|->|<-|\|)[^\]\n\r]*$/);

		if (!match || (match.from === context.pos && !context.explicit)) {
			return null;
		}

		const prefix =
			match.text.match(/(?:\[\[|->|<-|\|)([^\]\n\r]*)$/)?.[1] ?? '';

		return {
			from: context.pos - prefix.length,
			options: passageNames.map(name => ({label: name, type: 'text'}))
		};
	};
}

function targetFromLinkContent(content: string) {
	const editable = content.split('][')[0];

	if (editable.includes('->')) {
		return editable.split('->').pop()?.trim() ?? '';
	}

	if (editable.includes('<-')) {
		return editable.split('<-')[0].trim();
	}

	if (editable.includes('|')) {
		return editable.split('|').pop()?.trim() ?? '';
	}

	return editable.trim();
}

interface DecorationEntry {
	from: number;
	to: number;
	decoration: Decoration;
	line?: boolean;
}

interface LinkRange {
	from: number;
	to: number;
}

type TwineNestingToken = 'macro' | 'paren';

function rangeOverlaps(ranges: LinkRange[], from: number, to: number) {
	return ranges.some(range => from < range.to && to > range.from);
}

function rangeContaining(ranges: LinkRange[], position: number) {
	return ranges.find(range => position >= range.from && position < range.to);
}

function addTokenDecoration(
	entries: DecorationEntry[],
	className: string,
	from: number,
	to: number
) {
	if (from >= to) {
		return;
	}

	entries.push({
		decoration: Decoration.mark({class: className}),
		from,
		to
	});
}

function quotedStringEnd(text: string, from: number) {
	const quote = text[from];
	let escaped = false;

	for (let index = from + 1; index < text.length; index++) {
		if (escaped) {
			escaped = false;
		} else if (text[index] === '\\') {
			escaped = true;
		} else if (text[index] === quote) {
			return index + 1;
		}
	}

	return text.length;
}

function addCommentTokenDecorations(
	text: string,
	offset: number,
	entries: DecorationEntry[],
	linkRanges: LinkRange[],
	commentRanges: LinkRange[]
) {
	const lineCommentPattern = /(^|[\n\r])([ \t]*\/\/[^\n\r]*)/g;
	const blockCommentPattern = /\/%[\s\S]*?%\//g;
	let match: RegExpExecArray | null;

	while ((match = lineCommentPattern.exec(text))) {
		const absoluteFrom = offset + match.index + match[1].length;
		const absoluteTo = absoluteFrom + match[2].length;

		if (rangeOverlaps(linkRanges, absoluteFrom, absoluteTo)) {
			continue;
		}

		addTokenDecoration(entries, 'cm-twine-comment', absoluteFrom, absoluteTo);
		commentRanges.push({from: absoluteFrom, to: absoluteTo});
	}

	while ((match = blockCommentPattern.exec(text))) {
		const absoluteFrom = offset + match.index;
		const absoluteTo = absoluteFrom + match[0].length;

		if (rangeOverlaps(linkRanges, absoluteFrom, absoluteTo)) {
			continue;
		}

		addTokenDecoration(entries, 'cm-twine-comment', absoluteFrom, absoluteTo);
		commentRanges.push({from: absoluteFrom, to: absoluteTo});
	}
}

function addStringTokenDecorations(
	text: string,
	offset: number,
	entries: DecorationEntry[],
	blockedRanges: LinkRange[],
	stringRanges: LinkRange[]
) {
	let index = 0;

	while (index < text.length) {
		const absoluteFrom = offset + index;
		const blockedRange = rangeContaining(blockedRanges, absoluteFrom);

		if (blockedRange) {
			index = blockedRange.to - offset;
			continue;
		}

		if (text[index] !== '"' && text[index] !== "'") {
			index++;
			continue;
		}

		const absoluteTo = offset + quotedStringEnd(text, index);

		addTokenDecoration(entries, 'cm-twine-string', absoluteFrom, absoluteTo);
		stringRanges.push({from: absoluteFrom, to: absoluteTo});
		index = absoluteTo - offset;
	}
}

function harloweMacroOpenerLength(text: string, from: number) {
	return /^\([A-Za-z][\w-]*\s*:/.exec(text.slice(from))?.[0].length ?? 0;
}

function addHarloweTokenDecorations(
	text: string,
	offset: number,
	entries: DecorationEntry[],
	linkRanges: LinkRange[],
	stringRanges: LinkRange[]
) {
	const stack: TwineNestingToken[] = [];
	let index = 0;

	while (index < text.length) {
		const absoluteFrom = offset + index;

		if (rangeOverlaps(linkRanges, absoluteFrom, absoluteFrom + 1)) {
			index++;
			continue;
		}

		const stringRange = rangeContaining(stringRanges, absoluteFrom);

		if (stringRange) {
			index = stringRange.to - offset;
			continue;
		}

		const openerLength = harloweMacroOpenerLength(text, index);

		if (openerLength > 0) {
			addTokenDecoration(
				entries,
				'cm-twine-macro',
				absoluteFrom,
				absoluteFrom + openerLength
			);
			stack.push('macro');
			index += openerLength;
			continue;
		}

		if (stack.length > 0 && text[index] === '(') {
			stack.push('paren');
		} else if (stack.length > 0 && text[index] === ')') {
			if (stack.pop() === 'macro') {
				addTokenDecoration(
					entries,
					'cm-twine-macro',
					absoluteFrom,
					absoluteFrom + 1
				);
			}
		}

		index++;
	}
}

function sugarCubeMacroEnd(text: string, from: number) {
	let index = from + 2;

	while (index < text.length) {
		if (text[index] === '"' || text[index] === "'") {
			index = quotedStringEnd(text, index);
		} else if (text.startsWith('>>', index)) {
			return index + 2;
		} else {
			index++;
		}
	}

	return text.length;
}

function addSugarCubeTokenDecorations(
	text: string,
	offset: number,
	entries: DecorationEntry[],
	linkRanges: LinkRange[]
) {
	let index = 0;

	while (index < text.length) {
		if (!text.startsWith('<<', index)) {
			index++;
			continue;
		}

		const absoluteFrom = offset + index;

		if (rangeOverlaps(linkRanges, absoluteFrom, absoluteFrom + 2)) {
			index += 2;
			continue;
		}

		const macroEnd = sugarCubeMacroEnd(text, index);
		const macroText = text.slice(index, macroEnd);
		const openerLength =
			/^<<\s*\/?=?\s*[$A-Za-z_][\w$.-]*/.exec(macroText)?.[0].length ?? 2;

		addTokenDecoration(
			entries,
			'cm-twine-macro',
			absoluteFrom,
			absoluteFrom + openerLength
		);

		if (macroEnd - index >= 4) {
			addTokenDecoration(
				entries,
				'cm-twine-macro',
				offset + macroEnd - 2,
				offset + macroEnd
			);
		}

		index = macroEnd;
	}
}

function addSnowmanTokenDecorations(
	text: string,
	offset: number,
	entries: DecorationEntry[],
	linkRanges: LinkRange[]
) {
	const templatePattern = /<%[-=]?[\s\S]*?%>/g;
	let match: RegExpExecArray | null;

	while ((match = templatePattern.exec(text))) {
		const absoluteFrom = offset + match.index;
		const absoluteTo = absoluteFrom + match[0].length;

		if (rangeOverlaps(linkRanges, absoluteFrom, absoluteTo)) {
			continue;
		}

		const openerLength = /^<%[-=]?/.exec(match[0])?.[0].length ?? 2;

		addTokenDecoration(
			entries,
			'cm-twine-macro',
			absoluteFrom,
			absoluteFrom + openerLength
		);
		addTokenDecoration(entries, 'cm-twine-macro', absoluteTo - 2, absoluteTo);
	}
}

function addChapbookTokenDecorations(
	text: string,
	offset: number,
	entries: DecorationEntry[],
	linkRanges: LinkRange[]
) {
	const commandPattern =
		/\{\{[^}\n\r]*}}|\{\s*[A-Za-z][A-Za-z -]*(?::|\s)[^}\n\r]*}/g;
	let match: RegExpExecArray | null;

	while ((match = commandPattern.exec(text))) {
		const absoluteFrom = offset + match.index;
		const absoluteTo = absoluteFrom + match[0].length;

		if (rangeOverlaps(linkRanges, absoluteFrom, absoluteTo)) {
			continue;
		}

		const openerMatch = /^(?:\{\{|\{\s*[A-Za-z][A-Za-z -]*(?::|\s))/.exec(
			match[0]
		);
		const openerLength = openerMatch?.[0].length ?? 1;
		const closerLength = match[0].endsWith('}}') ? 2 : 1;

		addTokenDecoration(
			entries,
			'cm-twine-macro',
			absoluteFrom,
			absoluteFrom + openerLength
		);
		addTokenDecoration(
			entries,
			'cm-twine-macro',
			absoluteTo - closerLength,
			absoluteTo
		);
	}
}

function twineTokenDecorations(
	language: SourceEditorLanguage,
	brokenLinkNames: string[] = [],
	selfLinkName?: string
) {
	if (language !== 'twine') {
		return [];
	}

	const broken = new Set(brokenLinkNames);

	return [
		ViewPlugin.fromClass(
			class {
				decorations: DecorationSet;

				constructor(view: EditorView) {
					this.decorations = this.build(view);
				}

				update(update: ViewUpdate) {
					if (update.docChanged || update.viewportChanged) {
						this.decorations = this.build(update.view);
					}
				}

				build(view: EditorView) {
					const entries: DecorationEntry[] = [];
					const builder = new RangeSetBuilder<Decoration>();
					const linkRanges: LinkRange[] = [];
					const diagnosticLines = new Set<number>();

					for (const {from, to} of view.visibleRanges) {
						const text = view.state.doc.sliceString(from, to);
						const linkPattern = /\[\[(.*?)\]\]/g;
						const commentRanges: LinkRange[] = [];
						const stringRanges: LinkRange[] = [];
						let match: RegExpExecArray | null;

						while ((match = linkPattern.exec(text))) {
							const target = targetFromLinkContent(match[1]);
							const absoluteFrom = from + match.index;
							const absoluteTo = absoluteFrom + match[0].length;
							const line = view.state.doc.lineAt(absoluteFrom);
							const brokenLink = broken.has(target);
							const className =
								target === selfLinkName
									? 'cm-twine-link-self'
									: brokenLink
										? 'cm-twine-link-broken'
										: 'cm-twine-link';

							linkRanges.push({
								from: absoluteFrom,
								to: absoluteTo
							});
							entries.push({
								decoration: Decoration.mark({class: className}),
								from: absoluteFrom,
								to: absoluteTo
							});

							if (brokenLink && !diagnosticLines.has(line.from)) {
								diagnosticLines.add(line.from);
								entries.push({
									decoration: Decoration.line({
										class: 'cm-twine-diagnostic-line'
									}),
									from: line.from,
									line: true,
									to: line.from
								});
							}
						}

						addCommentTokenDecorations(
							text,
							from,
							entries,
							linkRanges,
							commentRanges
						);
						addStringTokenDecorations(
							text,
							from,
							entries,
							[...linkRanges, ...commentRanges],
							stringRanges
						);
						addHarloweTokenDecorations(
							text,
							from,
							entries,
							linkRanges,
							stringRanges
						);
						addSugarCubeTokenDecorations(text, from, entries, linkRanges);
						addSnowmanTokenDecorations(text, from, entries, linkRanges);
						addChapbookTokenDecorations(text, from, entries, linkRanges);

						const blockedRanges = [
							...linkRanges,
							...commentRanges,
							...stringRanges
						];
						const tokenPatterns: Array<{
							className: string;
							regexp: RegExp;
							tokenGroup?: number;
						}> = [
							{
								className: 'cm-twine-variable',
								regexp:
									/(^|[^A-Za-z0-9_])(\$[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*|_[A-Za-z_]\w*|\?[A-Za-z_]\w*|\|[A-Za-z_]\w*>)/g,
								tokenGroup: 2
							},
							{
								className: 'cm-twine-tag',
								regexp: /(^|[\s([,{])(#[-A-Za-z0-9_]+)/g,
								tokenGroup: 2
							}
						];

						for (const {className, regexp, tokenGroup} of tokenPatterns) {
							while ((match = regexp.exec(text))) {
								const token = tokenGroup ? match[tokenGroup] : match[0];
								const matchOffset = tokenGroup
									? match.index + match[0].lastIndexOf(token)
									: match.index + match[0].search(/\S/);
								const absoluteFrom = from + matchOffset;
								const absoluteTo = absoluteFrom + token.trimStart().length;

								if (
									absoluteFrom < absoluteTo &&
									!rangeOverlaps(blockedRanges, absoluteFrom, absoluteTo)
								) {
									entries.push({
										decoration: Decoration.mark({class: className}),
										from: absoluteFrom,
										to: absoluteTo
									});
								}
							}
						}
					}

					entries
						.sort(
							(left, right) =>
								left.from - right.from ||
								(left.line === right.line ? 0 : left.line ? -1 : 1) ||
								left.to - right.to
						)
						.forEach(entry =>
							builder.add(entry.from, entry.to, entry.decoration)
						);

					return builder.finish();
				}
			},
			{
				decorations: value => value.decorations
			}
		),
		gutter({
			class: 'cm-twine-diagnostic-gutter',
			initialSpacer: () => diagnosticMarker,
			markers: view => {
				const builder = new RangeSetBuilder<GutterMarker>();
				const lineStarts = new Set<number>();

				for (const {from, to} of view.visibleRanges) {
					const text = view.state.doc.sliceString(from, to);
					const linkPattern = /\[\[(.*?)\]\]/g;
					let match: RegExpExecArray | null;

					while ((match = linkPattern.exec(text))) {
						const target = targetFromLinkContent(match[1]);

						if (broken.has(target)) {
							const line = view.state.doc.lineAt(from + match.index);

							lineStarts.add(line.from);
						}
					}
				}

				Array.from(lineStarts)
					.sort((left, right) => left - right)
					.forEach(lineFrom => {
						builder.add(lineFrom, lineFrom, diagnosticMarker);
					});

				return builder.finish();
			}
		})
	];
}

function baseExtensions(
	props: SourceEditorProps,
	codeEditorTheme: CodeEditorThemePreference,
	appTheme: ReturnType<typeof useComputedTheme>
): Extension[] {
	return [
		lineNumbers(),
		highlightActiveLineGutter(),
		highlightSpecialChars(),
		history(),
		foldingCompartment.of(foldingExtension(props.language ?? 'twine')),
		drawSelection(),
		indentOnInput(),
		bracketMatching(),
		closeBrackets(),
		highlightActiveLine(),
		highlightSelectionMatches(),
		placeholder(props.placeholderText ?? ''),
		themeCompartment.of(sourceEditorThemeExtension(codeEditorTheme, appTheme)),
		autocompleteCompartment.of(
			autocompletion({
				override: [completionSource(props.autocompletePassageNames)]
			})
		),
		twineDecorationCompartment.of(
			twineTokenDecorations(
				props.language ?? 'twine',
				props.brokenLinkNames,
				props.selfLinkName
			)
		),
		keymap.of([
			indentWithTab,
			...defaultKeymap,
			...historyKeymap,
			...foldKeymap,
			...closeBracketsKeymap,
			...searchKeymap
		]),
		languageCompartment.of(languageExtension(props.language ?? 'twine')),
		readOnlyCompartment.of(EditorState.readOnly.of(props.readOnly ?? false)),
		wrappingCompartment.of(EditorView.lineWrapping)
	];
}

export const SourceEditor: React.FC<SourceEditorProps> = props => {
	const editorContainer = React.useRef<HTMLDivElement>(null);
	const viewRef = React.useRef<EditorView>();
	const onChange = React.useRef(props.onChange);
	const {prefs} = usePrefsContext();
	const appTheme = useComputedTheme();

	React.useEffect(() => {
		onChange.current = props.onChange;
	}, [props.onChange]);

	React.useEffect(() => {
		if (!editorContainer.current) {
			return;
		}

		const memory = loadMemory(props.memoryKey);
		const view = new EditorView({
			parent: editorContainer.current,
			state: EditorState.create({
				doc: props.value,
				selection: selectionFromMemory(memory, props.value),
				extensions: [
					...baseExtensions(props, prefs.codeEditorTheme, appTheme),
					EditorView.updateListener.of(update => {
						if (update.docChanged) {
							onChange.current(update.state.doc.toString());
						}

						if (update.docChanged || update.selectionSet) {
							saveMemory(props.memoryKey, {
								anchor: update.state.selection.main.anchor,
								head: update.state.selection.main.head,
								scrollLeft: update.view.scrollDOM.scrollLeft,
								scrollTop: update.view.scrollDOM.scrollTop
							});
						}
					}),
					EditorView.domEventHandlers({
						scroll: (_event, currentView) => {
							saveMemory(props.memoryKey, {
								anchor: currentView.state.selection.main.anchor,
								head: currentView.state.selection.main.head,
								scrollLeft: currentView.scrollDOM.scrollLeft,
								scrollTop: currentView.scrollDOM.scrollTop
							});
						}
					})
				]
			})
		});

		viewRef.current = view;
		window.requestAnimationFrame(() => {
			view.scrollDOM.scrollTo({
				left: memory.scrollLeft ?? 0,
				top: memory.scrollTop ?? 0
			});
			view.focus();
		});

		return () => {
			view.destroy();
			viewRef.current = undefined;
		};
		// The editor must be recreated when the memory key changes to restore the
		// correct selection for a newly selected passage.
	}, [props.memoryKey]);

	React.useEffect(() => {
		const view = viewRef.current;

		view?.dispatch({
			effects: themeCompartment.reconfigure(
				sourceEditorThemeExtension(prefs.codeEditorTheme, appTheme)
			)
		});
	}, [appTheme, prefs.codeEditorTheme]);

	React.useEffect(() => {
		const view = viewRef.current;

		if (!view || view.state.doc.toString() === props.value) {
			return;
		}

		view.dispatch({
			changes: {from: 0, to: view.state.doc.length, insert: props.value}
		});
	}, [props.value]);

	React.useEffect(() => {
		const view = viewRef.current;

		view?.dispatch({
			effects: [
				languageCompartment.reconfigure(
					languageExtension(props.language ?? 'twine')
				),
				foldingCompartment.reconfigure(
					foldingExtension(props.language ?? 'twine')
				)
			]
		});
	}, [props.language]);

	React.useEffect(() => {
		const view = viewRef.current;

		view?.dispatch({
			effects: readOnlyCompartment.reconfigure(
				EditorState.readOnly.of(props.readOnly ?? false)
			)
		});
	}, [props.readOnly]);

	React.useEffect(() => {
		const view = viewRef.current;

		view?.dispatch({
			effects: autocompleteCompartment.reconfigure(
				autocompletion({
					override: [completionSource(props.autocompletePassageNames)]
				})
			)
		});
	}, [props.autocompletePassageNames]);

	React.useEffect(() => {
		const view = viewRef.current;

		view?.dispatch({
			effects: twineDecorationCompartment.reconfigure(
				twineTokenDecorations(
					props.language ?? 'twine',
					props.brokenLinkNames,
					props.selfLinkName
				)
			)
		});
	}, [props.brokenLinkNames, props.language, props.selfLinkName]);

	React.useEffect(() => {
		const view = viewRef.current;

		if (!view || !props.searchRequestKey) {
			return;
		}

		if (props.searchQuery !== undefined) {
			view.dispatch({
				effects: setSearchQuery.of(
					new SearchQuery({
						search: props.searchQuery
					})
				)
			});
			openSearchPanel(view);
		} else if (searchPanelOpen(view.state)) {
			closeSearchPanel(view);
		} else {
			openSearchPanel(view);
		}

		view.focus();
	}, [props.searchQuery, props.searchRequestKey]);

	React.useEffect(() => {
		const view = viewRef.current;
		const position = props.revealPosition?.position;

		if (!view || position === undefined) {
			return;
		}

		const clampedPosition = Math.max(
			0,
			Math.min(Math.trunc(position), view.state.doc.length)
		);

		view.dispatch({
			effects: EditorView.scrollIntoView(clampedPosition, {
				y: 'center'
			}),
			selection: {anchor: clampedPosition}
		});
		view.focus();
	}, [props.revealPosition?.key, props.revealPosition?.position]);

	return (
		<div className="source-editor">
			<label className="screen-reader-only" htmlFor={props.id}>
				{props.label}
			</label>
			<div
				aria-label={props.label}
				data-testid={props.id}
				id={props.id}
				ref={editorContainer}
				role="textbox"
			/>
		</div>
	);
};
