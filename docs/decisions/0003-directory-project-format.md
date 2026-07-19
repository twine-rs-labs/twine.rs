# ADR 0003: Directory-first project storage

Status: accepted
Decision date: 2026-06-20
Last verified: 2026-07-19

## Context

Authors need visible, versionable source files, real assets, external-editor
workflows, and optional graph metadata. A single opaque library or playable HTML
file cannot preserve all editor state and project structure cleanly.

## Decision

The full-fidelity format is a `.twine.rs` project folder or its archive. Story
content and source files are canonical. Assets remain files. Graph layout and
workspace-specific structure live in explicit sidecar metadata.

Each story declares one of two source layouts. The default passage-files layout
stores every passage in its own file under `passages/`. The single-Twee layout
stores standard `StoryTitle`, `StoryData`, and passage sections in one declared
aggregate source, which is `story.twee` for new projects. Story scripts and
stylesheets remain separate files in both layouts.

`twine.toml` owns stable story and passage identities and maps those identities
to source files or aggregate passages. Targeted saves preserve unknown manifest
content. Single-Twee saves merge modeled changes into the existing source,
preserving preambles, unrelated sections, unknown story and passage metadata,
and compatibility script or stylesheet sections.

Twee and Story HTML remain interchange and publishing formats. Compatibility
exports preserve standard passage positions where possible and warn about
graph-native information they cannot represent.

## Consequences

- Git and external tools can operate on normal files.
- Native save logic writes changed project files rather than treating published
  HTML as the canonical editor store.
- Source-layout selection is honored at project creation and retained on later
  saves, including when a Single-layout manifest uses a custom aggregate path.
- Externally added aggregate passages receive deterministic identities that are
  persisted only after the accepted source version is revalidated.
- Import/export must preserve unknown metadata or report any loss explicitly.
- Browser persistence uses the same conceptual model behind browser-safe
  storage boundaries.
