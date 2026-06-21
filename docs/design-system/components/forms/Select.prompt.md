A styled native dropdown for choices like story format, sort, and filter.

```jsx
<Select value={format} onChange={setFormat}
  options={['Harlowe 3.3', 'SugarCube 2.36', 'Snowman 2.0', 'Chapbook 1.2']} />
<Select size="sm" value={sort} onChange={setSort}
  options={[{value:'modified',label:'Last Modified'},{value:'name',label:'Name'}]} />
```

Options accept plain strings or `{value, label}`. `block` fills width.
