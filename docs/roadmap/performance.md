# Performance optimization

Status: active
Owner: performance and architecture maintainers
Last verified: 2026-07-11
Source of truth: outstanding work revealed by accepted 10k/50k baselines

## Objective

Bring the structurally correct Rust/WASM/Electron path toward the tracked
roadmap budgets without weakening session ownership, watcher incrementality, or
fixture isolation.

## Work order

### 1. Bounded startup read model — implemented, validation pending

- Profile native project load, renderer hydration, session initialization, and
  first-route queries independently.
- Bound initial story-index and contents payloads to the visible or requested
  result set. A 50k trace previously transferred a roughly 28 MiB story-index
  result to the renderer, contributing to startup time and duplicate memory.
- Remove redundant full-project serialization and frontend work before the first
  useful viewport.
- Preserve one project session and no post-initialization `replaceProject`.
- The first cut is live: generated Rust/WASM queries now provide story
  summaries, revision-bound Contents/search/diagnostics/assets pages, and
  selected-passage facts. Large Contents no longer performs the old idle full
  index load, and default full-index calls are statically prohibited from
  product code.
- Contents records are now keyed by stable entity ID inside Rust. Ordinary
  passage text, layout, tag, story-source, and start-passage mutations update an
  existing bounded cache in place; undo/redo and external text ingestion use
  the same path. Perf metrics expose parsed-source, full-build, incremental
  update, and last-touched-source counters.
- Focused query runs now transfer roughly 19 KiB for Contents instead of the old
  roughly 28 MiB compatibility index. Remaining work is cold-start profiling
  and removal of compatibility full-index calls from explicitly complete
  workflows where paging is practical.

Exit signal: shell and interactive phases show a material baseline improvement
with unchanged structural assertions.

### 2. Incremental indexing and edit-to-paint — in progress

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
- The hot local and external one-passage text paths now record an entity delta
  and reuse source/graph caches instead of cloning and diffing the entire
  project. Passage moves now retain only touched passage/layout entities in
  history rather than a complete project-layout snapshot. Passage tag and
  layout changes do not reparse text.
- Structural story replacement, reference-rewriting rename operations, broad
  batches, and explicit recovery retain compatibility fallbacks. These should
  be narrowed by command family, but they are no longer on the ordinary edit,
  undo/redo, Contents, or watcher text path.

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
  passage patch before resident read-model maintenance landed. The attributed
  follow-ups improved those to roughly 150–291 ms and 592–826 ms respectively,
  with one touched source and no second full cache build. Further work should
  add stage-level Rust timings or repeated samples before optimizing the
  remaining graph/topology and renderer-patch portions; native file parsing is
  not the limiting stage.

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
