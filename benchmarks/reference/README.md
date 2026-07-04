# Tracked performance references

These small JSON snapshots preserve durable evidence for performance numbers
quoted in repository documentation. They contain environment and fixture
identity, aggregate metrics, normalized invariant results, target evaluation,
and hashes of the ignored source report and budget definition.

They are documentation evidence, not machine-specific regression baselines.
Local baselines remain under the ignored `benchmarks/results/baselines/`
directory.

The initial 10k and 50k snapshots were generated from complete passing reports
captured from a dirty worktree. That limitation is recorded inside each
artifact. Replace them only when a future performance run occurs naturally;
they do not justify rerunning the suite solely for documentation.

Create a reference from an existing complete report:

```sh
npm run perf:reference -- \
  --from benchmarks/results/electron-....json \
  --out benchmarks/reference/YYYY-MM-DD-machine-size.summary.json
```
