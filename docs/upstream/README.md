# Upstream TwineJS README

Status: upstream snapshot; not twine.rs product documentation

This is the original README from the TwineJS repository at the time this workspace was created.
The preserved repository policy files remain under
[`source/`](./source/), and the inherited mdBook is
served from [`../en/`](../en/).

## twinejs

by Chris Klimas, Lorenzo Ancora, Leon Arnott, Daithi O Crualaoich, Ingrid Cheung,
Thomas Michael Edwards, Micah Fitch, Juhana Leinonen, Michael Savich, and Ross Smith

### SYNOPSIS

This is a port of Twine to a browser and Electron app. See
[twinery.org](https://twinery.org) for more info.

The story formats in minified format under `story-formats/` exist in separate
repositories:

- [Harlowe](https://foss.heptapod.net/games/harlowe/)
- [Paperthin](https://github.com/klembot/paperthin)
- [Snowman](https://github.com/klembot/snowman)
- [SugarCube](https://github.com/tmedwards/sugarcube-2)

#### BUILDS

Binary packages for Twine are available on the
[Releases](https://github.com/klembot/twinejs/releases) tab for Windows, MacOS
and Linux. Community-created builds exist on other platforms, such as the Snap
Store or Arch User Repository. As always, only install from sources you trust.

### INSTALL

Run `npm install` at the top level of the directory to install all goodies.

Working with the documentation requires installing
[mdbook](https://rust-lang.github.io/mdBook/), which is not a Node-based
project. You can either install it directly from the project web site or use
your operating system's package manager.

### BUILDING

Run `npm start` to begin serving a development version of Twine locally. This
server will automatically update with changes you make.

Run `npm run start:electron` to run a development version of the Electron app.
**Running this can damage files in your Twine storied folder. Take a backup copy
of this folder before proceeding.** Most of the app will automatically update as
you work, but if you want the app to read story files initially again, you will
need to restart the process.

To create a release, run `npm run build`. Finished files will be found under
`dist/`. In order to build Windows apps on macOS or Linux, you will need to have
[Wine](https://www.winehq.org/) and [makensis](http://nsis.sourceforge.net/)
installed. A file named `2.json` is created under `dist/` which contains
information relevant to the autoupdater process, and is currently posted to
https://twinery.org/latestversion/2.json.

Notarized macOS builds require a valid Developer ID Application signing identity
and all of these environment variables:

- `APPLE_APP_ID`: The signed bundle identifier. It must match the identifier in
  the packaged app's Developer ID signature.
- `APPLE_ID`: User name of the Apple account to use for notarization.
- `APPLE_ID_PASSWORD`: App-specific password for the Apple account to use for
  notarization.
- `APPLE_TEAM_ID`: ID of the Apple team account to use for notarization.

A real signing identity can be selected through Electron Builder's
`mac.identity` option, `CSC_NAME`, or `CSC_LINK`, or discovered in the macOS
keychain. When the notarization credentials are incomplete and no real signing
path is configured or discovered, local macOS builds are ad-hoc signed. That
local signature avoids repeated file-access identity prompts, but it is not a
Developer ID signature and is not notarized; Gatekeeper may still require users
to right-click the application and open it manually.

The local fallback does not replace a valid existing signature. If keychain
identity discovery cannot be verified, it conservatively skips ad-hoc signing.
After Electron Builder signs a release, the build submits it for notarization
only when the signature is a valid Developer ID Application signature, its
identifier matches `APPLE_APP_ID`, and every credential above is present.
Providing the complete credential set also enables Electron Builder's
`forceCodeSigning` guard, so a missing or invalid signing identity fails the
release build instead of producing an unsigned artifact.

You must have the full Xcode app installed to notarize the app, not just the
Xcode command line tools.

`npm test` runs Jest in interactive watch mode. Automated workflows should run
`npm run test:ci`, which runs the Jest suite once and then the packaging hook
tests. `npm run test:packaging` runs only the noninteractive Electron Builder
configuration and hook tests.

`npm run clean` will delete existing files in `electron-build/` and `dist/`.
