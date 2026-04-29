# @lami.js/web-component

Adapter for registering Lami.js element definitions as native custom elements.

```ts
import { defineAsWebComponent } from '@lami.js/web-component';

defineAsWebComponent({
  name: 'hello-card',
  Type: class {
    name = 'Lami';
  },
  template: '<p>${name}</p>'
});
```

See [Resources](../../docs/resources.md).
