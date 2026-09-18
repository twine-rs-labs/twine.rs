# Twine RS desktop startup recovery

Preserve project data before trying recovery. These instructions apply to Twine RS, not upstream Twine.

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

See [desktop backups and restoration](backups.md) for project-data recovery.
