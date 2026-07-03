# Product depth and legacy retirement

Status: active
Owner: product and frontend maintainers
Last verified: 2026-07-04
Source of truth: unfinished primary-product behavior

## Outcomes

### Preview and debug depth

- Complete variable/state inspection, visited-passage history, runtime errors,
  and story-format development hooks.
- Bring desktop scratch-window behavior to parity with the app-owned preview
  route.
- Keep “test from here” behavior consistent across workbench, contents,
  diagnostics, search, and assets.

### Legacy UI retirement

- Identify inherited dialogs and story-library actions still reachable outside
  the primary design-system shell.
- Route persisted actions through bound core sessions.
- Remove dead map/editor implementations after parity coverage confirms they
  are no longer product paths.
- Keep compatibility readers only where interchange requires them.

### User documentation

- Replace inherited Twine screen instructions with twine.rs launcher,
  project-folder, workbench, conflict-review, asset, and build workflows.
- Separate general Twine/story-format concepts from application-specific
  instructions.
- Publish twine.rs release notes independently of the upstream Twine history.

## Exit criteria

- Primary workflows do not open legacy editor or settings surfaces.
- Preview/debug exposes the supported runtime inspection contract.
- Persisted product mutations pass the core-boundary guard.
- The served user manual describes the current twine.rs UI.
