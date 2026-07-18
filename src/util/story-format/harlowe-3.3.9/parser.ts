import {HarloweMacroDefinitions} from './harlowe-macros-vendor.js';
import {HarloweMarkup} from './harlowe-parser-vendor.js';

export interface HarloweMacroDefinition {
	abstract: string;
	aka: string[];
	anchor: string;
	category?: string;
	categoryOrder?: string;
	name: string;
	returnType: string;
	sig: string;
}

export interface HarloweToken {
	children: HarloweToken[];
	colour?: string;
	end: number;
	hidden?: boolean;
	innerText?: string;
	message?: string;
	name?: string;
	passage?: string;
	start: number;
	tagPosition?: 'appended' | 'prepended';
	text: string;
	type: string;
	pathAt(position: number): HarloweToken[];
	tokenAt(position: number): HarloweToken | null;
}

export interface HarloweStyleRange {
	className: string;
	colour?: string;
	from: number;
	to: number;
}

export interface ParsedHarloweDocument {
	referenceTokens: {
		hook: HarloweToken[];
		hookName: HarloweToken[];
		tempVariable: HarloweToken[];
		variable: HarloweToken[];
	};
	styleRanges: HarloweStyleRange[];
	tree: HarloweToken;
}

export const harloweMacroDefinitions = HarloweMacroDefinitions as Record<
	string,
	HarloweMacroDefinition
>;

export const harloweMacroDefinitionsByName = Object.entries(
	harloweMacroDefinitions
).reduce<Record<string, HarloweMacroDefinition>>(
	(result, [key, definition]) => {
		for (const name of [key, definition.name, ...definition.aka]) {
			result[insensitiveHarloweName(name)] = definition;
		}

		return result;
	},
	{}
);

export function insensitiveHarloweName(value: string) {
	return value.toLowerCase().replace(/-|_/g, '');
}

function tokenStyle(
	token: HarloweToken,
	path: HarloweToken[],
	passageNames: ReadonlySet<string>,
	tagNames: ReadonlySet<string>
) {
	const duplicateTypes: Record<string, number> = {};
	let className = '';

	for (let index = 0; index < path.length; index++) {
		const current = path[index];
		const type = current.type;
		const text = current.text;
		let currentClass = `harlowe-3-${type}`;

		if (type === 'verbatim' || type === 'comment') {
			className = '';
		}

		duplicateTypes[currentClass] = (duplicateTypes[currentClass] ?? 0) + 1;

		if (duplicateTypes[currentClass] > 1) {
			currentClass += `-${duplicateTypes[currentClass]}`;
		}

		switch (type) {
			case 'string': {
				const value = text.slice(1, -1);

				if (passageNames.has(value)) {
					currentClass += ' harlowe-3-passageString';
				} else if (tagNames.has(value)) {
					currentClass += ' harlowe-3-tagString';
				}
				break;
			}

			case 'text':
				if (
					text.trim() &&
					path
						.slice(index + 1)
						.reduce<boolean | undefined>(
							(result, ancestor) =>
								result === undefined
									? ancestor.type === 'macro' ||
										(ancestor.type !== 'hook' && result)
									: result,
							undefined
						)
				) {
					currentClass += ' harlowe-3-error';
				}
				break;

			case 'macroName': {
				const firstCharacter = text[0];

				if (firstCharacter !== '_' && firstCharacter !== '$') {
					const definition =
						harloweMacroDefinitionsByName[
							insensitiveHarloweName(text.slice(0, -1))
						];

					currentClass += definition
						? `-${definition.returnType.toLowerCase()}`
						: ' harlowe-3-error';
				} else {
					currentClass += ` harlowe-3-customMacro harlowe-3-${
						firstCharacter === '_' ? 'tempVariable' : 'variable'
					}`;
				}
				break;
			}
		}

		className += `${currentClass} `;
	}

	return {
		className: className.trim(),
		colour:
			token.type === 'colour'
				? token.colour
				: path.find(candidate => candidate.type === 'colour')?.colour
	};
}

function leafTokens(token: HarloweToken, result: HarloweToken[]) {
	if (token.type === 'string' || token.children.length === 0) {
		result.push(token);
		return;
	}

	for (const child of token.children) {
		leafTokens(child, result);
	}
}

function collectReferenceTokens(
	token: HarloweToken,
	references: ParsedHarloweDocument['referenceTokens']
) {
	if (token.type in references) {
		references[token.type as keyof typeof references].push(token);
	}

	if (token.type !== 'string') {
		for (const child of token.children) {
			collectReferenceTokens(child, references);
		}
	}
}

/**
 * Parses passage source with the exact Lexer/Markup modules bundled by Harlowe
 * 3.3.9. This is presentation-only editor state and is never used as a story,
 * graph, diagnostics, or publishing authority.
 */
export function parseHarloweDocument(
	document: string,
	passageNames: Iterable<string> = [],
	tagNames: Iterable<string> = []
): ParsedHarloweDocument {
	const tree = HarloweMarkup.lex(document) as HarloweToken;
	const referenceTokens: ParsedHarloweDocument['referenceTokens'] = {
		hook: [],
		hookName: [],
		tempVariable: [],
		variable: []
	};
	const leaves: HarloweToken[] = [];
	const passageNameSet = new Set(passageNames);
	const tagNameSet = new Set(tagNames);

	collectReferenceTokens(tree, referenceTokens);
	leafTokens(tree, leaves);

	return {
		referenceTokens,
		styleRanges: leaves
			.filter(token => token.start < token.end)
			.map(token => {
				const path = tree.pathAt(token.start);
				const style = tokenStyle(token, path, passageNameSet, tagNameSet);

				return {
					...style,
					from: token.start,
					to: token.end
				};
			}),
		tree
	};
}

export function harloweTokenAt(
	parsed: ParsedHarloweDocument,
	position: number
) {
	if (parsed.tree.end === 0) {
		return null;
	}

	return parsed.tree.tokenAt(
		Math.max(0, Math.min(position, parsed.tree.end - 1))
	);
}

export function harloweHookNameRange(token: HarloweToken) {
	if (token.type === 'hookName') {
		return {from: token.start, to: token.end};
	}

	if (token.type !== 'hook' || !token.name) {
		return undefined;
	}

	const from =
		token.tagPosition === 'appended'
			? token.end - token.name.length - 1
			: token.start + 1;

	return {from, to: from + token.name.length};
}
