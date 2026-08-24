# Working with Assets

Choose _Assets_ from the workspace rail to manage the images, audio, video,
stylesheets, scripts, and other files used by the current story.

The exact markup used to display or play an asset depends on the active story
format. Check that format's documentation when the generated snippet isn't
enough for the effect you want.

## Adding Assets

In the desktop app, _Choose Asset_ opens a file picker and copies the selected
file into the project's `assets/` directory. _Import Asset_ accepts a source
path directly. Imported files use a project-relative path such as
`assets/cover.png`.

The browser app can't copy arbitrary files into a desktop project directory.
Its Assets screen therefore works primarily from paths and references already
known to the story. Use a desktop project folder for complete file-backed asset
management.

## Browsing and Finding Problems

The left side of the Assets screen shows project folders and two issue filters:

- _Missing_ lists paths referenced by the story whose files couldn't be found.
- _Unused_ lists files in the project inventory that aren't referenced by
  indexed story source.

Search matches paths, types, generated snippets, and source names. Assets can be
sorted by name, type, size, or reference count and viewed as a grid or table.
The inventory badge reports whether Twine is scanning a live folder or using
story references as a fallback.

Selecting an asset shows its preview when supported, path, type, dimensions or
duration, size, modification time, reference count, and publish rule. The
_Used In_ list opens the source location for an indexed reference.

## Using an Asset

The details panel provides:

- _Preview_ for supported images, audio, and video;
- _Copy Snippet_ to copy story-format markup;
- _Insert into Passage_ to add the snippet to story source;
- _Find Usages_ to reveal the first indexed reference;
- _Test First Usage_ to test from the first indexed asset reference whose
  passage still exists; and
- _Reveal in Folder_ to show a file-backed asset in the system file manager.

Use project-relative URLs in story source. For example, an imported file at
`assets/images/pear.png` should normally be referenced by that same path.

## Renaming, Replacing, and Deleting

_Rename_ moves a file-backed asset and updates indexed story references.
_Replace File_ keeps the asset path while replacing its contents. _Delete_
removes the file and its indexed references. These operations require a
desktop project folder to change files on disk.

Choose _Validate References_ after external file changes if you want to refresh
the live inventory and recheck the story's asset paths immediately.

## Previewing and Publishing

Play, test, and proof actions in the desktop app copy the build's referenced
project assets into a bounded temporary package. Twine serves that exact package
from an opaque preview origin so relative, root-relative, query-bearing, and
percent-encoded asset URLs work without giving the story access to the project
folder. Closing or replacing the preview releases the package; previewing never
links the project asset directory or changes its files.

The [Build & Export](../publishing/publishing.md) screen reports missing assets.
For a file-backed desktop project, Package export can copy the actual bounded
asset bytes into a checksummed archive and report anything it could not include.

For desktop Playable HTML export, _Embed referenced media_ can place supported
statically referenced images, audio, and video into the HTML as data URLs. It
supports PNG, JPEG, GIF, SVG, WebP, MP3, M4A, OGG, WAV, MP4, and WebM. Encoding
increases output size, so the Build screen estimates the expanded size and
defaults the option off for incomplete scans, unknown sizes, more than 25
candidate files, or more than 25 MiB of encoded media.

The build report identifies indexed media that remained external because it
was missing, unreadable, changed after indexing, unsupported, exceeded a
limit, or used a URL fragment. Unsafe, ambiguous, dynamic, remote, and escaped
source expressions are not indexed as managed project-media references, remain
unchanged, and are outside the report's completeness boundary. The browser app
does not offer embedding because it does not own persistent binary contents or
permission to read the corresponding desktop files.
