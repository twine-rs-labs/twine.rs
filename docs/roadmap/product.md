# Product depth and legacy retirement

Status: active
Owner: product and frontend maintainers
Last verified: 2026-08-11
Source of truth: unfinished primary-product behavior

## Outcomes

### Preview and debug depth

- Build the visible debugger inspector and controls on the versioned,
  read-only runtime adapter foundation. The foundation negotiates bounded
  variable/state and visited-passage snapshots for supported SugarCube and
  Snowman versions while preserving current-passage-only Chapbook, Harlowe, and
  generic fallbacks until those formats expose bounded snapshot hooks.
- Keep state mutation, evaluation, restart/clear, and additional story-format
  development hooks outside the read-only protocol until each command has an
  explicit capability and lifecycle contract.
- Keep “test from here” behavior consistent across workbench, contents,
  diagnostics, search, and assets.

### Build and export depth

- Maintain the bounded desktop **Embed referenced media** contract and truthful
  build reporting for file-backed projects.
- Keep browser embedding unavailable until browser mode owns persistent binary
  asset contents and permissions.
- Keep Package asset inclusion, multi-file output, and online publishing
  separate from the desktop embedding scope.

### Legacy UI retirement

- Identify inherited dialogs and story-library actions still reachable outside
  the primary design-system shell.
- Route persisted actions through bound core sessions.
- Remove dead map/editor implementations after parity coverage confirms they
  are no longer product paths.
- Keep compatibility readers only where interchange requires them.

### User documentation

- Audit remaining inherited editing, troubleshooting, installation, and
  compatibility chapters for obsolete screen instructions.
- Separate general Twine/story-format concepts from application-specific
  instructions.
- Maintain Twine RS release notes independently of the upstream Twine history.

## Exit criteria

- Primary workflows do not open legacy editor or settings surfaces.
- Preview/debug exposes the supported runtime inspection contract.
- Desktop Build either embeds every supported referenced medium or reports why
  it remains external; browser mode cannot imply that capability.
- Persisted product mutations pass the core-boundary guard.
- The served user manual describes the current twine.rs UI.
