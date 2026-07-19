# The Scratch Folder

This page only applies to app Twine.

When you test, play, or proof a story, the desktop app creates temporary HTML
in its _scratch folder_ and opens it with your system browser. Referenced
project assets are prepared beside the HTML so relative paths can work.

By default, Twine links project asset folders into the scratch folder when the
platform supports it and copies the files as a fallback. Open
[Settings](../customizing/preferences.md) and use _Preview assets_ to always
copy asset files instead.

At startup and shutdown, Twine removes temporary HTML older than the configured
_Cache cleanup_ age. The default is three days. You can choose a retention
period from one to thirty days in Settings.

Scratch files are temporary preview output, not project backups. You can delete
them without deleting the project, and you should not use them as the canonical
copy of your story. See [Backups](../troubleshooting/backups.md) for recovery
options.

The scratch location, retention in minutes, and asset strategy can also be
customized using [command-line switches](../customizing/command-line.md).
