import {
	HighlightStyle,
	ParseContext,
	StreamLanguage,
	StringStream,
	syntaxHighlighting
} from '@codemirror/language';
import {Extension, Facet} from '@codemirror/state';
import {Tag} from '@lezer/highlight';

export interface LegacyStreamModeConfig {
	readonly indentUnit?: number;
	readonly tabSize?: number;
}

export interface LegacyStringStream {
	eol(): boolean;
	sol(): boolean;
	peek(): string | null | undefined;
	next(): string | null | void;
	eat(match: string | RegExp | ((character: string) => boolean)): string | void;
	eatWhile(match: string | RegExp | ((character: string) => boolean)): boolean;
	eatSpace(): boolean;
	skipTo(character: string): boolean | void;
	skipToEnd(): void;
	backUp(count: number): void;
	column(): number;
	indentation(): number;
	match(
		pattern: string | RegExp,
		consume?: boolean,
		caseInsensitive?: boolean
	): boolean | RegExpMatchArray | null;
	current(): string;
	lookAhead(lineCount: number): string | undefined;
}

export interface LegacyStreamMode<State> {
	startState?: () => State;
	copyState?: (state: State) => State;
	blankLine?: (state: State) => void;
	token(stream: LegacyStringStream, state: State): string | null;
}

export type LegacyStreamModeFactory<State> = (
	config: Readonly<LegacyStreamModeConfig>,
	modeOptions?: unknown
) => LegacyStreamMode<State>;

export interface LegacyStreamDocumentServiceMetrics {
	readonly lineIndexInvalidations: number;
	readonly lineIndexRebuilds: number;
	readonly preservedLookAheadSnapshots: number;
}

export interface LegacyStreamDocumentServiceOptions {
	onLineIndexRebuild?: (
		metrics: Readonly<LegacyStreamDocumentServiceMetrics>
	) => void;
}

export interface LegacyStreamDocumentService {
	dispose(): void;
	line(lineNumber: number): string | undefined;
	metrics(): Readonly<LegacyStreamDocumentServiceMetrics>;
	/**
	 * Deliberately retains the existing lookAhead document snapshot and line
	 * index. This is safe only for a host-proven mode invariant (Chapbook uses
	 * lookAhead solely to detect whether any complete `--` line exists).
	 */
	preserveLookAheadSnapshot(): void;
	/**
	 * Replaces the current snapshot and invalidates all derived line data.
	 * Custom/unknown modes use this conservative path.
	 */
	replaceDocument(document: string): void;
}

export type LegacyCustomTokenStyle =
	'format-primary' | 'format-secondary' | 'format-tertiary' | 'format-warning';

export type LegacyStreamModeFailureKind =
	| 'exception'
	| 'invalid-mode'
	| 'invalid-token'
	| 'unsupported-api'
	| 'zero-advance';

export type LegacyStreamModeFailurePhase =
	'blank-line' | 'copy-state' | 'mode-factory' | 'start-state' | 'token';

export interface LegacyStreamModeFailure {
	kind: LegacyStreamModeFailureKind;
	message: string;
	phase: LegacyStreamModeFailurePhase;
	tokenName?: string;
	unsupportedApi?: string;
}

export interface LegacyStreamModeAdapterOptions {
	config?: Partial<LegacyStreamModeConfig>;
	customTokenMap?: Readonly<Record<string, LegacyCustomTokenStyle>>;
	documentService: LegacyStreamDocumentService;
	modeOptions?: unknown;
	onFailure?: (failure: LegacyStreamModeFailure) => void;
}

export interface LegacyStreamModeAdapter {
	/**
	 * Releases per-editor mode, document, and diagnostic callback ownership.
	 *
	 * CodeMirror retains each `StreamLanguage` node type in a module-level
	 * registry, so the parser must point through a disposable runtime rather
	 * than closing over editor-owned resources directly.
	 */
	dispose(): void;
	/**
	 * The language alone, for callers that install highlighting separately.
	 */
	language: StreamLanguage<unknown>;
	/**
	 * The language plus the fixed highlighter for approved custom token slots.
	 */
	extension: Extension;
	readonly failure: LegacyStreamModeFailure | undefined;
}

export interface LegacyStreamModeAdapterRecipe {
	/**
	 * Creates the per-editor runtime and facet provider installed alongside the
	 * recipe's shared stream language.
	 */
	create(
		options: Pick<
			LegacyStreamModeAdapterOptions,
			'documentService' | 'onFailure'
		>
	): LegacyStreamModeAdapter;
	readonly language: StreamLanguage<unknown>;
}

export class UnsupportedLegacyStreamApiError extends Error {
	readonly api: string;

	constructor(api: string) {
		super(`Unsupported legacy StringStream API: ${api}`);
		this.name = 'UnsupportedLegacyStreamApiError';
		this.api = api;
	}
}

const defaultConfig: Readonly<LegacyStreamModeConfig> = Object.freeze({
	indentUnit: 2,
	tabSize: 4
});

/**
 * These are the class names the application owns for explicitly approved
 * custom format tokens. A format can select a slot, but cannot inject a class
 * name, style, or DOM.
 */
export const legacyCustomTokenClasses: Readonly<
	Record<LegacyCustomTokenStyle, string>
> = Object.freeze({
	'format-primary': 'cm-twine-legacy-format-primary',
	'format-secondary': 'cm-twine-legacy-format-secondary',
	'format-tertiary': 'cm-twine-legacy-format-tertiary',
	'format-warning': 'cm-twine-legacy-format-warning'
});

const customTokenTags: Readonly<Record<LegacyCustomTokenStyle, Tag>> = {
	'format-primary': Tag.define(),
	'format-secondary': Tag.define(),
	'format-tertiary': Tag.define(),
	'format-warning': Tag.define()
};

const customTokenHighlightStyle = HighlightStyle.define(
	(Object.keys(customTokenTags) as LegacyCustomTokenStyle[]).map(style => ({
		tag: customTokenTags[style],
		class: legacyCustomTokenClasses[style]
	}))
);

const customTokenTableNames: Readonly<Record<LegacyCustomTokenStyle, string>> =
	Object.freeze({
		'format-primary': 'twineLegacyFormatPrimary',
		'format-secondary': 'twineLegacyFormatSecondary',
		'format-tertiary': 'twineLegacyFormatTertiary',
		'format-warning': 'twineLegacyFormatWarning'
	});

const customTokenTable: Readonly<Record<string, Tag>> = Object.freeze(
	Object.fromEntries(
		(Object.keys(customTokenTags) as LegacyCustomTokenStyle[]).map(style => [
			customTokenTableNames[style],
			customTokenTags[style]
		])
	)
);

/**
 * The default CM5 theme token vocabulary, translated to Lezer highlight tags.
 * `text` is intentionally accepted as unstyled because Chapbook uses it for
 * ordinary prose.
 */
const standardTokenMap: Readonly<Record<string, string | null>> = Object.freeze(
	{
		atom: 'atom',
		attribute: 'attributeName',
		bracket: 'bracket',
		builtin: 'variableName.standard',
		comment: 'comment',
		def: 'variableName.definition',
		em: 'emphasis',
		error: 'invalid',
		header: 'heading',
		hr: 'contentSeparator',
		invalidchar: 'invalid',
		'invalid-char': 'invalid',
		keyword: 'keyword',
		link: 'link',
		meta: 'meta',
		negative: 'number',
		number: 'number',
		operator: 'operator',
		positive: 'number',
		property: 'propertyName',
		punctuation: 'punctuation',
		qualifier: 'modifier',
		quote: 'quote',
		string: 'string',
		'string-2': 'string.special',
		strikethrough: 'strikethrough',
		strong: 'strong',
		tag: 'tagName',
		text: null,
		type: 'typeName',
		unit: 'unit',
		variable: 'variableName',
		'variable-2': 'variableName.special',
		'variable-3': 'typeName'
	}
);

const supportedStreamMethods = new Set([
	'backUp',
	'column',
	'current',
	'eat',
	'eatSpace',
	'eatWhile',
	'eol',
	'indentation',
	'match',
	'next',
	'peek',
	'skipTo',
	'skipToEnd',
	'sol'
]);

class CallbackLegacyStreamDocumentService implements LegacyStreamDocumentService {
	private cachedDocument: string;
	private lineIndex: number[] | undefined;
	private disposed = false;
	private lineIndexInvalidations = 0;
	private lineIndexRebuilds = 0;
	private preservedLookAheadSnapshots = 0;

	constructor(
		document: string,
		private readonly options: LegacyStreamDocumentServiceOptions
	) {
		this.cachedDocument = document;
	}

	dispose() {
		this.cachedDocument = '';
		this.lineIndex = undefined;
		this.disposed = true;
	}

	line(lineNumber: number) {
		if (this.disposed || !Number.isInteger(lineNumber) || lineNumber < 0) {
			return undefined;
		}

		if (!this.lineIndex) {
			this.rebuildLineIndex();
		}

		const start = this.lineIndex?.[lineNumber];

		if (start === undefined) {
			return undefined;
		}

		const nextStart = this.lineIndex?.[lineNumber + 1];
		let end =
			nextStart === undefined ? this.cachedDocument.length : nextStart - 1;

		if (end > start && this.cachedDocument[end - 1] === '\r') {
			end--;
		}
		return this.cachedDocument.slice(start, end);
	}

	metrics() {
		return Object.freeze({
			lineIndexInvalidations: this.lineIndexInvalidations,
			lineIndexRebuilds: this.lineIndexRebuilds,
			preservedLookAheadSnapshots: this.preservedLookAheadSnapshots
		});
	}

	preserveLookAheadSnapshot() {
		if (!this.disposed) {
			this.preservedLookAheadSnapshots++;
		}
	}

	replaceDocument(document: string) {
		if (this.disposed) {
			return;
		}

		if (document !== this.cachedDocument) {
			this.cachedDocument = document;
			this.lineIndex = undefined;
			this.lineIndexInvalidations++;
		}
	}

	private rebuildLineIndex() {
		const nextIndex = [0];

		for (let index = 0; index < this.cachedDocument.length; index++) {
			const character = this.cachedDocument[index];

			if (character === '\r') {
				if (this.cachedDocument[index + 1] === '\n') {
					index++;
				}
				nextIndex.push(index + 1);
			} else if (character === '\n') {
				nextIndex.push(index + 1);
			}
		}
		this.lineIndex = nextIndex;
		this.lineIndexRebuilds++;

		try {
			this.options.onLineIndexRebuild?.(this.metrics());
		} catch {
			// Performance diagnostics must not affect parser behavior.
		}
	}
}

/**
 * Creates a lazily indexed document service. Unknown/custom integrations
 * should call `replaceDocument()` for conservative current-document behavior.
 * A host with a proven invariant may explicitly retain the prior lookAhead
 * snapshot with `preserveLookAheadSnapshot()`. Dispose it with its owning
 * editor to release cached text eagerly.
 */
export function createLegacyStreamDocumentService(
	document: string,
	options: LegacyStreamDocumentServiceOptions = {}
): LegacyStreamDocumentService {
	return new CallbackLegacyStreamDocumentService(document, options);
}

interface AdapterState<State> {
	legacyState: State;
	lineNumber: number;
}

function defaultStartState<State>() {
	return {} as State;
}

function defaultCopyState<State>(state: State): State {
	if (!state || typeof state !== 'object') {
		return state;
	}

	const result = {...state} as State;

	for (const key of Object.keys(result as object)) {
		const value = (result as Record<string, unknown>)[key];

		if (Array.isArray(value)) {
			(result as Record<string, unknown>)[key] = value.slice();
		}
	}

	return result;
}

function fallbackMode<State>(): LegacyStreamMode<State> {
	return {
		token(stream) {
			stream.skipToEnd();
			return null;
		}
	};
}

function modeFailure(
	phase: LegacyStreamModeFailurePhase,
	error: unknown
): LegacyStreamModeFailure {
	if (error instanceof UnsupportedLegacyStreamApiError) {
		return {
			kind: 'unsupported-api',
			message: error.message,
			phase,
			unsupportedApi: error.api
		};
	}

	return {
		kind: 'exception',
		message: `Legacy stream mode threw during ${phase}.`,
		phase
	};
}

function validatedCustomTokenMap(
	customTokenMap: LegacyStreamModeAdapterOptions['customTokenMap']
) {
	const result = new Map<string, LegacyCustomTokenStyle>();

	for (const [tokenName, style] of Object.entries(customTokenMap ?? {})) {
		if (
			!tokenName ||
			!/^[-\w]+$/.test(tokenName) ||
			!Object.hasOwn(customTokenTags, style)
		) {
			throw new TypeError('Invalid custom legacy stream token mapping.');
		}

		result.set(tokenName, style);
	}

	return result;
}

function mapToken(
	token: unknown,
	customTokenMap: ReadonlyMap<string, LegacyCustomTokenStyle>
):
	| {failure?: undefined; token: string | null}
	| {failure: LegacyStreamModeFailure; token?: undefined} {
	if (token === null || token === '') {
		return {token: null};
	}

	if (typeof token !== 'string') {
		return {
			failure: {
				kind: 'invalid-token',
				message: 'Legacy stream mode returned a non-string token.',
				phase: 'token'
			}
		};
	}

	const names = token.trim().split(/\s+/);
	const mapped: string[] = [];

	for (const name of names) {
		if (Object.hasOwn(standardTokenMap, name)) {
			const standardName = standardTokenMap[name];

			if (standardName) {
				mapped.push(standardName);
			}

			continue;
		}

		const customStyle = customTokenMap.get(name);

		if (customStyle) {
			mapped.push(customTokenTableNames[customStyle]);
			continue;
		}

		return {
			failure: {
				kind: 'invalid-token',
				message: `Legacy stream mode returned unsupported token "${name}".`,
				phase: 'token',
				tokenName: name
			}
		};
	}

	return {token: mapped.join(' ') || null};
}

function streamFacade(
	stream: StringStream,
	lineNumber: number,
	documentService: LegacyStreamDocumentService
): LegacyStringStream {
	const lookAhead = (lineCount: number) => {
		if (!Number.isInteger(lineCount) || lineCount < 0) {
			throw new UnsupportedLegacyStreamApiError('lookAhead argument');
		}

		return documentService.line(lineNumber + lineCount);
	};

	return new Proxy(Object.create(null) as LegacyStringStream, {
		get(_target, property) {
			if (property === 'lookAhead') {
				return lookAhead;
			}

			if (
				typeof property === 'string' &&
				supportedStreamMethods.has(property)
			) {
				const method: unknown = Reflect.get(stream, property);

				if (typeof method === 'function') {
					return method.bind(stream);
				}
			}

			throw new UnsupportedLegacyStreamApiError(String(property));
		},
		set(_target, property) {
			throw new UnsupportedLegacyStreamApiError(String(property));
		}
	});
}

interface LegacyStreamModeRuntime<State> {
	disposed: boolean;
	documentService: LegacyStreamDocumentService | undefined;
	failure: LegacyStreamModeFailure | undefined;
	mode: LegacyStreamMode<State>;
	onFailure: LegacyStreamModeAdapterOptions['onFailure'];
}

const legacyStreamModeRuntimeFacet = Facet.define<
	LegacyStreamModeRuntime<unknown>,
	LegacyStreamModeRuntime<unknown> | undefined
>({
	combine: values => values[0]
});

function currentLegacyStreamModeRuntime<State>() {
	return ParseContext.get()?.state.facet(legacyStreamModeRuntimeFacet) as
		LegacyStreamModeRuntime<State> | undefined;
}

function failLegacyStreamMode<State>(
	runtime: LegacyStreamModeRuntime<State>,
	nextFailure: LegacyStreamModeFailure
) {
	if (runtime.disposed || runtime.failure) {
		return;
	}

	runtime.failure = nextFailure;

	try {
		runtime.onFailure?.(nextFailure);
	} catch {
		// A diagnostic callback must never make an editor failure worse.
	}
}

function createSharedLegacyStreamLanguage<State>(
	customTokens: ReadonlyMap<string, LegacyCustomTokenStyle>
) {
	return StreamLanguage.define({
		startState(): AdapterState<State> {
			const runtime = currentLegacyStreamModeRuntime<State>();
			let legacyState: State;

			if (!runtime || runtime.disposed || runtime.failure) {
				legacyState = defaultStartState();
			} else {
				try {
					legacyState = runtime.mode.startState
						? runtime.mode.startState()
						: defaultStartState();
				} catch (error) {
					failLegacyStreamMode(runtime, modeFailure('start-state', error));
					legacyState = defaultStartState();
				}
			}

			return {legacyState, lineNumber: 0};
		},
		copyState(state: AdapterState<State>): AdapterState<State> {
			const runtime = currentLegacyStreamModeRuntime<State>();

			if (!runtime || runtime.disposed || runtime.failure) {
				return {...state};
			}

			try {
				return {
					legacyState: runtime.mode.copyState
						? runtime.mode.copyState(state.legacyState)
						: defaultCopyState(state.legacyState),
					lineNumber: state.lineNumber
				};
			} catch (error) {
				failLegacyStreamMode(runtime, modeFailure('copy-state', error));
				return {...state};
			}
		},
		blankLine(state: AdapterState<State>) {
			const runtime = currentLegacyStreamModeRuntime<State>();

			if (
				runtime &&
				!runtime.disposed &&
				!runtime.failure &&
				runtime.mode.blankLine
			) {
				try {
					runtime.mode.blankLine(state.legacyState);
				} catch (error) {
					failLegacyStreamMode(runtime, modeFailure('blank-line', error));
				}
			}

			state.lineNumber++;
		},
		token(stream: StringStream, state: AdapterState<State>) {
			const runtime = currentLegacyStreamModeRuntime<State>();
			const documentService = runtime?.documentService;

			if (!runtime || runtime.disposed || runtime.failure || !documentService) {
				stream.skipToEnd();
				return null;
			}

			const positionBefore = stream.pos;
			let token: unknown;

			try {
				token = runtime.mode.token(
					streamFacade(stream, state.lineNumber, documentService),
					state.legacyState
				);
			} catch (error) {
				failLegacyStreamMode(runtime, modeFailure('token', error));

				if (!stream.eol()) {
					stream.skipToEnd();
				}

				return null;
			}

			if (stream.pos <= positionBefore) {
				failLegacyStreamMode(runtime, {
					kind: 'zero-advance',
					message: 'Legacy stream mode failed to advance the stream.',
					phase: 'token'
				});
				stream.skipToEnd();
				return null;
			}

			if (stream.eol()) {
				state.lineNumber++;
			}

			const mapped = mapToken(token, customTokens);

			if (mapped.failure) {
				failLegacyStreamMode(runtime, mapped.failure);
				return null;
			}

			return mapped.token;
		},
		tokenTable: customTokenTable
	});
}

/**
 * Creates the immutable language recipe cached by a hydrated format identity.
 * Each editor receives only a facet-scoped mutable runtime, so multiple views
 * share CodeMirror's process-lived language shell without sharing document,
 * parser-state, failure, or callback ownership.
 */
export function createLegacyStreamModeAdapterRecipe<State>(
	modeFactory: LegacyStreamModeFactory<State>,
	options: Omit<
		LegacyStreamModeAdapterOptions,
		'documentService' | 'onFailure'
	> = {}
): LegacyStreamModeAdapterRecipe {
	let customTokens: ReadonlyMap<string, LegacyCustomTokenStyle>;
	let recipeFailure: LegacyStreamModeFailure | undefined;

	try {
		customTokens = validatedCustomTokenMap(options.customTokenMap);
	} catch {
		customTokens = new Map();
		recipeFailure = {
			kind: 'invalid-mode',
			message: 'Legacy stream mode has an invalid custom token mapping.',
			phase: 'mode-factory'
		};
	}

	const config = Object.freeze({
		...defaultConfig,
		...options.config
	});
	const language = createSharedLegacyStreamLanguage<State>(customTokens);
	const publicLanguage = language as StreamLanguage<unknown>;

	return {
		create(runtimeOptions) {
			const runtime: LegacyStreamModeRuntime<State> = {
				disposed: false,
				documentService: runtimeOptions.documentService,
				failure: recipeFailure,
				mode: fallbackMode(),
				onFailure: runtimeOptions.onFailure
			};

			if (!runtime.failure) {
				try {
					runtime.mode = modeFactory(config, options.modeOptions);

					if (!runtime.mode || typeof runtime.mode.token !== 'function') {
						failLegacyStreamMode(runtime, {
							kind: 'invalid-mode',
							message:
								'Legacy stream mode factory did not return a token function.',
							phase: 'mode-factory'
						});
						runtime.mode = fallbackMode();
					}
				} catch (error) {
					failLegacyStreamMode(runtime, modeFailure('mode-factory', error));
					runtime.mode = fallbackMode();
				}
			} else {
				try {
					runtime.onFailure?.(runtime.failure);
				} catch {
					// A diagnostic callback must never make an editor failure worse.
				}
			}

			return {
				dispose() {
					if (runtime.disposed) {
						return;
					}

					runtime.disposed = true;
					runtime.documentService = undefined;
					runtime.mode = fallbackMode();
					runtime.onFailure = undefined;
				},
				language: publicLanguage,
				extension: [
					language,
					legacyStreamModeRuntimeFacet.of(
						runtime as LegacyStreamModeRuntime<unknown>
					),
					syntaxHighlighting(customTokenHighlightStyle)
				],
				get failure() {
					return runtime.failure;
				}
			};
		},
		language: publicLanguage
	};
}

export function createLegacyStreamModeAdapter<State>(
	modeFactory: LegacyStreamModeFactory<State>,
	options: LegacyStreamModeAdapterOptions
): LegacyStreamModeAdapter {
	const {documentService, onFailure, ...recipeOptions} = options;

	return createLegacyStreamModeAdapterRecipe(modeFactory, recipeOptions).create(
		{documentService, onFailure}
	);
}
