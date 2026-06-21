A dock/inspector panel: uppercase titled header over a scrolling body.

```jsx
<Panel title="Diagnostics" icon="alert-triangle" count={4}
  actions={<IconButton icon="refresh" label="Recheck" size="sm" />}>
  …rows…
</Panel>
<Panel title="Inspector" icon="info-circle" pad>…fields…</Panel>
```

Use `flush` for full-bleed docks (no border/radius), `pad` to pad the body, `actions` for header controls.
