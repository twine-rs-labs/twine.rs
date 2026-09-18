# How Twine Manages Story Format Versions

Twine RS stores a story format's name and version with each story. Choosing a
new default changes future projects, not every existing story.

At startup the format registry restores missing bundled formats and removes
obsolete built-in registrations that are no longer shipped. User-added
registrations are retained. Multiple bundled versions can remain installed;
this is not a rule that deletes every older minor version.

When story metadata is repaired, an installed exact name/version is normally
preserved. If that version is missing, repair first seeks a compatible version
of the same format, then another installed version with the same name. Missing
or invalid format metadata can fall back to a default; legacy SugarCube syntax
also has a detection/repair path. These are recovery heuristics, not a promise
that a replacement format is compatible with your story.

Back up before removing a format or opening older/imported work. Inspect
**Story > Details** afterward, select the intended installed version, and
Test the story. Changing formats does not translate macros or scripts. See
[changing the story format](../editing-stories/changing-story-format.md).
