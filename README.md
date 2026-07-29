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
- A developer-facing `twine_cli` engineering tool for inspecting, graphing,
  importing, exporting, and benchmarking stories and project folders. It is
  separate from the packaged desktop application's command line.

## Prerequisites

- Node.js 24.18.0 (also pinned in `.nvmrc` and CI)
- npm 11+
- `rustup`; `rust-toolchain.toml` pins Rust 1.96.0 with `rustfmt`, `clippy`,
  and the `wasm32-unknown-unknown` target
- `wasm-bindgen-cli` matching the version locked in `Cargo.lock` (currently
  0.2.125)
- mdBook 0.5.4 only if you build or serve the docs

## Setup

```sh
npm install
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.125 --locked
cargo test --workspace
```

Install the pinned documentation builder only when working on the served manual:

```sh
cargo install mdbook --version 0.5.4 --locked
```

Electron downloads its desktop runtime on demand. The first desktop launch or
performance preparation therefore needs network access; later runs reuse the
cached runtime. The repository scripts perform this download before launching
Electron so it does not become part of a benchmark measurement.

Playwright browser binaries are only needed for browser end-to-end tests, not
for unit tests, linting, or documentation checks. Before running
`npm run e2e`, install all configured Chromium, Firefox, and WebKit browsers:

```sh
npx playwright install
```

The production-build offline check, `npm run e2e:pwa`, needs only Chromium:

```sh
npx playwright install chromium
```

On Linux, use this command instead to install the browsers and their required
system packages:

```sh
npx playwright install --with-deps
```

Add `chromium` to that command when only running `npm run e2e:pwa`.

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
npm run build:docs
npm test
npm run test:coverage
npm run e2e
```

```sh
cargo fmt-check
cargo lint
cargo test --workspace
```

`npm test` runs Jest in watch mode. `npm run dist` creates local-only
installable Electron artifacts for the current host target.

### Desktop Release

Release builds are not publishable merely because a host packaging command
succeeds. [`RELEASING.md`](RELEASING.md) defines the approval, changelog,
annotated tag, checklist, support, rollback, evidence-retention, and immutable
publication process. Twine RS has not yet completed its first formal release
under that process.

```sh
npm run dist
ALLOW_UNSIGNED_DISTRIBUTION=1 npm run dist:distributable-unsigned
npm run dist:signed
```

The acknowledgement assignment above is for POSIX shells. In PowerShell, use:

```powershell
$previousAcknowledgement = $env:ALLOW_UNSIGNED_DISTRIBUTION
try {
  $env:ALLOW_UNSIGNED_DISTRIBUTION = '1'
  npm run dist:distributable-unsigned
} finally {
  $env:ALLOW_UNSIGNED_DISTRIBUTION = $previousAcknowledgement
}
```

In `cmd.exe`, scope it to the command:

```bat
cmd /C "set ALLOW_UNSIGNED_DISTRIBUTION=1&& npm run dist:distributable-unsigned"
```

All three commands build only for the current operating system and CPU
architecture. Native addons are built and verified for that exact target before
packaging. The profiles are:

- `local` is the default. It writes under `artifacts/local/<target>/`, may use
  ad-hoc macOS signing, and cannot enter distribution assembly.
- `distributable-unsigned` requires the explicit acknowledgement shown above.
  Windows and macOS filenames contain `unsigned`; macOS apps are ad-hoc signed
  and unnotarized. Validated target output remains under
  `artifacts/staging/distributable-unsigned/<target>/` until the complete matrix
  is assembled.
- `signed` requires trusted native-platform signing where applicable. Windows
  must have the expected timestamped Authenticode signer; macOS must have the
  expected Developer ID Application identity, notarization, and stapled ticket.
  Linux records native-platform signing as `not-applicable`. Missing or
  unexpected signing credentials fail the target build.

Every target runner inspects its native package and emits a manifest bound to
the artifacts by filename, byte size, and SHA-256. Distribution assembly reads
five target manifests for the seven supported downloads, requires one clean
source commit, rejects updater metadata, and copies only validated artifacts
into `artifacts/distributable-unsigned/` or `artifacts/signed/`. The generated
download guide, aggregate manifest, checksums, and per-target provenance are
part of the distribution unit and should accompany the artifacts through every
distribution channel.

The packaged-app CI matrix uses only the `local` profile. Every per-target
transfer archive is named `desktop-local-target-<platform>-<architecture>` and
contains `LOCAL-TEST-ONLY.txt`. After exercising
AppImage and ZIP packages on Linux x64 and ARM64, DMGs on macOS Intel and ARM64,
and the NSIS installer on Windows x64, it retains
`desktop-local-test-bundle`. The bundle contains an explicit non-distribution
notice and cannot satisfy either distribution assembly command.

Automatic update metadata is disabled for every profile. macOS downloads are
architecture-specific; choose the file matching the Mac's CPU.

Twine RS uses its own release version from `package.json` and the Rust workspace
version in `Cargo.toml`. `package.json` also keeps `twineCompatibilityVersion`
for upstream Twine story-format editor-extension compatibility. Explicit valid
SemVer prerelease versions are supported, for example:

```sh
npm run version:bump -- 0.2.0-beta.1
npm run release:check -- --plan docs/releases/plans/v0.2.0-beta.1.json
```

## Fixtures and Developer CLI

```sh
npm run bench:fixtures
npm run bench:fixtures:large
```

`twine_cli` builds the `twine-rs` engineering binary. See its complete command
surface before using it; this is not the packaged desktop application's
executable:

```sh
cargo run -p twine_cli -- --help
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
