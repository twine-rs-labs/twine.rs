# twine.rs 0.1.2 Feedback — Deep Technical Remediation Roadmap

This is the engineering response to the 0.1.2 external playtest feedback (tester
"Hituro", 2026-06-23). It is **analysis + a buildable plan**, not a set of
applied fixes — nothing in the codebase has been changed by this document.

It is written to be **implementation-proof**: every item names the responsible
file and line range, the actual mechanism (not a guess), an explicit fix
direction, and **DO / DON'T** rules so an implementer cannot quietly take a
shortcut that re-introduces the bug or violates the architecture.

## How this fits the existing roadmaps (read first)

This is a _polish-and-correctness_ layer on top of work that already shipped. The
relevant state, as of the 2026-06-21 notes in the planning docs:

- The **D-series** (design-system shell) has landed its primary screens: `/formats`,
  `/stories/:id/contents`, `/stories/:id/diagnostics`, `/stories/:id/assets`,
  `/stories/:id/build`, `/settings`, and the Workbench Text/Graph/Split editor
  ([`TWINE_RS_DESIGN_SYSTEM_SPINE.md`](./TWINE_RS_DESIGN_SYSTEM_SPINE.md), D4–D8 notes).
- The **Workbench editor dock + graph** were rebuilt to the `ui_kits/workbench`
  spec ([`../WORKBENCH_INTEGRATION.md`](../WORKBENCH_INTEGRATION.md)).
- The **Rust core is still bypassed at runtime** for most authority; the live app
  runs on the TS parity bridge. The Rust-ownership cutover is
  [`TWINE_RS_PERFORMANCE_ROADMAP.md`](./TWINE_RS_PERFORMANCE_ROADMAP.md) Phases 1–3.

**The headline finding:** almost none of this feedback requires a GUI redesign.
The screens exist and are structurally right. What's broken is **wiring,
state-persistence, a few correctness bugs, and one launch-bricking crash** — plus
**one screen (Build/Export) that is genuinely over-built and should be simplified**.
Exactly two items justify a focused brief to the GUI designer (claude design);
they're in [§ Design briefs](#design-briefs-for-claude-design). Everything else is
a code task with a precise location below.

## Non-regression contract (binding on every fix here)

1. **Don't regress the Workbench model.** The graph is one transformed world with
   no scrollbars (by design — `WORKBENCH_INTEGRATION.md` §0). Fixes must not
   reintroduce `scrollLeft`/`overflow:auto` panning.
2. **Presentation/viewport/workspace state is TS-owned; story facts are Rust-owned.**
   Persisting open editors, pan position, focus mode, tool selection, etc. goes in
   the TS workspace layer (localStorage), _not_ the Rust session. Parsing,
   indexing, variable extraction, diagnostics, asset inventory, and reveal targets
   are Rust authority (today via the TS parity bridge) — fix them in the authority,
   not only in a view filter.
3. **No silent fallbacks that mask a missing target.** The recurring "open the
   start passage when we don't know where to go" antipattern is banned (see W2).
4. **Removing/consolidating options is allowed and encouraged** (per direction). A
   control that does nothing must be removed or wired — never left as a no-op.

---

## Severity & wave summary (the mini-roadmap)

| Wave            | Theme                           | Items                                                                                                 | Why this order                                                                |
| --------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **W0**          | **Launch-bricking crash**       | Backup recursive-copy; stale library path in app-data                                                 | App is _unopenable_ and a normal reinstall doesn't fix it. Ship first, alone. |
| **W1**          | Library location truth          | Real "move library"; directory-scan fallback; stop silent project pruning                             | Same subsystem as W0; the feature gap _caused_ the crash.                     |
| **W2**          | The "reveal" lie                | One reveal/navigation contract; kill start-passage fallback; stylesheet/script/asset/variable targets | One root cause behind 4 separate complaints across Contents + Assets.         |
| **W3**          | Workspace persistence           | Persist open editors, pan position, graph view options across route changes                           | One root cause behind ~6 complaints across Graph + Preferences.               |
| **W4**          | Editor dock polish              | Active-window highlight, search toggle, stuck drag-grey, right-edge grey bars, stack/tile             | Self-contained dock bugs; high annoyance, low risk.                           |
| **W5**          | Correctness bugs                | `____`→variable; missing-asset detection; asset import pipeline                                       | Data-correctness; the import gap blocks a core workflow.                      |
| **W6**          | Preferences truth               | Theme toggle (remove or palette), Enhanced Editor toggle (remove or wire)                             | Two no-op controls; decide remove vs. implement.                              |
| **W7**          | Formats wiring                  | Icons/descriptions/source links; add-local-format flow                                                | Mostly hydration/render wiring + one feature (local format).                  |
| **W8**          | Diagnostics clarity             | Empty-state, counts, scope                                                                            | Panel works; only the empty UX confuses.                                      |
| **W9 (design)** | **Build/Export simplification** | Drastically simplify; remove inspect targets; inline proofing format; dismissible/info-not-error      | The one true redesign. Needs a design brief.                                  |

---

# W0 — CRITICAL: the launch-bricking backup crash

**Symptom (verbatim):** moving the library folder failed; moving it back caused a
crash on every launch — `Cannot copy '/…/Documents/Twine RS' to a subdirectory of
itself, '/…/Documents/Twine RS/Backups/2026-6-23 23-34-44-316'.` Deleting the
folder and **reinstalling did not fix it**; only deleting the application-support
folder did.

**Ownership:** 100% TypeScript / Electron main process. The Rust `twine_store`
backup (`crates/twine_store/src/lib.rs:734-749`) writes to a _sibling_
`.{name}.backups` dir and is **not** involved.

**Root cause — three compounding faults:**

1. **Recursive copy.** [`story-directory.ts:156-173`](../../src/electron/main-process/story-directory.ts)
   `backupStoryDirectory()` calls `copy(getStoryDirectoryPath(), <library>/Backups/<timestamp>)`
   (fs-extra `copy`, the call is at line 172; timestamp built at 165-170 — the
   non-padded `2026-6-23` format matches the error exactly). The default backup
   dir [`story-directory.ts:134-144`](../../src/electron/main-process/story-directory.ts)
   is `<library>/Backups`. When the persisted library path is an **ancestor of the
   Backups dir** (the tester's library pref pointed at `~/Documents/Twine RS`, the
   app-name root, whose child is `Backups/`), the copy is into its own subtree →
   fs-extra throws by design.
2. **A backup failure is fatal to launch.** [`init-app.ts:88-94`](../../src/electron/main-process/init-app.ts)
   `await backupStoryDirectory()` runs on every launch _before_ `createWindow()`
   (line 100); the throw hits the catch at `init-app.ts:101-109` → error box →
   `app.quit()`. The window never opens.
3. **The bad path lives outside the library and survives reinstall.** The library
   path is persisted in `app-prefs.json` under `app.getPath('userData')`
   ([`json-file.ts:13-29`](../../src/electron/main-process/json-file.ts);
   key `storyLibraryFolderPath` in [`app-prefs.ts:8-22`](../../src/electron/main-process/app-prefs.ts)).
   On launch, [`story-directory.ts:26-80`](../../src/electron/main-process/story-directory.ts)
   reads the stale path and **`mkdirp`s it back into existence** (lines 43-45) if
   missing, then re-adopts it — so deleting `~/Documents/Twine RS` and reinstalling
   the app bundle both leave the offending pref untouched and the loop repeats.
   Clearing Application Support is the only reset because that's where the pref is.

### Fix — defense in depth (do all four; do not stop at one)

**W0.1 — De-fatal the launch backup (the must-have).** Wrap the launch-time
backup so a backup failure logs a diagnostic and continues to `createWindow()`.

- DO: give `backupStoryDirectory()` its own `try/catch` at the call site in
  `init-app.ts` (and inside the function), surfacing a non-blocking notification.
- DO: keep backups as a _best-effort_ feature; the app must always open.
- DON'T: leave any `await` on the startup critical path that can `app.quit()` for
  a non-fatal maintenance task. A backup is never worth bricking the editor.

**W0.2 — Make the copy structurally incapable of recursing.** In
`backupStoryDirectory()`, before copying:

- DO: compute `path.relative(src, dest)`; if it does not start with `..` and is
  not absolute, `dest` is inside `src` → **do not copy into the child**.
- DO: pass fs-extra `copy(src, dest, {filter})` where the filter excludes the
  backup root (and any `.twine`/cache dirs) from the copied tree, so even a
  sibling backup dir never re-copies prior backups.
- DON'T: rely solely on the path being a sibling "by default" — the user can
  repoint the library anywhere, so the guard must be computed, not assumed.

**W0.3 — Relocate backups out of the library by default.** A backup of X should
not live inside X.

- DO: default `backupFolderPath` to a location that is provably not a descendant
  of the library — either a sibling (`<library>/../<AppName> Backups`) or under
  `userData/Backups`. Make it explicit in Settings (W1 ties in).
- DON'T: keep `<library>/Backups` as the default; that's the trap.

**W0.4 — Validate & self-heal the persisted library path on load.** In
`initStoryDirectory()`:

- DO: if `storyLibraryFolderPath` is missing, unreadable, equal to/ancestor of the
  backup dir, or otherwise unsafe, fall back to the safe default
  (`story-directory.ts:74-78`) and emit a visible "library path reset" notice.
- DO: add a user-reachable "Reset library location to default" action (menu +
  Settings) so a bad state is recoverable without deleting Application Support.
- DON'T: silently `mkdirp` and re-adopt a path that just failed a safety check —
  that's the resurrection loop. Recreate only paths that pass validation.

**Tests (headless, required before W0 is "done"):**

- main-process unit: `copy` is never invoked with a `dest` inside `src` (assert via
  spy on a fixture where library == backups' parent).
- main-process unit: a thrown backup error does **not** call `app.quit()` and the
  window still creates.
- main-process unit: a persisted library path equal to its own backups' parent is
  rejected on load and replaced with the default.

---

# W1 — Library location: tell the truth, and offer to move

**Symptoms:**

- "Changing Story Library location should have an option to **move** the current
  stories, rather than switching to a brand-new empty location."
- "Moving the folder myself + repointing the pref + restarting **still shows no
  projects**."

**Root cause:** [`story-directory.ts:98-113`](../../src/electron/main-process/story-directory.ts)
`chooseStoryDirectoryPath()` _only_ repoints the pref (`setAppPref` at line 106) and
prompts a relaunch — it never moves anything. And the project list is **not** a
scan of the chosen folder: it's read from a persisted index of **absolute** paths,
`<library>/.twine/native-projects.json`
([`project-library-index.ts:10-24`](../../src/electron/main-process/project-library-index.ts),
consumed by [`story-file.ts:33-69`](../../src/electron/main-process/story-file.ts)).
After a manual move, every recorded `rootPath` points at the _old_ location, opens
fail, and [`story-file.ts:62-66`](../../src/electron/main-process/story-file.ts)
**silently prunes** them. There is no directory-scan fallback for `twine.toml`
project folders ([`story-file.ts:93-108`](../../src/electron/main-process/story-file.ts)
only scans top-level legacy `*.html`).

### Fix

**W1.1 — Make the project index relocation-proof.** Store project paths **relative
to the library root** in `native-projects.json` (resolve to absolute at read time
against the current library). A folder moved with its `.twine/` intact then "just
works."

- DO: migrate existing absolute entries to relative on first read (one-time, safe).
- DON'T: keep absolute paths as the source of truth; that's why moves break.

**W1.2 — Directory-scan fallback.** When the remembered index is empty or an entry
is missing, scan the library (and the conventional `Projects/` subfolder,
`project-folder.ts:919-926`) for `twine.toml` project folders and adopt them.

- DO: rebuild the index from a real scan when it's stale — this makes a
  hand-moved folder discoverable even without `.twine/`.
- DON'T: silently `forgetProjectFolder()` a missing entry before attempting to
  re-find it by basename in the current library.

**W1.3 — A real "Move library" action.** When the user changes location, ask:
_Move existing stories here_, _Use existing stories already here_, or _Start
empty_.

- DO (move): copy → verify → remove old, then **rewrite/relocate the index** to the
  new root. Reuse the W0.2 "dest not inside src" guard.
- DO: block/confirm picking an ancestor of the backups dir (the W0 trap) right in
  the picker.
- DON'T: implement "move" as a fire-and-forget copy with no verification, and
  DON'T leave the index pointing at the old location after a move.

**Home:** M0 (persistence) + this doc. **Architecture:** Electron main today; when
Phase 2 native load (`twine_store::load_project_path`) lands, the scan/move/index
should move to Rust — design the index format now so that cutover is clean.

---

# W2 — The "Reveal in Source" lie (one contract, four symptoms)

**Symptoms (all the same bug):**

- Reveal on an **asset** opens the start passage.
- Reveal on a **variable** opens only the first usage.
- An asset's "**Used in → Story Stylesheet**" link opens the start passage, not the
  stylesheet.
- (Implied) any reveal whose target isn't a passage silently lands on the start
  passage.

**Root cause:** the navigation primitive can only address a passage.
[`contents-route.tsx:318-326`](../../src/routes/contents/contents-route.tsx)
`sourceTarget(story, mode, passage?)` builds `?mode=…` and only adds
`passage=<id>` when a passage is present; with no passage it navigates to
`/stories/:id?mode=text`, which defaults to the **start passage**. Non-passage
sources (stylesheet/script) carry `passageId: null`
([`story-index.ts:1103-1118`](../../src/core/story-index.ts)), assets store only
their _first_ reference's location
([`story-index.ts:670-691`, `:845`](../../src/core/story-index.ts)), and variables
store only the first occurrence + a count
([`story-index.ts:633-656`](../../src/core/story-index.ts)). The assets route has
the identical defect ([`assets-route.tsx:1049-1061`, `:405-413`](../../src/routes/assets/assets-route.tsx)).

The enabling fact: `EditorWindowSpec` **already** supports `{kind:'script'}` and
`{kind:'stylesheet'}` singleton windows
([`editor-window-spec.ts`](../../src/routes/story-edit/editor-window-spec.ts)). The
route just can't _address_ them.

### Fix — one reveal contract for the whole app

**W2.1 — Extend the source-navigation target to any source, not just passages.**
Add a `source` dimension to `sourceTarget` and the story-edit route: `passage:<id>`
| `script` | `stylesheet`. On arrival, the editor dock opens the matching window
(passages tile; script/stylesheet are the existing singletons). Carry an optional
line/offset so reveal can scroll to the reference.

- DO: make every "Used in" entry individually clickable to _its own_ source
  (passage, script, or stylesheet) — the data already distinguishes them via
  `sourceId`/`passageId`.
- DON'T: ever call `sourceTarget(story, mode, undefined)` as a navigation. If
  there is no resolvable target, the action is **disabled**, not redirected to the
  start passage. (This is the W2 banned antipattern.)

**W2.2 — Assets reveal goes to a usage, never the start passage.** The asset row's
"Reveal in Source" opens its first _real_ reference's source; if the asset has zero
references, the action is disabled (and the asset shows as "unused"). Prefer a
small "Used in (N)" popover listing all references when N>1.

- DO: drive this from the reference list the index already has.
- DON'T: synthesize a passage target for an asset that lives in the stylesheet.

**W2.3 — Variables reveal becomes "find all usages."** Clicking a variable opens
the search panel scoped to that symbol (real all-usages navigation), rather than
jumping to a stored first-occurrence.

- DO: route through the search query system (Rust authority per perf-roadmap
  P1.4) so "usages" means _all_ usages with snippets, not one.
- DON'T: expand the index entry to carry every location just to power a jump —
  that's what search is for; keep the contents index summary-shaped (count only).

**Home:** D6 follow-ups (Contents/Assets) + perf-roadmap P1.4 (search authority).

---

# W3 — Workspace state evaporates (one fix, ~six symptoms)

**Symptoms:**

- Graph **arrow mode / focus mode / snap** revert to default on close+reopen.
- Right-click **tool** reverts to the first each time the graph opens.
- **Pan position** is not remembered (only zoom is).
- Going to **Preferences and back loses open editors** and the map location.

**Root cause:** these are React component state in `StoryGraphPanel` and
`InnerStoryEditRoute`, lost on unmount. Today only `story.zoom` and
`story.snapToGrid` survive (persisted into the Story object), and
[`workspace-state.ts:41-43,84-91`](../../src/routes/story-edit/workspace-state.ts)
persists _mode / selectedPassageId / scroll_ per story — but **not**
`editorWindows` ([`story-edit-route.tsx:44-50`](../../src/routes/story-edit/story-edit-route.tsx)),
nor the graph's `tool` (`story-graph-panel.tsx:923`), `focusSelection` (`:908`),
`layers` (`:909-913`), `density` (`:903-905`), nor pan `x/y`.

### Fix — one per-story workspace snapshot

**W3.1 — Extend the per-story workspace-state object** (the existing
localStorage record keyed `twine-story-edit-workspace-<storyId>`) to include:
`editorWindows: EditorWindowSpec[]`, `activeWindowId`, graph `view {x,y,k}`, and
graph options `{tool, focusSelection, layers, density, arrow/viewDirection}`.
Hydrate on mount; write debounced on change.

- DO: keep this in the **TS workspace layer** — it is viewport/editor state, which
  the architecture explicitly assigns to TS, not the Rust session (Design Spine
  "No project mirror in the frontend" / "UI keeps only view/viewport/editor state").
- DO: on restore, **prune** editor windows whose passages no longer exist, and
  clamp a restored pan/zoom to valid bounds.
- DO: persist pan `x/y` _debounced_ (same pattern as the existing 400ms zoom
  persist at `story-graph-panel.tsx:1265-1281`) — never per-frame.
- DON'T: persist passage **body text** in workspace state — bodies are hydrated
  from the core/session (perf-roadmap P0.2/§3.1). Persist only the window _specs_.
- DON'T: move `tool`/`focus`/`density` into the Rust Story model. They are not
  story facts; putting them there would dirty the document and break source-only
  round-tripping.

**W3.2 — Decide the unit of persistence intentionally.** `zoom`/`snapToGrid` are
currently Story-level (shared across machines, written into the doc). Pan/tool/
focus should be _workspace-local_ (per machine, localStorage). Keep that split and
document it, so a future native-session cutover knows what is and isn't story data.

**Home:** D4/D5 polish; aligns with Design Spine's view-state rule.

---

# W4 — Editor dock polish (self-contained bugs)

**Status: resolved for W5 handoff.** Active editor visibility, search toggle,
drag cleanup, the right-edge grey bar root cause, and the explicit Tile / Stack
layout are implemented and regression-covered in the editor dock/source-editor
tests.

**W4.1 — Active editor window is barely visible.** The active treatment is a 2px
inset top shadow ([`story-edit-route.css:1325-1327`](../../src/routes/story-edit/story-edit-route.css));
focus tracking itself is correct (`editor-dock.tsx:194`, `activeWindowId`).

- DO: give the active window a clearly visible DS treatment — e.g. an accent
  titlebar tint + a full-width 2–3px accent top border + a subtle outer ring —
  using `--acc-*`/`--sem-*` tokens. It must read at small tile sizes and when the
  cursor has scrolled off-screen.
- DON'T: rely on a 2px inset line; DON'T animate it (frame budget).

**W4.2 — Search icon doesn't toggle.** The button unconditionally increments
`searchRequestKey` → always `openSearchPanel()`
([`editor-window.tsx:316-320`](../../src/routes/story-edit/editor-window.tsx); the
effect calls `openSearchPanel` with no close branch).

- DO: track CodeMirror's search-panel open state (CM6 exposes
  `searchPanelOpen(state)`); the button calls `closeSearchPanel(view)` when open,
  `openSearchPanel(view)` when closed. Keep `Esc` working.
- DON'T: fake it with a counter that can't represent "close."

**W4.3 — Dragged window stays greyed.** `dragIndex`/`overIndex` reset only inside
`onDrop` ([`editor-dock.tsx:181-190`](../../src/routes/story-edit/editor-dock.tsx));
a drop outside the grid (e.g. onto the graph pane in split) never fires it, so the
cell stays `opacity:0.35` (CSS `.is-dragging`, `story-edit-route.css:1299-1301`).

- DO: add an `onDragEnd` handler on the draggable titlebar that **always** clears
  `dragIndex`/`overIndex`, regardless of drop success (this is the canonical HTML5
  DnD cleanup). Treat `onDrop` as the _reorder_ path and `onDragEnd` as the
  _cleanup_ path.
- DON'T: put cleanup only in `onDrop`.

**W4.4 — Mysterious grey bar at the right edge.** Resolved by removing the two
static root causes instead of masking the symptom: `SourceEditor` now applies
CodeMirror line wrapping to editor content and `foldingExtension()` only mounts
`foldGutter()` for CSS/HTML/JavaScript buffers, not Twine prose
([`source-editor.tsx`](../../src/components/control/source-editor/source-editor.tsx)).
The scrollbar styling remains on `.cm-scroller` so actual overflow navigation is
preserved when a code buffer needs it
([`source-editor.css`](../../src/components/control/source-editor/source-editor.css)).

- DO: keep passage prose wrapped and keep fold gutters limited to structured code
  languages. The regression test is
  [`source-editor.test.tsx`](../../src/components/control/__tests__/source-editor.test.tsx).
- DON'T: hide `.cm-scroller`, `.cm-gutters`, or scrollbar pseudo-elements as a
  shortcut; that would reintroduce navigation/accessibility bugs in code buffers.

**W4.5 — "Stack instead of tile."** Stacking already exists but only implicitly in
compact/split mode (`editor-dock.tsx:30-40`). Expose an explicit, persisted
**Tile / Stack** control in the dock chrome (persist via W3).

- DO: a small SegmentedControl (DS) in the dock chrome bar; default = current
  adaptive behavior; "Stack" forces single-column scroll.
- DON'T: add a third bespoke layout engine — reuse the existing grid with a forced
  column count.

**Home:** D4 polish.

---

# W5 — Correctness bugs

**Status: implemented.** Variable extraction now rejects all-underscore captures
in Rust and TS parity; asset inventory has an explicit completed-scan state so
referenced files missing from a completed scan become `exists=false`; import
preparation and project asset scanning now fall back to the TypeScript
compatibility path when the native backend is unavailable, and import asset copy
runs a post-copy scan.

**W5.1 — `____` is listed as a variable.** `symbols_in_source`
([`crates/twine_core/src/lib.rs:3855-3912`](../../crates/twine_core/src/lib.rs))
captures a `$` sigil followed by `is_identifier_start`, where both
`is_identifier_start` and `is_identifier_byte` accept `_` and **never require an
alphanumeric**. So `$____` (and an all-underscore tail generally) becomes a
"variable." (The TS parity regex in `story-index.ts:459-480` has the same shape.)

- DO: in the Rust authority, reject a captured symbol whose name — after the sigil,
  ignoring `.` separators — contains **no ASCII alphanumeric character**. Apply the
  same guard to _every_ sigil branch (if/when a `_`-prefixed temp-variable branch is
  added for SugarCube, it must use the same rule).
- DO: mirror the guard in the TS parity path so search/contents agree until the
  Rust cutover.
- DON'T: "fix" it only by filtering the contents _view_ — that leaves search,
  diagnostics, and autocomplete still treating `$____` as a variable. Fix it in the
  extractor (the authority), per the architecture.
- DON'T: special-case the literal four-underscore `<hr>` token; the general rule
  (no-alphanumeric ⇒ not an identifier) is correct and covers `__`, `___`, `$_.__`, etc.

**W5.2 — Imported references never show as "missing".** Missing is computed as
`exists === false && references.length > 0` ([`story-index.ts:554`](../../src/core/story-index.ts)),
but a referenced-but-unscanned asset gets `exists: null`
([`story-index.ts:587-592`](../../src/core/story-index.ts)), so the condition is
never true → nothing is flagged.

- DO: distinguish three states explicitly — `present` (`exists===true`), `absent`
  (scanned, not found ⇒ `exists===false`), `unknown` (never scanned ⇒ `null`).
  After a project asset scan completes, a referenced asset not found on disk is
  **absent**, and absent + referenced ⇒ **missing**. Change the inventory assembly
  to set `false` (not `null`) for referenced paths confirmed not on disk.
- DON'T: flip the condition to `exists !== true` blindly — that would mark _unknown_
  (pre-scan) assets as missing and produce false positives during load. Gate on a
  completed scan.
- **Home:** perf-roadmap P2.6 (one authoritative asset manifest feeds inventory +
  missing detection). The right long-term owner is the Rust/native scan.

**W5.3 — Asset import doesn't copy assets.** The import pipeline tries native first
([`project-folder.ts:1894-1979`](../../src/electron/main-process/project-folder.ts)),
and if the native addon is unavailable it throws unless
`TWINE_LEGACY_PROJECT_FALLBACK=1` ([`project-folder.ts:1912`](../../src/electron/main-process/project-folder.ts)).
Asset copy (`copyProjectImportAssets`, `project-folder.ts:2106-2132`) only runs when
that preparation succeeded. So in a shipped build with no working native addon and
the flag unset, **referenced assets are never copied** — which also feeds W5.2
(they then aren't even flagged missing). This is perf-roadmap **P2.4 (native
zip/html import) being incomplete**.

- DO: make the shipped app actually copy assets on import — either finish/ship the
  native import path (P2.4; the Rust functions exist:
  `twine_native/src/lib.rs:476-488,892-968`) **or** enable the TS legacy fallback in
  production behind a runtime health check with a **visible diagnostic** when it's
  used (per perf-roadmap P2.5 fallback rule).
- DO: after import, run an asset scan so W5.2 can report anything still missing.
- DON'T: leave the path throwing or silently no-copying in release; a core import
  workflow must not depend on an undocumented env var.
- **Home:** perf-roadmap P2.4/P2.5.

---

# W6 — Preferences: two controls that do nothing (decide: remove or wire)

**Status: implemented (shipped the palette + retired the toggle — the honest
path for both, not the "hide it" fallback).**

- **W6.1** now ships the real **"Daylight workbench" light theme** instead of
  hiding the selector. A full `[data-app-theme='light']` block in
  `design-system/tokens/colors.css` re-binds every primitive
  (ink / line / tx / accents / semantics / elevation) to a soft cool-paper
  palette, so the existing System / Light / Dark selector and `ThemeSetter`
  finally do something. Because CSS custom properties resolve `var()` at their
  _declaring_ element (verified empirically), the semantic aliases
  (`--bg-*` / `--text-*` / `--border-*`) had to be re-bound inside the light
  scope too — without that, the ~13 alias-driven CSS files stayed dark; the
  high-contrast block was given the same re-bind (it had the same latent gap).
  The one hardcoded editor active-line wash (`source-editor/themes.ts`) and the
  legacy white hover overlay (`styles/colors.css`) were routed through
  theme-adaptive tokens. `@kind` token tagging is preserved verbatim.
- **W6.2** removed the `useCodeMirror` pref entirely — Settings UI, the legacy
  prefs dialog, the store type/defaults, and every consumer. The enhanced
  **CodeMirror editor is now always-on** for passages and the JS / Stylesheet /
  Search dialogs; the cursor-blink and font prefs are kept.

**W6.1 — Theme change has no effect.** `appTheme` is stored
([`prefs.types.ts:44-48`](../../src/store/prefs/prefs.types.ts)) and applied as
`document.body.dataset.appTheme` ([`theme-setter.tsx:9-20`](../../src/store/theme-setter.tsx)),
but the design-system tokens are **dark-only** — there is no `[data-app-theme='light']`
palette ([`styles/design-system/tokens/colors.css:18-116`](../../src/styles/design-system/tokens/colors.css)),
and the DS is explicitly dark-first (Design Spine D0). So the attribute flips and
nothing changes.

**Decision (recommended): remove now, design later.**

- DO (now, recommended): reduce the theme control to a single honest state (Dark),
  or hide the selector entirely, until a light palette exists. A toggle that lies is
  worse than no toggle.
- DO (later, optional): if a light theme is wanted, it is a genuine
  **design-system task** — a full light token palette — captured as a design brief
  in [§ Design briefs](#design-briefs-for-claude-design) (Brief B). It is _not_ a
  CSS afternoon; every `--ink/-line/-tx/-acc/-sem` token needs a light value with
  verified contrast.
- DON'T: hand-patch a few colors to fake a light mode; that fractures the token
  system the whole D-series is built on.

**W6.2 — "Enhanced Editor" toggle does nothing (in the Workbench).** `useCodeMirror`
([`prefs.types.ts:207-208`](../../src/store/prefs/prefs.types.ts)) still switches the
_legacy_ `CodeArea` between CodeMirror and a textarea
([`code-area.tsx:96-110`](../../src/components/control/code-area/code-area.tsx),
used by the JS/Stylesheet **dialogs**). The new Workbench passage editor
(`source-editor`) is CodeMirror-always and ignores the pref — so toggling it has no
visible effect on passage editing.

**Decision (recommended): remove the legacy toggle; it's a CM5-era concept.**

- DO (recommended): remove `useCodeMirror` from the Settings UI and treat the
  enhanced editor as always-on (the Workbench is the editor now). Keep the cursor-
  blink/font prefs that still apply.
- DO (alternative, only if a plain-textarea mode is genuinely wanted): repurpose the
  toggle to switch the _source-editor_ into a minimal no-extensions mode and wire it
  there — but this is more work for a feature few want.
- DON'T: leave a Settings switch that controls only two secondary dialogs while
  appearing to govern "the editor."

**Home:** D7 Settings polish + D9 dialog/legacy retirement.

---

# W7 — Story Formats: missing icons, descriptions, source links, local add

**Status: implemented.**

- **W7.1** — The DS formats screen now renders each format's real icon once its
  manifest hydrates, with explicit **loading** (spinner) and **failed-load**
  (error glyph) states on the logo and an initials fallback when a format has no
  image or the image itself 404s. The Electron JSONP loader gained an `onerror`
  path (single-settlement guard) so a missing `format.js` — the common file://
  packaging failure — surfaces immediately instead of after a vague 2s
  "Timeout". (Confirming the packaged-build jsonp/base-URL resolution itself
  still needs a run of the packaged desktop app; the UI now makes any failure
  visible per-format.)
- **W7.2** — The detail panel renders the format's **website link**
  (`properties.url`, distinct from the `format.js` location) plus its
  **description**, author, and license.
- **W7.3** — Added an **"From File"** import (desktop only): a new
  `add-local-story-format` IPC opens a picker for a `format.js` file (or a folder
  containing one), validates it is a real format by parsing the
  `window.storyFormat(...)` manifest (no eval), then copies the format and its
  relative icon into a managed `userData/story-formats/<name>-<version>/`
  directory and adds it by its file:// URL so the icon resolves and it survives
  the original being moved. No more hand-constructing a URL to a local file.

**Symptoms:** format icons absent; descriptions and source links absent; can't add a
user format by directory (only a `format.js` URL works).

**Root cause(s):**

- Icon/description/url come from the jsonp-hydrated `format.properties`
  ([`action-creators.ts:62-85`](../../src/store/story-formats/action-creators.ts);
  fetch via [`fetch-properties.ts:12-38`](../../src/util/story-format/fetch-properties.ts);
  Electron jsonp via [`preload.ts:13-57`](../../src/electron/main-process/preload.ts)).
  If a format never reaches `loadState==='loaded'`, the icon renderer
  ([`story-format-item.tsx:46-48`](../../src/components/story-format/story-format-item/story-format-item.tsx))
  and the details renderer
  ([`story-format-item-details.tsx:54-98`](../../src/components/story-format/story-format-item/story-format-item-details.tsx))
  show nothing. **Default formats showing no icon implies the jsonp hydration is
  failing in the packaged app** (relative `story-formats/.../format.js` under
  `file://`, or the no-context-isolation jsonp preload path), not just a UI gap.
- `format.properties.url` (the format's website) is **never rendered** in the
  details view even when present — the route only shows `format.url` (the
  `format.js` location) at [`story-formats-route.tsx:451-453`](../../src/routes/story-formats/story-formats-route.tsx).
- Add-format only accepts a valid URL ([`add-story-format-button.tsx:15-105`](../../src/dialogs/story-formats/add-story-format-button.tsx));
  a directory or local file fails validation. Local icons then face a `file://`
  CSP problem for `<img src>`.

### Fix

**W7.1 — Make format hydration actually succeed in the packaged build (investigate
first).** Confirm in the running desktop app whether default formats reach
`loaded`. If not, fix the jsonp/base-URL resolution under `file://` (this connects
to the perf-roadmap §7b item 6 about the no-context-isolation preload). Surface a
visible failed-load state per format instead of a blank card.

- DO: add an explicit per-format error/loading state in the DS formats screen.
- DON'T: assume it's purely a missing-render bug — verify load state first; a blank
  icon for a _built-in_ format is a loading failure.

**W7.2 — Render the source link and description in the DS screen.** Add
`format.properties.url` (website) as a link and ensure `description` renders where
present.

**W7.3 — Add-local-format flow.** Accept a `format.js` file or a directory
(resolve `format.js` within it). For the icon `file://`/CSP issue, copy the added
format into the app's managed formats directory (or serve via a safe app protocol)
so its relative `image` resolves and renders.

- DO: validate the picked target is a real format (`window.storyFormat(...)`
  payload) before adding.
- DON'T: require users to hand-construct a URL to a local file.

**Home:** D6 formats polish; ties to perf-roadmap §7b(6) preload hardening.

---

# W8 — Diagnostics: it works; the empty state confuses

**Symptom:** "none of the options show anything — not ready yet?"

**Root cause:** the panel is **fully wired** — it requests `includeDiagnostics:true`
([`diagnostics-route.tsx:187-221`](../../src/routes/diagnostics/diagnostics-route.tsx))
and renders real categories from the index ([`story-index.ts:379-449`](../../src/core/story-index.ts)).
A clean test story simply has zero broken links / duplicates / missing start, so
every (always-visible) category filter shows nothing — reading as "broken."

### Fix (UX clarity only — no engine work)

- DO: show a strong empty state ("No issues found — your story is healthy") and put
  **live counts on each category chip**, hiding or disabling zero-count categories.
- DO: add a one-line "what diagnostics are" explanation in the empty state.
- DON'T: present a wall of clickable categories that are all empty with no
  indication that empty == good.
- Consolidation note: consider whether Diagnostics needs to be a separate top-level
  destination or can live as a drawer tab alongside Search/Build output (it's
  already a panel). Keep separate for now; revisit in W9's shell-tidy.

**Home:** D6 diagnostics polish.

---

# W9 — Build/Export: the one real redesign (simplify hard)

**Symptoms:** "extremely complex vs a normal save dialog"; "no idea what an _export
surface_ is"; proofing format can't be chosen at export; twee export shows "4
errors" that shouldn't be errors; can't dismiss an export warning; "HTML report"
seems useless; "source inspection" would be better on-screen than exported.

**Root cause:** the build route exposes **11 targets**
([`build-route.tsx:38-134`](../../src/routes/build/build-route.tsx);
targets in [`build-package.ts:16-27`](../../src/util/build-package.ts)) including two
"inspection" report targets ([`build-package.ts:419-470`](../../src/util/build-package.ts)),
warnings that are **reconstructed every render with no dismiss control**
([`build-route.tsx:493-560`](../../src/routes/build/build-route.tsx)), proofing locked
to the global pref ([`use-publishing.ts:116-145`](../../src/store/use-publishing.ts)),
and fidelity omissions surfaced as warnings the user reads as errors
([`build-package.ts:345-355`](../../src/util/build-package.ts) — severity is
_technically_ `warning`, but the framing screams failure).

This is the item that justifies a **design brief** (Brief A below). The engineering
side has concrete, do-now simplifications that the redesign should assume:

- **Remove `inspect-html` and `inspect-source` as export targets.** They export
  text reports to disk that the tester (correctly) found pointless. If inspection is
  valuable, it belongs **on-screen** (a read-only panel), not as a saved file. This
  is exactly the kind of option to delete/consolidate.
- **Stop calling expected omissions "warnings."** For source-only formats (Twee/
  JSON), "no asset binaries / no runtime HTML" is _by definition_ — present these as
  quiet **info** ("This format is source-only; assets and runtime HTML are not
  included"), never as a warning/error count, and never as a blocker.
- **Make warnings dismissible and ephemeral.** Clear them on target switch and give
  an explicit dismiss; don't require "run another export" to clear stale output.
- **Let proofing pick its format inline.** Add a format selector to the Proof flow
  rather than forcing the global `prefs.proofingFormat`.
- **Drop the term "export surface" from all user-facing copy.**

**Home:** D7 advanced Build policy + this doc. **Don't** rebuild it as a wizard;
the goal is _fewer choices, plain words_.

---

# Design briefs (for claude design)

Only two items need the GUI designer. Both are handed off as ready-to-use briefs.
Everything else in this document is a code task, not a design task.

## Brief A — Simplify Build/Export into a plain "Export" experience

> **Context.** twine.rs is a Rust-cored, Electron/React Twine editor. The current
> Build/Export screen (`src/routes/build/`, DS shell route `/stories/:id/build`)
> exposes 11 targets (Play, Test, Proof, Export HTML, Export Twee, Compatibility
> Export, Export JSON, Inspect HTML, Inspect Source, Package, Publish), a
> capability/fidelity matrix, and a non-dismissible warning list. A playtester
> said it is "extremely complex compared to a normal save dialog," didn't
> understand the term "export surface," and found the two "inspection report"
> exports and the HTML report pointless.
>
> **Goal.** Redesign this into something a first-time Twine author understands at a
> glance, while keeping power-user reach. Bias hard toward **fewer choices and
> plain language**. We are willing to remove and consolidate options.
>
> **Hard constraints / decisions already made (do not relitigate):**
>
> - Remove the two "inspection report" export targets. If source/HTML inspection
>   is useful, present it **on-screen** as a read-only panel, not a saved file.
> - Expected omissions for source-only formats (Twee/JSON) must read as neutral
>   **info**, never as warnings/errors or a blocker count.
> - Proofing must let the user pick the proofing format **at export time**.
> - The phrase "export surface" must not appear in the UI.
> - Warnings must be dismissible and must clear when switching targets.
> - Must work in the DS shell, dark theme, DS tokens/primitives only. Must work for
>   source-only projects (no graph) and huge projects (no per-render heavy work).
> - Run actions (Play / Test / Proof) are conceptually different from Export/Publish
>   — consider separating "Run/Preview" from "Export/Save" so the Export view reads
>   like a save dialog.
>
> **Deliverables.** (1) An information architecture proposal that collapses the
> 11 targets into a small set of user-meaningful actions (propose the grouping and
> the words). (2) Wireframes/mockups for the primary Export flow and the Run/Preview
> flow. (3) The empty/zero-issue, has-warnings, and error states. (4) The inline
> proofing-format picker. (5) Explicit dos/don'ts for the implementer so the
> simplification can't regress into a matrix again.

## Brief B — (Optional, deferred) Light theme token palette

> **Context.** The design system is dark-only; the Settings theme toggle currently
> does nothing because no `[data-app-theme='light']` palette exists
> (`src/styles/design-system/tokens/colors.css`). We are removing the broken toggle
> for now (engineering item W6.1). A light theme is _optional_ and only worth doing
> if we actually want it.
>
> **If commissioned, goal.** Produce a complete **light** value set for every DS
> color token (`--bg-app`, `--ink-*`, `--line-*`, `--tx-*`, `--acc-*`, `--sem-*`)
> with verified contrast (WCAG AA for text, clear semantic separation for
> broken-link/self-link/start/search states), plus the graph dot-grid, editor
> gutters, and selection colors. Must be a drop-in `[data-app-theme='light']`
> block that the existing `ThemeSetter` activates — no per-component overrides.
>
> **Do / Don't.** DO derive from the existing dark token _roles_ so layouts don't
> shift. DON'T introduce new tokens or change dark values. DON'T ship a partial
> palette — a half-light app is worse than dark-only.

---

# Roadmap consolidation — where each item lives, and what to update

This feedback does **not** spawn a new parallel roadmap. Every item maps onto an
existing milestone; this doc is the tracking index, cross-linked from the others.

| Item                             | Home milestone(s)                                                  | Note added to                         |
| -------------------------------- | ------------------------------------------------------------------ | ------------------------------------- |
| W0 crash, W1 library move/scan   | M0 persistence; perf-roadmap P0.7/P2.2 (native load owns it later) | Milestones M0; perf-roadmap §1/§7b    |
| W2 reveal contract               | D6 (Contents/Assets); perf-roadmap P1.4 (search)                   | Design Spine D6 note                  |
| W3 workspace persistence         | D4/D5 (view-state rule)                                            | Design Spine D4/D5 note               |
| W4 editor dock polish            | D4                                                                 | `WORKBENCH_INTEGRATION.md` follow-ups |
| W5.1 variable extractor          | M4 indexing; Rust authority                                        | Milestones M4                         |
| W5.2/W5.3 asset missing + import | perf-roadmap P2.4/P2.5/P2.6                                        | perf-roadmap Phase 2                  |
| W6 theme / enhanced-editor       | D7 Settings; D9 legacy retirement                                  | Design Spine D7/D9                    |
| W7 formats                       | D6 formats; perf-roadmap §7b(6) preload                            | Design Spine D6                       |
| W8 diagnostics empty-state       | D6 diagnostics                                                     | Design Spine D6                       |
| W9 build/export simplify         | D7 advanced Build policy                                           | Design Spine D7                       |

**Consolidation actions taken alongside this doc** (light cross-reference notes,
not rewrites): a dated pointer to this file is added to the perf roadmap, the
milestones doc, and the design-system spine, each next to the milestone that owns
the relevant fixes, so the next implementer finds this remediation list from any of
the three planning docs.

## The simplification ledger (what we are removing/consolidating)

Per direction, these options are slated for **removal/consolidation**, not just
fixing:

1. **Two "inspection report" export targets** → removed; inspection becomes an
   on-screen panel if kept at all (W9).
2. **"Export surface" terminology** → removed from UI copy (W9).
3. **Theme toggle (light/system)** → removed until a real light palette exists
   (W6.1) — replaces a lying control with an honest one.
4. **"Enhanced Editor" toggle** → removed (Workbench is CM-always) or repurposed
   (W6.2).
5. **The start-passage reveal fallback** → removed everywhere; no-target actions
   disable instead of redirecting (W2).
6. **`<library>/Backups` default location** → removed as a default; backups move
   outside the library (W0.3).
7. **Always-empty diagnostics category chips** → collapsed to counted/non-empty
   only (W8).
