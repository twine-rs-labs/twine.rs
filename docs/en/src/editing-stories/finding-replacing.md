# Finding and Replacing Story Sources

Open _Find and Replace_ from the _Story_ toolbar tab. Enter text in the _Find_
field to see bounded previews and highlight matching passage cards. Select a
result to reveal its source.

The source checkboxes independently include passage names, passage text, Story
JavaScript, and the Story Stylesheet. _Match Case_ makes matching
case-sensitive.

## Reviewing replacements

Enter replacement text and choose _Replace In Story Sources_. Twine constructs
a complete, revision-bound plan in the project session before showing the
review. The review reports the complete change count and pages the individual
before/after details, so a large replacement is not limited to the visible
search previews.

Individual text changes may be unchecked. Passage-name changes and their
detected standard Twine-link rewrites are required groups and cannot be split.
Format-specific or unknown link syntax is not rewritten speculatively.

Editing remains available while review is open. If any project source changes
after planning, Apply fails as stale without changing the project. Choose
_Retry_ to build a fresh plan. A successful Apply is one project transaction,
so Undo and Redo restore every selected source together.

## Regular expressions

_Use Regular Expressions_ treats the Find value as a regular-expression
pattern. Capture references such as `$1` may then be used in the replacement.
For example, finding `(.)and` and replacing it with `$1---` changes `Sand band`
to `S--- b---`.

When regular expressions are off, both Find and Replace values are literal;
`$1` and `$$` remain ordinary text.
