# Post-beta release validation

Status: active
Owner: release maintainers
Last verified: 2026-08-03
Source of truth: unfinished release and distribution validation

`v0.2.0-beta.2` completed the first formal public prerelease on 2026-08-01.
That shipped capability belongs in [`../status/current.md`](../status/current.md);
this roadmap contains only the release work that remains.

## Outcomes

### Packaged applications

- Repeat installed-path coverage for later local, deliberately unsigned, and
  signed-profile packages according to their declared native-platform trust
  state.
- Exercise the Windows Authenticode and macOS Developer ID/notarization paths
  with real credentials before publishing any artifact as signed.
- Verify project load/save/watch, asset journals, preview, updates, dialogs,
  backups, and cleanup from installed paths.
- Add packaged-app smoke measurements without replacing the local unpackaged
  performance harness.

### Continuous integration

- Run Rust, TypeScript, core-boundary, documentation, and focused Electron smoke
  coverage on supported platforms.
- Keep long 10k/50k performance comparisons local until stable runners and
  machine classes are defined.
- Upload diagnostic reports for failures without treating incompatible machine
  measurements as regressions.

### Distribution

- Repeat the governed workflow in [`../../RELEASING.md`](../../RELEASING.md)
  for each later prerelease or stable release, including its protected tag,
  immutable GitHub Release, completed checklist, and fresh-download smoke
  evidence.
- Retain the generated release record, profile manifest, checksums, per-target
  provenance, release notes, and recovery evidence for every distributed
  artifact set; keep updater metadata disabled until a separately approved
  signed update feed exists.
- Preserve the accepted publisher-authenticity risk and prominent OS warning
  documentation for intentionally unsigned Windows and macOS distributions.
- Document supported operating systems and known limitations.
- Confirm real user data is never touched by tests or benchmark runs.

## Exit criteria

- Each published release has a completed and closed release checklist.
- A signed-profile publication has real credentialed Windows and macOS trust
  evidence; otherwise the release remains explicitly and prominently unsigned.
- CI covers the normal build/test/documentation contract.
- Installation, manual rollback, project recovery, and release-hosted download
  verification have reproducible evidence.
