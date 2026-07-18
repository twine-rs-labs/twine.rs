import type {Extension} from '@codemirror/state';
import type {StoryFormat} from '../../store/story-formats';
import {formatEditorExtensions} from './editor-extensions';
import {isBundledUnsupportedHarloweFormat} from './hydrate-properties';
import {
	createLegacyStreamModeAdapterRecipe,
	LegacyStreamModeAdapterRecipe
} from './legacy-editor/legacy-stream-mode';

export type GenericEditorFallbackReason =
	| 'extensions-disabled'
	| 'format-load-error'
	| 'format-not-installed'
	| 'format-not-loaded'
	| 'harlowe-legacy-incompatible'
	| 'hydrate-error'
	| 'no-compatible-extension'
	| 'no-editor-extension'
	| 'unsupported-extension';

export interface GenericEditorFallback {
	key: string;
	message: string;
	reason: GenericEditorFallbackReason;
	type: 'generic-fallback';
	unsupportedApi?: string;
}

export interface NativeEditorIntegration {
	extensions: readonly Extension[];
	key: string;
	ownsSyntax: boolean;
	type: 'native';
}

export interface AdaptedLegacyEditorIntegration {
	codeMirror: NonNullable<
		NonNullable<ReturnType<typeof formatEditorExtensions>>['codeMirror']
	>;
	formatId: string;
	formatName: string;
	formatVersion: string;
	key: string;
	lookAheadPolicy: 'chapbook-delimiter-presence' | 'current-document';
	modeAdapterRecipe?: LegacyStreamModeAdapterRecipe;
	type: 'adapted-legacy';
}

export type ResolvedEditorIntegration =
	| AdaptedLegacyEditorIntegration
	| GenericEditorFallback
	| NativeEditorIntegration;

export interface ResolveEditorIntegrationOptions {
	disabled?: boolean;
	nativeResolver?: (format: StoryFormat) => NativeEditorIntegration | undefined;
	twineVersion: string;
}

const legacyRecipeCache = new WeakMap<
	object,
	Map<string, AdaptedLegacyEditorIntegration>
>();
const propertiesGenerations = new WeakMap<object, number>();
let nextPropertiesGeneration = 1;
const bundledDelimiterOnlyChapbookUrls = new Set([
	'story-formats/chapbook-1.2.3/format.js',
	'story-formats/chapbook-2.3.1/format.js'
]);

function propertiesGeneration(properties: object) {
	let generation = propertiesGenerations.get(properties);

	if (generation === undefined) {
		generation = nextPropertiesGeneration++;
		propertiesGenerations.set(properties, generation);
	}

	return generation;
}

function genericFallback(
	reason: GenericEditorFallbackReason,
	message: string,
	unsupportedApi?: string
): GenericEditorFallback {
	return {
		key: `generic:${reason}:${unsupportedApi ?? ''}`,
		message,
		reason,
		type: 'generic-fallback',
		unsupportedApi
	};
}

function legacyLookAheadPolicy(format: StoryFormat) {
	return !format.userAdded &&
		format.name === 'Chapbook' &&
		bundledDelimiterOnlyChapbookUrls.has(format.url)
		? ('chapbook-delimiter-presence' as const)
		: ('current-document' as const);
}

/**
 * Resolves exactly one syntax integration for a loaded format.
 *
 * The cache is rooted in the hydrated properties object, so replacing or
 * reloading a same-name/version format naturally invalidates its recipe.
 */
export function resolveStoryFormatEditorIntegration(
	format: StoryFormat | undefined,
	options: ResolveEditorIntegrationOptions
): ResolvedEditorIntegration {
	if (!format) {
		return genericFallback(
			'format-not-installed',
			'Generic CM6 editor; selected format is not installed'
		);
	}

	if (options.disabled) {
		return genericFallback(
			'extensions-disabled',
			'Generic CM6 editor; format editor extensions disabled'
		);
	}

	if (format.loadState === 'error') {
		return genericFallback(
			'format-load-error',
			`Generic CM6 editor; format failed to load: ${format.loadError.message}`
		);
	}

	if (format.loadState !== 'loaded') {
		return genericFallback(
			'format-not-loaded',
			'Generic CM6 editor while format extensions load'
		);
	}

	const native = options.nativeResolver?.(format);

	if (native) {
		return native;
	}

	if (
		format.editorIntegrationDiagnostic?.code ===
			'legacy-harlowe-editor-unsupported' ||
		isBundledUnsupportedHarloweFormat(format)
	) {
		return genericFallback(
			'harlowe-legacy-incompatible',
			'Generic CM6 editor; legacy format toolbar unavailable',
			'Harlowe CodeMirror 5 editor runtime'
		);
	}

	if (format.editorIntegrationDiagnostic?.code === 'hydrate-error') {
		return genericFallback(
			'hydrate-error',
			format.editorIntegrationDiagnostic.message
		);
	}

	const editorExtensions = formatEditorExtensions(format, options.twineVersion);

	if (!editorExtensions) {
		return genericFallback(
			format.properties.editorExtensions?.twine
				? 'no-compatible-extension'
				: 'no-editor-extension',
			'Generic CM6 editor; no compatible format editor extension'
		);
	}

	if (!editorExtensions.codeMirror) {
		return genericFallback(
			'no-editor-extension',
			'Generic CM6 editor; format has no CodeMirror integration'
		);
	}

	const codeMirror = editorExtensions.codeMirror;

	if (codeMirror.mode !== undefined && typeof codeMirror.mode !== 'function') {
		return genericFallback(
			'unsupported-extension',
			'Generic CM6 editor; legacy mode is not a function',
			'codeMirror.mode'
		);
	}

	const propertiesIdentity = format.properties as object;
	const key = [
		format.id,
		format.name,
		format.version,
		format.url,
		propertiesGeneration(propertiesIdentity),
		'legacy'
	].join(':');
	let byIdentity = legacyRecipeCache.get(propertiesIdentity);

	if (!byIdentity) {
		byIdentity = new Map();
		legacyRecipeCache.set(propertiesIdentity, byIdentity);
	}

	const cached = byIdentity.get(key);

	if (cached) {
		return cached;
	}

	const recipe = Object.freeze({
		codeMirror,
		formatId: format.id,
		formatName: format.name,
		formatVersion: format.version,
		key,
		lookAheadPolicy: legacyLookAheadPolicy(format),
		modeAdapterRecipe: codeMirror.mode
			? createLegacyStreamModeAdapterRecipe(codeMirror.mode)
			: undefined,
		type: 'adapted-legacy' as const
	});

	byIdentity.set(key, recipe);
	return recipe;
}
