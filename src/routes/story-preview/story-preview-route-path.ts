import type {NativeStoryPreviewTarget} from '../../electron/shared';
import type {ProofingFormatSelection} from '../../store/use-publishing';

export interface StoryPreviewRouteOptions {
	passageId?: string;
	proofingFormat?: ProofingFormatSelection;
}

export function storyPreviewRoutePath(
	storyId: string,
	target: NativeStoryPreviewTarget,
	options: StoryPreviewRouteOptions = {}
) {
	const params = new URLSearchParams({target});

	if (options.passageId) {
		params.set('passage', options.passageId);
	}
	if (options.proofingFormat) {
		params.set('proofingFormatName', options.proofingFormat.name);
		params.set('proofingFormatVersion', options.proofingFormat.version);
	}

	return `/stories/${encodeURIComponent(storyId)}/preview?${params.toString()}`;
}
