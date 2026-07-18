# Frontend boundaries

Status: current
Owner: React/core integration maintainers
Last verified: 2026-07-18
Source of truth: product mutation and query boundaries

## Persisted mutations

Every persisted product mutation enters through a bound core project session.
`useCoreProjectSession(storyId)` exposes apply, undo, redo, status, queries, and
patch subscriptions for the story's logical project.

Rust returns a `PatchBatch`. The frontend applies the batch through one
`applyCorePatchBatch` reducer action and emits one persistence notification.
Product routes must not reconstruct equivalent persistent reducer mutations.

`npm run check:core-boundaries` prevents legacy undo imports and reducer-owned
replace-all behavior from returning to product code.

## Permitted React state

The frontend may update non-persisted interaction state directly:

- selection and highlighting;
- focused editor and open editor windows;
- cursor, scroll, and CodeMirror view state;
- graph viewport, active tool, hover, and drag previews;
- panel and drawer layout;
- pending review and error presentation.

These changes do not enter Rust history.

## Queries

Queries wait for earlier mutations in the same session. Viewport and search
requests carry a generation so stale asynchronous results can be discarded.
Query payloads should remain result- or viewport-bounded.

Passage bodies are not part of the route-facing React story model at runtime.
Initial load and repair snapshots are registered in the core bootstrap store;
web-local sessions initialize Rust from those snapshots. File-backed sessions
use an Electron hydration lease: bounded passage chunks are appended to a
Rust-owned WASM bootstrap and finalized atomically while React receives only
metadata passages. Recovery retains the full-snapshot path. Editors query one
document, inspectors query passage facts, and complete build/export workflows
enumerate revision-bound document pages explicitly. Native full-save fallback
uses the same registered materializer so metadata-only state cannot overwrite
files with empty bodies.

`npm run check:core-boundaries` rejects direct passage-body reads in product
routes and components. Transport, bootstrap, persistence, compatibility import,
and explicitly materialized build code remain documented boundary exceptions.
The route-facing `Passage` type has no `text` field; complete snapshots use the
separate `PassageWithText` and `StoryWithDocuments` transport types. This makes
accidental reintroduction of a frontend passage-body mirror a compile-time
error instead of relying only on runtime discipline.

## Undo

Workbench undo/redo uses Rust project history. Focused CodeMirror controls keep
their local editor history and consume standard shortcuts while focused.
Platform-standard workbench shortcuts apply outside editable controls.

## Compatibility code

Compatibility readers and writers may exist for legacy import/export. They are
not alternate product mutation paths. New functionality must not add a
TypeScript parser, index, asset inventory, or reducer history as a second source
of truth. The former reducer-owned body search/replace helpers and legacy
passage-map/connection renderers have been removed; bounded Rust queries and the
current graph projection are the supported product paths.

Story-format editor compatibility is similarly bounded. All editing surfaces
use the app-owned CodeMirror 6 `SourceEditor` or an intentional native textarea.
The resolver selects exactly one syntax owner: an exact app-owned native
provider, a compatible bounded legacy adapter, or generic Twine syntax.
Providers and adapters receive app-owned host interfaces rather than a raw
CodeMirror 6 view. Unsupported API access or provider failure falls back to
generic syntax and is reported without passage content.

The exact bundled Harlowe 3.3.9 identity resolves to a lazy native provider.
Each editor creates and disposes its own controller/session, while parser and
macro metadata are immutable dialect-local assets. The provider uses only the
pure lexer, markup parser, and static macro metadata extracted from that exact
bundle; this presentation state is not an authority for persistence, graph
projection, core diagnostics, builds, or publishing. Harlowe's DOM- and
CodeMirror-5-coupled hydration is still rejected before execution, and its
serialized runtime source is unchanged for play, test, proof, and publish.
Harlowe 1.2.4, 2.1.0, user-added builds, and future dialects do not inherit
3.3.9 behavior by name or semver: each needs its own exact provider
registration or uses the generic editor.

CodeMirror retains each `StreamLanguage` node type for the renderer lifetime.
The resolver therefore caches one immutable language recipe per hydrated format
identity, while each editor installs a facet-scoped disposable runtime. Editor
teardown clears that runtime's document service, format mode, and diagnostic
callback so the shared language cannot retain passage or React state.

Native providers follow the same lifetime boundary. Only their immutable
integration descriptor and lazily imported module are shared; selections,
find state, proofreading state, preferences, and failure containment belong to
the individual editor session.

`npm run check:no-codemirror5` prevents the removed CodeMirror 5 runtime and
React wrapper from returning to production source.
