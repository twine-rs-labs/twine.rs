# Runtime debugger protocol

Status: current
Owner: frontend and story-format maintainers
Last verified: 2026-08-23
Source of truth: preview instrumentation, debugger protocol registry, and shared
preview runtime reducer

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

For every hello, the host recomputes the canonical descriptor from its bounded
format metadata and requires the adapter ID, ordered capabilities, and
reliability to match exactly. This applies to generic adapters too, so a known
format tuple cannot negotiate a generic downgrade.

The existing frame-window and opaque bridge-session checks correlate messages
with the expected preview instance before reduction. They do not authenticate
the instrumentation against the story: story code shares the emitting realm.
Negotiated state belongs to that runtime model: a reload clears it, a desktop
candidate generation buffers it privately, commit promotes it with the
candidate frame, and rollback discards it.

## Adapter contract

Adapter selection matches both story-format name and version. Unknown or older
versions use the generic best-effort adapter; they never inherit the promises of
a nearby version.

| Adapter                 | Reliability   | Read capabilities                                                       |
| ----------------------- | ------------- | ----------------------------------------------------------------------- |
| SugarCube 2.37.3        | Exact version | Current passage, story variables, temporary variables, visited passages |
| Snowman 1.5.0 and 2.1.1 | Exact version | Current passage, story variables, visited passages                      |
| Chapbook 2.3.1          | Best effort   | Current passage only                                                    |
| Harlowe 3.3.9           | Best effort   | Current passage only                                                    |
| Generic                 | Best effort   | Current passage only                                                    |

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

SugarCube 2.37.3 is the one explicit format-owned accessor boundary. Its
`State.passage`, `State.variables`, `State.temporary`, and `State.history`
getters are frozen and non-configurable in the bundled runtime and return the
engine's existing roots without walking story values. The exact adapter checks
those descriptors and their bundled getter implementations before invoking
them. A missing or changed check makes the affected section `unavailable`; it
does not fall back to an arbitrary accessor.

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
the debugger hello. Restart is advertised only for the exact bundled
SugarCube 2.37.3, Snowman 1.5.0 and 2.1.1, Chapbook 2.3.1, and Harlowe 3.3.9
tuples. Unknown tuples do not inherit a nearby command implementation. Each
request and result is correlated to the live frame window, bridge session,
adapter, protocol version, and bounded request identifier.

Restart asks the format adapter to discard its active continuation surface,
then the host remounts the same built artifact at its launch passage. The host
accepts only `applied`, `unavailable`, `failed`, or `indeterminate` results.
`failed` and `unavailable` are pre-mutation outcomes and leave the current frame
mounted. An `applied` result remounts normally. An `indeterminate` result or
timeout also remounts, with a warning, because the old runtime can no longer be
trusted.

The exact adapters use only audited version-specific surfaces:

- SugarCube verifies its frozen `State.reset` implementation, dispatches one
  native-shaped `:enginerestart` event, and uses a one-remount marker to suppress
  autoload without deleting explicit save slots;
- Snowman removes its hash continuation when the document URL permits it, or
  delegates that scrub to the required remount for an opaque `srcDoc` frame;
- Chapbook verifies its frozen `reset` and `saveToStorage` functions before
  clearing the active state;
- Harlowe removes the exact `Saved Session` continuation key.

The command channel is still cooperative rather than an authentication
boundary: story code shares the instrumented realm. Captured native references,
own-data descriptors, exact function signatures, and host-side correlation
limit accidental or prototype-tampered execution, but they do not make hostile
story JavaScript trusted.

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
