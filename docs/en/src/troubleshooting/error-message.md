# If An Error Message Appears While Editing

## When Twine Can't Save Changes

If **Save error** appears, stop adding edits and keep the app open while
preserving your current work. Save completion is asynchronous. The absence of
another alert does not prove that the latest edit reached storage.

Copy important unsaved text to a separate file. If Build & Export succeeds,
inspect the export and confirm it contains your latest work before treating it
as a recovery copy; preserve external assets separately. Do not restart,
reload, clear browser storage, or replace the original project merely to make
an error disappear.

On desktop, check that the active library and complete `.twine.rs` project
folder are available and writable, that the disk has space, and that another
program is not locking or replacing files. On the web, preserve the exact
browser origin/profile and check its storage availability. After resolving the
cause, allow the pending edit to save; if another edit is needed to trigger a
retry, do it only after preserving the unsaved content.

Require an explicit **Saved** status with no error, then check the result using
a copied project in an [isolated recovery library](backups.md#test-with-an-isolated-library)
or an exported story in a separate browser profile. A status label alone does
not verify the contents of a backup. If saving still fails, retain the original
and copies and report the error with your version/platform and reproduction
steps, excluding private content.

## When Another Application Changes a Project

The desktop app watches open project folders. It applies nonconflicting
external edits automatically and shows a _Project folder changed_ notice when
the disk and app copies conflict.

The notice offers _Use Disk Version_, _Keep App Version_, and _Later_. A recovery case may
instead offer _Reload From Disk_, which resets undo history. See
[Reviewing External Changes](../story-library/conflicts.md) before choosing
which copy should win.
