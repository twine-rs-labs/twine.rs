# Desktop preview sessions

Status: current
Owner: Electron and frontend maintainers
Last verified: 2026-08-11
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
acknowledgements, appearance updates, and content replacement. It does not
expose filesystem, persistence, project mutation, dialogs, or raw
`ipcRenderer`. Main retains the latest bounded appearance for each live owner
and merges it immediately before exposing or committing a generation, including
updates received before a session or candidate exists.

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

Source and Graph commands return to the owning editor and focus the referenced
passage. Test From Start and Test Current return generation-tagged requests to
the owner, which performs a fresh one-snapshot test build and asks main to
replace the content in place. Preview input never supplies a filesystem path or
overrides Test From Start's committed launch passage.

## Ownership and cleanup

Multiple sessions may coexist. Each window has a stable session identifier and
one committed package generation. A replacement stages a fresh token and keeps
the committed story frame mounted while a hidden candidate frame loads. Main
commits only after the candidate acknowledges the new generation; the shell
then promotes that already-loaded frame. Commit releases the old package, while
failure or timeout releases the candidate and preserves the current frame,
runtime progress, and captured logs.

Normal close, preview destruction or crash, owner reload/destruction, and app
shutdown release the session's packages and scratch roots. Startup and shutdown
cleanup is not required for correctness: staging opportunistically prunes
abandoned packages by the configured cache age, and shutdown performs a final
cleanup pass. The
application-lifetime protocol handler remains installed while individual
package registry entries come and go.
