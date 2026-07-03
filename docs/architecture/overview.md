# Architecture overview

Status: current
Owner: architecture maintainers
Last verified: 2026-07-04
Source of truth: live Electron, React, WASM, and Rust integration

`twine.rs` is a React/Electron editor backed by a shared Rust project model.
Rust owns persisted project semantics. TypeScript owns presentation and
transient interaction state.

## Runtime shape

```text
React routes and editors
        |
        | typed commands, queries, patch subscriptions
        v
one CoreProjectHostProvider
        |
        v
one WASM worker client
        |
        v
Rust ProjectSession map, keyed by logical project

Electron main process
        |
        +-- native Rust load/save/import/export
        +-- project-folder watcher and delta parser
        +-- asset filesystem journal
```

File-backed stories sharing a normalized project root share one logical
session. Web-local and legacy standalone stories receive independent sessions.
The renderer keeps a patch-applied read model, but commands, history, dirty
state, analysis, indexes, and persisted-field conflict classification belong to
Rust.

## Ownership

Rust owns:

- project, story, passage, source, layout, and asset semantics;
- command validation and patch generation;
- undo/redo history, revisions, savepoints, and dirty state;
- link, symbol, asset, graph, diagnostic, and search analysis;
- import/export and project-folder storage rules;
- external-delta conflict classification.

TypeScript owns:

- React rendering and route composition;
- selection, focus, hover, open editors, panel layout, and viewport state;
- CodeMirror's focused-editor history;
- applying Rust patch batches to the frontend read model;
- coordinating native IPC, persistence notifications, and review UI.

Electron owns native capabilities:

- project-folder load/save/watch;
- filesystem dialogs and platform integration;
- asset effect journals;
- packaged desktop lifecycle.

## Major boundaries

- [`sessions-and-undo.md`](./sessions-and-undo.md) describes project identity,
  serialization, history, and patch application.
- [`persistence-and-watching.md`](./persistence-and-watching.md) describes
  revision-safe saves, changed-path watcher deltas, conflicts, and assets.
- [`frontend-boundaries.md`](./frontend-boundaries.md) defines permitted
  renderer state and mutation paths.
- [`../decisions/`](../decisions/README.md) records the reasons behind the
  stable choices.

## Deployment

The current desktop product uses Electron. Renderer commands and queries use
Rust compiled to WASM in a worker; native project I/O uses the Rust native
boundary from the Electron main process. The browser build uses the same React
UI and WASM session model with browser-safe persistence.

Tauri and a persistent N-API command session are not current targets. They may
be reconsidered only through a new decision record.

## Known architectural boundary

React still holds a complete patch-applied frontend project mirror. Removing
that mirror would be a separate architecture milestone; performance work must
not silently introduce another canonical TypeScript model in the meantime.
