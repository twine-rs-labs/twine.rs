# Referenced-media reader hardening

Status: completed
Owner: native-platform, security, and performance maintainers
Last verified: 2026-07-21
Source of truth: the bounded desktop referenced-media payload reader

## Outcome

The desktop reader retains the original renderer capability and the 25-file,
25 MiB encoded-size ceilings while closing the three tracked follow-ups:

- Project roots, `assets/`, intermediate directories, and leaf files are
  opened through component-wise, handle-relative no-follow operations. The
  same leaf handle supplies metadata, bytes, and post-read validation.
- `build:native` loads the real addon and fails unless both the payload reader
  and digest capture return Promises and reject invalid roots asynchronously.
- Electron main privately retains SHA-256 baselines for the first 25 supported
  referenced-media candidates in each trusted story. Retained authority is
  capped at 100 stories and 100 unique paths per session; sources are scanned
  with 1 MiB, 256-candidate, and 4 KiB-per-path ceilings, and any incomplete
  scan fails closed. Ordinary ASCII sources with no possible media suffix take
  a semantics-preserving fast path, while trusted multi-source scans yield on
  an 8 ms budget and stop when a newer session refresh supersedes them.
  Compact source additions update the bounded story state, removals and
  structural edits revoke that story's authority, full saves use the story
  content they successfully persisted and replace only that story's state, and
  accepted disk state is rehashed. Native payload reads fail closed when the
  trusted digest is absent or different.

Per-path digest capture failures do not prevent a project from opening. They
leave that path without digest authority so export can report its existing
size, total-limit, unreadable, or changed result without returning unvalidated
bytes.

## Verification

- Deterministic Unix tests cover leaf and intermediate symlinks, replacement of
  the project root after canonicalization, and namespace replacement after a
  trusted directory handle is retained.
- Deterministic Windows tests cover intermediate and `assets/`-root junctions,
  replacement of the project root after canonicalization, and namespace
  replacement after a trusted directory handle is retained. Packaged Windows
  CI also exercises the shipped preload and native addon against a verified
  directory junction and requires an exact `symlink-escape` result.
- Native tests cover same-size rewrites with restored modification times,
  missing digests, and unchanged file/count/encoded-byte ceilings.
- Electron-main tests cover per-story ordering, bounded and incomplete source
  scans, compact additions and removals, structural and full saves,
  accepted-disk recapture, cancellation, refresh supersession and failure
  settlement, and bounded native admission.
- The packaged Electron test embeds referenced media across every bundled
  story-format family.

A real-addon warm-cache diagnostic hashed 25 files totaling 19,660,797 source
bytes in 69.9 ms median on the reference Mac. The JavaScript call returned in
about 0.05 ms, a zero-delay timer ran before completion, and the digest-enforced
payload read returned all 25 independently verified buffers. This is diagnostic
evidence, not a timing threshold.

After the bounded no-media fast path was added, canonical 10k and 50k startup
diagnostics each passed all 47 runtime invariants across three fresh processes.
The 10k result had no blocking regression against its matching accepted
reference; the 50k fixture has no accepted startup baseline. These focused
startup reports remain diagnostic artifacts rather than replacement full-phase
baselines.

Digest capture admits at most 100 paths and 25 MiB of encoded data in one
aggregate asynchronous native task. Payload embedding remains capped at 25
files and 25 MiB. Across both operations, Electron main permits one active and
one queued native read; a third request receives a stable busy error. Digest
backpressure withholds new authority without failing an already completed save,
and per-session refresh epochs prevent older work from restoring stale digest
or baseline state.

## Windows release gate

The capability crates implement Unix no-follow flags and Windows reparse-point
handling through one API. The Windows packaged-smoke job runs the native test
suite and the packaged Electron junction test without allowing either step to
fail, so junction, reparse-point, retained-capability, and root-swap behavior is
now enforced on pull requests and pushes to `main`.
