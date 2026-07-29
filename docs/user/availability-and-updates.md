# Twine RS availability and updates

Status: current
Owner: product documentation maintainers
Last verified: 2026-07-29
Source of truth: shipped Twine RS distribution and update behavior

Twine RS has not yet published a formal downloadable release. If you want to
try the current code, follow the source setup and development instructions in
the repository's root [`README.md`](../../README.md).

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
they choose to update their checkout.
