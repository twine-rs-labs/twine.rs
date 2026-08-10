# Changelog

This file records user-visible changes to Twine RS. It does not duplicate the
upstream Twine history under `docs/en/src/release-notes/`.

Twine RS published its first formal public prerelease, `0.2.0-beta.2`, under
the process in [`RELEASING.md`](RELEASING.md) on 2026-08-01. Do not add or
reconstruct release entries or tags without verifiable source and artifact
evidence.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and releases use [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

### Changed

### Fixed

### Security

## [0.2.0-beta.3] - 2026-08-10

### Added

- Completed Package export for file-backed desktop projects. The beta.2
  archive's playable output, canonical source, manifest, and asset copy plan
  now extend to eligible project asset bytes, deterministic paths, SHA-256
  checksums, bounded dependency assessment, and an explicit completeness
  review before saving.
- Added native and fallback image-dimension metadata for PNG, JPEG, GIF, SVG,
  and WebP assets.

### Changed

- Unified the application, packaged desktop, PWA, and documentation icon family
  and adopted amber as the application accent while preserving semantic status
  colors.
- Clarified Preview, Assets, and conflict-review counts and actions, including
  explicit disk-versus-app overwrite warnings.
- Pointed Twine RS support prompts to the Twine RS Lab Patreon while retaining
  separately labeled upstream TwineJS links.

### Fixed

- Replaced renderer-blocking persistence reservations with asynchronous,
  quit-safe coordination that flushes editor changes, core mutations, and
  admitted saves before shutdown.
- Excluded dismissed diagnostics from active severity counts and made
  diagnostic loading, error, pagination, and refresh states explicit.

### Security

- Package asset collection now fails closed on unsafe paths and portability
  collisions, uses bounded reads and output limits, and reports missing,
  changed, external, unsupported, and unevaluated dependencies instead of
  silently claiming an offline-complete package.

## [0.2.0-beta.2] - 2026-08-01

### Added

- First formal public prerelease of Twine RS.
- Directory-backed desktop projects using passage-per-file or single-Twee
  layouts.
- Incremental project saving, external-change detection, and conflict review.
- Text, map, graph, and split story-editing workspaces.
- Contents, diagnostics, asset management, story-format, build, Settings, and
  preview workflows.
- Play, Test, and Proof windows with runtime inspection.
- Import support for Twee, Twine HTML, JSON interchange, and TwineJS
  local-storage data.
- Export support for playable HTML, story-format output, Twee, JSON, and
  archive-style HTML.
- Local project backup and desktop-platform settings.
- Windows x64, macOS Intel and Apple Silicon, and Linux x64 and arm64 desktop
  packages.

### Fixed

- Added bounded late-start runtime-state capture and namespaced SugarCube state
  detection so preview passage detection recovers when a story format
  initializes its runtime after the bridge's first startup sample.

## [0.2.0-beta.1] - 2026-08-01

### Changed

- Unpublished release candidate superseded by 0.2.0-beta.2 after release
  workflow and packaged Linux ARM64 validation exposed release-pipeline and
  preview-startup defects. No draft or public release was created.

[Unreleased]: https://github.com/twine-rs-labs/twine.rs/compare/v0.2.0-beta.3...HEAD
[0.2.0-beta.3]: https://github.com/twine-rs-labs/twine.rs/releases/tag/v0.2.0-beta.3
[0.2.0-beta.2]: https://github.com/twine-rs-labs/twine.rs/releases/tag/v0.2.0-beta.2
