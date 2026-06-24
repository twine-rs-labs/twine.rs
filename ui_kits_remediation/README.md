# twine.rs — Theme & Export Implementation Package

Two design deliverables, plus drop-in implementation notes for engineering.

## What's in here

| File | What it is |
|---|---|
| `themes.html` | **Deliverable 1.** The Theme System document — dark + light principles, full token reference, and live component specimens shown side by side. Open in a browser. |
| `export.html` | **Deliverable 2.** The redesigned Build/Export screen (streamlined per Brief A). Has a live dark/light toggle. Open in a browser. |
| `light-theme.tokens.css` | The complete, production light-theme token block — paste into `tokens/colors.css`. |
| `LIGHT_THEME_IMPLEMENTATION.md` | How to ship the light theme in the real app (tokens, ThemeSetter wiring, the hardcoded-oklch follow-ups, contrast notes). |
| `BUILD_EXPORT_IMPLEMENTATION.md` | How to rebuild `src/routes/build/` to match the redesign — IA mapping, removals, behaviours, file-by-file. |

## TL;DR

- **Light theme is a real token system, not a mockup.** One `[data-app-theme='light']` block re-binds every primitive; the whole app flips with one attribute on `<body>`.
- **It's a soft cool *paper* (L≈0.95), never `#fff`.** Accents deepen for AA contrast; the twine blue→green gradient is preserved.
- **Build/Export collapses 11 targets → Preview (3 run actions) + Export (4 file formats).** Inspect-reports become an on-screen drawer; source-only omissions are neutral info; warnings are dismissible; "export surface" is gone.

Start with whichever `*_IMPLEMENTATION.md` matches the work in front of you.
