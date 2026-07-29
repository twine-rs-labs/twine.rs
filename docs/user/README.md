# twine.rs user documentation

Status: migration in progress
Owner: product documentation maintainers
Last verified: 2026-07-29
Source of truth: shipped twine.rs workflows only

The current mdBook under `docs/en/` is predominantly inherited Twine
documentation. It remains useful for general story-format concepts and
compatibility behavior. Its application-shell, launcher, project-folder,
native conflict-review, passage-editor, asset, build, Settings, and Story
Formats chapters now describe the current interface.

Some editing, troubleshooting, installation, and compatibility chapters remain
inherited and need a final twine.rs-specific audit. Until that work is complete:

- use [`../status/current.md`](../status/current.md) for current capabilities;
- use [`../product/workbench.md`](../product/workbench.md) for workbench
  interactions;
- use the root [`README.md`](../../README.md) for installation and development;
- use [`CHANGELOG.md`](../../CHANGELOG.md) for Twine RS release notes and
  [`SUPPORT.md`](../../SUPPORT.md) for its support lifecycle;
- treat `docs/en/src/release-notes/` only as upstream Twine history.

The active rewrite is tracked in
[`../roadmap/product.md`](../roadmap/product.md).
