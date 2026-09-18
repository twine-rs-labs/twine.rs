# Installing Twine RS

## Desktop downloads

Use the [Twine RS Releases page](https://github.com/twine-rs-labs/twine.rs/releases).
Choose an actual published release and read its notes, known limitations,
rollback instructions, and declared artifact profile. The manual's source
version is not a claim that a newer release exists or that it is stable.

| System              | Download                   |
| ------------------- | -------------------------- |
| Windows x64         | NSIS `.exe` installer      |
| macOS Apple Silicon | `mac-arm64` `.dmg`         |
| macOS Intel         | `mac-x64` `.dmg`           |
| Linux x64           | x86_64 AppImage or x64 ZIP |
| Linux ARM64         | arm64 AppImage or ZIP      |

Do not choose a source-code archive when you want an installed application.
Keep a separate backup of existing projects, library, and settings before
replacing an installation; see [backups](../troubleshooting/backups.md).

## Verify a download

Download `SHA256SUMS.txt` from the same release. Compute the SHA-256 hash of
your downloaded artifact and compare it with the entry for that exact filename.
Replace these example filenames with your download:

```powershell
Get-FileHash -Algorithm SHA256 "downloaded-file.exe"
```

```sh
# macOS
shasum -a 256 "downloaded-file.dmg"
# Linux
sha256sum "downloaded-file.AppImage"
```

A matching checksum confirms the bytes, not the publisher's identity. The
release's `artifact-manifest.json` and target manifests record source and trust
information. Current deliberately unsigned distributions have no verified
Windows publisher; macOS builds are ad-hoc signed and unnotarized. Read the
release warning before deciding to run a download. Do not disable system-wide
security protections to install it.

## Install and open

- **Windows:** run the verified installer and follow its installation-location
  prompts. Launch Twine RS from the installed shortcut. A publisher warning is
  expected for an explicitly unsigned release; if your system blocks it, consult
  that release's guidance before proceeding.
- **macOS:** open the verified disk image, copy **Twine RS.app** to Applications,
  then launch that copy. Eject the disk image afterward. An unsigned release may
  be blocked by macOS; use the release's trust guidance and the system's
  per-application confirmation if you choose to proceed.
- **Linux:** make the verified AppImage executable using its file Properties or
  `chmod +x "downloaded-file.AppImage"`, then run it as your normal user. If
  AppImage is unavailable on your system, extract the ZIP into a dedicated
  directory and run its `twine-rs` executable. Keep the accompanying files
  together. Do not run the editor as root.

The first launch opens **Projects**. Continue with
[your first story](first-story.md). See [startup recovery](../troubleshooting/wont-start.md)
if an existing installation cannot open.

## Browser editor and source builds

Twine RS does not provide upstream Twine's `twinery.org` editor service. To run
this repository's browser editor or build the desktop app from source, follow
the [repository prerequisites and setup](https://github.com/twine-rs-labs/twine.rs/blob/main/README.md#prerequisites).
A browser library belongs to the exact editor URL's protocol, hostname, port,
and browser profile. Changing any of these can show a different library.

Export backups before clearing site data or moving to another origin. Browser
storage is not a file-backed desktop library and is not a cloud account.

<!-- Preserved section links from the previous manual. -->

<a id="twine-rs-availability-and-source-setup"></a>
