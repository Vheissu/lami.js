# Resources

Resources let apps extend the template language without taking on a framework
container.

## Value Converters

```ts
import { registerConverter } from '@lami.js/runtime';

registerConverter('upper', {
  toView(value) {
    return String(value).toUpperCase();
  },
  fromView(value) {
    return String(value).toLowerCase();
  }
});
```

```html
<p>${name | upper}</p>
```

Missing converters throw in dev mode. In production mode the expression falls
back to the unconverted value and reports `W_RESOURCE_MISSING` through
`onWarn` when provided.

## Binding Behaviors

Built-in behaviors:

- `debounce`
- `throttle`
- `updateTrigger`
- `signal`
- `attr`
- `oneTime` / `one-time`
- `toView` / `to-view`
- `oneWay` / `one-way`
- `fromView` / `from-view`
- `twoWay` / `two-way`

```html
<input value.bind="query & debounce:250">
<p>${clock & signal:'tick'}</p>
```

```ts
import { signal } from '@lami.js/runtime';

signal('tick');
```

## Custom Attributes

```ts
import { registerAttribute } from '@lami.js/runtime';

class Tooltip {
  text = '';

  attached() {
    this.element.setAttribute('title', this.text);
  }

  constructor(private readonly element: Element) {}
}

registerAttribute('tooltip', {
  name: 'tooltip',
  Type: Tooltip,
  defaultProperty: 'text',
  bindables: {
    text: {}
  }
});
```

```html
<button tooltip="text.bind: label"></button>
<button tooltip.ref="tooltipController"></button>
```

Supported lifecycle methods are `binding`, `bound`, `attaching`, `attached`,
`detaching`, and `unbinding`. Bindable change callbacks use the
`propertyChanged(value, oldValue)` naming convention, plus optional
`propertiesChanged(changes)` batching.

## Custom Elements

```ts
import { defineElement } from '@lami.js/runtime';

class UserCard {
  user = { name: '' };
}

defineElement('user-card', {
  name: 'user-card',
  Type: UserCard,
  bindables: {
    user: {}
  },
  template: '<article>${user.name}</article>'
});
```

```html
<user-card user.bind="selectedUser" component.ref="card"></user-card>
```

Custom elements are lightweight template resources. They are not router-aware
components and do not use dependency injection.

## Scoped Islands

With `observeMutations`, inserted islands can get their own model:

```ts
import { enhance } from '@lami.js/runtime';

enhance(root, hostModel, {
  observeMutations: true,
  resources: {
    scopes: {
      newsletter(parentScope) {
        return { email: '', subscribed: false };
      }
    }
  }
});
```

```html
<section data-lami-scope="newsletter">
  <input value.bind="email">
</section>
```

When the island is removed, its view is disposed.

