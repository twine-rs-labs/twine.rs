# CodeMirror 6 Migration and Legacy Story-Format Adapter

Status: complete
Owner: repository maintainers
Last verified: 2026-07-18
Source of truth: CodeMirror 6 editor host and bounded legacy adapter implementation
Scope: editor migration and bounded compatibility with documented CodeMirror 5
story-format extensions

## Implementation status

Phases 1–7 are implemented. Every active editor now uses CodeMirror 6 or an
intentional textarea; Chapbook 1.2.3 and 2.3.1 run through the bounded,
per-editor stream-mode/facade/toolbar adapter; Harlowe is rejected before its
legacy editor hydration executes; and the CodeMirror 5 packages and production
imports are removed.

Phase 8 has reproducible default and Chapbook 2.3.1 Electron fixtures. The
Chapbook fixture includes a 4,096-line variable section and content-free
instrumentation. Fresh Electron evidence proves zero adapter, lookahead-index,
or CodeMirror view lifecycle events across 22 warmed edit/undo/redo samples and
the beginning/middle/end probes. Removing and adding the `--` delimiter each
performs exactly one bounded adapter and index rebuild.

The input-to-paint Long Tasks window starts before editor input and covers
every one of the 20 warmed samples. Generic and adapted runs both record zero
Long Tasks API entries above 50 ms. Their `edit.paintMs` p95 values are 29.4 ms
generic and 22.6 ms adapted in the final dirty-worktree diagnostic pair. The
clean matched-baseline comparison runs record 11.1 ms generic and 22.6 ms
adapted. The adapted value remains above the report-only 16.6 ms target; because
that target is not enforced in `benchmarks/budgets.json`, both repository
evaluations pass.

The four-editor lifecycle workload edits every passage, exercises selection-
sensitive Chapbook toolbar state, verifies independent focus, and observes the
actual view, document-service, mode-adapter, toolbar-descriptor, and facade
objects through `WeakRef`s. Forced-GC checkpoints return every retained-object
category to zero after both the single-editor close and four-editor cycle.
One immutable `StreamLanguage` recipe is cached per hydrated format identity;
adapter disposal explicitly severs each editor's facet-scoped service, mode,
and callback from CodeMirror's process-lived language registry.

The compressed production editor assets pass the checked-in bundle gate at
511,453 gzip bytes, 66,575 bytes (11.52%) below the recorded CodeMirror 5
reference, with no known CodeMirror 5 runtime marker in the emitted JavaScript
or CSS. Clean all-phase Electron 43 baselines for the default Harlowe fallback
and adapted Chapbook fixtures were accepted at commit `0951f942` under machine
fingerprint `3101761a8a63fab1`. Follow-up same-revision runs matched their
variant-specific baselines and passed the enforced 15%/5 ms regression guard
with zero blocking failures. All functional, memory, bundle, build, and
enforced latency gates are complete.

## Outcome

Move every active editing surface to the existing CodeMirror 6 `SourceEditor`,
restore story-format editor integration through a bounded compatibility layer,
and remove the CodeMirror 5 runtime and React wrapper from the application.

At the end of this tier:

- passage, story JavaScript, and story stylesheet editing use CodeMirror 6;
  compact search/replace fields use intentional controlled textareas;
- compatible `editorExtensions.twine.*.codeMirror` modes, commands, and toolbar
  descriptors run through an app-owned adapter;
- Chapbook 1.2.3 and 2.3.1 retain their format-specific mode and toolbar
  behavior;
- unsupported extensions fail closed to the generic CodeMirror 6 Twine editing
  experience;
- Harlowe publishing, testing, and play behavior are unchanged;
- CodeMirror 5, `react-codemirror2`, and their types are no longer production
  dependencies.

This is an editor migration. Story-format runtime source and published story
output are separate and must remain unchanged.

## Explicit scope boundary

This tier does **not** modify any Harlowe `format.js` to provide native
CodeMirror 6 integration. It also does not attempt to emulate the complete
CodeMirror 5 API.

Harlowe 3.3.9's legacy extension depends on CodeMirror 5 internals, custom
events, overlays, marks, keymaps, coordinates, and obsolete Twine editor DOM.
For this tier it is classified as incompatible with the bounded adapter. The
editor must:

- keep using the current generic CodeMirror 6 syntax decorations, completion,
  and link diagnostics for Harlowe passages;
- not execute Harlowe's legacy mode, commands, or toolbar through a partial
  facade;
- report the compatibility fallback in the Formats UI and diagnostics/logging;
- continue to load the same Harlowe runtime source for play, test, proof, and
  publish.

A native Harlowe CodeMirror 6 integration is a separate follow-up tier.

## Non-goals

- Reimplementing CodeMirror 5 on top of CodeMirror 6.
- Running a hidden CodeMirror 5 editor synchronized with a CodeMirror 6 editor.
- Preserving undocumented access to `editor.display`, `doc.cm`,
  `lineOracle`, `_handlers`, or old passage-dialog DOM.
- Allowing story formats to insert arbitrary toolbar DOM.
- Designing the final public native-CodeMirror-6 story-format API.
- Changing how stories select or persist a story-format name and version.
- Changing story-format runtime source or generated story HTML.

## Current state

- The active passage/workbench editor uses
  `src/components/control/source-editor/source-editor.tsx` and CodeMirror 6.
- `SourceEditor` accepts compartment-scoped dynamic extensions and exposes an
  app-owned command handle without leaking a raw CodeMirror 6 view.
- Generic Twine highlighting remains the fallback syntax owner; an active
  adapted format mode replaces it while format-neutral completion and link
  diagnostics remain installed.
- Story JavaScript and stylesheet dialogs use `SourceEditor`; compact
  search/replace fields are intentional native textareas.
- Compatible hydrated `editorExtensions.twine[semver].codeMirror` properties
  resolve through the bounded per-view mode, command-facade, and React-toolbar
  adapter. Runtime failures disable only the failing editor integration and
  attach a content-free diagnostic to the installed format.
- Bundled Harlowe 3.3.9 is rejected before its legacy editor hydration runs and
  retains generic CodeMirror 6 editing.
- Story imports retain only format name and version. The installed
  `format.js` is authoritative for editor integration.
- `codemirror`, `react-codemirror2`, `@types/codemirror`, `CodeArea`, and the
  obsolete CodeMirror 5 hooks and helpers are removed. Static packaging checks
  reject their return.

## Compatibility contract for this tier

### Resolution order

For a loaded story format, resolve exactly one editing path:

1. A future/native app-recognized CodeMirror 6 integration, when present.
2. A legacy CodeMirror 5 extension accepted by the bounded adapter.
3. Generic CodeMirror 6 Twine editing.

Never stack native, adapted, and generic format syntax. Generic link
completion and broken-link diagnostics may remain as orthogonal extensions,
but format-specific tokenization must have a single owner.

The native branch is a resolver seam in this tier, not a public API promise.
Before third-party native extensions are accepted, define a separately
versioned host API rather than exposing unversioned CodeMirror package objects.

### Supported legacy mode surface

Use CodeMirror 6 `StreamLanguage` for CodeMirror-5-style stream modes that stay
within this subset:

- `startState`, `copyState`, `blankLine`, and `token`;
- `StringStream.eol`, `sol`, `peek`, `next`, `eat`, `eatWhile`, `eatSpace`,
  `skipTo`, `skipToEnd`, `backUp`, `column`, `indentation`, `match`, and
  `current`;
- standard CodeMirror 5 token names plus explicitly mapped custom token names.

Chapbook requires `StringStream.lookAhead`. Implement that as an adapter-owned,
per-view document service. Cache the adapter recipe by format identity, but
instantiate parser state and document access per editor view. Do not share
mutable parser or document state between tabs.

If correct incremental `lookAhead` behavior cannot be established without
forking CodeMirror internals, use a bounded full-document pre-scan for the
delimiter-dependent state and invalidate it only when a document change can
affect the result. Record and benchmark this exception.

### Supported editor/document facade

Define local legacy types so the app does not depend on
`@types/codemirror`. The initial facade supports only:

- `getDoc()`;
- `getValue()`;
- `getRange()` and `replaceRange()`;
- `getSelection()` and `getSelections()`;
- `somethingSelected()`;
- `replaceSelection()` and `replaceSelections()`, including required collapse
  behavior;
- `getCursor()`, `setCursor()`, `indexFromPos()`, and `posFromIndex()`;
- `focus()`;
- a small allowlist of built-in commands if a real compatible format requires
  them.

Toolbar factories receive a read-only view of editor state. Commands receive
the mutating facade. All mutations become normal CodeMirror 6 transactions so
selection and undo history remain coherent.

Unsupported method or property access raises a typed
`UnsupportedLegacyEditorApiError`. The integration boundary catches it,
disables only the offending format extension for that editor, records the
reason, and falls back to generic CodeMirror 6 behavior.

Do not install commands in a global registry. Scope modes, commands, toolbar
state, errors, and cleanup to the format and editor view that owns them.

### Toolbar contract

Continue accepting the documented button, menu, and separator descriptors.
The application renders them with design-system React components.

- Validate descriptor shape, labels, command references, disabled state, and
  icon URLs.
- Do not render format-provided HTML.
- Recompute descriptors only when document, selection, theme, or locale state
  relevant to the toolbar changes.
- Compare/memoize descriptor output to avoid redundant React rendering.
- Execute commands through the scoped facade and refresh toolbar state after
  the transaction.
- Treat DOM mutation, undocumented editor access, or registration of custom
  event handlers as unsupported in this tier.

## Implementation phases

### Phase 0 — Freeze behavior and record baselines

Before changing editor code:

- Add real-format fixtures for Chapbook 1.2.3, Chapbook 2.3.1, Harlowe 3.3.9,
  a compliant minimal custom format, and an intentionally unsupported format.
- Record current build size, initial editor-open timing, warmed typing latency,
  and editor memory for representative and large passages.
- Capture behavior for:
  - passage editing and debounced project updates;
  - selection and cursor restoration;
  - undo/redo and indentation;
  - find/reveal;
  - story JavaScript and stylesheet dialogs;
  - story search and replacement fields;
  - link completion and broken-link decoration;
  - the preference that disables format editor extensions.
- Add a publish/import fixture proving that editor migration does not change
  generated story data or execute an integration embedded in imported story
  HTML.

Exit criteria:

- Reproducible functional and performance baselines exist.
- The real format fixtures can be loaded through the production hydration
  path.

### Phase 1 — Make `SourceEditor` an extension host

Refactor `SourceEditor` without enabling story-format extensions yet.

- Add an internal prop for resolved dynamic `Extension[]`.
- Add a narrowly typed imperative handle for focus, command dispatch, current
  selection/document snapshots, and view lifecycle. Do not expose the raw view
  to normal application consumers.
- Put dynamic format extensions in their own compartment so switching formats
  does not recreate the editor or leak old state.
- Ensure every view has independent compartments, adapter state, and cleanup.
- Split generic Twine behavior into:
  - format-neutral links, completion, and diagnostics;
  - generic syntax decorations that can be replaced when a format owns syntax.
- Preserve memory ownership registration, cursor/scroll restoration, external
  value synchronization, read-only behavior, wrapping, themes, and search.
- Add an error boundary around dynamic editor extensions with a generic-editor
  fallback.

Exit criteria:

- Existing `SourceEditor` tests pass unchanged where behavior is not intended
  to change.
- A synthetic extension can be installed, reconfigured, removed, and destroyed
  without recreating the editor or leaking callbacks.

### Phase 2 — Migrate the remaining active CM5 editors

Replace every production `CodeArea` consumer before removing its dependency.

- Migrate story JavaScript to `SourceEditor` with the JavaScript language
  extension.
- Migrate story stylesheet to `SourceEditor` with the CSS language extension.
- Replace CM5-specific undo/redo and indent controls with commands dispatched
  through the new handle.
- Migrate the story search and replacement fields. Preserve their compact
  layout, tab behavior, multiline behavior, focus order, and accessibility;
  use a simpler controlled textarea instead if a full code editor adds no user
  value.
- Update mocks and tests to target behavior rather than CM5 instance methods.
- Verify that no production component imports `CodeArea`,
  `react-codemirror2`, CM5 modes, or CM5 addons.

Exit criteria:

- All active editor surfaces use CM6 or a deliberate plain textarea.
- CM5 remains installed only for the not-yet-enabled legacy format adapter
  tests/types, not for production UI.

### Phase 3 — Add format integration resolution and caching

Replace the orphaned CM5 hooks with a CM6-oriented resolver.

- Resolve the installed story format by exact name and version after normal
  story repair has completed.
- Use the existing Twine compatibility semver selection for the extension
  block.
- Return a discriminated result:
  - `native`;
  - `adapted-legacy`;
  - `generic-fallback`, with a reason.
- Respect the existing per-format extension opt-out.
- Cache immutable adapter recipes by loaded format identity, name, version,
  URL, and hydration generation/object identity.
- Invalidate cached recipes when a user format is replaced, reloaded, or
  changes through development HMR.
- Instantiate mutable parser state, facade state, and document services per
  `EditorView`.
- Keep hydration and adapter errors attached to the format record/diagnostic
  surface instead of repeatedly logging on every render.

Exit criteria:

- Switching stories, formats, or format versions selects exactly one
  integration and leaves no state from the previous format.
- Two tabs using the same format do not share mutable parser/editor state.

### Phase 4 — Implement the legacy stream-mode adapter

- Convert supported mode factories into `StreamLanguage` instances.
- Supply the minimal CM5 configuration values expected by mode factories.
- Preserve start/copy/blank-line state semantics.
- Implement and test the per-view `lookAhead` compatibility service needed by
  Chapbook.
- Map standard CM5 tokens to CM6 highlight tags.
- Map approved custom tokens to stable app-owned classes without allowing
  arbitrary style or DOM injection.
- Detect failure to advance the stream, exceptions, unsupported stream
  methods, and invalid tokens; disable the mode and fall back rather than
  breaking the editor.
- Disable the generic format syntax pass whenever the adapted format mode is
  active. Keep format-neutral link diagnostics and completion.

Exit criteria:

- Chapbook 1.2.3 and 2.3.1 fixture passages receive expected token classes,
  including variables-section behavior.
- Malformed or unsupported modes reliably produce generic editing with one
  actionable diagnostic.

### Phase 5 — Implement the scoped facade and React toolbar

- Implement position conversion and selection methods over CM6 state.
- Implement single- and multi-selection replacement as CM6 transactions.
- Preserve undo grouping and resulting selection semantics.
- Adapt legacy commands into a format/view-scoped command map.
- Restore a story-format toolbar in the workbench using design-system
  buttons/menus and validated descriptors.
- Pass a read-only facade to toolbar factories and the mutating facade to
  command handlers.
- Update toolbar state from a single CM6 update listener and React state bridge.
- Remove listeners and references when the view, format, or tab closes.
- Catch adapter errors per mode, toolbar, and command so one failed feature
  does not disable unrelated editor behavior.

Exit criteria:

- Chapbook toolbar enablement follows current selection.
- Chapbook formatting and insertion commands produce expected text,
  selections, undo, and focus behavior.
- No legacy command is registered globally.

### Phase 6 — Enforce the Harlowe and unknown-format fallback policy

- Mark bundled Harlowe 3.3.9 legacy editor integration as incompatible with
  this adapter tier without executing its side-effectful initialization.
- Continue the current generic CM6 syntax/link experience for Harlowe.
- Show a concise compatibility status in the Formats route:
  `Generic CM6 editor; legacy format toolbar unavailable`.
- For unknown user formats, attempt the bounded documented contract only.
  Disable the extension on the first unsupported call or adapter failure.
- Preserve the user setting to disable format-provided extensions entirely.
- Add a development diagnostic listing the unsupported API and format
  name/version without exposing passage content.

Exit criteria:

- Harlowe editing, play, test, proof, and publish do not crash.
- No Harlowe CM5 mode/toolbar code is partially initialized.
- Unsupported custom extensions cannot take down the editor shell.

### Phase 7 — Remove CM5 and obsolete code

After all preceding exit criteria pass:

- Remove `codemirror`, `react-codemirror2`, and `@types/codemirror` from
  `package.json` and the lockfile.
- Remove the legacy `CodeArea` implementation, CM5 CSS/themes, addons, mode
  imports, prefix-trigger implementation, and CM5 option translator.
- Remove or replace:
  - `use-format-codemirror-mode`;
  - `use-format-codemirror-toolbar`;
  - `use-codemirror-passage-hints`;
  - CM5-specific undo/redo and indent control types.
- Replace imported CM5 types in story-format declarations with app-owned
  legacy-contract types.
- Add a dependency/static check that fails if production source imports
  `codemirror` or `react-codemirror2`.
- Update upstream-extension compatibility documentation to describe the
  bounded adapter and fallback behavior without claiming full CM5 support.

Exit criteria:

- A clean install contains no direct CM5 dependency.
- The production bundle contains no CM5 editor implementation or wrapper.
- Typecheck, lint, unit tests, packaging tests, web build, and Electron build
  pass.

### Phase 8 — Performance and release validation

Run the Phase 0 scenarios against generic CM6, adapted Chapbook, and Harlowe
fallback.

- Compare initial editor-open time and warmed typing latency at representative
  and large passage sizes.
- Verify that generic syntax is not running underneath an active adapted mode.
- Measure parser invalidation around edits at the beginning, middle, and end of
  a passage.
- Measure Chapbook's `lookAhead` path when adding/removing its delimiter.
- Open, switch, and close many editor tabs while checking retained editor,
  parser, toolbar, and document objects.
- Confirm that repeated toolbar selection updates do not cause unbounded React
  renders.
- Compare compressed production bundle size.
- Run import, play, test, proof, publish, and project-reopen smoke tests for all
  bundled format families.

Performance gates:

- `edit.paintMs` and other existing Electron metrics satisfy
  `benchmarks/budgets.json`, including the 16.6 ms edit-to-paint target where
  enforced.
- Runs matched to an accepted machine baseline stay inside the repository's
  existing Electron regression guard (15% with a 5 ms noise floor).
- Adapted Chapbook has no repeated full-document work on ordinary keystrokes;
  documented delimiter invalidation may perform one bounded pre-scan.
- No new editor-generated long task above 50 ms appears in the representative
  passage fixture after warmup.
- Repeated open/close cycles return editor-owned memory to the established
  steady-state envelope.
- The production bundle is smaller and contains no CM5 implementation.

If a gate fails, keep the migration behind its development flag, fix or narrow
the adapter contract, and rerun the same measurement. Do not restore a hidden
CM5 mirror as a performance workaround.

## Verification matrix

| Area                        | Generic CM6 | Chapbook adapter | Harlowe fallback         | Unsupported custom           |
| --------------------------- | ----------- | ---------------- | ------------------------ | ---------------------------- |
| Open/edit/save passage      | required    | required         | required                 | required                     |
| Syntax owner is singular    | generic     | adapted          | generic                  | generic                      |
| Link completion/diagnostics | required    | required         | required                 | required                     |
| Selection/cursor restore    | required    | required         | required                 | required                     |
| Undo/redo                   | required    | required         | required                 | required                     |
| Format toolbar              | absent      | required         | unavailable/status shown | fallback or supported subset |
| Extension opt-out           | required    | required         | required                 | required                     |
| Multi-tab isolation         | required    | required         | required                 | required                     |
| Play/test/proof/publish     | unchanged   | unchanged        | unchanged                | unchanged                    |
| Adapter failure containment | n/a         | required         | required                 | required                     |

## Test plan

Unit tests:

- dynamic `SourceEditor` compartment installation and teardown;
- format resolver precedence, opt-out, invalidation, and fallback reasons;
- stream state copying, blank lines, token mapping, zero-advance protection,
  and `lookAhead`;
- UTF-16 line/ch and absolute-position conversion;
- single and multiple selections;
- replacement collapse and undo semantics;
- read-only toolbar facade versus mutating command facade;
- descriptor validation and command namespacing;
- unsupported API and mode-error containment;
- cache invalidation and per-view state isolation.

Integration tests:

- hydrate the real Chapbook 1.2.3 and 2.3.1 manifests;
- exercise representative Chapbook syntax and every exposed toolbar command
  category;
- load Harlowe 3.3.9 and assert generic fallback without legacy
  initialization;
- switch a live editor among generic, Chapbook, and Harlowe formats;
- open two passages with one format and prove state does not cross tabs;
- replace/reload a user format with the same name/version and invalidate its
  adapter recipe;
- disable and re-enable extensions without recreating the editor.

End-to-end tests:

- import an older published story and resolve integration from the installed
  format rather than the imported HTML;
- edit passages, script, and stylesheet;
- find and replace;
- undo/redo and indentation controls;
- close/reopen the project and restore cursor/scroll state;
- play, test, proof, and publish representative stories.

Accessibility checks:

- labels, roles, descriptions, and screen-reader behavior on every migrated
  editor;
- keyboard navigation and focus return for format toolbars and menus;
- tab/shift-tab behavior in code editors versus compact search fields;
- no focus loss after an adapted command changes text or selection.

## Suggested commit sequence

1. Add CM6 migration fixtures, behavioral baselines, and performance probes.
2. Add the `SourceEditor` dynamic-extension seam and controlled handle.
3. Migrate legacy JavaScript, stylesheet, and search surfaces from `CodeArea`.
4. Add format integration resolution, cache invalidation, and fallback types.
5. Add the bounded stream-mode adapter and Chapbook `lookAhead` support.
6. Add the scoped editor facade and React story-format toolbar.
7. Enforce Harlowe/unknown-format fallback and surface compatibility status.
8. Remove CM5 dependencies and obsolete implementation.
9. Run performance/release validation and update architecture/status docs.

Keep each commit independently testable. Do not combine dependency removal with
the initial adapter implementation; removal is the proof that all production
consumers have already migrated.

## Rollout and rollback

- Keep the development-only format-extension opt-out available while the CM6
  host and Chapbook adapter complete release validation.
- Use automatic per-format rollback to generic CM6 when adaptation fails.
- Treat text, selection, or undo corruption; inability to edit/save/publish;
  editor crashes; accessibility blockers; and performance-budget failures as
  release blockers.
- Make CM5 dependency removal a standalone, revertible commit after a
  release-candidate soak.
- Do not introduce a story or format data migration. Reverting this work must
  change editor implementation only.

## Completion criteria

This roadmap item is complete only when:

- every active editor is CM6 or an intentional plain textarea;
- Chapbook's compatible legacy integration works through the bounded adapter;
- Harlowe follows the documented generic-CM6 fallback without format changes;
- unsupported extensions fail closed and explain why;
- mutable parser, document, command, toolbar, and failure state are isolated
  per editor view, while immutable adapter recipes are cached by format
  identity;
- play/test/proof/publish output is unchanged;
- CM5 packages and production imports are absent;
- functional, memory, bundle, and latency gates pass;
- an accepted clean, same-revision Electron baseline passes the enforced
  regression comparison;
- architecture, extension compatibility, and status documentation reflect the
  shipped behavior.
