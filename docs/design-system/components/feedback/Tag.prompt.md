A passage/story tag chip with a colored dot and optional remove button.

```jsx
<Tag color="green">forest</Tag>
<Tag color="purple" onRemove={() => removeTag('night')}>night</Tag>
<Tag color="blue" onClick={() => filterByTag('intro')}>intro</Tag>
```

Named colors: `red orange yellow green teal cyan blue purple` (or any CSS color). `hash={false}` hides the `#`. Provide `onRemove` for an editable chip, `onClick` for a filter chip.
