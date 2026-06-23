/**
 * An open editor buffer in the workspace dock. Passages tile freely (one
 * window each); the story JavaScript and Stylesheet are singletons. This is the
 * source of truth for what the dock renders — see WORKBENCH_INTEGRATION.md.
 */
export type EditorWindowSpec =
	| {kind: 'passage'; passageId: string}
	| {kind: 'script'}
	| {kind: 'stylesheet'};

/** Stable identity for a window, used as React key and for focus/close/reorder. */
export function editorWindowId(spec: EditorWindowSpec): string {
	return spec.kind === 'passage' ? `passage:${spec.passageId}` : spec.kind;
}

export function editorWindowsEqual(a: EditorWindowSpec, b: EditorWindowSpec) {
	return editorWindowId(a) === editorWindowId(b);
}
