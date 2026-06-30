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
- The native project watcher emits generation-bound, changed-path
  `CoreExternalDelta` values. Passage, script, stylesheet, layout, manifest,
  and asset paths are parsed independently; the renderer no longer compares
  complete stories.
- Rust atomically classifies external fields against the saved field
  fingerprints. Non-overlapping content changes merge automatically;
  overlapping changes retain Accept Disk / Keep App / Later review.
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

Rust also owns the session asset inventory. External asset changes always enter
review because bytes changed outside the app. Accepting them updates inventory,
indexes, and diagnostics without adding a misleading byte-undo history entry.
Mixed external transactions retain undo only for their content/layout portion.

## Native watcher

Recursive watcher filenames drive 150 ms coalesced scans. The native
main-process service stats and parses only the hinted source paths, maintains an
accepted/candidate generation pair, and requires the renderer to acknowledge
the exact candidate ID after Rust commits it. A 30-second metadata
reconciliation catches missed events; the 1.25-second scan remains only where
recursive watching is unavailable. Generated graph caches are ignored.

Project identity, schema, invalid-manifest, unsafe-path, and unsupported
compatibility-metadata changes produce a recovery warning. The only full reload
path requires confirmation and explicitly resets session history.

The frontend remains a patch-applied read model. Removing the complete React
project mirror is a separate migration.

## Follow-up limits

- Incremental parse-count and no-full-transfer invariants are covered by unit
  tests. The wall-clock 50k-passage thresholds still need a stable release-mode
  benchmark runner before they can be enforced in CI without debug-build
  timing noise.
