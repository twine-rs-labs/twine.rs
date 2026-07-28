# Settings

Open _Settings_ from the workspace rail or choose _Preferences_ from an
available application action toolbar. Settings are shown as a full screen, not
a dialog. Changes take effect immediately and are remembered between sessions.

Some settings depend on the native desktop bridge. They remain visible in the
web app so that the capability is discoverable, but are disabled when the
current platform cannot provide it.

## General

The _General_ panel controls:

- _Theme_: follow the system theme or always use the light or dark theme.
- _Language_: choose the language used by the application.
- _Story list_: choose the default story-library sort order.
- _Format list_: choose the default filter used when viewing story formats.

## Workspace and Modes

The _Workspace_ panel shows the active story-library folder. In the desktop app
you can choose another library, restore the default, or reveal it in the system
file manager. _Project default_ sets the default location for project-folder
work.

The _Modes_ panel chooses Auto, Text, Graph, or Split as the initial workbench
mode. Twine remembers the active mode and editor dock independently for each
project.

## Graph

The _Graph_ panel controls:

- the default passage-card size;
- whether a generated layout offers an action to save it;
- whether right-clicking empty graph space creates a passage; and
- whether passage cards show tag colors or tag names.

Grid and layout choices that belong to an individual story are stored with that
story rather than as application-wide settings.

## Editors

The _Editors_ panel controls whether editor cursors blink, the passage and code
editor fonts and scales, and the code-editor color theme.

Twine always uses CodeMirror 6 for its editing surfaces; the former global _Use
Enhanced Editors_ preference no longer exists. Story-format-specific editor
integrations can instead be enabled or disabled individually on the
[_Story Formats_ screen](../story-formats/extensions.md). Disabling an
integration keeps the generic editor and its core editing controls while
omitting the format's syntax mode, commands, and toolbar.

Passage font settings affect passage prose. Code font settings affect
JavaScript, CSS, and dialect syntax configured to use the code font. These
settings change the authoring interface only; they do not change the appearance
of a published story.

## Accessibility and Keyboard

The _Accessibility_ panel provides reduced-motion, high-contrast, and
keyboard-only editing preferences, along with editor-focus behavior. Focus rings
remain visible so keyboard focus is not lost.

The _Keyboard_ panel selects the shortcut profile used by supported navigation
and build actions. The command palette remains available from the _Command_
button in the application header.

## Storage and Backups

The _Storage_ panel sets the default asset folder and reports the active storage
backend. Native desktop builds also let you choose how long abandoned preview
caches are retained. Desktop preview assets are always copied into an isolated
temporary package; there is no link/copy preference.

The _Backups_ panel configures native backup cadence, retention, and reminders.
It can also start a backup, record that backups were reviewed, or reveal the
backup folder. These controls are disabled when the native desktop bridge is
not available.

## Story Formats

The _Story Formats_ panel chooses the default format for new stories and the
default proofing format. It also reports how many format-specific editor
integrations are disabled. Use the full
[_Story Formats_ screen](../story-formats/viewing.md) to add, remove, inspect,
reload, or enable and disable an individual format.

## Integrations and Sharing

The _Integrations_ panel contains the external-editor command where supported
and preferences for cloud save, revision control, and hosting hooks. The
_Sharing_ panel controls story-link behavior and shows which integration hooks
are active.

These settings expose integration policy; an option does not imply that an
external service has been configured.

## Platform and About

Native builds use the _Platform_ panel for fullscreen persistence and external
link handling. The remaining rows report the active runtime and platform
capabilities.

The _About_ panel shows the application name and version. It also contains the
dialog-width preference used by the remaining dialog-based workflows.
