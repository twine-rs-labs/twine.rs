# Twine RS availability and updates

Status: current
Owner: product documentation maintainers
Last verified: 2026-08-03
Source of truth: shipped Twine RS distribution and update behavior

[`Twine RS 0.2.0-beta.2`](https://github.com/twine-rs-labs/twine.rs/releases/tag/v0.2.0-beta.2)
is the first formal public prerelease. It provides Windows x64, macOS Intel and
Apple Silicon, and Linux x64 and arm64 downloads.

This is early-adopter software distributed with the
`distributable-unsigned` profile. Windows and macOS may show publisher or
unidentified-developer warnings. Before installing, verify the release's
checksums and provenance and make a separate backup of important story
libraries and `.twine.rs` project folders. Source users can instead follow the
setup and development instructions in the root [`README.md`](../../README.md).

[Upstream Twine](https://twinery.org/) is a separate product and a useful
compatibility reference. Its browser service, downloads, installation
instructions, and release schedule do not describe Twine RS.

## Updates

Current Twine RS builds do not have an operated update metadata feed. Automatic
updates are unavailable.

The desktop application keeps a manual **Check for Updates** command visible.
When no update feed is configured, as in current builds, the command reports
that update checking is unavailable and does not make a network request. Source
users should check the repository and repeat the root README's build steps when
they choose to update their checkout. Beta users should check the repository's
[Releases page](https://github.com/twine-rs-labs/twine.rs/releases) and install
a later version manually.
