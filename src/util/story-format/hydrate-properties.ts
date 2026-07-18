import type {StoryFormatProperties} from '../../store/story-formats';

export interface StoryFormatHydrationDiagnostic {
	code:
		| 'hydrate-error'
		| 'legacy-editor-runtime-error'
		| 'legacy-harlowe-editor-skipped'
		| 'legacy-harlowe-editor-unsupported'
		| 'native-editor-runtime-error';
	feature?: 'command' | 'mode' | 'provider' | 'toolbar';
	message: string;
	unsupportedApi?: string;
}

export interface HydratedStoryFormatProperties {
	diagnostic?: StoryFormatHydrationDiagnostic;
	properties: StoryFormatProperties;
}

export interface StoryFormatHydrationOptions {
	skipLegacyHarloweEditor?: boolean;
}

const bundledUnsupportedHarloweUrl = 'story-formats/harlowe-3.3.9/format.js';

export function isBundledUnsupportedHarloweFormat(format: {
	name: string;
	url: string;
	userAdded?: boolean;
	version: string;
}) {
	return (
		!format.userAdded &&
		format.name.toLocaleLowerCase() === 'harlowe' &&
		format.version === '3.3.9' &&
		format.url === bundledUnsupportedHarloweUrl
	);
}

/**
 * Harlowe's bundled hydration payload initializes a large, DOM-coupled
 * CodeMirror 5 integration as a side effect. Its runtime source is already
 * present in the serializable manifest, so editor migration can safely skip
 * hydration without changing play, test, proof, or publish output.
 */
export function hasUnsupportedHarloweEditorHydration(
	properties: Pick<StoryFormatProperties, 'hydrate' | 'name' | 'version'>
) {
	return (
		properties.name.toLocaleLowerCase() === 'harlowe' &&
		properties.version === '3.3.9' &&
		!!properties.hydrate
	);
}

/**
 * Runs the production story-format hydration contract in one place.
 *
 * Editor-only hydration failures are kept as diagnostics and the serializable
 * manifest remains usable for publishing.
 */
export function hydrateStoryFormatProperties(
	properties: StoryFormatProperties,
	options: StoryFormatHydrationOptions = {}
): HydratedStoryFormatProperties {
	if (!properties.hydrate) {
		return {properties};
	}

	if (
		options.skipLegacyHarloweEditor ??
		hasUnsupportedHarloweEditorHydration(properties)
	) {
		return {
			diagnostic: {
				code: 'legacy-harlowe-editor-skipped',
				message:
					'Legacy CM5 editor runtime skipped; native CM6 integration is available',
				unsupportedApi: 'Harlowe CodeMirror 5 editor runtime'
			},
			properties
		};
	}

	try {
		const hydrateResult: Partial<StoryFormatProperties> = {};
		const hydrateFunc = new Function(properties.hydrate);

		hydrateFunc.call(hydrateResult);
		return {properties: {...hydrateResult, ...properties}};
	} catch (error) {
		return {
			diagnostic: {
				code: 'hydrate-error',
				message: `Editor extensions could not be hydrated: ${
					error instanceof Error ? error.message : String(error)
				}`
			},
			properties
		};
	}
}
