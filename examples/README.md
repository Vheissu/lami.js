# Lami.js Examples

These examples are small, runnable applications that double as integration
fixtures for the library.

```bash
pnpm --filter @lami.js/example-todo dev
pnpm --filter @lami.js/example-post-form dev
```

- `todo-app` shows local state, forms, keyed repeats, filters, class binding,
  checkbox binding, and event shorthand.
- `post-form` shows async form submission through `fetch`, pending/success/error
  branches, validation state, and two-way form controls.

The examples are also covered by:

```bash
pnpm test
pnpm test:e2e
```

Related docs:

- [Forms](../docs/forms.md)
- [Template Syntax](../docs/template-syntax.md)
- [Testing And Verification](../docs/testing.md)
