# Tracked performance references

Status: current
Owner: performance maintainers
Last verified: 2026-07-29
Source of truth: normalized JSON references in this directory

These small JSON snapshots preserve durable evidence for performance numbers
quoted in repository documentation. They contain environment and fixture
identity, aggregate metrics, normalized invariant results, target evaluation,
and hashes of the ignored source report and budget definition.

They are documentation evidence, not machine-specific regression baselines.
Local baselines remain under the ignored `benchmarks/results/baselines/`
directory.

The current clean references are:

- [10k clean reference with a matched baseline](./2026-07-16-apple-m4-10000.summary.json)
- [50k clean target-only reference](./2026-07-21-apple-m4-50000.summary.json)

Their complete source reports each used one clean Git revision and passed the
cross-phase revision and dirty-state assertions. The 10k reference is from
revision `bd13ddd6` and records `baselineStatus: "matched"`. The 50k reference
is from revision `eb090ab` and records `baselineStatus: "missing"`: it passed
the structural invariants, but it has no matched regression baseline and must
not be described as an accepted baseline. The initial
[10k historical snapshot](./2026-07-03-apple-m4-10000.summary.json) and
[50k historical snapshot](./2026-07-03-apple-m4-50000.summary.json) remain for
comparison; their dirty-worktree limitation is recorded inside each artifact.
The previous clean
[50k reference](./2026-07-16-apple-m4-50000.summary.json) also remains for
comparison.

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
