# Changelog

## 1.0.0 - 2026-04-29

Initial stable release of the Lami.js package suite:

- `@lami.js/runtime`
- `@lami.js/compiler`
- `@lami.js/ssr`
- `@lami.js/vite`
- `@lami.js/web-component`

### Runtime

- Progressive enhancement for existing DOM with fine-grained reactivity.
- Text and attribute interpolation, property bindings, form bindings, event
  bindings, refs, spread bindings, and class/style/show/hide bindings.
- Template controllers for `if.bind`/`else`, `repeat.for`, `with.bind`,
  `switch.bind`, `promise.bind`, and `<let>`.
- Value converters, binding behaviors, signals, custom attributes, lightweight
  custom elements, mutation-observed islands, and automatic disposal support.
- Structured runtime diagnostics through `onError` and `onWarn`.

### Compiler, SSR, And Hydration

- Direct DOM compiler output for the supported binding and template-controller
  surface, including nested direct factories and lightweight custom elements.
- Direct SSR output with escaping, forms-friendly property output, spread
  attributes, class/style/show/hide rendering, and controller boundary markers.
- Direct hydration output for path-stable bindings and marker-backed controller
  ranges, with runtime-backed fallback for future unsupported instructions.
- Vite plugin support for DOM, SSR, and hydration module generation.

### Packaging

- Public ESM packages with type declarations, explicit `exports`, MIT license
  metadata, repository metadata, and package smoke coverage.
- CLI binaries exposed by `@lami.js/compiler` as `lami` and `lami.js`.

### Verification

- TypeScript typecheck.
- Vitest unit and integration suite.
- Performance and cleanup smoke suite.
- Playwright example flows in Chromium, Firefox, and WebKit.
- Packed tarball smoke test in a fresh consumer project.
- Production dependency audit.

### Performance

The 1.0.0 release ships with generated benchmark artifacts under `docs/assets`.
The local report compares rendered-DOM smoke scenarios against vanilla DOM,
React 19, and Svelte 5, including median, min, p95, and coarse heap-delta data.
These numbers are useful for release regression checks and performance
storytelling, but they are not a formal cross-framework benchmark.

Regenerate `docs/assets/performance-report.md`,
`docs/assets/performance-report.json`, and `docs/assets/performance-report.svg`
on the release machine before copying exact benchmark numbers into public
release notes.
