A passage card for Graph mode — the core spatial object in twine.rs.

```jsx
<PassageNode title="Forest Entrance" start
  excerpt="The path forks. Two ways lead onward into the dark."
  tags={['green','purple']} links={3} />
<PassageNode title="The Ravine" broken={1} links={2} selected accent="red" />
```

Shows title, 2-line excerpt, tag color strips, outgoing-link count and a red broken-link badge. `start` adds the twine gradient rail; `selected` adds the graph selection ring; `accent` sets a top color bar.
