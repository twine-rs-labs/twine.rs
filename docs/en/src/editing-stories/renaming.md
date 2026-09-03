# Renaming Stories and Passages

## Renaming a Story

Open the story in the workbench and choose the _Story_ action tab in the
application header. Choose _Rename_, enter the new name, and save it. Names
must be nonempty and must not collide with another story filename in the
library.

The story's title changes in the launcher and in later published output. An
existing `.twine.rs` project-folder name doesn't change. See
[Renaming Stories](../story-library/renaming.md) for the storage distinction.

## Renaming a Passage

Select one passage, open the _Passage_ action tab in the application header,
and choose _Rename_. Enter the new name and save it to open a review. Twine does
not change the project until you choose _Apply Rename_ in that review.

The review shows the passage rename and every standard Twine-link occurrence
Twine detected, grouped by affected passage and loaded in bounded pages. It also
states the coverage used for the plan. _Standard Twine links only_ means syntax
such as `[[Passage]]`, `[[Label->Passage]]`, and `[[Passage<-Label]]` is covered.
Story-format-specific code or other semantic references may not be detected and
are not rewritten speculatively.

You can continue editing while the review is open. If the project changes, the
reviewed revision becomes stale and Apply fails without making a partial
change; choose _Retry review_ to plan again from the current project. A
successful Apply, Undo, or Redo changes the passage name and all accepted link
updates together as one project transaction.
