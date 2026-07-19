# Editing Passages

To edit a passage, select it and choose _Edit_ from the Passage top toolbar tab.
If you're using a mouse, you can also double-click a passage to edit it. This
opens the passage in the workbench editor. You can use the Text view for the
full editor dock or Split view to keep the story graph visible beside it.

Most of a passage editor is taken up by a CodeMirror 6 source editor where you
can enter text that the player will see when playing your story. To be more
precise, the text you enter will be rendered by the story format when your story
is played. For instance, you might enter code into your passage to set variables
or conditionally display some text.

The font and size of the text can be customized in
[Settings](../customizing/preferences.md). This doesn't change what the passage
looks like when played; it just lets you make the text editor more comfortable
to use.

Story formats can extend Twine to add syntax formatting to the passage text
editor. For example, links might appear in a blue color. You'll need to consult
the documentation for your story format as to what these colors mean. You can
also disable syntax coloring by [disabling story format
extensions](../story-formats/extensions.md).

Twine automatically saves your changes to a passage after you stop typing for a
moment.

## Leading and Trailing Space in Passage Names

If a passage has leading or trailing spaces in its name (like " Hello" or
"Goodbye "), then Twine will show placeholder symbols in the editor title that
look like ␣. These symbols are shown so that you can distinguish between
passages that have these spaces and those that don't. In other words, Twine
treats a passage named "Hello" and one named "Hello " as two unrelated passages.
(And usually, you will want to give your passages names that don't differ by
just spaces.)

These symbols are only visible in Twine, not when your story is played.

## Editing Multiple Passages

Opening another passage adds another buffer to the editor dock. Full-width Text
view can tile buffers in columns or stack them vertically; the narrower Split
view stacks them. Click or tap a buffer to focus it, drag its title bar to
reorder it, or use its close button to remove it from the dock. Each buffer
keeps its own document, selection, undo history, story-format toolbar state, and
syntax parser state.

## Automatically-Created Links

As you enter text in a passage, Twine will detect when you've added new links.
If the destination passage doesn't already exist, it will create an empty
passage for you. Deleting the link will delete this empty passage.

Twine won't delete an empty passage while editing if any of the criteria below
are true:

- It is linked to from another passage
- It has any tags
- It has a different size than the default
- It is the story start

## Text Formatting, Code, Images, Sound, Video... Basically Everything Cool

You should consult the documentation of the story format you are using for how
to include things like text formatting, code, or multimedia in your passages.
All these things are possible, but the way you handle each one varies by story
format.

## The Passage Toolbar

The passage editor header contains per-buffer controls: find in editor, close,
[tags](tagging.md), link and backlink counts, test from this passage, and reveal
in graph. Story-level passage actions such as rename, size, and _Start Story
Here_ remain in the Passage top toolbar. CodeMirror's focused-editor undo and
redo history is separate from project-level changes outside editable controls;
see [Undoing and Redoing](undoing.md).

## Story Format Toolbars

Compatible story formats can extend each passage editor with a toolbar rendered
by the workbench. You should check the documentation for your story format for
details on how it works.

If a format mode, command, or toolbar makes an unsupported editor call, Twine
disables only the failing integration feature for that editor, shows a
content-free compatibility diagnostic, and keeps the generic CodeMirror 6
editor usable. Reopening the buffer or reloading the format creates a fresh
per-editor runtime.

Story format toolbars can be turned off permanently by [disabling story format
extensions](../story-formats/extensions.md).
