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
- _Package (.zip)_ contains playable HTML, canonical Twee and JSON source,
  eligible project asset bytes, a manifest, and SHA-256 checksums.

For HTML, Twee, and JSON, choose the format and its options, then choose
_Export_ followed by the format name. Your browser or desktop environment will
ask where to save the generated file. Package export uses the review flow
described below.

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
publish-safety error does prevent HTML and Package builds. Choose _Fix in
Diagnostics_ when the Build screen offers it.

## Creating an Offline Package

Asset-complete Package export reads project assets from file-backed projects in
the desktop app; stories with no managed or referenced project assets can also
be packaged in the browser app. Choose _Package (.zip)_, then _Prepare Package_.
Preparation takes one revision-locked snapshot; it does not save a file. The
review shows the included, unavailable, excluded, and external counts, scoped
completeness, and up to 100 warnings or blockers; every finding remains recorded
in `_twine-package/manifest.json`. If the story changes after preparation,
prepare it again before saving.

The archive preserves each eligible regular file under `assets/` at its exact
logical path. Known operating-system metadata is excluded. Missing, unreadable,
changed, oversized, nonportable, external, and unsupported items are reported
explicitly instead of being silently omitted. Portability collisions and
security failures block saving; other omissions produce an incomplete package
that requires explicit confirmation. Applied file-count and byte limits are
recorded in `_twine-package/manifest.json`; the asset per-file and total-byte
fields measure original file bytes, not base64 transport size.

`_twine-package/manifest.json` lists canonical source, derived output, included
asset hashes, dependency assessments, exclusions, and failures. `SHA256SUMS`
covers every other archive entry. JSON and Twee preserve the captured project
source; only the derived playable HTML rewrites indexed local references to
their packaged `assets/` paths.

_Complete in assessed scopes_ means all project asset bytes and statically
visible runtime dependencies covered by the report are present. Copied CSS is
scanned for `url()` and `@import` references. Dynamic JavaScript dependency
discovery is always marked _not evaluated_; a story can still make a runtime
network request that static analysis cannot predict. External or unknown
dependencies are visible in the review and manifest, so an incomplete package
never claims to be fully offline.

Choose _Save Complete Package_ to save the reviewed archive bytes. An
incomplete result instead offers _Save Incomplete Package_ and asks for
confirmation. A package copied to another machine needs only its extracted
contents for every dependency the manifest reports as packaged; it does not
refer back to the original project directory.

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
