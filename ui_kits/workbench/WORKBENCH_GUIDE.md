# Workbench UX — what to change, and the principles to keep

This reference (`ui_kits/workbench/`) is a **working model** of how the
twine.rs workbench should behave. It is not the product — it is the target.
Open `index.html`, drive it, and copy the *behavior*. Below: what changes
from the current build, why, and the rules that must hold afterward.

---

## 0. The one idea behind all of it

> **Pan and zoom are a single CSS transform on one "world" layer.
> Story-level chrome appears once. Passage-level chrome lives in the
> passage window. Snap targets and grid dots are the same number.**

Almost every bug in the thread is a violation of one of those three
sentences. Fix the structure and the symptoms disappear together.

---

## 1. Graph navigation

### What it does now (the jank)
- Zoom is a `scrollLeft/scrollTop` animation that keeps the **viewport
  centre** fixed (`use-zoom-transition.ts`). So zoom "loses the focus point
  of where I'm scrolling from."
- That animation runs over 0.5 s and **fights the next wheel event** →
  "janks in then janks out", "jitters around".
- The wheel **scrolls and zooms at the same time** → "moves up/down as well
  as zoom in/out."
- Panning is real scrolling, so **scrollbars grow/shrink** and you "can't
  easily scroll back."
- The grid is a fixed background on the viewport, so it **doesn't move when
  you scroll.**
- Snap was `26px` while the grid drew `25px` → "passages don't align to the
  dots / they seem off."
- Selecting a node **auto-centres it** → "jumps up and to the right", "jiggle
  near the edge", arrows redraw disturbingly.

### What it does here (the fix)
- **One transformed world.** Grid, edges and nodes all live inside
  `.gm__world` with `transform: translate(x,y) scale(k); transform-origin:0 0`.
  Pan changes `x,y`. Zoom changes `k`. **No scrolling, no scrollbars, no
  animation loop.** Edges never "redraw" on selection — they ride the same
  transform.
- **Cursor-anchored zoom.** Wheel zooms toward the pointer by keeping the
  world point under the cursor pinned:
  ```js
  const wx = (mouseX - x) / k,  wy = (mouseY - y) / k;   // world point under cursor
  const k2 = clamp(k * Math.exp(-deltaY * 0.0016));      // continuous, frame-perfect
  x = mouseX - wx * k2;  y = mouseY - wy * k2;            // re-pin it
  ```
  Continuous factor (no 3 fixed sizes), so it's smooth and never overshoots.
- **Selection never moves the graph.** Clicking selects; that is *all* it
  does. No centring, no jiggle. (Provide an explicit "Reveal in graph" /
  "Fit" that animates `x,y,k` directly — never a scroll side-effect.)
- **Snap == grid.** Both come from one constant `GRID = 25`. Dots are offset
  by half a cell so a snapped corner lands **on a dot**, not between dots.
- **Drag is screen-delta ÷ zoom**, snapped on the way:
  `world += (screenDelta) / k`, then `round(v / 25) * 25`.

### Graph input model (document this for users)
| Input | Action |
|---|---|
| Wheel / trackpad pinch | Zoom toward the cursor |
| Shift + wheel | Pan horizontally |
| Drag empty canvas | Marquee-select |
| Space-drag, middle-drag, or Pan tool (`H`) | Pan |
| Click node | Select only that node |
| **Shift / ⌘ / Ctrl + click node** | Add / remove from selection |
| Drag node(s) | Move selection, snapped to grid |
| Double-click node | Open it in an editor window |
| Right-click | Context menu (see §3) |

---

## 2. Editor windows — "make multiple just work"

### What it does now (the mess)
- Editors open in a fixed row and **overlap / get unusable** with 3+.
- **Every window repeats** the story format ("Harlowe 3.3"), the
  `Passages › Hello` breadcrumb, and a duplicated JavaScript/Stylesheet tab —
  none of which is per-passage.
- **Edit re-opens the old modal** editor on top of the workspace editor.
- The close affordance isn't where you reach for it.

### What it does here (the pattern)
- **Adaptive tiling grid**, not a strip:
  - Wide (Text mode): 1→full, 2→side-by-side, **4→2×2**, 3/5→last tile spans
    its row so there's never a ragged gap.
  - Narrow (the Split column): windows **stack vertically** and scroll,
    because width is the scarce axis there. Same component, space-aware.
- **Each window is self-contained and closeable.** Title bar = drag grip ·
  icon · name · dirty dot · **find** · **✕ (top-right)**. Nothing else.
- **Drag the title bar to rearrange** tiles.
- **Scope is enforced, not repeated:**
  - *Story-level* (format, validate, "Open editor") appears **once**, on the
    dock chrome bar above the grid — and again in the status bar. Never per
    window.
  - *Passage-level* (tags, link/broken counts, the broken-link quick-fix)
    appears **only inside a passage window**.
  - **JavaScript and Stylesheet are story singletons** — opening one focuses
    the existing window instead of making a second copy. **Passages** open as
    many windows as you like (one per passage; re-opening focuses it).
- One editor surface. **Delete the legacy modal path** from graph/edit so it
  can never appear over the workspace editor again.

---

## 3. Right-click context menu (replaces the edit toolbar)

- **On a node:** Edit passage / Edit *N* passages · Test from here · Rename ·
  Delete.
- **On empty canvas:** New passage here · Fit graph to window · Snap to grid.

This is faster than a fixed toolbar and puts actions where the cursor is.

---

## 4. Keyboard shortcuts

| Key | Action |
|---|---|
| `⌘/Ctrl + K` | Command palette |
| `V` / `H` | Select tool / Pan tool |
| `Space` (hold) | Temporary pan |
| Shift / ⌘ / Ctrl + click | Add to selection |
| `Enter` | Open selected passage(s) in editors |
| `⌘/Ctrl + W` | Close active editor window |
| `Delete` / `Backspace` | Delete selection |
| `⌘/Ctrl + F` | Find in the focused window |
| Wheel | Zoom to cursor · Shift+Wheel pans |

---

## 5. Wiring it into twine.rs (file by file)

1. **`graph-grid.ts`** — single source of truth: `GRID = 25`. Feed it to the
   snap math **and** to the CSS that draws the dots (offset the dot pattern by
   half a cell). Never hard-code `26` anywhere.
2. **`story-graph-panel.tsx`** — replace scroll-based pan + `useZoomTransition`
   with a transformed world (`translate/scale`, origin `0 0`). Wheel handler =
   the cursor-anchored formula in §1. Delete auto-centre-on-select. Keep
   "Reveal/Fit" as a direct `x,y,k` set.
3. **Retire `use-zoom-transition.ts`** for the graph (the scroll-centre
   animation is the root of the jitter).
4. **The editor dock** — render open buffers into the adaptive grid
   (`EditorDock.jsx` here is the spec). Title bar carries only per-buffer
   controls; hoist format/validate to the dock chrome. JS/CSS = singletons,
   passages = one window each.
5. **Remove `PassageEditStack` (the modal)** from every story-edit path. Edit
   = open/focus a workspace window. There is exactly one editor surface.
6. **Preferences must actually re-render** — theme, tag display and
   snap-on/off should flow from prefs into the graph + editor on change.

---

## 6. Principles to adhere to (the checklist)

- [ ] **One transform, not scrolling.** Pan/zoom mutate `x,y,k` on a single
      world layer. If you reach for `scrollLeft`, stop.
- [ ] **Zoom is anchored to the cursor**, continuous, and un-animated per
      tick. No transition that the next wheel event has to fight.
- [ ] **Selection has no side effects on the viewport.** Never auto-centre.
- [ ] **Snap value === grid-dot spacing**, from one constant, dots on corners.
- [ ] **Say each fact once.** Story-level chrome appears once; never per
      passage window.
- [ ] **Scope decides placement.** Story-wide → dock chrome / status bar.
      Per-passage → inside that passage's window.
- [ ] **JS & Stylesheet are singletons; passages tile freely.**
- [ ] **Every window is closeable (✕ top-right) and draggable; layout adapts
      to the space it's in.**
- [ ] **One editor surface.** No legacy modal, ever, over the workspace.
- [ ] **Right-click acts where the cursor is.**

If a change keeps every box ticked, it's aligned with this reference.
