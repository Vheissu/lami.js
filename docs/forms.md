# Forms

Form bindings are a first-class runtime feature. They are covered by jsdom
integration tests and real browser e2e tests.

## Text Inputs And Textareas

```html
<input value.bind="title">
<textarea value.bind="body"></textarea>
```

`value.bind` is two-way by default for text inputs and textareas. The default
update event is `input`.

```html
<input value.bind="title & updateTrigger:'blur'">
<textarea value.bind="body & updateTrigger:'input':'blur'"></textarea>
```

Use `updateTrigger` to select source update events.

## Checkboxes

Boolean checkbox:

```html
<input type="checkbox" checked.bind="accepted">
```

Checkbox with model value:

```html
<label repeat.for="tag of tags">
  <input type="checkbox" model.bind="tag" checked.bind="selectedTags">
  ${tag.name}
</label>
```

When the checked binding target is an array, Lami adds/removes the model value.

## Radios

```html
<label repeat.for="plan of plans">
  <input type="radio" name="plan" model.bind="plan" checked.bind="selectedPlan">
  ${plan.name}
</label>
```

`model.bind` lets radios store rich values rather than only string values.

## Selects

```html
<select value.bind="selectedId">
  <option repeat.for="user of users" value.bind="user.id">${user.name}</option>
</select>
```

Rich values are supported through `model.bind`:

```html
<select value.bind="selectedUser">
  <option repeat.for="user of users" model.bind="user">${user.name}</option>
</select>
```

Multiple select stores an array:

```html
<select multiple value.bind="selectedTags">
  <option repeat.for="tag of tags" model.bind="tag">${tag.name}</option>
</select>
```

## File Inputs

Use `files.from-view` for file inputs:

```html
<input type="file" files.from-view="files">
```

`value.bind` on file inputs is rejected in dev mode. Browsers do not allow
programmatic file input value control in the same way as ordinary text fields.

## Submit Handling

```html
<form @submit:prevent="submit($event)">
  <input value.bind="title">
  <button disabled.bind="!canSubmit">Save</button>
</form>
```

The submit event is passed as `$event`. DOM events are intentionally kept raw,
not proxied, so browser-native methods such as `preventDefault()` keep their
correct receiver.

