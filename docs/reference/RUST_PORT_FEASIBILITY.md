# Rust Port Feasibility Notes

This reference records the initial TwineJS codebase analysis, the performance chokepoints, and the first incremental interop ideas. The current product direction is a greenfield, mode-native editor with a Rust core; the older strangler-port notes remain useful as parity-harness thinking.

That direction is now tracked concretely in [`TWINE_RS_STACK_STRATEGY.md`](./TWINE_RS_STACK_STRATEGY.md) (architecture), [`TWINE_RS_MILESTONES.md`](./TWINE_RS_MILESTONES.md) (M-series feature roadmap), and [`TWINE_RS_DESIGN_SYSTEM_SPINE.md`](./TWINE_RS_DESIGN_SYSTEM_SPINE.md) (D-series UI-spine roadmap).

Local checkout:

- Repository: `https://github.com/klembot/twinejs`
- Branch: `develop`
- Commit: `5f2a69d5c475f9b1c0e266780dadc9e1b7507cec`
- Package version: `2.12.0`
- License: `GPL-3.0`

## Short Answer

A Rust port is technically feasible, but a full one-for-one rewrite of Twine is probably the wrong first move if the immediate problem is huge-project performance.

The better first project is a Twine-compatible or Twine-inspired editor with a Rust core and a deliberately redesigned story map. Twine's current bottlenecks are not just "JavaScript is slow." The local source points to broad React render fanout, array-shaped story state, repeated whole-story scans, SVG/DOM link rendering, search indexes rebuilt on demand, and full-story publish/save paths.

For a performant editor focused on a custom Harlowe fork, feasibility is high. For a complete drop-in replacement for all Twine 2 behavior, feasibility is much lower because the product surface area is large.

## Current Architecture

Twine is a TypeScript/React app packaged for browser and Electron.

Important dependencies from `package.json`:

- React 16
- Vite
- Electron 41
- CodeMirror 5
- Fuse.js
- react-draggable
- localStorage and Electron IPC persistence paths

The core story model is in `src/store/stories/stories.types.ts`.

- `StoriesState` is `Story[]`.
- Each `Story` owns `passages: Passage[]`.
- Each `Passage` stores text, position, size, tags, selected/highlighted state, and story ID.

That shape is easy to reason about, but it means many normal operations scan or rebuild large arrays.

## Performance Chokepoints

### 1. Story map renders every passage

`src/routes/story-edit/story-edit-route.tsx` passes the entire `story.passages` array into `MarqueeablePassageMap`, `PassageMap`, connection rendering, and fuzzy finder.

`src/components/passage/passage-map/passage-map.tsx` then renders:

- `PassageConnections` for all passages.
- `PassageCardGroup` for all passages.

There is no viewport-level virtualization. A huge story means thousands of React components, DOM nodes, draggable wrappers, card contents, and SVG link paths.

The file already contains comments about avoiding rerenders during drag and zoom because they have a large performance impact. That suggests the app is already pushing against the architecture's limits.

Rust alone would not fix this if the UI still mounts every card and link.

Best fix:

- Render only visible cards.
- Keep drag/selection state local during pointer movement.
- Draw links on canvas/WebGL or at least virtualize SVG links.
- Keep text excerpts and layout geometry precomputed.

### 2. Passage cards are sorted and mapped on every passage-array change

`src/components/passage/passage-card-group.tsx` sorts all passages by `top` and `left`, then maps them to `PassageCard` components.

This is `O(n log n)` for every changed `passages` array. Since reducers frequently create a new `passages` array, memoization does not help much under heavy editing.

Best fix:

- Maintain a spatial index or sorted visible list in the model layer.
- Use stable passage IDs and per-passage subscriptions.
- Avoid sorting the whole project when only the viewport needs visible passages.

### 3. Link connections are recomputed from passage text

`src/components/passage/passage-connections/passage-connections.tsx` calls `passageConnections(passages)` for normal links and again with a format-specific reference parser.

`src/store/stories/getters.ts` builds a passage-name map, parses each passage's text, and creates connection maps. This runs whenever the `passages` array changes.

`src/util/parse-links.ts` uses regex extraction over passage text. For large stories, link graph work should be incremental instead of recomputed from every passage.

Best fix:

- Store outgoing links per passage.
- Reparse only the changed passage.
- Maintain backlinks and broken-link sets incrementally.
- Keep a format-aware parser in Rust or Wasm for your Harlowe fork.

### 4. Bulk passage updates are worse than they need to be

`src/store/stories/reducer/update-passages.ts` reduces over passage IDs and calls `updatePassage` for each one.

`src/store/stories/reducer/update-passage.ts` scans stories, checks for name conflicts, and maps the whole passage array.

That means bulk updates can become approximately `O(k * n)` where `k` is the number of changed passages and `n` is total passages. Dragging many selected cards and marquee selection are vulnerable.

Best fix:

- Store passages by ID.
- Apply batch updates in a single pass.
- Maintain selected IDs separately from passage data.
- Make selection and drag transient UI state until commit.

### 5. Selection and marquee scan the full story

`src/routes/story-edit/marqueeable-passage-map.tsx` maps over all passages to create temporary selected copies while dragging a selection rectangle.

`src/store/stories/action-creators/select-passage.ts` scans all passages for select all, deselect all, exclusive selection, and rectangle selection.

This is manageable for small stories, but it becomes noticeable at thousands of cards.

Best fix:

- Use a spatial index for rectangle selection.
- Represent selection as a `Set<PassageId>`.
- Let temporary marquee state live outside the persistent story object.

### 6. Fuzzy search rebuilds its index per query

`src/store/stories/getters.ts` creates a new `Fuse(passages, ...)` inside `passagesMatchingFuzzySearch`.

`src/routes/story-edit/passage-fuzzy-finder.tsx` calls this as the user types, debounced by 100ms.

For huge projects, rebuilding the index repeatedly is expensive.

Best fix:

- Maintain a persistent search index.
- Incrementally update changed passages.
- Consider Tantivy, fst, or a compact custom trigram/fuzzy index in Rust.

### 7. Find/replace and renaming can cascade through the whole project

`src/store/stories/action-creators/find-replace.ts` loops across all passages, dispatching updates per passage.

`src/store/stories/action-creators/update-passage.ts` updates linked text after passage renames by scanning all passages and recursively dispatching updates.

For large projects, these operations should be planned and applied as one transaction.

Best fix:

- Compute all affected passage IDs first.
- Apply a single batch update.
- Use link indexes/backlinks to avoid scanning unrelated passages.

### 8. Empty linked-passage cleanup does whole-story parsing

`src/store/stories/action-creators/delete-orphaned-passages.ts` has a source comment noting a potentially `O(n)` check. It scans passages and parses text to decide if an orphaned passage is still linked elsewhere.

Best fix:

- Use backlinks maintained by the story graph index.
- Make orphan cleanup a graph query instead of a text scan.

### 9. Persistence and publishing are whole-story heavy

Electron persistence saves story HTML after meaningful changes:

- `src/store/persistence/electron-ipc/stories/save-middleware.ts`
- `src/store/persistence/electron-ipc/stories/save-story.ts`
- `src/util/publish.ts`
- `src/electron/main-process/story-file.ts`

The desktop path publishes the whole story to HTML and writes it to disk. Browser localStorage splits story/passages into keys, but update paths still frequently save story metadata and changed passages.

Best fix:

- Use SQLite/redb/sled or another indexed store for project data.
- Save changed passages incrementally.
- Treat HTML/Twee export as explicit export or background snapshot, not the primary editing store.

## What Rust Would Help With

Rust is a very good fit for:

- Story graph model and stable IDs.
- Incremental link/reference parsing.
- Format-specific parsing and diagnostics for a Harlowe fork.
- Search indexing.
- Spatial indexing for viewport queries and marquee selection.
- Import/export for Twee, Twine HTML, and custom formats.
- Persistent project storage.
- Batch transactions, undo/redo records, and project repair.
- Background workers that do not block the UI thread.

Rust is not enough by itself for:

- Rendering thousands of DOM card components.
- Keeping every link as SVG/React elements.
- React context updates that rerender broad subtrees.
- CodeMirror 5 behavior in huge individual passages.

The project needs a data-flow and rendering redesign, not only a language swap.

## Recommended Architecture

### Rust Core

Core crates:

- `twine_model`: stories, passages, tags, coordinates, IDs.
- `twine_graph`: links, references, backlinks, broken links, graph stats.
- `twine_parse`: Twee/Twine HTML/custom Harlowe fork parser.
- `twine_search`: search/fuzzy index.
- `twine_store`: project persistence and migrations.
- `twine_export`: HTML/Twee/custom export.
- `twine_commands`: Tauri command boundary or FFI/Wasm boundary.

Use a normalized model:

- `StoryId`
- `PassageId`
- `HashMap<PassageId, Passage>`
- `HashMap<PassageName, PassageId>`
- `HashMap<PassageId, LinkSet>`
- `HashMap<PassageId, BacklinkSet>`
- `HashSet<PassageId>` for selection
- Spatial index for passage bounds

### UI Shell

Best first shell: Tauri with a web frontend.

Reason:

- Keeps desktop packaging sane.
- Lets you reuse browser UI/editor tech where it makes sense.
- Moves expensive model/storage/search/export work into Rust.
- Avoids rebuilding every control natively on day one.

The map should not be a direct port of the current React passage map. It should be virtualized or canvas/WebGL based from the start.

Candidate frontend choices:

- React with a new map renderer.
- Solid/Svelte for finer-grained UI updates.
- Canvas/WebGL for the story map.
- CodeMirror 6 or Monaco for passage editing.

Full native Rust GUI is possible, but only worth it if the goal is a new editor identity rather than a practical performance-first replacement.

## Suggested Prototype

### Milestone 1: Corpus and benchmarks

Create synthetic projects at 1k, 5k, 10k, and 50k passages.

Benchmark:

- Load/import time.
- Link extraction.
- Search startup and query time.
- Rectangle selection.
- Dragging 1, 100, and 1000 passages.
- Export time.
- Memory use.

### Milestone 2: Rust story core

Implement:

- Normalized story graph.
- Incremental passage update.
- Link parser for standard Twine links and your Harlowe fork.
- Backlink/broken-link index.
- Search index.
- Spatial index.

Expose commands:

- `load_project`
- `save_project`
- `get_visible_passages(viewport, zoom)`
- `get_visible_links(viewport, zoom)`
- `update_passage_text`
- `move_passages`
- `select_rect`
- `search_passages`
- `export_story`
- `diagnostics`

### Milestone 3: Fast map spike

Build only the editor canvas:

- Pan/zoom.
- Visible passage cards.
- Link rendering.
- Selection rectangle.
- Drag selected passages.
- Open/edit a passage.

Do not build full Twine compatibility yet. This spike answers whether the architecture solves the actual pain.

### Milestone 4: Format integration

Add your Harlowe fork:

- Parser.
- Compiler/exporter.
- Diagnostics.
- Reference/link extraction.
- Macro awareness if useful.

### Milestone 5: Compatibility envelope

Decide intentionally what "compatible" means:

- Import existing Twine HTML?
- Export Twine-compatible HTML?
- Support only your format?
- Support SugarCube/Snowman/etc.?
- Preserve Twine project storage?

The narrower this is, the more feasible the project becomes.

## Feasibility Ratings

Fast editor for your custom format:

- Feasibility: 8/10
- Likely first impressive prototype: weeks
- Production polish: months

Rust/Tauri Twine-like editor with partial Twine compatibility:

- Feasibility: 7/10
- Strong performance upside
- Compatibility decisions matter a lot

Full drop-in Rust replacement for Twine 2:

- Feasibility: 4/10 solo
- The hard part is not Rust. It is matching all UX, import/export, story-format, browser/desktop, accessibility, migration, localization, and packaging behavior.

## Biggest Early Wins Without a Full Port

If optimizing Twine itself before porting:

1. Change `updatePassages` to apply batch updates in one pass.
2. Memoize or persist the Fuse index instead of rebuilding per search.
3. Store link parsing results per passage and update them incrementally.
4. Replace whole-map rendering with viewport virtualization.
5. Replace SVG link rendering with canvas for large maps.
6. Represent selection outside each `Passage` object.
7. Avoid publishing full story HTML on every small desktop edit, or move it to a debounced/background path.

These would also make a Rust port easier because they define the right model boundary.

## Verdict

Do not port the current app line-for-line.

Build `twine.rs` as a Rust-native story engine plus a fast map/editor UI. Keep compatibility only where it serves your format and migration needs. The biggest win will come from an indexed, incremental model and a virtualized/canvas map; Rust is the right tool for the core, but the rendering architecture is what will decide whether huge projects feel fast.

## Incremental Interoperability Approach

The least risky path is a "strangler" architecture: keep Twine's current UI running while Rust gradually takes ownership of the expensive domains behind a stable adapter.

The key is to avoid making "rewrite the app" the first unit of work. Instead, make the first unit of work an interop boundary that both old Twine-style code and new Rust code can use.

### Layer 1: Rust as a pure analysis engine

Start with Rust compiled to WebAssembly and called from the existing renderer.

Rust owns:

- Link extraction.
- Reference extraction for your Harlowe fork.
- Story graph construction.
- Broken-link detection.
- Backlink queries.
- Basic story statistics.

Current Twine still owns:

- React UI.
- Existing `Story` / `Passage` objects.
- Existing persistence.
- Existing editor dialogs.

Interop shape:

```ts
type PassageSnapshot = {
	id: string;
	name: string;
	text: string;
	left: number;
	top: number;
	width: number;
	height: number;
};

type GraphIndex = {
	updatePassage(passage: PassageSnapshot): void;
	removePassage(id: string): void;
	connections(): ConnectionSnapshot[];
	brokenLinks(): BrokenLinkSnapshot[];
	backlinks(passageId: string): string[];
};
```

This can be added to Twine without changing the app shell. It gives immediate benchmark data and lets Rust prove value early.

Why WASM first:

- It works in browser Twine and Electron Twine.
- It avoids native module packaging pain.
- It is easy to feature-flag against the TypeScript implementation.
- It creates reusable Rust crates for later Tauri work.

### Layer 2: Rust as search/index service

Next, move fuzzy search and exact search into Rust.

Current chokepoint: `passagesMatchingFuzzySearch()` rebuilds a Fuse index per query. Replace that with a persistent index that is updated on passage changes.

Interop shape:

```ts
type SearchIndex = {
	rebuild(passages: PassageSnapshot[]): void;
	updatePassage(passage: PassageSnapshot): void;
	removePassage(id: string): void;
	query(text: string, limit: number): SearchResult[];
};
```

This is a strong incremental win because the UI can stay almost identical while the expensive part changes.

### Layer 3: Rust as model mirror

At this stage, Rust receives every story action and maintains a normalized mirror of the project.

Current Twine state remains authoritative at first. Rust is used for derived data:

- Visible passage queries.
- Link queries.
- Search queries.
- Stats.
- Diagnostics.

The adapter compares Rust results against existing TypeScript results in development builds. This is a good way to catch semantic mismatches before Rust becomes authoritative.

Interop shape:

```ts
type StoryCoreMirror = {
	loadStory(story: StorySnapshot): void;
	apply(action: StoryActionSnapshot): CorePatch;
	query<T extends CoreQuery>(query: T): CoreQueryResult<T>;
};
```

The important idea is `CorePatch`: Rust can say what changed without forcing React to replace the entire story object.

### Layer 4: Rust as authoritative project store

Once Rust mirrors the current model correctly, flip the ownership:

- Rust owns story state.
- TypeScript dispatches commands.
- Rust returns patches/events.
- React subscribes to only the slices it needs.

This is where a compatibility adapter matters most. Build an adapter that can still expose Twine-like data to old components:

```ts
type StoryRepository = {
	getStory(id: string): Story;
	getPassage(id: string): Passage;
	getPassages(ids: string[]): Passage[];
	subscribePassage(
		id: string,
		callback: (passage: Passage) => void
	): Unsubscribe;
	subscribeVisiblePassages(
		viewport: Viewport,
		callback: (items: Passage[]) => void
	): Unsubscribe;
	command(command: StoryCommand): Promise<CorePatch>;
};
```

Old components can keep using `Story` and `Passage` for a while, but the app stops treating `story.passages` as the master data structure.

### Layer 5: Replace the map, not the whole UI

After the core exists, replace the map with a new component that talks to Rust directly:

- `get_visible_passages(viewport, zoom)`
- `get_visible_connections(viewport, zoom)`
- `select_rect(rect, mode)`
- `begin_drag(ids)`
- `preview_drag(delta)`
- `commit_drag(delta)`

This is the moment huge-project performance should visibly change. The surrounding toolbar, dialogs, story list, and passage editor can remain web UI.

Use canvas/WebGL for links first. Cards can be virtualized HTML initially, then moved to canvas if needed.

### Layer 6: Move persistence behind the same adapter

Only after the model and map work should persistence move to Rust.

Rust owns:

- Project file format.
- Incremental saves.
- Migration.
- Import/export.
- Snapshots/backups.

The app can still import and export Twine HTML/Twee, but the editing store should be an indexed project file or directory, not constantly regenerated HTML.

Good storage candidates:

- SQLite if you want inspectability and migrations.
- redb if you want an embedded Rust-native key/value store.
- A project directory with JSON/TOML metadata plus one passage file per passage if diffability matters.

### Layer 7: Swap Electron for Tauri last

Do not make Tauri the first milestone unless packaging size/security is the immediate goal.

Electron to Tauri is valuable, but it is not the core performance fix. If the current React map still renders every passage, Tauri will not save it.

Swap shells once:

- Rust core is already authoritative.
- Persistence is in Rust.
- The web UI already talks through command/query adapters.
- The old Electron-specific APIs are isolated.

At that point, moving to Tauri is mostly replacing the host boundary, not rewriting the product.

## Practical Migration Sequence

1. Add benchmark fixtures.
2. Create Rust crates for parser, graph, and search.
3. Build a WASM package consumed by the current TypeScript app.
4. Feature-flag Rust graph/search against existing TypeScript behavior.
5. Add a `StoryRepository` adapter in TypeScript.
6. Move derived queries to Rust.
7. Make Rust maintain a full mirror of story state.
8. Replace the passage map with a viewport-driven map.
9. Make Rust authoritative for story state.
10. Move persistence/export to Rust.
11. Replace Electron with Tauri if still desired.

## Compatibility Strategy

Support three compatibility levels explicitly:

### File compatibility

Can import/export Twine HTML and Twee, but the internal project file can be new.

This is the best target for `twine.rs`.

### Format compatibility

Can run or export your Harlowe fork correctly. Other formats are optional.

If you only need your fork, do not inherit Twine's full story-format compatibility burden.

### UI compatibility

Feels familiar to Twine users, but does not need to preserve every implementation detail.

This frees you to redesign the map, selection, search, and project storage around huge stories.

## Best First Interop Experiment

The first real experiment should be:

- Rust/WASM link parser and graph index.
- TypeScript adapter that feeds it Twine `Passage` snapshots.
- Development-mode parity tests against `passageConnections()`.
- Benchmark on 1k, 5k, 10k, and 50k generated passages.
- Replace only `PassageConnections` data generation, not the visual renderer yet.

That answers a crucial question cheaply: can Rust maintain the graph incrementally and return useful data faster than the current all-passages scan? If yes, the same pattern can take over search, diagnostics, spatial indexing, then the map.

Initial setup for this step lives in `benchmarks/`:

- `npm run bench:fixtures` generates 1k, 5k, and 10k passage corpora.
- `npm run bench:fixtures:large` also generates a 50k passage corpus.
- Generated files are written to `benchmarks/fixtures/generated/` and ignored by Git.

The first Rust core skeleton lives in `crates/`:

- `twine_model`: story and passage types.
- `twine_parse`: standard link parsing.
- `twine_graph`: graph indexing over fixture stories.
- `twine_search`, `twine_store`, and `twine_export`: initial boundaries for upcoming work.
- `twine_cli`: fixture-loading smoke CLI.
