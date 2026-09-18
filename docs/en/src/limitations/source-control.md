# Working With Source Control

Desktop Twine RS projects are visible `.twine.rs` directories, not just
compressed HTML stories. Preserve `twine.toml`, declared passage source files,
`scripts/`, `styles/`, assets, and persistent hidden `.twine/` metadata. Do not
ignore all hidden metadata or track only a playable export. Keep a complete
backup before introducing ignore rules; generated cache and temporary data are
not a substitute for project sources.

With **Multi** layout each passage has its own source file, so many unrelated
edits produce separate diffs. **Single** keeps passages together in
`story.twee`. Both retain separate script and stylesheet files. See
[Project Storage and Folders](../story-library/location.md) for the layout.
You do not need an HTML-to-Twee conversion step before tracking these sources.

Before pulling, merging, switching branches, or restoring older files, finish
editing, check **Saved**, quit Twine RS, and preserve the current project.
Resolve source-control conflicts outside the app, keeping manifest/source
relationships and project identities consistent. Do not hand-edit internal
journals, replacement backups, or recovery metadata. Reopen a disposable copy
and check its content before resuming work on the original.

The editor also watches ordinary external edits. When it asks which version to
keep, follow [external-change review](../story-library/conflicts.md); source
control and Twine RS conflict review are separate steps. **Later** preserves
the decision for review, rather than accepting either version.

Browser-local storage is not a source-control checkout. Export sources to
track them externally and test any later import in a separate project/profile.
