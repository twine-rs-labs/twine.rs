A single-line text field with optional leading icon, label, and trailing keyboard hint.

```jsx
<Input label="Project Name" placeholder="Untitled Story" block />
<Input icon="search" placeholder="Filter contents" kbd="⌘P" />
<Input label="Project Folder" mono value="~/stories/forest" readOnly />
<Input label="IFID" invalid value="bad-id" />
```

Props: `icon` (Tabler name), `kbd` (trailing chip), `invalid`, `mono`, `block`. Passes through native input attributes (`value`, `onChange`, `placeholder`, …).
