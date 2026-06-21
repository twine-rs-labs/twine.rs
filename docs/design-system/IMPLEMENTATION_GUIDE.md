# twine.rs — Implementation Guide

How to take this design system from these HTML/JSX artifacts into the real
**Rust + Tauri** application. Pair this with `readme.md` (the design guide:
content voice, visual foundations, iconography) — this file is the *engineering*
handoff.

- [1. What's in the package](#1-whats-in-the-package)
- [2. Consuming the design system](#2-consuming-the-design-system)
- [3. Fonts](#3-fonts)
- [4. Icons (Tabler)](#4-icons-tabler)
- [5. Token reference](#5-token-reference)
- [6. Component API](#6-component-api)
- [7. The workbench shell](#7-the-workbench-shell)
- [8. Screen-by-screen → spec & Rust crates](#8-screen-by-screen--spec--rust-crates)
- [9. Accessibility & motion](#9-accessibility--motion)
- [10. Production checklist](#10-production-checklist)

---

## 1. What's in the package

```
twine.rs-design-system/
├── gallery.html              ← START HERE — links every screen & doc
├── readme.md                 ← design guide (voice, foundations, iconography)
├── IMPLEMENTATION_GUIDE.md   ← this file
├── styles.css                ← global entry point (import-only)
├── tokens/
│   ├── colors.css            ← surfaces, text, accents, semantic roles + tints
│   ├── typography.css        ← font stacks, type scale, weights
│   ├── spacing.css           ← 4px scale, control sizing, radii, chrome dims
│   ├── elevation.css         ← shadows, edge highlight, glows, motion
│   └── base.css              ← element defaults, scrollbars, selection
├── assets/                   ← twine-mark.svg, app icons (blue→green sweep)
├── components/
│   ├── forms/    Button · IconButton · Input · Select · SegmentedControl · Switch · Checkbox
│   ├── feedback/ Badge · Tag
│   └── data/     PassageNode · Panel
│       (each: <Name>.jsx + <Name>.d.ts + <Name>.prompt.md + one *.card.html demo)
├── ui_kits/
│   ├── nav.js                ← shared activity rail (window.TwineRail) linking all screens
│   ├── workbench/            ← Split/Text/Graph IDE (GraphMode/TextMode/CommandPalette + data.js)
│   ├── launcher/  contents/  diagnostics/  assets/
│   ├── formats/   new-project/  build/  play/  settings/
├── guidelines/               ← foundation specimen cards (@dsCard)
└── _ds_bundle.js             ← compiled component runtime (generated)
```

The screens are **high-fidelity recreations**, not production code — pixel-accurate
visuals and interaction patterns to build against, with mock data inline.

---

## 2. Consuming the design system

Three things to load, in order:

```html
<!-- 1. tokens + base styles (one file, pulls in everything under tokens/) -->
<link rel="stylesheet" href="styles.css" />

<!-- 2. icon webfont (or use @tabler/icons-react in a real React app — see §4) -->
<link rel="stylesheet"
  href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.31.0/dist/tabler-icons.min.css" />

<!-- 3. the component runtime, then read components off the namespace -->
<script src="_ds_bundle.js"></script>
<script>
  const { Button, SegmentedControl, PassageNode, Badge, Panel } =
    window.TwineRsDesignSystem_073217;
</script>
```

In the **real Tauri app** you won't use `_ds_bundle.js` — you'll port the component
source (`components/**/<Name>.jsx`) into your build (Vite + React, the same stack the
legacy app uses) and import the CSS token files directly. The components depend only on
React and the CSS custom properties; no other runtime deps.

> **Namespace note:** `TwineRsDesignSystem_073217` is the compiler-generated global for
> these preview cards. In your app you'll `import { Button } from '@twine/ui'` instead —
> the namespace is a preview artifact, not part of the production API.

---

## 3. Fonts

| Role | Family | Use |
|---|---|---|
| Display | **Space Grotesk** | brand, screen titles, mode labels (`--font-display`) |
| UI | **Hanken Grotesk** | all interface text, 13px base (`--font-ui`) |
| Mono | **JetBrains Mono** | source, paths, IDs, numeric data (`--font-mono`) |

These replace the legacy **Nunito Light** for a sharper, more professional feel
(confirmed with the team). The previews and app self-host the fonts from local `woff2`
files through `tokens/typography.css`:

```css
@font-face { font-family: 'Space Grotesk'; src: url('./fonts/SpaceGrotesk-Medium.woff2') format('woff2');
  font-weight: 500; font-display: swap; }
/* …repeat for each weight/family… */
```

Self-hosting makes the fonts first-class to the compiler (it reads `@font-face`
from the token closure) and removes a network dependency at startup.

---

## 4. Icons (Tabler)

The legacy codebase already uses `@tabler/icons` — keep it.

- **React app:** `import { IconFileText } from '@tabler/icons-react'`. Every component
  here that takes an `icon` prop expects a **Tabler name without the `ti-` prefix**
  (`<Button icon="package-export">`). In your port, map that to the React icon, or keep
  the webfont approach.
- **HTML/previews:** the Tabler **webfont** — `<i class="ti ti-file-text"></i>`.
- **Never** hand-roll SVG icons or use emoji in product chrome.

Common glyphs are catalogued in `readme.md` → Iconography.

---

## 5. Token reference

All tokens are CSS custom properties on `:root` (the system is dark-only). Highlights:

**Surfaces** — `--ink-0` (app gutter) → `--ink-5` (popover); `--ink-void` (graph canvas).
Aliases: `--bg-app · --bg-dock · --bg-panel · --bg-card · --bg-raised · --bg-pop · --bg-canvas`.

**Text** — `--tx-1` (primary) → `--tx-4` (faint); aliases `--text-strong/body/muted/faint`.
`--tx-on-accent` for text on bright fills.

**Borders** — `--line-1` (faint) · `--line-2` (default) · `--line-3` (strong).

**Brand** — `--acc-blue` (primary action) + `-hi`/`-lo`/`-soft`; `--acc-green` (secondary
pole) + `-hi`/`-soft`; `--acc-twine` (the blue→green gradient — brand moments & active-mode
underline only); `--focus-ring`.

**Semantic roles** (one hue per concept, each with a `-soft` tint):
`--sem-link · --sem-tag · --sem-var · --sem-warn · --sem-error · --sem-dirty · --sem-saved
· --sem-generated · --sem-build`. Selection: `--sel-wash` / `--sel-line`.

**Spacing** — `--sp-1…12` (4px base). **Controls** — `--ctl-h` (30px default), `--ctl-h-sm/lg`.
**Chrome** — `--bar-h` (44) · `--statusbar-h` (26) · `--dock-w` (264) · `--rail-w` (48).
**Radii** — `--r-xs…xl` (3–14px) + `--r-pill`.

**Elevation** — `--shadow-sm/card/pop/modal`; `--edge-hi` (1px inset top highlight, add to
raised surfaces); `--glow-focus` (2px blue ring); `--glow-accent`.

**Motion** — `--dur-1…4` (80–320ms, collapse to 0 under reduced-motion); `--ease-out`,
`--ease-in-out`, `--ease-snap`. Quick, eased, no bounce.

---

## 6. Component API

Read each component's `.prompt.md` for examples and its `.d.ts` for the full prop contract.
Quick map:

| Component | Group | Key props |
|---|---|---|
| `Button` | forms | `variant` (primary/default/ghost/danger), `size`, `icon`, `iconRight`, `loading`, `block` |
| `IconButton` | forms | `icon`, `label` (required — tooltip + a11y), `active`, `solid`, `size` |
| `Input` | forms | `label`, `icon`, `kbd`, `invalid`, `mono`, `block` + native input attrs |
| `Select` | forms | `options` (string\|{value,label}), `value`, `onChange`, `size`, `block` |
| `SegmentedControl` | forms | `options` ({value,label,icon}), `value`, `onChange` — the Text\|Graph\|Split switch |
| `Switch` / `Checkbox` | forms | `checked`, `onChange`, `label`; Checkbox adds `indeterminate` |
| `Badge` | feedback | `tone` (9 semantic roles), `icon`, `dot`, `mono` |
| `Tag` | feedback | `color` (named hue/CSS), `onRemove`, `onClick`, `hash` |
| `PassageNode` | data | `title`, `excerpt`, `tags[]`, `links`, `broken`, `start`, `selected`, `accent` |
| `Panel` | data | `title`, `icon`, `count`, `actions`, `pad`, `flush` — dock/inspector container |

All are self-contained: React + CSS custom properties only. Each injects its own scoped
stylesheet once per document (guard by `id`), so they're safe to drop anywhere.

---

## 7. The workbench shell

The workbench (`ui_kits/workbench/`) is the north-star layout and the trickiest to build.
Its structure, top to bottom:

```
┌ Top command bar (--bar-h): brand · path breadcrumb · [Text|Graph|Split] · Play/Test/Proof/Export · ⌘K
├ Mid (flex):
│   ├ Activity rail (window.TwineRail, 52px)  ← cross-screen nav
│   └ Center:
│       ├ Mode surface: TextMode / GraphMode / SplitMode
│       └ Bottom drawer: Diagnostics | Search | Build Output | Logs
└ Status bar (--statusbar-h): branch · save state · cursor · dirty · diagnostics · stats · format
```

**Mode surfaces** are the three projections of the one project model (see the UI document's
"Core Principle"). Wiring them to the Rust core:

- **Text ⇄ Graph sync** is the signature. Selecting a graph node opens its source; moving the
  cursor highlights the node; editing a `[[link]]` repaints edges. In `GraphMode.jsx` /
  `TextMode.jsx` these are driven by a shared `selected` passage id — in production replace
  that local state with a subscription to the Rust core's selection + patch stream.
- **Edits become commands** (`UpdatePassageText`, `MovePassages`, `RenamePassage`, …). The UI
  sends typed commands; the core returns **patches** (changed passages / edges / diagnostics /
  visible viewport items). Subscribe each pane to the slices it needs, not the whole story.
- **Graph rendering** here uses absolutely-positioned `PassageNode` cards + an SVG edge layer
  for ~10 nodes. For 10k–50k passages, swap to: virtualized cards (render visible only) + a
  **canvas/WebGL edge layer**, fed by a Rust viewport/spatial index ("what is visible here?").
  The card visual spec (size, accent rail, badges) stays identical.
- **Generated vs saved layout:** source-only projects get an in-memory generated layout; the
  `Generated Layout` badge + `Save Layout`/`Keep Text-Only` actions are already modeled. Only
  write `.twine/graph.json` on an explicit save.

---

## 8. Screen-by-screen → spec & Rust crates

Each screen maps to a UI-document section and the crates it leans on
(`twine_model/parse/graph/search/store/export`).

| Screen | UI doc section | Backed by |
|---|---|---|
| **Launcher** | Project Launcher | `twine_store` (project discovery, health, backups), Git probe |
| **Workbench** | Main Workspace Shell + Text/Graph/Split | all crates; patch stream + projections |
| **Text mode** | Text Mode | `twine_parse` (highlight, links), `twine_graph` (backlinks), diagnostics |
| **Graph mode** | Graph Mode | `twine_graph` + viewport/spatial index; canvas edge render |
| **Contents** | Contents Navigator | `twine_search` indexes (passages/tags/vars/assets), problem groups |
| **Diagnostics** | Diagnostics | `twine_graph` + format validators; quick-fix command application |
| **Assets** | Asset Manager | `twine_store` (asset files), reference scan, missing/unused detection |
| **Story Formats** | Story Formats | format manifest loader + typed capability flags; custom-fork health |
| **New Project / Import** | New Project + Import/Migration Review | `twine_store` scaffolding; `twine_parse` import; non-destructive review |
| **Build / Export** | Build, Export & Publish | `twine_export` targets; validate-before-export; streaming logs |
| **Play / Test** | Play, Test & Debug | runtime harness; var/history/console attached to source & graph |
| **Settings** | Settings | prefs store; surfaces accessibility (reduced motion / high contrast) |
| **Command Palette** | Command Palette | unifies commands/passages/files/tags across modes (⌘K) |

Round-trip and conflict rules (UI doc "Round-Trip Rules" / "Conflict Handling") are product
invariants the UI assumes: edits never reorder unrelated passages, unknown metadata is
preserved, and unresolved conflicts open a review panel rather than guessing.

---

## 9. Accessibility & motion

- **Focus is always visible** — `--glow-focus` (2px blue ring) on every interactive control.
  Don't remove outlines; the components already wire `:focus-visible`.
- **Reduced motion** — all `--dur-*` collapse to `0ms` under
  `@media (prefers-reduced-motion: reduce)`; the Settings screen exposes an explicit toggle too.
- **High contrast** — a Settings toggle is modeled; back it by raising `--line-*` / `--tx-*`
  contrast (a `[data-contrast="high"]` scope is the natural extension point).
- **Touch targets** — controls are ≥24–30px; primary actions and the activity rail items are
  larger. Honor the legacy app's keyboard-first, screen-reader-friendly goals.
- **Labels over icons** — decisive commands are text-labelled; icon-only buttons always carry a
  `label` (tooltip + accessible name).

---

## 10. Production checklist

- [ ] Port `components/**/<Name>.jsx` + token CSS into the app's Vite/React build.
- [x] Self-host the three fonts; replace the Google `@import` in `tokens/typography.css`.
- [ ] Wire `@tabler/icons-react`; map component `icon` names to icon components.
- [ ] Replace mock screen state with subscriptions to the Rust core's patch/selection stream.
- [ ] Implement the virtualized + canvas/WebGL graph renderer behind the `PassageNode` visual spec.
- [ ] Back generated-vs-saved layout with `.twine/graph.json` written only on explicit save.
- [ ] Implement the command palette index (commands/passages/files/tags/diagnostics).
- [ ] Add the `[data-contrast="high"]` scope and verify reduced-motion paths.
- [ ] Keep the exact UI-document labels (Title-Case commands) — they're the product vocabulary.

Questions, or want any screen taken further (denser 50k states, a wired command palette across
every screen, or a real graph-virtualization prototype)? That's the natural next step.
