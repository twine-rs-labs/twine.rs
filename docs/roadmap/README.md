# Active roadmap

Status: active
Owner: repository maintainers
Last verified: 2026-08-30
Source of truth: unfinished repository outcomes

This directory contains only unfinished work. Completed implementation plans
move to `docs/archive/completed-plans/`; current capabilities belong in
`docs/status/`.

The completed Runtime Debugger v1 expansion, runtime controls, source/graph
reveal, and consistent Test From Here work belong in
[`../status/current.md`](../status/current.md), and their implementation plans
belong in `../archive/completed-plans/`.

## Priority order

1. [Safe project-wide navigation and refactoring](./safe-project-refactoring.md)
2. [Product depth and legacy retirement](./product.md)
3. [Post-beta release validation](./release.md)

[Performance](./performance.md) remains a regression-monitoring track, not a
current optimization priority. The beta.5 comparison produced only marginal
threshold misses and no concrete, repeatable owner that justifies foreseeable
implementation work. Resume optimization only for a material reproducible
regression or an evidence-selected owner with a bounded remedy.

Release validation moves ahead of product work whenever a release candidate is
being prepared. A current actionable dependency or security finding can also
preempt product work, but the roadmap does not invent a standing release gate
that the governed workflow does not enforce.

## Completion rule

A roadmap item is complete only when:

- its observable outcome is implemented;
- proportionate tests or measurements pass;
- obsolete product paths are removed or explicitly quarantined;
- architecture and status documentation reflect the result.

Completed checklists are not retained here as status history.
