import type {StoryFormat} from '../../../store/story-formats';
import type {NativeEditorIntegration} from '../editor-integration';
import type {NativeEditorProviderLoader} from './types';

const HARLOWE_3_3_9_URL = 'story-formats/harlowe-3.3.9/format.js';
const harlowe339Loader: NativeEditorProviderLoader = async () => {
	const module = await import('../harlowe-3.3.9/provider.js');

	return {default: module.harlowe339Provider};
};
const integrationCache = new Map<string, NativeEditorIntegration>();

/**
 * Finds an app-owned provider by exact bundled format identity.
 *
 * Names and semver ranges are intentionally insufficient: user formats and
 * future Harlowe dialects must register their own provider instead of silently
 * inheriting 3.3.9 semantics.
 */
export function resolveNativeStoryFormatEditorIntegration(
	format: StoryFormat
): NativeEditorIntegration | undefined {
	if (
		format.userAdded ||
		format.name !== 'Harlowe' ||
		format.version !== '3.3.9' ||
		format.url !== HARLOWE_3_3_9_URL ||
		(format.loadState === 'loaded' &&
			(format.properties.name !== 'Harlowe' ||
				format.properties.version !== '3.3.9'))
	) {
		return undefined;
	}

	const key = `native:harlowe:3.3.9:${format.id}:${format.url}`;
	let integration = integrationCache.get(key);

	if (!integration) {
		const created: NativeEditorIntegration = Object.freeze({
			dialect: Object.freeze({
				family: 'harlowe',
				id: 'harlowe-3.3.9',
				version: '3.3.9'
			}),
			formatId: format.id,
			key,
			loadProvider: harlowe339Loader,
			ownsSyntax: true,
			type: 'native' as const
		});
		integrationCache.set(key, created);
		integration = created;
	}

	return integration;
}
