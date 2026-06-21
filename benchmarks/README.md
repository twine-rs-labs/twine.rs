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
