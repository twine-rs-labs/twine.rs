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

- A local release-mode Electron harness now opens generated canonical 10k and
  50k `.twine.rs` folders through the real native/WASM/session path. It records
  startup phases, editor/undo/persistence latency, contents and search latency,
  graph frames, watcher parsing, bridge payloads, session ownership, and
  process memory. Independent startup/edit/query/graph/watcher processes,
  persistent launch checkpoints, a sanitized Electron environment, and a
  macOS teardown barrier keep failures attributable and retries isolated.
- Machine-independent incremental, worker/session, monotonic-revision,
  bounded-rendering, and no-full-replacement invariants fail immediately.
  Absolute roadmap targets remain report-only until a local machine baseline is
  explicitly accepted; matching baselines then enforce timing and memory
  regressions.
- Hosted CI, packaged-app performance, cross-machine baselines, and the
  optimization work identified by the first 10k/50k profiles remain separate
  follow-ups.
- Complete 10k and 50k Apple M4 runs now pass every structural invariant,
  including one worker/session, monotonic edit/undo/redo revisions,
  exact-revision persistence acknowledgement, bounded graph nodes, one-source
  passage watcher parsing, asset-only review, fixture immutability, isolated
  user data, and complete run-root cleanup. Matching local baselines are
  accepted for both sizes.
- The baseline profiles make the remaining optimization work explicit. At 50k,
  shell p50 is about 27.5 s, edit-to-paint p95 1.36 s, project-folder save p95
  29.25 s, contents p95 3.34 s, graph-frame p95 2.5 s, incremental watcher
  reindex 615.5 ms, and resident memory p50 1.93 GiB. Search p95 is 46.7 ms and
  meets its 50 ms target. Absolute targets remain report-only; matching-baseline
  regressions are blocking.
