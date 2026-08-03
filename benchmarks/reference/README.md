# Tracked performance references

Status: current
Owner: performance maintainers
Last verified: 2026-08-03
Source of truth: normalized JSON references in this directory

These small JSON snapshots preserve durable evidence for performance numbers
quoted in repository documentation. They contain environment and fixture
identity, aggregate metrics, normalized invariant results, target evaluation,
and hashes of the ignored source report and budget definition.

They are documentation evidence, not machine-specific regression baselines.
Local baselines remain under the ignored `benchmarks/results/baselines/`
directory.

The current clean references are:

- [10k same-machine baseline source](./2026-07-18-apple-m4-10000.summary.json)
- [50k released-beta clean reference with a matched baseline](./2026-08-03-apple-m4-50000.summary.json)

Their complete source reports each used one Git revision across all phases and
passed the cross-phase revision and dirty-state assertions. The 10k reference
is from clean revision `0951f942`; its report was captured with
`baselineStatus: "missing"` and then accepted byte-for-byte as the current
same-machine local baseline. The fresh 50k reference is from clean released
revision `d3b25477` (`v0.2.0-beta.2`), passed all 399 blocking invariants and
every regression check, and records `baselineStatus: "matched"`.

A fresh 10k capture was also attempted from the released revision. Repeated
clean runs stopped in the edit phase when the no-long-task invariant observed
renderer stalls. Two host-quiet confirmation runs recorded 86 ms and 245 ms
maximum long tasks and failed the matched edit-paint regression gate. A focused
edit repeat reproduced the failure while worker, bridge, and save timings
remained bounded. Because those reports are incomplete, they are not eligible
as baselines or normalized references, and the July 18 same-machine baseline
source remains current.

The initial
[10k historical snapshot](./2026-07-03-apple-m4-10000.summary.json) and
[50k historical snapshot](./2026-07-03-apple-m4-50000.summary.json) remain for
comparison; their dirty-worktree limitation is recorded inside each artifact.
The previous clean [July 16](./2026-07-16-apple-m4-50000.summary.json) and
[July 21](./2026-07-21-apple-m4-50000.summary.json) 50k references also remain
for comparison; the July 21 report is target-only evidence with
`baselineStatus: "missing"`.
The previous clean
[July 16 10k reference](./2026-07-16-apple-m4-10000.summary.json) remains as
historical cross-machine evidence.

Focused diagnostics can also preserve a small normalized decision record when
the raw evidence is too large to track. The
[V8 live-heap attribution summary](./2026-07-16-apple-m4-v8-memory-attribution.summary.json)
records a serialized 100/50k heap-snapshot comparison and its stop decision.
It is explicitly dirty, single-pair diagnostic evidence, not an accepted
baseline or a substitute for the clean references above.

Create a reference from an existing complete report:

```sh
npm run perf:reference -- \
  --from benchmarks/results/electron-....json \
  --out benchmarks/reference/YYYY-MM-DD-machine-size.summary.json
```
