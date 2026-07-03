# Product principles

Status: current
Owner: product maintainers
Last verified: 2026-07-04
Source of truth: enduring product behavior

## Mode-native authoring

Text, Graph, and Split are first-class authoring modes over the same project.
A project without saved graph positions must remain complete in Text mode.
Generated graph layout is non-destructive until the author explicitly saves it.

## Visible project ownership

Desktop projects are normal folders with source files, assets, metadata, and
optional graph sidecars. The application must make paths, dirty state,
persistence failures, external changes, and compatibility loss visible.

## One semantic authority

Text and graph editing produce typed Rust commands. Rust validates the change,
updates indexes and history, and returns patches. UI projections may differ;
project truth must not.

## Scale is product behavior

Large projects should be navigable through source, contents, search, scoped
graph views, and diagnostics without mounting or transferring the entire
project for every interaction.

## Honest states

Labels distinguish saved, dirty, indexing, generated layout, missing assets,
conflicts, recovery, and failures. The UI must not silently fall back to an
unrelated passage, discard external edits, or present a control that has no
effect.

## Compatibility is explicit

The project folder is the full-fidelity format. Twee and Story HTML are
interchange or publishing formats. Unsupported structure is preserved in a
sidecar/archive or reported before export; it is never silently discarded.
