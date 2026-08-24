# Desktop preview sessions

Status: current
Owner: Electron and frontend maintainers
Last verified: 2026-08-23
Source of truth: desktop preview entry, preview IPC, window manager, protocol,
and shared preview surface

Desktop Play, Test, and Proof run in dedicated app-owned windows. A preview is
not another application renderer: it has a separate Vite entry, a preview-only
preload, no project store, and no general Electron project bridge.

## Build and content boundary

The owning editor renderer requests a preview after refreshing native asset
inventory. One materialized story snapshot supplies the generated HTML,
published-passage references, launch passage, build summary, and requested
assets. The HTML receives a fresh runtime bridge identifier before the request
crosses into Electron main.

Electron main assigns the session identifier and monotonically increasing
generation. It copies the generated HTML and bounded asset bytes into an owned
scratch package, registers that package under a fresh opaque
`twine-preview://<token>/` origin, and passes only a validated descriptor and
URL to the preview entry. Descriptor validation rejects unknown top-level and
nested fields, then reconstructs the renderer-facing value from its explicit
allowlist.

The application-lifetime protocol handler serves exact registered packages. It
accepts normalized allowlisted paths and `GET` or `HEAD`, provides media types
and single-range responses, and rejects unknown tokens, traversal, encoded
separators, malformed origins, and unsupported methods. A package token cannot
enumerate or access another package.

## Renderer and IPC boundary

The preview BrowserWindow uses context isolation, sandboxing, no Node
integration, web security, a deny-by-default permission policy, and the narrow
preview preload. The shell may load only its packaged entry; its direct story
frame may navigate only within the current package origin. External HTTPS links
follow the configured system-browser/block policy.

Preview IPC has two exact trust gates:

- application IPC accepts launch and replacement requests only from the
  packaged main renderer and rejects subframes;
- preview IPC accepts readiness, frame-load acknowledgement, runtime commands,
  and results only from the WebContents that owns the session.

The preview API exposes descriptor reads, generation-tagged commands and
acknowledgements, appearance updates, content replacement, and the bounded
begin/cancel/complete Clear State lifecycle. It does not expose filesystem,
project mutation, dialogs, arbitrary persistence access, or raw `ipcRenderer`.
Main retains the latest bounded appearance for each live owner and merges it
immediately before exposing or committing a generation, including updates
received before a session or candidate exists.

Its sole clipboard capability is `copyText`, used by the host Runtime Console.
It accepts only nonempty bounded text through the exact top-level preview-entry
and live-session gates; child story frames and the ordinary application
renderer cannot invoke it. Main does not authenticate a physical user gesture;
the capability is limited to the trusted preview shell instead.

## Shared surface and commands

Browser preview routes and the desktop entry render the same
`StoryPreviewFrame` surface. Browser content uses `srcDoc`; desktop content uses
the opaque package URL. The instrumented story reports bounded current-passage,
viewport, console, error, and unhandled-rejection messages to the surface.
It also negotiates the additive, read-only Runtime Debugger v1 adapter contract
described in [`runtime-debugger-protocol.md`](./runtime-debugger-protocol.md).
Candidate-generation messages, including debugger section completeness, are
reduced into a bounded private runtime model; commit promotes that model with
the candidate frame, while rollback discards it.

Play and Test expose host-owned Runtime Controls inside the Debugger. Restart
uses the separately negotiated format command and remounts the same committed
package URL without advancing its generation. Clear State is confirmed and
destructive: it removes runtime storage and cookies owned by this preview
origin, including saved progress and format preferences, then remounts the same
artifact. Proof exposes neither control.

Source and Graph commands return to the owning editor and focus the referenced
passage. Test From Start and Test Current return generation-tagged requests to
the owner, which performs a fresh one-snapshot test build and asks main to
replace the content in place. Preview input never supplies a filesystem path or
overrides Test From Start's committed launch passage.

## Clear State transaction

Clear State is serialized against replacement staging, candidate commit,
owner-command execution, another clear operation, and session close. Main locks
the current generation before waiting for the direct story frame to detach.
Once detached, it registers a one-use same-origin cleanup document. The shell
loads that document in a temporary sandboxed frame so the document can clear
and verify local storage, session storage, Cache Storage, and enumerated
IndexedDB databases before acknowledging the exact operation identifier. This
same-origin pass is required because Electron's origin-filtered session cleanup
does not reliably remove persistent data for a custom scheme.

After that acknowledgement, main clears origin-scoped Cache Storage, file
systems, IndexedDB, local storage, service-worker, Web SQL, and related storage
data through Electron's session API. Cookies are enumerated and removed only
when their normalized domain exactly matches the current package host; each
cookie's name and path are retained for removal. Cookies and downloads are not
included in the broad session-data request. Main revalidates session,
generation, URL, operation, and lock ownership after asynchronous boundaries.

The cleanup URL is invalidated after completion, cancellation, package release,
or protocol reset. Main gives each operation a bounded lease and owns one
identity-checked terminal path: completion, explicit cancellation, lease
expiry, preview-shell navigation, or session close can release only that exact
operation and its cleanup document. Renderer identity changes and teardown
reject any cleanup acknowledgement waiter and best-effort cancel an operation
that has already begun; late begin, acknowledgement, completion, or timeout
continuations cannot remount an obsolete artifact or update the replacement
shell. Completion and failure both release the lock, and a live shell remounts
the same committed package URL. A failure is reported as not-fully-confirmed
rather than claiming that a partial destructive operation was rolled back.

## Ownership and cleanup

Multiple sessions may coexist. Each window has a stable session identifier and
one committed package generation. A replacement stages a fresh token and keeps
the committed story frame mounted while a hidden candidate frame loads. Main
commits only after the candidate acknowledges the new generation; the shell
then promotes that already-loaded frame. Commit releases the old package, while
failure or timeout releases the candidate and preserves the current frame,
runtime progress, and captured logs.

For an exactly admitted Harlowe 3.3.9 candidate, the shell sends that
acknowledgement only after both iframe load and matching State
attestation readiness. The parent transfers an unexposed `MessagePort` to the
early bridge and sends the exact-load high-entropy challenge only through that
channel; readiness is authoritative only when it returns through the matching
parent endpoint. Knowing the public bridge session or reusing the iframe's
stable `WindowProxy` is insufficient. A pre-load response is provisional. The
native `load` event rotates the challenge and requires a fresh response from the
same document-owned channel. Native navigation destroys the child endpoint, so
the replacement document fails closed even though the `WindowProxy` survives.
A continuously armed window listener reads current and staged load identities
from refs and establishes the bridge channel without a React effect gap. Late,
queued, window-forged, or stale-port readiness therefore cannot complete a new
candidate. Other formats retain load-only acknowledgement. Main also prevents
non-same-document navigation from an already loaded exact-Harlowe story frame.
A candidate attempt rolls back; the shell's Reload control uses a new iframe,
new channel, and the expected main-owned package URL.

Normal close, preview destruction or crash, owner reload/destruction, and app
shutdown release the session's packages and scratch roots. Startup and shutdown
cleanup is not required for correctness: staging opportunistically prunes
abandoned packages by the configured cache age, and shutdown performs a final
cleanup pass. The
application-lifetime protocol handler remains installed while individual
package registry entries come and go.
