# Performance

Lami.js has a small benchmark suite and two performance checks:

- `pnpm test:perf` runs budgeted Vitest smoke tests against real rendered DOM.
- `pnpm perf:report` builds the runtime, benchmarks Lami.js against vanilla DOM,
  React, and Svelte for comparable DOM scenarios, and writes data-driven
  graphics to `docs/assets/`.

The benchmark graphics are generated from the measured data with D3. They are
not hand-edited and they are not AI-generated images.

The report covers scenarios that matter for progressive enhancement apps:
large keyed repeats, keyed list updates, broad listener cleanup, and
mutation-observed island churn. The Lami/vanilla/React/Svelte comparisons are
local smoke benchmarks, not formal cross-framework claims.

![Lami.js performance report](./assets/performance-report.svg)

The latest generated report is stored in:

- [Markdown report](./assets/performance-report.md)
- [JSON data](./assets/performance-report.json)
- [D3-generated SVG chart](./assets/performance-report.svg)

## Reading The Numbers

The median time is the most useful day-to-day signal. The p95 value is the
guardrail for occasional slower runs. The heap delta is process-level and
should be treated as a coarse trend indicator rather than an exact allocation
profile.

CI runs the budgeted smoke tests on Node 20, 22, and 24. The full browser
example suite runs separately so real Todo and form flows keep proving that
the rendered HTML still behaves.
