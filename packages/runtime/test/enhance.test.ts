import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineElement, enhance, flushJobs, registerAttribute, registerConverter } from '../src';

describe('enhance', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('binds text interpolation, property binding, and events', async () => {
    document.body.innerHTML = `
      <section id="app">
        <h1>Hello, \${name}</h1>
        <input value.bind="name">
        <button click.trigger="count += 1">+</button>
        <p>\${count}</p>
      </section>
    `;

    const root = document.querySelector('#app')!;
    const handle = enhance(root, { name: 'Lami', count: 0 });

    expect(root.querySelector('h1')!.textContent).toBe('Hello, Lami');
    const input = root.querySelector('input')!;
    input.value = 'Lami.js';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await handle.flush();

    expect(root.querySelector('h1')!.textContent).toBe('Hello, Lami.js');

    root.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await handle.flush();

    expect(root.querySelector('p')!.textContent).toBe('1');
  });

  it('supports if/else, show, let, class, style, and converters', async () => {
    registerConverter('upper', {
      toView(value: unknown) {
        return String(value).toUpperCase();
      }
    });

    document.body.innerHTML = `
      <section id="app">
        <let full-name.bind="first + ' ' + last"></let>
        <p class.bind="{ active: enabled }" style.background-color.bind="color">\${fullName | upper}</p>
        <strong if.bind="enabled">on</strong>
        <em else>off</em>
        <span show.bind="enabled">visible</span>
      </section>
    `;

    const root = document.querySelector('#app')!;
    const handle = enhance(root, { first: 'La', last: 'mi', enabled: true, color: 'red' });
    const paragraph = root.querySelector('p')!;

    expect(paragraph.textContent).toBe('LA MI');
    expect(paragraph.classList.contains('active')).toBe(true);
    expect((paragraph as HTMLElement).style.backgroundColor).toBe('red');
    expect(root.querySelector('strong')?.textContent).toBe('on');
    expect((root.querySelector('span') as HTMLElement).style.display).toBe('');

    (handle.scope.bindingContext as { enabled: boolean }).enabled = false;
    await flushJobs();

    expect(root.querySelector('strong')).toBeNull();
    expect(root.querySelector('em')?.textContent).toBe('off');
    expect((root.querySelector('span') as HTMLElement).style.display).toBe('none');
  });

  it('renders repeat.for over arrays and updates existing item scopes', async () => {
    document.body.innerHTML = `
      <ul id="items">
        <li repeat.for="item of items">\${$index}: \${item.name}</li>
      </ul>
    `;

    const model = { items: [{ name: 'One' }, { name: 'Two' }] };
    const root = document.querySelector('#items')!;
    const handle = enhance(root, model);

    expect(Array.from(root.querySelectorAll('li'), item => item.textContent?.trim())).toEqual(['0: One', '1: Two']);

    (handle.scope.bindingContext as typeof model).items[0] = { name: 'First' };
    (handle.scope.bindingContext as typeof model).items.push({ name: 'Three' });
    await handle.flush();

    expect(Array.from(root.querySelectorAll('li'), item => item.textContent?.trim())).toEqual(['0: First', '1: Two', '2: Three']);
  });

  it('supports form model binding for checkbox arrays', async () => {
    document.body.innerHTML = `
      <form id="tags">
        <label repeat.for="tag of tags">
          <input type="checkbox" model.bind="tag" checked.bind="selected">
          \${tag.name}
        </label>
      </form>
    `;

    const tagA = { name: 'A' };
    const tagB = { name: 'B' };
    const root = document.querySelector('#tags')!;
    const handle = enhance(root, { tags: [tagA, tagB], selected: [tagB] });
    const boxes = root.querySelectorAll<HTMLInputElement>('input');

    expect(boxes[0]!.checked).toBe(false);
    expect(boxes[1]!.checked).toBe(true);

    boxes[0]!.checked = true;
    boxes[0]!.dispatchEvent(new Event('change', { bubbles: true }));
    await handle.flush();

    expect((handle.scope.bindingContext as { selected: unknown[] }).selected).toEqual([tagB, tagA]);
  });

  it('cleans up refs on dispose', () => {
    document.body.innerHTML = `<div id="app"><input ref="inputElement"></div>`;
    const model: { inputElement?: Element } = {};
    const handle = enhance(document.querySelector('#app')!, model);

    expect(model.inputElement).toBeInstanceOf(HTMLInputElement);
    handle.dispose();
    expect(model.inputElement).toBeUndefined();
  });

  it('filters event modifiers before evaluating expressions', async () => {
    document.body.innerHTML = `<button id="btn" keydown.trigger:ctrl+enter.prevent="save($event)">Save</button>`;
    const save = vi.fn();
    const button = document.querySelector('#btn')!;
    const handle = enhance(button, { save });

    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', ctrlKey: true, bubbles: true }));
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    await handle.flush();

    expect(save).toHaveBeenCalledTimes(1);
  });

  it('delegates plain bubbling events and removes handlers on dispose', async () => {
    document.body.innerHTML = `<section id="app"><button click.trigger="select()">Select</button></section>`;
    const model = { selected: 0, select() { this.selected++; } };
    const root = document.querySelector('#app')!;
    const button = root.querySelector('button')!;
    const handle = enhance(root, model);

    button.click();
    await handle.flush();
    expect(model.selected).toBe(1);

    handle.dispose();
    button.click();
    await handle.flush();
    expect(model.selected).toBe(1);
  });

  it('binds lightweight custom attributes', async () => {
    class TooltipAttribute {
      text = '';
      position = 'top';

      constructor(private readonly host: Element) {}

      textChanged(): void {
        this.host.setAttribute('aria-label', this.text);
      }

      positionChanged(): void {
        this.host.setAttribute('data-position', this.position);
      }
    }

    registerAttribute('tooltip', {
      name: 'tooltip',
      Type: TooltipAttribute,
      defaultProperty: 'text',
      bindables: {
        text: {},
        position: {}
      }
    });

    document.body.innerHTML = `<button id="help" tooltip="text.bind: help; position: right"></button>`;
    const model = { help: 'Need help?' };
    const button = document.querySelector('#help')!;
    const handle = enhance(button, model);

    expect(button.getAttribute('aria-label')).toBe('Need help?');
    expect(button.getAttribute('data-position')).toBe('right');

    (handle.scope.bindingContext as typeof model).help = 'Still need help?';
    await handle.flush();

    expect(button.getAttribute('aria-label')).toBe('Still need help?');
  });

  it('renders lightweight custom elements with bindables', async () => {
    class UserCard {
      user = { name: '' };
    }

    defineElement('user-card', {
      name: 'user-card',
      Type: UserCard,
      bindables: {
        user: {}
      },
      template: `<article>\${user.name}</article>`
    });

    document.body.innerHTML = `<section id="app"><user-card user.bind="selected"></user-card></section>`;
    const model = { selected: { name: 'Lami' } };
    const root = document.querySelector('#app')!;
    const handle = enhance(root, model);

    expect(root.querySelector('article')!.textContent).toBe('Lami');

    (handle.scope.bindingContext as typeof model).selected = { name: 'Lami.js' };
    await handle.flush();

    expect(root.querySelector('article')!.textContent).toBe('Lami.js');
  });

  it('projects default and named custom element slots with parent scope', async () => {
    class PanelElement {
      title = '';
    }

    defineElement('slot-panel', {
      name: 'slot-panel',
      Type: PanelElement,
      bindables: {
        title: {}
      },
      template: `
        <article>
          <header>\${title}<slot name="actions"></slot></header>
          <section><slot></slot></section>
        </article>
      `
    });

    document.body.innerHTML = `
      <section id="app">
        <slot-panel title.bind="panelTitle">
          <button slot="actions" @click="count += 1">\${count}</button>
          <p>\${message}</p>
        </slot-panel>
      </section>
    `;

    const root = document.querySelector('#app')!;
    const handle = enhance(root, { panelTitle: 'Profile', message: 'Hello', count: 0 });

    expect(root.querySelector('header')!.textContent?.trim()).toBe('Profile0');
    expect(root.querySelector('section')!.textContent?.trim()).toBe('Hello');

    root.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    (handle.scope.bindingContext as { message: string }).message = 'Updated';
    await handle.flush();

    expect(root.querySelector('button')!.textContent).toBe('1');
    expect(root.querySelector('article section')!.textContent?.trim()).toBe('Updated');
  });

  it('applies template controllers before lightweight element rendering', () => {
    class RepeatedCard {
      item = { name: '' };
    }

    defineElement('repeated-card', {
      name: 'repeated-card',
      Type: RepeatedCard,
      bindables: {
        item: {}
      },
      template: `<article>\${item.name}<slot></slot></article>`
    });

    document.body.innerHTML = `
      <section id="app">
        <repeated-card repeat.for="item of items" item.bind="item">
          <span>\${$index}</span>
        </repeated-card>
      </section>
    `;

    const root = document.querySelector('#app')!;
    enhance(root, {
      items: [
        { name: 'One' },
        { name: 'Two' }
      ]
    });

    expect(Array.from(root.querySelectorAll('article'), article => article.textContent?.trim().replace(/\s+/g, '')))
      .toEqual(['One0', 'Two1']);
  });

  it('runs attached and detaching lifecycle hook events', () => {
    document.body.innerHTML = `
      <section id="app">
        <p attached.trigger="record('attached', $event.detail.element)" detaching.trigger="record('detaching', $event.detail.element)">
          Hooked
        </p>
      </section>
    `;
    const calls: string[] = [];
    const elements: Element[] = [];
    const root = document.querySelector('#app')!;
    const handle = enhance(root, {
      record(name: string, element: Element) {
        calls.push(name);
        elements.push(element);
      }
    });

    const paragraph = root.querySelector('p')!;
    expect(calls).toEqual(['attached']);
    expect(elements[0]).toBe(paragraph);

    handle.dispose();

    expect(calls).toEqual(['attached', 'detaching']);
    expect(elements[1]).toBe(paragraph);
  });
});
