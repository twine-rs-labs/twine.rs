import type {
	Completion,
	CompletionContext,
	CompletionResult
} from '@codemirror/autocomplete';
import {EditorSelection, type Extension, Prec} from '@codemirror/state';
import {
	Decoration,
	type DecorationSet,
	EditorView,
	keymap,
	showTooltip,
	type Tooltip,
	ViewPlugin,
	type ViewUpdate
} from '@codemirror/view';
import type {
	NativeEditorProvider,
	NativeEditorSessionContext
} from '../native-editor/types';
import {HarloweEditorController} from './editor-controller';
import {HarloweToolbar} from './harlowe-toolbar';
import {
	harloweHookNameRange,
	harloweMacroDefinitions,
	harloweMacroDefinitionsByName,
	harloweTokenAt,
	insensitiveHarloweName,
	parseHarloweDocument,
	type HarloweToken,
	type ParsedHarloweDocument
} from './parser';
import './harlowe-editor.css';

interface HarloweKeyword {
	detail: string;
	label: string;
	tokenType: string;
}

function keywordGroup(
	names: string,
	tokenType: string,
	detail: string
): HarloweKeyword[] {
	return names.split(',').map(label => ({detail, label, tokenType}));
}

// This is the exact completion vocabulary exposed by Harlowe 3.3.9's CM5
// Tooltips module. Keep it dialect-local: future Harlowe versions may add or
// remove identifiers, datatypes, colours, and operators.
const harloweKeywords: HarloweKeyword[] = [
	...keywordGroup(
		'exit,exits,it,pos,time,turn,turns,visit,visits',
		'identifier',
		'Harlowe identifier'
	),
	...keywordGroup('where,when,each,via,making', 'lambda', 'lambda keyword'),
	...keywordGroup(
		'number,num,string,str,boolean,bool,array,datamap,dm,dataset,ds,command,changer,color,colour,gradient,lambda,macro,datatype,codehook',
		'datatype',
		'datatype'
	),
	...keywordGroup(
		'even,odd,integer,int,empty,whitespace,lowercase,uppercase,anycase,alphanumeric,alnum,digit,linebreak,newline,const,any',
		'datatype',
		'specific datatype'
	),
	...keywordGroup(
		'red,orange,yellow,lime,green,cyan,aqua,blue,navy,purple,fuchsia,magenta,white,gray,grey,black,transparent',
		'colour',
		'colour'
	),
	...keywordGroup(
		'is,is not,contains,does not contain,is in,is not in,is a,is not a,matches,does not match,and,or,not',
		'boolean',
		'boolean operator'
	),
	...keywordGroup('to,into,bind,2bind,-type', 'operator', 'operator'),
	{detail: 'boolean', label: 'true', tokenType: 'boolean'},
	{detail: 'boolean', label: 'false', tokenType: 'boolean'}
];

const keywordHelp: Record<string, string> = {
	and: 'Combines two boolean conditions.',
	bind: 'Binds a variable so a command can update it.',
	contains: 'Tests whether a data value contains another value.',
	each: 'Creates a lambda that operates on each value.',
	into: 'Places the value on the left into the variable on the right.',
	is: 'Tests two values for equality.',
	it: 'Refers to the value most recently compared in this expression.',
	making: 'Names an accumulator variable in a lambda.',
	matches: 'Tests whether values match a datatype or pattern.',
	not: 'Negates the boolean value to its right.',
	or: 'Produces true when either boolean condition is true.',
	to: 'Pairs a destination variable with a value in assignment macros.',
	via: 'Supplies the transformation expression for a lambda.',
	when: 'Supplies a condition that must become true.',
	where: 'Filters values using a lambda condition.'
};

const macroCompletionDefinitions = Object.values(
	harloweMacroDefinitions
).reduce<
	Array<{definition: (typeof harloweMacroDefinitions)[string]; name: string}>
>((result, definition) => {
	if (result.some(item => item.definition.name === definition.name)) {
		return result;
	}

	result.push({definition, name: definition.name});
	for (const name of definition.aka) {
		result.push({definition, name});
	}
	return result;
}, []);

const macroCompletions: Completion[] = macroCompletionDefinitions.map(
	({definition, name}) => ({
		apply(view, _completion, from, to) {
			const insert = `${name}:)`;

			view.dispatch({
				changes: {from, insert, to},
				selection: {anchor: from + insert.length - 1}
			});
		},
		detail: `→ ${definition.returnType}`,
		info: definition.abstract,
		label: name,
		type: 'function'
	})
);

const keywordCompletions: Completion[] = harloweKeywords.map(
	({detail, label, tokenType}) => ({
		detail,
		info: keywordHelp[label] ?? `Harlowe ${detail}.`,
		label,
		type: tokenType === 'colour' ? 'color' : 'keyword'
	})
);

const structureHelp: Record<string, string> = {
	addition: 'Adds numeric values or joins compatible data values.',
	boolean: 'A Boolean value: either true or false.',
	collapsed: 'Collapsing markup removes most whitespace when the passage runs.',
	colour: 'A built-in Harlowe colour value.',
	comment: 'An HTML comment. Its contents are not displayed in the story.',
	datatype: 'A datatype value used for checking or constraining other values.',
	division:
		'Divides two numbers, or computes a remainder when written as modulo.',
	escapedLine: 'A line-break escape joins the prose on either side of it.',
	heading:
		'Heading markup. More leading # characters produce a smaller heading.',
	hook: 'A hook is a section of passage prose that changers can affect.',
	hookName: 'A hook name refers to named hooks using the ?name syntax.',
	hr: 'A horizontal rule.',
	identifier: 'A built-in Harlowe identifier.',
	multiplication: 'Multiplies two numbers.',
	number: 'A numeric data value.',
	property: 'A data-name or position used to access part of another value.',
	string: 'A string data value.',
	tempVariable: 'A temporary variable, scoped to the current passage or hook.',
	twineLink: 'A passage link.',
	variable: 'A story variable whose value persists across turns.',
	verbatim: 'Verbatim markup displays its contents without interpreting markup.'
};

function nativeClassName(className: string) {
	return className
		.split(/\s+/)
		.filter(Boolean)
		.map(name => `cm-${name}`)
		.join(' ');
}

function sameReference(left: HarloweToken, right: HarloweToken) {
	return left !== right && left.name === right.name;
}

function cursorDecorations(parsed: ParsedHarloweDocument, position: number) {
	const decorations: Array<{
		decoration: Decoration;
		from: number;
		to: number;
	}> = [];
	const token = harloweTokenAt(parsed, position);

	if (!token || token.start >= token.end) {
		return decorations;
	}

	decorations.push({
		decoration: Decoration.mark({class: 'cm-harlowe-3-cursor'}),
		from: token.start,
		to: token.end
	});

	if (
		token.type === 'variable' ||
		token.type === 'tempVariable' ||
		token.type === 'hookName' ||
		token.type === 'hook'
	) {
		const referenceType = token.type === 'hook' ? 'hookName' : token.type;
		const references =
			parsed.referenceTokens[
				referenceType as 'hookName' | 'tempVariable' | 'variable'
			];

		for (const reference of references) {
			if (sameReference(reference, token)) {
				decorations.push({
					decoration: Decoration.mark({
						class: 'cm-harlowe-3-variableOccurrence'
					}),
					from: reference.start,
					to: reference.end
				});
			}
		}
	}

	if ((token.type === 'hookName' || token.type === 'hook') && token.name) {
		for (const hook of parsed.referenceTokens.hook) {
			if (!sameReference(hook, token)) {
				continue;
			}

			const range = harloweHookNameRange(hook);

			if (range) {
				decorations.push({
					decoration: Decoration.mark({
						class: 'cm-harlowe-3-hookOccurrence'
					}),
					...range
				});
			}
		}
	}

	return decorations;
}

function buildDecorations(
	parsed: ParsedHarloweDocument,
	view: EditorView
): DecorationSet {
	const entries = parsed.styleRanges.map(range => ({
		decoration: Decoration.mark({
			attributes: range.colour
				? {
						style: `background:linear-gradient(to bottom,transparent,transparent 80%,${range.colour} 80.1%,${range.colour})`
					}
				: undefined,
			class: nativeClassName(range.className)
		}),
		from: range.from,
		to: range.to
	}));

	for (const range of view.state.selection.ranges) {
		entries.push(
			...cursorDecorations(parsed, range.head).map(entry => ({
				...entry
			}))
		);
	}

	return Decoration.set(
		entries.map(entry => entry.decoration.range(entry.from, entry.to)),
		true
	);
}

function syntaxDecorations(context: NativeEditorSessionContext): Extension {
	const passageNames = [...context.passageNames];
	const tagNames = [...context.tagNames];

	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			parsed: ParsedHarloweDocument;

			constructor(view: EditorView) {
				this.parsed = parseHarloweDocument(
					view.state.doc.toString(),
					passageNames,
					tagNames
				);
				this.decorations = buildDecorations(this.parsed, view);
			}

			update(update: ViewUpdate) {
				if (update.docChanged) {
					this.parsed = parseHarloweDocument(
						update.state.doc.toString(),
						passageNames,
						tagNames
					);
				}

				if (update.docChanged || update.selectionSet) {
					this.decorations = buildDecorations(this.parsed, update.view);
				}
			}
		},
		{
			decorations: instance => instance.decorations
		}
	);
}

function wrapSelectionCommand(
	before: string,
	after: string,
	placeholder: string
) {
	return (view: EditorView) => {
		view.dispatch(
			view.state.changeByRange(range => {
				const selected = view.state.sliceDoc(range.from, range.to);
				const inner = selected || placeholder;

				return {
					changes: {
						from: range.from,
						insert: `${before}${inner}${after}`,
						to: range.to
					},
					range: EditorSelection.range(
						range.from + before.length,
						range.from + before.length + inner.length
					)
				};
			})
		);
		return true;
	};
}

function shortcutExtension(controller: HarloweEditorController): Extension {
	return Prec.high(
		keymap.of([
			{
				key: 'Mod-b',
				run: wrapSelectionCommand("''", "''", 'Bold Text')
			},
			{
				key: 'Mod-i',
				run: wrapSelectionCommand('//', '//', 'Italic Text')
			},
			{
				key: 'Mod--',
				run: wrapSelectionCommand('~~', '~~', 'Strikethrough Text')
			},
			{
				key: 'Mod-.',
				run: wrapSelectionCommand('^^', '^^', 'Superscript Text')
			},
			{
				key: 'Mod-f',
				run() {
					controller.requestPanel('find');
					return true;
				}
			}
		])
	);
}

function tooltipForPosition(
	parsed: ParsedHarloweDocument,
	position: number
): Tooltip | null {
	const token = harloweTokenAt(parsed, position);

	if (!token) {
		return null;
	}

	const path = parsed.tree.pathAt(
		Math.max(0, Math.min(position, parsed.tree.end - 1))
	);
	const macro = path.find(candidate => candidate.type === 'macro');
	const macroName = path.find(candidate => candidate.type === 'macroName');
	const definition = macroName
		? harloweMacroDefinitionsByName[
				insensitiveHarloweName(macroName.text.slice(0, -1))
			]
		: macro?.name
			? harloweMacroDefinitionsByName[insensitiveHarloweName(macro.name)]
			: undefined;
	const keyword = harloweKeywords.find(
		candidate => candidate.label === token.text.toLowerCase()
	);
	const description =
		definition?.abstract ??
		keywordHelp[token.text.toLowerCase()] ??
		structureHelp[token.type] ??
		(keyword ? `A Harlowe ${keyword.detail}.` : undefined);

	if (!description) {
		return null;
	}

	return {
		create() {
			const dom = document.createElement('div');
			const heading = document.createElement('strong');
			const detail = document.createElement('span');
			const copy = document.createElement('p');

			dom.className = 'harlowe-native-tooltip';
			heading.textContent = definition ? `(${definition.name}:)` : token.text;
			detail.className = 'harlowe-native-tooltip-signature';
			detail.textContent = definition
				? `${definition.sig} → ${definition.returnType}`
				: (keyword?.detail ?? `Harlowe ${token.type}`);
			copy.textContent = description;
			dom.append(heading, detail, copy);

			return {dom};
		},
		end: token.end,
		pos: token.start
	};
}

function codingTooltip(): Extension {
	return showTooltip.compute(['doc', 'selection'], state => {
		if (state.selection.ranges.some(range => !range.empty)) {
			return null;
		}

		return tooltipForPosition(
			parseHarloweDocument(state.doc.toString()),
			state.selection.main.head
		);
	});
}

function completionSourceForPreferences(
	macrosEnabled: boolean,
	keywordsEnabled: boolean
) {
	return (context: CompletionContext): CompletionResult | null => {
		const macro = context.matchBefore(/\([A-Za-z][\w-]*$/);

		if (macrosEnabled && macro) {
			const parsed = parseHarloweDocument(context.state.doc.toString());
			const path = parsed.tree.pathAt(
				Math.max(0, Math.min(context.pos - 1, context.state.doc.length - 1))
			);

			if (path.some(token => token.type === 'string')) {
				return null;
			}

			return {
				from: macro.from + 1,
				options: macroCompletions,
				validFor: /^[A-Za-z][\w-]*$/
			};
		}

		if (!keywordsEnabled) {
			return null;
		}

		const word = context.matchBefore(/[-2A-Za-z][A-Za-z ]*$/);

		if (!word || (!context.explicit && word.from === context.pos)) {
			return null;
		}

		const parsed = parseHarloweDocument(context.state.doc.toString());
		const path = parsed.tree.pathAt(
			Math.max(0, Math.min(context.pos - 1, context.state.doc.length - 1))
		);

		if (!path.some(token => token.type === 'macro')) {
			return null;
		}

		return {
			from: word.from,
			options: keywordCompletions,
			validFor: /^[-2A-Za-z][A-Za-z ]*$/
		};
	};
}

export const harlowe339Provider: NativeEditorProvider = {
	createSession(context) {
		const controller = new HarloweEditorController();

		return {
			Toolbar: HarloweToolbar,
			completionSources:
				context.preferences.completionsForKeywords ||
				context.preferences.completionsForMacros
					? [
							completionSourceForPreferences(
								context.preferences.completionsForMacros,
								context.preferences.completionsForKeywords
							)
						]
					: [],
			extensions: [
				syntaxDecorations(context),
				controller.extension(),
				shortcutExtension(controller),
				context.preferences.codingTooltips ? codingTooltip() : []
			],
			controller,
			key: [
				'harlowe-3.3.9',
				context.passageNames.join('\u0000'),
				context.tagNames.join('\u0000'),
				JSON.stringify(context.preferences)
			].join(':'),
			ownsSyntax: true,
			useCodeFont: context.preferences.codeUsesCodeFont
		};
	},
	dialect: {
		family: 'harlowe',
		id: 'harlowe-3.3.9',
		version: '3.3.9'
	}
};

export default harlowe339Provider;
