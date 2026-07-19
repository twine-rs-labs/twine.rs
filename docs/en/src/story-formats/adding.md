# Adding a Story Format

To add a story format, you'll need to know its address. A story format should
include this in its documentation. A story format address must be a URL, with a
prefix like `https://` in front of it.

Enter the address in the _Story format URL_ field at the top of the
[_Story Formats_ screen](viewing.md), then choose _Add_. Twine validates and
loads the format manifest before adding it. Any load or duplicate-version error
is shown beside the add controls.

Native desktop builds also provide _From File_. Choose a local format file and
Twine will add it after the same identity and manifest checks.

The format appears in the list immediately. You can then [make it the default
story format](default.md) or [change an existing
story](../editing-stories/changing-story-format.md) to use it.
