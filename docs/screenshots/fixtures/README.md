# Publication screenshot fixture

`the-glass-orchard.twine.rs` is the clean synthetic project used for screenshot
generation. It is intentionally checked in so that recaptures use the same
story, graph, styling, and media instead of rebuilding disposable test data.

## Capture use

- Browser: import `the-glass-orchard.twine.rs/story.twee`.
- Electron: the folder is a valid split-passage project. For native Asset,
  export, and watcher screenshots, create a fresh directory project through
  the UI and import these checked-in assets through the native bridge; this
  exercises the user-visible file operations instead of relying on seeded
  inventory data.
- Standard presentation: 1920 × 1080, 100% zoom, dark theme.
- The broken `Locked Annex` link and the unused `winter-seal.svg` asset are
  deliberate. They make Diagnostics and Find Unused reproducible.

The three JPEG illustrations were generated once for this synthetic project
and are stored as ordinary fixture assets. They should not be regenerated for
routine recaptures. The constellation plate and seal are deterministic SVGs.
No personal data, usernames, absolute paths, credentials, or unrelated project
content belongs in this fixture.

## Artwork direction

- `orchard-atrium.jpg`: a moonlit, rain-wet Victorian glasshouse orchard with
  dark teal foliage and a restrained brass lamp.
- `moonflower-specimen.jpg`: a natural-history specimen plate on dark archival
  paper.
- `archive-key.jpg`: a brass archive key, citrus leaf, and constellation plate
  on bottle-green velvet.

All artwork is synthetic and contains no logos, text, people, or real-world
project material.
