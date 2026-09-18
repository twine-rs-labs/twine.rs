# Rolling Back Twine RS

Twine RS rollback is manual. Use the affected release's notes to identify its
previous known-good version and any required project-data or settings recovery.
Older releases remain available for rollback but are unsupported. Version
numbers alone do not guarantee that an older prerelease can read newer data.

Reinstalling an older application does not reverse a data migration. Preserve
both your current data and the pre-upgrade backup before changing versions.

## Desktop rollback

1. Quit Twine RS. Copy the current story library, every separately stored
   `.twine.rs` project folder, and the Twine RS settings directory to a safe
   location. Keep complete folders, including assets and hidden `.twine/`
   metadata. See [desktop recovery and backups](../troubleshooting/backups.md)
   for locations and backup scope.
2. Find the previous known-good version on the
   [Twine RS Releases page](https://github.com/twine-rs-labs/twine.rs/releases).
   Read its notes and the affected release's rollback instructions. Choose the
   artifact for your operating system and CPU architecture, and verify its
   published checksums and declared signing profile.
3. With Twine RS closed, replace the application using that platform's install
   procedure. Preserve the data backups; do not delete the story library or
   settings as part of reinstalling the application.
4. If the notes require pre-migration data or settings, restore those from the
   corresponding backup while the application is closed. Keep the newer copies
   separately. Do not merge old and new project directories or assume that a
   settings reset converts project data.
5. Test a separate copy of a known-good project using the
   [isolated recovery-library procedure](../troubleshooting/backups.md#test-with-an-isolated-library).
   Check that the selected older release supports those command-line options
   before launching it. Check the project's passages, start
   passage, story format/version, scripts, stylesheet, assets, and Play/Test.
   Save and reopen the working copy before resuming normal editing.

If release notes do not establish compatibility for your data, keep the backup
untouched and seek support before opening that data in an older build. The
[Twine RS support policy](https://github.com/twine-rs-labs/twine.rs/blob/main/SUPPORT.md)
describes rollback and migration-backup requirements.

## Browser and source builds

Twine RS does not provide upstream Twine's versioned `twinery.org` browser
service. Upstream Twine downloads and browser URLs are a separate product, not
a Twine RS rollback path.

Before replacing a web/source build, export an HTML library archive if possible
and [preserve the current browser storage](../troubleshooting/local-storage.md).
Use the desired Twine RS release/tag's own build instructions and a separate
browser profile or origin for the initial test. Import the archive there and
check it before returning to the original profile. Do not point an older build
at the only copy of current browser storage or restore raw storage records by
hand. An export does not preserve external asset files; copy those separately.
