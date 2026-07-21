# Desktop referenced-media embedding

Status: completed
Owner: core, native-platform, build, and frontend maintainers
Last verified: 2026-07-21
Source of truth: shipped desktop HTML export and asset-reference behavior
Parent roadmap: [Product depth and legacy retirement](../../roadmap/product.md)

## Outcome

Desktop Playable HTML export can embed supported, statically referenced project
media into one HTML file. After the HTML is moved away from its project, that
managed media still loads without a sibling `assets/` directory.

The feature is called **Embed referenced media**, not **Inline all assets**.
Project assets remain ordinary files under `assets/`; embedding is an export
transformation and never changes canonical project source.

## Starting state

- The Build screen displays an **Inline all assets** switch, applies count and
  raw-size defaults, and changes informational notes.
- The switch value does not enter `PublishOptions`,
  `StoryBuildPackageOptions`, or `createStoryBuildPackage()`.
- HTML generation receives asset inventory metadata but never reads or embeds
  asset bytes and does not rewrite references.
- Play, Test, and Proof in Electron work with file-backed assets because the
  desktop host copies or links the asset plan beside scratch HTML.
- HTML export saves one HTML blob and does not copy sibling assets.
- Package export records `asset-copy-plan.json` but does not add asset bytes.
- Rust/WASM `ProjectSession` analysis is authoritative in both browser and
  Electron renderers. The TypeScript story index is a deterministic test model,
  not a production browser fallback.

## Product contract

### Included in the first release

- Desktop Electron projects backed by a validated `.twine.rs` project folder.
- Literal local media references returned by the authoritative Rust session
  from passage text, Story JavaScript, and Story Stylesheet.
- PNG, JPEG, GIF, SVG, WebP, MP3, M4A, OGG, WAV, MP4, and WebM payloads.
- Format-neutral source transformation before normal story-format publishing.
- Exact build reporting for embedded, external, missing, unavailable, and
  unsupported assets.
- An unchanged external-reference build when embedding is off.

The inliner acts on exact source ranges returned by Rust. It does not parse or
special-case Harlowe, SugarCube, Chapbook, Snowman, or a particular Harlowe
dialect. Each bundled format still needs an offline export acceptance test.

### Explicitly excluded

- Browser asset embedding.
- Browser binary-asset persistence, IndexedDB/OPFS storage, retained File
  System Access handles, or export-time file reselection.
- Dynamically constructed JavaScript URLs.
- Remote URLs and existing `data:` or `blob:` URLs.
- External JavaScript and stylesheet file embedding.
- Recursive dependency bundling from external CSS or JavaScript.
- Unused project files.
- Adding asset bytes to Package export.
- Multi-file output-directory export and online publishing.

Browser mode must show embedding as unavailable rather than accept an option it
cannot honor. Browser support requires a separate persistent binary-asset
model; a source string such as `assets/cover.png` is not permission to read that
file. V1 reports completion for its managed static-reference contract; it does
not claim to discover dynamic runtime loads or guarantee that arbitrary story
JavaScript works offline.

## Architecture

```text
Rust/WASM ProjectSession
  asset references and exact source ranges
                  |
native Rust addon through Electron main
  validated project-root byte reads and MIME types
                  |
renderer publishing hook
  preloads bounded asset payloads
                  |
platform-independent source transformer
  cloned story with data URLs plus an embedding report
                  |
existing story-format publisher and build package
```

### Ownership boundaries

- Rust owns reference discovery, canonical project-relative paths, source
  ranges, and reference classification.
- The native Rust addon owns project-root validation and filesystem reads.
  Electron main exposes only the bounded operation through preload; renderer
  code never receives an unrestricted arbitrary-path read primitive.
- The publishing hook coordinates asynchronous payload loading before invoking
  the synchronous package builder.
- A new TypeScript transformer owns byte-to-data-URL encoding, range-safe
  source replacement, and transformation reporting.
- Existing story-format publishing remains responsible only for inserting story
  data into the selected runtime.
- The TypeScript test session may mirror the richer reference contract for
  deterministic UI tests. It must not become a second product authority.

## Implementation phases

### Phase 1 — Make the exposed option truthful

- Rename the planned contract to **Embed referenced media** in product
  specification and implementation types.
- Until the pipeline is connected, hide or disable the current switch.
- Detect capability through an explicit preload-bridge method, not the
  user-agent string.
- In browser mode, explain that managed media embedding requires the desktop
  app.
- Keep current export behavior unchanged while the feature is unavailable.

### Phase 2 — Strengthen Rust asset references

Extend the authoritative Rust reference model so every replaceable reference
contains:

- canonical project asset path;
- source document and optional passage identity;
- complete source start and end offsets;
- original URL token;
- reference context where it can be determined; and
- query or fragment suffix information.

Reference discovery must cover:

- spaces, Unicode, and percent-encoded path characters;
- `assets/...`, `./assets/...`, and `/assets/...`;
- quoted HTML `src`, `href`, and `poster` values;
- individual `srcset` candidates;
- Story Stylesheet `url(...)` references; and
- literal occurrences already supported in passages and Story JavaScript.

Ambiguous, unsafe, dynamic, remote, and escaped occurrences remain external
and unchanged. They are excluded before the managed-reference inventory and
therefore sit outside the report's explicit completeness boundary; every
indexed managed reference must still be embedded or reported with an exact
reason.
Update generated TypeScript bindings and Rust tests. Update the deterministic
TypeScript test session only as needed for affected frontend tests, and keep
the Rust-authority import guard passing.

### Phase 3 — Add a constrained native desktop payload reader

Add a batch operation to `twine_native`, then expose it through a narrow
Electron main/preload IPC method accepting:

- the active project root;
- requested canonical project-relative asset paths; and
- build limits.

For every request, the native Rust addon must:

- resolve and canonicalize the project root and asset;
- require the resolved asset to remain below the project's `assets/` root;
- reject traversal, directories, unsupported file types, and symlink escapes;
- read a regular file only;
- return its canonical project path, exact MIME type, bytes, and observed size;
- enforce per-file and total-byte limits; and
- report files that changed, disappeared, or became unreadable after indexing.

Electron main must transport the native result without becoming a second
filesystem implementation. Do not expose `readFile(arbitraryPath)` to the
renderer. Prefer native buffers transferred as `ArrayBuffer`s instead of
JSON/base64 so encoding happens once in the transformer.

### Phase 4 — Implement the source transformer

Add a focused `inline-assets` utility with input shaped around:

- a complete cloned story;
- authoritative asset references;
- loaded `{path, mediaType, bytes}` payloads; and
- explicit size and type policy.

The transformer must:

1. group references by passage, Story JavaScript, and Story Stylesheet;
2. match references to payloads by canonical path;
3. create correctly typed base64 data URLs;
4. replace complete source ranges from right to left;
5. handle repeated and overlapping path names without global string
   replacement;
6. preserve the original story object and persisted source; and
7. return the transformed story and a structured embedding report.

Query and fragment suffixes need explicit tested behavior. Cache-busting query
strings may be removed when the complete local URL is replaced. A fragment may
be preserved only when the resulting media type and data URL semantics are
verified; otherwise the reference remains external with a reason.

Do not replace strings in final story-format HTML. Final-output replacement can
modify runtime code or text that Rust did not classify as an asset reference.

### Phase 5 — Extend build options and reporting

Add an explicit option:

```ts
assetMode: 'external' | 'inline-referenced';
```

Preload payloads in the asynchronous publishing hook, transform a cloned story,
then pass it to the existing synchronous package builder.

Extend the report with:

- `inlinedAssetCount`;
- `inlinedSourceBytes`;
- `inlinedEncodedBytes`;
- `externalAssetCount`;
- unresolved asset paths and reasons;
- unsupported asset paths and reasons; and
- `assetInliningComplete`.

Correct adjacent misleading terminology:

- `copiedAssetCount` must describe an actual copy or be renamed to
  `availableAssetSourceCount`;
- HTML fidelity must say whether referenced media bytes were embedded; and
- Package fidelity must not imply that file-backed asset bytes were archived.

Missing or unresolved assets do not silently disappear. Export may continue,
but the result must not be labeled fully offline or self-contained. Even a
complete V1 report means only that all supported, statically discovered
project-media references were embedded.

### Phase 6 — Connect desktop Build UI

- Show **Embed referenced media** only when the desktop bridge and a
  file-backed project provide the required capability.
- Pass `assetMode` through the Build route and publishing hook.
- Default embedding on only after asset scanning is complete, every candidate
  size is known, and estimated encoded size is within policy.
- Estimate base64 expansion, not only raw source bytes.
- Treat unknown sizes as a reason not to enable automatically.
- Show estimated candidate count and encoded size before export.
- Show actual embedded, skipped, and unresolved counts after export.
- Make output inspection and build logs use the same report.
- Keep the user's explicit choice stable while the story remains selected.

The initial 25-file limit may remain as a replacement-work safeguard. The
25 MiB policy must be evaluated against estimated encoded size and validated
again against bytes actually read.

### Phase 7 — Verification

#### Rust and contract tests

- Reference ranges for HTML attributes, `srcset`, CSS URLs, passage macros, and
  Story JavaScript literals.
- Spaces, Unicode, percent encoding, query strings, fragments, repeated
  references, and overlapping filenames.
- Remote, `data:`, `blob:`, traversal, and unsupported references remain
  external.
- Generated bindings match the Rust contract.

#### Native security tests

- Valid nested project assets can be read.
- Absolute paths, `..`, directories, symlink escapes, and paths outside
  `assets/` are rejected.
- Changed, missing, oversized, and unreadable files produce bounded structured
  failures.
- Total-size enforcement cannot be bypassed with repeated paths.

#### Transformer and build tests

- Binary-to-data-URL encoding and exact MIME types.
- Empty and non-UTF-8 files.
- Descending source-range replacement without source mutation.
- External mode preserves existing HTML behavior.
- Inline mode changes HTML and reports actual encoded size.
- Missing and unsupported files produce accurate report entries.
- UI choice reaches the build option and changes prepared output.
- Browser mode cannot enable the option.

#### End-to-end acceptance

For each supported bundled story-format family, export a desktop project
containing an image, audio file, video poster, CSS background, repeated
reference, and filename with spaces. Move the generated HTML into an empty
directory, disable network access, and verify:

- the story starts successfully;
- every supported referenced medium loads;
- no supported local `assets/...` reference remains;
- the original project source and asset files are unchanged; and
- the build report declares embedding complete.

At minimum, cover bundled Harlowe 3.3.9, SugarCube, Chapbook, and Snowman.

### Phase 8 — Documentation and cleanup

- Update the publishing and asset manuals with the shipped desktop-only
  behavior, supported media types, size impact, and unresolved-reference
  reporting.
- Update current status and the desktop/browser capability matrix.
- Remove the obsolete **Inline all assets** name and its presentation-only
  state.
- Move this document to `docs/archive/completed-plans/` once every exit
  criterion passes.

## Likely implementation areas

- `crates/twine_core/src/lib.rs`
- `crates/twine_native/src/lib.rs`
- `src/core/bindings/`
- `src/core/wasm/`
- `src/test-util/test-core-session-client.ts`
- `src/electron/main-process/ipc.ts`
- `src/electron/main-process/preload.ts`
- `src/electron/shared/electron-shared.types.ts`
- `src/store/use-publishing.ts`
- `src/util/build-package.ts`
- a new `src/util/inline-assets.ts`
- `src/routes/build/build-route.tsx`
- focused Rust, Jest, IPC, build, route, and Electron end-to-end tests

## Exit criteria

- Desktop output embeds every supported indexed local media reference or
  identifies the exact reason it remained external.
- A clean-directory, offline test passes for every supported bundled
  story-format family.
- Browser mode cannot select or imply desktop embedding.
- No arbitrary filesystem read capability is exposed to renderer code.
- Embedding never mutates project source or asset files.
- Encoded-size limits and reporting use bytes actually read.
- Build fidelity and copy terminology match real output.
- Rust remains the only production reference-discovery authority.
- User, product, architecture, and status documentation describe the shipped
  boundary.
