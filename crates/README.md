# Rust Workspace

This workspace is the first Rust core skeleton for the incremental `twine.rs`
port.

## Crates

- `twine_model`: canonical story, passage, ID, and geometry types.
- `twine_parse`: parsing primitives, currently standard Twine link extraction.
- `twine_graph`: story graph index for outgoing links, backlinks, self links,
  and broken links.
- `twine_search`: search-index traits plus a baseline linear implementation.
- `twine_store`: persistence traits plus JSON fixture load/save helpers.
- `twine_export`: export interfaces, currently JSON export.
- `twine_cli`: smoke-test CLI for loading fixtures and reporting graph stats.

## Commands

Run all Rust tests:

```sh
cargo test --workspace
```

Inspect a generated fixture:

```sh
cargo run -p twine_cli -- benchmarks/fixtures/generated/story-50000.story.json
```

The first real Rust/WASM interop milestone should build on `twine_parse` and
`twine_graph`: expose graph indexing to TypeScript, compare it with the current
`passageConnections()` helper, and benchmark it against the generated fixtures.
