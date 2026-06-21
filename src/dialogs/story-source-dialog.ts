import type {CoreContentsEntryKind} from '../core/bindings/CoreContentsEntryKind';
import type {CoreSearchScope} from '../core/bindings/CoreSearchScope';
import type {DialogsContextProps} from './context';
import {StoryDetailsDialog} from './story-details';
import {StoryJavaScriptDialog} from './story-javascript';
import {StoryStylesheetDialog} from './story-stylesheet';

type SourceDialogDispatch = DialogsContextProps['dispatch'];
type IndexedSourceKind = CoreContentsEntryKind | CoreSearchScope;

function storySourceDialog(
	sourceId: string | null | undefined,
	kind?: IndexedSourceKind
) {
	if (sourceId?.endsWith(':script') || kind === 'script') {
		return StoryJavaScriptDialog;
	}

	if (sourceId?.endsWith(':stylesheet') || kind === 'stylesheet') {
		return StoryStylesheetDialog;
	}

	if (sourceId?.endsWith(':metadata') || kind === 'metadata') {
		return StoryDetailsDialog;
	}
}

export function canOpenStorySource(
	sourceId: string | null | undefined,
	kind?: IndexedSourceKind
) {
	return !!storySourceDialog(sourceId, kind);
}

export function openStorySourceDialog(
	dispatch: SourceDialogDispatch,
	storyId: string,
	sourceId: string | null | undefined,
	kind?: IndexedSourceKind
) {
	const component = storySourceDialog(sourceId, kind);

	if (!component) {
		return false;
	}

	dispatch({type: 'addDialog', component, props: {storyId}});
	return true;
}
