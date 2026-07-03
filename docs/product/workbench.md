# Workbench behavior

Status: current
Owner: workbench maintainers
Last verified: 2026-07-04
Source of truth: graph and editor interaction contract

## Graph invariants

- Pan and zoom mutate one transformed world; the graph does not use document
  scrolling as its camera.
- Wheel zoom is continuous and cursor-anchored.
- Selection never moves the viewport. Reveal and Fit are explicit actions.
- Grid-dot spacing and snap spacing share one constant.
- Nodes and dense edges remain bounded to the requested viewport or focus.
- Drag previews are local interaction state; committed positions enter the
  Rust session as one transaction.

## Editor dock invariants

- There is one editor surface, not a workspace editor plus a passage modal.
- Story-level controls appear once on dock chrome.
- Passage-specific tags, links, diagnostics, and actions stay inside the
  passage editor.
- JavaScript and stylesheet buffers are singletons.
- Passage buffers can tile or stack, are closeable, and preserve focused editor
  state.
- CodeMirror handles focused-editor undo; workbench undo handles project
  transactions outside editable controls.

## Input model

| Input                                | Action                           |
| ------------------------------------ | -------------------------------- |
| Wheel or trackpad                    | Zoom toward pointer              |
| Shift + wheel                        | Pan horizontally                 |
| Space-drag, middle-drag, or Pan tool | Pan                              |
| Drag empty canvas                    | Marquee selection                |
| Click node                           | Select node                      |
| Shift/Cmd/Ctrl + click               | Add or remove from selection     |
| Drag selected nodes                  | Move selection, respecting snap  |
| Double-click node                    | Open passage editor              |
| Right-click                          | Context actions at the pointer   |
| `V` / `H`                            | Select / Pan tool                |
| `+`, `=`, `-`                        | Zoom                             |
| `0`                                  | Fit graph                        |
| Delete / Backspace                   | Delete selection outside editors |

The completed implementation record is archived at
[`../archive/completed-plans/workbench-integration.md`](../archive/completed-plans/workbench-integration.md).
