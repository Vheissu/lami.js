# Template Syntax

Lami templates use Aurelia-style binding syntax without depending on Aurelia.
Expressions are parsed by Lami.js; the runtime does not use `eval` or
`new Function`.

## Interpolation

```html
<h1>${title}</h1>
<img alt="${title}">
```

Interpolation is supported in text and plain attributes. Do not combine
interpolation with binding commands:

```html
<!-- Invalid -->
<input value.bind="${name}">
```

## Binding Commands

```html
<input value.bind="name">
<input value.two-way="email">
<input type="number" value-as-number.bind="quantity">
<p title.to-view="tooltip"></p>
<button disabled.bind="!canSave">Save</button>
<img src.attr="imageUrl">
```

Supported commands:

- `.bind`
- `.to-view`
- `.one-way`
- `.two-way`
- `.from-view`
- `.one-time`
- `.attr`
- `.trigger`
- `.capture`
- `.class`
- `.style`
- `.ref`
- `.for`

Default two-way targets are text input value, textarea value, checkbox/radio
checked, select value, select selectedIndex, and focus.

## Events

```html
<button click.trigger="save()">Save</button>
<button @click="save()">Save</button>
<form @submit:prevent="submit($event)"></form>
<button @click:stop="select(item)"></button>
<input keydown.trigger:ctrl+enter="save()">
```

Supported event modifiers:

- `prevent`
- `stop`
- `ctrl`
- `alt`
- `shift`
- `meta`
- `left`
- `middle`
- `right`
- key names such as `enter`

The current DOM event is available as `$event`.

`attached.trigger` and `detaching.trigger` are lifecycle hook events. They are
not browser DOM events; Lami invokes them when the owning view binds and
unbinds.

## Classes And Styles

```html
<li selected.class="item.id === selectedId"></li>
<div class.bind="{ ready, active: isActive }"></div>
<div style.bind="{ color, backgroundColor }"></div>
<div style.background-color.bind="color"></div>
```

Token class bindings toggle named classes. Style bindings write DOM style
properties.

## Template Controllers

```html
<p if.bind="ready">Ready</p>
<p else>Not ready</p>

<p show.bind="visible">Visible</p>
<p hide.bind="hidden">Hidden</p>

<li repeat.for="item of items; key: id">${$index}: ${item.name}</li>

<section with.bind="user">
  <h2>${name}</h2>
</section>

<section switch.bind="state">
  <p case="idle">Idle</p>
  <p case.bind="['loading', 'saving']">Working</p>
  <p default-case>Done</p>
</section>

<section promise.bind="request">
  <p pending>Loading</p>
  <p then="result">${result.title}</p>
  <p catch="error">${error.message}</p>
</section>
```

`repeat.for` supports arrays, numbers, sets, maps, and iterables. Repeat locals
include `$index`, `$first`, `$last`, `$middle`, `$even`, `$odd`, `$length`, and
`$previous`.

## Locals With `<let>`

```html
<let full-name.bind="`${first} ${last}`"></let>
<p>${fullName}</p>
```

`<let>` writes to template locals by default. Add `to-binding-context` to write
onto the model instead.

## Refs

```html
<input ref="input">
<user-card component.ref="card"></user-card>
<user-card controller.ref="cardController"></user-card>
```

Refs are assigned on bind and cleared on dispose when the property still points
at the same value.

## Lightweight Elements And Slots

Registered lightweight elements support bindable properties, lifecycle methods,
default slots, and named slots.

```html
<slot-panel title.bind="panelTitle">
  <button slot="actions" @click="save()">Save</button>
  <p>${message}</p>
</slot-panel>
```

The element template receives the element instance as its binding context.
Projected slot content keeps the parent binding context.

Compiled DOM modules use the same projection rules. Bindable host properties
are wired before lifecycle callbacks run, so `attached()` sees the current
bindable values.

## Spread

```html
<button ...buttonAttrs></button>
<user-card ...$bindables="user"></user-card>
```

Spread writes ordinary properties, plus `data-*` and `aria-*` attributes.

## Intentional Limits

- Assignment is only for event handlers and from-view/two-way updates.
- Dev mode rejects assignment in to-view/interpolation expressions.
- Missing value converters throw in dev mode and report warnings in production
  mode when `onWarn` is provided.
