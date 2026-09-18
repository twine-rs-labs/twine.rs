# Create your first story

This walkthrough uses the bundled **Harlowe 3.3.9** format and standard passage
links. It works in the desktop and browser editors. Desktop steps create a
project folder; browser steps use storage for the current origin and profile.

1. Choose **New Project**. On **Create**, enter a unique project name such as
   `My First Story`, leave the start passage as `Start`, select Harlowe 3.3.9,
   and use **Split** mode. On desktop keep the recommended **Multi** layout.
   Choose **Create Project**.
2. In the workbench, choose **Split** if it is not already selected. Open
   `Start` in the editor by double-clicking its passage-list entry or graph node.
   Enter:

   ```text
   You arrive at a quiet station.
   [[Enter the station->Inside]]
   ```

3. Pause typing until `Inside` appears in the passage list. The standard link
   creates this empty passage. Double-click its passage-list entry and enter:

   ```text
   A lamp is still burning.
   [[Return->Start]]
   ```

4. Choose the **Build** action tab and **Test** to run the story from its start.
   Follow both links. The preview is a test, not a saved export; close it to
   return to editing. See [testing](../publishing/testing.md) for Test From Here.
5. Return to the editor and check that the status is **Saved**, with no save
   error. Go to **Stories**, reopen your project, and check both passage texts.
   Reload/restart and check again before treating the storage as established.
   If saving fails, preserve your text and follow [save-error guidance](../troubleshooting/error-message.md).
6. Open **Build & Export**, choose its **Export** view, select **Playable HTML**,
   and choose **Export Playable HTML**. Save the resulting HTML file, open it in a
   separate browser tab, and follow both links again.

Keep a separate source backup as well as your playable file. Desktop authors
should preserve the complete project folder; browser authors should use
[library exports](../story-library/exporting.md). If you add media later, read
[export asset coverage](../publishing/publishing.md#html-options-and-assets): a
working preview alone does not prove the exported file contains those assets.
