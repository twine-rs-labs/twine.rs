# Referenced-media reader hardening

Status: active
Owner: native-platform, security, and performance maintainers
Last verified: 2026-07-21
Source of truth: the bounded desktop referenced-media payload reader

## Objective

Harden the shipped desktop media reader without broadening its renderer
capability or weakening the 25-file and 25 MiB encoded-size ceilings. These are
follow-up improvements, not known release blockers for the current explicit
export workflow.

## Work order

### 1. Move payload reads off Electron's main thread — P2

The native reader currently performs its bounded file reads synchronously.
Fast local storage should keep the pause short, but a permitted batch on slow,
cloud-backed, or network storage can make the desktop shell temporarily
unresponsive.

- Measure event-loop delay for representative 1 MiB and 25 MiB batches on local
  and deliberately throttled storage before choosing the implementation.
- Move the existing native operation to an asynchronous N-API task while
  preserving active-session authorization, trusted index baselines, stable
  result ordering, structured per-path failures, and native hard limits.
- Keep payload encoding in the renderer and do not add a TypeScript filesystem
  fallback.

Exit signal: an explicit 25 MiB export does not create a main-process long task,
and the current native, IPC, build, and packaged acceptance tests still pass.

### 2. Use race-free, no-follow file opening — P2 security hardening

The reader canonicalizes and contains each path before `File::open()`, then
revalidates path and file metadata after reading. A malicious local process with
concurrent control of the project directory could still attempt a narrow
symlink-swap race between path validation and opening.

- Open assets relative to a trusted project/assets directory handle and reject
  symlinks or reparse points at every component.
- Define equivalent Unix and Windows behavior instead of relying on a
  platform-specific lexical check.
- Retain the existing post-read identity, size, modification-time, and
  containment checks as defense in depth.

Exit signal: deterministic symlink/reparse-point swap tests cannot make the
reader open bytes outside the canonical `assets/` tree.

### 3. Add content-digest index validation — P3

The accepted baseline currently compares file identity, size, and modification
time. A same-size rewrite that also restores the indexed modification time can
therefore evade the “changed since indexing” result.

- Measure the indexing and retained-memory cost before selecting SHA-256,
  BLAKE3, or another stable digest strategy.
- Prefer hashing only managed referenced candidates, with incremental reuse for
  unchanged file identities, instead of hashing every project asset eagerly.
- Pass trusted baseline digests from Electron main to native; renderer-supplied
  digests must not become an authority.

Exit signal: a same-size asset rewrite with a restored modification time is
reported as changed, without materially regressing normal project indexing.

## Priority rule

Implement the asynchronous reader first because it addresses the most likely
user-visible problem and can add the timing evidence needed for the other work.
Advance no-follow opening ahead of it only if the release threat model expands
to actively hostile project directories. Content digests remain last unless
reproducible or adversarial asset integrity becomes a product requirement.
