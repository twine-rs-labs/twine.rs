interface EditorOwner {
	documentBytes: number;
	selectText?: (query: string) => boolean;
}

export type PerformanceRetainedObjectKind =
	| 'editorView'
	| 'legacyDocumentService'
	| 'legacyModeAdapter'
	| 'legacyToolbarDescriptorSet'
	| 'legacyToolbarFacade';

interface RetainedObjectCandidate {
	kind: PerformanceRetainedObjectKind;
	ref: WeakRef<object>;
}

const editors = new Map<string, EditorOwner>();
let retainedObjectCandidates: RetainedObjectCandidate[] = [];

function enabled() {
	return (
		typeof window !== 'undefined' &&
		!!(window as Window & {twinePerformanceNative?: unknown})
			.twinePerformanceNative
	);
}

export function registerPerformanceEditorOwner(
	id: string,
	text: string,
	controls?: Pick<EditorOwner, 'selectText'>
) {
	if (!enabled()) {
		return;
	}

	editors.set(id, {documentBytes: text.length * 2, ...controls});
}

export function updatePerformanceEditorOwner(id: string, text: string) {
	if (!enabled() || !editors.has(id)) {
		return;
	}

	editors.get(id)!.documentBytes = text.length * 2;
}

export function unregisterPerformanceEditorOwner(id: string) {
	editors.delete(id);
}

export function registerPerformanceRetainedObject(
	kind: PerformanceRetainedObjectKind,
	value: object
) {
	if (!enabled()) {
		return;
	}

	retainedObjectCandidates = retainedObjectCandidates.filter(
		candidate => candidate.ref.deref() !== undefined
	);
	retainedObjectCandidates.push({kind, ref: new WeakRef(value)});
}

export function selectPerformanceEditorText(id: string, query: string) {
	return editors.get(id)?.selectText?.(query) ?? false;
}

export function rendererMemoryOwnerSnapshot() {
	const retainedObjectCounts: Record<PerformanceRetainedObjectKind, number> = {
		editorView: 0,
		legacyDocumentService: 0,
		legacyModeAdapter: 0,
		legacyToolbarDescriptorSet: 0,
		legacyToolbarFacade: 0
	};

	retainedObjectCandidates = retainedObjectCandidates.filter(candidate => {
		if (!candidate.ref.deref()) {
			return false;
		}

		retainedObjectCounts[candidate.kind]++;
		return true;
	});

	return {
		activeEditorCount: editors.size,
		editorDocumentBytes: [...editors.values()].reduce(
			(total, editor) => total + editor.documentBytes,
			0
		),
		retainedEditorViewCount: retainedObjectCounts.editorView,
		retainedLegacyDocumentServiceCount:
			retainedObjectCounts.legacyDocumentService,
		retainedLegacyModeAdapterCount: retainedObjectCounts.legacyModeAdapter,
		retainedLegacyToolbarDescriptorSetCount:
			retainedObjectCounts.legacyToolbarDescriptorSet,
		retainedLegacyToolbarFacadeCount: retainedObjectCounts.legacyToolbarFacade
	};
}

export function resetRendererMemoryOwners() {
	// Active editors survive metric resets. Their ownership is live application
	// state, not accumulated diagnostic state.
}
