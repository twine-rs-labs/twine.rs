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

### 1. Use race-free, no-follow file opening — P2 security hardening

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

### 2. Persist the asynchronous addon contract check — P3

The focused near-limit diagnostic proves that the native addon returns a
Promise and leaves Electron's main loop available while the bounded read runs,
but that diagnostic currently lives outside the tracked test suite. Normal Jest
tests intentionally do not depend on a prebuilt native addon.

- Add a post-`build:native` smoke test that calls the real addon directly.
- Assert that the call returns a Promise without throwing synchronously and
  that an invalid root rejects that Promise.
- Avoid timing thresholds; responsiveness measurements remain diagnostic
  evidence because storage and worker-pool scheduling vary by machine.

Exit signal: the build pipeline fails if the addon regresses to a synchronous
return value or synchronous validation error.

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

Advance no-follow opening if the release threat model expands to actively
hostile project directories. Add the asynchronous addon smoke check when native
build-pipeline coverage is next extended. Content digests remain last unless
reproducible or adversarial asset integrity becomes a product requirement.
