# Workbench overhaul — what changed, how it's wired, and the shortcuts

This documents the rebuild of the story-edit workbench to match the
`ui_kits/workbench/` reference. It is the integration record: every file that
changed, why, how the pieces connect, and the rules to keep so it does not
regress. The reference kit's own rationale lives in
`ui_kits/workbench/WORKBENCH_GUIDE.md` — this file is the *applied* version for
the real `twine.rs` (TS/React + Rust core) code.

---

## 0. The three ideas (unchanged from the guide)

1. **Pan and zoom are a single CSS transform on one "world" layer.** No
   scrolling, no scrollbars, no animation loop.
2. **Story-level chrome appears once. Passage-level chrome lives in the passage
   window.**
3. **Snap targets and the grid dots are the same number** (`GRID = 25`).

Almost every jank/clutter symptom was a violation of one of these. Fix the
structure and the symptoms disappear together.

---

## 1. Graph navigation — `src/routes/story-edit/story-graph-panel.tsx`

### Before
- Pan = native `scrollLeft/scrollTop` on `.story-edit-graph-viewport`
  (`overflow: auto`). Scrollbars grew/shrank; the grid was a fixed background
  that didn't move.
- Zoom = a **discrete** `story.zoom` (0.3 / 0.6 / 1) persisted to the core on
  every wheel tick, then **animated** toward the target by
  `useZoomTransition` over 0.5 s. The animation fought the next wheel event
  ("janks in then out") and lost the cursor anchor.
- Selecting a node **auto-centered** it via `scrollTo` (the "jumps up and to
  the right" jiggle; edges appeared to redraw).

### After
- **One transformed world.** Grid (screen-space layer), edges and nodes ride
  `.story-edit-graph-canvas` with
  `transform: translate(x,y) scale(k); transform-origin: 0 0`. The viewport is
  `overflow: hidden`. Pan mutates `x/y`; zoom mutates `k`. There is **no
  scrolling**.
- **`view = {x, y, k}` is local component state** (`GraphView`).
  `const visibleZoom = view.k` aliases it so the existing projection / edge /
  resize math is untouched.
- **Cursor-anchored, continuous wheel zoom** — `wheelZoom()` uses
  `k * Math.exp(-deltaY * 0.0016)`; `zoomToPoint(localX, localY, nextK)` keeps
  the world point under the pointer pinned. No animation, nothing to fight.
- **`k` is persisted to `story.zoom` debounced (400 ms)** via `persistZoom()`
  so a reload remembers zoom, without round-tripping the core per tick.
- **Selection has no viewport side-effect.** The old auto-center effect now
  only runs on an **explicit reveal** (`revealPassageId` + a new
  `revealRequestKey`) and re-anchors `x/y` directly — never a scroll.
- **`fitToContent()`** frames the whole graph by setting `x/y/k` directly
  (Fit button, `0` key, canvas context menu). There is **no auto-fit on open**
  (kept deterministic + respects persisted zoom); initial view is
  `{x: 80, y: 60, k: clamp(story.zoom)}`.
- The logical viewport for projection tiling + the minimap is now derived
  purely from the transform (`left = -x/k`, `top = -y/k`, size = `client/k`);
  `readViewport()` no-ops until the element is actually laid out.

### Coordinate / state flow into the Rust core (unchanged plumbing)
- Passage moves still persist via `movePassagesCommand(storyId, moves)` with
  logical `CoreRect`s. Drag delta is `screenDelta / view.k`, then snapped:
  `round(v / 25) * 25` (`snapToGraphGrid` from `graph-grid.ts`).
- `setStoryZoomCommand` / `setStorySnapToGridCommand` unchanged. The core does
  **not** validate the zoom range, so continuous `k` (0.2–2.4) is safe.
- The graph projection is still queried with `queryGraphProjectionAsync`; the
  viewport passed in is the transform-derived rect.

### Grid = snap (the "passages don't land on dots" fix)
- `graph-grid.ts` is the single source of truth: `graphSnapGridSize = 25`,
  `graphSnapMajorGridSize = 125`, `snapToGraphGrid()`.
- The grid is drawn screen-space on `.story-edit-graph-grid`; its
  `background-position`/`background-size` are set inline to track the transform
  and **offset by half a cell** (`view.x - GRID*k/2`) so a snapped corner lands
  on a dot, not between dots. Both the snap math and the dots read `25`.

---

## 2. Editor dock — new files, replaces the per-panel repetition

### Before
- `story-workspace-shell.tsx` rendered **N `StoryTextPanel`s** in a CSS grid.
  **Each** panel repeated the source tabs (Passage / JavaScript / Stylesheet),
  the `Passages › Name` breadcrumb, and the `Harlowe 3.3` format badge. JS/CSS
  were *tabs inside every passage editor*. 3+ editors overlapped.

### After — `editor-dock.tsx`, `editor-window.tsx`, `editor-window-spec.ts`
- **Open buffers are modeled as windows**, not passage ids:
  `EditorWindowSpec = {kind:'passage', passageId} | {kind:'script'} | {kind:'stylesheet'}`.
  `editorWindowId(spec)` is the stable React key / focus id
  (`passage:<id>` | `script` | `stylesheet`).
- **`EditorDock`** renders story-level chrome **once** (an *Open editor*
  dropdown → selected passage / Story JavaScript / Story Stylesheet, the format
  badge, and an issue count) above an **adaptive tiling grid**:
  - full-width dock: 1 → full, 2 → side-by-side, **4 → 2×2**, odd counts → the
    last lone tile spans its row (`grid-column: 1 / -1`).
  - narrow Split column (`compact`): windows **stack vertically** and scroll.
  - **Drag a window titlebar to rearrange** (HTML5 DnD → `onReorder(from,to)`).
- **`EditorWindow`** is one self-contained buffer. Titlebar = drag grip · icon ·
  name · dirty dot · **find** · **✕ (top-right)** and *nothing else*. The
  passage subbar (tags, link/broken counts, Test/Reveal) lives **inside the
  passage window only**. JS/CSS windows are just the editor. It owns the
  debounced commit (`updatePassageTextCommand` / `updateStoryScriptCommand` /
  `updateStoryStylesheetCommand`) ported from the old panel.
- **JS & Stylesheet are singletons** (their id is constant, so re-opening
  focuses the existing window); **passages tile freely** (one window each;
  re-opening focuses it).

### State + handlers — `story-edit-route.tsx`
The route owns the dock state:
- `editorWindows: EditorWindowSpec[] | undefined` — `undefined` means *follow
  the selection* (the dock shows whichever passage is selected, so Split/Text
  still works without an explicit open). The first open/close/reorder
  materializes it into a concrete list.
- `activeWindowId` — the focused window.
- Handlers: `openEditorWindow`, `handleEditPassage`, `handleEditPassages`,
  `handleCloseEditorWindow`, `handleFocusEditorWindow`,
  `handleReorderEditorWindows`. Opening from graph mode switches to `split`.
  A passage deleted in the core is pruned from the list.

### Shell — `story-workspace-shell.tsx`
- Renders a single `<EditorDock>` inside `.story-edit-text-layer` (now a flex
  container, not an N-column grid). `dockWindows` resolves the
  follow-selection fallback; `dockSelections` maps per-passage-window
  `WorkbenchSelection` facts by window id.

---

## 3. Legacy modal removed (one editor surface)

Deleted entirely (the modal could appear *over* the workspace editor):
- `src/dialogs/passage-edit/` (PassageEditStack, PassageEditContents, css,
  mocks, tests)
- `addPassageEditors` / `removePassageEditors` (`src/dialogs/context/action-creators.ts`)
  and their barrel exports in `src/dialogs/index.ts` and
  `src/dialogs/context/index.ts`.

The action buttons (`route-actions/story-edit/passage/*`) already call
`onEditPassages(passages)`, which now flows to `openEditorWindow`. **Edit =
open/focus a workspace window. There is exactly one editor surface.**

The other dialogs (story details, JavaScript, Stylesheet, tags, import, search)
are untouched — only the passage-edit modal path was removed.

---

## 4. Keyboard & input model

| Input | Action |
|---|---|
| Wheel / trackpad | Zoom toward the cursor (continuous) |
| Shift + wheel | Pan horizontally |
| Drag empty canvas | Marquee-select |
| Space-drag · middle-drag · Pan tool (`H`) | Pan |
| `V` / `H` | Select tool / Pan tool |
| Click node | Select only that node |
| Shift / ⌘ / Ctrl + click node | Add / remove from selection |
| Drag node(s) | Move selection, snapped to the 25px grid |
| Double-click node | Open it in an editor window |
| Right-click node / canvas | Context menu (Edit / Test · New / Fit / Snap) |
| `+` / `=` , `-` | Zoom in / out at viewport center |
| `0` | Fit graph to window |
| Delete / Backspace | Delete selection (existing route handler) |

Graph keyboard handling lives in `story-graph-panel.tsx` (it ignores events
while typing in inputs and when ⌘/Ctrl is held). The old `use-zoom-shortcuts.ts`
and `use-zoom-transition.ts` were **deleted**.

---

## 5. Principles checklist (keep these true)

- [x] One transform, not scrolling. If you reach for `scrollLeft`, stop.
- [x] Zoom is cursor-anchored, continuous, un-animated per tick.
- [x] Selection has no side effect on the viewport (never auto-center).
- [x] Snap value === grid-dot spacing, one constant, dots on corners.
- [x] Say each fact once: story-level chrome on the dock chrome bar + status
      bar, never per window.
- [x] Scope decides placement: story-wide → dock chrome; per-passage → inside
      that passage's window.
- [x] JS & Stylesheet are singletons; passages tile freely.
- [x] Every window is closeable (✕ top-right) and draggable; layout adapts to
      its space.
- [x] One editor surface — no legacy modal.
- [x] Right-click acts where the cursor is.

---

## 6. Files touched

**Graph:** `story-graph-panel.tsx`, `graph-grid.ts`, `story-edit-route.css`
(graph world/grid/zoom cluster), removed `use-zoom-transition.ts` +
`use-zoom-shortcuts.ts`.

**Editor dock (new):** `editor-dock.tsx`, `editor-window.tsx`,
`editor-window-spec.ts`; `story-edit-route.css` (dock + window styles); removed
`story-text-panel.tsx` and the old `.story-edit-text-panel*` CSS.

**Wiring:** `story-edit-route.tsx`, `story-workspace-shell.tsx`.

**Modal removal:** deleted `src/dialogs/passage-edit/`,
`src/dialogs/context/action-creators.ts`; edited `src/dialogs/index.ts`,
`src/dialogs/context/index.ts`.

**i18n:** added `common.unsavedChanges`,
`routes.storyEdit.workspace.{openEditor,issueCount,noEditorsOpen,noEditorsOpenHint}`
to `public/locales/en-US.json`.

**Tests:** updated `story-graph-panel.test.tsx` (transform model),
`story-workspace-shell.test.tsx` (dock mock), `story-edit-route.test.tsx`,
`use-passage-change-handlers.test.tsx`; deleted the modal + text-panel tests.

---

## 7. Known follow-ups (out of scope here)

- The legacy `src/components/passage/passage-map/` + `marqueeable-passage-map`
  (an older map implementation) is **not used by the live route** and was left
  alone. It can be removed once confirmed dead.
- "New passage" from the toolbar still uses `useViewCenter` (a leftover that
  reads the outer container), so brand-new passages land near the origin rather
  than the current view center. Double-click / right-click "New passage here"
  place at the exact cursor point and are unaffected.
- The story-list "Open vs icon-only" duplicate button is in the story list, not
  the workbench, and was intentionally not touched.
