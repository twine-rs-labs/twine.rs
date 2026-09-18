# Undoing and Redoing

Twine RS has two related histories:

- **Focused source editor:** while typing in a passage, Story JavaScript, or
  Story Stylesheet buffer, use that editor's Undo/Redo keyboard commands.
  Each open buffer keeps its own text-editing history.
- **Project history:** use the application Undo/Redo controls or command
  palette for project changes, such as passage creation/deletion, moves,
  reviewed renames, Find/Replace, and accepted external changes. With focus
  outside editable controls, Command/Ctrl+Z invokes project Undo;
  Command/Ctrl+Shift+Z invokes Redo (Ctrl+Y is also supported).

The project controls describe the available operation and are disabled when
there is nothing to undo or redo. A reviewed multi-source replacement or
rename applies as one project transaction, so its project Undo restores the
accepted changes together.

Switching between Text, Graph, and Split is not a reason to assume history was
cleared. History belongs to the live editing/project session; do not rely on
it surviving application restart, project replacement, or a recovery reload.
Undo is not a substitute for a separate backup.
