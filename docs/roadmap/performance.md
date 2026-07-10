# Performance optimization

Status: active
Owner: performance and architecture maintainers
Last verified: 2026-07-10
Source of truth: outstanding work revealed by accepted 10k/50k baselines

## Objective

Bring the structurally correct Rust/WASM/Electron path toward the tracked
roadmap budgets without weakening session ownership, watcher incrementality, or
fixture isolation.

## Work order

### 1. Bounded startup read model

- Profile native project load, renderer hydration, session initialization, and
  first-route queries independently.
- Bound initial story-index and contents payloads to the visible or requested
  result set. A 50k trace previously transferred a roughly 28 MiB story-index
  result to the renderer, contributing to startup time and duplicate memory.
- Remove redundant full-project serialization and frontend work before the first
  useful viewport.
- Preserve one project session and no post-initialization `replaceProject`.

Exit signal: shell and interactive phases show a material baseline improvement
with unchanged structural assertions.

### 2. Incremental indexing and edit-to-paint

- The first incremental project-folder write is complete: a passage text edit
  writes one file in place, checks its accepted fingerprint, patches the native
  baseline, and acknowledges the exact Rust revision. Unsupported or broad
  mutations retain the full-save fallback.
- Use the diagnostic phase to keep that path observable. The focused 50k run
  measured about 149 ms native save time for one touched path, so it is not the
  dominant remaining edit cost.
- Make local and external passage edits update only that passage's parsed facts,
  search document, links, backlinks, and affected graph topology. Undo/redo
  must use the same forward/inverse cache-delta path.
- Keep one persistence notification per committed patch batch and exact
  revision acknowledgement.

Exit signal: a one-passage edit or external delta does no project-scale index
rebuild; edit-to-paint and watcher ingestion materially improve against the
focused 50k measurements.

### 3. Contents, graph, and watcher latency

- Keep contents/search payloads result-bounded and avoid rebuilding complete
  frontend view models.
- Profile graph layout, projection transfer, React reconciliation, canvas edge
  work, and frame scheduling separately.
- Reduce watcher observation and Rust reindex latency while retaining
  one-source parsing and immutable candidate leases. The focused 50k watcher
  run measured about 1.23 s Rust ingestion and about 3.88 s observation to
  passage patch; native changed-path parsing is not the limiting stage.

Exit signal: no full-source rebuilds, bounded rendering remains true, and each
surface materially improves against its accepted baseline.

### 4. Memory

- Measure native project storage, WASM session state, frontend mirrors,
  analysis caches, graph data, and serialized transfer buffers separately.
- Bound or eliminate duplicate retained representations.
- Preserve the current React mirror until its removal is designed as an
  explicit architecture change.

Exit signal: resident memory drops without replacing measured caches with
unbounded recomputation.

## Targets

Tracked absolute targets remain:

- shell visible at or below 400 ms;
- interactive/open at or below 1.5 s;
- passage reindex compute at or below 5 ms;
- search and contents at or below 50 ms;
- edit-to-paint and graph p95 at or below 16.6 ms;
- graph maximum frame at or below 50 ms;
- resident memory at or below 600 MiB.

Initial target misses are reporting data, not permission to relax the targets.
Matching-baseline regression gates remain blocking throughout optimization.

## Deferred

Packaged-app benchmarking, hosted CI, and cross-machine comparisons belong to
the release roadmap. They should consume this harness rather than create a
second measurement contract.
