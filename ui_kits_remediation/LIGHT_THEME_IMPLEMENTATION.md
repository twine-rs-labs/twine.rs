# Light Theme — Implementation Guide

Ships the **Daylight workbench** light theme as a first-class peer of the dark
default. The whole approach is: re-bind the token *primitives* under one scope
selector and let every alias and component resolve through them. No
per-component overrides.

> Resolves remediation item **W6.1** ("Changing theme has no effect") by making
> the theme toggle finally *do* something — the honest path of the two options in
> the remediation doc (remove the lying toggle **or** ship a real palette). This
> ships the real palette.

---

## 1. The model

- **Dark stays the default**, defined on `:root` (unchanged).
- **Light is one scoped block**: `[data-app-theme='light'] { … }` re-binding the
  same token names with light values.
- Activation is a single attribute on `<body>` — which `ThemeSetter` already
  writes (`document.body.dataset.appTheme = 'light'`). Today it flips the
  attribute and nothing happens *because no light values exist*. This package
  supplies them.

Because the semantic aliases (`--bg-app`, `--text-body`, `--border-default`, …)
and every component read through the primitives, they all flip for free.

---

## 2. Apply it (5 minutes)

1. Open the design-system token file:
   `src/styles/design-system/tokens/colors.css`
   (in the design-system project: `tokens/colors.css`).
2. Paste the entire contents of **`light-theme.tokens.css`** at the end of that
   file, after the `:root { … }` dark block. It is the verbatim block already
   live in this design system.
3. Confirm `ThemeSetter` writes the attribute (it does today):

   ```tsx
   // src/store/theme-setter.tsx
   document.body.dataset.appTheme = appTheme; // 'light' | 'dark'
   ```

   Note it writes `'dark'` as a literal too. The token block only matches
   `[data-app-theme='light']`; `'dark'` (or empty) falls through to `:root`.
   Both work — no change needed.
4. In Settings, re-enable the theme selector to offer **Dark** and **Light**
   (the remediation doc had you *remove* it; now you can keep Dark/Light and drop
   only "System" until you wire `prefers-color-scheme`).

That's the whole functional change. Everything token-driven now themes.

---

## 3. Design rules baked into the values (so edits stay coherent)

- **Not a searing white.** Base frame is `oklch(0.952 …)` cool paper, *never*
  `#fff`. Pure-ish white (`ink-3`, `0.994`) is reserved for the cards/editor you
  actually read in.
- **The ramp inverts its *lift*, not its *roles*.** Dark lifts surfaces by
  getting lighter; light lifts them by getting whiter + a soft cool shadow.
  Controls (`ink-4/5`) become gentle toned grays that sit *on* the white
  surfaces, so existing component CSS (`button rest = ink-4 → hover = ink-5`)
  reads correctly as a light control that darkens on hover.
- **Accents deepen ~0.15 L and gain chroma** so they hit AA on paper and still
  take white text (`--tx-on-accent`).
- **Semantic hues stay identifiable**, deepened to AA-legible ink; their `-soft`
  tints become pale washes.
- **Elevation switches from glow to shadow.** The color-bearing depth tokens
  (`--shadow-*`, `--edge-hi`, `--glow-*`) are overridden in the same block to
  soft, cool, low-alpha drop shadows.

### One readability rule worth keeping

Do **not** put body/secondary text directly on a saturated `-soft` tint in light
mode — dark ink on green/amber reads muddy. Put status text on a **neutral
surface** (`--ink-2`) and carry the semantic color with a **3px left accent bar +
colored icon**. The Export screen's notes and the document's specimen both use
this pattern:

```css
.note            { background: var(--ink-2); border: 1px solid var(--line-1);
                   border-left: 3px solid var(--line-2); color: var(--tx-1); }
.note--ok        { border-left-color: var(--sem-saved); }
.note--ok  .icon { color: var(--sem-saved); }
.note--warn      { border-left-color: var(--sem-warn); }
.note--warn .icon{ color: var(--sem-warn); }
```

---

## 4. The one follow-up to be *fully* complete

Most chrome flips automatically. A few **screen-level stylesheets hardcode raw
`oklch()`** for effect and will not flip from tokens alone. Route each through a
token, or add a tiny `[data-app-theme='light']` override beside it:

| Location | Hardcoded thing | Fix |
|---|---|---|
| `ui_kits/workbench/workbench.css` `.gm__grid` | graph dot-grid uses literal `oklch(1 0 0 / 0.05)` white dots | swap the white dot for `var(--line-2)` (or override the radial under the light scope) |
| `ui_kits/workbench/workbench.css` `.h-*` syntax classes | editor syntax palette is literal bright `oklch()` | map to `--sem-link / --sem-var / --sem-tag / --sem-saved` (already the right hues) |
| `.ew__line.is-cursor`, `:hover` washes | literal `oklch(… / 0.10)` line washes | use `--sel-wash` / a `--line` token |

None of these block the theme; they're the editor-surface polish that makes
light mode feel finished. Everything else (rails, bars, panels, cards, buttons,
badges, inputs, switches, menus, modals, diagnostics) themes with zero changes.

---

## 5. Verifying contrast

All token text/role values were chosen for WCAG AA on their intended surfaces.
If you adjust them, keep:

- `--tx-1` / `--tx-2` ≥ AA on `--ink-2`/`--ink-3`.
- Each `--sem-*` ≥ AA as an **icon/border** on neutral surfaces (not as text on
  its own tint — see §3).
- `--tx-on-accent` (near-white) ≥ AA on each solid accent fill
  (`--acc-blue`, `--acc-green`, `--sem-*` solids).
