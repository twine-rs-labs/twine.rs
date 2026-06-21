# Rust Workspace

This workspace is the first Rust core skeleton for the incremental `twine.rs`
port.

## Crates

- `twine_model`: canonical story, passage, ID, geometry, project metadata,
  graph-layout sidecar, storage-policy, and structural undo types.
- `twine_parse`: standard Twine link extraction plus Twee, Twine 2 HTML,
  practical Twine 1 tiddler HTML, JSON interchange, and TwineJS localStorage
  importers.
- `twine_graph`: story graph facts for outgoing links, backlinks, self links,
  broken links, node states, generated layouts, focus neighborhoods, link
  layers, and viewport-sized canvas projections.
- `twine_search`: search-index traits plus a baseline linear implementation.
- `twine_store`: persistence traits, JSON fixture helpers, and transactional
  canonical project-folder load/save with backups.
- `twine_export`: JSON, Twee, Twine HTML, story-format binding, and archive
  exporters.
- `twine_cli`: smoke-test CLI for inspecting/importing/exporting supported
  story and project formats.

## Commands

Run all Rust tests:

```sh
cargo test --workspace
```

Run the full Rust M0 quality loop:

```sh
cargo fmt-check
cargo lint
cargo ci
```

Inspect a generated fixture:

```sh
cargo run -p twine_cli -- inspect benchmarks/fixtures/generated/story-50000.story.json
```

Inspect the native graph projection for a fixture:

```sh
cargo run -p twine_cli -- graph benchmarks/fixtures/generated/story-1000.story.json
```

Import a Twee/HTML/JSON source into the M0 project layout:

```sh
cargo run -p twine_cli -- import story.twee /tmp/example.twine
```

Export a project:

```sh
cargo run -p twine_cli -- export /tmp/example.twine twee /tmp/example.twee
```

The first Rust/WASM interop milestone can now build on the M0 core: import
fixtures into the canonical project layout, expose graph indexing to
TypeScript, compare it with the current `passageConnections()` helper, and
benchmark it against generated fixtures.

See `docs/reference/RUST_CORE_STYLE_GUIDE.md` for the Rust core conventions that
should guide the remaining milestone work.
