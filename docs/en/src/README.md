# Twine RS User Manual

<!-- documentation-class: twine-rs-user-manual -->

This manual describes the shipped Twine RS desktop and browser editors.
It was checked against the `0.2.0-beta.6` source tree at `ee12429e`.
Twine RS remains prerelease software. Platform-specific validation and known
limits are recorded in the [manual audit](https://github.com/twine-rs-labs/twine.rs/blob/main/docs/status/manual-audit.md).

Start with [installation](getting-started/installing.md), then
[create your first story](getting-started/first-story.md). Use the sidebar or
search to find a task. The [interface guide](getting-started/getting-around.md)
explains the workspace rail, action tabs, and command palette.

The desktop app saves directory-backed projects and can watch external edits.
The browser editor stores its library in the current browser profile and
origin. It does not have desktop filesystem access or scheduled library
backups. Read [storage and folders](story-library/location.md) and
[backups](troubleshooting/backups.md) before relying on either storage mode.

## What Is Twine Good At?

Twine RS edits interactive stories built from passages connected by links.
You can write branching fiction, tutorials, dialogue, and other text-led work.
Exported playable HTML is opened by players in a browser; they do not need
Twine RS installed.

## What Is Twine Bad At?

Story formats determine presentation, multimedia, variables, and game logic.
Twine RS does not provide collaborative live editing, an operated cloud-save
service, or automatic online publication. See [limitations](limitations/index.md)
and [Build & Export](publishing/publishing.md) for the actual boundaries.

## See Also...

For story-language syntax, use your selected format's documentation:
[Harlowe](https://twine2.neocities.org/),
[Chapbook](https://klembot.github.io/chapbook/guide/),
[SugarCube](https://www.motoslave.net/sugarcube/2/), or
[Snowman](https://videlais.github.io/snowman/2/).
Changing the format does not translate your story's code.

This manual retains authoring concepts and historical material from upstream
Twine/TwineJS, a separate product. The
[upstream release-history appendix](release-notes/index.md) is historical;
[Twine RS changes](https://github.com/twine-rs-labs/twine.rs/blob/main/CHANGELOG.md)
and [downloads](https://github.com/twine-rs-labs/twine.rs/releases) belong to this project.
For repository documentation, use the
[documentation map](https://github.com/twine-rs-labs/twine.rs/blob/main/docs/README.md)
or the [user documentation](https://github.com/twine-rs-labs/twine.rs/blob/main/docs/user/README.md).

<!-- Preserved section links from the previous manual. -->

<a id="hello"></a>
