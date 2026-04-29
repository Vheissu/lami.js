# @lami.js/compiler

Build-time compiler and CLI for turning Lami.js templates into DOM, SSR, or
hydration modules.

```ts
import { compileTemplate } from '@lami.js/compiler';

const result = compileTemplate('<p>${name}</p>', { mode: 'dom' });
```

See [Compiler, SSR, And Hydration](../../docs/compiler-ssr-hydration.md).
