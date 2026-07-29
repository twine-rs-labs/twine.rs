# Rust Workspace

Status: current
Owner: Rust core maintainers
Last verified: 2026-07-29
Source of truth: workspace `Cargo.toml` files and crate implementations

This workspace contains the Rust libraries and developer tooling that support
the current Twine RS editor. The crates define the canonical model, parsing,
graph, search, storage, export, typed command/query boundary, and engineering
CLI contracts used by the application.

## Crates

- `twine_model`: canonical story, passage, ID, geometry, project metadata,
  graph-layout sidecar, storage-policy, and structural undo types.
- `twine_parse`: standard Twine link extraction plus Twee, Twine 2 HTML,
  practical Twine 1 tiddler HTML, JSON interchange, and TwineJS localStorage
  importers.
- `twine_graph`: story graph facts for outgoing links, backlinks, self links,
  broken links, node states, generated layouts, focus neighborhoods, link
  layers, and viewport-sized canvas projections.
- `twine_core`: typed command → patch/event session spine, project snapshots,
  undo/redo transactions, graph projection commands, and generated TypeScript
  bindings for the workbench bridge.
- `twine_wasm`: wasm-bindgen adapter exposing renderer-side
  `twine_core::ProjectSession` commands, queries, and snapshots across the WASM
  boundary.
- `twine_search`: search-index traits plus a baseline linear implementation.
- `twine_store`: persistence traits, JSON fixture helpers, and transactional
  canonical project-folder load/save with backups.
- `twine_export`: JSON, Twee, Twine HTML, story-format binding, and archive
  exporters.
- `twine_native`: native Node/Electron N-API bridge for project-folder I/O,
  inventory scans, import preparation, and asset operations.
- `twine_cli`: developer-facing `twine-rs` engineering CLI for inspecting,
  graphing, importing, exporting, and benchmarking supported story and project
  formats. It is not the packaged desktop application's command line.

## Commands

Run all Rust tests:

```sh
cargo test --workspace
```

Run the repository Rust quality commands:

```sh
cargo fmt-check
cargo lint
cargo ci
```

Inspect a generated fixture:

```sh
cargo run -p twine_cli -- inspect benchmarks/fixtures/generated/story-50000.story.json
```

List the complete developer CLI command surface:

```sh
cargo run -p twine_cli -- --help
```

Inspect the native graph projection for a fixture:

```sh
cargo run -p twine_cli -- graph benchmarks/fixtures/generated/story-1000.story.json
```

Regenerate frontend command/patch bindings:

```sh
cargo test -p twine_core
```

Import a Twee/HTML/JSON source into a project folder:

```sh
cargo run -p twine_cli -- import story.twee /tmp/example.twine
```

Export a project:

```sh
cargo run -p twine_cli -- export /tmp/example.twine twee /tmp/example.twee
```

See
[`../docs/architecture/rust-core-style-guide.md`](../docs/architecture/rust-core-style-guide.md)
for the Rust core conventions and
[`../docs/architecture/overview.md`](../docs/architecture/overview.md) for the
current runtime boundaries.
