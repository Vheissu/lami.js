# lami.js

A standalone binding runtime and compiler for progressive enhancement, forms,
small UI islands, SSR, and SSG.

This repository is a TypeScript monorepo for the Lami.js package suite:

- `@lami.js/runtime`
- `@lami.js/compiler`
- `@lami.js/ssr`
- `@lami.js/vite`
- `@lami.js/web-component`

## Documentation

The current implementation contract lives in [`docs/`](./docs/README.md):

- [Runtime API](./docs/runtime-api.md)
- [Template Syntax](./docs/template-syntax.md)
- [Forms](./docs/forms.md)
- [Resources](./docs/resources.md)
- [Compiler, SSR, And Hydration](./docs/compiler-ssr-hydration.md)
- [Diagnostics](./docs/diagnostics.md)
- [Testing And Verification](./docs/testing.md)
- [Performance](./docs/performance.md)
- [Compatibility Matrix](./docs/compatibility.md)
- [Release Checklist](./docs/release-checklist.md)
- [Changelog](./CHANGELOG.md)

The docs above describe the supported behavior to build against today.

## 1.0 Feature Set

The 1.0.0 release includes:

- fine-grained reactive proxies, effects, computed refs, watchers, and batched
  flushing.
- a runtime expression lexer/parser/evaluator with no `eval` or `new Function`.
- interpolation in text and attributes.
- `.bind`, binding modes, event bindings including `@event` shorthand,
  class/style/ref bindings, and form value/checked/model binding.
- `if.bind`/`else`, `show.bind`, `hide.bind`, `<let>`, `repeat.for`,
  `with.bind`, `switch.bind`, and `promise.bind`.
- value converters, binding behaviors, signals, and update triggers.
- structured runtime diagnostics through `onError` and `onWarn` for enhanced
  and compiled bindings.
- lightweight custom attributes and lightweight custom elements.
- optional mutation-observer enhancement for inserted islands marked with
  `au-scope`/`data-au-scope` or `lami-scope`/`data-lami-scope`, including named
  scope resources and cleanup when islands are removed.
- optional `autoDispose` cleanup when an enhanced root leaves the document.
- runtime-backed SSR helpers with escaping, repeats, branches, promise branches,
  spread attributes, and class/style/show/hide rendering.
- direct DOM compiler output for the current non-template-controller subset,
  including text/attribute interpolation, property/form bindings, events,
  refs, spread, class/style token bindings, and show/hide.
- direct DOM compiler output for `<let>`, `if.bind`/`else`, `repeat.for`,
  `with.bind`, `switch.bind`, and `promise.bind`, including nested direct
  factories.
- direct DOM compiler output for lightweight custom elements with bindables,
  lifecycle callbacks, default slots, and named slots.
- generated expression functions for the common behavior-free expression subset,
  with parser-backed fallback for richer converter/behavior cases.
- direct SSR codegen for interpolation, attributes, forms-friendly property
  output, spread, class/style/show/hide, and the current template controller
  family, with boundary markers for controller hydration.
- direct hydration codegen for the path-stable binding subset, so generated
  hydration modules attach to existing SSR DOM without recreating nodes.
- direct hydration for `<let>` locals, with SSR placeholders to keep later DOM
  paths stable.
- marker-based direct hydration for root `if.bind`/`else`, `repeat.for`,
  `with.bind`, `switch.bind`, and `promise.bind` ranges.
- marker-aware logical DOM paths for mixed controller and path-stable
  hydration.
- direct hydration for nested controllers inside client-created controller
  factories after their parent SSR range is replaced.
- runtime-backed hydration fallback remains available for unsupported future
  template instructions.
- runtime-backed hydration modules and a Vite plugin that can emit DOM, SSR, or
  hydration modules.
- dedicated rendering integration tests for runtime enhancement, compiled DOM,
  and SSR-to-hydrate flows.
- an optional Web Component adapter for wrapping Lami element definitions.

## Usage

```ts
import { enhance } from '@lami.js/runtime';

enhance(document.querySelector('#signup')!, {
  email: '',
  get canSubmit() {
    return this.email.includes('@');
  },
  submit(event: SubmitEvent) {
    event.preventDefault();
  }
});
```

```html
<form id="signup" submit.trigger="submit($event)">
  <input type="email" value.bind="email">
  <button disabled.bind="!canSubmit">Create account</button>
  <p if.bind="email.length">You entered ${email}</p>
</form>
```

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm test:all
pnpm test:e2e
pnpm test:perf
pnpm perf:report
pnpm pack:smoke
pnpm build
```

## CLI

```bash
lami compile src/contact.html --mode dom --outDir .lami
lami compile src/pages --mode ssr --outDir .lami-ssr
lami compile src/contact.html --mode hydrate --outDir .lami
```

## Examples

```bash
pnpm --filter @lami.js/example-todo dev
pnpm --filter @lami.js/example-post-form dev
```

The examples live in `examples/` and are covered by tests so they stay useful
as the library evolves.
