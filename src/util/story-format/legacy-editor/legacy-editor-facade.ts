import type {
	SourceEditorEdit,
	SourceEditorHandle,
	SourceEditorSelection,
	SourceEditorSnapshot
} from '../../../components/control/source-editor/source-editor';

export interface LegacyEditorPosition {
	ch: number;
	line: number;
}

export interface LegacyEditorSelection {
	anchor: LegacyEditorPosition;
	head: LegacyEditorPosition;
}

export type LegacyEditorCursorTarget =
	'anchor' | 'end' | 'from' | 'head' | 'start' | 'to' | boolean;

export type LegacyEditorSelectionCollapse = 'around' | 'end' | 'start';

export interface ReadOnlyLegacyDocumentFacade {
	getCursor(target?: LegacyEditorCursorTarget): LegacyEditorPosition;
	getRange(from: LegacyEditorPosition, to: LegacyEditorPosition): string;
	getSelection(): string;
	getSelections(): string[];
	getValue(): string;
	indexFromPos(position: LegacyEditorPosition): number;
	posFromIndex(index: number): LegacyEditorPosition;
	somethingSelected(): boolean;
}

export interface LegacyDocumentFacade extends ReadOnlyLegacyDocumentFacade {
	replaceRange(
		value: string,
		from: LegacyEditorPosition,
		to?: LegacyEditorPosition
	): void;
	replaceSelection(
		value: string,
		collapse?: LegacyEditorSelectionCollapse
	): void;
	replaceSelections(
		values: string[],
		collapse?: LegacyEditorSelectionCollapse
	): void;
	setCursor(position: LegacyEditorPosition): void;
	setCursor(line: number, ch?: number): void;
}

export interface ReadOnlyLegacyEditorFacade extends ReadOnlyLegacyDocumentFacade {
	getDoc(): ReadOnlyLegacyDocumentFacade;
}

export interface LegacyEditorFacade extends LegacyDocumentFacade {
	focus(): void;
	getDoc(): LegacyDocumentFacade;
}

export type UnsupportedLegacyEditorApiAccess = 'get' | 'set';

export class UnsupportedLegacyEditorApiError extends Error {
	readonly access: UnsupportedLegacyEditorApiAccess;
	readonly apiName: string;
	readonly readOnly: boolean;

	constructor(
		apiName: PropertyKey,
		options: {
			access?: UnsupportedLegacyEditorApiAccess;
			readOnly?: boolean;
		} = {}
	) {
		const access = options.access ?? 'get';
		const readOnly = options.readOnly ?? false;
		const renderedName =
			typeof apiName === 'symbol' ? apiName.toString() : String(apiName);

		super(
			`Legacy editor API "${renderedName}" is not supported${
				readOnly ? ' by the read-only toolbar facade' : ''
			}`
		);
		this.name = 'UnsupportedLegacyEditorApiError';
		this.access = access;
		this.apiName = renderedName;
		this.readOnly = readOnly;
	}
}

interface DocumentIndex {
	lineStarts: number[];
	lines: string[];
	text: string;
}

function documentIndex(text: string): DocumentIndex {
	const lines = text.split('\n');
	const lineStarts = [0];

	for (let index = 0; index < lines.length - 1; index++) {
		lineStarts.push(lineStarts[index] + lines[index].length + 1);
	}

	return {lineStarts, lines, text};
}

function finiteInteger(value: unknown, fallback = 0) {
	return typeof value === 'number' && Number.isFinite(value)
		? Math.trunc(value)
		: fallback;
}

function indexFromPosition(
	index: DocumentIndex,
	position: LegacyEditorPosition
) {
	const line = finiteInteger(position?.line);

	if (line < 0) {
		return 0;
	}

	if (line >= index.lines.length) {
		return index.text.length;
	}

	const ch = Math.max(
		0,
		Math.min(
			finiteInteger(position?.ch, index.lines[line].length),
			index.lines[line].length
		)
	);

	return index.lineStarts[line] + ch;
}

function positionFromIndex(index: DocumentIndex, rawOffset: number) {
	const offset = Math.max(
		0,
		Math.min(finiteInteger(rawOffset), index.text.length)
	);
	let low = 0;
	let high = index.lineStarts.length - 1;

	while (low < high) {
		const middle = Math.ceil((low + high) / 2);

		if (index.lineStarts[middle] <= offset) {
			low = middle;
		} else {
			high = middle - 1;
		}
	}

	return {
		ch: Math.min(offset - index.lineStarts[low], index.lines[low].length),
		line: low
	};
}

function orderedSelection(selection: SourceEditorSelection) {
	return selection.anchor <= selection.head
		? {from: selection.anchor, to: selection.head}
		: {from: selection.head, to: selection.anchor};
}

function currentSelection(snapshot: SourceEditorSnapshot) {
	return (
		snapshot.selections[snapshot.mainSelectionIndex] ??
		snapshot.selections[0] ?? {anchor: 0, head: 0}
	);
}

function replacementSelections(
	selections: SourceEditorSelection[],
	values: string[],
	collapse: LegacyEditorSelectionCollapse
) {
	let offset = 0;

	return selections.map((selection, selectionIndex) => {
		const {from, to} = orderedSelection(selection);
		const replacementFrom = from + offset;
		const replacementTo = replacementFrom + values[selectionIndex].length;

		offset += values[selectionIndex].length - (to - from);

		if (collapse === 'start') {
			return {anchor: replacementFrom, head: replacementFrom};
		}

		if (collapse === 'around') {
			return selection.head < selection.anchor
				? {anchor: replacementTo, head: replacementFrom}
				: {anchor: replacementFrom, head: replacementTo};
		}

		return {anchor: replacementTo, head: replacementTo};
	});
}

function replacementEdits(
	selections: SourceEditorSelection[],
	values: string[]
): SourceEditorEdit[] {
	return selections.map((selection, index) => {
		const {from, to} = orderedSelection(selection);

		return {from, insert: values[index], to};
	});
}

function proxyFacade<T extends object>(target: T, readOnly: boolean): T {
	return new Proxy(target, {
		defineProperty(_target, property) {
			throw new UnsupportedLegacyEditorApiError(property, {
				access: 'set',
				readOnly
			});
		},
		deleteProperty(_target, property) {
			throw new UnsupportedLegacyEditorApiError(property, {
				access: 'set',
				readOnly
			});
		},
		get(currentTarget, property, receiver) {
			if (Object.prototype.hasOwnProperty.call(currentTarget, property)) {
				return Reflect.get(currentTarget, property, receiver);
			}

			throw new UnsupportedLegacyEditorApiError(property, {readOnly});
		},
		set(_target, property) {
			throw new UnsupportedLegacyEditorApiError(property, {
				access: 'set',
				readOnly
			});
		}
	});
}

function readMethods(handle: SourceEditorHandle) {
	return {
		getCursor(target?: LegacyEditorCursorTarget) {
			const snapshot = handle.getSnapshot();
			const selection = currentSelection(snapshot);
			let offset: number;

			switch (target) {
				case 'anchor':
					offset = selection.anchor;
					break;

				case 'end':
				case 'to':
				case false:
					offset = Math.max(selection.anchor, selection.head);
					break;

				case 'from':
				case 'start':
				case true:
					offset = Math.min(selection.anchor, selection.head);
					break;

				case 'head':
				case undefined:
					offset = selection.head;
					break;

				default:
					offset = selection.head;
			}

			return positionFromIndex(documentIndex(snapshot.document), offset);
		},
		getRange(from: LegacyEditorPosition, to: LegacyEditorPosition) {
			const snapshot = handle.getSnapshot();
			const index = documentIndex(snapshot.document);
			const fromIndex = indexFromPosition(index, from);
			const toIndex = indexFromPosition(index, to);

			return snapshot.document.slice(
				Math.min(fromIndex, toIndex),
				Math.max(fromIndex, toIndex)
			);
		},
		getSelection() {
			const snapshot = handle.getSnapshot();

			return snapshot.selections
				.map(selection => {
					const {from, to} = orderedSelection(selection);

					return snapshot.document.slice(from, to);
				})
				.join('\n');
		},
		getSelections() {
			const snapshot = handle.getSnapshot();

			return snapshot.selections.map(selection => {
				const {from, to} = orderedSelection(selection);

				return snapshot.document.slice(from, to);
			});
		},
		getValue() {
			return handle.getSnapshot().document;
		},
		indexFromPos(position: LegacyEditorPosition) {
			const snapshot = handle.getSnapshot();

			return indexFromPosition(documentIndex(snapshot.document), position);
		},
		posFromIndex(offset: number) {
			const snapshot = handle.getSnapshot();

			return positionFromIndex(documentIndex(snapshot.document), offset);
		},
		somethingSelected() {
			return handle
				.getSnapshot()
				.selections.some(selection => selection.anchor !== selection.head);
		}
	} satisfies ReadOnlyLegacyDocumentFacade;
}

/**
 * Creates the bounded CodeMirror 5-shaped facade passed to legacy commands.
 *
 * Every method reads from the handle when invoked rather than retaining a
 * snapshot, so a facade remains current across normal CodeMirror transactions.
 */
export function createLegacyEditorFacade(
	handle: SourceEditorHandle
): LegacyEditorFacade {
	const shared = readMethods(handle);
	const documentTarget: LegacyDocumentFacade = {
		...shared,
		replaceRange(value, from, to = from) {
			const snapshot = handle.getSnapshot();
			const index = documentIndex(snapshot.document);
			const fromIndex = indexFromPosition(index, from);
			const toIndex = indexFromPosition(index, to);

			handle.applyEdits([
				{
					from: Math.min(fromIndex, toIndex),
					insert: String(value),
					to: Math.max(fromIndex, toIndex)
				}
			]);
		},
		replaceSelection(value, collapse = 'end') {
			const snapshot = handle.getSnapshot();
			const values = snapshot.selections.map(() => String(value));

			handle.applyEdits(
				replacementEdits(snapshot.selections, values),
				replacementSelections(snapshot.selections, values, collapse),
				snapshot.mainSelectionIndex
			);
		},
		replaceSelections(values, collapse = 'end') {
			const snapshot = handle.getSnapshot();

			if (values.length !== snapshot.selections.length) {
				throw new RangeError(
					`Expected ${snapshot.selections.length} replacement values, received ${values.length}`
				);
			}

			const stringValues = values.map(String);

			handle.applyEdits(
				replacementEdits(snapshot.selections, stringValues),
				replacementSelections(snapshot.selections, stringValues, collapse),
				snapshot.mainSelectionIndex
			);
		},
		setCursor(
			positionOrLine: LegacyEditorPosition | number,
			ch: number = 0
		): void {
			const snapshot = handle.getSnapshot();
			const index = documentIndex(snapshot.document);
			const offset = indexFromPosition(
				index,
				typeof positionOrLine === 'number'
					? {ch, line: positionOrLine}
					: positionOrLine
			);

			handle.setSelections([{anchor: offset, head: offset}]);
		}
	};
	const documentFacade = proxyFacade(documentTarget, false);
	const editorTarget: LegacyEditorFacade = {
		...documentTarget,
		focus: () => handle.focus(),
		getDoc: () => documentFacade
	};

	return proxyFacade(editorTarget, false);
}

/**
 * Creates the state-only facade passed to toolbar factories.
 *
 * Mutation methods and every API outside the bounded allowlist fail closed
 * when accessed, allowing the integration boundary to disable only the
 * offending format extension.
 */
export function createReadOnlyLegacyEditorFacade(
	handle: SourceEditorHandle
): ReadOnlyLegacyEditorFacade {
	const shared = readMethods(handle);
	const documentFacade = proxyFacade({...shared}, true);
	const target: ReadOnlyLegacyEditorFacade = {
		...shared,
		getDoc: () => documentFacade
	};

	return proxyFacade(target, true);
}
