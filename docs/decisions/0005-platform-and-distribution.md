# ADR 0005: Platform and distribution

Status: accepted
Decision date: 2026-06-22
Last verified: 2026-07-04

This record closes the M7 platform/documentation slice for the current Electron
desktop app path. It documents what the app supports now, what is intentionally
out of scope, and which follow-up work belongs to packaging infrastructure
rather than the Settings/Platform app architecture.

## Runtime and Settings Contract

- Native-only platform settings are stored in Electron app prefs, not renderer
  localStorage. Renderer settings remain for cross-runtime accessibility,
  sharing, and integration policy.
- The desktop bridge exposes the current story library path, backup path,
  backup cadence, backup retention, backup review cadence/time, preview/cache
  cleanup age, fullscreen persistence, last fullscreen state, link-handling
  mode, and external editor command.
- Settings can run a story-library backup, reveal the backup folder, update
  native platform settings, and mark backup review complete.
- External links default to the system browser. Users can switch link handling
  to `block` for stricter local-only workflows.

## Command Line

Supported:

- `twine --help` or `twine -h` prints usage text and exits before app startup.
- Positional `.twine.rs` project folders are queued on startup and opened
  through the same native project-folder parser/session path used by the Open
  Project Folder button.
- macOS `open-file` events are queued into the same startup-open path.
- CLI app prefs remain supported for folder and platform settings, including
  `--storyLibraryFolderPath`, `--backupFolderPath`,
  `--backupCadenceMinutes`, `--backupRetentionLimit`,
  `--scratchFolderPath`, `--scratchFileCleanupAge`, and
  `--disableHardwareAcceleration`.

Not supported in M7:

- Importing arbitrary `.html`, `.twee`, or `.tw` files directly from command-line
  paths. Those remain interactive import workflows because they require format
  selection/review and replacement decisions.

## Windows Installer

Current target:

- Electron Builder NSIS installer.
- Architecture: `x64`.
- Install options: non-one-click installer with changeable installation
  directory.

Decision:

- 32-bit Windows builds are not part of the M7 support matrix. Current Electron
  and dependency support makes x64 the reliable baseline; adding 32-bit would be
  a separate release-engineering commitment with test hardware, signing, and
  updater coverage.

## Linux Packaging

Current target:

- Linux zip artifacts for `x64` and `arm64`.

Decision:

- Flatpak is the preferred next Linux packaging layer, but it is packaging
  infrastructure work rather than an app Settings blocker. The app-side M7
  requirement is closed by keeping storage paths, command-line behavior, cache
  cleanup, and link handling explicit so Flatpak sandbox permissions can be
  declared without changing app architecture.
- Launcher metadata should point at the desktop app, not the web fallback, and
  should preserve command-line project-folder opening.

## macOS Packaging and Updates

Current target:

- Universal macOS DMG.
- Signed/notarized when Apple credentials are present.
- Manual update check through the existing update-check action.

Decision:

- Automatic updates stay off until a signed, tested update feed exists for every
  production channel. M7 records the strategy and keeps manual update checks
  visible rather than silently enabling a partial updater.
- Mac App Store distribution remains separate from the current DMG channel
  because it would require entitlement, sandbox, and review constraints that
  affect local folder access.

## Sharing and Collaboration

Current app path:

- Share mode is explicit: off, local file, or published URL.
- Cloud save, revision control, and hosting publish are manual hooks. Twine does
  not silently upload local story data.
- Settings shows a local-only warning state so users understand where project
  data lives before sharing.

Decision:

- M7 does not introduce a hosted sync service. Local-first project folders,
  predictable backup folders, and manual integration hooks are the architecture
  baseline.

## Mobile and Online Constraints

Decision:

- Mobile is constrained for the desktop project-folder architecture. The current
  app requires durable local folders, file watching, backup folders, and native
  preview/cache handling. A mobile or online version needs its own storage and
  sync contract instead of pretending the Electron desktop contract is portable.

## Verification Hooks

M7 platform behavior is covered by focused tests for:

- Command-line help/path parsing and open-path queueing.
- Native platform-setting normalization and persistence.
- IPC bridge handlers for platform settings, manual backup, backup folder
  reveal, and command-line project-folder consumption.
- Settings route controls that load and update native platform settings.
- AppShell keyboard shortcuts executing command-registry actions.
