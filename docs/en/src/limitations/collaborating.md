# Collaborating on Stories

Twine RS does not provide simultaneous multi-user editing or a cloud-sync
service. Arrange one writer at a time for each project.

For desktop work, share the complete `.twine.rs` project using a deliberate
file-transfer or [source-control workflow](source-control.md). Exchange changes
while the editor is closed, resolve merges, then reopen and check the result.
Keep a separate known-good copy before accepting another person's changes.
Do not assume a sync tool understands the relationship between the manifest,
passage files, assets, and hidden project metadata.

For browser work, [export](../story-library/exporting.md) and
[import](../story-library/creating.md) story sources. An import marked **Replace**
can overwrite matching work; preserve that work first. External assets need
separate transfer unless the chosen package actually includes them.

If files change while a desktop project is open, review the
[conflict choices](../story-library/conflicts.md). Choose **Later** when you
need time to preserve or compare copies. Automatic handling of nonconflicting
changes is not a guarantee of safe concurrent editing.
