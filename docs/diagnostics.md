# Diagnostics

Diagnostics are structured so applications and tests can capture runtime
issues without scraping console output.

```ts
import { enhance, type LamiError, type LamiWarning } from '@lami.js/runtime';

const errors: LamiError[] = [];
const warnings: LamiWarning[] = [];

enhance(root, model, {
  dev: true,
  onError(error) {
    errors.push(error);
  },
  onWarn(warning) {
    warnings.push(warning);
  }
});
```

The compiler also returns diagnostics:

```ts
import { compileTemplate } from '@lami.js/compiler';

const result = compileTemplate(template, {
  mode: 'dom',
  dev: true
});

for (const diagnostic of result.diagnostics) {
  console.log(diagnostic.title);
  console.log(diagnostic.message);
  console.log(diagnostic.hint);
}
```

Compiler diagnostics are shaped like short repair notes:

```ts
interface CompileDiagnostic {
  code: string;
  severity: 'info' | 'warning' | 'error';
  title: string;
  message: string;
  path?: number[];
  hint?: string;
}
```

The goal is Elm-style usefulness: a specific problem, the template path when
available, and a concrete hint for getting back onto the fast path.

## Errors

`LamiError` has:

```ts
class LamiError extends Error {
  readonly code: LamiErrorCode;
  readonly details?: unknown;
}
```

Current error codes:

- `E_EXPR_PARSE`
- `E_EXPR_ASSIGN`
- `E_BINDING`
- `E_BIND_TARGET`
- `E_RESOURCE_MISSING`
- `E_REPEAT_PARSE`
- `E_HYDRATE_MISMATCH`
- `E_UNSAFE_TEMPLATE`

Binding errors include details such as binding id, mode, phase, expression,
event name, and target element when available.

## Warnings

`LamiWarning` has:

```ts
class LamiWarning {
  readonly code: LamiWarningCode;
  readonly message: string;
  readonly details?: unknown;
}
```

Current warning codes:

- `W_RESOURCE_MISSING`
- `W_HYDRATE_MISMATCH`
- `W_COMPILER_RUNTIME_BACKED`

Current compiler info diagnostics:

- `I_COMPILER_DIRECT_DOM`
- `I_OPTIMIZED_ROW_MISS`

## Dev And Production Behavior

- Dev mode throws for invalid syntax, unsafe to-view assignments, missing
  converters, unsupported file input value binding, and other errors that
  should be fixed during development.
- Production mode can report recoverable binding errors through `onError`.
  When `onError` is omitted, binding errors are thrown so failures are not
  silently swallowed.
- Production warnings are emitted only through `onWarn`.
