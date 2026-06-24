# Build / Export Redesign — Implementation Guide

Implements **Brief A** from the 0.1.2 remediation roadmap (W9): collapse the
over-built Build screen into something a first-time author reads like a save
dialog, while keeping power-user reach.

> Scope: `src/routes/build/` — `build-route.tsx`, `build-route.css`, and the
> target list in `src/util/build-package.ts`. The reference UI is `export.html`.

---

## 1. The information architecture (the core change)

The old screen exposes **11 targets** in one flat list
(`build-route.tsx:38–134`, `build-package.ts:16–27`). They split cleanly into
two *intents* — "show me the story" vs "save a file" — which the redesign makes
the top-level switch:

```
Top: SegmentedControl  [ Export ] [ Preview ]
```

### Preview  (the "Run" intent — nothing is saved)

Three action rows. These map 1:1 to the old run targets:

| Row | Old target | Notes |
|---|---|---|
| **Play** | `play` | Primary button; opens app preview from start. |
| **Test from a passage** | `test` | Inline **start-passage `Select`** in the row. |
| **Proof** | `proof` | **Inline proofing-format `Select`** in the row — fixes "you can't choose a proofing format at export" by moving it out of global prefs. |

### Export  (the "Save" intent — four file formats)

A small radio-card set. The old 11 targets collapse like this:

| New format | Absorbs old targets |
|---|---|
| **Playable HTML** | `export-html`, `publish` (Publish becomes a follow-on action, see §3), `compatibility-export` (becomes a **toggle**, see §2) |
| **Twee Source** | `export-twee` |
| **JSON** | `export-json` |
| **Archive (.zip)** | `package` |
| *(removed)* | `inspect-html`, `inspect-source` → **on-screen Inspect drawer** (§4) |

That's 11 → 4 saveable formats + 3 run actions, with two folded into options and
two removed.

---

## 2. Options fold in (don't add targets)

Per-format options live in a single panel under the format picker. Notably:

- **Compatibility export is a toggle, not a target.** Under Playable HTML:
  *"Classic Twine compatibility — omit the twine.rs graph data so other Twine
  tools can read it."* This is the old `compatibility-export` as one switch.
- **Inline asset embedding** (Playable HTML), **pretty-print** (JSON),
  **tags/metadata** (Twee), **archive contents** (.zip) — each a single row.
- The destination path + size/files estimate sit in the same panel, so the
  screen reads like a save dialog: *what format → what options → where → Export*.

Implementation: replace the capability/fidelity matrix panels in
`build-route.tsx` with a `formatOptions` object keyed by format; render only the
rows for the active format.

---

## 3. Run vs Save vs Publish

- **Export** is the single primary button; its label names the format
  (`Export Playable HTML`).
- **Publish online…** appears only for non-source formats, as a *secondary*
  action — it is "export, then upload", not a peer target. Keep
  `publishStoryPackage` underneath; just present it as a follow-on.
- Source-only formats (Twee/JSON) hide Publish entirely.

---

## 4. Inspect becomes on-screen (delete the two report exports)

Remove `inspect-html` and `inspect-source` from `build-package.ts` targets.
Replace with an **Inspect drawer** (`Inspect output` button → right-side
read-only panel) with a `Source | HTML` segmented control. Same information the
old reports dumped to disk — now shown, not saved.

> Rationale from the brief: a text report saved to disk is pointless; if
> inspection is useful it belongs on screen.

---

## 5. Notes: info vs warning vs error (the framing fix)

The old screen reconstructs warnings every render with no dismiss
(`build-route.tsx:493–560`) and frames expected omissions as warnings
(`build-package.ts:345–355`). Redesign rules:

- **Source-only omissions are neutral `info`, never warnings.** Twee/JSON show:
  *"Source-only format — assets and runtime HTML are not part of this file, by
  design."* No count, no severity, never a blocker.
- **Warnings are dismissible and ephemeral.** Each note has an `×`; the whole set
  **clears on format switch** (`useEffect(() => setDismissed({}), [format])`).
  Warnings never block export — they're skipped and noted.
- **Errors** (e.g. a broken link) are the only blockers; show a `Fix in
  Diagnostics →` affordance rather than redirecting (ties to W2's no-silent-
  fallback rule).
- **Healthy state** gets a positive note: *"Ready to export — no problems
  found."*

### Readability (important in light mode)

Render notes on a **neutral surface** with a **3px left accent bar + colored
icon** — *not* dark text on a saturated tint. See the light-theme guide §3. The
reference CSS:

```css
.ex__note         { background: var(--ink-2); border: 1px solid var(--line-1);
                    border-left: 3px solid var(--line-2); }
.ex__note--ok     { border-left-color: var(--sem-saved); }
.ex__note--warn   { border-left-color: var(--sem-warn); }
.ex__note--error  { border-left-color: var(--sem-error); }
.ex__note--info   { border-left-color: var(--sem-generated); }
.ex__note-t       { color: var(--tx-1); }   /* title  */
.ex__note-d       { color: var(--tx-3); }   /* detail */
```

---

## 6. Copy & terminology

- **Delete "export surface"** from all UI strings (the build-log seed string in
  `build-route.tsx` and any labels).
- Plain words only: *Export · Preview · Format · Playable HTML · Twee Source ·
  Archive · Inspect output · Ready to export*.
- Title Case for commands, sentence case for descriptions (house style).

---

## 7. Don'ts (so it can't regress into a matrix)

- **Don't** re-add a capability/fidelity matrix as the primary surface. If
  power users need it, it's a disclosure inside Inspect, not the default view.
- **Don't** make Publish a sibling target — it's a follow-on to Export.
- **Don't** surface expected source-only omissions as warnings/errors/counts.
- **Don't** keep warnings sticky across target switches.
- **Don't** rebuild it as a multi-step wizard — fewer choices, plain words, one
  screen.

---

## 8. File-by-file

| File | Change |
|---|---|
| `src/routes/build/build-route.tsx` | Replace target list + matrix with `view` (`export`/`preview`) state, format radio set, per-format options object, dismissible notes, Inspect drawer. Drop the `inspect-*` branches. |
| `src/util/build-package.ts` | Remove `inspect-html`, `inspect-source` targets and their report builders (`:419–470`). Fold compatibility into an HTML build option. |
| `src/store/use-publishing.ts` | Keep `proofStoryPackage` / `publishStoryPackage`. Pass the **proofing format** chosen in the Preview row instead of reading `prefs.proofingFormat`. |
| `src/routes/build/build-route.css` | Restyle to the centered "save dialog" layout (see `export.html`): calm max-width column, generous spacing — intentionally *less* dense than the workbench. DS tokens only; themes automatically. |

The reference `export.html` is a complete, interactive mock of all of the above
(both themes), safe to read styles and structure from directly.
