# Publishing a Story

Open _Build & Export_ from the workspace rail, then use its _Export_ view. The
screen checks the current story format, diagnostics, and assets before
preparing output.

## Choosing an Export Format

- _Playable HTML_ creates the story-format runtime and story data needed to play
  in a web browser.
- _Twee Source_ creates readable interchange source with story and passage
  metadata. It doesn't include the runtime or asset files.
- _JSON_ exports structured story data for tools and version control. It can be
  pretty-printed for readable diffs.
- _Archive (.zip)_ contains playable HTML, Twee, JSON, a package manifest, and
  an asset copy plan. The copy plan describes project assets; the archive does
  not currently include their binary file contents.

Choose the format and its options, then choose _Export_ followed by the format
name. Your browser or desktop environment will ask where to save the generated
file.

The output filename doesn't change the title inside the story. To change that
title, [rename the story](../story-library/renaming.md) before exporting.

## HTML Options and Assets

_Classic Twine compatibility_ omits twine.rs graph metadata so another Twine
tool can read the exported HTML more easily. Leave it off when preserving
twine.rs graph data matters more than classic interchange.

The Build screen also displays an _Inline all assets_ option and automatically
turns it off for large asset plans. This control is not yet connected to
package generation. Don't rely on the current HTML export to contain asset
binaries. Keep external files at the same relative paths used by the story, or
upload them with the HTML.

Missing assets appear as warnings and are skipped. Story error diagnostics are
shown for review, but warnings don't block export. A story-format
publish-safety error does prevent HTML and archive builds. Choose _Fix in
Diagnostics_ when the Build screen offers it.

## Inspecting a Build

Choose _Inspect output_ to open a read-only drawer. _Source_ summarizes the
story, passages, links, assets, diagnostics, and a Twee preview. _HTML_ reports
the prepared files, size, story-data blocks, and whether twine.rs graph metadata
is present. You can copy the inspection text.

The _Build output_ section records actions and diagnostics from the current
screen. It can be cleared without affecting the project or exported files.

The _Prepare publish package_ button prepares the story using the publish target
and records the result in Build output. It doesn't upload to a hosting service.
Export a file and upload it yourself.

## Now That I Have a Published File, What Do I Do?

You can publish your story anywhere an HTML file can be hosted. You could send
it directly to other people or upload it to a website. Some cloud file hosting
services only offer downloads and won't play an HTML story directly.

Two services that offer Twine-specific hosting are
[Borogove](https://borogove.app) and [Itch.io](https://itch.io). Itch is more of
a marketplace, while Borogove is more closely aligned with the interactive
fiction community.
