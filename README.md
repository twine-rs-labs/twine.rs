# twine.rs

`twine.rs` is a Rust-backed Twine editor built from TwineJS.

It keeps the familiar React/Electron workbench and Twine story format
compatibility, while moving project structure, parsing, graph data, storage,
import/export, and CLI workflows into Rust crates.

Use this repo to run the web or desktop editor, work on directory-backed Twine
projects, and test the native core that supports the editor.

## What's Implemented

- Directory-backed project folders with recommended passage-per-file and
  single-Twee source layouts, plus visible assets, metadata, and graph layout.
- Electron project sessions with file-backed save/load, disk change tracking,
  and conflict review.
- A Rust model for stories, passages, IDs, geometry, project manifests, graph
  layout, storage policy, and undo-friendly structural changes.
- Importers for Twee, Twine 2 HTML, practical Twine 1 tiddler HTML, JSON
  interchange, and TwineJS localStorage data.
- Exporters for JSON, Twee, Twine HTML, story-format output, and archive-style
  HTML.
- A native story graph layer with outgoing links, backlinks, broken links,
  self-links, node states, generated layouts, focus neighborhoods, link layers,
  and viewport projections.
- Contents and diagnostics views for passages, tags, variables, assets,
  metadata, broken links, duplicate names, missing assets, orphans, and entry
  points.
- Asset inventory and management for project files, references, snippets,
  previews, missing/unused states, replacement, rename, reveal, and publish
  rules.
- Story workspace modes for map, graph, and text-focused editing.
- Search/index plumbing for source files, symbols, tags, diagnostics, and
  replace previews.
- Generated TypeScript bindings for Rust-shaped commands, patches, project
  snapshots, graph projections, diagnostics, assets, and indexes.
- A `twine_cli` tool for inspecting, graphing, importing, exporting, and
  benchmarking stories and project folders.

## Prerequisites

- Node.js 20+
- npm 10+
- Rust stable toolchain with `cargo`, `rustfmt`, and `clippy`
- Rust's `wasm32-unknown-unknown` target
- `wasm-bindgen-cli` matching the version locked in `Cargo.lock` (currently
  0.2.125)
- `mdbook` only if you build or serve the docs

## Setup

```sh
npm install
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.125 --locked
cargo test --workspace
```

Electron downloads its desktop runtime on demand. The first desktop launch or
performance preparation therefore needs network access; later runs reuse the
cached runtime. The repository scripts perform this download before launching
Electron so it does not become part of a benchmark measurement.

## Run

```sh
npm start
```

Starts the Vite web app.

```sh
npm run start:electron
```

Builds the renderer and Electron main process, then launches the desktop app.

```sh
npm run start:docs
```

Serves the inherited Twine compatibility manual from `docs/en`. The current
twine.rs architecture, status, roadmap, and product documentation starts at
[`docs/README.md`](docs/README.md).

## Build and Check

```sh
npm run lint
npm run build:web
npm run build
npm test
npm run test:coverage
npm run e2e
```

```sh
cargo fmt-check
cargo lint
cargo test --workspace
```

`npm test` runs Jest in watch mode. `npm run dist` creates the Electron release
build.

### Desktop Release

```sh
npm run dist
```

This command builds the web renderer, Electron main process, and desktop package
for the current operating system and CPU architecture. Native addons are built
and verified for that exact target before packaging. The packaged-app CI matrix
builds and smokes unpacked apps on Linux x64 and ARM64, macOS Intel and ARM64,
and Windows x64. Publishable installers must likewise be produced on a matching
target runner; the local release command does not cross-package other targets.

Finished local downloads are organized under the matching `release/mac`,
`release/windows`, or `release/linux` directory, with
`release/WHICH TO DOWNLOAD.md` and `release/SHA256SUMS.txt` written alongside
them. macOS downloads are architecture-specific; choose the file matching the
Mac's CPU.

Twine RS uses its own release version from `package.json` and the Rust workspace
version in `Cargo.toml`. `package.json` also keeps `twineCompatibilityVersion`
for upstream Twine story-format editor-extension compatibility.

## Fixtures and CLI

```sh
npm run bench:fixtures
npm run bench:fixtures:large
```

```sh
cargo run -p twine_cli -- inspect benchmarks/fixtures/generated/story-50000.story.json
cargo run -p twine_cli -- graph benchmarks/fixtures/generated/story-1000.story.json
cargo run -p twine_cli -- import story.twee /tmp/example.twine
cargo run -p twine_cli -- export /tmp/example.twine twee /tmp/example.twee
```

## Project Layout

- `src/`: React UI, Electron shell, store integration, and TypeScript bridge code.
- `crates/`: Rust model, parser, graph, core, search, store, export, and CLI crates.
- `benchmarks/`: generated story fixtures and benchmark helpers.
- `docs/`: current architecture, status, roadmap, product specifications,
  design artifacts, user documentation, upstream material, and archives.
- `public/locales/`: app localization files.

## License

The upstream TwineJS code is licensed under GPL-3.0. This repository preserves
that license; see `LICENSE`.

Documentation index: [`docs/README.md`](docs/README.md)

Original upstream README: [`docs/upstream/README.md`](docs/upstream/README.md)
