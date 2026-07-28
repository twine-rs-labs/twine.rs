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

In the desktop app, the source-layout choice controls how the story is stored:

- _Multi_ is the default and recommended layout. Each passage has its own file
  under `passages/<story-slug>/` (the first is
  `0001-<passage-slug>.twee`), while the story script and stylesheet use
  `scripts/<story-slug>.js` and `styles/<story-slug>.css`. This layout keeps
  passage edits separate, which usually makes source control diffs and merge
  conflicts easier to manage.
- _Single_ stores the story metadata and all passages together in `story.twee`.
  This layout is convenient when you want the story's Twee source in one file,
  but unrelated passage edits share that file and can be harder to merge. The
  script and stylesheet remain separate files under `scripts/` and `styles/`.

The desktop app remembers the selected layout for later saves. Both layouts
create the same blank start passage; choosing a storage layout does not change
the story's initial content. In the web app, new projects remain browser-local
instead of creating either on-disk layout.

The choice applies when the project is first created. Reopening or saving the
project later does not convert it to the other layout. Automatic conversion is
not currently offered. To change layouts, make a backup, create a new project
using the layout you want, and move or import the story content into it.

## Duplicating a Project or Story

Use _Duplicate Project_ on a file-backed desktop project to create an
independent sibling `.twine.rs` folder. Twine copies every story and file in the
folder, including assets and hidden `.twine/` metadata, then assigns new story,
IFID, and passage identities to the copy. If a project folder contains multiple
stories, they are duplicated together because they share the same assets and
storage boundary.

Browser-local stories use _Duplicate Story_ instead. This creates another
browser library entry with a unique name; there is no project folder to copy.

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
