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

The current clean corrected-code references are:

- [10k clean passing reference](./2026-08-03-apple-m4-e6f5446a-10000.summary.json)
- [50k clean failed-gate evidence](./2026-08-03-apple-m4-e6f5446a-50000.summary.json)

Their complete source reports each used one Git revision across all phases and
passed all five phases and all 417 assertions at corrected revision `e6f5446a`.
The 10k evaluation passes; edit-to-paint measured 24.9 ms p95 and the edit
window recorded no long task. The 50k edit result measured 43.6 ms p95 with no
edit-window long task, but its evaluation failed one blocking regression gate:
resident-memory p50 was 1,148.90625 MiB against the July 21 local baseline's
1,044.125 MiB plus 104.4125 MiB allowance, a 1,148.5375 MiB limit. The miss is
0.36875 MiB, or about 0.032% of the limit. The normalized 50k artifact therefore
preserves clean, complete evidence and the exact regression comparator, but is
explicitly not baseline-eligible and is not a baseline replacement.

The initial
[10k historical snapshot](./2026-07-03-apple-m4-10000.summary.json) and
[50k historical snapshot](./2026-07-03-apple-m4-50000.summary.json) remain for
comparison; their dirty-worktree limitation is recorded inside each artifact.
The previous clean [July 18 10k](./2026-07-18-apple-m4-10000.summary.json),
[released-beta August 3 50k](./2026-08-03-apple-m4-50000.summary.json),
[July 16 50k](./2026-07-16-apple-m4-50000.summary.json), and
[July 21 50k](./2026-07-21-apple-m4-50000.summary.json) references are now
historical comparison evidence. The previous clean
[July 16 10k reference](./2026-07-16-apple-m4-10000.summary.json) also remains
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

Reference generation accepts a complete report whose structural invariants
pass even when a blocking regression comparison fails. The normalized summary
retains that failure and marks it ineligible for baseline acceptance. Baseline
acceptance remains stricter and rejects every failed blocking evaluation.
