# Current performance status

Status: current measured snapshot
Owner: performance maintainers
Last verified: 2026-07-04
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

The next save-path work should use diagnostic save-stage metrics first, then
rerun the complete 50k suite only after an optimization materially changes a
reported phase.

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
