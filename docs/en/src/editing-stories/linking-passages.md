# Linking Passages

Because links are a fundamental part of Twine stories, the way they are written
is shared across all story formats. In short, you create a link by placing two
square brackets around text in a passage.

- Writing `[[A passage]]` makes a link to a passage named "A passage".

- Writing `[[A label->A passage]]` also makes a link to a passage named "A
  passage", but the text that is displayed onscreen is "A label".

- You can also reverse the arrow direction and write `[[A passage<-A label]]`,
  which has the same exact effect as the previous example.

Passage links are case-sensitive. That is, a link to a passage named "A passage"
will be treated differently from a link to a passage named "A PASSAGE".

Passage links are represented with a solid line ending in an arrow in the story
map. A passage that links to itself shows a circular arrow. Story formats can
extend Twine to add [references](../getting-started/basic-concepts.md). You
should check your story format's documentation to find out how they work. You
can also [disable story format extensions](../story-formats/extensions.md) to
prevent these lines from being drawn.

When you create a new link while writing in a passage editor, Twine will
automatically create a passage for you with the correct name after a short
delay, if it doesn't already exist in your story.

Twine also tries to detect when you're starting to write a link and opens a list
of possible completions. To accept a passage name in the completion list, click
or tap it. If the suggestions don't include what you want, or if you're creating
a link to a new passage, keep typing and the completions list will disappear.

## Finding References and Definitions

Select a passage and choose **Find References** in the Inspector to see every
standard passage link that targets it. Results are paged for large stories and
include repeated links and links from the passage to itself. Choose **Reveal in
Source** to open and select the exact link target in its source passage, or
**Reveal in Graph** to select the source passage on the story map.

The coverage notice in the results is significant. Find References recognizes
standard Twine passage links. It does not label plain text matches as semantic
references, and it does not infer references written in story format-specific
syntax unless an exact provider reports them. If two passages have the same
name, Twine reports ambiguous coverage and does not assign name-based links to
either passage. Give the passages unique names before requesting exact
references.

Before a reference query or reveal, Twine safely synchronizes open passage
editors. Finish an active composition or retry a failed save if synchronization
cannot complete; Twine will not reveal a location from stale buffered text.

Links in the Inspector offer **Go to Definition**. Twine follows the link only
when exactly one passage has that name. If the name is missing or duplicated,
Twine reports that result instead of guessing. Use **Go to Passage** when you
want the generic passage-name search fallback.

## Renaming Links

If you change your mind about a passage name, you don't need to manually edit
standard links in other passages. When you [rename a passage](renaming.md),
Twine shows every detected standard-link occurrence in a review and updates the
reviewed links when you apply it. The coverage notice is important: references
that use story format-specific functionality, such as code, may not be detected
and are not changed speculatively.

## Image-Based Links

It's possible to use more than plain text as the trigger for a link, but how
this works is dependent on the story format you are using. It's often possible,
for example, to enter an HTML `<img>` tag in the label part of a link. But this
may or may not be supported by the story format you are using.
