import {Thunk} from '../../util/use-thunk-reducer';
import {fetchStoryFormatProperties} from '../../util/story-format/fetch-properties';
import {
	hydrateStoryFormatProperties,
	isBundledUnsupportedHarloweFormat
} from '../../util/story-format/hydrate-properties';
import {
	StoryFormat,
	StoryFormatProperties,
	StoryFormatsAction,
	StoryFormatsDispatch,
	StoryFormatsState
} from './story-formats.types';

const pendingFormatLoads = new Map<
	string,
	Promise<StoryFormatProperties | undefined>
>();

/**
 * Creates a new story format based on properties (probably loaded externally).
 */
export function createFromProperties(
	url: string,
	properties: StoryFormatProperties
): StoryFormatsAction {
	if (!properties.name || !properties.version) {
		throw new Error('Missing required properties for a new story format');
	}

	return {
		type: 'create',
		props: {
			url,
			name: properties.name,
			userAdded: true,
			version: properties.version
		}
	};
}

/**
 * Deletes a story format.
 */
export function deleteFormat(format: StoryFormat): StoryFormatsAction {
	return {type: 'delete', id: format.id};
}

async function loadFormatThunk(
	format: StoryFormat,
	dispatch: StoryFormatsDispatch
) {
	const pendingLoad = pendingFormatLoads.get(format.id);

	if (pendingLoad) {
		return pendingLoad;
	}

	dispatch({
		type: 'update',
		id: format.id,
		props: {loadState: 'loading'}
	});

	const loadPromise = (async () => {
		try {
			const rawProperties = await fetchStoryFormatProperties(format.url);
			const hydration = hydrateStoryFormatProperties(rawProperties, {
				skipLegacyHarloweEditor: isBundledUnsupportedHarloweFormat(format)
			});
			const properties = hydration.properties;

			dispatch({
				type: 'update',
				id: format.id,
				props: {
					...(hydration.diagnostic ||
					format.editorIntegrationDiagnostic !== undefined
						? {editorIntegrationDiagnostic: hydration.diagnostic}
						: {}),
					properties,
					loadState: 'loaded'
				}
			});

			return properties;
		} catch (loadError) {
			dispatch({
				type: 'update',
				id: format.id,
				props: {loadError: loadError as unknown as Error, loadState: 'error'}
			});
		} finally {
			pendingFormatLoads.delete(format.id);
		}
	})();

	pendingFormatLoads.set(format.id, loadPromise);
	return loadPromise;
}

/**
 * Loads all format properties. If loading previously failed, this will try
 * again.
 */
export function loadAllFormatProperties(
	formats: StoryFormat[]
): Thunk<StoryFormatsState, StoryFormatsAction, void | Promise<void>> {
	const toLoad = formats.filter(
		f => f.loadState !== 'loaded' && f.loadState !== 'loading'
	);

	if (!toLoad) {
		return () => {};
	}

	return async (dispatch: StoryFormatsDispatch) => {
		await Promise.allSettled(
			toLoad.map(format => loadFormatThunk(format, dispatch))
		);
	};
}

/**
 * Loads a format's properties. If loading previously failed, this function will
 * try again. This returns a thunk which in turns returns a promise resolving to
 * the format properties, which can be useful if you need them immediately.
 */
export function loadFormatProperties(
	format: StoryFormat
): Thunk<
	StoryFormatsState,
	StoryFormatsAction,
	StoryFormatProperties | Promise<StoryFormatProperties | undefined>
> {
	if (format.loadState === 'loaded') {
		return () => format.properties;
	}

	return async (dispatch: StoryFormatsDispatch) =>
		await loadFormatThunk(format, dispatch);
}
