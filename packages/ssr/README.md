# @lami.js/ssr

Server rendering helpers for Lami.js templates.

```ts
import { renderRuntimeTemplate } from '@lami.js/ssr';

const html = await renderRuntimeTemplate('<p>${name}</p>', { name: 'Lami' });
```

See [Compiler, SSR, And Hydration](../../docs/compiler-ssr-hydration.md).
