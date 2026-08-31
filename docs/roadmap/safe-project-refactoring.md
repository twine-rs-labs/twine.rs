# Safe project-wide navigation and refactoring

Status: active
Owner: core, product, and frontend maintainers
Last verified: 2026-08-31
Source of truth: Rust project-session queries and commands, workbench navigation,
Diagnostics, Find/Replace, the existing application command registry, and
unified undo/redo

## Objective

Make everyday IDE-style navigation and multi-source changes reviewable,
revision-bound, and atomic. Rust plans each operation against explicit session,
buffer, external-file, and provider state and remains the sole authority for its
canonical changes. The frontend may review and select changes but may not author
or alter the executable change set. Apply succeeds only while every declared
precondition still holds.

## Starting point

- Passage rename already rewrites standard Twine `[[link]]` targets in one Rust
  transaction, but the current prompt applies immediately and shows no affected
  source preview. Story-format-specific semantic references are not covered by
  that standard-link rewrite.
- Revision-bound paged backlinks and passage navigation already exist. General
  symbol-reference and definition queries do not.
- Find/Replace already returns a revision, before/after excerpts, replacement
  counts, and exact text edits. Replace All remains one undoable Rust
  transaction, but it takes the original query and recomputes against current
  state instead of applying an immutable reviewed plan.
- Diagnostics carry quick-fix descriptors, but only a small deterministic
  subset is executable. Fix All Safe starts separate actions instead of one
  atomic batch.
- The global command palette already uses typed `AppCommand` and
  `AppCommandContext` contracts with a static application command collection.
  It does not yet accept lifecycle-safe route and tool contributions.
- Rust project sessions already own project revision, batch rollback, patch
  publication, indexes, dirty state, persistence acknowledgement, and structural
  undo/redo. The project host owns mutation reconciliation, persistence draining,
  and quick-fix dispatch.

## Entry gates

- Preserve the existing user worktree and session ownership boundaries. Refactor
  operations must not use `replaceProject`, create a frontend mutation owner,
  invoke the plan boundary directly from review components, or create a second
  undo stack.
- Treat the versioned v1 budgets below as blocking acceptance gates. A budget
  change must land and be justified separately before the implementation that
  depends on it; an implementation cannot relax its own gate to pass.
- Exercise the gates with the existing 10k/50k fixtures. Planning must remain
  below the synchronous browser-main-thread budget or run through worker/chunked
  execution that can process cancellation; a nominally cancellation-aware
  blocking WASM call is not sufficient.
- Preserve an incremental Rust-owned data path. Opening review must not build an
  unrequested complete frontend index or transfer the complete change set.

### V1 10k/50k feature gates

| Gate                                                     |                                                                                                          10k fixture |                                 50k fixture |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------: | ------------------------------------------: |
| Serialized summary DTO                                   |                                                                                                       at most 64 KiB |                              at most 64 KiB |
| One detail page                                          |                                                                                      at most 200 changes and 256 KiB |             at most 200 changes and 256 KiB |
| Live plan store                                          |                                                                           at most 8 plans, 10-minute TTL, and 64 MiB | at most 8 plans, 10-minute TTL, and 128 MiB |
| Selection expression                                     |                                                                                         at most 50,000 IDs and 4 MiB |                at most 50,000 IDs and 4 MiB |
| Summary generation p95                                   |                                                                                                       at most 250 ms |                            at most 1,000 ms |
| Detail-page fetch p95                                    |                                                                                                        at most 50 ms |                              at most 100 ms |
| Atomic model commit p95                                  |                                                                                                     at most 1,000 ms |                            at most 5,000 ms |
| Peak incremental Rust/WASM plus JavaScript memory        |                                                                                                       at most 64 MiB |                             at most 128 MiB |
| Retained frontend review model after close and forced GC |                                                                                                        at most 8 MiB |                              at most 16 MiB |
| Typing while planning                                    | edit-paint p95 no more than 5 ms above the accepted fixture baseline; zero attributable main-thread tasks over 50 ms |                                        same |

- Add `perf:electron:10k:refactor` and `perf:electron:50k:refactor` commands,
  backed by a `refactor` phase in the existing Electron harness and versioned
  metrics in `benchmarks/budgets.json`.
- Collect at least 3 warmups plus 20 measured summary and detail-page samples,
  10 isolated atomic-commit samples from reset fixture state, and 20 edit-paint
  windows while planning. Report p50, p95, maximum, serialized bytes, plan-store
  bytes, retained frontend bytes, and peak incremental memory.
- Both fixture commands must pass every structural assertion and table gate.
  Failure blocks the feature slice and the result is not eligible to become an
  accepted baseline.

## Canonical plan contract

### Rust-owned plan authority

- Add a bounded summary query for an immutable, session-owned proposed
  operation. The v1 summary contract is equivalent to:

  ```text
  RefactorPlanSummary {
    plan_id
    plan_digest
    project_revision
    operation_kind
    affected_entity_count
    change_count
    validation_failures
    coverage
    selection_capabilities
    first_detail_cursor
    expires_at
  }
  ```

- Keep the canonical executable plan in a bounded session-local LRU/TTL store.
  Plans do not survive application restart, project-session replacement, or
  eviction. Detail pages expose stable change/group IDs and before/after review
  data; they are not executable apply payloads.
- The frontend may submit only an opaque identity, expected global project
  revision, and a compact selection expression:

  ```text
  ApplyRefactorPlan {
    plan_id
    expected_project_revision
    selection: all
             | all_except(change_ids)
             | only(change_ids)
             | groups(group_ids, exclusions)
  }
  ```

  Selection identifies plan-owned changes. It never contains replacement
  ranges, replacement text, structural commands, or metadata values.

- Every canonical change declares dependency IDs and membership in a required
  atomic group. Individually selectable changes must be dependency-closed;
  required groups such as a passage rename and its accepted link rewrites cannot
  be split. Reject a non-closed selection as `invalid-selection` instead of
  silently expanding it beyond what the user reviewed.
- Enforce the feature-gate limits on selection ID count and serialized bytes.
  Return `selection-too-large` and require group selection or a narrower query
  when either limit is exceeded.

- Applying a plan validates its stored digest and preconditions and uses only
  the canonical Rust-owned changes. It never silently recomputes a different
  operation at confirmation time.
- Return typed failures including `stale-project-revision`, `buffer-changed`,
  `plan-expired`, `plan-evicted`, `provider-changed`, `persistence-conflict`,
  `invalid-selection`, `selection-too-large`, and `plan-too-large`.

### Complete plans and bounded detail pages

- A canonical plan is semantically complete. Its review details may be paged,
  but the operation itself is never truncated. If Rust cannot construct the
  complete change set within configured safety limits, planning returns
  `plan-too-large` and produces no applyable plan.
- Use immutable plan-bound cursors rather than raw offsets:

  ```text
  RefactorPlanCursor {
    plan_id
    plan_digest
    position
  }
  ```

- Page order and repeated fetches are stable for the life of the plan. Compact
  selection expressions must behave identically whether the user opens one,
  every, or differently ordered detail pages.

### Canonical change types

- Plans support text, structural, and metadata work rather than assuming every
  operation is a text replacement. The internal change model covers at least:

  ```text
  CanonicalPlanChange =
    | TextEdit
    | RenamePassage
    | AddPassage
    | RemovePassage
    | SetStartPassage
    | UpdateStoryMetadata
    | UpdateProjectMetadata
  ```

- The review API exposes typed descriptions, stable change IDs, affected entity
  identities, and before/after values. Raw executable commands remain inside
  Rust.
- Validate duplicate, overlapping, incompatible, and order-dependent changes
  before commit. Any invalid child change rejects the complete plan.

### Source-range encoding

- Canonical Rust text edits use half-open UTF-8 byte ranges over the exact
  source bytes recorded by the plan. Editor-facing locations use explicitly
  converted half-open UTF-16 code-unit ranges. Every boundary field names its
  encoding; unlabelled integer offsets are prohibited.
- Range conversion and excerpt clipping preserve CRLF/LF distinctions and do
  not split UTF-8 code points, UTF-16 surrogate pairs, or combining sequences in
  displayed context. Case and Unicode normalization are not silently changed.
- Boundary tests cover emoji and supplementary-plane characters, combining
  characters, mixed Cyrillic and Latin text, CRLF and LF, case-only renames,
  normalization differences, and excerpt boundaries across multibyte text.

## Plan preconditions and buffer protocol

- V1 binds every plan to the global `ProjectSession.revision`. Any committed
  project mutation invalidates the complete plan, even when it affects an
  unrelated passage. Per-source revisions may later reduce false invalidation
  without changing the plan/apply contract.
- Before planning, flush every affected story buffer. If any flush cannot
  complete, including active IME composition, planning fails without creating a
  plan. Record the global project revision and a generation for every relevant
  buffer.
- Normal editing remains available during review; no long-lived mutation lease
  is held. Before apply, flush again and reject the plan if the project revision
  or any relevant buffer generation changed.
- The buffer coordinator must define behavior for active IME composition,
  multiple editors for the same passage, editor unmount during flush, cursor and
  selection restoration, a second route or window editing the same story, and a
  save rejected by project-host reconciliation.
- Desktop plans also record the existing external-file conflict/fingerprint
  generation. `persisted_revision` alone is not an external-state precondition.
  A watcher conflict before commit stale-rejects into the existing review flow.
- Format-aware plans record the provider identifier, exact supported format
  version, and capability revision. A provider or selected-format change
  invalidates the plan.
- Use only a brief apply-time mutation barrier, never a review-time lease. The
  safe apply sequence is: flush the operation scope; acquire a barrier that
  covers buffer registration/generation handoff, project mutation, external
  generation, and provider capability state; then atomically revalidate inside
  the barrier the plan digest, global revision, captured buffer registrations
  and generations, external generation, provider identity/capability, and
  selection closure and limits. If any check fails, release the barrier and
  return the typed stale/invalid result. Otherwise commit and reconcile the
  resulting snapshot before release. New editor, watcher, provider, or project
  mutations cannot cross that brief check-and-commit boundary.

## Work order

### 0. Canonical plan infrastructure

- Implement plan identity, digest, session ownership, expiry and eviction,
  preconditions, canonical change types, stable change/group IDs, compact
  selection expressions, plan-bound detail cursors, source-range encoding,
  dependency/atomic-group closure, overlap validation, input limits, and typed
  failures.
- Define the atomic transaction, observer, derived-index, and persistence
  semantics before building a review UI.
- Verify the contract directly at Rust and Rust/WASM boundaries, including
  tampered apply payloads, expiry, eviction, stale plans, and failure injection
  at every child change and derived-index update.

### 1. Reviewed passage rename

- Use passage rename as the first vertical consumer: rename one passage, rewrite
  standard Twine links, review by affected passage, apply or stale-fail, and
  undo/redo as one transaction.
- Show every detected standard Twine-link occurrence and every semantic-reference
  candidate reported by the selected format's registered exact-version
  provider. State coverage explicitly as `standard-links-only`,
  `standard-links-and-exact-format-provider`, `provider-unavailable`,
  `provider-version-mismatch`, or `provider-partial-capability`.
- Unsupported or unknown format syntax may contain undiscovered references and
  is never rewritten speculatively. Do not claim that every unknown reference
  can be identified.
- Verify coordinated updates to backlinks, graph facts, search results, open
  editors, cursor/selection state, and persistence.

### 2. Reviewed project-wide replace

- Route replace through the same immutable plan/apply boundary. Add paged detail
  review, compact inclusion/exclusion, regular-expression and source-scope
  validation, high-result-count handling, and overlap/range validation.
- Retain duplicate-name, empty-name, regular-expression, and source-scope
  validation. Never return 50,000 selected IDs merely to represent the default
  `all` selection.
- Measure plan-store memory, summary/page DTO size, generation/page latency,
  commit latency, peak incremental memory, and typing responsiveness at 10k and
  50k passages.

### 3. Passage references and navigation

- Promote passage backlinks into Find References with exact source locations,
  reveal-in-source, reveal-in-graph, stable result keys, and plan/revision-bound
  pagination.
- Use typed definition outcomes:

  ```text
  DefinitionResult =
    | unique(location)
    | ambiguous(locations)
    | not_found
    | unsupported(symbol_kind)
    | stale
  ```

- Every location carries story and passage identity, revision, explicitly
  encoded source span, stable result key, and provider/capability provenance.
- Passage targets come first. Variables, hooks, macros, and custom semantics
  require exact provider contracts. Textual occurrence search remains available
  but is not labelled a semantic reference query.
- Go to Passage remains the generic fallback. Go to Definition never guesses.

### 4. Plan-backed diagnostic fixes

- Split each quick fix into `describe` metadata and a pure, non-mutating
  `materialize` step. All executable fixes use the common canonical plan apply;
  no fix-specific frontend callback owns mutation.
- Fix All Safe materializes every eligible fix, deduplicates identical changes,
  rejects incompatible or overlapping changes, validates the combined plan, and
  commits one transaction.
- One stale, conflicting, or non-materializable selected diagnostic aborts the
  complete Fix All Safe operation and requires refreshed review. It never
  silently applies a subset.
- A descriptor without a deterministic materializer remains visibly manual
  rather than becoming a disabled no-op command.

### 5. Contextual command-palette integration

- Extend the existing typed application command registry with lifecycle-safe
  route and tool contributions; do not add a parallel registry.
- Define namespaced stable IDs, registration and automatic unregistration,
  duplicate-ID rejection, shortcut collision handling, priority/order rules,
  disabled reasons versus absence, modal and focused-editor behavior, and
  context revalidation at execution time.
- Contributions expose intents such as `rename-active-passage`, not closures
  that permanently capture the selection present at registration. Avoid stale
  closures after route, story, passage, or capability changes.
- Add Go to Passage, Find References, Rename Passage, Find/Replace, applicable
  quick fixes, Reveal in Source/Graph, Undo, and Redo only when their current
  context permits them. Palette commands invoke the same services as visible
  controls.
- Verify IME composition, text-field focus, modal focus trapping, route
  transitions, and commands becoming unavailable while the palette remains
  open.

## Transaction, cancellation, and persistence semantics

- Planning and review are cancellable and produce no mutation. Cancellation
  before commit performs no operation.
- Once atomic commit begins, cancellation, navigation, route unmount, delayed
  response handling, or component destruction cannot interrupt it or expose an
  intermediate state. The transaction completes fully or rolls back fully; the
  next mounted consumer reconciles from the resulting session snapshot.
  Component lifetime never owns transaction completion.
- Every accepted operation creates one logical model transaction, one
  undo-history entry, and one resulting project revision. Subscribers observe
  no intermediate project state. Undo/redo restores names, text, links,
  backlinks, diagnostics, search results, and graph facts together.
- A child change or derived-index failure during the Rust transaction rolls back
  the model transaction. A filesystem persistence failure after a successful
  model commit enters the existing dirty/conflict/retry flow and does not
  secretly reverse the in-memory authoring operation.
- Persistence follows the existing revision-acknowledgement and conflict
  protocol and never makes an intermediate child change durable. The contract
  does not require an arbitrary count of low-level persistence notifications.

## Acceptance criteria

- An accepted operation applies exactly the immutable canonical plan and the
  selected plan-owned change set, or fails with a typed stale/invalid-plan
  result. Apply never introduces a change absent from the plan.
- A plan becomes stale after any committed mutation under the conservative v1
  policy, after a post-planning buffer edit, or after a provider, format, or
  relevant desktop external-file generation changes.
- A plan can expire or be evicted while its review surface remains open and then
  fails safely. A canonical operation is complete or `plan-too-large`; only its
  detail pages may be bounded.
- Planning handles active IME composition, duplicate open editors, editor
  unmount, second-window edits, and user input between planning and confirmation
  without omitting text or applying stale work.
- Route unmount immediately after apply dispatch cannot interrupt atomic commit.
  Failure injection at every child change and derived-index update proves full
  rollback.
- Watcher events are covered before planning, during review, immediately before
  commit, and after model commit but before persistence acknowledgement.
- `all_except` and group selection behave identically across paged and
  differently ordered detail requests. Non-closed or over-limit selections fail
  without mutation. Identical fixes deduplicate; overlapping incompatible fixes
  reject the complete batch.
- Inject an editor write, watcher event, provider change, and competing project
  mutation in the interval between the second flush and barrier acquisition;
  final in-barrier revalidation must stale-reject each one.
- Unicode, normalization, case-only rename, CRLF/LF, and excerpt-boundary tests
  prove that apply and reveal use the declared range encodings.
- Palette execution revalidates current context if route, selection, dialog,
  focus, or capability state changes while the palette is open.
- Browser/WASM planning stays responsive at declared 10k/50k bounds. Preview
  and reference queries remain bounded and do not construct an unrequested
  complete frontend index.
- Ordinary navigation and single-passage editing retain no-`replaceProject`,
  one-session, incremental-cache, and viewport-bounded graph properties.
- Browser and managed Electron paths expose the same authoring behavior. File
  watching and persistence conflicts remain desktop-specific and enter the
  existing conflict/retry flow.
- Unit, Rust/WASM boundary, React, browser, PWA, and freshly packaged Electron
  tests cover plan preview, tamper resistance, stale rejection, atomic
  apply/rollback, undo/redo, external-change races, persistence failure,
  keyboard-only execution, Unicode ranges, expiry/eviction, and large-result
  bounds.

## Out of scope

- Arbitrary evaluation or mutation in the Runtime Debugger.
- Best-effort rewriting of unknown story-format syntax.
- Per-source revision optimization in v1.
- A language-server protocol or plugin API without a concrete second consumer.
- Treating refactoring as a speculative fix for unattributed Electron memory.

## Exit criteria

- Rename and project-wide replace use immutable, reviewed, session-owned plans;
  the frontend never returns executable edits.
- Passage references/backlinks and supported definitions navigate to exact,
  encoding-safe sources and graph passages with explicit capability coverage.
- Executable quick fixes, including Fix All Safe, use the common plan boundary
  and preserve one atomic undo transaction.
- Authoring commands are available consistently through visible controls and
  lifecycle-safe contributions to the existing command registry.
- Measured 10k/50k limits prove bounded plan storage, transfer, latency, memory,
  and typing responsiveness.
- Current status and user documentation describe supported reference and
  rewrite boundaries without implying unsupported format semantics.
