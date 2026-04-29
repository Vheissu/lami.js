# Testing And Verification

The project has multiple verification layers. They intentionally overlap
because a binding library can pass unit tests while failing in a real browser.

## Commands

```bash
pnpm typecheck
pnpm test
pnpm test:all
pnpm test:e2e
pnpm test:e2e:chromium
pnpm test:e2e:firefox
pnpm test:e2e:webkit
pnpm test:perf
pnpm perf:report
pnpm pack:smoke
pnpm build
```

## Unit And Integration Tests

`pnpm test` runs the regular Vitest suite in jsdom. It covers:

- expression parsing and evaluation
- reactivity
- forms
- repeats
- template controllers
- resources
- diagnostics
- runtime rendered HTML integration
- compiled DOM integration
- SSR and hydration behavior
- Vite plugin output
- Web Component adapter behavior

`pnpm test:all` runs the regular Vitest suite and the focused performance
smoke suite.

## Real Browser E2E

`pnpm test:e2e` runs Playwright against the example apps in Chromium, Firefox,
and WebKit.

For a single browser, use:

- `pnpm test:e2e:chromium`
- `pnpm test:e2e:firefox`
- `pnpm test:e2e:webkit`

The current suite verifies:

- todo add/toggle/filter/clear workflows through rendered controls
- button disabled state and input reset behavior
- post form JSON submission
- post form error state after a failed request
- absence of unexpected page errors

## Package Smoke

`pnpm pack:smoke` builds all packages, packs the tarballs, validates tarball
contents, installs those tarballs into a fresh temporary consumer, typechecks
consumer imports, and runs runtime import smoke checks.

This catches packaging problems that in-repo tests can miss, such as:

- missing export targets
- leaked `workspace:` dependency specs
- package tarballs containing tests or config files
- Node ESM import specifiers that only work in bundlers
- missing CLI bin targets

## Performance And Cleanup Smoke

`pnpm test:perf` runs a focused Vitest file for load-bearing runtime paths:

- enhancing and updating a large keyed repeat with nested form bindings
- disposing a broad view with many event listeners and reactive effects
- inserting and removing mutation-observed scoped islands repeatedly

The timing thresholds are deliberately generous. They are not meant to replace
formal benchmarks; they catch accidental pathological slowdowns and cleanup
regressions while staying stable on ordinary development machines and CI.

`pnpm perf:report` builds the runtime and writes local benchmark artifacts under
`docs/assets/`:

- `performance-report.md`
- `performance-report.json`
- `performance-report.svg`

The report uses the same rendered-DOM scenarios as the smoke tests, but records
median, min, p95, and coarse heap-delta values so the current performance story
can be inspected and shared.

## CI Matrix

GitHub Actions runs separate jobs so failures point at the right layer:

- Node 20, 22, and 24: typecheck, regular Vitest suite, and package/example
  builds.
- Node 22 performance smoke: focused budget checks for high-risk runtime paths.
- Node 22 package smoke: packed tarballs installed into a fresh consumer.
- Browser examples: Chromium, Firefox, and WebKit each run the real Todo and
  post-form flows independently.

The supported runtime, browser, and package surfaces are summarized in the
[compatibility matrix](./compatibility.md).
