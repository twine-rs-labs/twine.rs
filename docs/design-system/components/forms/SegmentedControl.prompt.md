The signature Text | Graph | Split mode switch — also used for density and view toggles. The active segment carries the twine gradient underline.

```jsx
<SegmentedControl
  value={mode}
  onChange={setMode}
  options={[
    {value: 'text', label: 'Text', icon: 'file-text'},
    {value: 'graph', label: 'Graph', icon: 'binary-tree'},
    {value: 'split', label: 'Split', icon: 'layout-columns'}
  ]}
/>
```

Options accept plain strings or `{value, label, icon}`. `size="sm"` for toolbars.
