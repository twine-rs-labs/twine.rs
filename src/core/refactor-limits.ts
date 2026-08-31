import type {PlanPassageRenameRequest} from './bindings/PlanPassageRenameRequest';
import type {PlanProjectReplaceRequest} from './bindings/PlanProjectReplaceRequest';
import type {PlanDiagnosticFixesRequest} from './bindings/PlanDiagnosticFixesRequest';
import type {DiagnosticFixSelection} from './bindings/DiagnosticFixSelection';

/** Versioned cross-boundary ceilings for diagnostic quick-fix selections. */
export const MAX_DIAGNOSTIC_FIX_SELECTION_IDS_V1 = 50_000;
export const MAX_DIAGNOSTIC_FIX_REQUEST_BYTES_V1 = 4 * 1024 * 1024;

export type DiagnosticFixRequestValidation =
	| {valid: true; bytes: number; request: PlanDiagnosticFixesRequest}
	| {valid: false; code: 'invalid-plan' | 'selection-too-large'};

/**
 * Serialize selections deterministically before measuring the wire payload.
 * This bounds both structured-clone work and Rust's JSON decode work even when
 * an untyped caller reaches this boundary.
 */
export function validateDiagnosticFixesRequest(
	request: unknown
): DiagnosticFixRequestValidation {
	if (!request || typeof request !== 'object')
		return {code: 'invalid-plan', valid: false};
	const candidate = request as {
		selection?: unknown;
		storyId?: unknown;
	};
	if (typeof candidate.storyId !== 'string' || !candidate.selection)
		return {code: 'invalid-plan', valid: false};
	const selection = candidate.selection as {
		excludedDiagnosticIds?: unknown;
		fixes?: unknown;
		type?: unknown;
	};
	let stableSelection: PlanDiagnosticFixesRequest['selection'];
	if (selection.type === 'only' && Array.isArray(selection.fixes)) {
		if (selection.fixes.length > MAX_DIAGNOSTIC_FIX_SELECTION_IDS_V1)
			return {code: 'selection-too-large', valid: false};
		const fixes: DiagnosticFixSelection[] = [];
		for (const fix of selection.fixes) {
			if (
				!fix ||
				typeof fix !== 'object' ||
				typeof (fix as {diagnosticId?: unknown}).diagnosticId !== 'string' ||
				typeof (fix as {quickFixCommand?: unknown}).quickFixCommand !== 'string'
			) {
				return {code: 'invalid-plan', valid: false};
			}
			fixes.push({
				diagnosticId: (fix as {diagnosticId: string}).diagnosticId,
				quickFixCommand: (fix as {quickFixCommand: string}).quickFixCommand
			});
		}
		stableSelection = {
			fixes,
			type: 'only'
		};
	} else if (
		selection.type === 'allSafe' &&
		Array.isArray(selection.excludedDiagnosticIds)
	) {
		if (
			selection.excludedDiagnosticIds.length >
			MAX_DIAGNOSTIC_FIX_SELECTION_IDS_V1
		)
			return {code: 'selection-too-large', valid: false};
		if (selection.excludedDiagnosticIds.some(id => typeof id !== 'string'))
			return {code: 'invalid-plan', valid: false};
		stableSelection = {
			excludedDiagnosticIds: selection.excludedDiagnosticIds.map(
				id => id as string
			),
			type: 'allSafe'
		};
	} else {
		return {code: 'invalid-plan', valid: false};
	}
	const normalizedRequest: PlanDiagnosticFixesRequest = {
		selection: stableSelection,
		storyId: candidate.storyId
	};
	const bytes = new TextEncoder().encode(
		JSON.stringify(normalizedRequest)
	).byteLength;
	return bytes > MAX_DIAGNOSTIC_FIX_REQUEST_BYTES_V1
		? {code: 'selection-too-large', valid: false}
		: {bytes, request: normalizedRequest, valid: true};
}

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
