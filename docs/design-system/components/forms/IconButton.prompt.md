An icon-only button for repeated toolbar tools — always give it a `label` for the tooltip + screen readers.

```jsx
<IconButton icon="player-play" label="Play" />
<IconButton icon="grid-dots" label="Snap to grid" active />
<IconButton icon="command" label="Command palette" solid />
```

`active` shows the selected (accent) state; `solid` renders a raised filled control; `size="sm"` for dense rails. Use sparingly — prefer text-labelled `Button` for decisive commands.
