# twine.rs Design System

A unique, professional **dark-mode workbench** design system for `twine.rs` — an
in-progress Rust/Tauri port of [Twine](https://twinery.org) (the interactive-fiction
authoring tool). It dresses a serious creative IDE that is **text-native, graph-native,
and synchronized**, while staying recognizably a Twine descendant.

> Not a marketing site, not a toy clone. Quiet, fast, dense enough for 50k-passage
> projects, and still welcoming to writers.

---

## Sources

This system was built from the local planning materials available when the package was created:

- **Codebase:** `twine.rs/` — the legacy `twinejs` React/TypeScript app being used for reference.
  Mounted read-only. Key references read while building this system:
  - `twine.rs/src/styles/{colors,typography,metrics,depth}.css` — the legacy token system (Nunito, blue/green logo hues, oklch palette).
  - `twine.rs/icons/logo.svg`, `app-release.svg` — the twine mark (blue→green sweep).
  - `twine.rs/src/components/**` — confirmed the icon library is **Tabler Icons** (`@tabler/icons`).
- **Spec:** `uploads/TWINE_RS_UI_DOCUMENT.md` — the exhaustive target-UI document (screen
  goals, UI inventories, exact labels, desktop-vs-browser matrix). This drove every screen.
- **Brand DNA inherited:** the Twine logo gradient (blue → green) and the multi-hue
  semantic palette concept ("avoid a single-hue palette").

### Font substitution — please confirm

The legacy app shipped **Nunito Light**. To hit the "more professional, crisp" brief,
twine.rs deliberately moves to a sharper trio, loaded from **Google Fonts CDN**:

| Role | twine.rs | was |
|---|---|---|
| Display / brand | **Space Grotesk** | Nunito Light |
| UI / body | **Hanken Grotesk** | system font |
| Mono / code | **JetBrains Mono** | SFMono / system mono |

These are an intentional evolution, not a forced match. **If you'd rather keep Nunito,
or want self-hosted font files instead of the Google CDN, tell me and I'll swap them.**
(The compiler currently reports 0 `@font-face` rules because fonts load via a Google
`@import`; swapping to local woff2 files would make them first-class.)

---

## Content fundamentals

How twine.rs writes copy. It mirrors Twine's plain-language clarity but tightens it for an IDE.

- **Voice:** calm, precise, second person for instructions ("You can write and maintain a
  huge project…"), imperative for commands. Never breathless, never jargon-for-its-own-sake.
- **Commands are verbs, Title Case:** `New Passage`, `Save Layout`, `Reveal in Graph`,
  `Generate Layout`, `Export HTML`, `Keep Text-Only`, `Rebuild Indexes`. These are taken
  verbatim from the UI document — preserve them.
- **Labels are plain, not clever:** `Broken Links`, `Source-Only`, `Generated Layout`,
  `Unsaved Changes`, `Saved`, `Indexing`, `Ready`. A user should never have to decode a label.
- **Status is honest and specific:** "1 unsaved file", "37 broken links", "12,483 passages ·
  248,917 words" — real counts, monospace, never vague ("some issues").
- **Explanatory, not hand-holding:** keep beginner affordances (the friendly `[[like this]]`
  link placeholder) but add IDE power (autocomplete, diagnostics, quick fixes).
- **Casing:** Title Case for commands & menu items; Sentence case for descriptions and
  diagnostics; UPPERCASE (tracked) only for tiny eyebrow/section labels in docks.
- **No emoji.** No exclamation marks in product chrome. Numbers and code are monospace.
- **"I" vs "you":** the app never says "I". It addresses the author as "you" sparingly,
  mostly in empty states and onboarding; most chrome is just labels.

Examples (good): `Generate Graph Layout`, `Keep text-only`, `No saved graph layout`,
`This folder already contains files`, `Format compatibility unknown`.

---

## Visual foundations

The defining idea: a **cool-ink dark workbench**. Surfaces are near-neutral charcoal with a
faint blue-green undertone (oklch hue ~235–240) so every panel quietly echoes the twine
mark's gradient without ever reading as "blue UI". Color is spent only where it carries
meaning — selection, links, tags, diagnostics, build state.

- **Color & vibe.** Layered `--ink-0…5` surface ramp (deepest app gutter → raised popover)
  plus a near-black `--ink-void` for the graph canvas. Text is a 4-step ramp (`--tx-1…4`).
  The mood is dim, even, low-glare — comfortable for long writing sessions.
- **Accent.** The brand **blue→green twine gradient** (`--acc-twine`) is reserved for brand
  moments and the active mode underline. Solid `--acc-blue` is the single primary-action color;
  `--acc-green` is the secondary pole (Save Layout, success).
- **Semantic palette.** One hue per authoring concept so map layers stay legible when stacked:
  link=blue, tag=purple, variable=cyan, warning=amber, error=red, dirty=orange, saved=green,
  generated=teal, build=violet. Each has a `-soft` tint for fills/badges.
- **Type.** Space Grotesk (display) / Hanken Grotesk (UI, 13px base) / JetBrains Mono (code &
  numbers). Dense workbench scale; nothing below ~10.5px and only for status meta.
- **Spacing.** 4px base. Compact control rhythm (30px default button/input height, 44px command
  bar, 26px status bar). Generous only on the launcher / empty states.
- **Corners.** Small and crisp: 3–10px. `--r-pill` only for status dots, toggle tracks, and
  layer chips. Never large playful radii on chrome.
- **Borders.** Hairline-first. Three border strengths (`--line-1…3`); structure is drawn with
  1px dividers and luminance steps, not heavy outlines.
- **Elevation.** Dark UIs read depth through luminance + a tight ambient shadow plus a 1px inset
  top highlight (`--edge-hi`, "light from above"). Shadows are short and dark, never big soft
  blurs. Floating graph tools use `--shadow-pop`; modals use `--shadow-modal`.
- **Backgrounds.** No photographic imagery, no decorative gradients. The only "texture" is the
  graph canvas's subtle two-level **dot grid** (radial-gradient dots at 26px + 130px). Flat,
  intentional, quiet.
- **Transparency & blur.** Used sparingly: the command-palette scrim (`oklch(0 0 0/0.55)` + 2px
  blur), selection washes (`--sel-wash`), and `-soft` semantic tints. Not a glass aesthetic.
- **Focus & selection.** Bright blue 2px focus ring (`--glow-focus`) on every interactive
  control. Editor/marquee selection is a blue wash with a 1px outline. Strong, visible focus is
  a deliberate accessibility choice.
- **Motion.** Quick and unfussy — `--dur-1…4` (80–320ms), eased, **no bounce**. Hover/press are
  near-instant; panels and popovers get a short fade/scale. All durations collapse to 0 under
  `prefers-reduced-motion`.
- **Hover / press.** Hover lifts one ink step (e.g. `ink-4 → ink-5`) and brightens text/border;
  primary buttons brighten (`--acc-blue-hi`). Press darkens (`--acc-blue-lo`) and nudges 0.5px
  down. Quiet, physical, consistent.
- **Cards.** A "card" is `--ink-3` (or `--ink-2` for docks), a 1px `--line` border, `--r-md/lg`
  corners, `--shadow-card` + `--edge-hi`. Passage nodes add a top accent bar and, for the start
  passage, the twine gradient rail. No left-border-accent-only cards. No emoji cards.
- **Layout rules.** Fixed workbench chrome: top command bar, left activity rail + dock, center
  mode surface, right inspector dock, bottom drawer, status bar. Everything scrolls inside docks;
  chrome never reflows. Toolbars collapse to menus before they wrap.

---

## Iconography

- **Library: [Tabler Icons](https://tabler.io/icons)** — inherited directly from the codebase
  (`@tabler/icons` is imported throughout `twine.rs/src`). 1.75px stroke, rounded joins,
  24px grid. This is the single icon system; do not mix in other sets.
- **In code (React):** `import { IconFileText } from '@tabler/icons-react'`.
- **In these design-system files (HTML/cards/kits):** the **Tabler webfont** via CDN —
  `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.31.0/dist/tabler-icons.min.css">`
  then `<i class="ti ti-file-text"></i>`. Every twine.rs component takes Tabler icon **names**
  (without the `ti-` prefix) for its `icon` props, e.g. `<Button icon="package-export">`.
- **No emoji**, ever, in product chrome. **No hand-drawn SVG icons** — use Tabler. The only
  bespoke SVG is the brand mark and small structural diagram art (graph edges, minimap dots).
- **Common glyphs** (from the UI doc): `file-text` (passage), `binary-tree` (graph),
  `layout-columns` (split), `search`, `files`, `tags`, `variable`, `photo` (assets),
  `player-play` (play), `tool` (test), `package-export` (export), `command`, `unlink`
  (broken link), `alert-triangle`/`alert-octagon` (diagnostics), `rocket` (start passage),
  `device-floppy` (save), `grid-dots` (snap).
- **Assets on disk:** `assets/twine-mark.svg` (primary mark, blue→green sweep),
  `assets/app-release.svg` (dark app icon), `assets/app-preview.svg` (graph-style icon).
  All copied from the codebase; safe on dark surfaces.

---

## Index / manifest

**Root**
- `styles.css` — global entry point (import-only). Consumers link this.
- `readme.md` — this file.

**`tokens/`** (all `@import`ed by `styles.css`)
- `colors.css` — surface ramp, text, brand accents, the twine gradient, semantic roles + tints.
- `typography.css` — font stacks (Space Grotesk / Hanken Grotesk / JetBrains Mono), scale, weights.
- `spacing.css` — 4px spacing scale, control sizing, chrome dimensions, radii.
- `elevation.css` — shadows, edge highlight, focus/accent glow, motion (eases + durations).
- `base.css` — element defaults, scrollbars, selection, eyebrow helper.

**`guidelines/`** — foundation specimen cards (Design System tab): surfaces, text, brand accents,
semantic roles, semantic tints, display/UI/mono type, type scale, spacing scale, radii,
elevation, the mark, focus & selection, iconography.

**`components/`** — reusable React primitives (namespace `window.TwineRsDesignSystem_073217`).
- `forms/` — `Button`, `IconButton`, `Input`, `Select`, `SegmentedControl`, `Switch`, `Checkbox`.
- `feedback/` — `Badge`, `Tag`.
- `data/` — `PassageNode` (graph card), `Panel` (dock/inspector container).
- Each component ships `.jsx` + `.d.ts` + `.prompt.md`; each directory has one `@dsCard` demo.

**`ui_kits/`** — full-screen product recreations. A shared `ui_kits/nav.js` renders the
cross-screen **activity rail** (`window.TwineRail`) that links every screen together; each
screen carries `<TwineRail active="…" />` as its leftmost column.
- `workbench/` — the signature **Split / Text / Graph** workbench: top command bar, activity
  rail, file tree, syntax-highlighted source editor, native graph canvas (toolbar, layers,
  minimap, generated-layout status), right outline/inspector, bottom diagnostics drawer,
  status bar, and a ⌘K command palette. Files: `index.html`, `Shell` (in index), `TextMode.jsx`,
  `GraphMode.jsx`, `CommandPalette.jsx`, `data.js`, `workbench.css`.
- `launcher/` — the **Project Launcher**: left library rail, table & card views with project
  health (mode, format, passages, words, broken links, Git, backup), storage card, import/new.
- `contents/` — the **Contents Navigator**: indexed table of contents for huge projects —
  type rail (Passages/Tags/Variables/Assets/Scripts/Styles/Groups) + problem groups (Broken
  Links/Orphans/Duplicates/Missing/Unreachable), filterable row list, and a passage inspector.
- `settings/` — the **Settings** screen: left settings nav (General…About) and grouped controls
  (editor typography & authoring, modes & graph, accessibility, storage & backups) built from
  the form primitives — reliability and accessibility surfaced, not buried in dialogs.
- `diagnostics/` — the **Diagnostics** panel: severity + type filters, grouped issue list, and a
  detail pane with explanation, offending source span, and a proposed Fix.
- `assets/` — the **Asset Manager**: folder/issue rail, asset grid with preview thumbnails and
  missing/unused flags, and a preview pane with metadata, insert snippet, and usage list.
- `formats/` — the **Story Formats** manager: filters, format cards with typed capability badges
  (Parser/Exporter/Autocomplete/Diagnostics/Proofing/Editor Extensions), and a detail/validate
  pane — including the user's custom Saltmarsh Harlowe fork.
- `new-project/` — **New Project / Import**: a source-first New Project form with a live
  files-to-be-written preview, toggling to a transparent, non-destructive Import & Migration
  Review (source files, detected stories, conflict decisions).
- `build/` — **Build, Export & Publish**: target list (Play/Test/Proof/Validate/Export HTML/Twee/
  JSON/Package/Publish), target detail with visible blockers, output options, and a streaming log.

---

## Using it

Consumers link one file and read components off the global namespace:

```html
<link rel="stylesheet" href="styles.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.31.0/dist/tabler-icons.min.css">
<script src="_ds_bundle.js"></script>
<script>
  const { Button, SegmentedControl, PassageNode, Badge } = window.TwineRsDesignSystem_073217;
</script>
```

Build on the cool-ink surfaces, spend semantic color only where it means something, keep chrome
dense and labels plain, and reach for the Split workbench as the north-star layout.
