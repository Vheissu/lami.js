# Compatibility Matrix

Lami.js keeps compatibility proof close to the supported surfaces.

## Runtime Support

| Surface | Current CI Coverage |
| --- | --- |
| Node.js 20 | Typecheck, Vitest suite, workspace build |
| Node.js 22 | Typecheck, Vitest suite, workspace build, performance smoke, package smoke, browser examples |
| Node.js 24 | Typecheck, Vitest suite, workspace build |
| Native ESM consumers | Package smoke installs packed tarballs into a fresh consumer |
| TypeScript declarations | Package smoke typechecks consumer imports |

The root package declares `node >=20.0.0`.

## Browser Support

| Browser Engine | Current CI Coverage |
| --- | --- |
| Chromium | Real Todo and post-form examples |
| Firefox | Real Todo and post-form examples |
| WebKit | Real Todo and post-form examples |

The browser suite is intentionally example-driven. It verifies rendered controls,
DOM updates, form submission behavior, failure states, and page-error absence in
real engines.

## Package Support

Every publishable package is built and packed during `pnpm pack:smoke`:

- `@lami.js/runtime`
- `@lami.js/compiler`
- `@lami.js/ssr`
- `@lami.js/vite`
- `@lami.js/web-component`

The smoke script checks tarball contents, dependency metadata, ESM imports,
types, and CLI bin wiring before a release can be trusted.

## Performance Support

`pnpm test:perf` runs stable budget checks in CI. `pnpm perf:report` is a local
benchmark/report generator for release notes, README graphics, and regression
investigation.
