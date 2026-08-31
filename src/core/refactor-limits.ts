import type {PlanPassageRenameRequest} from './bindings/PlanPassageRenameRequest';
import type {PlanProjectReplaceRequest} from './bindings/PlanProjectReplaceRequest';

/** Versioned cross-boundary ceiling for passage-rename request strings. */
export const MAX_PASSAGE_RENAME_REQUEST_STRING_BYTES_V1 = 64 * 1024;

export function passageRenameRequestStringBytes(
	request: PlanPassageRenameRequest
) {
	return (
		new TextEncoder().encode(request.storyId).byteLength +
		new TextEncoder().encode(request.passageId).byteLength +
		new TextEncoder().encode(request.afterName).byteLength
	);
}

export function isPassageRenameRequestTooLarge(
	request: PlanPassageRenameRequest
) {
	return (
		passageRenameRequestStringBytes(request) >
		MAX_PASSAGE_RENAME_REQUEST_STRING_BYTES_V1
	);
}

export function projectReplaceRequestStringBytes(
	request: PlanProjectReplaceRequest
) {
	const encoder = new TextEncoder();
	return (
		encoder.encode(request.storyId).byteLength +
		encoder.encode(request.query).byteLength +
		encoder.encode(request.replacement).byteLength
	);
}

export function isProjectReplaceRequestTooLarge(
	request: PlanProjectReplaceRequest
) {
	return (
		projectReplaceRequestStringBytes(request) >
		MAX_PASSAGE_RENAME_REQUEST_STRING_BYTES_V1
	);
}
