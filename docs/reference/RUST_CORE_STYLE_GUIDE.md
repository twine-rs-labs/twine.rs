# twine.rs Rust Core Style Guide

This guide defines the house style for the Rust core. It is intentionally small:
follow Rust defaults, keep Twine semantics explicit, and make every milestone
harder to break than the last one.

Reference spine:

- Rust API Guidelines: https://rust-lang.github.io/api-guidelines/
- Rust Style Guide: https://doc.rust-lang.org/style-guide/
- Cargo package layout: https://doc.rust-lang.org/cargo/guide/project-layout.html
- Clippy documentation: https://doc.rust-lang.org/clippy/

## Core Principles

- Story text is canonical. Graph layout, generated indexes, caches, UI state,
  and workspace view state are derived or optional unless the type says
  otherwise.
- Preserve user data before making it pretty. Unknown Twine, Twee, HTML, story
  format, and project-folder metadata belongs in `metadata` or
  `custom_attributes`, not in the trash.
- Prefer boring, typed boundaries. Use newtypes for IDs, explicit option
  structs for modes, enums for operations, and named error types for failure.
- Keep crates domain-shaped, not screen-shaped. `twine_model`, `twine_parse`,
  `twine_graph`, `twine_search`, `twine_store`, `twine_export`, and `twine_cli`
  should remain useful without a GUI.
- Make source-only projects first-class. A project without saved graph
  positions is not incomplete; it is a valid Twine project.

## Formatting And Lints

- Use `cargo fmt --all -- --check`; default `rustfmt` style is the house style.
- Use `cargo clippy --workspace --all-targets -- -D warnings` before landing
  changes.
- Keep `unsafe_code = "forbid"` unless a future milestone has a proven,
  isolated reason and a design note.
- Do not enable broad Clippy `restriction` or `pedantic` groups globally. Add
  specific lints only when they encode a real project invariant.
- Public examples should use `?` rather than `unwrap`; tests may use `expect`
  with a useful message.

## API Shape

- Public types should derive the common traits that make sense:
  `Clone`, `Debug`, `Eq`, `PartialEq`, ordering/hash traits, and Serde traits
  where stable interchange matters.
- Use `AsRef<str>` and `Display` for string-backed IDs. Avoid exposing the
  inner string mutably.
- Constructors are inherent methods: `StoryId::new`, `FileProjectStore::new`.
- Use `iter`, `iter_mut`, `IntoIterator`, `FromIterator`, and `Extend` for
  collection-like types as they grow.
- Keep public fields only for passive data structures that are deliberately
  wire-shaped. For types with invariants, prefer private fields plus methods.

## Errors

- Library crates return domain errors with `thiserror`.
- The CLI may use `anyhow` for context-rich user-facing command failures.
- Never erase parse/import/export context when preserving it is cheap.
- Add an explicit error variant when behavior matters to callers; do not tunnel
  important cases through strings.

## Parsing And Interchange

- Parsers should be tolerant but not silent. If data is valid but unknown,
  preserve it; if data is invalid, either report it or keep enough metadata for
  later diagnostics.
- Importers should preserve IFIDs, source PIDs, tags, tag colors, layout
  coordinates, custom attributes, scripts, stylesheets, format names, and format
  versions.
- Exporters should round-trip stable data and use deterministic ordering.
- Avoid regex-only parsers for nested or quoted formats when a small state
  machine or structured parser is clearer.

## Storage

- Project-folder paths in manifests are project-relative capabilities. Reject
  absolute paths and `..` traversal.
- Text files live in visible directories: `passages/`, `scripts/`, `styles/`,
  and `assets/`.
- Generated data lives under `.twine/cache/`; optional authored graph metadata
  lives under `.twine/`.
- Saving should be atomic at the project-folder level and report changed files.
- Backups are part of the storage contract, not an afterthought.

## Tests

- Every parser/exporter bug gets a focused regression test with the smallest
  representative fixture.
- Storage tests should cover save, load, no-op save, backup, generated cache,
  source-only layout behavior, and unsafe manifest paths.
- Graph/search tests should assert counts and stable IDs/order, not only that
  output is non-empty.
- CLI behavior can stay smoke-tested in M0, but command parsing should move to
  stronger integration tests before it becomes a user-facing contract.

## Milestone Readiness

- M1 Rust/WASM work should expose typed DTOs generated from the Rust boundary,
  not hand-maintained TypeScript shadows.
- M2 graph work should treat graph facts and graph layout separately.
- M3 source editing should send typed edits/transactions through Rust, not
  mutate canonical story state ad hoc in the UI.
- M4+ story-format work should describe capabilities explicitly and keep legacy
  JavaScript formats compatible.
