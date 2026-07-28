# The Scratch Folder

This page only applies to app Twine.

When you test, play, or proof a story, the desktop app creates a bounded
temporary package in its _scratch folder_ and opens it in a dedicated Twine
preview window. Referenced project assets are copied beside the generated HTML
so relative paths work. The story is served from an opaque `twine-preview:`
origin rather than opened as a scratch file or given the project folder's path.

Each preview window owns its current package. Reloading keeps that package and
origin. _Test Current_ or _Test From Start_ stages a new package and releases
the previous one only after the new content loads. Closing the preview, closing
its editor window, a renderer crash, or app shutdown releases the owned package.
Multiple preview windows keep separate origins and assets.

When staging a preview, Twine opportunistically removes abandoned temporary
HTML older than the configured _Cache cleanup_ age. Shutdown performs a final
cleanup pass. The default is three days. You can choose a retention period from
one to thirty days in Settings.

Scratch files are temporary preview output, not project backups. Preview
packages contain copies, never links to the project asset directory. You can
delete abandoned packages without deleting the project, and you should not use
them as the canonical copy of your story. See
[Backups](../troubleshooting/backups.md) for recovery options.

The scratch location and retention in minutes can also be customized using
[command-line switches](../customizing/command-line.md). The former asset
strategy switch is deprecated and ignored.
