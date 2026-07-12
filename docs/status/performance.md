# Current performance status

Status: current measured snapshot
Owner: performance maintainers
Last verified: 2026-07-12
Source of truth: release-mode Electron harness and accepted local baselines

## Harness state

The local harness builds production web, native, and Electron main code without
packaging. It generates deterministic 10k and 50k project folders, copies each
fixture into an isolated temporary run root, and measures startup, editing,
queries, graph frames, watcher ingestion, bridge payloads, persistence, and
process memory.

Complete 10k and 50k Apple M4 runs pass all machine-independent structural
invariants. Matching local baselines are accepted. Raw reports and
machine-specific baselines remain ignored, while normalized historical
evidence is tracked:

- [10k reference](../../benchmarks/reference/2026-07-03-apple-m4-10000.summary.json)
- [50k reference](../../benchmarks/reference/2026-07-03-apple-m4-50000.summary.json)

Both source reports were captured from the same dirty worktree. The artifacts
preserve that limitation, the recorded Git revision, environment and dependency
versions, fixture identity, all aggregates, normalized invariant results, and
source-report hashes. They document the initial baseline without claiming
clean-commit reproducibility.

A short diagnostic phase now exists for iteration on the dominant 50k edit/save
cost. `npm run perf:electron:50k:diagnostic` performs one production launch and
one edit/save/acknowledgement cycle, records the same structural assertions, and
adds perf-gated native save-stage timings. Diagnostic reports are partial by
design and are not accepted as baselines.

Focused startup commands now run three fresh processes and collect stage-level
native load, hydration, snapshot, worker/session, and graph-readiness timings.
They also capture main/renderer heap and working sets at startup milestones,
WASM linear memory, Rust cache/entity counts, and a perf-only post-GC retained
checkpoint. These startup reports are partial evidence, not accepted baselines.

## Recent focused validation

The 50k diagnostic, query, graph, and watcher phases passed on 2026-07-10. They
validate the incremental project-folder save path, bounded Contents path, and
steady-state watcher path without requiring another complete multi-phase run.
These ignored local reports are current engineering evidence; the tracked July
3 summaries remain the durable accepted baseline until a new complete suite is
accepted.

- A passage text edit used `incremental` save mode, touched one project path,
  and completed its native save in about 63 ms. The file write itself took
  about 3 ms; baseline patching and acknowledgement account for more of the
  remaining persistence time than filesystem output.
- The same focused sample took about 629 ms to paint and about 846 ms through
  save acknowledgement. The remaining latency is not a whole-project rewrite.
- The corrected query phase kept Contents payloads near 19 KiB. Contents p95
  was about 594 ms, of which about 290 ms was the Rust/WASM request and about
  40 ms was result-to-paint. Search p95 was about 109 ms. An earlier run on the
  same implementation measured about 290 ms Contents p95 and 41 ms search p95,
  so variance and remaining CPU work still need attention.
- The graph phase improved to about 49 ms p95, with a 984 ms maximum outlier.
- Query-phase resident memory was about 1.15 GiB; graph-phase resident memory
  was about 1.56 GiB. Both are materially below the original baseline but still
  above the 600 MiB target.
- The watcher phase parsed one source for a one-passage edit and parsed no story
  sources for an asset-only edit. The asset change entered review as required.
- After entity-maintained read-model caches landed, earlier passage watcher
  samples ranged from about 592–826 ms observation-to-patch and 150–291 ms Rust
  ingestion. The focused watcher phase now uses one warm-up and five
  deterministic passage samples and attributes Rust lookup/delta work,
  fingerprints, savepoint maintenance, graph, analysis, read-model, history,
  and patch finalization separately. It also derives unattributed core and
  WASM-boundary time. This makes subsequent optimization decisions depend on
  distributions rather than isolated runs.
- The first repeated 50k profile completed in 1.3 minutes. Across five warm
  passage samples, core ingestion was 1.7–2.8 ms (2.1 ms p50), with analysis
  and read-model maintenance each about 0.7 ms p50. The WASM boundary was about
  0.1 ms p50. Observation-to-patch remained about 416 ms p50: roughly 151 ms
  event coalescing, 138 ms native delta creation, and 122 ms Rust-result to
  renderer-patch work. The warm-up was deliberately excluded from these core
  aggregates.

The watcher phase waits for the initial asset-inventory session transaction to
finish before it resets metrics or modifies disk. That keeps the measured
external edit separate from startup queue work.

## First 50k baseline

| Metric                       |       Measured |
| ---------------------------- | -------------: |
| Shell visible, p50           |   about 27.5 s |
| Interactive/open, p50        |  about 30.24 s |
| Edit to paint, p95           |  about 1.364 s |
| Project-folder save, p95     |  about 29.25 s |
| Persistence end to end, p95  |  about 29.50 s |
| Contents query, p95          |  about 3.337 s |
| Search query, p95            |  about 46.7 ms |
| Graph frame, p95             |    about 2.5 s |
| Graph frame, max             |    about 3.9 s |
| Incremental watcher reindex  | about 615.5 ms |
| Watcher observation to patch |  about 15.65 s |
| Resident memory, p50         | about 1.93 GiB |
| Resident memory, max         | about 2.87 GiB |

Search meets its 50 ms target. The other headline metrics demonstrate that the
architecture now exposes actionable bottlenecks rather than satisfying the
roadmap budgets.

The incremental native-save and bounded read-model paths are now in place.
Rust read-model caches are maintained across ordinary passage text, layout,
tag, story source, start-passage, undo/redo, and external text transactions;
perf bridge metrics report parsed-source and full/incremental cache-build
counters. Both diagnostic and watcher Electron phases pass those assertions.
The repeated watcher profile determines whether graph/index maintenance or
boundary overhead deserves the next latency change. Startup and retained-memory
attribution remain the next broader optimization gate.

The first startup/memory cleanup removed retained renderer JSON fingerprints
of every passage, avoided cloning stable-identity hydration payloads, and
blocked file-backed WASM initialization until passage text was hydrated. The
later bounded-read-model cutover also removed passage bodies from the mounted
React story model; complete workflows now materialize revision-bound documents
from Rust explicitly.

The compatibility cleanup following that cutover is complete at the source
boundary: route-facing `Passage` no longer contains `text`, full-document
transport uses explicit materialized types, bounded summary/search/contents/
diagnostics queries no longer fall back to a complete TypeScript index, and the
old reducer-owned body mutation and passage-map stacks have been deleted. The
TypeScript build, boundary checks, documentation checks, and full Jest suite
pass. Fresh 50k performance measurements are the next validation step; the
figures below predate this final compile-time boundary cleanup.

The focused 50k startup phase now passes with the corrected startup/memory
contract. Moving watcher-baseline work out of shell opening, skipping redundant
native-story repair, avoiding stable-identity passage clones, and eliminating a
second initial asset ingestion improved the measured p50s from the attributed
pre-optimization run as follows:

- shell: about 22.7 s to 0.96 s;
- fully hydrated/interactive: about 33.8 s to 10.4 s;
- post-GC resident memory: about 1.62 GiB to 1.14 GiB;
- renderer working set: about 945 MiB to 580 MiB;
- WASM linear memory: about 508 MiB to 96 MiB.

The former native file-manifest/watcher-baseline scan measured about 9.45 s p50.
Native hydration now collects file fingerprints and source mappings from the
same handles used to read project content. The watcher starts before hydration
and reconciles only paths observed while the immutable receipt is built;
watcher-unavailable and recovery paths retain the safe full scan.

Bounded parallel hydration and explicit shell/full load profiles landed next.
The shell skips passage bodies, scripts, stylesheets, graph layout, assets, and
receipt construction. Full hydration validates paths before work begins, reads
passages through one process-wide pool capped at eight workers, preserves
manifest order, and returns receipt metadata from the same file handles.

The focused 10k run passed with shell p50 about 222 ms, interactive p50 about
749 ms, and post-GC resident memory about 717 MiB. Two consecutive 50k runs
also passed every startup invariant and showed the expected cold/warm range:

- shell p50: about 649–771 ms;
- native full hydration p50: about 2.03–2.59 s, down from 4.47 s;
- interactive p50: about 2.84–3.66 s, down from 5.24 s;
- passage-source read p50: about 1.48–1.88 s for 50,000 files;

The metadata-only React passage model was validated on 2026-07-12 with fresh
50k diagnostic, startup, query, and watcher runs. Diagnostic, query, and watcher
reports all assert that the retained host passage-body character count is zero.
Two three-sample startup runs measured interactive p50 at about 2.45–2.73 s,
full hydration at about 1.83–2.07 s, a 38.95 MiB hydration payload, and resident
memory at about 1.06–1.07 GiB. All three startup samples in the confirming run
passed the zero-body assertion. The renderer heap at diagnostic readiness was
about 64 MiB, so
removing passage bodies materially narrowed the JavaScript heap without solving
total multi-process resident memory.

Chunked Electron-to-WASM bootstrap landed next. The main process now exposes a
short-lived hydration lease, the renderer transfers at most 1,000 passages per
IPC/worker request, and a Rust-owned WASM builder assembles the session before
one atomic finalize. The confirming 50k startup run on 2026-07-12 passed all
three samples with 50 chunks of about 519 KiB, interactive p50 about 2.41 s,
post-GC resident p50 about 1.02 GiB, renderer heap about 31 MiB, and WASM linear
memory about 96 MiB. This is roughly a 40 MiB retained-memory improvement over
the preceding startup run, without a material latency improvement. The native
loader still creates and serializes its 38.95 MiB full result inside the main
process before leasing it. Native-owned leasing now removes passage bodies from
that result while preserving the exact watcher baseline receipt. The confirming
50k run reduced native hydration output from 38.95 MiB to 22.50 MiB, measured
interactive p50 at about 2.27 s, hydrated p50 at about 3.61 s, and post-GC
resident p50 at about 1.017 GiB. Diagnostic and watcher phases also passed. The
remaining native payload is metadata plus the 50k-file baseline receipt, not a
second passage-body representation.

The focused query run measured Contents at about 53.9 ms and search at about
14.7 ms; Contents remains slightly above its 50 ms target. Resident memory after
building query caches was about 1.27 GiB. The watcher run retained one-source
and immutable-lease invariants, with observation-to-patch about 431 ms p50,
native delta creation about 267 ms p50, and content ingestion about 12.5 ms p50.
The diagnostic save wrote its one file in about 1.8 ms, while native baseline
patching consumed about 557 ms of roughly 574 ms native save time. These results
make duplicate retained process state and baseline-patch bookkeeping the next
measured targets; rebuilding Rust ingestion is not justified by the current
profile.

- native session baseline p50: about 117 ms in the colder attributed run;
- receipt adoption p50: about 90 ms;
- post-GC resident memory p50: about 1.26–1.30 GiB.

The shell still misses its 400 ms target at 50k. It performs no graph or source
I/O; TOML parsing alone was about 402 ms p50 in the colder run, so remaining
shell work is manifest representation/parsing rather than hydration leakage.

A validated compiled manifest cache now removes that TOML parse on canonical
projects without changing authority: every load still reads and SHA-256 hashes
`twine.toml`, and accepts `.twine/cache/project-manifest.json` only when its
format, app version, schema, byte length, and digest match. Missing, stale,
corrupt, or unsafe cache data falls back to authoritative TOML parsing or the
existing path-safety error. Canonical saves and CLI-generated fixtures write the
cache atomically with the project tree; watcher code ignores it.

Focused cache validation on 2026-07-12 passed at 10k and 50k:

- 10k compiled decode p50: about 9.9 ms; shell p50: 154 ms; interactive p50:
  about 630 ms;
- 50k compiled decode p50: about 34–38 ms versus the former 395–402 ms TOML
  parse;
- 50k shell native p50: about 245 ms versus 557 ms;
- 50k shell p50: about 480 ms versus 771 ms;
- 50k interactive p50: about 3.42 s in the colder attributed run;
- 50k post-GC resident memory p50: about 1.14 GiB.

The subsequent 50k watcher phase passed. The shell is now only about 80 ms over
its report-only target; passage I/O and core session construction dominate the
remaining interactive path.

The earlier 50k watcher phase passed passage, asset-review, exact
acknowledgement, and no-recovery assertions. Post-GC resident memory was about
1.26–1.30 GiB, an improvement over the prior 1.33 GiB but still well above the
600 MiB target.

The 10k shell and interactive timings remain inside their roadmap targets.
Resident memory remains above the 600 MiB target, with roughly 21 MiB of WASM
linear memory.

## Gates

Structural invariants fail every run immediately. Absolute targets remain
report-only. When a matching local baseline exists, local checks block:

- Electron timing regressions greater than 15% or 5 ms;
- CLI/native regressions greater than 10% or 2 ms;
- memory regressions greater than 10% or 32 MiB;
- any structural invariant failure.

Machine-fingerprint mismatches produce reports without comparing incompatible
baselines.

## Commands

See [`../../benchmarks/README.md`](../../benchmarks/README.md) for preparation,
phase-specific runs, complete 10k/50k runs, baseline acceptance, and report
interpretation.

Optimization priorities and exit criteria live in
[`../roadmap/performance.md`](../roadmap/performance.md).
