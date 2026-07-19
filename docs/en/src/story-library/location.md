# Project Storage and Folders

The desktop app stores each new or imported story in a visible directory whose
name ends in `.twine.rs`. The web app stores projects in browser storage
instead.

## Choosing Storage Locations

Open [Settings](../customizing/preferences.md) to see the active story-library
folder. Desktop builds can choose another library folder, restore the default,
or reveal it in the system file manager.

_Project default_ sets the parent directory used for new and imported project
folders. Changing it does not move existing projects.

## Project Folder Contents

A desktop project folder contains normal files and directories:

- `twine.toml` describes the project and its stories;
- `passages/` contains passage source files;
- `scripts/` and `styles/` contain story JavaScript and CSS;
- `assets/` contains images, audio, video, and other project files; and
- `.twine/` contains graph layout and application metadata.

The `.twine/` directory may be hidden by your file manager. Keep it when
copying or backing up a project if you want to preserve graph and application
metadata.

The project folder is twine.rs's full-fidelity working format. Published HTML
and Twee are useful interchange formats, but they don't preserve every
project-folder detail.

## Opening an Existing Folder

Choose _Import_ on the _Projects_ screen, then choose _Open Project Folder_.
Select the `.twine.rs` directory itself. Twine adds the stories it finds to the
library and opens large folders progressively so that the project shell can
appear before every passage body has loaded.

The desktop app also accepts a project-folder path on the command line; see
[Command-Line Switches](../customizing/command-line.md).

## External Editors and Source Control

Because project files are visible, you can edit them with other tools or keep
the folder under source control. Twine watches every open project folder.
Nonconflicting changes are applied to the active project. If a disk edit and an
in-app edit overlap, Twine asks you to
[review the external change](conflicts.md).

Do not edit generated `.twine/` metadata concurrently in multiple tools unless
you are prepared to choose which copy to keep.
