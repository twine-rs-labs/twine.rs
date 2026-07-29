# Support policy

This policy applies to Twine RS releases. The inherited upstream Twine manual
and upstream Twine versions have their own support lifecycle.

## Supported versions

- The latest stable Twine RS release is supported.
- The latest prerelease receives best-effort support and is superseded by the
  next prerelease or stable release.
- Older releases remain downloadable for rollback and audit purposes but are
  unsupported.
- Until the first stable release is published, there is no supported stable
  binary. Source checkouts and prereleases receive best-effort support.

The project does not promise a response or resolution time and does not
currently maintain LTS branches.

## Getting help

Open a [GitHub issue](https://github.com/twine-rs-labs/twine.rs/issues) and
include:

- the exact Twine RS version;
- operating system and CPU architecture;
- artifact profile (`signed` or `distributable-unsigned`) when applicable;
- clear reproduction steps and expected behavior;
- relevant diagnostics with secrets and personal story content removed.

Use GitHub's private vulnerability-reporting path for suspected security
vulnerabilities when it is available. Do not put secrets, private story
content, or an unpatched vulnerability exploit in a public issue.

Security defects, project corruption or data loss, application-launch failures,
and release-integrity failures may justify an expedited patch or prerelease.
That prioritization does not create an SLA.

## Rollback support

Release notes identify the previous known-good version and the application and
project-data rollback procedure. Automatic updates remain disabled, so
downgrades are manual.

Before installing a release whose notes require a migration backup, preserve
the project folders and settings described in those notes. Reinstalling an
older application cannot reverse an incompatible data migration by itself; the
corresponding pre-migration backup may also need to be restored.

Published versions are never reused. A defective release is preserved with its
tag, artifacts, checksums, and provenance, then withdrawn or superseded through
a public notice and a new version. Published binaries are never silently
replaced.
