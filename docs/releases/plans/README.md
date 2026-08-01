# Release plans

Status: current
Owner: release maintainers
Last verified: 2026-07-29
Source of truth: reviewed per-release decisions

Each intentional release adds one approved
`v<version>.json` plan in this directory. Start from
[`../release-plan.example.json`](../release-plan.example.json) and validate it
with the command in [`RELEASING.md`](../../../RELEASING.md).

Retain every plan, including a plan for an unpublished candidate that was
superseded after its immutable tag was created. The plan and checklist preserve
the decision and failure evidence even though that version is never published.
