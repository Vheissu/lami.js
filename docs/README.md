# Lami.js Docs

These docs describe the current supported behavior of the implementation. Files
in this directory are the practical contract for building apps and integrations
today.

- [Runtime API](./runtime-api.md)
- [Template Syntax](./template-syntax.md)
- [Forms](./forms.md)
- [Resources](./resources.md)
- [Compiler, SSR, And Hydration](./compiler-ssr-hydration.md)
- [Diagnostics](./diagnostics.md)
- [Testing And Verification](./testing.md)
- [Performance](./performance.md)
- [Compatibility Matrix](./compatibility.md)
- [Release Checklist](./release-checklist.md)
- [Changelog](../CHANGELOG.md)

## Package Roles

- `@lami.js/runtime` enhances existing DOM, owns reactivity, bindings, forms,
  resources, diagnostics, and progressive enhancement.
- `@lami.js/compiler` emits DOM, SSR, and hydration modules from Lami template
  HTML.
- `@lami.js/ssr` renders runtime-compatible HTML strings on the server.
- `@lami.js/vite` integrates the compiler with Vite.
- `@lami.js/web-component` wraps Lami element definitions as native custom
  elements.

## What Lami.js Is Not

Lami.js is a binding and compiler library, not a full application framework. It
does not include routing, dependency injection, validation, state management,
or an application shell convention. Those should stay in userland or separate
packages unless a future package has a narrow reason to exist.
