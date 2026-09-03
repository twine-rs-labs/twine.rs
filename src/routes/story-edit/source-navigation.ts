import type {CoreAssetReference} from '../../core/bindings/CoreAssetReference';
import type {CoreContentsEntry} from '../../core/bindings/CoreContentsEntry';
import type {CoreSearchScope} from '../../core/bindings/CoreSearchScope';
import type {Story} from '../../store/stories';
import type {EditorWindowSpec} from './editor-window-spec';

export type SourceNavigationTarget =
	| {kind: 'passage'; passageId: string}
	| {kind: 'script'}
	| {kind: 'stylesheet'};

export type SourceNavigationFocusIntent = 'editor' | 'preserve';

const focusPreservationLeases = new Map<string, 'available' | 'claimed'>();
let nextFocusPreservationLease = 0;

export function allocateSourceNavigationFocusPreservationLease() {
	const token = `source-focus-${++nextFocusPreservationLease}`;

	focusPreservationLeases.set(token, 'available');
	return token;
}

export function claimSourceNavigationFocusPreservationLease(
	token: string | undefined
) {
	if (!token || focusPreservationLeases.get(token) !== 'available') {
		return false;
	}

	focusPreservationLeases.set(token, 'claimed');
	return true;
}

export function releaseSourceNavigationFocusPreservationLease(
	token: string | undefined
) {
	return token ? focusPreservationLeases.delete(token) : false;
}

export interface SourceNavigationSearch {
	query: string;
	scope?: CoreSearchScope;
}

export interface SourceNavigationOptions {
	endOffset?: number | null;
	focus?: SourceNavigationFocusIntent;
	line?: number | null;
	mode?: 'graph' | 'split' | 'text';
	offset?: number | null;
	restoreToken?: string;
	search?: SourceNavigationSearch;
	target?: SourceNavigationTarget;
}

export interface SourceNavigationResolution {
	spec?: EditorWindowSpec;
	target?: SourceNavigationTarget;
}

export function sourceNavigationTargetFromSourceId(
	sourceId: string | null | undefined,
	passageId?: string | null
): SourceNavigationTarget | undefined {
	if (passageId) {
		return {kind: 'passage', passageId};
	}

	if (sourceId?.endsWith(':script')) {
		return {kind: 'script'};
	}

	if (sourceId?.endsWith(':stylesheet')) {
		return {kind: 'stylesheet'};
	}
}

export function sourceNavigationTargetFromContentsEntry(
	entry: CoreContentsEntry
) {
	return sourceNavigationTargetFromSourceId(entry.sourceId, entry.passageId);
}

export function sourceNavigationTargetFromAssetReference(
	reference: CoreAssetReference
) {
	return sourceNavigationTargetFromSourceId(
		reference.sourceId,
		reference.passageId
	);
}

export function sourceNavigationTargetFromQuery(
	value: string | null
): SourceNavigationTarget | undefined {
	if (!value) {
		return undefined;
	}

	if (value === 'script') {
		return {kind: 'script'};
	}

	if (value === 'stylesheet') {
		return {kind: 'stylesheet'};
	}

	if (value.startsWith('passage:')) {
		const passageId = value.slice('passage:'.length);

		return passageId ? {kind: 'passage', passageId} : undefined;
	}
}

export function sourceNavigationTargetQueryValue(
	target: SourceNavigationTarget
) {
	return target.kind === 'passage'
		? `passage:${target.passageId}`
		: target.kind;
}

export function editorWindowSpecForSourceNavigationTarget(
	target: SourceNavigationTarget
): EditorWindowSpec {
	return target.kind === 'passage'
		? {kind: 'passage', passageId: target.passageId}
		: {kind: target.kind};
}

export function resolveSourceNavigationTarget(
	story: Story,
	target: SourceNavigationTarget | undefined
): SourceNavigationResolution {
	if (!target) {
		return {};
	}

	if (
		target.kind === 'passage' &&
		!story.passages.some(passage => passage.id === target.passageId)
	) {
		return {};
	}

	return {
		spec: editorWindowSpecForSourceNavigationTarget(target),
		target
	};
}

export function sourceTarget(
	story: Story,
	{
		endOffset,
		focus = 'editor',
		line,
		mode = 'text',
		offset,
		restoreToken,
		search,
		target
	}: SourceNavigationOptions
) {
	const query = new URLSearchParams({mode});

	if (target) {
		query.set('source', sourceNavigationTargetQueryValue(target));
	}

	if (search?.query) {
		query.set('q', search.query);

		if (search.scope) {
			query.set('scope', search.scope);
		}
	}

	if (typeof offset === 'number' && Number.isFinite(offset)) {
		query.set('offset', String(Math.max(0, Math.trunc(offset))));
	}

	if (typeof endOffset === 'number' && Number.isFinite(endOffset)) {
		query.set('end', String(Math.max(0, Math.trunc(endOffset))));
	}

	if (focus === 'preserve') {
		query.set('focus', focus);
	}

	if (restoreToken) {
		query.set('restoreToken', restoreToken);
	}

	if (typeof line === 'number' && Number.isFinite(line)) {
		query.set('line', String(Math.max(1, Math.trunc(line))));
	}

	return `/stories/${story.id}?${query.toString()}`;
}
