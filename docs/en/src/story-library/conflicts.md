# Reviewing External Changes

This page applies to project folders in the desktop app. Browser-local projects
don't have a folder watcher.

Twine watches an open `.twine.rs` folder for changes made by text editors,
source-control tools, file managers, and other programs. Changes that don't
conflict with in-app work are applied automatically.

When the disk copy and app copy both changed the same project data, a _Project
folder changed_ notice appears. It shows how many disk changes need review and
lists up to three affected paths.

Choose:

- _Use Disk Version_ to apply the changed files to the app, replacing conflicting
  in-app values;
- _Keep App Version_ to write the app's current story back to the project folder; or
- _Later_ to close the current notice without choosing either copy.

Choosing _Later_ does not merge or discard the difference. If the folder
remains different, Twine may ask again after a later scan.

When an external edit adds a passage to a Single-layout source, accepting the
disk change records a stable passage identity in `twine.toml`. If the source
changes again while the first change is waiting for acceptance, Twine rescans
before recording that identity. A replacement passage is assigned its own
identity instead of inheriting the pending passage's identity, and a follow-up
change notice may appear.

## Recovery Changes

Some changes can't be represented as a safe incremental update. For example,
the project manifest or graph metadata may have changed in a way that requires
the whole folder to be read again. In this case, the first action is named
_Reload From Disk_ instead of _Use Disk Version_.

Reloading replaces the app's project snapshot with the current folder and
resets project undo history. Twine asks for confirmation before doing this.

## Choosing Safely

Before choosing, consider where the newest intended edit was made:

- Choose _Use Disk Version_ or _Reload From Disk_ when the external editor or
  source-control operation should win.
- Choose _Keep App Version_ when the open workbench contains the version you want to
  preserve.
- Choose _Later_ when you need to inspect the files first.

If both copies contain work you need, choose _Later_, make a separate backup of
the project folder, and reconcile the edits before accepting either whole side.
