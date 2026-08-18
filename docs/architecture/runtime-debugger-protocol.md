# Runtime debugger protocol

Status: current
Owner: frontend and story-format maintainers
Last verified: 2026-08-18
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
different release. Debugger v1 currently has no restart, clear-state, mutation,
evaluation, or adapter-supplied command capability.

Chapbook's public `state.get()`, `state.varNames()`, and `state.saveToObject()`
APIs cannot provide both accessor-free and traversal-bounded inspection.
Chapbook variable and trail capabilities therefore remain withdrawn until the
format supplies a versioned bounded snapshot hook.

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

## Product boundary

The host-owned Runtime Console is available before adapter negotiation. It shows
the bounded newest-first console/error records as text only and can copy the
committed buffer as timestamped JSON-escaped lines. Copying is not a debugger
protocol message and does not give story content clipboard access.

The shared preview surface now delivers the visible, collapsible Debugger v1
inspector. It is read-only and renders only negotiated capabilities, bounded
snapshot records, section completeness, truncation reasons, and unavailability.
Format-specific control commands remain deferred follow-up work and must gain
an explicit capability and lifecycle contract before they are added.
