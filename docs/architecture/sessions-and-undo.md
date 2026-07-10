# Sessions and undo

Status: current
Owner: core/session maintainers
Last verified: 2026-07-10
Source of truth: live Rust/WASM session architecture

## Session ownership

- A single `CoreProjectHostProvider` is mounted after story hydration.
- One WASM worker owns a map of Rust `ProjectSession`s. Every request carries a
  session ID. File-backed stories use their normalized project root; web-local
  and standalone stories use an independent story session.
- Mutations are serialized per session. Queries wait for earlier mutations and
  stale asynchronous query results are ignored by generation.
- Rust returns one `PatchBatch`; React applies it through one
  `applyCorePatchBatch` reducer action and persistence notification.
- Undo/redo, dirty state, savepoints, history labels, and monotonic revisions
  are owned by Rust. CodeMirror retains focused-editor text history.
- Retained history is bounded to 200 entries or 64 MiB and stores changed
  project metadata, story fields, and passage entities rather than complete
  project snapshots.
- Source analysis is cached per passage/script/stylesheet. A source edit
  reparses only that source; layout-only transactions reuse both source facts
  and graph facts. Graph edge resolution incrementally revisits the changed
  passage and sources targeting renamed/created/deleted passage names.
- Bounded read-model queries are revision-bound. Summary, cursor pages, and
  selected-passage facts wait behind mutations; a cursor from an older revision
  is rejected rather than combining results from two project states.

## Removed paths

The `UndoableStoriesContextProvider`, reverse-action/reverse-thunk reducers,
route wrappers, and test controls have been deleted. Persistent search/replace
now submits one Rust batch. `npm run check:core-boundaries` prevents legacy undo
imports and reducer-owned replace-all from returning to product code.

## Native effects and persistence

Asset journals, exact-revision saves, external deltas, and watcher candidate
resolution are documented in
[`persistence-and-watching.md`](./persistence-and-watching.md). Those operations
coordinate with the Rust history cursor but remain native filesystem
responsibilities.

## Current boundaries

- History is session-only and is not restored after an app restart.
- Electron uses native Rust for project load/save/watch operations, while
  renderer commands and queries use the shared WASM worker sessions.
- React remains a patch-applied project read model. Removing the complete
  frontend project mirror is a separate future architecture change.
- Tauri and a persistent N-API command session are not part of the current
  architecture.
