# twine.rs

`twine.rs` is a Rust-backed Twine editor.

It is built from TwineJS, keeping the React/Electron workbench and Twine story
format compatibility while adding native project folders, asset handling, graph
tools, import/export code, and CLI workflows through Rust crates.

Use this repo to run the web or desktop editor, work on directory-backed Twine
projects, and test the Rust core that supports parsing, storage, graph
projection, search, and export.

## Prerequisites

- Node.js 20+
- npm 10+
- Rust stable toolchain with `cargo`, `rustfmt`, and `clippy`
- `mdbook` only if you build or serve the docs

## Setup

```sh
npm install
cargo test --workspace
```

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

Serves the documentation from `docs/en`.

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

`npm test` runs Jest in watch mode. `npm run build` creates the Electron build.

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
- `docs/`: user docs, design references, and upstream/reference material.
- `public/locales/`: app localization files.

## License

The upstream TwineJS code is licensed under GPL-3.0. This repository preserves
that license; see `LICENSE`.

Original upstream README: `docs/reference/UPSTREAM_TWINEJS_README.md`
