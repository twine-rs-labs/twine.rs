# Releasing Twine RS

This is the normative release, versioning, publication, provenance, support,
and rollback policy for Twine RS. Native-platform trust requirements remain
authoritative in
[`docs/decisions/0005-platform-and-distribution.md`](docs/decisions/0005-platform-and-distribution.md).

## Release classes

- A **local test build** uses the `local` profile. It is not a release, is never
  tagged, and must not be attached to a GitHub Release.
- A **prerelease** uses a version such as `0.2.0-beta.1` or `0.2.0-rc.1` and is
  marked as a GitHub prerelease. It receives best-effort support.
- A **stable release** uses a version such as `0.2.0` and becomes the supported
  stable version.

Release class and artifact profile are separate decisions. Either a prerelease
or stable release may use `distributable-unsigned` or `signed`. Deliberately
unsigned publication is allowed only with the warnings, checksums, and
provenance required by ADR 0005.

## Roles and approval

Every release has one release manager. Because Twine RS may be maintained by
one person, an independent approver and a protected publication environment are
not required. The release manager prepares the plan, coordinates validation,
reviews the version, notes, compatibility decision, artifact profile, evidence,
and rollback plan, and records explicit approval in both the committed release
plan and completed checklist issue.

Review by another maintainer is encouraged when one is available and may be
recorded in the checklist, but its absence does not block a release. For a
solo-maintainer release, pushing the protected annotated tag creates the draft.
Manually dispatching the workflow for that tag with `publish` enabled and the
successful inspected candidate run ID authorizes publication after the
committed approval, required CI, draft verification, and every pre-publication
checklist item have passed. A dispatch with `publish` disabled may re-verify a
named pre-tag candidate and recover the draft but cannot build or publish it.

## Versions and tags

Twine RS uses Semantic Versioning and tags of the form `v<version>`.

- `package.json`, the package-lock root, the Cargo workspace version, and every
  workspace crate recorded in `Cargo.lock` must agree.
- `twineCompatibilityVersion` is independent of the Twine RS version.
- Public prereleases use `beta.N` or `rc.N` identifiers.
- SemVer build metadata is permitted, but it remains part of the immutable tag
  and filename and cannot be used to reuse a published version.
- While the project is below 1.0, a minor release may contain an intentional,
  documented compatibility change.
- A stable patch release must not intentionally introduce an incompatible
  project-format change.
- A published version is never reused.

Release tags are annotated and point to the exact clean commit used by every
artifact target. Create a tag only after its release commit is merged to `main`
and required CI has passed. A release maintainer creates the tag; signing the
annotated tag is recommended but is not yet required.

Configure a GitHub tag ruleset for `v*` that restricts creation to release
maintainers or the release workflow and blocks updates and deletion. Once a
release is published, its tag is never moved, deleted, or recreated. An
unpublished tag whose workflow failed is abandoned in place: record the
decision in the checklist and supersede it with a new version and tag. Never
move, delete, or recreate it to reuse the version or publish from a different
commit.

Enable GitHub immutable releases before the first publication. All assets are
uploaded to a draft and verified before the protected publication job makes it
public.

## Changelog and release notes

[`CHANGELOG.md`](CHANGELOG.md) is the canonical user-facing Twine RS change
history. Keep changes under `Unreleased`; during candidate preparation, move
them to an exact dated heading:

```markdown
## [0.2.0-beta.1] - 2026-08-01
```

The release workflow combines that entry with the release plan's artifact
profile, supported targets, known issues, migration decision, rollback
instructions, support link, checksums, and provenance details. GitHub-generated
notes may help identify pull requests and contributors, but are not a
replacement for this curated record.

## Release plan

Copy
[`docs/releases/release-plan.example.json`](docs/releases/release-plan.example.json)
to `docs/releases/plans/v<version>.json` and complete every decision. The
release plan is merged before tagging and must name:

- version, tag, date, channel, artifact profile, and release manager;
- the release checklist issue and explicit release-manager approval;
- the previous known-good version, or an explicit first-release declaration;
- project-format and settings compatibility, backup requirements, and known
  issues;
- application and project-data rollback instructions with test evidence;
- recovery evidence and the decisions needed to interpret the automated
  same-commit quality and packaged-app evidence.

Validate it with:

```sh
npm run release:check -- --plan docs/releases/plans/v0.2.0-beta.1.json
```

The JSON schema and field guidance are in
[`docs/releases/README.md`](docs/releases/README.md).

## Safe merge-queue activation

Roll out merge-queue native-only execution in this order:

1. Leave `TWINE_MERGE_QUEUE_NATIVE_ONLY` unset or `false` while the merge queue
   ruleset is disabled. In this mode PR, `main`, and merge-group events retain
   native evidence where the path classifier requires it.
2. Merge the workflow changes that add `merge_group` handling and the stable
   required checks named **Quality gate** and **Packaged Electron gate**.
3. Configure the ruleset to require those two stable status checks.
4. Enable and pilot the merge queue. Confirm the successful `merge_group` head
   SHA is the SHA that lands on `main` and that its same-SHA evidence is
   reusable by candidate preparation. Record the merge-group workflow URL,
   both SHAs, and the `desktop-local-test-bundle` artifact ID and digest.
5. Only after that confirmation, set `TWINE_MERGE_QUEUE_NATIVE_ONLY` to `true`.

Enabling the variable earlier suppresses native work on PR and direct `main`
events before merge-group evidence is proven reusable. Candidate preparation
then blocks fail-closed because it cannot bind complete same-commit packaged
evidence. Do not change GitHub rulesets and the variable in the opposite order.

## Candidate preparation

1. Open the **Release checklist** issue form. Name the manager, version,
   profile, previous known-good release, and plan path.
2. Bump all JavaScript and Rust versions together, for example:

   ```sh
   npm run version:bump -- 0.2.0-beta.1
   ```

3. Finalize the dated changelog entry and release plan.
4. Run the repository quality gates and obtain passing target-native packaged
   app evidence from the same release commit.
5. Exercise project open, save, backup, recovery, and any applicable migration
   and previous-version reopening path.
6. Merge the clean release commit. Confirm its Quality and Packaged Electron
   workflows pass, review the completed evidence, and record release-manager
   approval. Candidate preparation binds those same-commit run IDs and native
   bundle provenance without creating a self-referential plan commit.
7. Manually dispatch **Build desktop release candidate** from `main` with the
   intended tag. The workflow fails unless its dispatch SHA is still the exact
   `origin/main` HEAD, the intended tag is absent both locally and remotely,
   and both required same-SHA CI workflows retain complete evidence. It binds
   the quality and packaged run identities plus the native test-bundle artifact
   ID, digest, and size; builds and smokes the five native targets; assembles
   the exact distributable file set; rechecks that the tag is still absent; and
   retains a hash-bound pre-tag candidate for 30 days. Review that successful
   candidate run and record its ID.
8. Create and push the annotated tag at that same commit:

   ```sh
   git tag -a v0.2.0-beta.1 -m "Twine RS 0.2.0-beta.1"
   git push origin v0.2.0-beta.1
   ```

Do not manufacture historical tags for builds whose exact source and artifacts
cannot be proven.

## Automated publication

`.github/workflows/release-candidate.yml` is the only release workflow that
builds native packages. It has read-only repository permissions, runs before
the tag exists, and binds its distinctly named retained unit to the exact main
SHA, intended tag, profile, complete plan hash, native matrix, and file digests.

`.github/workflows/release.yml` never builds or assembles native packages. A tag
push checks the annotated tag and deterministically selects the newest
successful, nonexpired pre-tag candidate whose run SHA and derived artifact
name match the tagged commit and committed plan. It fully verifies that unit
and its metadata-bound quality and packaged workflow runs. The shorter-lived
native test-bundle artifact does not need to remain downloadable after its
identity, digest, and size have been bound into the 30-day candidate. The
workflow creates the draft GitHub Release, uploads the exact assets, verifies
their digests and release metadata, and stops.

A failed draft run may be recovered by manually dispatching **Publish desktop
release** with the existing tag, `publish` disabled, and the explicit pre-tag
candidate run ID. Recovery re-verifies and reuses that unit; it does not rebuild
or silently select another candidate.

After inspecting the draft and checking every pre-publication item, dispatch
the workflow with the same tag, `publish` enabled, and that candidate run ID.
The publication run does not rebuild native packages or refresh the draft. It
downloads the retained unit from the named run, verifies the run and artifact
provenance, revalidates the plan, tag commit, profile, and artifact matrix, and
requires every candidate draft asset to retain the exact inspected size and
SHA-256 digest. It then:

1. verifies that every pre-publication checklist item is complete;
2. generates `release-record.json` and the deterministic release-evidence ZIP;
3. publishes the immutable release;
4. downloads and smokes release-hosted artifacts on Windows, macOS, and Linux.

Manual dispatch with `publish` enabled is the final solo-maintainer publication
approval. An expired, missing, unsuccessful, or mismatched candidate fails
closed. While the intended tag is still absent, dispatch a new pre-tag candidate
from the still-current exact main SHA, then inspect it before tagging. After the
tag exists, the candidate cannot be rebuilt or replaced for that tag: abandon
that release and supersede it with a new version and tag according to the
immutable-tag policy. Never move, delete, or recreate the tag to manufacture a
replacement candidate. A publication retry may replace only its own
`release-record.json` and release-evidence ZIP while the release remains a
draft. Neither dispatch mode can change the tag, plan, source commit, profile,
artifact matrix, or version.

The deliberately unsigned profile is the usable profile until signing
credentials exist. It requires no signing variables, secrets, or other profile
configuration; the plan selection and `ALLOW_UNSIGNED_DISTRIBUTION` workflow
acknowledgement are sufficient. It receives no signing credentials.

If signed releases are enabled later, the signed profile requires repository
variables for the expected identities (`APPLE_APP_ID`, `APPLE_TEAM_ID`,
`CSC_NAME`, `WINDOWS_SIGNER_SUBJECT`, and `WINDOWS_SIGNER_SHA1`) and repository
secrets `APPLE_ID`, `APPLE_ID_PASSWORD`, `MACOS_CSC_LINK`,
`MACOS_CSC_KEY_PASSWORD`, `WINDOWS_CSC_LINK`, and
`WINDOWS_CSC_KEY_PASSWORD`.

## Retained evidence

Every GitHub Release retains, for the life of the release:

- all seven validated desktop artifacts;
- `SHA256SUMS.txt`, `artifact-manifest.json`, and all five target manifests;
- `WHICH TO DOWNLOAD.md`, `release-notes.md`, and `release-record.json`;
- the exact pre-tag `release-candidate.json` that identifies the promoted run;
- the project license, third-party notices, SBOM, Chromium licenses, and the
  deterministic release-evidence ZIP;
- links to the checklist, quality run, packaged-app run, recovery test, and
  candidate and publication workflows;
- the retained candidate artifact ID, digest, and size, plus the hash-bound
  `release-candidate.json` inside the release-evidence ZIP;
- the candidate-time quality and packaged run identities and head SHAs, plus
  the native test-bundle artifact ID, name, digest, and size.

The release record binds the version, tag, commit, profile, release-manager
approval, compatibility and rollback decisions, evidence URLs,
aggregate-manifest hash,
every artifact hash, every target-manifest hash, and the standalone evidence
hashes. Fourteen-day `desktop-local-*` CI artifact bytes remain test inputs and
need not outlive the 30-day candidate; their candidate-time identity and digest
are retained as provenance.

## Post-publication and closeout

After publication:

1. require the release workflow's fresh-download smoke jobs to pass;
2. verify the release status, notes, filenames, checksums, and provenance;
3. link the published release and workflow run from the checklist;
4. confirm the supported-version statement remains accurate;
5. check every Post-publication item and close the checklist issue.

Export the issue JSON and validate closeout when desired:

```sh
gh issue view <issue-url> --json url,state,body > checklist.json
npm run release:check -- \
  --plan docs/releases/plans/v0.2.0-beta.1.json \
  --phase closeout \
  --checklist-json checklist.json
```

REL-011 is closed only after the first intentional release has a protected tag,
curated notes, a completed and closed checklist, immutable artifacts, retained
provenance, and recorded support and rollback decisions.

## Withdrawal and rollback

Never replace assets or move a published tag. Correct an ordinary defect with a
new patch or prerelease. For a critical defect:

1. stop recommending the affected version and publish a visible withdrawal or
   security notice;
2. preserve its tag, release, assets, checksums, and provenance;
3. direct users to the recorded previous known-good version when safe;
4. publish a corrected new version;
5. state whether application downgrade also requires restoration of a project
   or settings backup.

An irreversible migration requires a pre-migration backup and explicit release
notes. Stable releases must not make rollback impossible without that recorded
decision and recovery evidence. Automatic updates remain disabled until a
separately approved, signed, and tested update feed exists.
