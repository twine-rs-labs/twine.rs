# twine.rs Performance Roadmap — Blistering Fast at Transylvania Scale

This roadmap makes `twine.rs` open, navigate, and edit massive real projects (the
`Transylvania0.6.01` sample: **4,622 passages, 2,889 links, 2,656 asset files, ~404 MB**)
feel instant. It is **fully aligned with the dream architecture**, not a parallel plan:
every major item here is a step toward _making the Rust/WASM/native `ProjectSession` the
live product authority_
that [`TWINE_RS_MILESTONES.md`](./TWINE_RS_MILESTONES.md) already names as the remaining
scale risk for **M2** and the foundation for **M4**. We are not inventing a new engine — we
are letting the engine that already exists do the work it was built for.

> **The one fact that explains everything.** The Rust core already loads and projects the
> real Transylvania folder in **~0.7–1.1s cold from the CLI** (`twine_cli graph <folder>`).
> The Electron app takes **~7s** for the same project because the live app _reimplements_
> parsing, indexing, graph projection, and search in TypeScript, on the main thread, and
> re-reads/re-scans the project several times on open. The generated bindings in
> [`src/core/bindings/`](../../src/core/bindings/) were emitted by `ts-rs` "for the workbench
> bridge," but **nothing crosses that bridge yet**. Closing that gap is the whole game.

## 0. Architecture Lock: Rust Owns The Product Model

As of the P3 push, the roadmap assumes an explicit Rust-first direction:

- Rust is the source of truth for project state, story semantics, parsing, indexing, graph
  facts, command validation, patch generation, undo/redo, import/export, asset manifests,
  external-edit reingest, and publish/build preparation.
- TypeScript is allowed to own presentation, transient UI/workspace state, React rendering,
  CodeMirror integration, keyboard/accessibility behavior, and applying Rust patches to the
  visible UI state. It must not be the long-term owner of story/project semantics.
- Generated TypeScript bindings are an adapter surface generated from Rust, not an alternate
  schema and not permission to reimplement the core model in TS.
- Fallbacks and compatibility producers are temporary migration scaffolding. They must be
  feature-flagged, observable in diagnostics/perf artifacts, and removed or demoted to test-only
  once the Rust path exists. A milestone is not complete while its core behavior still depends on
  a TypeScript producer.
- It is acceptable for a Rust cutover to break TypeScript-era assumptions temporarily. Fix the
  product around the Rust authority instead of preserving a second implementation.
- This roadmap is a deletion roadmap as much as a build roadmap. Because `twine.rs` is not yet a
  user-dependent product, we should kick out compatibility supports aggressively after each Rust
  cutover. Temporary breakage is acceptable; silent dual ownership is not.

## 0.1 Review Position

I agree with the roadmap's direction: **the app should become a thin, responsive UI over the
Rust core**, not a second TypeScript implementation of the same domain model. The plan is right
to prioritize the bridge over local micro-optimizations, because the Rust crates already own the
fast graph/index/session primitives and the TypeScript layer is currently paying the largest
costs in the worst place: first paint and input frames.

The main refinement is sequencing. The TS graph path is not completely naive anymore - it already
has spatial-cell viewport projection - so the biggest immediate wins are:

1. stop hydrating/serializing work the first screen cannot use,
2. stop repeating filesystem scans and full-story indexes,
3. move query-heavy work behind revisioned worker/native sessions, and
4. keep React rendering O(viewport), not O(project).

In other words: use Phase 0 to shrink the live data shape and de-risk lazy hydration, then use
Phases 1-2 to replace the computational owners. Do not wait until the full native runtime to fix
the contents screen, project-open lifecycle, and file-scan duplication.

---

## 1. Current State (measured)

### 1.1 Where the ~7 seconds goes (project open, critical path)

| #   | Step                                | Location                                                                                      | Cost at Transylvania scale                                    | Critical path            |
| --- | ----------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------ |
| 1   | Read **all** passage files          | [project-folder.ts](../../src/electron/main-process/project-folder.ts) `readProjectStories()` | ~4,622 file reads, **~2–3s**                                  | YES                      |
| 2   | Scan `assets/` tree (1st time)      | `listProjectAssets()` / `scanAssetDirectory()`                                                | ~2,656 `stat()` + walk, ~80–150ms                             | YES                      |
| 3   | Scan `assets/` tree (2nd)           | `projectSessionSnapshot()` → manifest                                                         | duplicate walk                                                | YES                      |
| 4   | Scan `assets/` tree (3rd)           | `startProjectSession()` baseline                                                              | duplicate walk                                                | YES                      |
| 5   | Synchronous HTML DOM parse of story | [import.ts](../../src/util/import.ts) `importStories()`                                       | `innerHTML` + `querySelectorAll` over 4,622 nodes, ~200–400ms | YES                      |
| 6   | Build story index on first view     | [story-index.ts](../../src/core/story-index.ts) `storyToCoreIndex()`                          | O(n²)-ish link/diagnostic pass, **~500–1000ms**               | YES (if a passage opens) |
| 7   | Graph projection / layout (JS)      | [graph-projection.ts](../../src/core/graph-projection.ts)                                     | O(n) build + O(n) layout, WeakMap-cached                      | on demand                |
| 8   | PassageMap mount                    | [passage-map.tsx](../../src/components/passage/passage-map/passage-map.tsx)                   | O(n) bounding-rect + visible filter on first render           | YES                      |

**Total critical path: ~3.2–5.2s minimum**, plus GC pauses on ~4.6k Story/Passage object
allocations, persistence write-back, and React render churn → ~7s observed.

### 1.2 Root causes (not project size — architecture)

1. **Rust is not wired into the live app as authority.** `twine_core::ProjectSession`,
   `twine_graph::GraphIndex`, and the parsers are production-ready but reachable only through
   `twine_cli`. The renderer's [project-host.ts](../../src/core/project-host.ts) re-implements
   the command→patch model against Redux in TypeScript; bindings are imported `type`-only. This
   is migration debt, not an acceptable destination.
2. **Everything is on the main thread.** Parse, index, projection, and search block first
   paint and block every keystroke/pan frame.
3. **Redundant work.** The asset tree is walked up to 3× on open; passage text is read in full
   even when only identity/layout is needed to paint the graph.
4. **Eager, not incremental.** A one-character passage edit can invalidate whole-story indexes
   instead of patching the affected slice — exactly the incremental-reindex behavior the
   External-edit rule and M4 call for.
5. **The renderer still carries full `Story` objects as the unit of truth.** This makes cheap
   operations expensive: opening a project allocates every passage body, contents queries build
   complete indexes before the list can render, and WeakMap caches miss whenever reducer updates
   replace the `Story` object. The Rust bridge must not simply shuttle the same giant objects
   across a faster boundary.
6. **Contents is a first-class perf surface, not a secondary view.** [contents-route.tsx](../../src/routes/contents/contents-route.tsx)
   calls `queryStoryIndex()` on mount, derives a full contents view model, filters/sorts the full
   array, and maps every visible row. At 4.6k passages plus tags/assets/diagnostics this is enough
   to feel slow even if the graph itself is fast.
7. **Session sync can keep the disk busy after open.** The watcher baseline/conflict path is
   correct for safety, but it currently depends on rescanning project files. That must become an
   incremental native file-manifest diff before polling large projects becomes background jank.

### 1.3 What already exists to build on

- **Rust core:** `twine_graph` has `GraphIndex::from_story`, `layout_snapshot`,
  `canvas_projection_from_snapshot` (spatial-cell viewport projection, `SPATIAL_CELL_SIZE=512`).
  `twine_core::ProjectSession` has the full command→patch spine, undo/redo, and a per-story
  `graph_cache`. Measured: **50k-node index ~351ms, viewport projection ~2–4ms**.
- **Bindings:** `ts-rs`-generated types in [src/core/bindings/](../../src/core/bindings/)
  already define the exact contract (`CoreGraphProjection`, `StoryCommand`, `PatchBatch`, …).
- **Benchmark CLI:** `twine_cli bench-graph [N]` and `twine_cli graph <path>`.
- **Fixtures:** [benchmarks/generate-fixtures.mjs](../../benchmarks/generate-fixtures.mjs)
  → `npm run bench:fixtures` / `:large` (1k/5k/10k/50k, deterministic links).
- **Test harnesses:** Jest + jsdom (114 suites), Playwright ([e2e/](../../e2e/)), `cargo test`.
- **Boundary-shaped UI surfaces:** the newer graph/contents work already routes through
  `useCoreProjectHost()` and generated core types. That is good news: many call sites can switch
  from `StoreCoreProjectHost` to a WASM/native-backed host without a wholesale UI rewrite. That
  switch is required, not optional, for the relevant milestones to close.

---

## 2. Performance Contract (the budgets every headless test asserts)

These extend the M2 contract ("10k pan/zoom smooth, 50k navigable, sub-ms projection") into
measurable, CI-enforceable budgets. Reference machine: Apple Silicon dev laptop, release build.

| Surface                         | Metric                              | Target                            | Stretch                 | Hard fail (CI gate)    |
| ------------------------------- | ----------------------------------- | --------------------------------- | ----------------------- | ---------------------- |
| **Project open** (Transylvania) | cold open → interactive             | ≤ **1.5s**                        | ≤ 800ms                 | > 3s                   |
| Project open                    | time to first paint (shell visible) | ≤ 400ms                           | ≤ 200ms                 | > 1s                   |
| **Graph pan/zoom**              | viewport projection (10k)           | < **1ms** p50                     | sub-ms p99              | > 4ms p50              |
| Graph pan/zoom                  | frame time during drag              | ≤ 16.6ms (60fps)                  | ≤ 8ms (120fps)          | any frame > 50ms       |
| Graph                           | no node/edge popping                | 0 frames with edges lagging nodes | —                       | visible desync         |
| **Editor**                      | keystroke → paint (50k story)       | ≤ 16ms                            | ≤ 8ms                   | > 50ms                 |
| **Search / contents**           | query over 50k passages             | ≤ 50ms                            | ≤ 10ms                  | > 250ms                |
| **Incremental edit**            | reindex after 1 passage change      | ≤ 5ms                             | ≤ 1ms                   | full-story rebuild     |
| **Memory**                      | resident set, Transylvania open     | ≤ 600MB                           | ≤ 350MB                 | > 1.2GB                |
| **Asset listing**               | first asset grid paint              | ≤ 300ms                           | ≤ 100ms                 | blocks open            |
| **Rust authority**              | command/index/projection owner      | Rust/WASM/native                  | TS applies patches only | TS computes core facts |
| **Boundary overhead**           | serialized bytes per graph query    | viewport-bounded                  | no full story transfer  | sends full `Story`     |
| **React render shape**          | rows/nodes mounted at 50k           | O(viewport)                       | stable under scroll     | O(n) mount             |

---

## 3. Architecture: One Rust Core, Two Deployment Targets (decided)

We compile **the same `twine_core` / `twine_graph` code** to two runtime homes and never spawn
a process per interaction:

```
                 ┌─────────────────────────────────────────────┐
                 │            twine_core::ProjectSession         │
                 │   (command → patch, graph_cache, undo/redo)   │
                 └───────────────┬───────────────┬───────────────┘
            wasm-bindgen target  │               │  N-API target (napi-rs)
                                 ▼               ▼
                 ┌───────────────────────┐  ┌───────────────────────────┐
                 │  RENDERER (WASM)       │  │  MAIN PROCESS (native .node)│
                 │  • graph projection    │  │  • project folder load/save │
                 │  • story index/search  │  │  • file watch + diff        │
                 │  • link parse          │  │  • asset scan (rayon)       │
                 │  • runs in Web Worker  │  │  • import (zip/html)        │
                 └───────────────────────┘  └───────────────────────────┘
```

- **Renderer = WASM**, ideally inside a **Web Worker**, so projection/index/search never block
  paint or input. The viewport projection is already viewport-bounded and sub-ms in Rust; in
  WASM it returns a tiny `CoreGraphProjection` the React layer just draws.
- **Main = N-API native addon** (`napi-rs`), so folder load, watch, asset scan, and import use
  `tokio`/`rayon` with zero per-call startup cost. This replaces the JS `readProjectStories` /
  triple asset scan / sync import path.
- **Contract is already written:** the `ts-rs` bindings are the wire format. The renderer talks
  `StoryCommand` in, `PatchBatch` out — exactly the host interface
  [project-host.ts](../../src/core/project-host.ts) already models.

### 3.1 Data ownership: revisioned Rust sessions, not giant story transfers

The runtime boundary must expose a **Rust session-owned project model** with small, revisioned
views:

- `ProjectShellSnapshot`: project/story metadata, story ids, passage ids, names, tags, layout,
  file paths, start passage, story format, asset inventory summary. This is enough for the shell,
  graph, contents skeleton, and navigation.
- `PassageBodySnapshot`: the text for one passage or a small requested batch, loaded when an
  editor/source/detail surface needs it.
- `CoreStoryIndex` / `CoreGraphProjection`: query results derived from the Rust-owned session,
  keyed by `storyId`, `revision`, query options, and viewport.
- `ProjectFileManifest`: the native file watcher baseline/diff, shared by open, sync, asset
  listing, and conflict review.

The renderer should not need to hold every passage body to pan the graph or open contents. Search,
diagnostics, backlinks, asset references, and word counts can be computed in Rust over Rust-owned
text and returned as bounded result sets. This is what prevents the bridge from becoming "same
object churn, faster language."

### 3.2 Worker/native protocol rules

- **Latest query wins.** Pan/zoom can generate many viewport queries; only the newest viewport
  result should be allowed to update React. Use revision tokens or abortable request ids.
- **No unbounded result payloads.** Projection returns viewport nodes/edges plus summary stats;
  search returns ranked windows with pagination; contents returns groups/windows when needed.
- **No duplicate indexes per runtime.** If WASM worker owns an index, the main process/native
  session should either share a serialized warm snapshot or rebuild only when the benchmark proves
  it is cheaper than transfer. Avoid quietly doubling memory.
- **Capability flags are rollout valves, not product modes.** `rustGraph`, `rustIndex`,
  `nativeLoad`, `nativeAssets`, `workerQueries`, and `rustCommands` may flip independently so
  regressions can be isolated, but the roadmap outcome is all core surfaces on Rust. A green TS
  fallback does not satisfy a Rust-owned milestone.
- **TypeScript core producers must shrink over time.** Every route-local scanner, parser,
  indexer, graph projector, asset manifest builder, or undo reducer that derives story/project
  facts is temporary until replaced by a Rust command/query.
- **Cutovers include removals.** A Rust implementation is not done when it is added beside the
  TypeScript one. It is done when product code can no longer reach the TypeScript producer.

**Rejected alternatives & why:** per-pan `twine_cli` subprocess (process-startup cost dwarfs the
2ms projection); full Tauri migration (too large a rewrite for an incremental bridge — revisit
only if Electron overhead itself becomes the ceiling). The cutover can happen surface by surface,
but the JS path is a migration escape hatch, not a coequal engine.

### 3.3 Removal gates and anti-regression checks

Every Rust cutover must remove support code or add a failing guard that proves removal is next:

- **Static ownership guard:** product routes and stores must not import TS core producers such as
  `story-index.ts`, `graph-projection.ts`, route-local asset scanners, or Redux undo reducers after
  their Rust replacements land. CI should fail on forbidden imports.
- **Runtime authority guard:** command-path tests must assert that authoring operations call
  `ProjectSession::apply` / native session commands first and apply returned patches; reducers may
  apply patches but must not be the canonical mutation source.
- **Deletion budget:** every P1-P5 milestone must include a "removed/deleted" checklist item.
  If a migration shim remains, it must have an owner, an exit condition, and a test proving it is
  not used by normal product routes.
- **No green fallback credit:** tests passing through a TS fallback do not count for milestone
  completion. Perf artifacts must record bridge/runtime mode and fail if a Rust-owned surface is
  unexpectedly running in TS compatibility mode.
- **Break loudly:** when a deprecated TS producer is invoked in development for a Rust-owned
  surface, it should throw or log a loud diagnostic rather than quietly saving the workflow.

---

## 4. Phased Roadmap

Each item: **Problem → Rust-owned fix → Dream alignment → Headless test**. Phase 0 exists only
to stop acute waste before the Rust path lands. Phases 1–5 move ownership to Rust surface by
surface and delete or quarantine TypeScript core producers.

### Phase 0 — Stop the bleeding (pure JS, ship now) · aligns M0/M2

Wins that need no Rust and remove the most egregious main-thread waste.

- **P0.1 — Collapse the triple asset scan to one.** Scan `assets/` once on open; reuse the
  inventory for the manifest fingerprint and the session baseline.
  _Test:_ main-process Jest spy asserting `scanAssetDirectory` is called exactly once per open
  (fixture with a known asset tree); CLI `bench-open` asserts wall time drops.
- **P0.2 — Don't read passage bodies to paint the graph.** Load passage _identity + layout_
  first; lazy-load body text when a passage opens. Graph paint needs name/position/size, not prose.
  _Test:_ Jest asserting the open snapshot carries no body text; Playwright asserting graph is
  interactive before bodies resolve.
- **P0.3 — Move story parse off the synchronous DOM path.** Stream stories into state in chunks
  via `requestIdleCallback`/microtask batches so first paint precedes full parse.
  _Test:_ Playwright `performance.mark` between goto and shell-visible vs. all-passages-ready.
- **P0.4 — Defer the story index.** Build it lazily and only for the opened story, never on shell
  mount. _Test:_ Jest asserting `storyToCoreIndex` is not called during initial load.
- **P0.5 — Make Contents cheap immediately.** Window the contents list, avoid decoding image/audio
  previews until a row/inspector is visible, and split "contents skeleton" from the full
  `CoreStoryIndex`. The first contents paint should be passage names/tags/assets from metadata;
  diagnostics/symbols can stream in after.
  _Test:_ render-count test asserting O(viewport) rows; Playwright contents route first-paint
  budget at the Transylvania fixture.
- **P0.6 — Add app-level performance marks now.** Instrument `open-start`, `shell-visible`,
  `graph-visible`, `contents-visible`, `all-passages-ready`, `asset-inventory-ready`, and
  `session-baseline-ready`. _Test:_ Playwright reads `performance.measure()` and writes a JSON
  artifact even before the Rust bridge lands.
- **P0.7 — Prevent open-time write-back churn.** Opening/importing a project should not
  immediately trigger persistence or session-sync rewrites unless data actually changed.
  _Test:_ main-process/renderer integration test asserting a clean open produces no save writes.

**Exit gate:** Transylvania cold open ≤ 3s (off the hard-fail line) with zero behavior change.

### Phase 1 — WASM graph + index core in the renderer · aligns M2 + M4

The headline phase: the live graph and indexes stop being TypeScript-owned.

- **P1.1 — Build `twine_wasm` crate.** `wasm-bindgen` wrapper exposing `ProjectSession::apply`
  for `QueryGraphProjection` / `QueryStoryIndex`, returning the existing `ts-rs` types.
  _Test:_ `wasm-pack test --headless` parity vs. golden CLI projections on the fixture corpus.
- **P1.2 — Cut the graph projection over to WASM as authority.** Replace
  [graph-projection.ts](../../src/core/graph-projection.ts)'s `storyToCoreGraphProjection` call
  site with a WASM `ProjectSession` query. The JS projector becomes a temporary diagnostic/test
  fallback, not a production owner.
  _Test:_ parity during cutover, then a regression test asserting the product path uses the WASM
  worker and does not call the JS projector for graph mode.
- **P1.3 — Move WASM into a Web Worker.** Projection/index/search run off the main thread;
  React receives small projections over `postMessage`/`Comlink`.
  _Test:_ Worker round-trip latency harness; Playwright frame-time trace during a scripted pan
  asserting no frame > 50ms.
- **P1.4 — Cut story index + search over to WASM as authority.** Replace
  [story-index.ts](../../src/core/story-index.ts) with `QueryStoryIndex`; search uses
  `twine_search`. The TypeScript indexer becomes test-only or deleted.
  _Test:_ product-path assertion that route-facing search/contents call Rust; bench search < 50ms
  at 50k.
- **P1.5 — Prove serialization does not eat the win.** Measure query payload size and
  structured-clone time for projection/index/search. If JSON transfer is too large, switch hot
  paths to compact arrays or binary buffers while keeping `ts-rs` types at the API edge.
  _Test:_ worker benchmark reports compute time, transfer time, payload bytes, and React apply
  time separately.
- **P1.6 — Delete renderer core producers from product imports.** After graph/index/search are on
  Rust, remove or quarantine `storyToCoreGraphProjection`, `saveGeneratedGraphLayout`, and
  `storyToCoreIndex` so normal app code cannot call them.
  _Test:_ forbidden-import check over `src/routes`, `src/store`, and `src/components`.

**Exit gate:** pan/zoom meets the projection + frame budgets at 10k; index/search budgets at 50k.

### Phase 2 — Native session in the main process · aligns M0 + M5

- **P2.1 — Build `twine_native` (napi-rs) addon.** Expose `twine_store` project-folder
  load/save and `twine_parse` import. _Test:_ Jest against the addon loading the fixture corpus;
  CLI parity on round-trip.
- **P2.2 — Replace `readProjectStories` with native load.** `twine_store::load_project_path`
  returns the snapshot directly; no JS TOML/passage-file loop.
  _Test:_ `bench-open` wall time at Transylvania; parity test vs current JS loader output.
- **P2.3 — Native asset scan (rayon) + native file-watch diff.** One parallel walk feeds
  inventory + fingerprints; watcher emits incremental change sets.
  _Test:_ bench asset scan at 2,656 files; Jest watcher-diff test (touch 1 file → 1-entry diff).
- **P2.4 — Native zip/html import.** Move extraction + reference rewrite into Rust (it already
  exists in `twine_parse`/`twine_export`). _Test:_ import the real `exampleproje/*.zip`, assert
  `images/…`→`assets/images/…` rewrite and asset copy, headless.
- **P2.5 — Package the native addon like product code.** Add prebuilds or deterministic local
  builds for macOS/Windows/Linux, notarization/code-signing checks, and a runtime health check
  that falls back to the JS loader with a visible diagnostic.
  _Test:_ CI smoke launches the packaged Electron app on each target and calls `nativeLoad`.
- **P2.6 — Asset manifests become reusable infrastructure.** The same native scan result should
  feed asset grid, publish, project open, file-watch baseline, import copy results, and contents
  asset entries.
  _Test:_ one fixture open asserts one asset manifest revision is reused by all consumers.
- **P2.7 — Delete JS project-folder readers/scanners from product paths.** Remove the JS TOML
  project reader, recursive asset scanner, and HTML/zip import preparer from normal Electron
  paths after the native equivalents land. Keep only legacy import compatibility if needed.
  _Test:_ forbidden-import/static grep plus mocked native load asserting no JS filesystem loop runs
  during open/session/asset list/import.

**Exit gate:** Transylvania cold open ≤ 1.5s (target).

### Phase 3 — Incremental everything · aligns M4 + External-edit rule

- **P3.0 — Delete the TypeScript command owner.** `StoreCoreProjectHost.applyStoryCommand`
  must stop translating core commands into Redux mutations. Commands go to `ProjectSession`
  first; TypeScript applies the returned `PatchBatch` to the visible store.
  _Test:_ command-path test asserting create/rename/move/text/asset/story-detail operations call
  Rust/WASM/native `apply` and never invoke route-local reducers as the source of truth.
- **P3.1 — Patch-level index updates.** A passage edit emits a `PatchBatch` that updates only
  affected index/graph slices (`ProjectSession::apply` already returns patches; honor them
  instead of rebuilding). _Test:_ bench reindex-after-1-edit ≤ 5ms at 50k; assert no full rebuild
  and no full `ProjectSnapshotReplaced` for a single-passage edit.
- **P3.2 — Incremental external-edit reingest.** Native watcher diff → reparse only changed
  files → merge/conflict review. _Test:_ Jest simulating an external edit to 1 passage asserting
  a single-file reparse.
- **P3.3 — Persist `graph_cache` warm.** Reuse `ProjectSession` graph/layout cache across views;
  invalidate per-story on mutation. _Test:_ second-open / view-switch bench shows cache hit.
- **P3.4 — Lazy body hydration remains conflict-safe.** If a passage body is loaded lazily and
  the file changes externally before edit/save, the session must surface a revision conflict
  instead of overwriting disk.
  _Test:_ open shell-only snapshot → modify one passage on disk → hydrate/edit that passage →
  conflict review shows the single changed file.
- **P3.5 — Undo/redo moves into Rust.** The current Redux undo path is another
  whole-story invalidation source. Undo/redo must call `ProjectSession::undo` / `redo`, receive
  patch batches, and update only touched ids.
  _Test:_ undo a rename/text edit at 50k and assert no full index/projection rebuild.
- **P3.6 — TypeScript compatibility producers are removed from product routes.** Route-facing
  graph, contents, diagnostics, assets, publish preparation, and project-session sync must all
  consume Rust command/query results. Any remaining TS producer must be explicitly named as
  import/export compatibility code or test scaffolding.
  _Test:_ static guard or Jest module mock fails if product routes import `story-index.ts` /
  `graph-projection.ts` producers directly.
- **P3.7 — Remove Redux undo as a product feature.** Once Rust undo/redo patches land, delete or
  quarantine `src/store/undoable-stories` from route-facing product code. The UI can expose undo
  buttons, but their implementation calls Rust session undo/redo.
  _Test:_ undo/redo route tests mock Rust session undo/redo and fail if Redux reverse-action logic
  is invoked.

**Exit gate:** keystroke→paint ≤ 16ms at 50k; incremental edit budget met.

### Phase 4 — Render pipeline at scale · aligns M2

- **P4.1 — Canvas/WebGL edge + node virtualization.** Draw only viewport nodes/edges; widen the
  edge draw-band and update viewport synchronously on drag to kill node/edge popping.
  _Test:_ Playwright frame trace; visual assertion that edge count tracks node count per frame.
- **P4.2 — Minimap + scoped views** from index queries (folders/chapters), so 50k is editable a
  scope at a time. _Test:_ bench scoped projection; Playwright scope-switch latency.
- **P4.3 — Remove debug-route string from production edges** (keep for Jest only) — already a
  known per-edge DOM cost. _Test:_ assert attribute absent in production render path.
- **P4.4 — Measure draw time separately from projection.** Canvas edge routing/drawing still runs
  in JS today. Track `projectionMs`, `routeMs`, `drawMs`, and `reactCommitMs` independently so a
  fast Rust projection does not hide a slow paint.
  _Test:_ Playwright trace exports these four marks during pan/zoom.

**Exit gate:** 50k navigable/filterable with frame budget held; memory ceiling respected.

### Phase 5 — Editor at scale · aligns M3

- **P5.1 — Virtualized editor-side passage lists** (windowed) so docks, pickers, and backlinks
  never render 4.6k rows after the Phase 0 contents pass.
- **P5.2 — Format-aware services from WASM** (autocomplete/links/backlinks from the index).
- **P5.3 — Asset previews lazy + thumbnailed** (no dimension decode on open; decode on view).
- **P5.4 — Editor opens one hydrated working set.** CodeMirror should receive one passage body
  plus nearby/index context, not force the app to materialize every body. Format extensions,
  autocomplete, and diagnostics should query the worker/session by revision.
- **P5.5 — Find/replace preview is paginated.** Large replacements should stream preview groups
  and apply as a session command, avoiding the known undo/mutation fragility around passage-name
  replacements.
  _Tests:_ Jest render-count assertions (windowing); Playwright editor keystroke trace; asset
  grid first-paint budget.

---

## 5. Headless Testing Strategy (how we prove "blistering")

Four layers, all runnable in CI with **no display**. Budgets from §2 are the assertions.

### 5.1 Rust micro-benchmarks — `criterion` (the source of truth)

Add `benches/` (criterion) to `twine_graph` and `twine_core`. Bench: index build, layout
snapshot, viewport projection, story index, search, incremental patch.

```sh
cargo bench -p twine_graph -p twine_core            # local
cargo bench -p twine_graph -- --save-baseline main  # record baseline
cargo bench -p twine_graph -- --baseline main       # CI: fail on regression
```

Criterion's baseline diffing is the regression gate for pure-core perf. Feed the same generated
fixtures (1k/5k/10k/50k) so numbers track the JS/E2E layers.

### 5.2 Full-project load bench — extend `twine_cli`

Add a `bench-open <project-folder>` command (sibling to `bench-graph`) that times native load +
index + projection of a _real folder_ and prints JSON (`loadMs`, `indexMs`, `projectionMs`,
`assets`, `passages`). Wrap in a script that records against a committed budget file:

```sh
cargo run -q -p twine_cli --release -- bench-open "<Transylvania folder>"
node benchmarks/check-budget.mjs --metric open --max 1500   # exits non-zero over budget
```

Commit a **tracked perf fixture** so CI has a stable large project without the 404MB asset blob:
generate a 5k-passage story _with a synthetic asset tree of the same shape_ (counts, nesting,
reference density) via an extended `generate-fixtures.mjs --with-assets`. Keep the real
Transylvania as a local-only manual benchmark (document its path; never commit 404MB).

### 5.3 Renderer perf — Jest (parity + micro-latency)

- **Parity tests** (block every WASM cutover): assert JS and WASM produce identical
  projections/indexes on the fixture corpus. Parity is the safety net that lets us flip flags.
- **Latency micro-tests:** wrap projection/index/search calls in `performance.now()` over a 50k
  fixture, assert against §2 budgets. Run with `--runInBand` for stable timing; treat as soft
  signal locally, hard gate in the dedicated perf job.
- **Render-count tests:** React Testing Library asserting virtualized lists render O(viewport),
  not O(n); asset thumbnails decode lazily.

```sh
npm run test -- src/core/__tests__/graph-projection.parity.test.ts
npm run perf:unit          # new script: jest --selectProjects perf --runInBand
```

### 5.4 App-level — Playwright, including real Electron

Today [playwright.config.ts](../../playwright.config.ts) drives the **Vite web** build. Add a
second project that launches the **built Electron app** (`_electron.launch`) so we measure the
real main↔renderer path, then capture timing/frames/memory via CDP.

- **Startup:** `performance.mark`/`measure` between launch, shell-visible, and
  all-passages-ready, opening the perf fixture.
- **Frame time during pan:** inject a `requestAnimationFrame` sampler, run a scripted drag,
  assert no frame > 50ms and p95 ≤ 16.6ms.
- **Edge/node desync:** sample projected edge vs node counts per frame; assert they never diverge
  (kills the "pointers disappear and reappear" symptom).
- **Memory:** `Performance.getMetrics` / `Runtime.getHeapUsage` over CDP after open; assert
  ceiling.

```sh
npm run e2e:electron        # new: playwright test --project=electron
npm run perf:e2e            # new: the timing/frame/memory specs only
```

### 5.5 CI gating — a dedicated `perf` job

`.github/workflows/perf.yml` (mirrors the existing jest/playwright reference workflows):

```
matrix: fixture ∈ {1k, 5k, 10k, 50k}
steps:
  cargo bench --baseline main           # §5.1  → fail on core regression
  twine_cli bench-open <perf-fixture>   # §5.2  → fail over open budget
  npm run perf:unit                     # §5.3  → fail over projection/search budget
  npm run perf:e2e                      # §5.4  → fail over frame/startup/memory budget
artifacts: criterion reports, playwright traces, budget JSON (trend over time)
```

Budgets live in a single committed `benchmarks/budgets.json` so a regression is a one-line diff
and a red check, not a vibe.

### 5.6 Profiling artifacts we should keep

Every perf run should save enough evidence to explain failures without rerunning locally:

- `open-profile.json`: phase marks, file counts, payload bytes, heap/RSS, bridge mode flags.
- Playwright trace + screenshot at shell-visible, graph-visible, contents-visible.
- Rust criterion report for core regressions.
- Worker/native timing breakdown: compute vs transfer vs React commit.
- A short `benchmarks/latest.md` generated from the JSON so humans can compare runs quickly.

These artifacts matter because "Rust is fast" is not enough; we need to know whether time moved
from parse to transfer, from transfer to React commit, or from open to background sync.

---

## 6. Regression Budget Summary (the gate table)

| Layer       | Command                       | Gate                               |
| ----------- | ----------------------------- | ---------------------------------- |
| Rust core   | `cargo bench --baseline main` | no metric regresses > 10%          |
| Full load   | `twine_cli bench-open`        | Transylvania-shape open ≤ 1.5s     |
| Projection  | `npm run perf:unit`           | viewport projection < 1ms p50 @10k |
| Search      | `npm run perf:unit`           | query ≤ 50ms @50k                  |
| Incremental | `npm run perf:unit`           | 1-edit reindex ≤ 5ms @50k          |
| Startup     | `npm run perf:e2e`            | shell ≤ 400ms, interactive ≤ 1.5s  |
| Frame       | `npm run perf:e2e`            | no frame > 50ms during pan         |
| Memory      | `npm run perf:e2e`            | ≤ 600MB resident @Transylvania     |

---

## 6b. Risks / Watch Items

1. **Bridge serialization can erase Rust gains.** Passing full stories across WASM/native
   boundaries is the failure mode. Viewport-bounded projections and paginated search/index
   results are mandatory.
2. **Lazy hydration changes product semantics.** Export, play/test, find/replace, undo, external
   edit review, and save must all keep working when not every passage body is resident in React.
3. **Worker duplication can increase memory.** If Redux, WASM, and native sessions each hold full
   text, memory gets worse. The owner must be explicit per phase.
4. **Native addon packaging is real work.** `napi-rs` is the right shape, but release CI, signing,
   architecture targets, and fallback diagnostics need to be planned as part of Phase 2, not after.
5. **CI timing can be noisy.** Use absolute budgets on a known reference job, relative regression
   gates elsewhere, and always save artifacts so failures are debuggable.
6. **The current linear search crate is a placeholder.** Moving it to WASM helps thread blocking,
   but the 50k target probably still needs an inverted/token index with incremental updates.

---

## 7. Milestone Alignment (this roadmap _is_ the dream architecture)

| Phase | Completes in the dream architecture                                                     |
| ----- | --------------------------------------------------------------------------------------- |
| 0     | M0 persistence hygiene; removes obvious main-thread waste before the bridge             |
| 1     | **M2** "Rust/WASM `ProjectSession` bridge" (named remaining risk) + **M4** Rust indexes |
| 2     | **M0** transactional folder load/save via `twine_store`; **M5** native asset/import     |
| 3     | **M4** incremental indexes + External-edit rule (watch → incremental reparse → review)  |
| 4     | **M2** virtualized canvas/WebGL render, scoped views, minimap, performance contract     |
| 5     | **M3** Twine-aware editor ergonomics at scale                                           |

Nothing here adds a feature the architecture didn't already ask for. The graph already queries
`QueryGraphProjection`; the bindings already exist; M2 already states the contract. This roadmap
just **moves the work from the TypeScript stand-ins to the Rust core they were modeled on** — so
the app becomes more fully what it was always meant to be.

---

## 7b. What still looks temporary (M0–M7 "theoretically done")

The milestones are functionally complete, but several pieces are explicitly **stand-ins** —
flagged as such in the codebase and the planning docs. They are exactly the seams this roadmap
closes, so the perf work _finishes_ the architecture rather than diverging from it. In rough
priority order:

1. **The entire Rust core is bypassed in the live app — the central temporary thing.**
   [project-host.ts](../../src/core/project-host.ts):237 `StoreCoreProjectHost` is, in the
   milestones doc's own words, "_still a compatibility host while the legacy store backs the
   app_" ([MILESTONES](./TWINE_RS_MILESTONES.md):530). It translates every `StoryCommand` into a
   Redux dispatch; graph projection and indexing run through TS re-implementations
   ([graph-projection.ts](../../src/core/graph-projection.ts),
   [story-index.ts](../../src/core/story-index.ts)); the `ts-rs` bindings are imported
   `type`-only. **There is no `wasm-bindgen` / `napi` / `neon` anywhere in the tree** (verified).
   → _Retired by Phases 1–2._

2. **Search is a "baseline linear implementation."** `twine_search::LinearSearchIndex`
   ([lib.rs](../../crates/twine_search/src/lib.rs):24) is an O(n) case-insensitive
   `.contains()` scan with a 1.0/0.5 name-vs-text score and no inverted index, trie, or ranking
   — and the live app doesn't even call it (search runs in TS). Correct, not scalable.
   → _Retired by Phase 1.4._

3. **A legacy store + DS dual path still exists.** The design spine installs a "_temporary,
   clearly-flagged bridge so unmigrated legacy screens keep [working]_"
   ([DESIGN_SPINE](./TWINE_RS_DESIGN_SYSTEM_SPINE.md):132), and "_dialog-era screens that are not
   part of the migrated D4/D5 workbench can still mutate legacy state directly_"
   ([MILESTONES](./TWINE_RS_MILESTONES.md):531). Two mutation paths = double the surface to keep
   fast and correct. → _Folds away as Phases 1–3 route everything through the host/session._

4. **M2 perf is self-flagged as unvalidated.** [MILESTONES](./TWINE_RS_MILESTONES.md):422 —
   "**REMAINING:** performance validation still needs 50k passage projects, pan/zoom latency
   traces, viewport projection latency, edge-layer filtering, search/filter responsiveness, and
   memory ceilings in the running app," and the "remaining scale risk is … the Rust/WASM
   `ProjectSession` bridge." This roadmap's §5 headless harness is precisely that missing
   validation. → _Delivered by §5 + Phase 4._

5. **`.twine/project.json` carries a tolerate-corruption fallback.** The recent fix writes the
   sidecar atomically and the loader _ignores invalid JSON and falls back to twine.toml_; older
   big projects only slim down "on next save." That fallback is a guard around a format that used
   to duplicate all passage text — fine as a safety net, but a temporary shape until the native
   session owns load/save. → _Hardened by Phase 2.2._

6. **Preload runs without context isolation.** [preload.ts](../../src/electron/main-process/preload.ts):5
   — "_For now, we cannot use context isolation here because of jsonp_," placing a privileged
   `jsonp` into renderer context (and using `Date.now()` for callback names). Long-lived "for
   now" with a real security dimension; worth scheduling alongside the format/runtime work.

7. **Known latent undo crash.** [reverse-action.ts](../../src/store/undoable-stories/reverse-action.ts):57
   — "_TODO: crashes on a replace all that affects a passage name, unclear why_." A real bug, not
   a perf item, but it lives on the mutation path Phase 1–3 reworks; fix it during that cutover.

8. **D-series PARTIALs (mostly runtime depth, not blockers).** Per
   [DESIGN_SPINE](./TWINE_RS_DESIGN_SYSTEM_SPINE.md): D8 runtime inspection
   (variables/state/devtools) still missing; format-host extension-point UI not built for every
   declared slot; "run-from-here" not wired everywhere; desktop scratch-window preview parity
   pending. These are feature-depth temporaries rather than performance ones — noted so the perf
   cutover doesn't accidentally cement the legacy preview path.

**Bottom line:** "M0–M7 done" is true at the capability level, but the app is still running on
TypeScript stand-ins for a finished Rust core, a linear search placeholder, and a legacy/DS dual
mutation path — with M2's own performance validation explicitly outstanding. Those are the
temporary scaffolds; the phases above remove them.

> **0.1.2 playtest remediation (2026-06-23).** External testing surfaced a
> launch-bricking backup crash, an unimplemented asset-import copy path, and a
> missing-asset detection bug — all of which land in **Phase 2** here (P2.2 native
> load owns the library path/move; P2.4/P2.5 own import; P2.6 owns the single asset
> manifest that drives missing detection). The crash itself is an Electron
> main-process recursive-copy bug that must be fixed *now*, ahead of the native
> cutover. Full root-cause analysis, file:line refs, and DO/DON'T fixes:
> [`TWINE_RS_0_1_2_FEEDBACK_REMEDIATION.md`](./TWINE_RS_0_1_2_FEEDBACK_REMEDIATION.md)
> (waves W0, W5.2, W5.3). Also relevant: §7b(6) preload jsonp hardening ↔ that
> doc's W7 (story-format icons/descriptions not loading in the packaged app).

## 8. Sequencing recommendation

1. **Phase 0 now** — biggest user-visible win for least risk; gets open off the hard-fail line.
2. **Phase 1.1–1.3 next** — the WASM graph bridge is the highest-leverage architectural step and
   directly fixes pan/zoom smoothness and node/edge popping.
3. **Phase 2** — native load is what dissolves the remaining seconds of open time.
4. **Phases 3–5** — incremental + render + editor polish, each gated by §6 budgets.

Each cutover ships behind a capability flag with the JS path as fallback and a parity test, so the
bridge lands safely, one surface at a time.
