# ADR 0002: Electron host with shared WASM sessions

Status: accepted
Decision date: 2026-07-04
Last verified: 2026-07-04

## Context

Early planning proposed replacing Electron with Tauri and later considered a
persistent N-API command session. The existing React/Electron application,
however, already provides platform integration and packaging. The same Rust
session semantics are also required by the browser build.

## Decision

Keep Electron as the desktop host. Use one renderer WASM worker client owning a
map of Rust `ProjectSession`s for commands and queries. Use native Rust from the
Electron main process for project load/save/watch and filesystem effects.

Tauri and a persistent N-API command session are out of scope.

## Consequences

- Browser and Electron renderer behavior share the WASM session path.
- Desktop filesystem behavior remains native without introducing another
  command authority.
- Electron packaging and security remain active release responsibilities.
- Reconsidering the host requires a superseding ADR with measured benefits.
