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

Before tagging, manual **Build desktop release candidate** dispatch from exact
`origin/main` builds and smokes the distributable matrix and retains its
plan-hash-derived artifact for 30 days. Candidate creation fails unless the
intended tag is absent locally and remotely, and rechecks that absence before
retaining the unit. It binds the exact quality and packaged workflow run IDs,
URLs, and head SHAs plus the native test-bundle artifact ID, name, digest, and
size. The tag-triggered workflow discovers the newest successful, nonexpired
unit matching the exact tagged SHA, intended tag, profile, and plan hash,
verifies the candidate and those metadata-bound CI runs, and creates the draft
without rebuilding. The shorter-lived native test-bundle bytes need not remain
downloadable once their provenance is bound into the candidate.
Manual draft recovery and publication require the explicit candidate run ID.
Both reuse and revalidate that pre-tag unit; neither can build packages or
silently fall back to another candidate.

If a candidate expires or becomes unavailable before tagging, prepare another
candidate only while the intended tag is still absent. Once the tag exists, do
not rebuild or replace its candidate and do not move, delete, or recreate the
tag. Abandon and supersede that release with a new version and tag under the
immutable-tag policy.

The record follows
[`release-record.schema.json`](./release-record.schema.json) and is uploaded
before the immutable release is published. It records post-publication
completion as pending because fresh-download checks necessarily happen after
publication; the linked checklist issue is the durable closeout record.
New records include the candidate workflow URL, Actions artifact ID and digest,
the metadata-bound CI run and native test-bundle provenance, and the hash of the
standalone `release-candidate.json` also retained in the evidence ZIP. Those
fields are optional in the schema so records produced before candidate reuse
remain valid.

Do not hand-edit a generated record or commit one as a substitute for the
release workflow.
