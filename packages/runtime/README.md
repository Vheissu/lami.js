# @lami.js/runtime

Browser runtime for enhancing existing DOM with Lami.js bindings, resources,
forms, template controllers, and reactive updates.

```ts
import { enhance } from '@lami.js/runtime';

enhance(document.querySelector('#app')!, {
  name: 'Lami'
});
```

See:

- [Runtime API](../../docs/runtime-api.md)
- [Template Syntax](../../docs/template-syntax.md)
- [Forms](../../docs/forms.md)
- [Resources](../../docs/resources.md)
- [Diagnostics](../../docs/diagnostics.md)
