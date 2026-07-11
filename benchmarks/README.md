# Benchmark Fixtures

This folder contains repeatable fixture generation for large Twine stories.

The generated files are intentionally ignored by Git because large-project
fixtures can become tens or hundreds of megabytes. Regenerate them locally when
benchmarking the Rust CLI, Rust/WASM sessions, native storage, or Electron
application path.

## Generate Fixtures

Default sizes:

```sh
npm run bench:fixtures
```

Large set, including 50k passages:

```sh
npm run bench:fixtures:large
```

Custom sizes:

```sh
npm run bench:fixtures -- --sizes 1000,2500,10000
```

By default, each size writes three files under
`benchmarks/fixtures/generated/`:

- `story-N.html`: Twine HTML story data.
- `story-N.twee`: Twee source.
- `story-N.story.json`: Twine-like normalized JSON snapshot.

Each generated corpus includes:

- Deterministic passage names and IDs.
- Grid positions and fixed passage dimensions.
- Forward links, branch links, self links, and broken links.
- Tags distributed across the graph.
- A manifest with expected passage and link counts.

These files support Rust, WASM, native, and release-mode Electron performance
tests. The current performance status and active optimization work are recorded
in [`../docs/status/performance.md`](../docs/status/performance.md) and
[`../docs/roadmap/performance.md`](../docs/roadmap/performance.md).

## Release-mode Electron harness

The Electron harness builds the production renderer, native addon, and main
process without packaging an installer. It opens canonical `.twine.rs`
projects through the normal command-line path and measures startup, edits,
undo/redo, contents queries, graph frames, watcher ingestion, and process
memory.

Prepare deterministic 10k and 50k project folders:

```sh
npm run perf:prepare
```

This generates JSON story input and delegates project-folder creation to the
release `twine_cli import` command. Generated sources, projects, reports, and
baselines are ignored by Git.

Performance commands refuse to launch when the production Electron build is
older than app or native sources. Re-run `npm run perf:prepare` after changing
renderer, Electron main, Rust, or build configuration code.

Run either size or both:

```sh
npm run perf:electron:10k
npm run perf:electron:50k
npm run perf:electron:all
```

Each full run executes startup, edit/persistence, contents/search, graph, and
watcher work as separate Playwright processes. Phase reports are merged after
completion, while a `.checkpoint.json` file beside the report is updated at
phase boundaries. The temporary launch trace records per-sample progress and
is copied into the checkpoint when each child process exits. This preserves
launch and phase state when a process crashes or times out.

For fast 50k edit/save investigation, run the diagnostic phase:

```sh
npm run perf:electron:50k:diagnostic
```

This performs one release Electron launch and one text edit, then waits for
paint, persistence, notification, and exact-revision Rust save acknowledgement.
The report is intentionally partial and cannot be accepted as a regression
baseline or compared against a local baseline. It preserves the structural
assertions needed during optimization without requiring repeated full 50k
benchmark runs.

For the passage text fast path, the diagnostic also requires `incremental` save
mode and one touched project path. Its save-stage metrics distinguish native
conflict checking, touched-file writes, baseline patching, and Rust save
acknowledgement from end-to-end edit latency.

Run the watcher path independently when diagnosing ingestion without paying
for startup repetition and interaction samples:

```sh
npm run perf:electron:10k:watcher
npm run perf:electron:50k:watcher
```

The watcher phase first waits for initial asset-inventory synchronization to
leave the serialized core-session queue. It performs one unreported passage
warm-up, then measures five independent edits to the deterministic median
fixture passage. Holding the entity constant makes the distribution expose
runtime variance rather than graph-position variance. Each edit completes native
acknowledgement before the next starts. It reports distribution aggregates for
native observation, Rust ingestion stages, the WASM boundary, renderer patch
application, and end-to-end latency. One asset-only edit then verifies the
review path without mixing startup work into either scenario.

Edit, query, and graph phases also have size-specific subsystem commands:

```sh
npm run perf:electron:10k:diagnostic
npm run perf:electron:50k:edit
npm run perf:electron:50k:query
npm run perf:electron:50k:graph
```

For a quick harness check, build and generate the 100-passage fixture once,
then run the abbreviated scenario:

```sh
npm run perf:prepare:smoke
npm run perf:electron:smoke
```

Each run copies its source fixture into a temporary working folder and uses a
temporary Electron user-data and story-library root. It never opens the
developer's real preferences, remembered projects, backups, or asset journals.
Electron `userData` and `sessionData` are both isolated. The outer runner owns
the complete temporary run root and removes it even when Playwright reaches its
hard timeout. Every completed report blocks if the full source-fixture tree
changed, a user-data path escaped the run root, or cleanup left the run root
behind.

On macOS, launches are separated by a short teardown barrier. Playwright owns
and terminates the Electron process group; the harness does not use broad
process-name kills that could terminate unrelated Electron applications.

Reports are written as paired JSON and Markdown files under
`benchmarks/results/`. Absolute roadmap targets from `budgets.json` are shown
but remain report-only. Reports include persistence queue, native save, save
notification, exact-revision Rust acknowledgement timings, and perf-gated
save-stage timings for native deserialization, project construction,
project-folder writes, changed-file planning, sidecar writes, and baseline
refresh. Worker/session ownership, monotonic revisions, incremental watcher
parsing, bounded graph rendering, isolation, cleanup, and the absence of
post-initialization full-project replacement are blocking invariants.

Watcher diagnostics use the delta ID to correlate epoch-aligned monotonic
timestamps for native observation, scan start, delta creation and notification,
worker receipt, Rust ingestion, and renderer patch application. This separates
debounce/scanning, IPC, Rust compute, and reducer costs when a large fixture
misses the watcher deadline.

## Tracked reference summaries

Raw reports and accepted regression baselines remain ignored. Small normalized
reference summaries under [`reference/`](./reference/README.md) preserve
durable evidence for performance numbers quoted in repository documentation.
They include report and budget hashes, Git dirty state and revision, machine and
dependency identity, fixture identity, aggregates, phase results, and
normalized invariant outcomes.

Create one from an existing complete report without rerunning the benchmark:

```sh
npm run perf:reference -- \
  --from benchmarks/results/electron-...-50000.json \
  --out benchmarks/reference/YYYY-MM-DD-machine-50000.summary.json
```

Reference summaries are documentation evidence, not portable regression
baselines. A dirty-worktree source remains explicitly marked as historical
rather than being presented as clean-commit reproducibility evidence.

## Local baselines

Accept a completed all-phase report explicitly:

```sh
npm run perf:baseline -- --from benchmarks/results/electron-...-10000.json
```

The accepted baseline is stored under the ignored
`benchmarks/results/baselines/` directory using a machine fingerprint. Later
runs on that machine fail when Electron timings regress by more than 15% or
5 ms, native timings by more than 10% or 2 ms, or resident memory by more than
10% or 32 MiB. Partial startup, edit, query, graph, or watcher reports are
rejected as baselines, as are reports missing any budgeted metric.

Recheck the newest report, optionally for a particular size:

```sh
npm run perf:check
npm run perf:check -- --size 50000
```

A missing or mismatched machine baseline is reported without comparing
wall-clock values. `perf:check` requires a complete all-phase report; use the
phase-specific commands and their generated reports directly for diagnostics.
Baselines are intentionally local because timings from different CPUs and
operating systems are not comparable. Hosted CI and packaged-app performance
runs remain separate future work.
