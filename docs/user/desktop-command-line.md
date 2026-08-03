# Desktop command line

Status: current
Owner: product documentation maintainers
Last verified: 2026-08-03
Source of truth: `commandLineHelpText` in the Twine RS desktop main process

This page describes command-line inputs accepted by current Twine RS desktop
source builds and the `0.2.0-beta.2` public prerelease. Install locations and
executable layouts vary by platform and package.

Command-line values apply to the desktop session launched by that command. The
command line does not itself rewrite the corresponding persisted settings.

## Launch the application

Quote executable and project paths that contain spaces. These examples show the
package's expected executable names; adjust the install location for your
system.

macOS:

```shell
"/Applications/Twine RS.app/Contents/MacOS/Twine RS" --help
```

Windows:

```powershell
& "C:\Program Files\Twine RS\Twine RS.exe" --help
```

Linux:

```shell
twine-rs --help
```

Pass one or more `.twine.rs` project-folder paths after the options to open
those projects at startup:

```shell
twine-rs --backupCadenceMinutes=30 "./My Story.twine.rs" "./Other Story.twine.rs"
```

## Supported options

The application generates this help text from the same option schema used by
its parser:

```text
Twine RS desktop

Usage:
  twine-rs [options] [project-folder...]

Options:
  --help, -h                          Show this help text.
  --storyLibraryFolderPath=<path>     Use a custom story library folder.
  --backupFolderPath=<path>           Use a custom backup folder.
  --backupCadenceMinutes=<minutes>    Set scheduled backup cadence (5–1440 minutes).
  --backupRetentionLimit=<count>      Set scheduled backup retention (1–500 backups).
  --scratchAssetStrategy=<link|copy>  Deprecated compatibility option; ignored.
  --scratchFolderPath=<path>          Use a custom preview/cache folder.
  --scratchFileCleanupAge=<minutes>   Set preview/cache cleanup age.
  --disableHardwareAcceleration       Disable hardware acceleration.

Open:
  Pass one or more .twine.rs project folders to open them on startup.
```

## Folder safety

Use dedicated directories for the story library, backups, and scratch/cache
data. Do not point any of these options at a directory containing unrelated
files.

The backup folder must not be inside the story library or one of its parents.
Twine RS rejects that overlap, but retention removes old directories from the
configured backup root. Scratch/cache cleanup removes old files from its
configured folder. Choosing a shared or overly broad folder can therefore
destroy unrelated data.

Before changing folder arguments, make a separate copy of important story
libraries and `.twine.rs` project folders. See
[`desktop recovery and backups`](./recovery-and-backups.md) for the defaults and
backup behavior.
