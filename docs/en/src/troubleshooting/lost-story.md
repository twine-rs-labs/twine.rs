# If a Project or Story Is Missing

Stop editing and preserve the data that remains before attempting recovery.
Record the Twine RS version, the last place the story opened successfully, and
any error message. Avoid repeated imports or saves over the affected project.

## Browser-local projects

Check that you opened the same editor address in the same browser profile.
Private browsing, another profile, and a different protocol, hostname, or port
have separate storage. Clear any project search or tag filters before deciding
that stories are missing.

If the library is still incomplete, [preserve and inspect browser storage](local-storage.md).
Current Twine RS uses a versioned manifest; looking only for old
`twine-stories-*` keys can miss saved work. Browser data can be removed by site-data
cleanup or profile deletion. Twine RS cannot reconstruct text whose only stored
copy has been removed.

If you have an exported HTML library archive or story source, import it into a
separate browser profile first. Use the same Twine RS build, inspect the import
review, and verify the recovered passages, scripts, stylesheet, story format, and
links. Importing a story marked **Replace** in your original profile overwrites
the matching library story; preserve its current data before selecting it.

Browser-local projects do not receive the desktop application's scheduled
story-library backups. Keep exports and external media in storage you control.

## Desktop projects

Check the active story-library folder in **Settings**, clear project filters,
and locate the original `.twine.rs` folder in your file manager. Changing the
default project location does not move an existing project. A folder outside the
configured story library may need to be opened again. Open **New Project**,
choose the **Import** tab, then select **Open Project Folder** in the
**Import Source** panel.

Before opening a possibly damaged folder, quit Twine RS and copy the entire
folder to a separate location, including hidden `.twine/` metadata, `twine.toml`,
passage sources, scripts, styles, and assets. Preserve the original. Open the
working copy using the
[isolated recovery-library procedure](backups.md#test-with-an-isolated-library).
A copy retains the original's story identities, so do not open both in the same
library. Do not treat `twine.toml` or one passage file as a complete project backup.

If the folder is missing or cannot be loaded, use the
[desktop recovery and backups guide](backups.md). Scheduled backups cover the
configured story library, so projects stored elsewhere require a separate file
backup or source-control copy. Restore into a separate directory and verify it
before replacing any current data.

If only some passages are missing, preserve the complete project and any external
change or import error before attempting manual source repair. A missing passage
does not by itself establish that its file was deleted; manifest, source, and
conflict information may be needed to determine what happened.
