# Current performance status

Status: current measured snapshot
Owner: performance maintainers
Last verified: 2026-07-11
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
