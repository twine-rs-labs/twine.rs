# Advanced Customization

## CSS

The desktop app can load a user stylesheet from the operating system's
Documents folder, inside **Twine RS**. In English the filename is `user.css`;
other locales can localize that filename. The location is independent of any
custom story-library, backup, or scratch folder.

Create or edit this file with an external text editor. Keep a copy and start
with a small reversible rule. The stylesheet changes the authoring app, not
published stories; use [Story Stylesheet](../editing-stories/js-and-css.md) for
player-facing CSS.

For example, the inspected workbench's graph background can be changed with:

```css
.story-edit-route .passage-map {
	background: #30343b !important;
}
```

Quit and restart Twine RS to load a changed stylesheet. If it makes the app hard
to use, quit, rename the stylesheet, and relaunch. Missing or unreadable user
CSS does not prevent startup; an unreadable file is logged and skipped.

Selectors and UI structure can change between versions. Inspect the exact
installed app with **Help > Troubleshooting > Show Debug Console** when
checking a selector. Do not assume the upstream Twine interface or another
browser build has identical markup. This desktop file mechanism is not a
browser-editor feature.
