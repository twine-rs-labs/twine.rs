# Harlowe 3.3.9 native editor integration

`harlowe-parser-vendor.js` and `harlowe-macros-vendor.js` are generated from
the exact bundled Harlowe 3.3.9 format by
`scripts/extract-harlowe-editor-parser.mjs`.

Only Harlowe's pure Lexer, Patterns, and Markup modules and its static macro
metadata are retained. The CodeMirror 5 adapter, toolbar DOM, storage access,
and story runtime are excluded. The extracted code and metadata retain
Harlowe's Zlib license and copyright notice.

This parser is editor presentation state only. Twine RS core remains the
authority for project persistence, graph projections, diagnostics, and
publishing.

The provider is registered only for the exact bundled Harlowe 3.3.9 identity
and is loaded on demand for passage editors. Older bundled formats, user-added
formats, and future Harlowe dialects do not inherit this grammar or toolbar by
name or semver. They require a separate exact provider registration so parser,
macro metadata, preferences, and authoring behavior can evolve independently.

The native session reproduces the Harlowe 3.3.9 authoring surface without
reintroducing CodeMirror 5: syntax and cursor occurrences, macro/keyword
completion, cursor coding help, proofreading, scoped find/replace, keyboard
wrappers, preferences, and the format's direct and guided toolbar actions.
