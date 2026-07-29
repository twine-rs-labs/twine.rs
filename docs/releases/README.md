# Release records

Status: current
Owner: release maintainers
Last verified: 2026-07-29
Source of truth: release-plan and retained-record field contract

[`RELEASING.md`](../../RELEASING.md) is the normative process. This directory
contains the machine-readable decision and evidence contract used by
`npm run release:check`.

## Plans

Copy [`release-plan.example.json`](./release-plan.example.json) to
`plans/v<version>.json`. The filename and embedded tag must agree. A plan is an
approved input committed before the annotated tag is created; it intentionally
does not contain the source commit because adding that value to the same commit
would be self-referential.

The fields are defined by
[`release-plan.schema.json`](./release-plan.schema.json). Recovery evidence uses
a durable HTTPS URL, normally a GitHub Actions run or checklist comment linking
to retained output. `previousKnownGoodVersion` is `null` only for the first
formal release. Quality and packaged-app run IDs are deliberately absent:
adding a run ID to a commit would create a new commit. The publication workflow
discovers successful runs for the exact tag commit and writes their URLs into
the generated record.

## Records

The publication job generates `release-record.json` after:

- the exact tag commit has produced one clean, complete artifact manifest;
- the release plan and dated changelog entry validate;
- every checklist item before `Post-publication` is checked.

The tag-triggered run creates the draft but cannot publish it. Manual workflow
dispatch for the same tag is the release manager's final publication approval.
It rebuilds and revalidates the immutable tag commit before publishing.

The record follows
[`release-record.schema.json`](./release-record.schema.json) and is uploaded
before the immutable release is published. It records post-publication
completion as pending because fresh-download checks necessarily happen after
publication; the linked checklist issue is the durable closeout record.

Do not hand-edit a generated record or commit one as a substitute for the
release workflow.
