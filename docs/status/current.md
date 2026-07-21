# Current development status

Status: current snapshot
Owner: repository maintainers
Last verified: 2026-07-21
Source of truth: shipped code paths and passing local validation

## Practical assessment

`twine.rs` is a broad working desktop and web editor with meaningful Rust
authority. The Rust-session migration, incremental native watcher ingestion,
and local release-mode Electron performance harness are implemented.

It is not yet a performance-optimized or release-proven product. The current
phase is optimization and release validation, not another ownership migration.

## Implemented foundations

- Directory-backed project folders and browser-local projects.
- Functional per-story source layouts for desktop projects: the recommended
  Multi layout stores one file per passage, while Single stores standard
  `StoryTitle`, `StoryData`, and passage sections in `story.twee`. Both keep
  scripts and styles separate, retain their layout across saves, and participate
  in external-change watching and conflict review. Targeted saves preserve
  unmodeled aggregate and manifest content, and accepted external additions
  retain stable identities across restarts.
- Shared Rust `ProjectSession`s in one WASM worker client.
- Rust-owned commands, patch batches, undo/redo, dirty state, revisions, and
  incremental analysis caches.
- Revision-aware local and Electron persistence.
- Native changed-path watcher deltas with field-level conflict review.
- Rust-owned asset inventory and native reversible journals for app-initiated
  asset operations.
- Text, graph, split, contents, diagnostics, assets, formats, build, settings,
  and preview routes.
- Rust import/export, graph, storage, search, and CLI crates.
- Deterministic 10k/50k release-mode Electron benchmark fixtures and local
  machine baselines.
- Generated bounded Rust/WASM read-model contracts for summaries, cursor pages,
  and selected-passage facts; large Contents no longer eagerly transfers a
  full story index.
- Entity-maintained Rust read-model caches for ordinary passage text, layout,
  tag, story-source, start-passage, undo/redo, and external text changes, with
  perf-only cache-build and touched-source attribution.
- CodeMirror 6 on every active editing surface, with a bounded per-editor
  adapter for compatible Chapbook legacy modes, commands, and toolbar
  descriptors. The exact bundled Harlowe 3.3.9 format has a lazy native CM6
  provider with its extracted parser, syntax coloring, completions, coding
  help, proofreading, scoped find/replace, preferences, keyboard commands, and
  format toolbar. Its legacy hydration is still rejected before execution, and
  story-format runtime source remains unchanged.
- Instrumented Chapbook performance fixtures prove zero adapter/index rebuilds
  across 22 warmed edit/undo/redo samples, zero long tasks across 20 complete
  input-to-paint windows, zero rebuilds at beginning/middle/end locations, and
  one bounded rebuild when delimiter presence changes. A four-concurrent-editor
  workload edits and focuses every passage, exercises selection-sensitive
  toolbar state, and returns actual WeakRef-observed editor, adapter, document,
  descriptor, and facade objects to zero after forced GC. The checked-in bundle
  gate is 66,575 gzip bytes (11.52%) smaller than the CM5 reference, with no
  known CM5 runtime marker in emitted JavaScript or CSS. Generic and adapted
  clean matched-baseline evaluations pass at 11.1 ms and 22.6 ms edit-paint
  p95, respectively. The adapted 16.6 ms target remains report-only. Separate
  default and Chapbook Electron 43 baselines accepted at commit `0951f942` pass
  the enforced 15%/5 ms regression comparison with zero blocking failures.

## Proven structural properties

The complete local 10k and 50k benchmark runs verify:

- one worker/session ownership path per project;
- monotonic edit, undo, and redo revisions;
- exact-revision persistence acknowledgement;
- no ordinary post-initialization full-project replacement;
- viewport-bounded graph node rendering;
- one-source parsing for one-passage watcher edits;
- asset-only watcher changes enter review without parsing stories;
- no watcher recovery reload in normal scenarios;
- fixture immutability, isolated user data, and run-root cleanup.
- Desktop Playable HTML export can embed supported statically referenced
  project media through the constrained native project reader. The Build screen
  reports actual embedded, external, unresolved, and unsupported media. Browser
  embedding remains unavailable, and Package export still contains an asset
  plan rather than project asset bytes.

## Current limitations

- The 50k path is structurally correct but substantially misses most absolute
  latency and memory targets.
- React retains the patch-applied story/passage metadata read model, but passage
  bodies are session-owned and no longer retained in that read model after
  bootstrap or native hydration.
- Explicitly complete compatibility workflows and broad structural command
  families still use scoped full indexes or broad session deltas. They are not
  part of the large-story default startup/edit/watcher path and remain targeted
  optimization work.
- Preview/debug runtime inspection is not yet complete across all desktop
  surfaces.
- Some inherited compatibility UI remains outside the primary workbench.
- Native Harlowe editing is intentionally exact-version: bundled Harlowe 1.2.4
  and 2.1.0, user-added Harlowe builds, and future Harlowe dialects use the
  generic editor until a separately registered provider proves their syntax
  and authoring behavior.
- Packaged-app, cross-platform, and hosted-CI performance coverage remains
  incomplete.
- The user manual still contains inherited Twine task and compatibility
  chapters. Current launcher, project-folder, conflict-review, workbench,
  asset, build, Settings, and Story Formats workflows are documented.

## Active work

Only unfinished outcomes belong in the active roadmap:

1. [`Performance optimization`](../roadmap/performance.md)
2. [`Product-depth and legacy retirement`](../roadmap/product.md)
3. [`Release validation`](../roadmap/release.md)
