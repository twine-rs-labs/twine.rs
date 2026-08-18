# Testing a Story

While you're editing a story, you can see a preview of what it will look like in
published form by testing it. When testing a story, many story formats will show
additional information to help you debug problems. You should look at the
documentation for the story format you're using for more information on what is
available during testing mode.

Testing a story in browser Twine opens an app-owned preview tab. The desktop app
opens a dedicated app-owned preview window and serves its temporary story and
copied project assets from an opaque preview address. The preview does not have
access to the editor's project or filesystem bridge. You can open multiple
independent previews at once.

The preview toolbar shows the story target, build health, current passage when
the runtime can report it, runtime logs, and viewport size. You can reveal the
current passage in Source or Graph, reload the preview, and switch between fit,
desktop, tablet, and phone viewport widths. Console messages, runtime errors,
and unhandled promise rejections appear in the bounded runtime log.
Open the Debugger disclosure to inspect the host-owned Runtime Console and copy
its retained entries. Copying does not expose clipboard access to story code.

## Testing a Story From the Beginning

Open a story and choose _Test_ from the workbench's _Build_ action tab, or run
_Test Story_ from the command palette. Testing starts at the story's configured
start passage.

The _Build & Export_ screen's _Preview_ view contains _Play_ and _Proof_.
Testing remains available from the workbench, command palette, and
passage-specific actions because it is an authoring and debugging workflow.

## Testing a Story From a Specific Passage

You can temporarily override a story's start passage to fine-tune a specific
part of your story. But keep in mind that this makes your story act as though
the passage you've chosen is truly its first. If there is setup work done in
your story's start passage, your story may not behave correctly if you test from
a later point.

You can test from a specific passage anywhere the editor can identify a passage
context:

- In Text or Split mode, choose _Test From Here_ from the source header or the
  inspector.
- In Graph or Split mode, select a passage node and choose _Test From Here_ from
  the graph toolbar.
- In search results, diagnostics, contents, or asset usage views, use the
  passage-specific test action for the selected result or first usage.
- In a preview window, choose _Test From Start_ to rebuild the current story in
  test mode at that preview generation's launch passage. For Play and an
  ordinary Test this is the story's saved start; after Test From Here or Test
  Current it is the passage that launched the current generation.
- In a preview window, choose _Test Current_ after the runtime reports a current
  passage to rebuild in test mode at the passage currently being inspected.

These preview-window commands incorporate editor changes made after the
original preview opened and replace the content in that same window. A failed
replacement leaves the previous preview available. Testing from another
passage doesn't change the story's saved start passage.
