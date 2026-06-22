# twine.rs Design System Spine Milestones (D-Series)

This is the roadmap for making `docs/design-system/` the **actual UI of the
app**, not a prototype that the app loosely resembles. It is a dedicated track
that runs parallel to — and underneath — the feature roadmap in
[`TWINE_RS_MILESTONES.md`](./TWINE_RS_MILESTONES.md). The M-series adds
capability; the D-series replaces the chrome that capability is displayed in.

The non-negotiable goal, in the user's words: **passage editing must directly
look like the Workbench in `docs/design-system/ui_kits/workbench`**, and the
whole app must become the design system — launcher, screens, panels, dialogs,
previews — not a recolored legacy Twine.

## Prime Directive

> The design system is the source of truth. When the app and
> `docs/design-system/` disagree, the app is wrong.

Every D-milestone is "done" only when the corresponding screen is
**visually and structurally indistinguishable** from its design-system
artifact, built from app-owned DS primitives and DS tokens — not approximated
with legacy components that have been darkened.

## Pre-D0 Current Gap (snapshot, 2026-06-21)

Where the app was before this D-series started, so each milestone has a measured
starting line:

- **Global styling was still legacy.** The only global style import was
  [`src/app.tsx`](../../src/app.tsx) → `./styles/typography.css`, which defines
  Nunito Light + `--font-system` / `--font-monospaced`. The DS trio
  (Space Grotesk / Hanken Grotesk / JetBrains Mono) was **not** the app default.
- **DS tokens were not the base.** `docs/design-system/tokens/*.css`
  (`--ink-N`, `--line-N`, `--tx-N`, `--acc-*`, `--sem-*`, `--bg-app`…) only
  existed in the app as a _partial, route-scoped shim_
  ([`src/styles/workbench-tokens.css`](../../src/styles/workbench-tokens.css),
  [`src/styles/workbench.css`](../../src/styles/workbench.css)) that re-maps DS
  fonts back to legacy fonts.
- **Legacy color aliases are everywhere.** `var(--white)`, `var(--light-gray)`,
  `var(--gray)`/`var(--dark-gray)` and friends appear across **36 CSS files**
  under `src/` (see [`src/styles/colors.css`](../../src/styles/colors.css)).
- **DS components are prototypes only.** `docs/design-system/components/**` are
  preview JSX with `.d.ts` + `.prompt.md` contracts; there are no production
  equivalents the app imports.
- **The graph was the legacy path.** `StoryEditRoute` rendered
  `MarqueeablePassageMap` → `PassageMap` → `PassageCard`; D5 replaces that
  surface with DS `PassageNode` and the generated graph-projection contract.
- **Previews are isolated.** Play/Test/Proof go through
  [`src/store/use-story-launch.ts`](../../src/store/use-story-launch.ts) →
  [`src/util/replace-dom.ts`](../../src/util/replace-dom.ts) (rewrites the whole
  document) or a scratch HTML package in Electron. There is no app-owned,
  inspectable preview surface.
- **Core workflows live in dialogs.** App Prefs, Story Formats, Story Details,
  Import, JavaScript, Stylesheet, Search, Tags are all `src/dialogs/*`.

## Design-System → App Mapping

The fixed source-of-truth artifacts and where each one lands in the app:

| Design-system source                                                                         | Becomes (app)                                    | D-milestone |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------- |
| `tokens/{base,colors,typography,spacing,elevation}.css`                                      | `src/styles/design-system/` (global)             | D0          |
| `components/forms/*` (Button, IconButton, Input, Select, SegmentedControl, Switch, Checkbox) | `src/components/design-system/`                  | D1          |
| `components/feedback/*` (Badge, Tag)                                                         | `src/components/design-system/`                  | D1          |
| `components/data/*` (Panel, PassageNode)                                                     | `src/components/design-system/`                  | D1 / D5     |
| `ui_kits/workbench/index.html` + `data.js` (rail, command bar, dock, drawer, status bar)     | `AppShell` wrapping all routes                   | D2          |
| `ui_kits/workbench/CommandPalette.jsx`                                                       | App-wide command palette                         | D2          |
| `ui_kits/launcher/index.html`                                                                | replaces `routes/welcome` + `routes/story-list`  | D3          |
| `ui_kits/new-project/index.html`                                                             | replaces `dialogs/story-import` new-project flow | D3          |
| `ui_kits/workbench/TextMode.jsx`                                                             | `routes/story-edit` Text mode + source editor    | D4          |
| `ui_kits/workbench/GraphMode.jsx` + `components/data/PassageNode`                            | replaces `passage-map`/`passage-card`            | D5          |
| `ui_kits/contents/`                                                                          | promotes Contents Navigator                      | D6          |
| `ui_kits/diagnostics/index.html`                                                             | Diagnostics screen/panel                         | D6          |
| `ui_kits/assets/index.html`                                                                  | Asset Manager screen                             | D6          |
| `ui_kits/formats/index.html`                                                                 | replaces `dialogs/story-formats`                 | D6          |
| `ui_kits/build/index.html`                                                                   | Build & Export screen                            | D7          |
| `ui_kits/settings/index.html` + `settings.css`                                               | replaces `dialogs/app-prefs`                     | D7          |
| `ui_kits/play/index.html`                                                                    | replaces `replace-dom` preview path              | D8          |

## Sequencing

D0 → D1 → D2 are the **spine** and are strictly ordered: tokens before
primitives before shell. After D2, screen migrations D3–D8 can proceed
mostly in parallel (each is an independent screen), with D4/D5 being the
highest-value pair for the stated goal (passage editing = the Workbench).
D9 (enforcement) starts as soon as D0 lands and tightens as each screen
migrates.

**Relationship to the M-series:** the D-series should be the next real product
push. M7 (Preferences/Platform) and any further M-work must build _on the DS
shell_, not add new legacy chrome. The M6 preview/debug handoff is satisfied by
D8, and the M6 graph-projection requirement is satisfied by D5.

## M6 ↔ D-series closure map

M6 (Story Formats, Build, Test, Publishing) is **partially done** and is closed
out _by_ the D-series rather than as a standalone push. Its engine (Rust
contracts + the TS data layer) is largely in place, and the 2026-06-21 M6/D6
closure passes promoted the primary Formats, Build, Contents, Diagnostics, and
Assets surfaces into DS shell routes. The capability manifest and publish-safety are done, and the
graph-projection DTO/command contract
(`CoreGraphProjection`, `queryGraphProjection`, `graphProjectionUpdated`) plus
the asset/command contracts (`importAsset`, `insertAssetSnippet`,
`renameAsset`, …) are generated from Rust and host-wired. The current renderer
projection is a TypeScript parity bridge that implements the generated contract;
a native/WASM runtime `ProjectSession` bridge is still a core follow-up. What
remains is deeper integration and retiring compatibility surfaces:

| M6 item                              | Status                                                                                                                                                     | Closed by            |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Capability manifest (1)              | done (engine); surfaced in `/formats` and `/stories/:storyId/build`                                                                                        | D6/D7 polish         |
| Format host API (2)                  | partial — types/loader/resolver done; `/formats` is now the primary capabilities/modules/defaults/proofing/extensions route                                | D6 + engine plumbing |
| Local format dev workflow (3)        | partial — dev metadata and URL-add surfaced                                                                                                                | D6 + engine plumbing |
| Build / export / package targets (4) | partial — package builder plus `/stories/:storyId/build` for Play/Test/Proof/HTML/Twee/JSON/Package/Publish/Compatibility/Inspect                          | D7 advanced policy   |
| Runtime/debug hooks (5)              | partial — preview debug strip plus current-passage bridge, logs, viewport presets, and source/graph reveal actions; variables/state/devtools still missing | D8                   |
| Publish-safety (6)                   | done (engine); surfaced in Build/Formats routes                                                                                                            | D7 polish            |
| H1 previews on host/query            | partial — app-owned iframe routes with live debug bridge; desktop scratch-window parity and richer runtime inspection remain                               | D8                   |
| H2 graph projection                  | D5 done on the app side; native/WASM host bridge still follow-up                                                                                           | D5 + core bridge     |
| H3 run-from-here                     | partial (`startId` plumbed; not everywhere)                                                                                                                | D4 / D5 / D8         |

**Do not build M6's UI in legacy chrome.** Finish the remaining gaps
(archive/project-folder packaging, full format-dev reload loop, runtime state
inspection, and diagnostics-grade build warnings) as core-first or DS-shell work; let D5–D8
finish the surrounding screens. The engine half is tracked in
[`TWINE_RS_MILESTONES.md`](./TWINE_RS_MILESTONES.md) (M6 section).

---

## D0: Design System Foundation — Tokens, Fonts, and the Compatibility Bridge

Make the design-system tokens and fonts the **global base** of the app, and
install a temporary, clearly-flagged bridge so unmigrated legacy screens keep
rendering while the rest of the D-series proceeds.

Source artifacts: `docs/design-system/tokens/*.css`,
`docs/design-system/styles.css`.

Core deliverables:

- Create `src/styles/design-system/` as app-owned copies of `base.css`,
  `colors.css`, `typography.css`, `spacing.css`, `elevation.css`. These are
  owned by the app; the `docs/` versions remain the spec to diff against.
- **Self-host the fonts.** Replace the Google Fonts `@import` in `typography.css`
  with locally bundled `woff2` for Space Grotesk, Hanken Grotesk, and
  JetBrains Mono (follow the existing `@font-face` pattern for
  `nunito-light.woff2`). The app must render the correct fonts offline and in
  Electron with no network dependency.
- Import the DS tokens at the app root in [`src/app.tsx`](../../src/app.tsx)
  **before** any route CSS, so `--bg-app`, `--ink-*`, `--tx-*`, `--font-ui`,
  `--font-display`, `--font-mono` are globally available. The app is dark-first
  (`color-scheme: dark`), matching the DS.
- **Compatibility bridge:** re-point the legacy aliases in
  [`src/styles/colors.css`](../../src/styles/colors.css) and
  [`src/styles/typography.css`](../../src/styles/typography.css)
  (`--white`, `--light-gray`, `--gray`, `--dark-gray`, `--font-system`,
  `--font-monospaced`, …) to the closest DS token. This is a _throwaway_ layer:
  it keeps the 36 legacy CSS files alive during migration, and every mapping is
  marked for deletion in D9. No new code may use a legacy alias.
- Retire the route-scoped `workbench-tokens.css` font re-mapping (it currently
  maps DS fonts _back_ to legacy) — fold its useful parts into the global base.

Exit criteria:

- App boots with DS tokens + DS fonts globally; no CDN font dependency.
- Legacy-aliased screens still render (recolored via the bridge) and nothing is
  visually broken.
- A single source of truth for tokens; `docs/` vs `src/` token diff is empty.

Depends on: nothing. This is the foundation.

## D1: Production DS Primitives — the Component Library

Turn the prototype components into a real, typed, tested component library the
whole app imports from one place.

Source artifacts: `docs/design-system/components/{forms,feedback,data}/*`
(each has `.jsx` + `.d.ts` + `.prompt.md`).

Core deliverables:

- Port to `src/components/design-system/`: `Button`, `IconButton`, `Input`,
  `Select`, `SegmentedControl`, `Switch`, `Checkbox` (forms); `Badge`, `Tag`
  (feedback); `Panel` (data). `PassageNode` is ported here but wired in D5.
- Honor the `.d.ts` prop contracts exactly; use the `.prompt.md` files as the
  behavioral spec. Each component gets unit tests and a specimen/story.
- Standardize on **Tabler icons** for `IconButton` and all iconography, matching
  the DS guideline cards.
- Replace ad-hoc app primitives (legacy `components/control/*`, `components/badge`,
  `components/tag`) by re-exporting or superseding them with DS components so
  there is exactly one Button, one Input, etc.

Exit criteria:

- Every DS component has a production, tested equivalent under
  `src/components/design-system/` with a rendered specimen that matches the DS
  card.
- A new screen can be built entirely from DS primitives with zero legacy
  controls.
- Legacy primitives remain only as compatibility shims inside unmigrated D6/D7
  dialogs and source-editor internals. No new D-series screen may import
  `components/control/*`, `components/container/card/*`, or legacy tag/badge
  primitives unless it is replacing that surface in the same change.

Depends on: D0 (tokens/fonts).

## D2: App Shell — the Product Frame

Build the persistent product frame from the Workbench kit and make it wrap every
route. This is what turns "a set of pages" into "one IDE".

Source artifacts: `docs/design-system/ui_kits/workbench/index.html`,
`data.js`, `CommandPalette.jsx`.

Core deliverables:

- An `AppShell` providing the DS anatomy: left **activity rail**, top **command
  bar** with breadcrumbs, optional right **dock**, bottom **drawer**, and
  bottom **status bar**. Routes render into the shell's center outlet.
- App-wide **command palette** (`CommandPalette.jsx`) reachable by keyboard from
  any screen, sourced from a command registry.
- Retire the per-route toolbar pattern (`components/route-toolbar`) in favor of
  shell-owned command bar slots and context actions.
- Status bar wired to real signals: dirty state, persistence-confirmed save
  status, current selection, build/preview state, diagnostics counts.

Exit criteria:

- Every route renders inside `AppShell`; rail + command bar + status bar are
  always present and consistent.
- The shell exposes route-owned toolbar and dock registration APIs; route-local
  docks are migration shims, not the long-term pattern.
- Command palette works app-wide and can invoke navigation + core commands.

Depends on: D0, D1.

## D3: Launcher & New Project

Replace the entry experience with the DS launcher and new-project flow.

Source artifacts: `ui_kits/launcher/index.html`,
`ui_kits/new-project/index.html`.

Core deliverables:

- Replace [`src/routes/welcome`](../../src/routes/welcome) and
  [`src/routes/story-list`](../../src/routes/story-list) with the DS launcher:
  project grid/list, recents, search, sort, project metadata, create/import
  entry points.
- Replace the new-project / import entry (currently
  `dialogs/story-import`) with the DS new-project screen as a real navigable
  flow, not a modal.

Exit criteria: launching the app lands on the DS launcher; creating/importing a
project uses the DS new-project screen; both are built from DS primitives.

Depends on: D2.

## D4: Workbench Story Editor — Text Mode (the headline goal)

Make passage editing **directly look like the Workbench Text mode**. This is the
milestone the whole project is being held to.

Source artifacts: `ui_kits/workbench/TextMode.jsx`, `workbench.css`.

Core deliverables:

- Rebuild [`src/routes/story-edit`](../../src/routes/story-edit) as the
  Workbench: Text / Graph / Split via DS `SegmentedControl`, with the center
  panel, left contents/file tree, right inspector, and bottom drawer all using
  DS `Panel` anatomy.
- Re-skin the source editor
  ([`src/components/control/source-editor`](../../src/components/control/source-editor),
  CodeMirror) to DS tokens/fonts: JetBrains Mono body, DS gutters, inline
  diagnostics, link/tag/variable highlighting using `--sem-*` colors.
- Text-native panels from the DS: outline, backlinks, outgoing links, variables,
  tags, diagnostics, and per-passage tabs with a crumb bar.
- Remove legacy `var(--white)`/`var(--font-system)` styling from
  `story-edit-route.css` and `source-editor.css`.

Exit criteria:

- A side-by-side of the running Text mode against `TextMode.jsx` is visually
  matching (layout, density, type, color, panels) and is attached as a visual
  artifact or screenshot pair before D4 is called complete.
- No legacy color/font aliases remain in the story-edit or source-editor CSS.

Audit artifact: [`visual-audits/D4_D5_AUDIT_2026-06-21.md`](./visual-audits/D4_D5_AUDIT_2026-06-21.md)
records the D4 screenshot pair and the D5 implementation checks.

Depends on: D2, D1.

## D5: Workbench Graph Mode — PassageNode + Rust Projection

Replace the legacy passage map with the DS graph, backed by the generated
Rust graph-projection contract so it can drive preview/reveal flows.

Source artifacts: `ui_kits/workbench/GraphMode.jsx`,
`components/data/PassageNode`.

Core deliverables:

- Replace `MarqueeablePassageMap` → `PassageMap` → legacy `PassageCard`
  ([`src/components/passage`](../../src/components/passage)) with DS `PassageNode`
  rendered in a DS GraphMode surface.
- Back the graph with `QueryGraphProjection` DTOs (visible nodes, edges,
  generated/saved layout, selection focus, viewport filtering, save-layout).
  Until the native/WASM `ProjectSession` bridge lands, the renderer uses the TS
  parity implementation and must keep Rust binding/parity tests green.
- Wire **Split mode** to bind Text + Graph per the Workbench.
- Graph visual states (broken link, self link, start, search highlight, tag
  indicators) use `--sem-*` tokens.

Exit criteria: graph mode renders DS `PassageNode`s from the projection
contract; reveal-in-graph works from text, search, and diagnostics; Split mode is
live; viewport/focus options are passed through the query boundary; generated
layout save flows through the host.

Implementation note (2026-06-21): the DS graph now includes immediate
pointer-down selection feedback, shift/ctrl/meta additive selection, group drag
from the current selection, live edge/arrow geometry while nodes move or resize,
actual passage-size edge anchors, rotated edge anchors for top-to-bottom /
right-to-left / bottom-to-top views, one-shot selection centering that no longer
fights ordinary scrolling, and a draggable minimap preview for graph navigation.
The graph surface has returned to a dot-grid map texture, and the default graph
card size is now a real Settings preference instead of a private route-local
value. A later pass moved dense edge rendering to Canvas2D and added a
10k-passage viewport-bounded projection test; 50k browser-level interaction
traces remain a core performance follow-up.

Depends on: D4; Rust `QueryGraphProjection`.

## D6: Contents, Diagnostics, Assets, and Formats as DS Screens

Promote the four data/inspection surfaces from embedded lists/dialogs into real
DS screens and panels.

Source artifacts: `ui_kits/contents/`, `ui_kits/diagnostics/index.html`,
`ui_kits/assets/index.html`, `ui_kits/formats/index.html`.

Core deliverables:

- **Contents** Navigator as a first-class DS panel (metadata, folders, sections,
  chapters, passages, tags, variables, assets) — not a dialog.
- **Diagnostics** as a DS screen/panel with severities, grouping, and quick-fix
  affordances (replacing inline lists).
- **Asset Manager** as a DS screen consuming the file-backed asset inventory
  (replacing prompt-driven asset actions).
- **Story Formats** manager as a DS screen replacing
  [`src/dialogs/story-formats`](../../src/dialogs/story-formats).

Implementation note (2026-06-21): D6's primary screens are now onscreen.
`/formats` is the primary DS shell screen for format capabilities, publish
safety, module/development metadata, defaults, proofing, editor extension
enablement, URL-added formats, and custom-format removal. The legacy Story
Formats toolbar entry now routes here instead of opening the dialog.
`/stories/:storyId/contents`,
`/stories/:storyId/diagnostics`, and `/stories/:storyId/assets` are also
first-class shell routes with rail/command-palette access. Contents consumes the
story index for passages, tags, variables, assets, scripts/styles, entry points,
orphans, and diagnostics; Diagnostics groups severities/types and exposes
quick-fix/reveal actions plus per-diagnostic dismissal/restore; Assets exposes
the reference-backed fallback plus host-known imported assets, and native
project folders can now scan their real `assets/` tree into that same index so
file metadata, image thumbnails/dimensions, missing/unused state, snippet
copy/insert, usage reveal, validation, and native rename/replace/delete all flow
through one Asset Manager surface. Dismissed diagnostics are
kept in a review lane and removed from active shell/build validation counts.
Unlinked passage diagnostics are warnings, not errors, because story formats may
still reach them through macros such as `(display: "passage")`, scripts, or
other runtime behavior. Remaining adjacent work is moving the renderer/Electron
asset scan behind the live Rust `ProjectSession`, adding import conflict and
publish-policy controls, deeper virtualization/perf for huge lists, and
app-owned UI for every future format extension slot.

Exit criteria: each of the four is a DS-built screen/panel reachable from the
shell, consuming host/query data, with no legacy dialog as the primary surface.

Depends on: D2; benefits from M4 (index) and M5 (asset inventory).

## D7: Build & Settings Screens

Replace the last two big dialog-bound workflows with DS screens.

Source artifacts: `ui_kits/build/index.html`, `ui_kits/settings/index.html`

- `settings.css`.

Core deliverables:

- **Build & Export** DS screen: targets (Play/Test/Proof/Export HTML/Twee/JSON/
  Package/Publish), capability report, missing-asset and publish-safety warnings
  surfaced before output (building on `createStoryBuildPackage`).
- **Settings** DS screen replacing [`src/dialogs/app-prefs`](../../src/dialogs/app-prefs):
  accessibility (reduced motion, high contrast, keybindings), editor prefs,
  default folders, integrations. (This is also where M7 prefs land — on the DS
  shell, not a dialog.)

Implementation note (2026-06-21): `/stories/:storyId/build` now exists as a DS
shell screen with Play, Test From Selection, Proof, Export HTML, Export Twee,
Export JSON, Package, and Publish targets, build/save/report actions,
capability/fidelity/output panels, missing-asset and publish-safety warnings, and
build output logs. A follow-up D7 pass added `/settings`, native story-library
folder controls, accessibility toggles, default project/asset folders, a
compatibility export target, source/HTML inspection targets, and project-fidelity
StoryData graph package carriers. The D7 Settings pass now presents the full
target section set — General, Workspace, Modes, Graph, Editors, Accessibility,
Keyboard, Storage, Backups, Story Formats, Build, Integrations, Platform, and
About — with native story-library controls, preferred editor mode, default graph
card size, generated-layout save behavior, default story/proofing formats, and
platform/storage status in the DS shell. Remaining advanced Build/Settings work
is streamed logs, archive/project-folder packaging beyond the current descriptor,
diagnostic promotion, deeper backup/revision-control automation, and fully
retiring the legacy App Prefs dialog compatibility surface.

Exit criteria: build and settings are DS screens; App Prefs dialog retired as a
primary path, with any remaining legacy compatibility surface isolated for
removal in D9.

Depends on: D2; build content from M6.

## D8: Preview & Debug Surface

Promote the app-owned preview routes into an inspectable preview/debug pane —
the M6 "fully functional GUI previews" deliverable.

Source artifacts: `ui_kits/play/index.html`.

Core deliverables:

- An app-owned preview surface (pane or DS-framed window) that hosts the built
  story. The browser Play/Test/Proof routes now use iframe previews; D8 finishes
  the Electron scratch-window path and the debugger/reveal bridge.
- A DS **debug strip**: current passage, variable/state inspection, logs,
  viewport controls, source reveal, graph reveal (via D5 projection),
  diagnostics, and asset inspection.
- "Run from here" from Text, Graph, Split, search results, diagnostics, and asset
  references, wired through `use-story-launch` + the build package, with
  source/graph reveal optional when graph metadata is absent.

Current implementation snapshot:

- Play/Test/Proof preview frames are app-owned iframe surfaces with debug strips
  for target, story, start passage, HTML/story-data status, story-index
  diagnostics, graph/link health, and asset health. Source, Graph, Build,
  Test From Start, and current-passage Test actions are exposed from the strip.
- Browser previews now inject a small app-owned debug bridge into `srcDoc`
  output. The bridge reports current passage best-effort across formats,
  viewport size/hash/scroll, console output, runtime errors, and DOM-driven
  passage changes back to the React preview frame. The strip can reveal the
  observed passage in Source/Graph, relaunch Test from the observed passage,
  reload the frame, and switch fit/desktop/tablet/phone viewport presets.
- Run-from-here is now native-aware through `useStoryLaunch()` from the text
  header, graph toolbar, split/right inspector, passage fuzzy-search result
  action, standalone Contents and Diagnostics inspectors, asset inspector first
  usage, and editor asset usage buttons.
- Remaining D8 closures are deeper runtime-to-editor inspection: variables/state,
  visited stack, format devtools panels, richer asset/runtime source reveal from
  inside the running story, and bringing the same bridge into the Electron
  scratch-window path instead of only browser `srcDoc` previews.

Exit criteria: Play/Test/Proof open inside the DS preview surface in both browser
and desktop contexts with a working debug strip; the app is never swapped out via
`replaceDom`.

Depends on: D2, D4, D5; M6 build package + capability report.

## D9: Dialog Policy + Adherence Gates (Enforcement)

Make the migration permanent and prevent drift. Starts at D0, tightens per
milestone, completes when the bridge is removed.

Core deliverables:

- **Dialog policy:** core workflows live in DS shell screens/panels; dialogs are
  reserved for confirmations and short interrupts. Audit `src/dialogs/*` and
  reclassify each as "migrated to screen" or "stays as confirmation".
- **Lint gate:** ban new `var(--white)`, `var(--light-gray)`, `var(--gray)`,
  `--font-system`, `--font-monospaced`, and CDN font imports in migrated
  directories (stylelint or a custom check in CI).
- **Visual regression:** screenshot each migrated screen against its
  `docs/design-system/ui_kits/*` artifact; fail CI on regression.
- **Remove the bridge:** once the last screen migrates, delete the D0
  compatibility aliases and the legacy `colors.css`/`typography.css` so the only
  tokens that exist are DS tokens.

Exit criteria:

- Zero legacy color/font aliases remain in `src/`.
- CI blocks new legacy tokens and visual regressions against the DS.
- The app _is_ the design system.

Depends on: rolls alongside D0–D8; finalizes after D8.

---

## Cross-Cutting GUI Requirements (the interaction layer)

The DS screens are not just layouts — they imply _behaviors_ that make a story
IDE usable. These cut across D1–D8 and are part of "fully online". Every one of
them is presentation in the DS UI but **fact + mutation in the Rust core**: the
UI calls a host command or reads a query; it never owns the model.

| Interaction                                                         | DS surface                              | Rust contract (command / query)                                      | D        | Speed note                                                                   |
| ------------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------- |
| **Insert asset into passage** (drag from Asset Manager, or pick)    | Editor + Asset Manager + `PassageNode`  | `insertAssetSnippet` / `assetInventory` for format-correct reference | D4/D6    | snippet built from inventory, no path guessing                               |
| **Paste image into editor**                                         | Source editor                           | `importAsset` → write to `assets/` → `insertAssetSnippet`            | D4/D6    | import off the UI thread; no base64 in source                                |
| **Inline asset preview**                                            | Editor gutter, `PassageNode`, inspector | `assetInventory` (thumb/dimensions/duration)                         | D4/D5/D6 | thumbnails lazy-loaded + cached, single inventory                            |
| **Asset rename/replace/delete updates references**                  | Asset Manager                           | `renameAsset` / `replaceAsset` / `deleteAsset` (reference-safe)      | D6       | reference rewrite computed in Rust, atomic                                   |
| **`[[` link autocomplete**                                          | Source editor                           | `QueryStoryIndex` passage titles                                     | D4       | index-backed, async, debounced                                               |
| **Create-on-broken-link** (quick fix)                               | Editor + Diagnostics                    | `CreatePassage` via quick-fix registry                               | D4/D6    | broken-link facts from Rust diagnostics                                      |
| **Rename passage updates all links** (incl. format-specific, #1060) | Editor, `PassageNode`, Contents         | `RenamePassage` (format-aware link rewrite)                          | D4/D5    | rewrite in Rust, one transactional patch                                     |
| **Backlinks / outgoing links / references**                         | Inspector panels                        | `QueryStoryIndex` backlinks/refs                                     | D4       | precomputed in index, not on render                                          |
| **Tag add/remove + colors + bulk**                                  | Header tag chips, Contents              | `SetTags` / bulk tag command                                         | D4/D6    | tag counts from index                                                        |
| **Variable / macro autocomplete + panel**                           | Editor, inspector                       | `QueryStoryIndex` symbols/variables                                  | D4       | incremental symbol extraction in Rust                                        |
| **Copy/paste/duplicate passages** (#540)                            | Graph + Contents                        | `CreatePassage` / clipboard command                                  | D5       | through commands so undo is transactional                                    |
| **Drag passage into folder/section/scope**                          | Contents, Graph                         | `MovePassage` / scope membership command                             | D5/D6    | scope membership is core metadata                                            |
| **Move/reposition node + Save Layout**                              | Graph                                   | `MovePassage` (position) / `SaveLayout`                              | D5       | ephemeral layout free; save writes `.twine/graph.json` only on explicit save |
| **Search + replace, reveal-in-source / reveal-in-graph**            | Command bar / Search panel              | `QuerySearch` + reveal                                               | D2/D4/D5 | ranked in Rust, cancellation-aware                                           |
| **Go to passage / command palette actions**                         | Command palette                         | command registry → host commands                                     | D2       | fuzzy match over index                                                       |
| **Run from here** (text/graph/split/search/diagnostics/asset)       | Preview surface                         | `BuildStory` + launch-from-here context                              | D8       | incremental build; preview never blocks the editor                           |
| **Unified undo/redo** across text, graph, tag, asset edits          | Shell + status bar                      | every mutation is a `StoryCommand` → one undo stack                  | all      | transactional, matches M0 save model                                         |
| **Keyboard-only editing + a11y** (M7)                               | All DS components                       | commands bindable; no mouse-only paths                               | all      | reduced-motion + high-contrast respected                                     |

Rule of thumb: if an interaction changes the story, it is a `StoryCommand`; if it
reads the story, it is a query DTO. The DS component is the hands; Rust is the
brain.

## Rust Design Principle Adherence (binding on every D-milestone)

The GUI work must not erode the core-first architecture in
[`RUST_CORE_STYLE_GUIDE.md`](./RUST_CORE_STYLE_GUIDE.md) and
[`TWINE_RS_STACK_STRATEGY.md`](./TWINE_RS_STACK_STRATEGY.md). These are
acceptance constraints, checked per milestone — a screen that looks like the DS
but violates them is **not** done.

- **Command-driven, view-driven — never model-owned.** DS components mutate
  story state _only_ through `CoreProjectHost.applyStoryCommand()` and the
  generated `StoryCommand` enum. No DS screen edits the story by reaching into a
  store. (Close the remaining legacy direct-mutation gaps as each screen
  migrates.)
- **Reads go through typed queries.** Screens render `QueryStoryIndex`,
  `QueryGraphProjection`, and the file-backed asset inventory DTOs. The UI does
  **not** parse Twee, compute backlinks, derive broken links, or lay out the
  graph ad hoc. During the TS parity-bridge phase, renderer query code must
  preserve Rust-generated DTO shapes and parity tests; once the native/WASM host
  lands, Rust produces those semantic facts and the DS renders them.
- **Snapshots + patch streams.** Initial load is one snapshot; ongoing work is
  `subscribeToPatches()` patch batches from a live Rust `ProjectSession`. Replace
  the current store-synthesized patches with real core patches. No giant
  full-project JSON after every edit.
- **One typed boundary, no drift.** DTOs and commands are generated
  (`specta`/`tauri-specta` or `ts-rs`); the DS `.d.ts` prop contracts are the UI
  half. UI and core cannot silently diverge.
- **No project mirror in the frontend.** The UI keeps only view/viewport/editor
  state. Do not copy the project into multiple React stores; Rust-backed state
  is the single source.
- **Source-only is first-class.** Every DS screen must work with zero graph
  positions. Graph layout, indexes, caches, and workspace view state are derived
  or optional; reveal-in-graph degrades gracefully when no layout exists.
- **Preserve user data.** DS edit flows must round-trip unknown metadata, custom
  attributes, IFIDs, tag colors, format names/versions — editing in a pretty UI
  must never drop data the parser preserved.
- **Core crates stay GUI/Tauri-free.** All DS code lives in the TS UI layer
  behind the host contract; `twine_model`/`parse`/`project`/`graph`/`search`/
  `export` never learn that a design system exists.

## Performance Budget (speed is the product)

twine.rs exists to be _fast_ where Twine is not. Each DS screen ships with a
performance bar, verified, not assumed:

- **Frame budget.** Pan, zoom, scroll, and typing stay at 60fps. Interactions
  feel native, not web-laggy.
- **Graph scale targets** (per stack strategy): **1k passages effortless,
  10k interactive, 50k navigable/searchable** without drawing everything.
  Visible passage cards render as DOM (`PassageNode`); edges, minimap, marquee,
  and selection layers render on Canvas2D/WebGL; viewport queries and layout come
  from Rust.
- **Virtualize every long surface.** Contents tree, search results, asset grid,
  diagnostics list — windowed rendering, never N DOM nodes for N items.
- **Never block typing.** Semantic facts (highlighting, diagnostics, backlinks)
  are produced by incremental Rust parsing/indexing fed to CodeMirror
  asynchronously and debounced. A keystroke never waits on a full reparse.
- **Index-backed, cancellation-aware queries.** Search/replace, go-to,
  autocomplete, and reveal run against Rust indexes and cancel cleanly when
  superseded.
- **Preview never freezes the app (D8).** The app-owned preview surface replaces
  `replaceDom` tearing down the React tree; builds are incremental and
  dev-only/HMR modules are excluded from runtime output.
- **Assets are cheap.** Previews resolve through the single inventory with
  lazy-loaded, cached thumbnails; no base64 churn in source, no repeated path
  parsing.
- **Instant first paint.** Self-hosted fonts (D0) — no CDN round-trip, no FOUT;
  snapshot-once-then-patch startup, not full-JSON-per-edit.

Each milestone names the specific budget it must hit (e.g. D5: 10k-node graph
pans at 60fps; D4: keystroke-to-highlight latency stays imperceptible; D8:
opening a preview does not drop an editor frame).

---

## Definition of Done for the Whole Track

The D-series is complete when:

1. The only design tokens in the app are the DS tokens; legacy aliases are gone.
2. Every screen is built from app-owned DS primitives and matches its
   `docs/design-system/` artifact under visual-regression checks.
3. Passage editing opens directly into the Workbench (Text/Graph/Split), backed
   by Rust projection, with a real preview/debug surface.
4. Every interaction in the cross-cutting catalogue is wired through a host
   command or query — no DS screen mutates or parses the story itself.
5. Each screen meets its named performance budget (graph scale, typing latency,
   virtualized lists, non-blocking preview).
6. CI prevents regression to legacy chrome, model-owned UI, and missed perf
   budgets.
