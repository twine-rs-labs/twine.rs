interface EditorOwner {
	documentBytes: number;
}

const editors = new Map<string, EditorOwner>();

function enabled() {
	return (
		typeof window !== 'undefined' &&
		!!(window as Window & {twinePerformanceNative?: unknown})
			.twinePerformanceNative
	);
}

export function registerPerformanceEditorOwner(id: string, text: string) {
	if (!enabled()) {
		return;
	}

	editors.set(id, {documentBytes: text.length * 2});
}

export function updatePerformanceEditorOwner(id: string, text: string) {
	if (!enabled() || !editors.has(id)) {
		return;
	}

	editors.set(id, {documentBytes: text.length * 2});
}

export function unregisterPerformanceEditorOwner(id: string) {
	editors.delete(id);
}

export function rendererMemoryOwnerSnapshot() {
	return {
		activeEditorCount: editors.size,
		editorDocumentBytes: [...editors.values()].reduce(
			(total, editor) => total + editor.documentBytes,
			0
		)
	};
}

export function resetRendererMemoryOwners() {
	// Active editors survive metric resets. Their ownership is live application
	// state, not accumulated diagnostic state.
}
