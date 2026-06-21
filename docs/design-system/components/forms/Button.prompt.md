A text-labelled action button — use for decisive commands like Import, Export HTML, Save Layout, Publish.

```jsx
<Button variant="primary" icon="package-export">Export HTML</Button>
<Button icon="plus">New Passage</Button>
<Button variant="ghost" size="sm" icon="search" />
<Button variant="danger" icon="trash">Delete</Button>
```

Variants: `primary` (accent fill — one per context), `default` (raised neutral), `ghost` (transparent toolbar action), `danger` (destructive). Sizes: `sm` / `md` / `lg`. Props: `icon` / `iconRight` take Tabler icon names without the `ti-` prefix; `loading` shows a spinner; `block` stretches full width. Requires the Tabler webfont stylesheet to be linked for icons.
