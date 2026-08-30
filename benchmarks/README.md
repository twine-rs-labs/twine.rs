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

Prepare an isolated 10k Chapbook 2.3.1 project without replacing the default
Harlowe fixtures:

```sh
npm run perf:prepare:chapbook:10k
```

The Chapbook fixture is stored under
`benchmarks/fixtures/generated/variants/chapbook/`. Run its focused editor and
memory-detail phases with:

```sh
npm run perf:electron:chapbook:10k:edit
npm run perf:electron:chapbook:memory-detail:10k
```

Preparation installs the Electron runtime before building fixtures. The first
run needs network access; later runs reuse Electron's download cache. Keeping
this download in preparation prevents it from affecting launch measurements.

This generates JSON story input and delegates project-folder creation to the
release `twine_cli import` command. Generated sources, projects, reports, and
baselines are ignored by Git. Rust/WASM is rebuilt before the renderer bundle,
so Rust query or diagnostics changes cannot leave a stale core module in the
release harness.

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

By default, a full run continues after a validated, completed phase reports a
failed measurement invariant. The Playwright child still exits zero for this
measurement-gate failure, while the runner records the phase and merged report
as failed and baseline-ineligible. Missing, malformed, mismatched,
infrastructure-failed, retry-unstable, build-changed, or provenance-unstable
phase reports abort the run; every nonzero Playwright exit is infrastructure.
Add `--fail-fast` to stop after the first measurement-invariant failure too.

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

For startup and retained-memory work, run the focused startup phase:

```sh
npm run perf:electron:10k:startup
npm run perf:electron:50k:startup
```

It runs three fresh processes and records native shell/full-text load stages,
renderer hydration and snapshot construction, WASM session initialization,
memory at startup readiness marks, and a perf-only post-GC retained checkpoint.
Reports include main/renderer heap, process working sets, WASM linear memory,
payload sizes, Rust session/cache entity counts, and native baseline-receipt
construction, adoption, and changed-path catch-up. Native load attribution also
separates manifest parsing, graph layout, passage and story sources, assets,
worker count, and bytes read. Startup assertions require a lightweight shell,
a complete full hydration, and an accepted watcher baseline from files visited
during hydration rather than a second traversal. Startup phase reports are
partial evidence and cannot be accepted as complete baselines.

Normal edit, graph, and query phases record both `memory.live.*` before forced
collection and `memory.retained.*` afterward. The canonical `memory.*` values
use the retained checkpoint under memory contract 5. Renderer residual subtracts
renderer JS heap, dedicated-worker CDP `Runtime.getHeapUsage.usedSize`, and worker
WASM from Tab working set; main residual subtracts main JS heap and external
memory from Browser working set. The observer attaches only in `TWINE_PERF=1`
before the authoring page loads, accepts exactly one bundled
`twine-wasm-worker-*.js` target, and rejects unsupported, ambiguous, detached,
or timestamp-drifted samples. `totalSize` and any worker `performance.memory`
value are diagnostics only; backing storage is never added. Logical owners such
as cached payloads, project documents, and Rust caches are nested breakdowns and
must not be added to those top-level values again.

For fast project-size memory attribution, run:

```sh
npm run perf:electron:memory
```

This runs three fresh startup processes each at 100, 10k, and 50k passages and
emits a `memory-matrix-*.json` decision artifact. Reports retain the summed
working-set metric for regression continuity and add native private memory for
the main and renderer processes, project-bearing private memory, Blink
allocation counters, process-role deltas from the `open-start` checkpoint,
bootstrap/native-lease ownership, and accepted-baseline/descriptor estimates.
The matrix requires one clean revision, machine fingerprint, and measurement
contract across every sample, then reports whether project-size growth is
repeatable and sufficiently attributed. These diagnostic reports are not
eligible as baselines.

On macOS, add de-duplicated physical-footprint attribution with:

```sh
npm run perf:electron:memory:footprint:macos
```

This captures all Electron child processes in one `/usr/bin/footprint` sample,
then reports physical growth by process role and VM category. It may require
permission to inspect Electron child processes. Its `memoryFootprint1` contract
is focused diagnostic evidence, not a portable or accepted baseline.

For lifecycle-level renderer attribution, run one of:

```sh
npm run perf:electron:memory-detail:100
npm run perf:electron:memory-detail:10k
npm run perf:electron:memory-detail:50k
```

The detailed phase closes the default workspace editor, waits for zero active
editors, and records that state as `before-editor`. It then opens exactly one
measured editor and records retained checkpoints after editor creation, after
one edit and save, and after editor closure; `editor.openMs` measures the first
open through visible, owner-ready state. A compact lifecycle probe next holds
four distinct passage editors open at once, focuses each window, then closes
them while verifying the owner count steps back to zero and document ownership
is released after forced collection. Chapbook runs also record exactly one
adapter and look-ahead line-index creation per opened passage. The phase
finishes with a bounded Contents route visit. Each checkpoint includes
process-role working sets, renderer and main heap fields, active editor
document ownership, worker query cache/pending-request state, Rust session owner
counts, native hydration leases, and baseline/descriptor estimates.
Selected-passage attribution additionally records local-fact and backlink query
payloads, backlink scan/cache counts and bytes, and rejects the compatibility
combined passage-facts query on product routes. It asserts that editor
documents, completed requests, session queues, bootstrap bodies, and hydration
leases are released.
Like the startup memory matrix, this is focused diagnostic evidence and cannot
be accepted as a complete baseline.

Full hydration uses a shared pool capped at eight workers. For controlled local
experiments, `TWINE_NATIVE_LOAD_THREADS=<count>` overrides the pool size and is
forwarded into benchmark Electron processes. This is diagnostic configuration,
not a reason to compare reports captured with different worker counts.

Canonical saves also write a validated compiled manifest under `.twine/cache/`.
Startup reports separate manifest reads, SHA-256 hashing, compiled-cache reads
and decoding, and TOML fallback parsing. Canonical fixture runs require both
shell and full hydration to hit the compiled cache, share the same manifest
digest, and perform no TOML parse. The watcher ignores generated cache paths.

Startup and memory metrics carry explicit measurement-contract versions. When
checkpoint semantics change, matching-machine reports remain visible but are
not compared against incompatible historical startup or memory values.

The blocking refactor peak is one coherent tuple: renderer-window JS plus the
dedicated worker's CDP heap `usedSize` and WASM linear memory from one latest
worker response. The CDP sample timestamp and worker-response timestamp must
remain within the declared 5-second drift bound. Yielded planner chunks are
sampled locally, but only the first and terminal chunks cross the awaited native
checkpoint boundary; this is an intentional near-boundary sampling limit, not
permission to combine maxima from different responses.

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
review path without mixing startup work into either scenario. A
topology-neutral passage edit must avoid graph reparsing; the native watcher
still reads exactly the one changed source file.

Edit, query, and graph phases also have size-specific subsystem commands:

```sh
npm run perf:electron:10k:diagnostic
npm run perf:electron:50k:edit
npm run perf:electron:50k:query
npm run perf:electron:50k:graph
```

Contents timing is correlated to a new query submit, its matching worker result,
and the first paint that commits that result; an empty route placeholder is not
a completed sample. Reports separate the first cold Contents page from warm
reopens, and the query phase must finish with no pending worker requests or
session work. Ordinary edit aggregates exclude samples that overlap an external
delta and report those separately. After two warm-up edits, the edit phase uses
Chromium's Long Tasks API to observe each complete editor-input-to-paint window
and blocks on any editor-window task over 50 ms; lack of API support is an
explicit failure. Chapbook runs additionally edit, persist, and restore
deterministic lines at the beginning, middle, and end of the 4,096-line
variable preamble, requiring zero adapter or look-ahead index rebuilds at every
location. The graph phase performs a real node-layout mutation and blocks
unless its final revision is acknowledged through an incremental native save
with no full-save fallback or work left in flight.

Focused edit diagnostics can disable the native Harlowe story-format editor or
capture a renderer trace and 1 ms sampled CPU profile:

```sh
node benchmarks/run-electron-performance.mjs --size 10000 --phase edit --disable-harlowe-editor-extensions
node benchmarks/run-electron-performance.mjs --size 10000 --phase edit --profile-edit
```

Both flags require an explicit `--phase edit`; the disable control also requires
the default Harlowe fixture. Reports record the requested configuration and
whether the Harlowe native toolbar was actually active. Profile artifacts are
written beside the JSON report as `.edit-trace.json.gz` and `.edit.cpuprofile`.
These focused reports are diagnostic-only and are not complete baseline
evidence. Edit reports also retain per-edit-correlated bridge, renderer patch,
and story dispatch stage samples so renderer response stalls can be attributed
without rebuilding product instrumentation.

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

## Editor bundle comparison

After a production Electron renderer build, compare the CSS and JavaScript
entry assets referenced by its `index.html` with the retained CodeMirror 5
production reference:

```sh
npm run build:electron-app
npm run perf:bundle
```

The tracked
[`reference/editor-bundle-codemirror5.json`](./reference/editor-bundle-codemirror5.json)
records the original asset names, raw sizes, gzip sizes, and SHA-256 hashes.
The check resolves only the current entry assets from the generated HTML, so
stale hashed files left by an earlier local build cannot inflate the result.
It fails unless the current combined gzip size is smaller than that reference.

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
`benchmarks/results/baselines/` directory using a machine fingerprint. Default
fixtures retain the legacy `<fingerprint>-<size>.json` filename; non-default
fixtures append their variant, such as
`<fingerprint>-10000-chapbook.json`. Reporting, acceptance, and rechecks reject
cross-variant comparison, so Chapbook cannot load or overwrite a default
Harlowe baseline. Later runs on that machine fail when Electron timings regress
by more than 15% or
5 ms, native timings by more than 10% or 2 ms, or resident memory by more than
10% or 32 MiB. Partial startup, edit, query, graph, or watcher reports are
rejected as baselines, as are reports missing any budgeted metric. Acceptance
also requires a clean worktree and the same recorded Git revision and dirty
state in every benchmark phase.

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
