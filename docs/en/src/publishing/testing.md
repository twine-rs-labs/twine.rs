# Testing a Story

While you're editing a story, you can see a preview of what it will look like in
published form by testing it. When testing a story, many story formats will show
additional information to help you debug problems. You should look at the
documentation for the story format you're using for more information on what is
available during testing mode.

Testing a story in browser Twine opens an app-owned preview tab. Native desktop
builds launch a scratch HTML package through the desktop bridge so local project
assets are available alongside the story. You can test a story multiple times at
once.

## Testing a Story From the Beginning

You can test a story from its start passage from either the Story Library or
Story Map screen.

- In the Story Library screen, select the story, then choose _Test_ from the
  _Build_ top toolbar tab.
- In the Story Map screen, choose _Test_ from the _Build_ top toolbar tab.

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
- In a preview window, choose _Test From Start_ to relaunch the current preview's
  start passage in test mode.
