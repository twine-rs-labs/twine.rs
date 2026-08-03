# Current performance status

Status: current measured snapshot
Owner: performance maintainers
Last verified: 2026-08-03
Source of truth: release-mode Electron harness and tracked normalized references

## Harness state

The local harness builds production web, native, and Electron main code without
packaging. It generates deterministic 10k and 50k project folders, copies each
fixture into an isolated temporary run root, and measures startup, editing,
queries, graph frames, watcher ingestion, bridge payloads, persistence, and
process memory.

The current tracked pair contains complete Apple M4 runs that pass all
machine-independent structural invariants. Raw reports and machine-specific
baselines remain ignored, while normalized reproducibility evidence is tracked:

- [10k same-machine baseline source](../../benchmarks/reference/2026-07-18-apple-m4-10000.summary.json)
- [50k released-beta reference](../../benchmarks/reference/2026-08-03-apple-m4-50000.summary.json)

The 10k source report was captured from clean revision `0951f942`, retained
that revision and clean state through all five phases, and passed every
blocking invariant. It recorded `baselineStatus: "missing"` before that exact
report was accepted as the current same-machine local baseline. The fresh 50k
report was captured from clean released revision `d3b25477`
(`v0.2.0-beta.2`), retained that revision and clean state through all five
phases, passed all 399 blocking invariants and every regression check, and
recorded `baselineStatus: "matched"`. The
[July 16](../../benchmarks/reference/2026-07-16-apple-m4-50000.summary.json) and
[July 21](../../benchmarks/reference/2026-07-21-apple-m4-50000.summary.json)
50k references remain tracked for historical comparison, as do the earlier
July 3 dirty-worktree summaries.

## Released-beta baseline refresh

The clean full 50k suite from `v0.2.0-beta.2` completed on 2026-08-03 with no
blocking regression. Shell visibility measured 2.371 s p50, interactive startup
1.587 s p50, Contents 70.6 ms p95, search 15.6 ms p95, edit-to-paint 43.4 ms
p95, graph frames 17.5 ms p95 and 17.8 ms maximum, retained resident memory
1,145 MiB p50, and watcher observation-to-patch 264.0 ms p95. Shell,
interactive, Contents, edit paint, graph p95, and resident memory still miss
their absolute roadmap targets; search, graph maximum, and every matched
regression gate pass.

The requested 10k refresh did not produce a replacement accepted baseline.
Preparation first regenerated the checked-in WASM artifact, making the initial
complete diagnostic dirty. After restoring clean tag provenance, repeated full
runs stopped in the edit phase on the no-long-task invariant. Two confirmation
runs with the unrelated VS Code Playwright server stopped at the OS process
level still observed 86 ms and 245 ms maximum renderer long tasks and failed
the matched edit-paint regression gate. A focused edit-only repeat observed
245 ms and 129 ms long tasks, including a repeat of the 245 ms edit-4 stall;
worker apply operations remained near 10 ms, and native persistence stayed below
27 ms p95. Query, graph, and watcher never ran in the failing full suites. Those
raw local reports are retained as diagnostics, while the clean July 18
same-machine baseline remains the current durable 10k evidence.

## July-to-released-beta comparison

The closest like-for-like comparators are the clean July 18 10k local-baseline
source at `0951f942` and the clean July 21 50k reference at `eb090ab`. They
share the current machine fingerprint, fixture identity, Electron and
Playwright versions, and startup/memory measurement contracts. macOS changed
from Darwin 25.5 to 25.6, and the raw report schema changed from 1 to 2 without
changing those metric contracts.

The current 10k data is failing partial evidence, not a new baseline. The range
below uses the two host-quiet confirmation runs; both passed startup, then
stopped in edit.

| 10k metric                    |   July 18 |   Current range |              Change | Reading                                      |
| ----------------------------- | --------: | --------------: | ------------------: | -------------------------------------------- |
| Shell visible, p50            |  994.6 ms |  563.9–910.3 ms |    8.5–43.3% faster | Improved, but still misses the 400 ms target |
| Interactive/open, p50         |  660.3 ms |  387.4–574.0 ms |   13.1–41.3% faster | Still passes the 1.5 s target                |
| Edit to paint, p95            |   25.7 ms |   57.9–106.4 ms |     125–314% slower | Blocking regression; limit 30.7 ms           |
| Renderer long-task maximum    |      0 ms |       86–245 ms | New blocking stalls | Reproduced in a focused edit-only run        |
| Startup post-GC resident, p50 | 663.1 MiB | 712.0–712.1 MiB |   about 7.4% higher | Same three-sample checkpoint; target miss    |

The startup memory row compares the same explicit three-sample checkpoint, not
the policy's cross-phase resident-memory aggregate. It is descriptive because
the current suites did not progress beyond edit. The edit result is unambiguous
at the policy level: both confirmation runs exceed the 30.7 ms matched-baseline
limit and the focused edit run reproduces the long tasks.

The current 50k report is complete and clean, so its comparison is suitable for
the normal regression policy.

| 50k metric                        |     July 21 |    August 3 |       Change | Reading                                                  |
| --------------------------------- | ----------: | ----------: | -----------: | -------------------------------------------------------- |
| Shell visible, p50                |  4,581.4 ms |  2,371.4 ms | 48.2% faster | Material improvement; 400 ms target still missed         |
| Interactive/open, p50             |  3,280.3 ms |  1,586.6 ms | 51.6% faster | Material improvement; 1.5 s target narrowly missed       |
| Passage reindex compute, p95      |      4.6 ms |      1.2 ms | 73.9% faster | Target passes                                            |
| Contents query, p95               |     88.6 ms |     70.6 ms | 20.3% faster | Improved; 50 ms target still missed                      |
| Search query, p95                 |     30.4 ms |     15.6 ms | 48.7% faster | Target passes                                            |
| Edit to paint, p95                |     83.2 ms |     43.4 ms | 47.8% faster | Material improvement; 16.6 ms target still missed        |
| Graph frame, p95                  |     18.6 ms |     17.5 ms |  5.9% faster | Essentially unchanged; 16.6 ms target still missed       |
| Graph frame, maximum              |     18.8 ms |     17.8 ms |  5.3% faster | Essentially unchanged; 50 ms target passes               |
| Retained resident memory, p50     | 1,044.1 MiB | 1,145.0 MiB |  9.7% higher | Within regression allowance by only 3.6 MiB; target miss |
| Watcher observation to patch, p95 |    325.6 ms |    264.0 ms | 18.9% faster | Directional diagnostic improvement                       |

The large 50k latency changes are material directional evidence, but the
August side is one full suite rather than a repeated sample, so this is not a
claim of statistical significance. The 100.9 MiB memory increase deserves
attention: it passes the blocking regression gate only because the policy
allows 10% growth, and it remains far above the 600 MiB absolute target.

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

Standard edit/query/graph phases now use memory measurement contract 3. They
record both the live final state and an explicit post-GC retained checkpoint,
including renderer/main heap, worker WASM linear memory, Electron process-role
working sets, and non-additive logical owner details. Residual renderer and main
working sets subtract only top-level heap/WASM or heap/external owners so nested
payload, document, and Rust cache counters are not double-counted.

The repeatable memory matrix adds native main/renderer private memory,
project-bearing private memory, and Blink allocation counters to that logical
owner model. On macOS, an optional multi-process physical-footprint sample
further separates growth by Electron role and VM category without summing
shared regions once per process.

## Recent focused validation

The complete 10k and 50k suites passed and were accepted as clean local
baselines on 2026-07-16. Their cross-phase provenance assertions remained on
revision `bd13ddd6`, and all blocking invariants passed. At 50k, graph frames
measured 17.9 ms p95 and 33.4 ms maximum with no frame over 50 ms. Three clean
focused repeats measured 17.3–17.7 ms p95; both warm repeats stayed at
33.3–33.4 ms maximum, while the first cold repeat contained one 135.1 ms
outlier. Persisting graph viewport state outside route rendering and avoiding a
50k-story bounds scan during ordinary interaction have therefore closed graph
frame stability as the next optimization goal; a deeper projection rewrite is
not currently warranted.

The three-sample 100/10k/50k matrix found repeatable project-bearing private
growth from 136.8 MiB to 499.5 MiB. Known logical owners explain about 44.7% of
that increase. The de-duplicated macOS physical footprint grew from 442.3 MiB
to 811.9 MiB; about 345.3 MiB of the 369.6 MiB increase was in application VM
tag 16, concentrated in the Tab (+248.9 MiB) and Browser (+114.0 MiB)
processes. GPU and utility growth was negligible. The next performance goal is
therefore to attribute those V8-backed allocations to concrete renderer and
main-process project representations, then optimize the largest owner. Smaller
Contents, edit-paint, and startup misses remain conditional follow-ups.

A source-free, serialized 100/50k V8 live-heap diagnostic then tested that
next step. Main and renderer snapshots reconcile with the harness used-heap
deltas within 0.22 MiB combined. The renderer retains exactly three passage
presentation objects per passage, but their joint retained growth is 39.12 MiB,
or 39.69 MiB including all three direct holders. The largest independently
removable root is the 20.37 MiB body-free core-host copy; the other roots are
React alternate props and required renderer context. The family therefore
misses the predeclared 40 MiB owner gate and the diagnostic has only one pair,
so no optimization was selected. See the
[tracked diagnostic summary](../../benchmarks/reference/2026-07-16-apple-m4-v8-memory-attribution.summary.json).
If memory attribution resumes, the justified next probe is clean, repeated,
and worker-inclusive; passage-model deduplication is not an active goal.

Fresh release-mode 50k query, graph, edit, and watcher phases passed on
2026-07-15 after the compact Contents, layout-save, external-ingest, and harness
changes landed. All structural assertions passed.

- Cold Contents reached a matching painted result in about 308 ms. The first
  core request took about 255 ms and transferred 18.5 KiB without constructing
  a graph or full read model. Warm Contents measured 70.2 ms p95, with the
  cached core request at 5.7 ms p95 and result-to-paint at 25.9 ms p95. The
  follow-up compact All-filter search measured 17.4 ms p95 and retained only
  nine selected-passage analyses, no graph, and no complete read model.
- Twenty clean edit samples measured 17.6 ms worker round trip and 23.4 ms
  edit-to-paint at p95. No measured edit overlapped external ingestion.
- Five paced graph pans changed only the world transform and advanced no core
  revision. One deliberate graph drag advanced exactly one revision and used
  one layout-only native incremental save. Graph frames measured 17.2 ms p95
  with a 151.0 ms maximum, down from 33.4/400.1 ms. The remaining isolated
  maximum coincides with a bounded viewport-projection refresh, not a save.
- Five warm external passage edits measured 4.3 ms core ingestion p95. Graph
  and read-model work were each at or below 0.1 ms, history work was zero, and
  topology-neutral text changes performed no graph reparse. Observation to
  renderer patch measured 324.8 ms p95, dominated by the roughly 151 ms watcher
  coalescing window and 164.8 ms native delta creation p95.

These results closed the project-scale fallback goals and motivated the graph
and memory work validated above.

The 50k diagnostic, query, graph, and watcher phases passed on 2026-07-10. They
validate the incremental project-folder save path, bounded Contents path, and
steady-state watcher path without requiring another complete multi-phase run.
These ignored local reports remain historical engineering evidence; the clean
July 16 summaries remain durable historical evidence and comparison. The
current tracked pair and its distinct baseline statuses are identified above.

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
pass. Fresh 50k startup, diagnostic, query, and watcher phases on 2026-07-12
also passed every structural invariant. Startup measured interactive p50 at
about 2.94 s and post-GC resident p50 at about 1.044 GiB, while the retained
renderer heap was only about 31 MiB. The boundary cutover is therefore complete,
but the remaining resident-memory target is dominated by non-React-heap
representations.

The same validation measured warm edit-to-paint at about 39.4 ms, incremental
save end-to-end at about 579 ms, Contents p50 at about 63.1 ms, search p50 at
about 12.9 ms, and watcher observation-to-patch p50 at about 478 ms. Incremental
save was dominated by its roughly 526 ms baseline patch; watcher core ingestion
was about 11.1 ms p50 while native delta creation was about 306 ms p50.

The follow-up implementation adds fixed-versus-project memory attribution and
removes the identified transient owners. Bootstrap documents and native
hydration leases are empty at post-GC readiness. Native accepted watcher state
no longer retains story/passage snapshots, and text-only persistence updates
one indexed fingerprint without rebuilding the 50k-entry collection or
rereading the descriptor.

The focused one-sample memory matrix passed on 2026-07-13:

| Fixture |  Resident | Browser | Renderer |     GPU | Utility |
| ------- | --------: | ------: | -------: | ------: | ------: |
| 100     |   524 MiB | 185 MiB |  189 MiB | 102 MiB |  48 MiB |
| 10k     |   665 MiB | 239 MiB |  272 MiB | 106 MiB |  48 MiB |
| 50k     | 1,063 MiB | 412 MiB |  497 MiB | 105 MiB |  48 MiB |

At all three sizes, retained bootstrap text, native hydration text capacity,
hydration lease count, and accepted-baseline passage count were zero. At 50k,
the explicitly attributed retained native path strings were about 13.5 MiB
(7.9 MiB baseline file strings and 5.6 MiB descriptor paths), while WASM linear
memory was about 96 MiB. The project-size growth is therefore concentrated in
the browser and renderer working sets rather than the removed transient body
owners. The 50k resident result remains well above the 600 MiB roadmap target.
The additive `memory-detail` phase now separates editor creation, edit/save,
editor disposal, and bounded Contents-route checkpoints and reports worker,
Rust, native, and renderer owner counts at the same points. The confirming 50k
run passed on 2026-07-13. It found that editor creation, one edit/save, and
editor disposal add only about 6 MiB retained and leave no editor document,
pending worker request, or session queue behind.

The same trace identified two large Rust/WASM owners:

- Selected-passage facts currently construct the complete graph/backlink cache.
  This grows WASM linear memory from about 96 MiB to 197.5 MiB and leaves the
  normal editor workspace at about 1.13 GiB resident.
- Opening Contents explicitly constructs the 50,002-source analysis/read-model
  cache. The cold query took about 14.4 s, grew WASM to about 251.6 MiB, and
  left about 1.18 GiB resident after returning to the workbench.

Automatic launcher/app-shell word counts now use a scalar Rust query, and the
aggregate workbench dock model is deferred until Contents, Assets, or global
diagnostics are opened. Consequently a normal edit no longer waits behind the
cold full read-model build: its measured worker round trip was about 7.5 ms.
Graph/backlink representation and cold Contents construction are now the
dominant memory and latency targets.

The selected-passage path has subsequently been split. Local passage facts now
parse only the selected source and resolve
its outgoing links through the story name index; they do not initialize graph
layout, reachability, or the full read model. Exact backlinks load independently
as a revision-bound page backed by a 16-entry/4 MiB LRU. A cold backlink lookup
streams all passage sources because an exact incoming count inherently requires
examining them, but retains only matching compact link records. Resident entries
are updated from one changed source across apply, undo/redo, and external text
ingestion. Product routes no longer call the compatibility combined-passage
query. The detailed memory phase now reports backlink scan/cache ownership and
asserts bounded product query payloads.

The confirming 50k memory-detail run on 2026-07-13 passed. Before opening the
editor it retained about 1.026 GiB resident and 100.2 MiB of WASM, with one
analyzed source, one empty-target backlink-cache entry, and no graph or full
read-model cache. This replaces the preceding roughly 1.13 GiB/197.5 MiB
selected-passage state, removing about 97 MiB of WASM and roughly 100 MiB of
total resident memory in this one-sample comparison. Local facts transferred
782 bytes in about 10.7 ms round trip; the first backlink page transferred 116
bytes, completed within the same 16.4 ms serialized query window, and scanned
50,000 sources once without retaining unrelated edges. The normal product path
issued no compatibility passage-facts request.

Contents is now clearly the next large explicit cost in this trace: its cold
page took about 38.4 s and grew WASM to 271.8 MiB by constructing the
50,002-source analysis/read-model and full graph caches. That one-sample time is
colder than the preceding 14.4 s observation, but both identify the same
remaining owner rather than a selected-passage regression.

The follow-up removes that eager work from the default Contents page. A compact,
revision-bound catalog now supplies passage, tag, entry-point, script,
stylesheet, and story-metadata rows without source parsing, graph construction,
or the full read model. Asset, variable, problem, orphan, and diagnostic filters
still initialize the complete intelligence cache on demand. Incomplete facet
counts are identified in the response and rendered as deferred rather than as
false zeroes. The benchmark now correlates a new query submit to its matching
result and post-result paint, reports cold and warm pages separately, and
requires the worker queue to drain before the phase completes.

Layout persistence and external ingestion were narrowed at the same boundary.
A passage move carries a `passageLayout` hint, skips document materialization,
and atomically updates only `.twine/graph.json` after checking its accepted
fingerprint; the native baseline and descriptor are patched in place. Common
non-structural external batches use compact story/passage/project-layout deltas
instead of cloning the complete session and project. The graph phase now makes a
real layout edit and blocks on an incremental save acknowledgement with no full
fallback or in-flight revision.

The standard 50k diagnostic also passed after the deferral change. Its single
warm edit measured about 18.3 ms round trip and 19.9 ms to paint, down from the
preceding roughly 36.6 ms sample and close to the 16.6 ms target. Incremental
save remained fast at about 78.3 ms end to end, 6.9 ms native, and 0.22 ms for
baseline patching. The edit retained one analyzed source and no full read-model
cache.

The rebuilt post-backlink-cutover diagnostic passed with essentially the same
edit result: about 18.7 ms worker round trip and 20.4 ms to paint. Incremental
save measured about 111.3 ms end to end and 7.5 ms native, while resident memory
was about 1.025 GiB. A transient pre-refinement sample exposed and removed a
50k-rank-map clone from backlink maintenance; the final updater resolves the
changed passage rank directly and parses that source once for every resident
backlink target.

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
