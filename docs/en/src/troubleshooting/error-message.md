# If An Error Message Appears While Editing

## When Twine Can't Save Changes

Twine saves changes to your stories automatically. If it isn't able to save a
change, it will show an alert dialog to warn you. If you see this warning, don't
panic. Try making another small change to your story, like moving a passage
slightly or typing a letter into a passage editor. This will cause Twine to
try to save your changes again. If another alert dialog doesn't appear, then you
can continue working safely--whatever went wrong was most likely a transitory
problem, and Twine was able to save your most recent change.

If you repeatedly see alert dialogs saying Twine wasn't able to save your work,
stop working. Try exporting your story from the _Build & Export_ screen. If
this is successful and has up-to-date content in it, restart Twine
(either by quitting the application and re-opening it, or reloading Twine in
your browser) and [re-import the published story](../story-library/creating.md).

One common reason why saving a story fails in app Twine is that permissions are
not correct on your story library folder, or individual story files.

- Check that you are able to add a new file to this folder, like a plain text
  file. Try opening this file outside of Twine, editing it, and saving changes.
- You might have accidentally opened a story file in another application which
  has locked the story file for its own use. Opening story files in web browsers
  shouldn't cause this problem, though.

## When Another Application Changes a Project

The desktop app watches open project folders. It applies nonconflicting
external edits automatically and shows a _Project folder changed_ notice when
the disk and app copies conflict.

The notice offers _Use Disk Version_, _Keep App Version_, and _Later_. A recovery case may
instead offer _Reload From Disk_, which resets undo history. See
[Reviewing External Changes](../story-library/conflicts.md) before choosing
which copy should win.
