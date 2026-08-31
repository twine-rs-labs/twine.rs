# Current development status

Status: current snapshot
Owner: repository maintainers
Last verified: 2026-08-30
Source of truth: shipped code paths and passing local validation

## Practical assessment

`twine.rs` is a broad working desktop and web editor with meaningful Rust
authority. The Rust-session migration, incremental native watcher ingestion,
and local release-mode Electron performance harness are implemented.

`v0.2.0-beta.5` is the current tagged prerelease. The product remains prerelease
software and still misses several large-project performance targets. The
current phase prioritizes evidence-selected large-project performance work and
safe project-wide refactoring, followed by product depth and release validation.

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
- Managed desktop Play, Test, and Proof windows with a dedicated renderer and
  preload, preview-only IPC, copied scratch packages behind opaque
  `twine-preview:` origins, in-place Test Current/Test From Start rebuilding,
  owner-bound cleanup, and the shared browser debug surface for current
  passage, console/runtime failures, viewport presets, reload, Source, and
  Graph. Play and Test add negotiated exact-version Restart plus a confirmed,
  origin-isolated Clear State transaction that remounts the same built artifact;
  Proof remains read-only. All 15 bundled SugarCube v2 sources from 2.31.0
  through 2.37.3 use digest-authenticated, host-owned exact admission, audited
  version profiles for four read sections, and statically plus dynamically
  attested Restart. Exact admitted Harlowe 3.3.9 exposes current passage, story
  variables, observed temporary assignments, and visited-passage history while
  drifted or unadmitted artifacts retain current-passage-only fallback.
  Packaged acceptance covers Test From Here, Paperthin Proof, copied assets and
  byte ranges, per-origin storage and window isolation, cleanup and protocol
  lifetime, and current-passage identity across bundled Chapbook, Harlowe,
  Snowman, and SugarCube profile representatives.
- Rust import/export, graph, storage, search, and CLI crates.
- Segregated local, deliberately unsigned, and signed desktop artifact profiles
  with target-native trust manifests, checksum-bound assembly, and a
  non-distributable CI test bundle.
- Release governance with a canonical changelog, support and rollback policy,
  approved machine-readable plans, explicit solo-maintainer approval, a durable
  checklist, annotated tag checks, tag-triggered draft assembly, manually
  dispatched publication, retained release records, and post-publication
  fresh-download smoke coverage.
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
  embedding remains unavailable. File-backed desktop Package export now
  captures bounded project asset bytes, deterministic paths, checksums, and
  scoped dependency/completeness reporting in a revision-locked snapshot.
- Referenced-media validation and bounded file reads run as asynchronous native
  tasks, keeping Electron's main event loop available. Admission permits one
  active and one queued native read; a third request fails with backpressure
  before it reaches the shared worker pool.
  Component-wise handle-relative no-follow opens prevent link-swap escapes, and
  private per-story SHA-256 baselines detect same-size rewrites even when a file
  modification time is restored. Candidate authority is bounded to the first 25
  paths per story, 100 stories, 100 unique paths per session, and 4 KiB per
  normalized path; incomplete or structurally ambiguous source changes fail
  closed. Initial and full trusted scans use a no-media fast path, yield on a
  bounded main-loop budget, and cannot commit after a newer refresh supersedes
  them. Busy digest admission withholds new authority without turning a
  completed save into an error. Active-session authorization, deterministic
  ordering, and the native 25-file/25 MiB per-build ceilings remain unchanged.
  The native build also loads the real addon and checks the Promise ABI for
  both digest capture and payload reads.

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
- Passage rename now uses a revision-pinned, Rust-owned review plan for the
  passage name and every detected standard Twine-link occurrence. Its detail
  review is paged and grouped by affected passage, and confirmed apply, undo,
  and redo remain one project transaction. Format-specific semantic references
  are still reported as unsupported coverage and are not rewritten
  speculatively. Find/Replace now uses the same immutable plan boundary across
  passage names, passage text, Story JavaScript, and Story Stylesheet sources,
  with paged details, compact exclusions, grouped name/link rewrites, stale
  rejection, and one atomic undo transaction. General definition/reference
  navigation is incomplete, Fix All Safe is not one atomic batch, and authoring
  commands are not exposed consistently through the palette.
- Some inherited compatibility UI remains outside the primary workbench.
- Native Harlowe editing is intentionally exact-version: bundled Harlowe 1.2.4
  and 2.1.0, user-added Harlowe builds, and future Harlowe dialects use the
  generic editor until a separately registered provider proves their syntax
  and authoring behavior.
- Packaged-app, cross-platform, and hosted-CI performance coverage remains
  incomplete.
- The public beta is deliberately unsigned, automatic updates remain disabled,
  and trusted Windows/macOS signing still requires credentialed release-run
  evidence before a signed profile can be claimed.
- The beta.5 comparison at `114a60ba` completed the 10k and 50k five-phase
  suites with structural invariants intact. It recorded two marginal regression
  threshold misses: 10k edit-paint p95 was 31.50 ms against a 30.70 ms computed
  limit, and 50k resident-memory p50 was 1,152.44 MiB against a 1,148.54 MiB
  computed limit. These results remain failed regression evidence rather than
  accepted baselines. Follow-up reproduction has identified bounded owners in
  the ordinary edit path and in the 50k safe-refactor planning/apply path;
  performance therefore remains active until clean candidate runs pass their
  blocking gates.
- The user manual still contains inherited Twine task and compatibility
  chapters. Current launcher, project-folder, conflict-review, workbench,
  asset, build, Settings, and Story Formats workflows are documented.

## Active work

Only unfinished outcomes belong in the active roadmap:

1. [`Performance`](../roadmap/performance.md)
2. [`Safe project-wide navigation and refactoring`](../roadmap/safe-project-refactoring.md)
3. [`Product-depth and legacy retirement`](../roadmap/product.md)
4. [`Post-beta release validation`](../roadmap/release.md)
