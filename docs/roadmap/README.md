# Active roadmap

Status: active
Owner: repository maintainers
Last verified: 2026-08-03
Source of truth: unfinished repository outcomes

This directory contains only unfinished work. Completed implementation plans
move to `docs/archive/completed-plans/`; current capabilities belong in
`docs/status/`.

The `0.2.0-beta.2` public prerelease completed the first formal release
milestone. The release roadmap now tracks only validation and distribution work
that remains for later prereleases and stable releases.

## Priority order

1. [Performance optimization](./performance.md)
2. [Product depth and legacy retirement](./product.md)
3. [Post-beta release validation](./release.md)

The order is deliberate. The Rust ownership and benchmark foundations now
exist, so profiling and measured optimization should precede another large
architecture migration.

## Completion rule

A roadmap item is complete only when:

- its observable outcome is implemented;
- proportionate tests or measurements pass;
- obsolete product paths are removed or explicitly quarantined;
- architecture and status documentation reflect the result.

Completed checklists are not retained here as status history.
