# Persistence and file watching

Status: current
Owner: Electron/native storage maintainers
Last verified: 2026-07-04
Source of truth: revision-safe project persistence and native watcher behavior

## Revision-safe saves

Persistence is queued per project session. A committed Rust patch batch
produces one save request. Waiting writes may coalesce to the newest revision,
but a completed write acknowledges only the exact revision that reached disk.
A newer edit therefore remains dirty, while undoing to an acknowledged
savepoint reports clean.

Web local storage and Electron project-folder storage implement the same
revision-aware contract.

## Incremental project-folder writes

Electron classifies the persisted changes from a committed patch batch before
saving. The first fast path covers a passage text-only edit: native code loads
the descriptor, verifies the accepted fingerprint for that passage file, writes
only that file through a temporary-file rename, and patches file-entry and story
baseline state for the exact revision. Its own watcher events are suppressed by
the refreshed baseline.

Scripts, stylesheets, and all broad or unsupported mutations currently fall
back to the full project-folder save. This includes project creation/import,
path or identity changes, schema recovery, and any change whose persisted paths
cannot be classified safely. Assets continue to use their separate native
effect-journal flow.

## Changed-path watcher deltas

The Electron watcher uses recursive filename hints, normalizes and coalesces
events for 150 ms, and parses only affected sources:

- one changed passage reads that passage;
- a script or stylesheet change reads that source;
- layout changes parse the layout source and diff its entries;
- asset changes stat and rebuild metadata for affected paths;
- manifest changes diff descriptors and read newly referenced or remapped
  sources.

A 30-second metadata reconciliation catches missed events when recursive
watching is available. The 1.25-second scan is only the watcher-unavailable
fallback. Generated graph-cache paths are ignored.

## Candidate lifecycle

Each delivered native delta is an immutable lease at generation `N+1` over an
accepted generation `N`.

- `awaitingResolution` candidates cannot be replaced while Rust ingestion or
  review is active.
- Events arriving meanwhile are retained and reconciled after resolution.
- Accept Disk promotes the exact candidate.
- Keep App writes the current session and rebuilds the accepted baseline.
- Later dismisses notification without changing Rust state, baseline, or
  generation.
- A deferred candidate is re-emitted only when its disk signature changes.

Resolution results are cached by delta ID so a repeated identical
acknowledgement is safe after IPC response loss. A different resolution for an
already-resolved ID is rejected.

The renderer runs one FIFO delta processor per project root. Different roots
remain independent; conflict review pauses only the affected root.

## Conflict and recovery rules

Rust compares incoming persisted fields against saved fingerprints.
Non-overlapping content fields merge automatically. Overlapping changes,
hierarchical deletes with dirty descendants, and every external asset change
enter review.

External content merges create one undo transaction. Accepted external asset
inventory changes update indexes and diagnostics without pretending that the
external bytes are undoable.

Project identity changes, unsupported schema changes, invalid manifests, unsafe
paths, and unrepresentable compatibility metadata use an explicit recovery
warning. Full snapshot replacement is limited to initial load, manual refresh,
Keep App baseline rebuilding, and confirmed recovery.

## Asset effects

App-initiated import, delete, rename, and replace operations use a native effect
journal outside the project folder. Native code validates and executes the file
effect before Rust commits the corresponding model change. A rejected Rust
command rolls back immediately.

Undo and redo execute fingerprint-checked inverse or forward native effects
before moving the Rust history cursor. Journal entries are removed when their
history transaction is evicted or the session closes.
