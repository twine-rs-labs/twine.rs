# Story Format Editor Extensions

Story formats can extend Twine by adding:

- References between passages, which appear as dotted lines connecting passages
  in the Story Map screen
- A toolbar in passage editors
- Syntax coloring in passage editors

twine.rs uses CodeMirror 6 for editing. It can adapt the documented, stream-mode
subset of older CodeMirror 5 story-format extensions. Chapbook's syntax mode,
commands, and toolbar are supported through this adapter. Extensions that use
CodeMirror internals, arbitrary toolbar DOM, overlays, marks, custom events, or
the old passage-dialog DOM are not run.

Harlowe's legacy editor extension needs unsupported CodeMirror 5 internals and
is never run. The exact bundled Harlowe 3.3.9 format instead uses a native
CodeMirror 6 integration with Harlowe syntax coloring, completion, coding help,
proofreading, scoped find and replace, preferences, keyboard commands, and its
authoring toolbar. Other Harlowe versions and user-added builds use the generic
editor unless they have a separately registered native integration. This
affects only the editor; play, test, proof, and published story output continue
to use the installed Harlowe runtime unchanged.

The Formats screen shows the editor compatibility status for each installed
format. If an extension calls unsupported APIs or fails while adapting,
twine.rs disables that feature for the affected editor and falls back to the
generic editor.

You can disable format-provided editor extensions by turning off _Enable editor
extensions_ on the Formats screen. Turn it on again to restore compatible
extensions.

Disabling extensions disables all editor extensions for that format. Individual
toolbar or syntax features cannot be disabled separately.
