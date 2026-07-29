# Story-graph navigation

Status: current
Owner: product documentation maintainers
Last verified: 2026-07-29
Source of truth: current Twine RS workbench interaction contract

This page describes the story graph in the current Twine RS workbench. It does
not describe the inherited upstream Twine story-map interface.

## Move around the graph

- Use the mouse wheel or a trackpad scroll gesture to zoom continuously toward
  the pointer. The graph keeps the world position beneath the pointer anchored
  while zooming.
- Hold Shift while using the wheel to pan horizontally.
- Pan by holding Space and dragging with the primary pointer button, dragging
  with the middle mouse button, or selecting the **Pan** tool and dragging with
  the primary button.
- Press `H` to select the Pan tool and `V` to return to the Select tool.
- Press `+` or `=` to zoom in, `-` to zoom out, and `0` to fit the graph.

The graph uses a transformed canvas instead of document scrolling. A
right-click opens context actions at the pointer; right-button dragging is not
a pan gesture.

## Select and edit passages

- With the Select tool active, drag across empty canvas to make a marquee
  selection.
- Click a passage node to select it.
- Shift-click, Command-click on macOS, or Control-click on other platforms to
  add or remove a node from the selection.
- Drag a selected node to move the selection. Movement respects the story's
  current snap-to-grid setting.
- Double-click a node to open its passage editor.
- Right-click a node for passage context actions. Right-click empty canvas for
  canvas context actions.
- Press Delete or Backspace to delete the selected passages when focus is
  outside an editor or other editable control.

Selection by itself does not move the viewport. Use an explicit reveal action
or Fit when you want the graph to reframe.
