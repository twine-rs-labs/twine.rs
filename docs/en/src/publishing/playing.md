# Playing a Story

Twine allows you to play a story from the application. This can be helpful if
you'd like someone to play your story on your own computer before publishing it,
or to see exactly what people will see when playing your story once it's
published.

Open _Build & Export_, switch to _Preview_, and choose _Play_. You can also
choose _Play_ in the workbench's _Build_ action tab, use the _Play_ button in
the workspace rail, or run _Play Story_ from the command palette.

Play starts at the story's configured start passage and doesn't include the
story format's test-mode features. The preview toolbar still reports build
health and runtime messages, and offers viewport and reload controls. When the
runtime identifies a passage, choose _Edit Passage_ in the toolbar or _Edit
Text_ beside a Debugger entry to open it in the text editor. Choose _Reveal in
Graph_ to select and reframe it in Graph mode. Use [Test](testing.md) when you
need the story format's debugging mode or want to start at another passage.

Browser Twine opens the preview in an app-owned tab. The desktop app opens an
app-owned preview window at a temporary, opaque address. You can keep multiple
preview windows open independently, but their addresses and temporary content
work only inside the current Twine session. To share your story, you will need
to [publish it](publishing.md).
