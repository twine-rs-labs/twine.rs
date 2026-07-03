# Frontend boundaries

Status: current
Owner: React/core integration maintainers
Last verified: 2026-07-04
Source of truth: product mutation and query boundaries

## Persisted mutations

Every persisted product mutation enters through a bound core project session.
`useCoreProjectSession(storyId)` exposes apply, undo, redo, status, queries, and
patch subscriptions for the story's logical project.

Rust returns a `PatchBatch`. The frontend applies the batch through one
`applyCorePatchBatch` reducer action and emits one persistence notification.
Product routes must not reconstruct equivalent persistent reducer mutations.

`npm run check:core-boundaries` prevents legacy undo imports and reducer-owned
replace-all behavior from returning to product code.

## Permitted React state

The frontend may update non-persisted interaction state directly:

- selection and highlighting;
- focused editor and open editor windows;
- cursor, scroll, and CodeMirror view state;
- graph viewport, active tool, hover, and drag previews;
- panel and drawer layout;
- pending review and error presentation.

These changes do not enter Rust history.

## Queries

Queries wait for earlier mutations in the same session. Viewport and search
requests carry a generation so stale asynchronous results can be discarded.
Query payloads should remain result- or viewport-bounded.

## Undo

Workbench undo/redo uses Rust project history. Focused CodeMirror controls keep
their local editor history and consume standard shortcuts while focused.
Platform-standard workbench shortcuts apply outside editable controls.

## Compatibility code

Compatibility readers and writers may exist for legacy import/export. They are
not alternate product mutation paths. New functionality must not add a
TypeScript parser, index, asset inventory, or reducer history as a second source
of truth.
