# ADR 0003: Directory-first project storage

Status: accepted
Decision date: 2026-06-20
Last verified: 2026-07-04

## Context

Authors need visible, versionable source files, real assets, external-editor
workflows, and optional graph metadata. A single opaque library or playable HTML
file cannot preserve all editor state and project structure cleanly.

## Decision

The full-fidelity format is a `.twine.rs` project folder or its archive. Story
content and source files are canonical. Assets remain files. Graph layout and
workspace-specific structure live in explicit sidecar metadata.

Twee and Story HTML remain interchange and publishing formats. Compatibility
exports preserve standard passage positions where possible and warn about
graph-native information they cannot represent.

## Consequences

- Git and external tools can operate on normal files.
- Native save logic writes changed project files rather than treating published
  HTML as the canonical editor store.
- Import/export must preserve unknown metadata or report any loss explicitly.
- Browser persistence uses the same conceptual model behind browser-safe
  storage boundaries.
