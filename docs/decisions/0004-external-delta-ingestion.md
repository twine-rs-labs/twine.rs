# ADR 0004: Incremental external-delta ingestion

Status: accepted
Decision date: 2026-07-03
Last verified: 2026-07-04

## Context

Full project snapshots from the file watcher scaled with project size, repeated
parsing, obscured field-level conflicts, and raced with local edits and native
candidate acknowledgement.

## Decision

Native watching emits generation-bound, changed-path deltas. Rust atomically
classifies and applies typed field changes. Each delivered candidate is an
immutable lease until Accept Disk, Keep App, or Later resolves it.

Safe content-only changes merge automatically. Overlapping changes and all
external asset changes require review. External asset bytes are not undoable;
accepted inventory changes update Rust state without adding filesystem history.

## Consequences

- Watcher payload and parse work scale with changed entities.
- Exact-generation acknowledgement and delta-ID idempotence prevent duplicate
  ingestion.
- Renderer processing is FIFO per root and independent across roots.
- Full snapshots remain only for initialization and explicit recovery.
