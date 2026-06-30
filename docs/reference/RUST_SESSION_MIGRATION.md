# Rust session migration

## Live architecture

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
- Native and local-storage writes carry the exact Rust session revision.
  Electron writes are queued per session and waiting writes coalesce to the
  newest state. Rust acknowledges only the revision that actually completed.
- External disk snapshots are converted to typed `CoreExternalDelta`
  transactions. Accepted changes are clean, undoable, and preserve older
  history.
- Retained history is bounded to 200 entries or 64 MiB and stores changed
  project metadata, story fields, and passage entities rather than complete
  project snapshots.
- Source analysis is cached per passage/script/stylesheet. A source edit
  reparses only that source; layout-only transactions reuse both source facts
  and graph facts. Graph edge resolution incrementally revisits the changed
  passage and sources targeting renamed/created/deleted passage names.

## Removed paths

The `UndoableStoriesContextProvider`, reverse-action/reverse-thunk reducers,
route wrappers, and test controls have been deleted. Persistent search/replace
now submits one Rust batch. `npm run check:core-boundaries` prevents legacy undo
imports and reducer-owned replace-all from returning to product code.

## Native asset effects

Electron asset imports, deletes, renames, and replacements prepare an effect
journal outside the project folder. The renderer passes the opaque token with
the Rust command. A rejected command immediately rolls the native effect back;
undo/redo executes the fingerprint-checked native inverse/forward effect before
moving the Rust cursor. Evicted and closed-session journals are discarded, and
startup removes crash leftovers because history is session-only. WASM performs
only model/reference changes and never accesses the filesystem.

The frontend remains a patch-applied read model. Removing the complete React
project mirror is a separate migration.

## Follow-up limits

- The native watcher still produces a session snapshot; the renderer converts
  it into passage/script/stylesheet/story deltas. Moving changed-path parsing
  fully into the native service remains a separate optimization.
- Incremental parse-count and no-full-transfer invariants are covered by unit
  tests. The wall-clock 50k-passage thresholds still need a stable release-mode
  benchmark runner before they can be enforced in CI without debug-build
  timing noise.
