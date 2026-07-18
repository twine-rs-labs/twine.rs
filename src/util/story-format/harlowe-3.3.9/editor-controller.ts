import {StateEffect, type Extension} from '@codemirror/state';
import {
	Decoration,
	type DecorationSet,
	EditorView,
	ViewPlugin,
	type ViewUpdate
} from '@codemirror/view';
import type {
	NativeEditorController,
	NativeEditorFindOptions,
	NativeEditorFindResult
} from '../native-editor/types';
import {parseHarloweDocument, type ParsedHarloweDocument} from './parser';

interface FindMatch {
	from: number;
	groups: string[];
	to: number;
}

const refreshPresentation = StateEffect.define<null>();

function hasProseAt(parsed: ParsedHarloweDocument, position: number) {
	return parsed.tree
		.pathAt(position)
		.some(token => token.type === 'text' || token.type === 'string');
}

function matchesSyntaxScope(
	parsed: ParsedHarloweDocument,
	from: number,
	to: number,
	scope: 'code' | 'prose'
) {
	for (let position = from; position < to; position++) {
		const prose = hasProseAt(parsed, position);

		if ((scope === 'code' && prose) || (scope === 'prose' && !prose)) {
			return false;
		}
	}

	return true;
}

function result(
	matches: readonly FindMatch[],
	current: number,
	invalidPattern = false
): NativeEditorFindResult {
	return {
		count: matches.length,
		index: matches.length === 0 ? -1 : current,
		invalidPattern: invalidPattern || undefined
	};
}

export class HarloweEditorController implements NativeEditorController {
	private current = -1;
	private listeners = new Set<() => void>();
	private matches: FindMatch[] = [];
	private options?: NativeEditorFindOptions;
	private plugin?: {
		decorations: DecorationSet;
		rebuild: () => void;
		view: EditorView;
	};
	private requestedPanel?: 'find';
	proofreading = false;

	extension(): Extension {
		// The CM6 plugin class needs the owning per-editor controller instance.
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const controller = this;

		return ViewPlugin.fromClass(
			class {
				decorations = Decoration.none;
				view: EditorView;

				constructor(view: EditorView) {
					this.view = view;
					controller.plugin = this;
					controller.recompute();
				}

				destroy() {
					if (controller.plugin === this) {
						controller.plugin = undefined;
					}
				}

				rebuild() {
					this.decorations = Decoration.set(
						controller.matches.map((match, index) =>
							Decoration.mark({
								class:
									index === controller.current
										? 'cm-harlowe-3-findResultCurrent'
										: 'cm-harlowe-3-findResult'
							}).range(match.from, match.to)
						)
					);
				}

				update(update: ViewUpdate) {
					if (
						update.docChanged ||
						update.transactions.some(transaction =>
							transaction.effects.some(effect => effect.is(refreshPresentation))
						)
					) {
						if (update.docChanged) {
							controller.recompute();
						} else {
							this.rebuild();
						}
					}
				}
			},
			{decorations: plugin => plugin.decorations}
		);
	}

	clearFind() {
		this.options = undefined;
		this.matches = [];
		this.current = -1;
		this.refresh();
	}

	find(options: NativeEditorFindOptions) {
		this.options = options;
		return this.recompute();
	}

	getFindResult() {
		return result(this.matches, this.current);
	}

	findNext(direction: -1 | 1) {
		if (this.matches.length > 0) {
			this.current =
				(this.current + direction + this.matches.length) % this.matches.length;
			this.revealCurrent();
			this.refresh();
		}

		return result(this.matches, this.current);
	}

	replaceAll(replacement: string) {
		const view = this.plugin?.view;

		if (!view || this.matches.length === 0) {
			return result(this.matches, this.current);
		}

		const regexp = this.regexp();
		const document = view.state.doc.toString();
		const changes = this.matches.map(match => ({
			from: match.from,
			insert: regexp
				? document.slice(match.from, match.to).replace(regexp, replacement)
				: replacement,
			to: match.to
		}));

		view.dispatch({changes});
		return this.recompute();
	}

	replaceCurrent(replacement: string) {
		const view = this.plugin?.view;
		const match = this.matches[this.current];

		if (!view || !match) {
			return result(this.matches, this.current);
		}

		const regexp = this.regexp();
		const selected = view.state.doc.sliceString(match.from, match.to);
		const insert = regexp ? selected.replace(regexp, replacement) : replacement;

		view.dispatch({
			changes: {from: match.from, insert, to: match.to},
			selection: {anchor: match.from + insert.length}
		});
		return this.recompute();
	}

	requestPanel(panel: 'find') {
		this.requestedPanel = panel;
		this.emit();
	}

	setProofreading(enabled: boolean) {
		this.proofreading = enabled;
		this.plugin?.view.dom.classList.toggle(
			'cm-harlowe-3-proofreading',
			enabled
		);
		this.emit();
	}

	subscribe(listener: () => void) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	takeRequestedPanel() {
		const requested = this.requestedPanel;

		this.requestedPanel = undefined;
		return requested;
	}

	private emit() {
		for (const listener of this.listeners) {
			listener();
		}
	}

	private recompute() {
		const view = this.plugin?.view;

		if (!view || !this.options?.query) {
			this.matches = [];
			this.current = -1;
			this.plugin?.rebuild();
			this.emit();
			return result(this.matches, this.current);
		}

		const regexp = this.regexp();

		if (!regexp) {
			this.matches = [];
			this.current = -1;
			this.plugin?.rebuild();
			this.emit();
			return result(this.matches, this.current, true);
		}

		const document = view.state.doc.toString();
		const parsed = parseHarloweDocument(document);
		const matches: FindMatch[] = [];
		let match: RegExpExecArray | null;

		while ((match = regexp.exec(document))) {
			if (match[0].length === 0) {
				break;
			}

			const from = match.index;
			const to = from + match[0].length;
			const inSelection = view.state.selection.ranges.some(
				range => from >= range.from && to <= range.to
			);

			if (
				((this.options.scope === 'code' || this.options.scope === 'prose') &&
					!matchesSyntaxScope(parsed, from, to, this.options.scope)) ||
				(this.options.scope === 'selection' && !inSelection)
			) {
				continue;
			}

			matches.push({
				from,
				groups: match.slice(1),
				to
			});
		}

		this.matches = matches;
		this.current =
			matches.length === 0
				? -1
				: Math.max(0, Math.min(this.current, matches.length - 1));
		this.plugin?.rebuild();
		this.emit();
		return result(this.matches, this.current);
	}

	private refresh() {
		this.plugin?.view.dispatch({effects: refreshPresentation.of(null)});
		this.emit();
	}

	private regexp() {
		if (!this.options?.query) {
			return undefined;
		}

		try {
			return new RegExp(
				this.options.useRegExp
					? this.options.query
					: this.options.query.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&'),
				this.options.matchCase ? 'g' : 'gi'
			);
		} catch {
			return undefined;
		}
	}

	private revealCurrent() {
		const view = this.plugin?.view;
		const match = this.matches[this.current];

		if (!view || !match) {
			return;
		}

		view.dispatch({
			effects: EditorView.scrollIntoView(match.from, {y: 'center'}),
			selection: {anchor: match.from, head: match.to}
		});
	}
}
