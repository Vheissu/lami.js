# Runtime API

The runtime package enhances existing DOM. It does not own the whole page and
does not require a component root for every screen.

```ts
import { createApp, enhance } from '@lami.js/runtime';

const handle = enhance(document.querySelector('#app')!, {
  name: 'Lami',
  count: 0,
  increment() {
    this.count++;
  }
});

await handle.flush();
handle.dispose();

createApp({ ready: true }).mount('#other-app');
```

## `enhance(root, model, options?)`

Enhances an `Element` or `DocumentFragment` in place.

```ts
interface EnhanceOptions {
  resources?: ResourceRegistry | ResourceRegistryInit;
  autoDispose?: boolean;
  observeMutations?: boolean;
  scheduler?: Scheduler;
  dev?: boolean;
  onError?: (error: LamiError) => void;
  onWarn?: (warning: LamiWarning) => void;
}
```

Returns an `AppHandle`:

```ts
interface AppHandle {
  root: Element | DocumentFragment;
  scope: Scope;
  dispose(): void;
  flush(): Promise<void>;
}
```

- `flush()` waits for batched reactive DOM updates.
- `dispose()` unbinds effects, listeners, refs, custom resources, and template
  controller views.
- `autoDispose` disposes when an enhanced root is removed from its parent.
- `observeMutations` enhances inserted islands marked with `au-scope`,
  `data-au-scope`, `lami-scope`, or `data-lami-scope`.

## Reactivity

```ts
import {
  batch,
  computed,
  effect,
  flushJobs,
  reactive,
  readonly,
  watch
} from '@lami.js/runtime';
```

- `reactive` wraps plain objects, arrays, maps, and sets.
- DOM nodes, DOM events, dates, regexps, promises, array buffers, weak
  collections, and values marked with `markRaw` are not proxied.
- Effects are batched through a microtask scheduler by default.
- `batch(fn)` groups multiple updates before flushing.

## Globals

Expressions can read built-in globals such as `Math`, `Number`, `String`,
`Boolean`, `Array`, `Object`, `Date`, `Intl`, `JSON`, `parseInt`, `parseFloat`,
`isNaN`, and `isFinite`.

Additional globals can be registered:

```ts
import { registerGlobal } from '@lami.js/runtime';

registerGlobal('formatCurrency', value => `$${value}`);
```

