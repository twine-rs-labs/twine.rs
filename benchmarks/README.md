# Benchmark Fixtures

This folder contains repeatable fixture generation for large Twine stories.

The generated files are intentionally ignored by Git because large-project
fixtures can become tens or hundreds of megabytes. Regenerate them locally when
benchmarking TypeScript, Rust/WASM, or Rust/Tauri implementations.

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

These files are meant to support the first interop experiment from
`docs/reference/RUST_PORT_FEASIBILITY.md`: feeding passage snapshots into a Rust/WASM graph
index and comparing behavior/performance with the existing TypeScript helpers.

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

Run the watcher path independently when diagnosing ingestion without paying
for startup repetition and interaction samples:

```sh
npm run perf:electron:10k:watcher
npm run perf:electron:50k:watcher
```

Edit, query, and graph phases also have size-specific diagnostic commands:

```sh
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
notification, and exact-revision Rust acknowledgement timings. Worker/session
ownership, monotonic revisions, incremental watcher parsing, bounded graph
rendering, isolation, cleanup, and the absence of post-initialization
full-project replacement are blocking invariants.

Watcher diagnostics use the delta ID to correlate epoch-aligned monotonic
timestamps for native observation, scan start, delta creation and notification,
worker receipt, Rust ingestion, and renderer patch application. This separates
debounce/scanning, IPC, Rust compute, and reducer costs when a large fixture
misses the watcher deadline.

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
