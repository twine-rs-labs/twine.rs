# Performance optimization

Status: active
Owner: performance and architecture maintainers
Last verified: 2026-07-16
Source of truth: outstanding work revealed by accepted 10k/50k baselines

## Objective

Bring the structurally correct Rust/WASM/Electron path toward the tracked
roadmap budgets without weakening session ownership, watcher incrementality, or
fixture isolation.

## Work order

### 1. Startup and retained memory — active

- The harness now distinguishes fixed Electron working sets from
  project-attributable deltas at 100, 10k, and 50k passages. It reports browser,
  renderer, GPU, and utility roles plus bootstrap, native hydration lease,
  watcher baseline, descriptor, WASM, and Rust cache owners.
- Bootstrap documents are released only after successful Rust initialization;
  native leases are cleared in all completion paths. Post-GC startup assertions
  require both owners to retain zero passage text.
- The watcher accepted baseline retains file fingerprints and the lightweight
  descriptor, not story/passage snapshots. One-file saves update an indexed
  entry in place and avoid descriptor reload unless structural metadata or
  layout changed.
- A focused memory-detail phase now samples before editor creation, after editor
  creation and GC, after edit/save, after editor closure and GC, and across a
  bounded Contents visit. It attributes active editor document bytes, worker
  query-cache payloads and queues, Rust document/fingerprint/cache owners, main
  and renderer heap fields, and Electron process-role working sets. Release
  assertions prevent completed requests, editor documents, bootstrap bodies,
  or hydration leases from silently becoming retained owners.
- The first 50k detailed trace attributed the previous editor-time memory jump
  to eager aggregate queries, not CodeMirror. Shell and launcher word counts now
  use a cache-free scalar Rust query, and large-story aggregate dock queries are
  deferred until Contents, Assets, or global diagnostics are requested. The
  confirming trace kept analysis sources at one and the read-model cache empty
  through editor open/edit/save/close; the edit worker round trip was about
  7.5 ms and editor lifecycle retained roughly 6 MiB. The following standard
  diagnostic measured about 18.3 ms edit round trip and 19.9 ms edit-to-paint,
  materially improved from the preceding 36.6 ms sample and now close to the
  16.6 ms target.
- Selected-passage facts are now split into a one-source local query and a
  revision-bound backlink page. The backlink page uses a 16-entry/4 MiB LRU,
  retains only matching compact records, and patches resident targets from one
  changed source. Full graph layout/reachability remains explicit graph or
  aggregate work. The confirming 50k memory-detail run retained about 100.2 MiB
  of WASM and 1.026 GiB resident before editor open, with no graph/read-model
  cache, versus the preceding 197.5 MiB/1.13 GiB selected-passage state. Local
  facts and the first backlink page completed in a serialized 16.4 ms window
  with 782-byte and 116-byte responses. The default Contents route no longer
  constructs the 50,002-source read model or graph. Fresh 50k validation on
  2026-07-15 measured about 308 ms cold and 70.2 ms warm p95, with a 5.7 ms
  cached core request p95. Expensive intelligence filters remain explicit.
- All-filter label searches now stay on the compact Contents catalog; variables,
  assets, problems, and diagnostics still build intelligence only through their
  explicit filters. The confirming 50k query retained 116.5 MiB of WASM instead
  of 299.25 MiB, built no graph or complete read model, and measured 1.18 GiB
  post-GC resident memory.
- Save acknowledgement now merges only dirty fingerprint fields into the saved
  map. It preserves untouched key allocations and handles create/delete without
  the previous 500k-entry clone and its roughly 12–21 MiB WASM high-water cost.
- Memory contract 3 reports live and post-GC process working sets plus renderer
  heap, main heap/external memory, WASM, and residual runtime ownership. The
  latest query split is about 632 MiB Tab, 394 MiB Browser, 106 MiB GPU, and
  48 MiB Utility; finer attribution should focus on the 459 MiB renderer and
  358 MiB main native/runtime residuals rather than React documents or query
  payloads.

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
- The focused startup phase now attributes native shell and full-text loads,
  JSON parsing, renderer hydration, snapshot construction, worker/WASM session
  initialization, and first graph readiness. Memory checkpoints cover the same
  phases plus post-GC retained state, including WASM linear memory and Rust
  entity/cache counts.
- Renderer full-story JSON fingerprints and their repeated scans have been
  removed; Rust session status is the only persisted dirty-state authority.
  Stable-identity hydration also reuses the incoming 50k passage objects rather
  than cloning them solely to rewrite an unchanged story ID.
- File-backed WASM initialization waits for full passage hydration, then uses a
  short-lived main-process lease and bounded passage chunks to assemble a
  Rust-owned WASM bootstrap. No full project snapshot crosses renderer-to-worker
  IPC. Passage bodies are removed from the React read model; bounded
  document/fact queries and explicit workflow materialization serve consumers
  that previously scanned the complete story.
- Fresh 2026-07-12 validation confirms the retained host passage-body count is
  zero in diagnostic, query, and watcher runs. The 50k startup run still retains
  about 1.02 GiB across Electron processes after chunked bootstrap; query-cache
  residency previously reached about 1.27 GiB. Native-owned leasing now moves
  bodies out of the initial result while retaining exact receipt adoption. The
  50k native hydration output is about 22.50 MiB, interactive p50 about 2.27 s,
  and post-GC resident p50 about 1.017 GiB. Remaining payload is metadata and the
  50k-file receipt rather than duplicate passage documents.
- The first attributed cleanup reduced 50k shell p50 to about 0.96 s,
  interactive p50 to about 10.4 s, retained resident memory to about 1.14 GiB,
  and WASM linear memory to about 96 MiB.
- Native hydration now returns an immutable baseline receipt assembled from the
  file handles it already reads. The main process installs its watcher before
  hydration, adopts that receipt, and reconciles only changed-path hints that
  arrived during loading. A full metadata scan remains the explicit fallback
  when recursive watching is unavailable or the receipt is invalid.
- Focused 10k/50k startup runs verify there is no second full project traversal.
  At 50k, the native baseline is about 96 ms p50, receipt adoption about 69 ms,
  and unchanged-path catch-up about 0.016 ms. The subsequent watcher phase
  preserves passage, asset-review, immutable-lease, and recovery assertions.
- Shell and full load profiles are now explicit. Full hydration validates all
  paths before work begins and reads ordered passage results through one shared
  pool capped at eight workers. At 50k, native hydration improved from about
  4.47 s to a measured 2.03–2.59 s p50 range, and interactive startup improved
  from about 5.24 s to 2.84–3.66 s. The subsequent watcher phase passes.
- Before the compiled cache, the startup limit was split between 50k TOML shell
  parsing (about 402 ms), passage I/O (about 1.48–1.88 s), and core session
  construction (about 1.04 s). Avoid raising concurrency without controlled
  evidence; the benchmark supports `TWINE_NATIVE_LOAD_THREADS` experiments.
- A SHA-256-bound compiled manifest cache now replaces the repeated TOML decode
  on canonical projects. At 50k, compiled decoding is about 34–38 ms p50,
  shell native time improves from about 557 ms to 245 ms, and shell visibility
  improves from about 771 ms to 480 ms. Invalid or stale caches fall back to
  `twine.toml`; watcher cache paths remain ignored.
- The renderer-to-worker bootstrap is now bounded: the confirming 50k run used
  50 chunks of about 519 KiB and finalized the Rust session in about 430 ms.
  Interactive p50 was about 2.41 s and retained resident p50 about 1.02 GiB.
  Native-owned streaming now preserves the exact baseline receipt and watcher
  descriptor while reducing the native result from roughly 39 MiB to 22.5 MiB.
  Startup, diagnostic, and watcher phases pass. A smaller shell-only
  optimization may still pursue the remaining roughly 80 ms over the 400 ms
  target; further payload reduction would require a compact receipt transport.

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
- The post-cutover diagnostic instead measured about 557 ms in native baseline
  patching versus about 1.8 ms writing the touched passage. Profile and bound
  baseline file-entry updates before changing the incremental writer itself.
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
- Layout-only persistence now carries touched-passage hints through the renderer
  and atomically rewrites only `.twine/graph.json`; it preserves unrelated graph
  metadata, checks the accepted fingerprint, and patches the native baseline and
  descriptor without materializing passage documents. The graph benchmark makes
  a real layout edit and rejects full-save fallback or an unacknowledged final
  revision.
- Common non-structural external batches now build one compact entity delta for
  passage fields/layout, story metadata/sources/start passage, and project graph
  metadata. Structural upsert/delete and asset recovery retain the compatibility
  path; ordinary watcher changes no longer clone the complete session/project.
- Fresh 50k validation persisted four layout revisions through four incremental
  native saves with zero full-save fallbacks. Twenty clean edit samples measured
  23.4 ms paint p95. Five warm external edits measured 4.3 ms compact core
  ingestion p95, with no history work or graph reparse for topology-neutral
  text changes.

Exit signal: a one-passage edit or external delta does no project-scale index
rebuild; edit-to-paint and watcher ingestion materially improve against the
focused 50k measurements.

### 3. Contents, graph, and watcher latency

- Keep contents/search payloads result-bounded and avoid rebuilding complete
  frontend view models.
- The default All/Group page and basic Passage, Tag, Project, Script, and
  Stylesheet filters now use a revision-bound source-metadata catalog. Building
  and updating it parses no source, initializes no graph, and retains no full
  read model. Asset, variable, problem, orphan, and diagnostic intelligence is
  loaded only when its filter requires it. The harness separately records cold
  and warm Contents timings and requires the matching result to be painted with
  the worker queue drained.
- Profile graph layout, projection transfer, React reconciliation, canvas edge
  work, and frame scheduling separately.
- Reduce watcher observation and Rust reindex latency while retaining
  one-source parsing and immutable candidate leases. The focused 50k watcher
  run measured about 1.23 s Rust ingestion and about 3.88 s observation to
  passage patch before resident read-model maintenance landed. The attributed
  follow-ups improved those to roughly 150–291 ms and 592–826 ms respectively,
  with one touched source and no second full cache build. The watcher phase now
  records one warm-up plus five deterministic samples and splits Rust ingestion
  into lookup/delta, fingerprint, savepoint, graph, analysis, read-model,
  history, and patch-finalization stages. Use its p50/p95 distributions to
  select the next optimization; native file parsing is not currently the
  limiting stage.
  The first repeated profile measured core ingestion at 2.1 ms p50 and the WASM
  boundary at 0.1 ms p50, while observation-to-patch remained about 416 ms p50.
  Optimize the fixed watcher coalescing/native-delta and renderer-patch portions
  before changing the incremental Rust index pipeline.
- The 2026-07-15 run confirms that the core is no longer the watcher bottleneck:
  compact ingestion was 4.3 ms p95 while observation-to-patch was 324.8 ms p95.
  It selected graph interaction as the next latency target at 33.4 ms frame p95
  and a 400.1 ms maximum outlier.
- Graph viewport state now persists outside route React rendering, ordinary
  interaction no longer rescans the 50k-story bounds, and frame outliers record
  timestamps for correlation. Three clean 50k repeats on 2026-07-16 measured
  17.3–17.7 ms p95. The two warm repeats stayed at 33.3–33.4 ms maximum; only
  the first cold repeat exceeded 50 ms, at 135.1 ms. The final clean all-phase
  baseline measured 17.9 ms p95 and 33.4 ms maximum. Graph stability is closed
  as an active goal, so a deeper viewport-projection rewrite is conditional on
  a future reproducible regression. Contents and edit paint remain smaller
  optional follow-ups.

Exit signal: no full-source rebuilds, bounded rendering remains true, and each
surface materially improves against its accepted baseline.

### 4. Further memory reduction

- Measure native project storage, WASM session state, frontend metadata,
  analysis caches, graph data, and serialized transfer buffers separately.
- Bound or eliminate duplicate retained representations.
- The metadata-only React model is now enforced by distinct route-facing and
  materialized transport types. Bootstrap passage bodies are released after
  successful Rust session initialization, and product routes cannot read them
  from `Passage`.
- Remove or bound the remaining duplicate native hydration, worker request,
  snapshot-construction, and WASM representations rather than recreating a
  frontend passage-body cache.
- The 2026-07-13 one-sample 100/10k/50k matrix confirms that bootstrap text,
  hydration leases, hydration text capacity, and accepted-baseline passage
  snapshots all reach zero. The 50k process still retains about 1.04 GiB:
  roughly 412 MiB in the browser process, 497 MiB in the renderer process,
  105 MiB in the GPU process, and 48 MiB in utility. Explicit native path
  strings account for about 13.5 MiB and WASM linear memory for about 96 MiB.
  The next investigation should attribute the remaining browser/renderer
  project-size slope, especially renderer native allocations outside the
  roughly 52 MiB JavaScript heap.
- The repeatable three-sample matrix on 2026-07-16 measured project-bearing
  private memory at 136.8 MiB for 100 passages and 499.5 MiB for 50k, a
  362.7 MiB increase. Known logical owners explain about 162.1 MiB, or 44.7%,
  of that slope. The de-duplicated macOS physical footprint grew from 442.3 MiB
  to 811.9 MiB. Application VM tag 16 accounted for about 345.3 MiB of the
  369.6 MiB physical increase, with 248.9 MiB in the Tab process and 114.0 MiB
  in the Browser process; GPU and utility growth was negligible.
- The next goal is to use V8/Chromium heap or memory-infra profiling to split
  that application-tag growth by process and concrete project representation.
  Optimize the largest repeatable owner only after that attribution, preserving
  the measured WASM, native baseline, bounded-query, and graph invariants.

Exit signal: the dominant V8-backed project-size owner is named and resident
memory drops without replacing measured caches with unbounded recomputation.

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
