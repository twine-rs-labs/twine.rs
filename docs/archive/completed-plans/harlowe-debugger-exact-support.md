# Exact-version Harlowe 3.3.9 debugger read support

Status: completed
Owner: frontend and story-format maintainers
Last verified: 2026-08-26
Source of truth: bundled Harlowe 3.3.9 artifact, preview-format admission,
preview instrumentation, Runtime Debugger v1, and shared preview lifecycle

Completion record: PR1, PR2, and PR3 shipped in tagged prerelease
`v0.2.0-beta.5`. Exact admitted Harlowe 3.3.9 exposes current passage, story
variables, observed temporary assignments, and visited-passage history while
drifted or unadmitted artifacts retain the documented current-passage-only
fallback.

This plan adds exact-version read support for the bundled Harlowe 3.3.9
runtime without extending that trust to altered, user-added, nearby, or future
Harlowe releases. It preserves the existing `harlowe-3.3.9` wire identity and
Restart behavior for best-effort fallback while authorizing richer reads only
after exact build admission and runtime attestation.

The implementation is deliberately split into three sequential pull requests.
Each pull request is independently usable and must retain browser, PWA, and
managed-desktop preview behavior.

## Capability states

| Runtime context                     | Adapter ID      | Reliability   | Read capabilities                                                       |
| ----------------------------------- | --------------- | ------------- | ----------------------------------------------------------------------- |
| Unadmitted or drifted Harlowe 3.3.9 | `harlowe-3.3.9` | Best effort   | Current passage                                                         |
| PR1 exact admitted Harlowe 3.3.9    | `harlowe-3.3.9` | Exact version | Current passage                                                         |
| PR2 exact admitted Harlowe 3.3.9    | `harlowe-3.3.9` | Exact version | Current passage, story variables, visited passages                      |
| PR3 exact admitted Harlowe 3.3.9    | `harlowe-3.3.9` | Exact version | Current passage, story variables, temporary variables, visited passages |

Exact-version reliability describes a verified private runtime surface for the
single bundled artifact. It does not make story-authored values trusted and
does not authorize another Harlowe release.

## Shared design decisions

- Extend `PreviewFormatAdmission` with an exact Harlowe variant and keep `none`
  as the only fallback authority.
- Extract only cross-format admission and structural parsing. Keep
  SugarCube-specific read and Restart profiles separate from Harlowe profiles.
- Resolve read behavior from context, not adapter ID alone:
  `readAdapterForAdmission`, `readAdapterForObservedFormat`, and
  `admissionAllowsReadAdapter` must govern bridge selection, hello
  canonicalization, snapshot authorization, section/capability validation, and
  replacement/reload handoffs.
- Preserve the best-effort Harlowe wire ID so exact-read drift never removes
  the existing exact-tuple Restart implementation.
- Keep Runtime Debugger and Runtime Command protocol versions at 1. This work
  adds adapter behavior, not a new protocol generation.
- Keep Restart authorization separate from read reliability. Both admitted
  Harlowe and the existing exact bundled fallback retain Restart; exact
  SugarCube still requires its independent static Restart eligibility.
- Keep the bridge read-only. State mutation, arbitrary evaluation, macro
  execution, and save editing remain out of scope.

## PR1 — Exact admission, State attestation, and current passage

### Admission and executable profile

- Add a literal Harlowe 3.3.9 compatibility row containing canonical URL,
  source SHA-256, adapter ID, and read-profile ID.
- Compute the digest from the decoded canonical `formatProperties.source`, the
  same immutable string used to build the preview. A checked-in test must load
  the bundled `format.js`, decode it without executing its setup function, and
  recompute the digest.
- Require the selected record to be the unique canonical installed built-in,
  non-user-added, URL/name/version matched, with the loaded identity and exact
  generated `tw-storydata` tuple matching the compatibility row.
- Add an executable Harlowe State profile containing the module name, lifecycle
  event names, required descriptor flags, exact getter/function source text,
  frozen-object requirement, and per-capability dependencies.
- PR1 attests only `require('state')`, frozen `State`, the `passage` accessor,
  and `State.on`. Initial `passage === ''`, empty timeline, and
  `pastLength === -1` are valid pre-start readiness, not attestation failure.

### Structural bootstrap

- Model preview HTML before and after instrumentation rather than relying on a
  regex anchor.
- Pre-instrumentation requires one effective `tw-storydata`, one canonical
  author Story JavaScript element, and no other effective `[role=script]`
  element or debugger bootstrap.
- Mirror Harlowe's document-wide `[role=script]` selector for every effective
  HTML element, not only `script` tags. Direct and nested HTML role elements
  count; descendants in inert template content and descendants represented as
  raw text inside ordinary HTML `noscript` do not. A role-bearing `template` or
  `noscript` element itself still counts. Exclude active serialized SVG and
  MathML from exact admission because the Electron raw scanner cannot safely
  emulate foreign-content breakout, integration points, and descendant
  adoption. Escaped foreign-looking text and inert template content remain
  allowed. The canonical author and generated bootstrap must still be actual
  direct-child `script` elements with exact type, role, identity, order, and
  placement. Raw and DOMParser paths must enforce the same exclusion.
- Insert one inert Twine Story JavaScript element with
  `type="text/twine-javascript" role="script"` as a direct child of the
  admitted story data. It must be the first role script and the immediate
  element predecessor of the unique author script.
- The bootstrap guards its `require('state')` call, then invokes the one-shot
  bridge callback unconditionally so failure consumes the callback instead of
  leaving a later story-controlled retry surface.
- Reparse and post-validate the staged output. Require exactly one correctly
  placed bootstrap and one canonical author script.
- On any pre-check, insertion, or post-check failure, discard the complete
  staged string and instrument the original HTML generically. No exact
  admission, callback, bootstrap, or staged bytes may survive.

### Runtime and lifecycle

- Store the closure-only State object only after the checked-in descriptor and
  source profile passes. Invoke accessors and lifecycle registration through
  captured intrinsics.
- Read exact current passage only through the attested State getter. Do not
  fall back to session storage, DOM, startnode, or generic runtime discovery
  for the exact debugger section. Before the first normal forward, publish the
  section as unavailable while the exact adapter remains ready.
- Queue the existing coalesced state capture on relevant Harlowe State events.
  DOM/render observation remains necessary for redirects because redirect
  changes the current moment and renders immediately without appending a
  moment or emitting `forward`.
- Add a readiness arm emitted after the bridge installs an early capture
  listener. `StoryPreviewFrame` responds by transferring a private
  `MessagePort`, then issues a high-entropy challenge for each exact iframe
  document load only through that channel. The bridge consumes the port before
  later story listeners and the State-attestation closure must return
  `debugger-bootstrap-ready` over it. A response received before the native
  load is provisional. The load event rotates the challenge, and only a fresh
  response through the loaded document's endpoint can acknowledge it. Native
  navigation destroys that endpoint; ordinary window messages and the public
  session, admission, adapter, protocol tuple, and stable `WindowProxy` are
  insufficient to forge readiness.
- For exact Harlowe, `StoryPreviewFrame` calls its current or staged load
  callback only after both iframe load and matching bootstrap readiness. Other
  formats keep load-only behavior. Late messages from stale frame windows,
  sessions, admissions, or generations cannot complete readiness.
- Keep one parent window listener armed for the component lifetime. It reads
  active current/staged identities and completion callbacks through refs and
  establishes the private bridge channel, so a reload or candidate replacement
  cannot lose the arm exchange between passive-effect cleanup and installation.
  Keep the channel listener through the matching load and rotate the challenge
  on every native iframe load. If same-element navigation preserves
  `contentWindow` but destroys the child port, fail closed until a shell-owned
  remount establishes a new channel.
- Managed Electron candidates retain the old committed package and descriptor
  until the readiness-gated frame acknowledgement succeeds. Existing candidate
  failure and timeout paths roll back the candidate and preserve the old
  runtime. Prevent already-loaded exact-Harlowe story frames from replacing
  their document through native navigation; roll back a candidate that attempts
  it, while preserving the shell-owned Reload remount.
- Route exact Harlowe hello, snapshots, Runtime Command hello/results,
  replacement, reload, and staged-frame contexts through the neutral admission
  resolver. A valid admitted Harlowe frame must still negotiate Restart.

### PR1 acceptance coverage

- Canonical source digest and all admission refusals: changed source, wrong
  URL/name/version, user-added record, ambiguous installed record, missing or
  duplicate structural tuple, and altered generated tuple.
- Structural bootstrap: valid inert placement, a second role script, direct
  and nested non-script HTML role elements, active SVG/MathML exclusion, foreign
  `noscript` and raw-text adoption fixtures in both parser paths, duplicate or
  missing author script, inert/decoy elements, failed require with an
  unconditionally consumed callback, and forced post-validation failure with
  byte-for-byte generic fallback from the original HTML.
- Runtime attestation: exact descriptor success; wrong frozen state, flags,
  getter/function source, accessors, proxies, and callback replay fail closed;
  startup empty State becomes a normal current-passage snapshot after forward.
- Protocol authorization: admitted Harlowe exact hello/snapshot/Restart;
  forged enriched snapshots rejected; drifted Harlowe remains best-effort,
  current-only, and Restart-capable.
- Lifecycle: forged same-session readiness before arm or after failed
  attestation, iframe load before readiness, provisional readiness before load,
  same-`WindowProxy` native navigation, duplicate and stale readiness,
  synchronous current/staged replacement, rollback, and Electron candidate
  timeout all preserve the correct descriptor/runtime owner.

## PR2 — Story variables and visited-passage history

### Profile and capability isolation

- Extend the checked-in profile with `State.variables`, `State.timeline`,
  `State.pastLength`, and the closure-only VarRef module needed for mutation
  refreshes.
- Attest State and VarRef independently. State attestation remains the frame
  readiness gate. If VarRef drifts, current passage and any independently valid
  history read remain available while story-variable capability reports
  unavailable.
- Enumerate only own enumerable State-variable fields, skip Harlowe metadata,
  read values through own data descriptors, and reuse the shared bounded,
  non-recursive preview representation.
- Queue the existing coalescer for every VarRef-routed set/delete, including
  nested mutations. Do not promise observation of arbitrary direct writes to
  private State objects; those may wait for another lifecycle or DOM signal.

### History semantics

- Interpret committed history as timeline indices `0..pastLength` inclusive.
  Ignore redo/future moments, keep the newest 200 committed moments, and read
  array indices and moment fields through own data descriptors.
- Status rules are explicit:
  - startup `pastLength === -1` with an empty timeline is unavailable for that
    snapshot;
  - invalid integer/array/range/index or impossible moment is unavailable;
  - a valid overlong passage field is truncated with `field-limit`;
  - more than 200 committed moments reports `item-limit`;
  - section-budget exhaustion reports `text-budget`.
- `forward`, `back`, `load`, and `forgetUndos` queue a full reread. Load capture
  is deferred because `deserialise()` emits `load` before installing the new
  live variables/present moment. Never retain external timeline indexes across
  `forgetUndos` compaction.
- Redirect is the same turn: it changes the current moment passage, does not
  append history, and does not clear temporary observations. Render/DOM signals
  refresh the passage without inventing another timeline row.

### PR2 acceptance coverage

- Startup empty State followed by forward, ordinary forward/back, undo/redo
  future exclusion, redirect-in-place, `forgetUndos`, and real saved-session
  deserialization.
- Own-data and hostile-field coverage for variable roots, timeline length and
  indices, moments, passage names, accessors, proxies, sparse/invalid arrays,
  item/field/text limits, and recovery on a later valid capture.
- Nested VarRef mutation with no DOM change schedules a refresh; a direct
  private write is documented as outside immediate-observation guarantees.
- Browser, offline PWA, and packaged Electron exercise the same exact admitted
  descriptor and bounded snapshot semantics.

## PR3 — Harlowe-native observed temporary assignments

### Product semantics

- Temporary variables are scope-labelled assignments observed during the
  current turn, not a claim to enumerate all currently live lexical scopes.
- Discover `TwineScript_VariableStore` metadata through a captured,
  descriptor-only prototype walk. Bound depth at 64, detect cycles, reject
  accessors, and catch proxy traps. Metadata `type` and `name` must themselves
  be own data fields.
- Missing or non-temp metadata does not create a row but still queues refresh.
  Exclude Harlowe's internal scope labels ending `#<digits>`. Invalid discovered
  temp metadata is uninspectable; overlong fields report `field-limit`. Preserve
  Harlowe's label exactly for display.

### Observed-row model

- Identify a displayed row with the structured key
  `JSON.stringify([scope, name])`; never concatenate user text with a sentinel.
- Keep a capped `admittedKeys` set and `observedRows` map, both limited to 100
  logical rows per turn.
- A VarRef set admits or updates the row. Overflow reports `item-limit`, but a
  previously admitted key can still be updated after overflow.
- A VarRef delete is a refresh signal only and never removes the row. This
  matches Harlowe's native debugger assignment-log behavior and permits later
  reassignment of the same logical key.
- Clear temporary observations synchronously on `beforeForward`, `beforeBack`,
  `beforeLoad`, `load`, Restart, and teardown, then queue the shared coalescer.
  Redirect and `forgetUndos` do not clear them. Listener bodies are fully
  guarded; no intermediate visibly empty snapshot is required.

### DTO and UI contract

- Extend variable DTOs with optional `scope`, bounded to 256 characters and
  included in section/total text budgets.
- Read every DTO field through own-data descriptors. Exact Harlowe temporary
  rows require `scope`; Harlowe story variables and all non-Harlowe variables
  reject it.
- Use a structured React key such as
  `JSON.stringify([scope ?? null, name])` so equal names in equal-looking but
  separately observed scopes remain deterministic within the chosen native
  row model.
- Explain in the UI and documentation: “Harlowe temporary variables are
  assignments observed during this turn; scope names are supplied by
  Harlowe.”

### PR3 acceptance coverage

- Passage, named-hook, unnamed-hook, expression, speculative, unknown, and
  inherited scope metadata; bounded/cyclic/proxy prototype chains; excluded
  custom-macro call labels.
- Equal scope/name assignments, deletion retaining a row, reassignment,
  overflow followed by updates to admitted keys, and every canonical
  truncation/unavailability reason.
- Contextual DTO rejection for missing/forbidden scope and accessor-backed
  fields without getter execution.
- Turn reset, back/load/reset/restart/teardown, redirect retention,
  `forgetUndos` retention, and browser/PWA/packaged Electron parity.

## Validation and documentation for every pull request

- Run focused Jest suites first, then TypeScript, ESLint, formatting check, and
  documentation checks.
- PR1 must exercise the packaged-candidate readiness and rollback seam. PR2 and
  PR3 must run `npm run e2e`, `npm run e2e:pwa`, and
  `npm run e2e:electron:packaged` after focused checks pass.
- Use `npm run browser:cli -- ...` only for exploratory runtime inspection; it
  does not replace deterministic repository acceptance specs.
- Update the architecture documentation with the exact 3.3.9 boundary,
  best-effort behavior for altered artifacts, observed-not-live temporary
  semantics, delayed visibility of direct private writes, and the profile,
  digest, audit, and real-runtime work required for another Harlowe release.
- End each pull request with an independent bounded review. Do not begin the
  next pull request until the current capability and fallback boundaries are
  closed.
