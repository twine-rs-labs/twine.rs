# Runtime debugger protocol

Status: current
Owner: frontend and story-format maintainers
Last verified: 2026-08-25
Source of truth: format compatibility matrices, preview build admission,
instrumentation, debugger protocol registry, and shared preview runtime reducer

The shared browser and managed-desktop preview surface has an additive,
read-only Runtime Debugger v1 protocol. It extends the existing current-passage,
viewport, console, and runtime-error bridge without changing those legacy
messages.

## Negotiation and ownership

An instrumented story sends one `debugger-hello` message before debugger
snapshots. The hello carries `protocolVersion: 1`, a fixed adapter identifier,
the exact declared capabilities, bounded format metadata, and a reliability
classification. The host accepts the first valid hello for a preview runtime
model and ignores snapshots received before negotiation, messages for another
adapter or protocol version, and later handshakes.

Exact SugarCube and Harlowe negotiation begins with host authorization before
the frame exists. The host uses this one-way authority chain:

```text
canonical built-in record -> immutable loaded-source snapshot -> synchronous build
-> source SHA and structural tuple validation -> exact admission
-> static Restart eligibility -> per-frame context -> message normalization
```

The source snapshot retains the selected record identity and loaded
`name`/`version`/`source`; the build clone and SHA use those same values. A
non-executing HTML parse requires exactly one effective `tw-storydata` tuple.
The authoritative literal rows, including every adapter ID, canonical URL,
source digest, and read-profile assignment, live in the format-specific
[`story-preview-sugarcube.ts`](../../src/routes/story-preview-sugarcube.ts) and
[`story-preview-harlowe.ts`](../../src/routes/story-preview-harlowe.ts)
modules; cross-format admission is exposed by
[`story-preview-format.ts`](../../src/routes/story-preview-format.ts).
The exact adapter is admitted only when the selected non-user-added record is
the unique canonical and installed built-in, its URL and loaded identity match,
and the decoded UTF-8 source SHA matches the literal compatibility matrix.
Missing, malformed, ambiguous, changed, user-added, or unbundled inputs become
generic. Active serialized SVG or MathML is also outside exact admission for
every adapter because the lightweight Electron scanner cannot reproduce HTML's
foreign-content breakout and integration-point rules. Escaped foreign-looking
story text and foreign markup inside inert templates remain admissible.

Harlowe additionally requires structural bootstrap placement and runtime State
attestation before its exact descriptor becomes ready. Both raw and DOM checks
count every effective document-wide `[role=script]` HTML element that Harlowe
would evaluate. Descendants in template content and descendants parsed as raw
text inside ordinary HTML `noscript` elements are excluded; a role-bearing
`template` or `noscript` element itself still counts. The shared foreign-content
exclusion prevents apparent SVG/MathML descendants from being adopted into an
unaccounted effective HTML position. The canonical author and generated
bootstrap remain exact direct-child script elements. Serialized admission has
an exact own-field schema and is validated again at the browser/Electron
boundary. Runtime DOM attributes, story-supplied adapter IDs, and command
messages cannot create, change, or revoke admission. Once an exact build is
admitted, its hello uses the host-selected descriptor. An unadmitted SugarCube
tuple always stays generic; an unadmitted Harlowe 3.3.9 tuple retains its
existing best-effort current-passage and Restart behavior.

Messages are handled frame-first: Clear State acknowledgements are separate;
the event source is identified as current, staged, or unknown; unknown sources
are rejected; then that frame's host context is used for one canonicalization
step. Reducers accept only canonical messages and enforce ordering and
correlation, never adapter admission. Current and staged frames have independent
admission, generation, and Restart eligibility. Commit promotes the candidate
context with its model; rollback discards both.

## Adapter contract

Adapter selection matches both story-format name and version. Unknown or older
versions use the generic best-effort adapter; they never inherit the promises of
a nearby version.

| Adapter                                                                | Reliability                           | Read capabilities                                                       |
| ---------------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------- |
| SugarCube 2.31.0, 2.31.1                                               | Exact version, read profile 2.31      | Current passage, story variables, temporary variables, visited passages |
| SugarCube 2.32.0, 2.33.0-2.33.4, 2.34.0, 2.34.1, 2.35.0                | Exact version, read profile 2.32-2.35 | Current passage, story variables, temporary variables, visited passages |
| SugarCube 2.36.0, 2.36.1                                               | Exact version, read profile 2.36      | Current passage, story variables, temporary variables, visited passages |
| SugarCube 2.37.0, 2.37.3                                               | Exact version, read profile 2.37      | Current passage, story variables, temporary variables, visited passages |
| Snowman 1.5.0 and 2.1.1                                                | Exact version                         | Current passage, story variables, visited passages                      |
| Chapbook 2.3.1                                                         | Best effort                           | Current passage only                                                    |
| Admitted bundled Harlowe 3.3.9                                         | Exact version, State profile 3.3.9    | Current passage only                                                    |
| Unadmitted or altered Harlowe 3.3.9                                    | Best effort                           | Current passage only                                                    |
| Generic, including SugarCube 1, user-added SugarCube, and unbundled v2 | Best effort                           | Current passage only                                                    |

Exact-version means the adapter targets a verified runtime surface for that
bundled version. It does not make story values trusted or promise support for a
different release. Debugger v1 remains read-only; runtime commands use a
separate protocol and capability negotiation.

For the registered Chapbook 2.3.1 tuple, the head-injected bridge listens for
the format's native `state-change` event and copies only the bounded final
string from a `trail` update into its current-passage cache. It reads the event
detail and array entries through captured native and own-data-descriptor access
only. This event capture supports current-passage identity; it does not expose
trail or history inspection.

Chapbook's public `state.get()`, `state.varNames()`, and `state.saveToObject()`
APIs cannot provide both accessor-free and traversal-bounded inspection.
Chapbook variable and trail/history capabilities therefore remain withdrawn
until the format supplies a versioned bounded snapshot hook.

Each admitted SugarCube version has an explicit audited getter profile for
`State.passage`, `State.variables`, `State.temporary`, and `State.history`.
There is no semver inference. Each getter is checked independently as an own,
non-enumerable, non-configurable getter on a frozen `State`, using captured
intrinsics and its exact bundled function source. Only then is that getter
invoked. A missing or changed getter makes only its section `unavailable`;
exact current-passage inspection does not fall back to visible DOM or legacy
runtime discovery. Read drift does not change the admitted adapter and does not
disable an independently valid Restart profile.

The admitted bundled Harlowe 3.3.9 artifact receives one inert Story
JavaScript bootstrap immediately before its canonical author script. That
bootstrap requires the private `state` module and invokes a non-writable,
non-configurable, one-shot bridge callback. The bridge accepts State only when
the object is frozen and its own `passage` getter and `on` function match the
checked-in descriptor flags and exact bundled function sources. It retains
State and the passage getter only inside the bridge closure, registers the
audited `forward`, `back`, and `load` events through captured intrinsics, and
then marks State attested. In response to the early bridge arm, the parent
transfers a private `MessagePort` which the bridge consumes before story
listeners can observe it. The parent creates a high-entropy challenge for each
actual iframe document load and sends it only over that port; the attestation
closure must return readiness over the same port. A readiness response received
while the document is still parsing is provisional: the iframe `load` event
rotates the challenge, and only the loaded document's fresh response can
acknowledge that load. Native navigation destroys the document-owned endpoint,
so the preserved `WindowProxy` cannot receive the new challenge or return
readiness. Window messages, public session, adapter, and protocol values are
non-authoritative. Empty startup passage is a valid ready state whose
current-passage section remains unavailable until the first forward. Exact
reads never fall back to DOM, session storage, startnode, or generic discovery;
redirects still rely on the existing render observation to schedule a new
capture.

## Snapshot safety

Snapshots contain detached display records, never live story objects. Variable
records contain only a bounded name, type label, and preview string. Primitive
values receive bounded previews, with string previews bounded again after JSON
escaping; objects, arrays, functions, maps, sets, and other complex values
receive conservative type placeholders without recursive traversal. Visited
passages contain bounded passage identity fields that the host resolves against
the published story descriptor before treating them as stable application IDs.

Enumerable variable roots are traversed for at most the item limit plus the
sentinel that detects truncation, without first materializing the complete key
set. Story values, current-passage fields, and history indices are read only
from own data descriptors; ordinary accessors, object coercions, and `toJSON`
are never invoked. BigInts use a fixed label, and complex values are not
recursively inspected. History is read from the newest bounded suffix and
returned in chronological order.

Every advertised capability has a section status in each snapshot:

- `complete` means the payload is present and exhaustive within the contract;
- `truncated` includes one or more canonical reasons: `field-limit`,
  `item-limit`, `text-budget`, or `uninspectable`;
- `unavailable` means the advertised runtime surface could not be observed in
  that capture, and its payload is absent.

After current-passage text is deducted, the remaining snapshot text budget is
split evenly across the adapter's advertised collection capabilities. Remainder
characters are assigned in canonical capability order, and unused shares are
not donated. Thus story variables, temporary variables, and history cannot
starve one another. The host independently validates the same item, field,
section, and total-text invariants before state enters React.

Adapter registrations derive capabilities from an exhaustive capture-handler
map. If an adapter fails, the existing current-passage, log, and error bridge
continues independently.

## Runtime command protocol

Play and Test previews negotiate an additive Runtime Command v1 protocol after
the debugger hello. Restart is available to all 15 admitted SugarCube versions,
Snowman 1.5.0 and 2.1.1, Chapbook 2.3.1, and Harlowe 3.3.9. Unknown tuples do not
inherit a nearby implementation. Each request and result is correlated to the
live frame window, bridge session, generation, adapter, protocol version, and
bounded request identifier.

Restart asks the format adapter to discard its active continuation surface,
then the host remounts the same built artifact at its launch passage. The host
accepts only `applied`, `unavailable`, `failed`, or `indeterminate` results.
`failed` and `unavailable` are pre-mutation outcomes and leave the current frame
mounted. An `applied` result remounts normally. An `indeterminate` result or
timeout also remounts, with a warning, because the old runtime can no longer be
trusted.

The exact adapters use only audited version-specific surfaces:

- SugarCube first requires exactly one structurally identified
  `script#script-sugarcube` region with one profile-specific startup fragment
  and native Restart integrity fragment. Only the startup fragment is patched.
  Static mismatch leaves the engine region unchanged and exact reads enabled,
  but disables command negotiation. At command time, the adapter verifies own,
  frozen, non-enumerable, non-writable, non-configurable `State.reset` and
  `Engine.restart` functions against the profile. `Engine.restart` is never
  invoked. The adapter calls `State.reset`, then synchronously dispatches one
  `CustomEvent(':enginerestart')` on `document` with `detail: null`, bubbling and
  cancelable true, and composed false;
- Snowman removes its hash continuation when the document URL permits it, or
  delegates that scrub to the required remount for an opaque `srcDoc` frame;
- Chapbook verifies its frozen `reset` and `saveToStorage` functions before
  clearing the active state;
- Harlowe removes the exact `Saved Session` continuation key.

SugarCube command hello/results are accepted only when that frame's host
context contains matching exact admission and static eligibility. A forged
message cannot restore failed eligibility. `unavailable` and `failed` leave the
frame mounted; `applied` and `indeterminate` remount; timeout performs a
precautionary remount. Late, duplicate, stale-generation, wrong-session, and
wrong-request results are ignored.

For managed Electron previews, the renderer sends the raw immutable build and
admission descriptor. Main validates the descriptor, instruments that exact
HTML, derives static Restart eligibility from the engine region it stages, and
returns only the main-owned eligibility in the generation descriptor.
Exact Harlowe current and candidate frames acknowledge load only after both the
iframe load event and matching challenge-correlated runtime attestation
readiness over the bridge's private `MessagePort`. One continuously armed
parent window listener reads the active current and staged load records through
refs and establishes each bridge channel; the channel listener remains attached
through the matching load. Every native iframe `load` creates a fresh
document-load record and challenge even when navigation preserves the same
iframe element and `WindowProxy`. A native document replacement destroys the
child endpoint and therefore cannot reattest; session, generation, React
reload, and candidate replacement create a new containing identity and channel.
Until acknowledgement, Electron retains the
committed package and descriptor; a missing or failed readiness signal follows
the existing candidate timeout and rollback path. Main also prevents an
already-loaded exact-Harlowe story frame from replacing its document through
native navigation; an attempted candidate navigation rolls that candidate back.
The shell-owned Reload path remounts the expected URL in a new iframe instead.

The narrow Restart marker belongs to a correlated Twine.rs remount. The bridge
clears `window.name` before SugarCube startup, and the parent clears both its
stored frame name and the live iframe name on the remounted frame's first load,
even if bridge negotiation fails. Later ordinary Reload therefore uses native
autoload again. Story-authored names and story-initiated reloads are outside
this marker-integrity boundary. Restart removes the active continuation while
preserving explicit saves where the origin supports persistence. Browser
sandboxed `srcDoc` uses opaque/document-lifetime storage behavior; packaged
Electron uses stable per-package `twine-preview://` Web Storage. Cookie fallback
and degraded storage backends remain out of scope.

## Runtime coverage matrix

Artifact authentication and build admission cover all 15 bundled SugarCube
versions and bundled Harlowe 3.3.9.
Real-artifact runtime and instrumentation cover all 15 in Chromium. Firefox
and WebKit cover profile representatives 2.31.0, 2.32.0, 2.33.1, 2.35.0,
2.36.0, and 2.37.3. Offline PWA coverage exercises exact admission and static
negotiation for 2.31.0 and 2.37.3 under the documented
opaque/degraded-storage boundary. Packaged Electron covers all six profile
representatives, with Play and non-start Test From Here at the 2.31 and 2.37
endpoints. Offline PWA and packaged Electron coverage also exercise exact
Harlowe admission, attestation, current-passage navigation, and candidate
readiness. Adding a future SugarCube or Harlowe release requires an explicit
matrix row, canonical decoded-source digest, an audited executable profile,
hostile-descriptor tests, and real-artifact browser and packaged-runtime
coverage; nearby versions never inherit the 3.3.9 profile.

Clear State is host-owned and therefore is not an adapter command. Browser
`srcDoc` previews have an opaque origin and are cleared by detaching and
remounting the same artifact. Managed desktop previews use a two-phase
generation-bound operation described in
[`desktop-preview-sessions.md`](./desktop-preview-sessions.md).

## Product boundary

The host-owned Runtime Console is available before adapter negotiation. It shows
the bounded newest-first console/error records as text only and can copy the
committed buffer as timestamped JSON-escaped lines. Copying is not a debugger
protocol message and does not give story content clipboard access.

The shared preview surface delivers the visible, collapsible Debugger inspector.
It renders only negotiated read capabilities, bounded snapshot records, section
completeness, truncation reasons, and unavailability. Play and Test also expose
Runtime Controls: Restart appears only after command negotiation, while the
confirmed Clear State action is host-owned. Proof remains read-only and exposes
neither control. State mutation, arbitrary evaluation, and additional
format-specific development hooks remain deferred.
