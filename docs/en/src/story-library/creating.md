# Creating, Copying and Importing Stories

## Creating a New Story

Choose _New Project_ from the workspace rail or the left side of the _Projects_
screen. The _Create_ tab asks for:

- the project name;
- the start-passage name;
- the story format and version;
- a Single or Multi source-layout preference;
- the initial Text, Graph, or Split workbench mode; and
- whether to create an initial graph layout.

The _Files_ panel previews the proposed project structure and destination.
Project names must be nonempty and unique in the current library.

Choose _Create Project_ to create the initial passage and open the workbench.
The desktop app also creates a visible `.twine.rs`
[project folder](location.md). The web app creates a browser-local project.

The source-layout control is currently a starter-project preview. Desktop
project folders are persisted using the canonical passage-per-file layout under
`passages/`.

## Copying a Story

To make a copy of an existing story, use _Duplicate_ on its project row or
card. Twine creates another library entry with a unique name. In the desktop
app, duplicating a story does not duplicate its existing project folder.

## Importing Stories

Choose _Import_ on the _Projects_ screen or switch to the _Import_ tab on the
_New Project_ screen. You can choose or drop:

- a published or archived `.html` or `.htm` file;
- Twee source in a `.twee` or `.tw` file; or
- a `.zip` archive containing a Twine HTML story in the desktop app.

After reading the source, Twine lists every story it found in the _Review_
panel. New stories are selected by default. A story that matches an existing
library filename is marked _Replace_ and is not selected automatically.

Select the stories you want and choose _Run Import_. **Selecting a story marked
_Replace_ replaces the matching story in your library.** The desktop app
creates project folders for imported stories and copies assets that it can
recover from supported HTML and zip imports.

Choose _Open Project Folder_ instead when you already have a `.twine.rs`
directory. This action is available only in the desktop app.

## Twee Import Limitations

Twine will use the story and passage metadata present in Twee source code, such
as passage position or story name. If this metadata is not present, Twine will
try to substitute reasonable defaults, but it will not handle all cases
perfectly. In particular:

- If Twee source code does not include passage positions, Twine will place
  passages in a grid pattern.
- If a Twee file does not specify what story format and version it uses, Twine
  will set it to [the default story format](../story-formats/default.md).
