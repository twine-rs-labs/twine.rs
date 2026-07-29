# Desktop recovery and backups

Status: current
Owner: product documentation maintainers
Last verified: 2026-07-29
Source of truth: Twine RS desktop settings and story-library backup behavior

This page describes the current Twine RS desktop application. It does not
describe the separate upstream Twine application or browser storage.

## Recovering from damaged settings

Twine RS stores desktop settings in `prefs.json` and `app-prefs.json`. Both
files are in Twine RS's Electron user-data directory, which the application
derives as the operating system's application-data directory plus `twine-rs`.

Use the operating system's normal application-data location rather than
assuming an absolute path:

- On macOS, choose **Go > Go to Folder** in Finder, open
  `~/Library/Application Support`, and look for `twine-rs`.
- On Windows, enter `%APPDATA%` in File Explorer's address bar and look for
  `twine-rs`.
- On Linux, look under the configuration root used by your desktop session,
  commonly `$XDG_CONFIG_HOME` or `~/.config`, for `twine-rs`.

Install packaging and environment configuration can change the parent
application-data directory. Before changing anything, verify that the derived
`twine-rs` folder contains `prefs.json` and `app-prefs.json`.

To try a reversible settings reset:

1. Quit Twine RS completely.
2. Copy the `twine-rs` settings directory to a safe location.
3. In the original directory, rename `prefs.json` and `app-prefs.json`, for
   example to `prefs.json.disabled` and `app-prefs.json.disabled`.
4. Start Twine RS. The application continues with default settings and
   recreates settings files when those settings are saved.

If this does not help, quit Twine RS before restoring the saved files. Renaming
or copying is safer than deleting because it preserves the previous settings
for inspection or restoration.

A settings reset is not a project-data recovery operation. Do not rename,
remove, or replace story-library folders or `.twine.rs` project folders while
resetting settings. Do not change an upstream Twine application-data or story
directory; upstream Twine is a separate product.

## Story-library and backup locations

The default desktop story library is under the operating system's Documents
folder:

```text
Documents/Twine RS/Stories
```

The default backup root is alongside it:

```text
Documents/Twine RS/Backups
```

`Stories` and `Backups` are the English names. Twine RS uses localized leaf
folder names in other languages. The story-library and backup locations can
also be overridden in application settings or for a single command-line
launch, so reveal or confirm the active folders in Twine RS before copying or
restoring data.

Twine RS backs up the desktop story library once during startup and then on a
schedule. The default cadence is 20 minutes. Each backup is a timestamped
directory containing a copy of the story library. By default, Twine RS retains
10 backup directories and removes the oldest backup directories when the limit
is exceeded.

Backups cover the configured story library. A `.twine.rs` project folder
opened from elsewhere is separate project data and should be backed up using
your normal file-backup or source-control workflow.

## Choose dedicated folders

Never use the story library itself, one of its parents, or an unrelated
data-containing directory as the backup root. Twine RS rejects overlaps between
the active story library and backup folder, but backup retention still removes
old directories from the configured backup root. A poorly chosen root could
therefore put unrelated directories at risk.

Keep the story library, backup root, scratch/cache folder, and unrelated files
in separate directories. The scratch/cache cleanup process also removes old
files from its configured folder; see the
[`desktop command-line guide`](./desktop-command-line.md) before overriding
these paths.

Twine RS does not provide cloud backup or automatic recovery. Periodically copy
important `.twine.rs` project folders, the story library, and selected backup
directories to storage you control, and test that you can read those copies.
