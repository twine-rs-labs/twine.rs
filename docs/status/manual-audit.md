# Twine RS manual audit

Status: complete; local validation recorded, hosted publication and CI unrun
Owner: product documentation maintainers
Last verified: 2026-09-18
Source of truth: source tree ee12429efa68206380d4904d9195ab444d8344ff and the validation below

## Boundary and evidence

The clean starting tree equals the local `v0.2.0-beta.6` tag tree. This is a
source-baseline statement, not fresh confirmation of GitHub publication or CI.
The audit covers all 83 original manual Markdown files, the new first-story
page, and all five user-entry pages. The application Help URL stays unchanged.

Every row below is **source-audited** against the named owners and existing
tests. Existing tests are ownership evidence, not newly executed results.
`Both` means desktop and browser applicability, with differences stated in the
chapter; `Desktop` and `Browser` identify platform-specific procedures.
Historical rows preserve upstream content and are never Twine RS claims.
Runtime checks and platform limits are recorded separately below.

## Source owners

| Key      | Source or existing test evidence                                                                                                                                                                                                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| entry    | [application shell](../../src/components/app-shell/app-shell.tsx), [Help URL](../../src/electron/shared/documentation-url.ts)                                                                                                                                                                              |
| install  | [package configuration](../../electron-builder.config.js), [release profiles](../../scripts/release-profile.cjs), [update availability](../user/availability-and-updates.md)                                                                                                                               |
| concept  | [project model](../../crates/twine_model/src/lib.rs), [format defaults](../../src/store/story-formats/defaults.ts), [preference defaults](../../src/store/prefs/defaults.ts)                                                                                                                               |
| library  | [project launcher](../../src/routes/story-list/story-list-route.tsx), [native projects](../../src/electron/main-process/project-folder.ts), [launcher tests](../../src/routes/story-list/__tests__/story-list-route.test.tsx)                                                                              |
| edit     | [editor buffers](../../src/routes/story-edit/editor-window.tsx), [workbench panels](../../src/routes/story-edit/story-workbench-panels.tsx), [browser acceptance](../../e2e/smoke-test.spec.ts)                                                                                                            |
| graph    | [graph controls](../../src/routes/story-edit/story-graph-panel.tsx), [graph stylesheet](../../src/routes/story-edit/story-edit-route.css)                                                                                                                                                                  |
| history  | [project Undo/Redo](../../src/route-actions/story-edit/undo-redo-buttons.tsx), [editor buffers](../../src/routes/story-edit/editor-window.tsx)                                                                                                                                                             |
| assets   | [asset route](../../src/routes/assets/assets-route.tsx), [asset tests](../../src/routes/assets/__tests__/assets-route.test.tsx)                                                                                                                                                                            |
| publish  | [build route](../../src/routes/build/build-route.tsx), [build tests](../../src/routes/build/__tests__/build-route.test.tsx), [packaged acceptance](../../e2e/packaged-electron.spec.ts)                                                                                                                    |
| preview  | [preview frame](../../src/routes/story-preview-frame.tsx), [preview window manager](../../src/electron/main-process/story-preview-window-manager.ts), [preview tests](../../src/routes/__tests__/story-preview-frame.test.tsx)                                                                             |
| formats  | [Formats route](../../src/routes/story-formats/story-formats-route.tsx), [registry repair](../../src/store/story-formats/reducer.ts), [story format repair](../../src/store/stories/reducer/repair/repair-story.ts), [repair tests](../../src/store/stories/reducer/repair/__tests__/repair-story.test.ts) |
| settings | [Settings route](../../src/routes/settings/settings-route.tsx), [preference types](../../src/store/prefs/prefs.types.ts)                                                                                                                                                                                   |
| cli      | [desktop options](../../src/electron/main-process/command-line.ts), [CLI tests](../../src/electron/main-process/__tests__/command-line.test.ts)                                                                                                                                                            |
| css      | [user CSS loader](../../src/electron/main-process/user-css.ts), [main window initialization](../../src/electron/main-process/init-app.ts)                                                                                                                                                                  |
| backup   | [library backups](../../src/electron/main-process/story-directory.ts), [backup tests](../../src/electron/main-process/__tests__/story-directory.test.ts), [app preferences](../../src/electron/main-process/app-prefs.ts)                                                                                  |
| browser  | [local storage manifest](../../src/store/persistence/local-storage/stories/storage.ts)                                                                                                                                                                                                                     |
| save     | [save status](../../src/components/app-shell/app-shell.tsx), [save middleware](../../src/store/persistence/electron-ipc/stories/save-middleware.ts), [editor flush](../../src/routes/story-edit/editor-window.tsx)                                                                                         |
| conflict | [project synchronization](../../src/store/project-session-sync.tsx), [native project tests](../../src/electron/main-process/__tests__/project-folder.test.ts)                                                                                                                                              |
| hardware | [desktop menu](../../src/electron/main-process/menu-bar.ts), [hardware acceleration](../../src/electron/main-process/hardware-acceleration.ts)                                                                                                                                                             |
| limits   | [native project loading](../../src/electron/main-process/project-folder.ts), [performance evidence](performance.md), [Build route](../../src/routes/build/build-route.tsx)                                                                                                                                 |
| upstream | Original `ee12429e` historical text; only attribution/formatting wrappers added.                                                                                                                                                                                                                           |

## Page inventory

| Page                                                                                           | Disposition                                               | Platform                        | Owner    |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------- | -------- |
| [README.md](../en/src/README.md)                                                               | Updated/migrated                                          | Both                            | entry    |
| [SUMMARY.md](../en/src/SUMMARY.md)                                                             | Updated/migrated                                          | Both                            | entry    |
| [customizing/advanced.md](../en/src/customizing/advanced.md)                                   | Updated/migrated                                          | Desktop                         | css      |
| [customizing/command-line.md](../en/src/customizing/command-line.md)                           | Updated/migrated                                          | Desktop                         | cli      |
| [customizing/index.md](../en/src/customizing/index.md)                                         | Retained after audit                                      | Both                            | settings |
| [customizing/preferences.md](../en/src/customizing/preferences.md)                             | Updated/migrated                                          | Both                            | settings |
| [editing-stories/assets.md](../en/src/editing-stories/assets.md)                               | Retained after audit                                      | Both                            | assets   |
| [editing-stories/changing-story-format.md](../en/src/editing-stories/changing-story-format.md) | Updated/migrated                                          | Both                            | edit     |
| [editing-stories/deleting.md](../en/src/editing-stories/deleting.md)                           | Updated/migrated                                          | Both                            | edit     |
| [editing-stories/editing-passages.md](../en/src/editing-stories/editing-passages.md)           | Retained after audit                                      | Both                            | edit     |
| [editing-stories/finding-replacing.md](../en/src/editing-stories/finding-replacing.md)         | Retained after audit                                      | Both                            | edit     |
| [editing-stories/index.md](../en/src/editing-stories/index.md)                                 | Updated/migrated                                          | Both                            | edit     |
| [editing-stories/js-and-css.md](../en/src/editing-stories/js-and-css.md)                       | Updated/migrated                                          | Both                            | edit     |
| [editing-stories/linking-passages.md](../en/src/editing-stories/linking-passages.md)           | Retained after audit                                      | Both                            | edit     |
| [editing-stories/navigating.md](../en/src/editing-stories/navigating.md)                       | Updated/migrated                                          | Both                            | graph    |
| [editing-stories/renaming.md](../en/src/editing-stories/renaming.md)                           | Retained after audit                                      | Both                            | edit     |
| [editing-stories/selecting.md](../en/src/editing-stories/selecting.md)                         | Updated/migrated                                          | Both                            | graph    |
| [editing-stories/stats.md](../en/src/editing-stories/stats.md)                                 | Updated/migrated                                          | Both                            | edit     |
| [editing-stories/tagging.md](../en/src/editing-stories/tagging.md)                             | Updated/migrated                                          | Both                            | edit     |
| [editing-stories/undoing.md](../en/src/editing-stories/undoing.md)                             | Updated/migrated                                          | Both                            | history  |
| [getting-started/basic-concepts.md](../en/src/getting-started/basic-concepts.md)               | Updated/migrated                                          | Both                            | concept  |
| [getting-started/downgrading.md](../en/src/getting-started/downgrading.md)                     | Updated/migrated                                          | Both                            | backup   |
| [getting-started/first-story.md](../en/src/getting-started/first-story.md)                     | New walkthrough                                           | Both                            | edit     |
| [getting-started/getting-around.md](../en/src/getting-started/getting-around.md)               | Retained after audit                                      | Both                            | entry    |
| [getting-started/index.md](../en/src/getting-started/index.md)                                 | Updated/migrated                                          | Both                            | concept  |
| [getting-started/installing.md](../en/src/getting-started/installing.md)                       | Updated/migrated                                          | Both                            | install  |
| [getting-started/uninstalling.md](../en/src/getting-started/uninstalling.md)                   | Updated/migrated                                          | Both                            | backup   |
| [getting-started/updating.md](../en/src/getting-started/updating.md)                           | Updated/migrated                                          | Both                            | install  |
| [limitations/collaborating.md](../en/src/limitations/collaborating.md)                         | Updated/migrated                                          | Desktop                         | conflict |
| [limitations/combining.md](../en/src/limitations/combining.md)                                 | Updated/migrated                                          | Both                            | limits   |
| [limitations/index.md](../en/src/limitations/index.md)                                         | Retained after audit                                      | Both                            | limits   |
| [limitations/large-stories.md](../en/src/limitations/large-stories.md)                         | Updated/migrated                                          | Both                            | limits   |
| [limitations/source-control.md](../en/src/limitations/source-control.md)                       | Updated/migrated                                          | Desktop                         | conflict |
| [publishing/index.md](../en/src/publishing/index.md)                                           | Retained after audit                                      | Both                            | publish  |
| [publishing/playing.md](../en/src/publishing/playing.md)                                       | Retained after audit                                      | Both                            | preview  |
| [publishing/proofing.md](../en/src/publishing/proofing.md)                                     | Retained after audit                                      | Both                            | preview  |
| [publishing/publishing.md](../en/src/publishing/publishing.md)                                 | Retained after audit                                      | Both                            | publish  |
| [publishing/scratch-folder.md](../en/src/publishing/scratch-folder.md)                         | Updated/migrated                                          | Desktop                         | preview  |
| [publishing/testing.md](../en/src/publishing/testing.md)                                       | Retained after audit                                      | Both                            | preview  |
| [release-notes/1-0.md](../en/src/release-notes/1-0.md)                                         | Historical; attribution added                             | Historical                      | upstream |
| [release-notes/2-0.md](../en/src/release-notes/2-0.md)                                         | Historical; attribution added                             | Historical                      | upstream |
| [release-notes/2-1.md](../en/src/release-notes/2-1.md)                                         | Historical; attribution added                             | Historical                      | upstream |
| [release-notes/2-10.md](../en/src/release-notes/2-10.md)                                       | Historical; attribution added                             | Historical                      | upstream |
| [release-notes/2-11.md](../en/src/release-notes/2-11.md)                                       | Historical; attribution added                             | Historical                      | upstream |
| [release-notes/2-12.md](../en/src/release-notes/2-12.md)                                       | Historical; attribution added                             | Historical                      | upstream |
| [release-notes/2-2.md](../en/src/release-notes/2-2.md)                                         | Historical; attribution added                             | Historical                      | upstream |
| [release-notes/2-3.md](../en/src/release-notes/2-3.md)                                         | Historical; attribution added                             | Historical                      | upstream |
| [release-notes/2-4.md](../en/src/release-notes/2-4.md)                                         | Historical; attribution added                             | Historical                      | upstream |
| [release-notes/2-5.md](../en/src/release-notes/2-5.md)                                         | Historical; attribution added                             | Historical                      | upstream |
| [release-notes/2-6.md](../en/src/release-notes/2-6.md)                                         | Historical; attribution added                             | Historical                      | upstream |
| [release-notes/2-7.md](../en/src/release-notes/2-7.md)                                         | Historical; attribution added                             | Historical                      | upstream |
| [release-notes/2-8.md](../en/src/release-notes/2-8.md)                                         | Historical; attribution added                             | Historical                      | upstream |
| [release-notes/2-9.md](../en/src/release-notes/2-9.md)                                         | Historical; attribution added                             | Historical                      | upstream |
| [release-notes/index.md](../en/src/release-notes/index.md)                                     | Historical; attribution added                             | Historical                      | upstream |
| [release-notes/twee.md](../en/src/release-notes/twee.md)                                       | Historical; attribution added                             | Historical                      | upstream |
| [release-notes/tweebox.md](../en/src/release-notes/tweebox.md)                                 | Historical; attribution added                             | Historical                      | upstream |
| [story-formats/adding.md](../en/src/story-formats/adding.md)                                   | Updated/migrated                                          | Both                            | formats  |
| [story-formats/default.md](../en/src/story-formats/default.md)                                 | Updated/migrated                                          | Both                            | formats  |
| [story-formats/extensions.md](../en/src/story-formats/extensions.md)                           | Updated/migrated                                          | Both                            | formats  |
| [story-formats/index.md](../en/src/story-formats/index.md)                                     | Retained after audit                                      | Both                            | formats  |
| [story-formats/proofing.md](../en/src/story-formats/proofing.md)                               | Retained after audit                                      | Both                            | formats  |
| [story-formats/removing.md](../en/src/story-formats/removing.md)                               | Updated/migrated                                          | Both                            | formats  |
| [story-formats/versions.md](../en/src/story-formats/versions.md)                               | Updated/migrated                                          | Both                            | formats  |
| [story-formats/viewing.md](../en/src/story-formats/viewing.md)                                 | Retained after audit                                      | Both                            | formats  |
| [story-library/conflicts.md](../en/src/story-library/conflicts.md)                             | Retained after audit                                      | Desktop                         | conflict |
| [story-library/creating.md](../en/src/story-library/creating.md)                               | Retained after audit                                      | Both                            | library  |
| [story-library/deleting.md](../en/src/story-library/deleting.md)                               | Retained after audit                                      | Both                            | library  |
| [story-library/editing.md](../en/src/story-library/editing.md)                                 | Retained after audit                                      | Both                            | library  |
| [story-library/exporting.md](../en/src/story-library/exporting.md)                             | Retained after audit                                      | Both                            | library  |
| [story-library/index.md](../en/src/story-library/index.md)                                     | Retained after audit                                      | Both                            | library  |
| [story-library/location.md](../en/src/story-library/location.md)                               | Retained after audit                                      | Both                            | library  |
| [story-library/playing.md](../en/src/story-library/playing.md)                                 | Updated/migrated                                          | Both                            | library  |
| [story-library/renaming.md](../en/src/story-library/renaming.md)                               | Retained after audit                                      | Both                            | library  |
| [story-library/tagging.md](../en/src/story-library/tagging.md)                                 | Retained after audit                                      | Both                            | library  |
| [story-library/testing.md](../en/src/story-library/testing.md)                                 | Updated/migrated                                          | Both                            | library  |
| [story-library/viewing.md](../en/src/story-library/viewing.md)                                 | Retained after audit                                      | Both                            | library  |
| [troubleshooting/backups.md](../en/src/troubleshooting/backups.md)                             | Updated/migrated                                          | Desktop                         | backup   |
| [troubleshooting/damaged-story.md](../en/src/troubleshooting/damaged-story.md)                 | Retained after audit                                      | Both                            | backup   |
| [troubleshooting/error-message.md](../en/src/troubleshooting/error-message.md)                 | Updated/migrated                                          | Both                            | save     |
| [troubleshooting/index.md](../en/src/troubleshooting/index.md)                                 | Retained after audit                                      | Both                            | backup   |
| [troubleshooting/local-storage.md](../en/src/troubleshooting/local-storage.md)                 | Retained after audit                                      | Browser                         | browser  |
| [troubleshooting/lost-story.md](../en/src/troubleshooting/lost-story.md)                       | Updated/migrated                                          | Both                            | backup   |
| [troubleshooting/visual-glitches.md](../en/src/troubleshooting/visual-glitches.md)             | Updated/migrated                                          | Desktop                         | hardware |
| [troubleshooting/wont-start.md](../en/src/troubleshooting/wont-start.md)                       | Updated/migrated                                          | Desktop                         | backup   |
| [user/README.md](../user/README.md)                                                            | Task index; existing Help entry                           | Both; destination defines scope | entry    |
| [user/availability-and-updates.md](../user/availability-and-updates.md)                        | Compatibility pointers; original heading anchors retained | Both; destination defines scope | entry    |
| [user/desktop-command-line.md](../user/desktop-command-line.md)                                | Compatibility pointers; original heading anchors retained | Both; destination defines scope | entry    |
| [user/graph-navigation.md](../user/graph-navigation.md)                                        | Compatibility pointers; original heading anchors retained | Both; destination defines scope | entry    |
| [user/recovery-and-backups.md](../user/recovery-and-backups.md)                                | Compatibility pointers; original heading anchors retained | Both; destination defines scope | entry    |

## Validation record

- Source audit: completed across the full inventory using two independent
  read-only researchers and parent review. Corrected obsolete interface,
  format-repair, save-error, storage, customization, and source-control claims.
- New checker: primary-manual ownership, all historical files (including the
  formerly unlisted `twee.md`), preserved guide pointers, and canonical anchors.
- Toolchain: command-scoped Node 24.19.0/npm 11.17.0, mdBook 0.5.4. CI remains
  pinned to Node 24.18.0. No global tool configuration changed.
- Documentation-checker fixture tests: 20 passed; workflow configuration tests:
  15 passed; CI classification tests: 7 passed. The existing desktop CLI
  help-parity suite now reads the canonical manual chapter: 8 passed. `check:docs`, mdBook build,
  repository formatting gate, and explicit Prettier checks of changed book and
  standalone-guide files passed on the final documentation tree. Workflow
  classifier logic and CI version pins remain unchanged; only the documentation
  build step labels were renamed.
- Generated-site crawl: all 84 HTML pages, local resources, page fragments,
  sidebar targets, and compatibility destinations checked with no broken links.
  All baseline manual heading anchors and standalone-guide heading anchors are
  preserved. Upstream historical bodies were compared against the baseline.
- Browser walkthrough: fresh production web output from the source baseline,
  disposable Chromium profile at `http://127.0.0.1:5173`. Created the two-passage
  Harlowe story, followed both Test links, returned to the library, reopened,
  reloaded, verified both texts, exported playable HTML and followed both links
  from the separate local file. Three existing Chromium acceptance tests also
  passed: launcher creation, embedded-editor persistence, and preserved passage
  bodies across project selection/reload. No hosted browser service is implied.
- Rendered manual: local mdBook at port 3987. Inspected the landing page,
  sidebar navigation, search (24 results for recovery), quickstart, backup and
  startup-recovery chapters, and direct historical `twee.html` entry. Checked
  the 375-pixel layout with the sidebar collapsed and expanded.
- Desktop: fresh `build:electron-app` and `package:electron:dir` from the unchanged
  baseline application source, macOS arm64 unpacked package. Tracked generated
  WASM hashes remained unchanged. Canonical visible packaged acceptance passed
  two targeted tests: trailing native save on exit and asset-complete archive
  export/playback after removal of its source project.
- Supplementary visible packaged harness: confirmed `app.getPath('userData')`
  inside each temporary profile before settings changes; used distinct library,
  backup and scratch roots. Created and saved a project, requested **Back Up**,
  inspected saved source inside the timestamped backup, copied it to a separate
  recovery tree, opened the copy in a fresh profile, preserved its identity,
  changed a preference, quit, copied settings aside, renamed both settings files,
  reopened and checked default retention and intact project text. This is
  instrumented package evidence, not an installed-DMG test.
- External-change supplement: a second visible packaged test passed after
  waiting for session initialization. A real external asset edit produced review;
  **Later** preserved the changed bytes. A benign compatibility-metadata rewrite
  in the disposable copy produced **Reload From Disk**; its confirmation warned
  about resetting undo history, and accepting it preserved passage text. Native
  watcher events drove the final passing test. Direct **Use Disk Version** and
  **Keep App Version** collision branches remain source/test audited, not newly
  exercised here. A safe ordinary manifest change was observed to apply without
  full-reload review, consistent with the chapter's conditional wording.
- Independent review: completed with no remaining actionable findings. The
  Help-index legacy HTML anchor and its regression test were added. A suspected
  quickstart issue was withdrawn after confirming Core's atomic linked-passage
  creation and the browser walkthrough.
- Local logs, screenshots, exported HTML, provenance checks and the supplementary
  harness are retained under `output/playwright/manual-update/` (ignored local
  evidence). Initial harness selector/fixture mistakes were corrected before
  passing runs; they are not application regressions. An attempted canonicalized
  temporary-root launch timed out; the passing runs use the packaged harness
  user-data convention beneath `os.tmpdir()`. No developer settings were reset.

## Deliberate limits and unresolved product behavior

- Windows/Linux installation and uninstall, macOS installed-DMG trust prompts,
  release-host downloads, and actual downgrade to older binaries are not
  established by a local unpacked package or browser checks. Their instructions
  are source-verified and platform execution remains unrun unless stated above.
- Settings reset must use separately isolated Electron user data. The documented
  user-facing library/backup/scratch switches do not isolate preferences.
- Automatic backup failure reporting, external-project backup coverage, live
  collaboration, cloud integration, automatic updates, and performance limits
  remain existing product constraints. This migration does not implement them.
- Fresh CI is unrun locally. Checker/test changes intentionally select full CI;
  focused local evidence does not stand in for those required hosted jobs.

## Compatibility and historical preservation

Four standalone guide filenames and all 16 headings remain as section-specific
links into the book. The Help landing also preserves `#twiners-user-documentation`
with an HTML anchor and a checked canonical book link. In-book callers point directly to canonical chapters.
Old book-heading URLs are retained with explicit anchors when titles changed.
All 17 historical sources carry the same attribution notice; original bodies
are retained inside formatting-ignore ranges so upstream history is not
silently rewritten. The historical appendix includes `twee.md` explicitly.

## Incoming-link inventory

At the baseline, `downgrading.md` and `lost-story.md` were the incoming book
callers of the recovery guide's `#test-with-an-isolated-library` fragment. Both
now link directly to the canonical backup chapter and the legacy fragment is
still checked. Other baseline incoming guide links had no fragment: root
README; the user Help index; installation, updating, navigation, CLI, backup
and startup chapters; and cross-links between the recovery and CLI guides.
Historical audit prose remains unchanged. The CLI help-parity test now reads
the canonical chapter; application Help URL tests keep the existing Help index.
The checker compatibility map enumerates every old child-guide heading and its
replacement, including headings without an in-repository incoming link.

## Delegation record

| Task                           | Requested role        | Responsibility                                                         |
| ------------------------------ | --------------------- | ---------------------------------------------------------------------- |
| `manual_authoring_audit`       | `codebase_researcher` | Source audit of authoring/library/publishing                           |
| `manual_safety_audit`          | `codebase_researcher` | Source audit of storage/recovery/installation; isolated harness advice |
| `manual_checker`               | `coder`               | Checker contract and fixture tests, including Help-anchor correction   |
| `manual_implementation_review` | `reviewer`            | Independent implementation review and closure verification             |

No model or effort overrides were requested. Effective runtime model/effort
metadata was not exposed. Parent retained integration and the final verdict.
