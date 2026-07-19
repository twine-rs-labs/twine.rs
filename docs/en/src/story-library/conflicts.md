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

- _Accept Disk_ to apply the changed files to the app, replacing conflicting
  in-app values;
- _Keep App_ to write the app's current story back to the project folder; or
- _Later_ to close the current notice without choosing either copy.

Choosing _Later_ does not merge or discard the difference. If the folder
remains different, Twine may ask again after a later scan.

## Recovery Changes

Some changes can't be represented as a safe incremental update. For example,
the project manifest or graph metadata may have changed in a way that requires
the whole folder to be read again. In this case, the first action is named
_Reload From Disk_ instead of _Accept Disk_.

Reloading replaces the app's project snapshot with the current folder and
resets project undo history. Twine asks for confirmation before doing this.

## Choosing Safely

Before choosing, consider where the newest intended edit was made:

- Choose _Accept Disk_ or _Reload From Disk_ when the external editor or
  source-control operation should win.
- Choose _Keep App_ when the open workbench contains the version you want to
  preserve.
- Choose _Later_ when you need to inspect the files first.

If both copies contain work you need, choose _Later_, make a separate backup of
the project folder, and reconcile the edits before accepting either whole side.
