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
Manually dispatching the workflow for that tag authorizes publication after the
committed approval, required CI, draft verification, and every pre-publication
checklist item have passed.

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
unpublished tag whose workflow failed may be deleted only after the release
manager records that decision in the checklist; its version must not be
published from a different commit.

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
   approval. The release workflow discovers and records those same-commit run
   IDs without creating a self-referential plan commit.
7. Create and push the annotated tag:

   ```sh
   git tag -a v0.2.0-beta.1 -m "Twine RS 0.2.0-beta.1"
   git push origin v0.2.0-beta.1
   ```

Do not manufacture historical tags for builds whose exact source and artifacts
cannot be proven.

## Automated publication

`.github/workflows/release.yml` checks the annotated tag, synchronized versions,
dated changelog, plan decisions, and clean source commit. A tag-triggered run:

1. builds the seven supported downloads on five target-native runners;
2. exercises each installable format;
3. validates the complete profile-specific artifact and provenance matrix;
4. creates a draft GitHub Release and uploads every artifact and evidence file.

The tag-triggered run stops at the draft. After inspecting that draft and
checking every pre-publication item, manually dispatch **Publish desktop
release** with the existing annotated tag. The dispatched run rebuilds and
revalidates the exact tag commit, then:

1. verifies that every pre-publication checklist item is complete;
2. generates `release-record.json` and the deterministic release-evidence ZIP;
3. publishes the immutable release;
4. downloads and smokes release-hosted artifacts on Windows, macOS, and Linux.

Manual dispatch is the final solo-maintainer publication approval. It can also
recover a failed pre-publication run, but cannot change the tag, plan, source
commit, or version.

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
- the project license, third-party notices, SBOM, Chromium licenses, and the
  deterministic release-evidence ZIP;
- links to the checklist, quality run, packaged-app run, recovery test, and
  publication workflow.

The release record binds the version, tag, commit, profile, release-manager
approval, compatibility and rollback decisions, evidence URLs,
aggregate-manifest hash,
every artifact hash, every target-manifest hash, and the standalone evidence
hashes. Fourteen-day `desktop-local-*` CI artifacts remain test inputs only and
are not release evidence.

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
