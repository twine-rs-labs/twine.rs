# Getting Around in twine.rs

twine.rs uses one application shell for the story library, workbench, build
tools, formats, and settings. The shell has three main navigation areas: the
application header, the workspace rail, and route-specific action tabs.

## The Application Header

The header shows breadcrumbs for the current story and screen. When the current
screen provides action groups, a segmented control chooses which group is
shown in the action row below the header.

The right side of the header can contain:

- pinned controls supplied by the current screen;
- a _Help_ button when that screen has contextual documentation; and
- the _Command_ button, which opens the command palette.

The command palette searches application, navigation, build, toolbar, and story
commands. Press <kbd>Ctrl</kbd>+<kbd>K</kbd> (or <kbd>Command</kbd>+<kbd>K</kbd>
on macOS) to open it without leaving the focused editor. Active IME composition
is not interrupted. While the palette is open, focus remains inside it and
returns to the control or editor that opened it when it closes.

Routes and tools contribute commands only for their mounted lifetime. The
workbench contributes _Go to Passage_, _Find References_, _Rename Active
Passage_, _Find / Replace_, source and graph reveals, and project _Undo_ and
_Redo_. Diagnostics contributes source and graph reveals, _Fix All Safe_, and
the automatic fixes that apply to the selected diagnostic. Commands that make
sense on the current route but need another selection or capability remain
visible with a reason; commands owned by another route are absent. If the
story, passage, diagnostic, revision, or capability changes while the palette
is open, the command is checked again before it can run.

## The Workspace Rail

The vertical workspace rail is the primary way to move between screens:

- _Stories_ opens the story library.
- _Workbench_ opens the current story in Text, Graph, or Split mode.
- _Contents_ shows the current story's passage outline.
- _Assets_ manages project assets.
- _Play_ launches the current story.
- _Build & Export_ opens build and export workflows.
- _Diagnostics_ shows project diagnostics. Deterministic fixes open a review
  before changing the project. _Fix All Safe_ reviews one combined plan for all
  non-dismissed safe fixes and applies it as one undoable transaction; it does
  not depend on the current search, filter, or loaded page. Fixes that need a
  name, target, file, or other input stay labelled as manual actions.
- _Story Formats_ manages installed formats and editor compatibility.
- _Settings_ opens application and platform settings.
- _New Project_ starts the project-creation workflow.

Story-dependent destinations are disabled until a story is selected or open.
The highlighted rail item indicates the active screen. Use _Stories_ to return
to the library; there is no separate application Back button.

## Route Action Tabs

Screens register only the action tabs that apply to their current context. For
example, the workbench can expose story, passage, view, and build actions. A
selected story or passage may enable additional controls in the active tab.

The contextual actions listed above invoke the same review and execution flows
as their visible controls, so those workflows do not depend on pointer access
to the toolbar.

## The Workbench and Editor Dock

The workbench provides Text, Graph, and Split views. Opening passages adds
buffers to the editor dock instead of opening one passage dialog per passage.
Buffers can be focused, reordered, tiled, stacked, or closed while retaining
their own selections and undo histories.

Some focused tasks—such as confirmations, story details, and about
information—still use dialogs. Dialog width is configurable in
[Settings](../customizing/preferences.md), but workbench editor layout is
controlled by the dock and view mode instead.
