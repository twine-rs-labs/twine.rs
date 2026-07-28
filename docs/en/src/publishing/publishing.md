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

Play, Test, and Proof are previews, not exports. On desktop they use temporary
copied assets and an opaque address owned by a Twine preview window. That
address cannot be shared or used after its preview session ends; export a file
when you need durable or distributable output.

## HTML Options and Assets

_Classic Twine compatibility_ omits twine.rs graph metadata so another Twine
tool can read the exported HTML more easily. Leave it off when preserving
twine.rs graph data matters more than classic interchange.

For a file-backed project in the desktop app, _Embed referenced media_ replaces
supported, statically indexed local media URLs with data URLs in Playable HTML.
The project source and files under `assets/` are not changed. PNG, JPEG, GIF,
SVG, WebP, MP3, M4A, OGG, WAV, MP4, and WebM are supported. Remote URLs,
dynamic JavaScript URLs, external scripts and stylesheets, URL fragments, and
unused files remain external.

The option turns on automatically only after asset scanning finishes, every
candidate size is known, no more than 25 files are involved, and the estimated
encoded media is at most 25 MiB. You can make a different choice for the
selected story. The actual build report lists embedded, external, unresolved,
and unsupported media and uses the bytes read during export. A complete report
covers supported static references; it is not a guarantee that arbitrary
network requests or dynamic story JavaScript work offline.

Browser projects cannot enable this option because a project-relative URL does
not grant the browser permission to read a desktop file. Keep referenced media
at the same relative paths when embedding is unavailable or turned off.

Missing assets appear as warnings and are skipped. Story error diagnostics are
shown for review, but warnings don't block export. A story-format
publish-safety error does prevent HTML and archive builds. Choose _Fix in
Diagnostics_ when the Build screen offers it.

## Inspecting a Build

Choose _Inspect output_ to open a read-only drawer. _Source_ summarizes the
story, passages, links, assets, diagnostics, and a Twee preview. _HTML_ reports
the prepared files, size, story-data blocks, twine.rs graph metadata, and the
actual referenced-media embedding report. You can copy the inspection text.

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
