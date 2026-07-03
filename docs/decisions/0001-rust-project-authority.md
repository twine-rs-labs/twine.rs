# ADR 0001: Rust owns persisted project semantics

Status: accepted
Decision date: 2026-06-20
Last verified: 2026-07-04

## Context

The inherited TwineJS application represented stories in Redux and derived
graph, search, diagnostics, persistence, and undo behavior in TypeScript.
Maintaining equivalent Rust and TypeScript implementations created divergent
semantics and whole-project work on normal edits.

## Decision

Rust `ProjectSession` instances own persisted project semantics: commands,
patches, analysis, history, revisions, savepoints, dirty state, and external
merge classification. TypeScript is a presentation adapter and may own only
transient interaction state.

Generated TypeScript bindings are transport contracts, not permission to
reimplement the domain model.

## Consequences

- Persisted UI operations must use a bound core session.
- React applies Rust patch batches to its read model.
- Compatibility producers are limited to legacy interchange and recovery.
- Rust and worker tests become the semantic source of truth.
- The complete frontend mirror remains migration debt, but it is not canonical.
